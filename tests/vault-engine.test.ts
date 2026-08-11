import { afterEach, describe, expect, test } from "vitest";
import {
  appendFile,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VaultEngine } from "../electron/vault-engine";

const scratchPaths: string[] = [];
const engines: VaultEngine[] = [];

afterEach(async () => {
  for (const engine of engines.splice(0)) engine.destroy();
  await Promise.all(
    scratchPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Vault Engine path policy", () => {
  test("rejects node_modules at every direct CRUD boundary", async () => {
    const { engine, root } = await setupEngine();
    await mkdir(join(root, "notes", "node_modules"), { recursive: true });
    await writeFile(join(root, "notes", "node_modules", "Invisible.md"), "hidden");

    await expect(engine.readNote("notes/node_modules/Invisible.md")).rejects.toEqual(
      expect.objectContaining({ kind: "INVALID_PATH" }),
    );
  });

  test.each([".secret", "AGENTS", "CLAUDE"])(
    "rejects hard-policy title %s before creating a file",
    async (title) => {
      const { engine, root } = await setupEngine();

      await expect(engine.createNote("", title, "content")).rejects.toEqual(
        expect.objectContaining({ kind: "INVALID_PATH" }),
      );
      await expect(readFile(join(root, `${title}.md`), "utf8")).rejects.toEqual(
        expect.objectContaining({ code: "ENOENT" }),
      );
    },
  );

  test("follows directory symlinks but rejects symlinked Note leaves", async () => {
    const { engine, root, scratch } = await setupEngine([], async (vaultRoot) => {
      const outside = join(vaultRoot, "..", "linked-notes");
      await mkdir(outside);
      await writeFile(join(outside, "Outside.md"), "outside");
      await symlink(join(outside, "Outside.md"), join(vaultRoot, "Alias.md"));
      await symlink(outside, join(vaultRoot, "ExternalFolder"));
    });

    await expect(engine.readNote("Alias.md")).rejects.toEqual(
      expect.objectContaining({ kind: "INVALID_PATH" }),
    );
    await expect(engine.readNote("ExternalFolder/Outside.md")).resolves.toBe("outside");

    const created = await engine.createNote("ExternalFolder", "Created", "created");
    expect(created.rel).toBe("ExternalFolder/Created.md");
    expect(await readFile(join(scratch, "linked-notes", "Created.md"), "utf8")).toBe("created");
    expect(await engine.resolveNotePath(created.rel)).toBe(
      await realpath(join(scratch, "linked-notes", "Created.md")),
    );
  });

  test("trashing a directory symlink removes the link, not its target", async () => {
    const { engine, root, scratch } = await setupEngine([], async (vaultRoot) => {
      const outside = join(vaultRoot, "..", "linked-notes");
      await mkdir(outside);
      await writeFile(join(outside, "Keep.md"), "keep");
      await symlink(outside, join(vaultRoot, "ExternalFolder"));
    });

    await engine.moveToTrash("ExternalFolder");

    await expect(readFile(join(root, "ExternalFolder", "Keep.md"), "utf8")).rejects.toEqual(
      expect.objectContaining({ code: "ENOENT" }),
    );
    expect(await readFile(join(scratch, "linked-notes", "Keep.md"), "utf8")).toBe("keep");
  });


  test("leaves the source unchanged when a move crosses filesystem volumes", async () => {
    const crossDevice = Object.assign(new Error("cross-device move"), { code: "EXDEV" });
    const { engine, root } = await setupEngine(
      [],
      async (vaultRoot) => {
        await mkdir(join(vaultRoot, "Source"));
        await mkdir(join(vaultRoot, "Destination"));
        await writeFile(join(vaultRoot, "Source", "Note.md"), "note");
      },
      async () => {
        throw crossDevice;
      },
    );

    await expect(engine.moveEntry("Source/Note.md", "Destination")).rejects.toEqual(
      expect.objectContaining({ kind: "CROSS_DEVICE_MOVE_UNSUPPORTED" }),
    );
    expect(await readFile(join(root, "Source", "Note.md"), "utf8")).toBe("note");
    await expect(readFile(join(root, "Destination", "Note.md"), "utf8")).rejects.toEqual(
      expect.objectContaining({ code: "ENOENT" }),
    );
  });

  test("rejects an ignored Note before creating a file", async () => {
    const { engine, root } = await setupEngine([], async (vaultRoot) => {
      await writeFile(join(vaultRoot, ".gitignore"), "Ignored.md\n");
    });

    await expect(engine.createNote("", "Ignored", "draft")).rejects.toEqual(
      expect.objectContaining({ kind: "IGNORED_PATH" }),
    );
    await expect(readFile(join(root, "Ignored.md"), "utf8")).rejects.toEqual(
      expect.objectContaining({ code: "ENOENT" }),
    );
  });

});

describe("Vault Engine desktop mutations", () => {
  test("owns daily notes, folders, entry moves, Pins, and link rewrites", async () => {
    const { engine, root } = await setupEngine([], async (vaultRoot) => {
      await mkdir(join(vaultRoot, "Projects"));
      await mkdir(join(vaultRoot, "Archive"));
      await writeFile(join(vaultRoot, "Projects", "Plan.md"), "# Plan");
      await writeFile(
        join(vaultRoot, "Source.md"),
        "[plan](Projects/Plan.md) and [[Projects/Plan]]",
      );
    });

    expect((await engine.openDailyNote("2026-08-04")).rel).toBe("2026-08-04.md");
    expect(await readFile(join(root, "2026-08-04.md"), "utf8"))
      .toBe("# 2026-08-04\n");
    expect((await engine.createFolder("Projects", "Research")).rel)
      .toBe("Projects/Research");

    await engine.pin("Projects/Plan.md");
    const renamed = await engine.renameEntry("Projects/Plan.md", "Roadmap");
    expect(renamed.rel).toBe("Projects/Roadmap.md");
    expect(await engine.listPins()).toEqual({ pins: ["Projects/Roadmap.md"], stale: [] });
    expect(await readFile(join(root, "Source.md"), "utf8"))
      .toBe("[plan](Projects/Roadmap.md) and [[Projects/Roadmap]]");

    const moved = await engine.moveEntry("Projects/Roadmap.md", "Archive");
    expect(moved.rel).toBe("Archive/Roadmap.md");
    expect(await engine.listPins()).toEqual({ pins: ["Archive/Roadmap.md"], stale: [] });
    expect(await readFile(join(root, "Source.md"), "utf8"))
      .toBe("[plan](Archive/Roadmap.md) and [[Archive/Roadmap]]");
  });

  test("persists the Electron-owned theme in the app config", async () => {
    const { engine, scratch } = await setupEngine();

    expect(engine.getTheme()).toBe("system");
    await engine.setTheme("dark");

    expect(engine.getTheme()).toBe("dark");
    expect(JSON.parse(await readFile(join(scratch, "config", "config.json"), "utf8")))
      .toEqual(expect.objectContaining({ theme: "dark" }));
  });
});

describe("Vault Engine search and backlinks", () => {
  test("ranks path hits first and validates backlink candidates as Markdown", async () => {
    const { engine } = await setupEngine([], async (root) => {
      await mkdir(join(root, "Projects"));
      await writeFile(join(root, "Projects", "Alpha.md"), "Alpha also appears here.");
      await writeFile(join(root, "README.md"), "Alpha appears only in content.");
      await writeFile(join(root, ".gitignore"), "Ignored.md\n");
      await writeFile(join(root, "Ignored.md"), "Alpha must not escape the index.");
      await writeFile(join(root, "Target.md"), "# Target");
      await writeFile(
        join(root, "Source.md"),
        [
          "Plain Target.md text is not a backlink.",
          "![preview](Target.md)",
          "```md",
          "[example](Target.md)",
          "```",
          "A real [target](Target.md#details).",
        ].join("\n"),
      );
    });

    const hits = await engine.searchNotes("alpha", 10);
    expect(hits.map((hit) => hit.rel)).toEqual([
      "Projects/Alpha.md",
      "README.md",
    ]);
    expect(hits[0]).toEqual(expect.objectContaining({ titleMatch: true }));
    expect(hits[1]).toEqual(expect.objectContaining({ titleMatch: false }));

    expect(await engine.backlinksFor("Target.md")).toEqual([
      {
        sourceRel: "Source.md",
        context: "A real target.",
        line: 6,
        occurrence: 0,
      },
    ]);
  });

  test("persists access ranking for the same canonical Vault across restarts", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "riffle-vault-frecency-"));
    scratchPaths.push(scratch);
    const root = join(scratch, "vault");
    const config = join(scratch, "config");
    await mkdir(root);
    await writeFile(join(root, "Content A.md"), "shared needle");
    await writeFile(join(root, "Content B.md"), "shared needle");
    const native = fakeNative();

    const first = new VaultEngine(config, native);
    engines.push(first);
    await first.open(root, false);
    await first.recordNoteAccess("Content B.md");
    await first.recordNoteAccess("Content B.md");
    expect((await first.searchNotes("shared needle", 2))[0]?.rel).toBe("Content B.md");
    first.destroy();

    const restarted = new VaultEngine(config, native);
    engines.push(restarted);
    await restarted.startup();
    expect((await restarted.searchNotes("shared needle", 2))[0]?.rel).toBe("Content B.md");
  });
});

