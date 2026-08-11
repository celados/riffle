import {
  FileFinder,
  type FileFinderApi,
  type GrepCursor,
  type GrepResult,
  type SearchResult,
  type WatchEvent,
} from "@celados/fff-node";
import { lstat, stat } from "node:fs/promises";
import { basename, relative, sep } from "node:path";
import type { SearchHit, Theme, TreeNode, VaultSnapshot } from "../src/lib/types";
import { reconcileManagedIgnore } from "./managed-ignore";
import { isAcceptedVaultRel } from "./vault-path-policy";

const SCAN_TIMEOUT_MS = 15_000;
const PERCENT_ESCAPE_PREFIXES = Array.from(
  { length: 256 },
  (_, value) => `%${value.toString(16).padStart(2, "0")}`,
);
// Watch delivery is normally immediate; a short grace period avoids a full
// rescan on healthy writes without turning a missed event into a frozen UI.
const MUTATION_OBSERVATION_TIMEOUT_MS = 250;

export type VaultIndexEntry = {
  rel: string;
  kind: "note" | "folder";
  modifiedMs: number;
};

export type VaultChange =
  | { kind: "created" | "modified"; entry: VaultIndexEntry }
  | { kind: "removed"; rel: string };

export type VaultIndexEvent =
  | {
      kind: "replacement";
      indexEpoch: number;
      sequence: 0;
      snapshot: VaultSnapshot;
    }
  | {
      kind: "changes";
      indexEpoch: number;
      sequence: number;
      changes: VaultChange[];
    };

export type VaultIndexOptions = {
  listener?: (event: VaultIndexEvent) => void;
  allocateEpoch?: () => number;
  onFatal?: (error: Error) => void;
  createFinder?: (root: string) =>
    | { ok: true; value: FileFinderApi }
    | { ok: false; error: string };
  statPath?: (path: string) => Promise<{
    isDirectory: () => boolean;
    isSymbolicLink: () => boolean;
    mtimeMs: number;
  }>;
  entryTimeoutMs?: number;
  frecencyDbPath?: string;
};

export class VaultIndex {
  readonly #root: string;
  readonly #theme: Theme;
  readonly #finder: FileFinderApi;
  readonly #listener: (event: VaultIndexEvent) => void;
  readonly #allocateEpoch: () => number;
  readonly #onFatal: (error: Error) => void;
  readonly #statPath: NonNullable<VaultIndexOptions["statPath"]>;
  readonly #entryTimeoutMs: number;
  #indexEpoch = 0;
  #sequence = 0;
  #unsubscribe: (() => void) | null = null;
  #eventQueue = Promise.resolve();
  #destroyed = false;
  #fatalReported = false;
  #terminalError: Error | null = null;
  #entries = new Map<string, VaultIndexEntry>();

  private constructor(
    root: string,
    theme: Theme,
    finder: FileFinderApi,
    options: VaultIndexOptions,
  ) {
    this.#root = root;
    this.#theme = theme;
    this.#finder = finder;
    this.#listener = options.listener ?? (() => {});
    let localEpoch = 0;
    this.#allocateEpoch = options.allocateEpoch ?? (() => ++localEpoch);
    this.#onFatal = options.onFatal ?? (() => {});
    this.#statPath = options.statPath ?? lstat;
    this.#entryTimeoutMs = options.entryTimeoutMs ?? MUTATION_OBSERVATION_TIMEOUT_MS;
  }

