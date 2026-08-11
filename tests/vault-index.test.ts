import { afterEach, describe, expect, test } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { RIFFLE_IGNORE_BLOCK } from "../electron/managed-ignore";
import { VaultIndex, type VaultIndexEvent } from "../electron/vault-index";
import type { TreeNode } from "../src/lib/types";
import type { FileFinderApi, WatchEvent } from "@celados/fff-node";

const execFileAsync = promisify(execFile);
const scratchPaths: string[] = [];
const indexes: VaultIndex[] = [];
// Real fff watchers can pay a cold-start penalty on the shared runner. Keep the
// outer budget above waitUntil's 10s diagnostic window so its contextual error
// wins instead of Vitest's generic 5s timeout.
const VAULT_INDEX_TEST_TIMEOUT_MS = 15_000;

afterEach(async () => {
  for (const index of indexes.splice(0)) index.destroy();
  await Promise.all(
    scratchPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("fff-backed Vault Index", { timeout: VAULT_INDEX_TEST_TIMEOUT_MS }, () => {
  test("projects accepted Note search candidates without leaking fff result types", async () => {
    const scratch = await createScratch();
    const root = join(scratch, "vault");
    await mkdir(root);
    const accessed: string[] = [];
    const finder = fakeFinder(["Projects/Alpha.md", "README.md"], () => {});
    finder.fileSearch = () => ({
      ok: true,
      value: {
        items: [
          fakeFileItem("Projects/Alpha.md", 80),
          fakeFileItem("Ignored.md", 100),
        ],
        scores: [],
        totalMatched: 2,
        totalFiles: 3,
      },
    });
    finder.grep = () => ({
      ok: true,
      value: fakeGrepResult([
        fakeGrepMatch("README.md", "Alpha appears in content", 60),
        fakeGrepMatch("Projects/Alpha.md", "duplicate content match", 90),
        fakeGrepMatch("Ignored.md", "ignored content", 100),
      ]),
    });
    finder.trackAccess = (rel) => {
      accessed.push(rel);
      return { ok: true, value: undefined };
    };
    const index = await VaultIndex.open(root, "system", {
      createFinder: () => ({ ok: true, value: finder }),
    });
    indexes.push(index);

    expect(index.searchNotes("alpha", 10)).toEqual([
      {
        rel: "Projects/Alpha.md",
        title: "Alpha",
        snippet: "duplicate content match",
        titleMatch: true,
      },
      {
        rel: "README.md",
        title: "README",
        snippet: "Alpha appears in content",
        titleMatch: false,
      },
    ]);
    expect(index.recordAccess("Projects/Alpha.md")).toBeUndefined();
    expect(accessed).toEqual(["Projects/Alpha.md"]);
  });

  test("narrows backlink candidates to deduplicated accepted Notes", async () => {
    const scratch = await createScratch();
    const root = join(scratch, "vault");
    await mkdir(root);
    const patterns: string[][] = [];
    const finder = fakeFinder(["Source.md", "Other.md"], () => {});
    finder.multiGrep = (options) => {
      patterns.push(options.patterns);
      return {
        ok: true,
        value: fakeGrepResult([
          fakeGrepMatch("Source.md", "[target](Projects/Target%20Note.md)", 0),
          fakeGrepMatch("Source.md", "Projects/Target Note.md plain text", 0),
          fakeGrepMatch("Ignored.md", "[[Target Note]]", 0),
          fakeGrepMatch("Other.md", "[[Target Note]]", 0),
        ]),
      };
    };
    const index = await VaultIndex.open(root, "system", {
      createFinder: () => ({ ok: true, value: finder }),
    });
    indexes.push(index);

    expect(index.backlinkCandidates("Projects/Target Note.md")).toEqual([
      "Source.md",
      "Other.md",
    ]);
    expect(patterns[0]).toEqual(expect.arrayContaining([
      "projects/target note.md",
      "projects/target%20note.md",
      "projects/target%20note",
      "target note",
    ]));
  });

  test("native candidate narrowing is a conservative superset of link parsing", async () => {
    const scratch = await createScratch();
    const root = join(scratch, "vault");
    await mkdir(join(root, "Projects"), { recursive: true });
    await writeFile(join(root, "Target.md"), "# Target");
    await writeFile(join(root, "Projects", "Target Note.md"), "# Target Note");
    await writeFile(join(root, "Case.md"), "[lowercase](target.md)");
    await writeFile(join(root, "Encoded Letter.md"), "[letter](%54arget.md)");
    await writeFile(
      join(root, "Encoded.md"),
      "[extensionless](Projects/Target%20Note)",
    );
    await writeFile(
      join(root, "Encoded Separator.md"),
      "[encoded separator](Projects%2FTarget%20Note)",
    );

    const index = await VaultIndex.open(root, "system");
    indexes.push(index);

    expect(index.backlinkCandidates("Target.md")).toEqual(
      expect.arrayContaining(["Case.md", "Encoded Letter.md"]),
    );
    expect(index.backlinkCandidates("Projects/Target Note.md")).toEqual(
      expect.arrayContaining(["Encoded.md", "Encoded Separator.md"]),
    );
  });
  test("combines Vault ignore layers and enforces the hard policy", async () => {
    const scratch = await createScratch();
    const root = join(scratch, "vault");
    const globalIgnore = join(scratch, "global-ignore");
    await mkdir(join(root, "projects"), { recursive: true });
    await execFileAsync("git", ["init", "--quiet", root]);
    await mkdir(join(root, ".git", "info"), { recursive: true });
    await writeFile(globalIgnore, "global.md\n");
    await execFileAsync("git", ["-C", root, "config", "core.excludesFile", globalIgnore]);
    await writeFile(join(root, ".git", "info", "exclude"), "info.md\n");
    await writeFile(
      join(root, ".gitignore"),
      "root.md\nprojects/*.md\n!projects/keep.md\n!node_modules/package/leak.md\n",
    );
    await writeFile(join(root, "projects", ".gitignore"), "nested.md\n");
    await writeFile(join(root, "projects", ".ignore"), "local.md\n");
    await writeFile(join(root, ".ignore"), "user.md\n!node_modules/package/leak.md\n");
    for (const rel of [
      "Visible.md",
      "global.md",
      "info.md",
      "root.md",
      "user.md",
      "projects/keep.md",
      "projects/drop.md",
      "projects/nested.md",
      "projects/local.md",
      ".hidden.md",
      "AGENTS.md",
      "dist/output.md",
      "node_modules/package/leak.md",
    ]) {
      await mkdir(join(root, rel, ".."), { recursive: true });
      await writeFile(join(root, rel), rel);
    }

    const index = await VaultIndex.open(root, "system");
    indexes.push(index);
    expect(await flatten(index.snapshot().then((snapshot) => snapshot.tree))).toEqual([
      "projects/",
      "projects/keep.md",
      "Visible.md",
    ]);

    expect(await readFile(join(root, ".ignore"), "utf8")).toBe(
      `user.md\n!node_modules/package/leak.md\n${RIFFLE_IGNORE_BLOCK}\n`,
    );
  });

  test("applies core.excludesFile and info excludes before indexing", async () => {
    const scratch = await createScratch();
    const root = join(scratch, "vault");
    const globalIgnore = join(scratch, "global-ignore");
    await mkdir(root);
    await execFileAsync("git", ["init", "--quiet", root]);
    await mkdir(join(root, ".git", "info"), { recursive: true });
    await writeFile(globalIgnore, "global.md\n");
    await execFileAsync("git", ["-C", root, "config", "core.excludesFile", globalIgnore]);
    await writeFile(join(root, ".git", "info", "exclude"), "info.md\n");
    await writeFile(join(root, "global.md"), "global");
    await writeFile(join(root, "info.md"), "info");

    const index = await VaultIndex.open(root, "system");
    indexes.push(index);
    expect(await flatten(index.snapshot().then((snapshot) => snapshot.tree))).toEqual([]);
  });

  test("follows directory symlinks while excluding symlinked file leaves", async () => {
    const scratch = await createScratch();
    const root = join(scratch, "vault");
    const outside = join(scratch, "outside");
    await mkdir(root);
    await mkdir(outside);
    await writeFile(join(outside, "Outside.md"), "outside");
    await symlink(join(outside, "Outside.md"), join(root, "Alias.md"));
    await symlink(outside, join(root, "AliasFolder"));

    const index = await VaultIndex.open(root, "system");
    indexes.push(index);
    expect(await flatten(index.snapshot().then((snapshot) => snapshot.tree))).toEqual([
      "AliasFolder/",
      "AliasFolder/Outside.md",
    ]);
  });

  test("copies every resident entry without a pagination boundary", async () => {
    const scratch = await createScratch();
    const root = join(scratch, "vault");
    await mkdir(root);
    const indexed = Array.from({ length: 4_257 }, (_, index) => `Note ${index}.md`);
    const index = await VaultIndex.open(root, "system", {
      createFinder: () => ({
        ok: true,
        value: fakeFinder(indexed, () => {}),
      }),
    });
    indexes.push(index);

    expect(await flatten(index.snapshot().then((snapshot) => snapshot.tree)))
      .toHaveLength(indexed.length);
  });

  test("preserves directory re-inclusion across nested negation", async () => {
    const scratch = await createScratch();
    const root = join(scratch, "vault");
    await mkdir(join(root, ".git"), { recursive: true });
    await mkdir(join(root, "sub1", "sub2"), { recursive: true });
    await writeFile(join(root, ".gitignore"), "*\n!*.*\n!/**/\n");
    await writeFile(join(root, "top.md"), "top");
    await writeFile(join(root, "sub1", "mid.md"), "mid");
    await writeFile(join(root, "sub1", "sub2", "deep.md"), "deep");

    const index = await VaultIndex.open(root, "system");
    indexes.push(index);
    expect(await flatten(index.snapshot().then((snapshot) => snapshot.tree))).toEqual([
      "sub1/",
      "sub1/sub2/",
      "sub1/sub2/deep.md",
      "sub1/mid.md",
      "top.md",
    ]);
  });

  test("emits changes and an epoch-replacing snapshot after ignore drift", async () => {
    const scratch = await createScratch();
    const root = join(scratch, "vault");
    await mkdir(root);
    await writeFile(join(root, "Initial.md"), "initial");
    const events: VaultIndexEvent[] = [];
    const index = await VaultIndex.open(root, "system", {
      listener: (event) => events.push(event),
    });
    indexes.push(index);
    expect(events).toEqual([
      expect.objectContaining({ kind: "replacement", indexEpoch: 1, sequence: 0 }),
    ]);

    await writeFile(join(root, "External.md"), "external");
    await waitUntil(() => events.some(
      (event) => event.kind === "changes" &&
        event.changes.some((change) =>
          change.kind !== "removed" && change.entry.rel === "External.md"
        ),
    ));

    const previousReplacementEpoch = Math.max(...events
      .filter((event) => event.kind === "replacement")
      .map((event) => event.indexEpoch));
    await writeFile(join(root, "Later.md"), "later");
    await writeFile(join(root, ".ignore"), "Later.md\n");
    await waitUntil(() => events.some(
      (event) => event.kind === "replacement" &&
        event.indexEpoch > previousReplacementEpoch,
    ));
    const snapshot = await index.snapshot();
    expect(await flatten(Promise.resolve(snapshot.tree))).toEqual([
      "External.md",
      "Initial.md",
    ]);
    expect(await readFile(join(root, ".ignore"), "utf8")).toBe(
      `Later.md\n${RIFFLE_IGNORE_BLOCK}\n`,
    );
  });

  test("starts a fresh sequence after synchronizing a late consumer", async () => {
    const scratch = await createScratch();
    const root = join(scratch, "vault");
    await mkdir(root);
    const events: VaultIndexEvent[] = [];
    const index = await VaultIndex.open(root, "system", {
      listener: (event) => events.push(event),
    });
    indexes.push(index);
    await writeFile(join(root, "Before Sync.md"), "before");
    await waitUntil(() => events.some(
      (event) => event.kind === "changes" && event.sequence === 1,
    ));

    const synchronized = index.synchronize();
    expect(synchronized).toEqual(expect.objectContaining({
      kind: "replacement",
      sequence: 0,
    }));
    await writeFile(join(root, "After Sync.md"), "after");
    await waitUntil(() => events.some(
      (event) => event.kind === "changes" &&
        event.indexEpoch === synchronized.indexEpoch && event.sequence === 1,
    ));
  });

  test("emits accepted folder changes without exposing unrelated files", async () => {
    const scratch = await createScratch();
    const root = join(scratch, "vault");
    await mkdir(root);
    const events: VaultIndexEvent[] = [];
    const index = await VaultIndex.open(root, "system", {
      listener: (event) => events.push(event),
    });
    indexes.push(index);

    await mkdir(join(root, "Folder"));
    await writeFile(join(root, "Folder", "Note.md"), "note");
    await waitUntil(() => events.some(
      (event) => eventHasEntry(event, "Folder"),
    ), "folder creation");
    await writeFile(join(root, "Attachment.txt"), "not a Note");
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(events.some(
      (event) => event.kind === "changes" &&
        event.changes.some((change) =>
          change.kind !== "removed" && change.entry.rel === "Attachment.txt"
        ),
    )).toBe(false);

    const beforeRemoval = events.length;
    await rm(join(root, "Folder"), { recursive: true });
    await waitUntil(() => events.slice(beforeRemoval).some(
      (event) => eventLacksEntryAfterRemoval(event, "Folder"),
    ), "folder removal");
  }, 15_000);

  test("indexes durable empty folders initially and through live changes", async () => {
    const scratch = await createScratch();
    const root = join(scratch, "vault");
    await mkdir(join(root, "Existing Empty"), { recursive: true });
    const events: VaultIndexEvent[] = [];
    const index = await VaultIndex.open(root, "system", {
      listener: (event) => events.push(event),
    });
    indexes.push(index);
    expect(await flatten(index.snapshot().then((snapshot) => snapshot.tree))).toEqual([
      "Existing Empty/",
    ]);

    await mkdir(join(root, "Live Empty"));
    await waitUntil(() => events.some((event) => eventHasEntry(event, "Live Empty")),
      "empty folder creation");
    const beforeRemoval = events.length;
    await rm(join(root, "Live Empty"), { recursive: true });
    await waitUntil(() => events.slice(beforeRemoval).some(
      (event) => eventLacksEntryAfterRemoval(event, "Live Empty"),
    ), "empty folder removal");
  }, 15_000);

  test("fails explicitly when the managed markers are corrupt", async () => {
    const scratch = await createScratch();
    const root = join(scratch, "vault");
    await mkdir(root);
    await writeFile(join(root, ".ignore"), "# BEGIN RIFFLE MANAGED IGNORE\n");

    await expect(VaultIndex.open(root, "system")).rejects.toThrowError(
      /managed ignore markers/i,
    );
  });

  test("escalates asynchronous index failures instead of serving stale state", async () => {
    const scratch = await createScratch();
    const root = join(scratch, "vault");
    await mkdir(root);
    const failures: Error[] = [];
    const index = await VaultIndex.open(root, "system", {
      listener: (event) => {
        if (event.kind === "changes") throw new Error("consumer rejected change");
      },
      onFatal: (error) => failures.push(error),
    });
    indexes.push(index);

    await writeFile(join(root, "Fatal.md"), "fatal");
    await waitUntil(() => failures.length === 1, "fatal escalation");
    expect(failures[0]).toEqual(expect.objectContaining({
      message: "consumer rejected change",
    }));
  });

  test("makes an explicit rescan failure fatal", async () => {
    const scratch = await createScratch();
    const root = join(scratch, "vault");
    await mkdir(root);
    const failures: Error[] = [];
    const index = await VaultIndex.open(root, "system", {
      onFatal: (error) => failures.push(error),
    });
    indexes.push(index);
    await rm(root, { recursive: true });

    await expect(index.rescan()).rejects.toBeInstanceOf(Error);
    expect(failures).toHaveLength(1);
  });

  test("uses one queued rescan as the mutation consistency barrier", async () => {
    const scratch = await createScratch();
    const root = join(scratch, "vault");
    await mkdir(root);
    const indexed: string[] = [];
    const finder = fakeFinder(indexed, () => {});
    finder.scanFiles = () => {
      indexed.push("Late.md");
      return { ok: true, value: undefined };
    };
    const index = await VaultIndex.open(root, "system", {
      createFinder: () => ({ ok: true, value: finder }),
      entryTimeoutMs: 1,
    });
    indexes.push(index);

    await expect(index.ensureCreated("Late.md")).resolves.toBeUndefined();
    expect(await flatten(index.snapshot().then((snapshot) => snapshot.tree)))
      .toContain("Late.md");
  });

  test("accepts policy drift but makes an accepted missing entry fatal", async () => {
    const scratch = await createScratch();
    const root = join(scratch, "vault");
    await mkdir(root);
    let accepted = false;
    const failures: Error[] = [];
    const finder = fakeFinder([], () => {});
    finder.acceptsPath = () => ({ ok: true, value: accepted });
    const index = await VaultIndex.open(root, "system", {
      createFinder: () => ({ ok: true, value: finder }),
      entryTimeoutMs: 1,
      onFatal: (error) => failures.push(error),
    });
    indexes.push(index);

    await expect(index.ensureCreated("Now Ignored.md")).resolves.toBeUndefined();
    accepted = true;
    await expect(index.ensureCreated("Still Accepted.md")).rejects.toEqual(
      expect.objectContaining({ message: expect.stringContaining("remained inconsistent") }),
    );
    expect(failures).toHaveLength(1);
    await expect(index.rescan()).rejects.toBe(failures[0]);
  });

  test("interrupts a mutation wait when the index becomes terminal", async () => {
    const scratch = await createScratch();
    const root = join(scratch, "vault");
    await mkdir(root);
    const finder = fakeFinder([], () => {});
    const failure = new Error("native rescan failed");
    finder.scanFiles = () => ({ ok: false, error: failure.message });
    const index = await VaultIndex.open(root, "system", {
      createFinder: () => ({ ok: true, value: finder }),
      entryTimeoutMs: 1_000,
    });
    indexes.push(index);

    const waiting = index.ensureCreated("Waiting.md");
    await expect(index.rescan()).rejects.toEqual(
      expect.objectContaining({ message: expect.stringContaining(failure.message) }),
    );
    await expect(waiting).rejects.toEqual(
      expect.objectContaining({ message: expect.stringContaining(failure.message) }),
    );
  });

  test("serializes explicit rescan behind an in-flight watch batch", async () => {
    const scratch = await createScratch();
    const root = join(scratch, "vault");
    await mkdir(root);
    let indexed = ["Block.md"];
    let watch: ((events: WatchEvent[]) => void) | null = null;
    const statStarted = deferred<void>();
    const releaseStat = deferred<void>();
    const events: VaultIndexEvent[] = [];
    const finder = {
      waitForScan: async () => ({ ok: true, value: true }),
      getScanProgress: () => ({
        ok: true,
        value: { isScanning: false, isWatcherReady: true },
      }),
      watch: (listener: (events: WatchEvent[]) => void) => {
        watch = listener;
        return { ok: true, value: () => {} };
      },
      residentEntries: () => ({
        ok: true,
        value: indexed.map((rel) => fakeResidentFile(rel)),
      }),
      acceptsPath: () => ({ ok: true, value: true }),
      scanFiles: () => ({ ok: true, value: undefined }),
      destroy: () => {},
    } as unknown as FileFinderApi;
    const index = await VaultIndex.open(root, "system", {
      createFinder: () => ({ ok: true, value: finder }),
      listener: (event) => events.push(event),
      statPath: async () => {
        statStarted.resolve();
        await releaseStat.promise;
        return {
          isDirectory: () => false,
          isSymbolicLink: () => false,
          mtimeMs: 2,
        };
      },
    });
    indexes.push(index);

    indexed = ["Block.md", "Rebuilt.md"];
    watch!([
      { kind: "modified", path: join(root, "Block.md") },
      { kind: "removed", path: join(root, "Rebuilt.md") },
    ]);
    await statStarted.promise;
    const rescanned = index.rescan();
    releaseStat.resolve();
    await rescanned;

    expect(await flatten(index.snapshot().then((snapshot) => snapshot.tree))).toEqual([
      "Block.md",
      "Rebuilt.md",
    ]);
    expect(events.at(-1)).toEqual(expect.objectContaining({ kind: "replacement" }));
  });

  test("reconciles kind transitions and nested folder ancestors", async () => {
    const scratch = await createScratch();
    const root = join(scratch, "vault");
    await mkdir(root);
    let watch: ((events: WatchEvent[]) => void) | null = null;
    const events: VaultIndexEvent[] = [];
    const finder = fakeFinder(
      ["Folder.md/Child.md", "Plain/Child.md"],
      (listener) => { watch = listener; },
    );
    const modes = new Map([
      ["Folder.md", "file"],
      ["Plain", "file"],
      ["a/b", "directory"],
      ["Alias.md", "symlink"],
    ]);
    const index = await VaultIndex.open(root, "system", {
      createFinder: () => ({ ok: true, value: finder }),
      listener: (event) => events.push(event),
      statPath: async (path) => ({
        isDirectory: () => modes.get(relative(root, path).split(sep).join("/")) === "directory",
        isSymbolicLink: () => modes.get(relative(root, path).split(sep).join("/")) === "symlink",
        mtimeMs: 2,
      }),
    });
    indexes.push(index);

    watch!([{ kind: "modified", path: join(root, "Folder.md") }]);
    await waitUntil(async () => {
      const paths = await flatten(index.snapshot().then((snapshot) => snapshot.tree));
      return paths.includes("Folder.md") && !paths.includes("Folder.md/Child.md");
    }, "folder-to-note transition");
    watch!([{ kind: "modified", path: join(root, "Plain") }]);
    await waitUntil(async () => {
      const paths = await flatten(index.snapshot().then((snapshot) => snapshot.tree));
      return !paths.some((path) => path === "Plain/" || path.startsWith("Plain/"));
    }, "folder-to-non-note transition");
    watch!([{ kind: "created", path: join(root, "a", "b") }]);
    await waitUntil(async () => {
      const paths = await flatten(index.snapshot().then((snapshot) => snapshot.tree));
      return paths.includes("a/") && paths.includes("a/b/");
    }, "nested folder ancestors");
    watch!([{ kind: "created", path: join(root, "Alias.md") }]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await flatten(index.snapshot().then((snapshot) => snapshot.tree)))
      .not.toContain("Alias.md");
  });
});

async function createScratch(): Promise<string> {
  const scratch = await mkdtemp(join(tmpdir(), "riffle-vault-index-"));
  scratchPaths.push(scratch);
  return scratch;
}

async function flatten(treePromise: Promise<TreeNode[]>): Promise<string[]> {
  const tree = await treePromise;
  const paths: string[] = [];
  const visit = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      paths.push(node.kind === "folder" ? `${node.rel}/` : node.rel);
      if (node.children) visit(node.children);
    }
  };
  visit(tree);
  return paths;
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  context = "Vault Index event",
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${context}.`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fakeResidentFile(relativePath: string) {
  return { type: "file" as const, relativePath, modified: 1 };
}

function fakeFileItem(relativePath: string, totalFrecencyScore: number) {
  return {
    relativePath,
    fileName: relativePath.split("/").at(-1) ?? relativePath,
    size: 1,
    modified: 1,
    accessFrecencyScore: totalFrecencyScore,
    modificationFrecencyScore: 0,
    totalFrecencyScore,
    gitStatus: "clean",
  };
}

function fakeGrepMatch(
  relativePath: string,
  lineContent: string,
  totalFrecencyScore: number,
) {
  return {
    ...fakeFileItem(relativePath, totalFrecencyScore),
    isBinary: false,
    lineNumber: 1,
    col: 0,
    byteOffset: 0,
    lineContent,
    matchRanges: [[0, 5]] as [number, number][],
  };
}

function fakeGrepResult(items: ReturnType<typeof fakeGrepMatch>[]) {
  return {
    items,
    totalMatched: items.length,
    totalFilesSearched: items.length,
    totalFiles: items.length,
    filteredFileCount: items.length,
    nextCursor: null,
  };
}

function fakeFinder(
  indexed: string[],
  setWatch: (listener: (events: WatchEvent[]) => void) => void,
): FileFinderApi {
  return {
    waitForScan: async () => ({ ok: true, value: true }),
    getScanProgress: () => ({
      ok: true,
      value: { isScanning: false, isWatcherReady: true },
    }),
    watch: (listener: (events: WatchEvent[]) => void) => {
      setWatch(listener);
      return { ok: true, value: () => {} };
    },
    residentEntries: () => ({
      ok: true,
      value: indexed.map((rel) => fakeResidentFile(rel)),
    }),
    acceptsPath: () => ({ ok: true, value: true }),
    scanFiles: () => ({ ok: true, value: undefined }),
    destroy: () => {},
  } as unknown as FileFinderApi;
}

function eventHasEntry(event: VaultIndexEvent, rel: string): boolean {
  if (event.kind === "changes") {
    return event.changes.some(
      (change) => change.kind !== "removed" && change.entry.rel === rel,
    );
  }
  return treeHasRel(event.snapshot.tree, rel);
}

function eventLacksEntryAfterRemoval(event: VaultIndexEvent, rel: string): boolean {
  if (event.kind === "changes") {
    return event.changes.some((change) => change.kind === "removed" && change.rel === rel);
  }
  return !treeHasRel(event.snapshot.tree, rel);
}

function treeHasRel(nodes: TreeNode[], rel: string): boolean {
  return nodes.some((node) =>
    node.rel === rel || (node.children ? treeHasRel(node.children, rel) : false)
  );
}