describe("Vault Engine transactional open", () => {
  test("switches real native indexes without sharing a frecency environment", async () => {
    const { engine, root, scratch } = await setupEngine();
    const otherRoot = join(scratch, "other-vault");
    await mkdir(otherRoot);
    await writeFile(join(otherRoot, "Other.md"), "other");

    await expect(engine.open(otherRoot, false)).resolves.toEqual(
      expect.objectContaining({ root: await realpath(otherRoot) }),
    );
    expect(await engine.readNote("Other.md")).toBe("other");
    await expect(engine.readNote("Missing.md")).rejects.toEqual(
      expect.objectContaining({ kind: "NOT_FOUND" }),
    );
    expect(root).not.toBe(otherRoot);
  });

  test("reuses the active index when an alias resolves to the same Vault", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "riffle-vault-same-root-"));
    scratchPaths.push(scratch);
    const root = join(scratch, "vault");
    const alias = join(scratch, "alias");
    await mkdir(root);
    await symlink(root, alias);
    let stages = 0;
    const native = fakeNative({ stageAssetRoot: async () => `stage-${++stages}` });
    const engine = new VaultEngine(join(scratch, "config"), native);
    engines.push(engine);

    await engine.open(root, false);
    await engine.open(alias, false);
    expect(stages).toBe(1);
  });

  test("keeps the old native index operational when candidate commit rolls back", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "riffle-vault-rollback-"));
    scratchPaths.push(scratch);
    const root = join(scratch, "vault");
    const otherRoot = join(scratch, "other-vault");
    await mkdir(root);
    await mkdir(otherRoot);
    await writeFile(join(root, "Old.md"), "old");
    await writeFile(join(otherRoot, "New.md"), "new");
    let commits = 0;
    let rollbacks = 0;
    const native = fakeNative({
      commitAssetRoot: async () => {
        commits += 1;
        if (commits === 2) throw new Error("candidate commit failed");
      },
      rollbackAssetRoot: async () => { rollbacks += 1; },
    });
    const engine = new VaultEngine(join(scratch, "config"), native);
    engines.push(engine);
    await engine.open(root, false);

    await expect(engine.open(otherRoot, false)).rejects.toEqual(
      expect.objectContaining({ kind: "NATIVE_OPERATION_FAILED" }),
    );
    expect(rollbacks).toBe(1);
    expect(await engine.readNote("Old.md")).toBe("old");
    expect((await engine.snapshot()).root).toBe(await realpath(root));
  });
});