  static async open(
    root: string,
    theme: Theme,
    options: VaultIndexOptions = {},
  ): Promise<VaultIndex> {
    await reconcileManagedIgnore(root);
    const created = options.createFinder?.(root) ?? FileFinder.create({
      basePath: root,
      frecencyDbPath: options.frecencyDbPath,
      disableMmapCache: true,
      disableContentIndexing: false,
      followSymlinks: true,
    });
    if (!created.ok) throw new Error(`FFF initialization failed: ${created.error}`);

    const index = new VaultIndex(root, theme, created.value, options);
    try {
      await index.#waitForScan();
      await index.#waitForWatcher();
      const watched = created.value.watch((events) => index.#enqueue(events));
      if (!watched.ok) throw new Error(`FFF watcher failed: ${watched.error}`);
      index.#unsubscribe = watched.value;
      index.#entries = readAllEntries(created.value);
      index.#replaceEpoch();
      return index;
    } catch (error) {
      index.destroy();
      throw error;
    }
  }

  async snapshot(): Promise<VaultSnapshot> {
    this.#assertAvailable();
    return this.#snapshot();
  }
  hasEntry(rel: string): boolean {
    this.#assertAvailable();
    return this.#entries.has(normalizeFffRel(rel));
  }

  searchNotes(query: string, limit: number): SearchHit[] {
    this.#assertAvailable();
    const needle = query.trim();
    if (!needle || limit <= 0) return [];

    try {
      const pathHits = new Map<string, SearchHit>();
      for (let pageIndex = 0; pathHits.size < limit; pageIndex += 1) {
        const result: SearchResult = unwrap(
          this.#finder.fileSearch(needle, { pageIndex, pageSize: Math.max(limit * 2, 50) }),
          "FFF Note path search failed",
        );
        for (const item of result.items) {
          if (!this.#isAcceptedNote(item.relativePath) || pathHits.has(item.relativePath)) {
            continue;
          }
          pathHits.set(item.relativePath, searchHit(item.relativePath, "", true));
          if (pathHits.size === limit) break;
        }
        if (result.items.length === 0 || (pageIndex + 1) * Math.max(limit * 2, 50) >= result.totalMatched) {
          break;
        }
      }

      const contentHits = new Map<string, SearchHit>();
      let cursor: GrepCursor | null = null;
      do {
        const result: GrepResult = unwrap(
          this.#finder.grep(needle, {
            mode: "plain",
            smartCase: true,
            maxMatchesPerFile: 1,
            pageSize: Math.max(limit * 2, 50),
            cursor,
          }),
          "FFF Note content search failed",
        );
        for (const item of result.items) {
          if (!this.#isAcceptedNote(item.relativePath) || contentHits.has(item.relativePath)) {
            continue;
          }
          contentHits.set(
            item.relativePath,
            searchHit(item.relativePath, item.lineContent, false),
          );
        }
        cursor = result.nextCursor;
      } while (cursor && contentHits.size < limit);

      const merged = [...pathHits.values()].map((hit) => ({
        ...hit,
        snippet: contentHits.get(hit.rel)?.snippet ?? hit.snippet,
      }));
      for (const hit of contentHits.values()) {
        if (!pathHits.has(hit.rel)) merged.push(hit);
      }
      return merged.slice(0, limit);
    } catch (cause) {
      this.#fail(cause);
      throw cause;
    }
  }

  recordAccess(rel: string): void {
    this.#assertAvailable();
    if (!this.#isAcceptedNote(rel)) {
      throw new Error(`Cannot record access for a Note outside the Vault Index: ${rel}`);
    }
    try {
      unwrap(this.#finder.trackAccess(rel), "FFF Note access tracking failed");
    } catch (cause) {
      this.#fail(cause);
      throw cause;
    }
  }

  backlinkCandidates(targetRel: string): string[] {
    this.#assertAvailable();
    const patterns = backlinkPatterns(targetRel);
    if (patterns.length === 0) return [];
    try {
      const candidates = new Set<string>();
      let cursor: GrepCursor | null = null;
      do {
        const result: GrepResult = unwrap(
          this.#finder.multiGrep({
            patterns,
            constraints: "*.md",
            smartCase: true,
            maxMatchesPerFile: 1,
            pageSize: 512,
            cursor,
          }),
          "FFF backlink candidate search failed",
        );
        for (const item of result.items) {
          if (this.#isAcceptedNote(item.relativePath)) candidates.add(item.relativePath);
        }
        cursor = result.nextCursor;
      } while (cursor);
      return [...candidates];
    } catch (cause) {
      this.#fail(cause);
      throw cause;
    }
  }

  noteRels(): string[] {
    this.#assertAvailable();
    return [...this.#entries.values()]
      .filter((entry) => entry.kind === "note")
      .map((entry) => entry.rel)
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
  }

  synchronize(): VaultIndexEvent {
    this.#assertAvailable();
    // A sequence-zero snapshot already defines a safe shared cursor. Only a
    // live generation with consumed changes needs a fresh global epoch.
    return this.#sequence === 0 ? this.#baseline() : this.#replaceEpoch();
  }

  async rescan(): Promise<void> {
    this.#assertAvailable();
    await this.#schedule(async () => {
      this.#assertAvailable();
      await this.#replaceSnapshot();
    });
  }

  acceptsPath(rel: string, isDirectory = false): boolean {
    this.#assertAvailable();
    try {
      return unwrap(
        this.#finder.acceptsPath(rel, isDirectory),
        "FFF path policy query failed",
      );
    } catch (cause) {
      this.#fail(cause);
      throw cause;
    }
  }

  async ensureCreated(rel: string): Promise<void> {
    if (await this.#waitForEntry(rel, true)) return;
    await this.rescan();
    if (this.#hasEntry(rel, true) || !this.acceptsPath(rel)) return;
    const error = new Error(`FFF index remained inconsistent after creating ${rel}.`);
    this.#fail(error);
    throw error;
  }

  async ensureRemoved(rel: string): Promise<void> {
    if (await this.#waitForEntry(rel, false)) return;
    await this.rescan();
    if (this.#hasEntry(rel, false)) return;
    const error = new Error(`FFF index remained inconsistent after removing ${rel}.`);
    this.#fail(error);
    throw error;
  }

  async #waitForEntry(rel: string, present: boolean): Promise<boolean> {
    const deadline = Date.now() + this.#entryTimeoutMs;
    while (Date.now() < deadline) {
      this.#assertAvailable();
      if (this.#hasEntry(rel, present)) return true;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    this.#assertAvailable();
    return false;
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#unsubscribe?.();
    this.#finder.destroy();
  }

  #enqueue(events: WatchEvent[]): void {
    void this.#schedule(() => this.#handleEvents(events));
  }

  #schedule<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#eventQueue.then(operation);
    this.#eventQueue = result.then(
      () => undefined,
      (cause: unknown) => this.#fail(cause),
    );
    return result;
  }

  async #handleEvents(events: WatchEvent[]): Promise<void> {
    if (this.#destroyed) return;
    if (events.some((event) => event.kind === "rescan")) {
      await this.#replaceSnapshot();
      return;
    }

    const changes = new Map<string, VaultChange>();
    for (const event of events) {
      if (this.#destroyed) return;
      const rel = normalizeFffRel(relative(this.#root, event.path));
      if (!rel || rel.startsWith("../") || !isAcceptedVaultRel(rel)) continue;
      if (event.kind === "removed") {
        this.#removeEntry(rel, changes);
        continue;
      }
      if (event.kind === "rescan") continue;
      await this.#upsertPath(rel, event.path, event.kind, changes);
    }
    if (changes.size === 0 || this.#destroyed) return;
    this.#sequence += 1;
    this.#listener({
      kind: "changes",
      indexEpoch: this.#indexEpoch,
      sequence: this.#sequence,
      changes: [...changes.values()].sort(compareChanges),
    });
  }

  async #upsertPath(
    rel: string,
    path: string,
    eventKind: "created" | "modified",
    changes: Map<string, VaultChange>,
  ): Promise<void> {
    let metadata;
    try {
      metadata = await this.#statPath(path);
    } catch (error) {
      if (isNotFound(error)) {
        this.#removeEntry(rel, changes);
        return;
      }
      throw error;
    }
    let isDirectory = metadata.isDirectory();
    if (metadata.isSymbolicLink()) {
      try {
        isDirectory = (await stat(path)).isDirectory();
      } catch (error) {
        if (isNotFound(error)) {
          this.#removeEntry(rel, changes);
          return;
        }
        throw error;
      }
    }
    const kind = isDirectory ? "folder" : metadata.isSymbolicLink()
      ? null
      : rel.endsWith(".md")
      ? "note"
      : null;
    if (!kind) {
      this.#removeEntry(rel, changes);
      return;
    }
    const previous = this.#entries.get(rel);
    if (previous && previous.kind !== kind) this.#removeEntry(rel, changes);
    this.#ensureParentFolders(rel, changes);
    const entry: VaultIndexEntry = {
      rel,
      kind,
      modifiedMs: kind === "note" ? metadata.mtimeMs : 0,
    };
    this.#entries.set(rel, entry);
    const pending = changes.get(rel);
    const changeKind = previous
      ? "modified"
      : pending?.kind === "created" || eventKind === "created"
      ? "created"
      : "modified";
    changes.set(rel, {
      kind: changeKind,
      entry,
    });
  }

  #ensureParentFolders(rel: string, changes: Map<string, VaultChange>): void {
    const parts = rel.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      const folderRel = parts.slice(0, index).join("/");
      if (this.#entries.has(folderRel)) continue;
      const entry: VaultIndexEntry = { rel: folderRel, kind: "folder", modifiedMs: 0 };
      this.#entries.set(folderRel, entry);
      changes.set(folderRel, { kind: "created", entry });
    }
  }

  #removeEntry(rel: string, changes: Map<string, VaultChange>): void {
    const prefix = `${rel}/`;
    for (const entryRel of [...this.#entries.keys()]) {
      if (entryRel !== rel && !entryRel.startsWith(prefix)) continue;
      this.#entries.delete(entryRel);
      changes.set(entryRel, { kind: "removed", rel: entryRel });
    }
  }

  async #replaceSnapshot(): Promise<void> {
    await reconcileManagedIgnore(this.#root);
    unwrap(this.#finder.scanFiles(), "FFF rescan failed");
    await this.#waitForScan();
    if (this.#destroyed) return;
    this.#entries = readAllEntries(this.#finder);
    this.#replaceEpoch();
  }

  #replaceEpoch(): Extract<VaultIndexEvent, { kind: "replacement" }> {
    this.#indexEpoch = this.#allocateEpoch();
    this.#sequence = 0;
    const event = this.#baseline();
    this.#listener(event);
    return event;
  }

  #baseline(): Extract<VaultIndexEvent, { kind: "replacement" }> {
    return {
      kind: "replacement",
      indexEpoch: this.#indexEpoch,
      sequence: 0,
      snapshot: this.#snapshot(),
    };
  }

  #snapshot(): VaultSnapshot {
    return {
      root: this.#root,
      name: basename(this.#root),
      tree: projectTree(this.#entries.values()),
      theme: this.#theme,
    };
  }

  async #waitForScan(): Promise<void> {
    const waited = await this.#finder.waitForScan(SCAN_TIMEOUT_MS);
    if (!waited.ok) throw new Error(`FFF scan failed: ${waited.error}`);
    if (!waited.value) throw new Error("FFF scan timed out.");
  }

  async #waitForWatcher(): Promise<void> {
    const deadline = Date.now() + SCAN_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const progress = unwrap(
        this.#finder.getScanProgress(),
        "FFF watcher readiness failed",
      );
      if (!progress.isScanning && progress.isWatcherReady) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("FFF watcher readiness timed out.");
  }

  #fail(cause: unknown): void {
    if (this.#destroyed || this.#fatalReported) return;
    this.#fatalReported = true;
    const error = cause instanceof Error ? cause : new Error(String(cause));
    this.#terminalError = error;
    this.destroy();
    this.#onFatal(error);
  }

  #assertAvailable(): void {
    if (this.#terminalError) throw this.#terminalError;
    if (this.#destroyed) throw new Error("FFF index is no longer available.");
  }

  #hasEntry(rel: string, present: boolean): boolean {
    const prefix = `${rel}/`;
    const found = [...this.#entries.keys()].some(
      (entryRel) => entryRel === rel || entryRel.startsWith(prefix),
    );
    return found === present;
  }

  #isAcceptedNote(rel: string): boolean {
    return this.#entries.get(normalizeFffRel(rel))?.kind === "note";
  }
}

function searchHit(rel: string, snippet: string, titleMatch: boolean): SearchHit {
  return {
    rel,
    title: basename(rel).replace(/\.md$/i, ""),
    snippet: snippet.trim().replace(/\s+/g, " "),
    titleMatch,
  };
}

function backlinkPatterns(targetRel: string): string[] {
  const normalized = normalizeFffRel(targetRel).replace(/^\/+/, "");
  if (!normalized || !normalized.toLowerCase().endsWith(".md")) return [];
  const withoutExtension = normalized.slice(0, -3);
  const basenameWithoutExtension = basename(withoutExtension);
  const encoded = normalized.split("/").map(encodeURIComponent).join("/");
  const encodedWithoutExtension = encoded.slice(0, -3);
  const fullyEncoded = encodeURIComponent(normalized);
  const fullyEncodedWithoutExtension = fullyEncoded.slice(0, -3);
  // fff smart-case only becomes insensitive when every pattern is lowercase.
  // fff does not recall short `%` patterns. These fixed byte escapes are the
  // bounded fallback for arbitrary `%HH`; parser validation remains authoritative.
  return [...new Set([
    ...PERCENT_ESCAPE_PREFIXES,
    normalized,
    encoded,
    withoutExtension,
    encodedWithoutExtension,
    fullyEncoded,
    fullyEncodedWithoutExtension,
    basenameWithoutExtension,
  ].map((pattern) => pattern.toLowerCase()))];
}