describe("Vault Engine Pins", () => {
  test("persists valid note and folder Pins without duplicating descendants", async () => {
    const { engine, root } = await setupEngine();
    await mkdir(join(root, "Projects"));
    await writeFile(join(root, "Root.md"), "root");
    await writeFile(join(root, "Projects", "Plan.md"), "plan");

    expect(await engine.pin("Projects/Plan.md")).toEqual({
      pins: ["Projects/Plan.md"],
      stale: [],
    });
    expect(await engine.pin("Projects")).toEqual({
      pins: ["Projects"],
      stale: [],
    });
    expect(await engine.pin("Projects/Plan.md")).toEqual({
      pins: ["Projects"],
      stale: [],
    });
    expect(JSON.parse(await readFile(join(root, ".markd", "pins.json"), "utf8")))
      .toEqual(["Projects"]);
  });

  test("reports externally removed Pin targets as stale until explicitly unpinned", async () => {
    const { engine, root } = await setupEngine();
    await writeFile(join(root, "Missing.md"), "soon gone");
    await engine.pin("Missing.md");
    await rm(join(root, "Missing.md"));

    expect(await engine.listPins()).toEqual({ pins: [], stale: ["Missing.md"] });
    expect(await engine.unpin("Missing.md")).toEqual({ pins: [], stale: [] });
  });

  test("rejects Pin requests for missing and non-Markdown targets", async () => {
    const { engine, root } = await setupEngine();
    await writeFile(join(root, "Attachment.txt"), "attachment");
    await writeFile(join(root, "Invisible.MD"), "not in the Note tree");

    await expect(engine.pin("Missing.md")).rejects.toEqual(
      expect.objectContaining({ kind: "NOT_FOUND" }),
    );
    await expect(engine.pin("Attachment.txt")).rejects.toEqual(
      expect.objectContaining({ kind: "INVALID_PATH" }),
    );
    await expect(engine.pin("Invisible.MD")).rejects.toEqual(
      expect.objectContaining({ kind: "INVALID_PATH" }),
    );
    await expect(engine.pin("")).rejects.toEqual(
      expect.objectContaining({ kind: "INVALID_PATH" }),
    );
    expect(await engine.listPins()).toEqual({ pins: [], stale: [] });
  });

  test("removes Pins beneath an entry after native Trash succeeds", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "riffle-vault-trash-"));
    scratchPaths.push(scratch);
    const root = join(scratch, "vault");
    await mkdir(root);
    const engine = new VaultEngine(join(scratch, "config"), {
      moveToTrash: async (_root, path) => rm(path, { recursive: true }),
      stageAssetRoot: async () => "stage",
      commitAssetRoot: async () => undefined,
      rollbackAssetRoot: async () => undefined,
      saveExport: async () => null,
    });
    await engine.open(root, false);
    await mkdir(join(root, "Projects"));
    await writeFile(join(root, "Projects", "Plan.md"), "plan");
    await engine.pin("Projects");

    await engine.moveToTrash("Projects");

    expect(await engine.listPins()).toEqual({ pins: [], stale: [] });
  });

  test("resolves the canonical full path from a symlinked Vault root", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "riffle-vault-alias-"));
    scratchPaths.push(scratch);
    const root = join(scratch, "real-vault");
    const alias = join(scratch, "vault-alias");
    await mkdir(root);
    await writeFile(join(root, "Note.md"), "note");
    await symlink(root, alias);
    const engine = new VaultEngine(join(scratch, "config"), {
      moveToTrash: async () => undefined,
      stageAssetRoot: async () => "stage",
      commitAssetRoot: async () => undefined,
      rollbackAssetRoot: async () => undefined,
      saveExport: async () => null,
    });
    await engine.open(alias, false);

    expect(await engine.resolveNotePath("Note.md")).toBe(
      join(await realpath(root), "Note.md"),
    );
  });
});

describe("Vault Engine Quick Capture", () => {
  test("creates a Note and appends Markdown with one line boundary", async () => {
    const { engine, root } = await setupEngine();

    const created = await engine.captureCreate("Inbox", "first thought");
    expect(created.rel).toBe("Inbox.md");
    expect(await readFile(join(root, created.rel), "utf8")).toBe("first thought");

    const appended = await engine.captureAppend(created.rel, "second thought");
    expect(appended.rel).toBe("Inbox.md");
    expect(await readFile(join(root, created.rel), "utf8")).toBe(
      "first thought\nsecond thought",
    );
  });

  test("rejects append without an active Vault or a non-Note target", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "riffle-capture-unavailable-"));
    scratchPaths.push(scratch);
    const engine = new VaultEngine(join(scratch, "config"), async () => {});

    await expect(engine.captureAppend("Inbox.md", "thought")).rejects.toEqual(
      expect.objectContaining({ kind: "NO_ACTIVE_VAULT" }),
    );
  });

  test("rejects blank append content at the Engine boundary", async () => {
    const { engine } = await setupEngine();
    await engine.captureCreate("Inbox", "base");

    await expect(engine.captureAppend("Inbox.md", " \n ")).rejects.toEqual(
      expect.objectContaining({ kind: "INVALID_CAPTURE" }),
    );
  });

  test("merges a semantic append into an editor write based on the prior content", async () => {
    const { engine, root } = await setupEngine();
    await engine.captureCreate("Inbox", "base");
    await engine.captureAppend("Inbox.md", "captured");

    await expect(
      engine.writeNote("Inbox.md", "edited", "base"),
    ).resolves.toBe("edited\ncaptured");
    expect(await readFile(join(root, "Inbox.md"), "utf8")).toBe(
      "edited\ncaptured",
    );
  });

  test("merges consecutive capture appends with their exact newline boundaries", async () => {
    const { engine, root } = await setupEngine();
    await engine.captureCreate("Inbox", "base\n");
    await engine.captureAppend("Inbox.md", "first capture");
    await engine.captureAppend("Inbox.md", "second capture");

    await expect(
      engine.writeNote("Inbox.md", "edited\n", "base\n"),
    ).resolves.toBe("edited\nfirst capture\nsecond capture");
    expect(await readFile(join(root, "Inbox.md"), "utf8")).toBe(
      "edited\nfirst capture\nsecond capture",
    );
  });

  test("replays only captures after an editor-observed checkpoint", async () => {
    const { engine, root } = await setupEngine();
    await engine.captureCreate("Inbox", "base");
    await engine.captureAppend("Inbox.md", "first capture");
    await engine.captureAppend("Inbox.md", "second capture");

    await expect(
      engine.writeNote(
        "Inbox.md",
        "edited\nfirst capture",
        "base\nfirst capture",
      ),
    ).resolves.toBe("edited\nfirst capture\nsecond capture");
    expect(await readFile(join(root, "Inbox.md"), "utf8")).toBe(
      "edited\nfirst capture\nsecond capture",
    );
  });

  test("merges a proven capture from an empty Note", async () => {
    const { engine, root } = await setupEngine();
    await engine.captureCreate("Inbox", "");
    await engine.captureAppend("Inbox.md", "captured");

    await expect(engine.writeNote("Inbox.md", "edited", "")).resolves.toBe(
      "edited\ncaptured",
    );
    expect(await readFile(join(root, "Inbox.md"), "utf8")).toBe(
      "edited\ncaptured",
    );
  });

  test("rejects ordinary prefix appends, including from an empty expected value", async () => {
    const { engine, root } = await setupEngine();
    await engine.captureCreate("Inbox", "base");
    await appendFile(join(root, "Inbox.md"), "\nexternal append");
    await expect(
      engine.writeNote("Inbox.md", "edited", "base"),
    ).rejects.toEqual(expect.objectContaining({ kind: "STALE_NOTE_WRITE" }));

    await engine.captureCreate("Empty", "");
    await writeFile(join(root, "Empty.md"), "external content");
    await expect(
      engine.writeNote("Empty.md", "edited", ""),
    ).rejects.toEqual(expect.objectContaining({ kind: "STALE_NOTE_WRITE" }));
  });

  test("rejects a capture merge after a later external edit", async () => {
    const { engine, root } = await setupEngine();
    await engine.captureCreate("Inbox", "base");
    await engine.captureAppend("Inbox.md", "captured");
    await appendFile(join(root, "Inbox.md"), "\nexternal edit");

    await expect(
      engine.writeNote("Inbox.md", "edited", "base"),
    ).rejects.toEqual(expect.objectContaining({ kind: "STALE_NOTE_WRITE" }));
    expect(await readFile(join(root, "Inbox.md"), "utf8")).toBe(
      "base\ncaptured\nexternal edit",
    );
  });

  test("rejects provenance after the captured Note is renamed and replaced", async () => {
    const { engine, root } = await setupEngine();
    await engine.captureCreate("Inbox", "base");
    await engine.captureAppend("Inbox.md", "captured");
    await rename(join(root, "Inbox.md"), join(root, "Archived.md"));
    await writeFile(join(root, "Inbox.md"), "base\ncaptured");

    await expect(
      engine.writeNote("Inbox.md", "edited", "base"),
    ).rejects.toEqual(expect.objectContaining({ kind: "STALE_NOTE_WRITE" }));
  });

  test("invalidates capture provenance after a non-capture write", async () => {
    const { engine, root } = await setupEngine();
    await engine.captureCreate("Inbox", "base");
    await engine.captureAppend("Inbox.md", "captured");
    await engine.writeNote("Inbox.md", "replacement", "base\ncaptured");

    // Recreating the old bytes must not resurrect the proof consumed above.
    await writeFile(join(root, "Inbox.md"), "base\ncaptured");
    await expect(
      engine.writeNote("Inbox.md", "edited", "base"),
    ).rejects.toEqual(expect.objectContaining({ kind: "STALE_NOTE_WRITE" }));
  });

  test("invalidates capture provenance after Trash and Vault switches", async () => {
    const { engine, root, scratch } = await setupEngine();
    await engine.captureCreate("Inbox", "base");
    await engine.captureAppend("Inbox.md", "captured");
    await engine.moveToTrash("Inbox.md");
    await writeFile(join(root, "Inbox.md"), "base\ncaptured");
    await expect(
      engine.writeNote("Inbox.md", "edited", "base"),
    ).rejects.toEqual(expect.objectContaining({ kind: "STALE_NOTE_WRITE" }));

    // A matching relative path and byte sequence in another Vault is a
    // different Note and cannot inherit append provenance from the first.
    await engine.captureAppend("Inbox.md", "new capture");
    const otherRoot = join(scratch, "other-vault");
    await mkdir(otherRoot);
    await writeFile(join(otherRoot, "Inbox.md"), "base\ncaptured\nnew capture");
    await engine.open(otherRoot, false);
    await expect(
      engine.writeNote("Inbox.md", "edited", "base\ncaptured"),
    ).rejects.toEqual(expect.objectContaining({ kind: "STALE_NOTE_WRITE" }));

    expect(await readFile(join(root, "Inbox.md"), "utf8")).toBe(
      "base\ncaptured\nnew capture",
    );
  });

  test("rejects a stale editor write after a non-append external change", async () => {
    const { engine, root } = await setupEngine();
    await engine.captureCreate("Inbox", "base");
    await writeFile(join(root, "Inbox.md"), "rewritten elsewhere");

    await expect(
      engine.writeNote("Inbox.md", "edited", "base"),
    ).rejects.toEqual(expect.objectContaining({ kind: "STALE_NOTE_WRITE" }));
    expect(await readFile(join(root, "Inbox.md"), "utf8")).toBe(
      "rewritten elsewhere",
    );
  });
});