function readAllEntries(finder: FileFinderApi): Map<string, VaultIndexEntry> {
  const entries = new Map<string, VaultIndexEntry>();
  const resident = unwrap(
    finder.residentEntries(),
    "FFF resident index query failed",
  );
  for (const result of resident) {
    const rel = normalizeFffRel(result.relativePath).replace(/\/$/, "");
    if (!rel || !isAcceptedVaultRel(rel)) continue;
    if (result.type === "file") {
      if (!rel.endsWith(".md")) continue;
      ensureParentFolders(entries, rel);
      entries.set(rel, {
        rel,
        kind: "note",
        modifiedMs: result.modified * 1_000,
      });
    } else {
      entries.set(rel, { rel, kind: "folder", modifiedMs: 0 });
    }
  }
  return entries;
}

function ensureParentFolders(entries: Map<string, VaultIndexEntry>, rel: string): void {
  const parts = rel.split("/");
  for (let index = 1; index < parts.length; index += 1) {
    const folderRel = parts.slice(0, index).join("/");
    if (!entries.has(folderRel)) {
      entries.set(folderRel, { rel: folderRel, kind: "folder", modifiedMs: 0 });
    }
  }
}

function projectTree(entries: Iterable<VaultIndexEntry>): TreeNode[] {
  const root: TreeNode[] = [];
  const children = new Map<string, TreeNode[]>([["", root]]);
  const ordered = [...entries].sort((left, right) => pathDepthThenName(left.rel, right.rel));
  for (const entry of ordered.filter((value) => value.kind === "folder")) {
    const node: TreeNode = {
      name: basename(entry.rel),
      rel: entry.rel,
      kind: "folder",
      children: [],
      modifiedMs: 0,
    };
    const parentChildren = children.get(parentRel(entry.rel));
    if (!parentChildren) continue;
    parentChildren.push(node);
    children.set(entry.rel, node.children!);
  }
  for (const entry of ordered.filter((value) => value.kind === "note")) {
    children.get(parentRel(entry.rel))?.push({
      name: basename(entry.rel),
      rel: entry.rel,
      kind: "note",
      modifiedMs: entry.modifiedMs,
    });
  }
  sortTree(root);
  return root;
}

function sortTree(nodes: TreeNode[]): void {
  nodes.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });
  for (const node of nodes) if (node.children) sortTree(node.children);
}

function normalizeFffRel(rel: string): string {
  return rel.split(sep).join("/");
}

function parentRel(rel: string): string {
  const offset = rel.lastIndexOf("/");
  return offset === -1 ? "" : rel.slice(0, offset);
}

function pathDepthThenName(left: string, right: string): number {
  const depth = left.split("/").length - right.split("/").length;
  return depth || left.localeCompare(right, undefined, { sensitivity: "base" });
}

function compareChanges(left: VaultChange, right: VaultChange): number {
  const leftRel = left.kind === "removed" ? left.rel : left.entry.rel;
  const rightRel = right.kind === "removed" ? right.rel : right.entry.rel;
  return pathDepthThenName(leftRel, rightRel);
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function unwrap<T>(
  result: { ok: true; value: T } | { ok: false; error: string },
  context: string,
): T {
  if (result.ok) return result.value;
  throw new Error(`${context}: ${result.error}`);
}