async function setupEngine(
  trashCalls: string[] = [],
  beforeOpen: (root: string) => Promise<void> = async () => {},
  renamePath?: NonNullable<ConstructorParameters<typeof VaultEngine>[5]>,
) {
  const scratch = await mkdtemp(join(tmpdir(), "riffle-vault-engine-"));
  scratchPaths.push(scratch);
  const root = join(scratch, "vault");
  const config = join(scratch, "config");
  await mkdir(root);
  await beforeOpen(root);
  const engine = new VaultEngine(
    config,
    {
      moveToTrash: async (_vaultRoot, path) => {
        trashCalls.push(path);
        await rm(path, { recursive: true });
      },
      stageAssetRoot: async () => "stage",
      commitAssetRoot: async () => undefined,
      rollbackAssetRoot: async () => undefined,
      saveExport: async () => null,
    },
    undefined,
    undefined,
    undefined,
    renamePath,
  );
  engines.push(engine);
  await engine.open(root, false);
  return { engine, root, scratch };
}


function fakeNative(
  overrides: Partial<ConstructorParameters<typeof VaultEngine>[1]> = {},
): ConstructorParameters<typeof VaultEngine>[1] {
  return {
    moveToTrash: async (_root, path) => rm(path, { recursive: true }),
    stageAssetRoot: async () => "stage",
    commitAssetRoot: async () => undefined,
    rollbackAssetRoot: async () => undefined,
    saveExport: async () => null,
    ...overrides,
  };
}
