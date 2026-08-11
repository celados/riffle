---
type: Proposal
title: Riffle Electron-native desktop architecture
description: >
  用 Electron 原生进程模型替换 Tauri 基座，以隔离的 Vault Engine、fff 驱动的 Vault Index、
  @pierre/trees 文件树和窄 preload interface 重构 Riffle，而不是逐项翻译旧 Tauri commands。
status: accepted # draft | accepted | superseded
version: 0.5
implemented: 2026-08-04
generated: { by: codex/gpt-5.6, at: 2026-08-11T16:00:00+08:00 }
supersedes: ./port-plan.md#objective-and-boundary
tags: [riffle, electron, architecture, migration, fff, octane, reliability]
---

# Decision

> Implementation status: complete. This accepted proposal is the historical decision record; `AGENTS.md`,
> `electron/`, and the executable tests are the current implementation truth.

Riffle 将从 Tauri 2 完全迁移到 Electron。迁移采用 Electron-native 架构，不把 56 个 Tauri
command 机械翻译成 56 个 Electron IPC handler，也不长期维护 Tauri/Electron 双基座。

本 proposal 取代 [`port-plan.md`](./port-plan.md) 中“保留 Tauri/Rust backend”的架构边界；该文档
仍然是已经完成的 Octane/TSRX 迁移历史。Octane renderer、Vault 文件合同、编辑器生命周期和现有
用户行为继续保留。

目标技术选择已经接受：

- Electron 负责桌面 shell 和原生 OS integration；
- Vite 8 + `vite-plugin-electron` 负责 renderer、main 和 preload 的开发构建；
- `electron-builder` + `electron-updater` 负责打包和更新；
- Vault Engine 在 Electron `utilityProcess` 中运行，不在 main 或 renderer 执行重型文件工作；
- fff 是 Vault Index 的首选实现，并同时拥有 scan、search 和 watch；
- `@pierre/trees` Vanilla runtime 替换当前自维护 FileTree；
- Tauri、Rust sidecar、N-API compatibility layer 和双 watcher 均不进入目标架构。

# Objective

迁移完成后的 Riffle 必须：

1. 保持 Vault 为普通 Markdown 文件夹，Note 继续使用 Vault-relative path 标识；
2. 将窗口、快捷键、对话框、Trash、协议、更新和 DevTools 交给 Electron 原生能力；
3. 将文件扫描、内容索引、watcher、搜索和文件变更隔离出 Electron main event loop；
4. 让 tree、search 和外部文件变化共享同一份 Vault Index，而不是各自扫描磁盘；
5. 让 renderer 只依赖窄、typed、schema-validated 的 `window.riffle` interface；
6. 让开发期崩溃、console、IPC error 和 utility process 生命周期可观察；
7. 通过真实 packaged app 验证 native binary、签名、公证、更新和系统操作。

# Non-goals

- 不重写 Octane renderer 或 Tiptap editor；
- 不改变 Note、Vault App Data、Pin、Collection 或 Published Share 的产品语义；
- 不为了迁移重新设计 Riffle Cloud protocol；
- 不复制 T3 Code 的 Effect/backend/server 分层；
- 不承诺兼容旧 Tauri IPC command names；
- 不把 web endpoint 当作可用的默认开发产品 surface；
- 不在此次迁移中把低优先级 backlinks 做成持久化搜索数据库。

# Product invariants

领域术语以 [`../CONTEXT.md`](../CONTEXT.md) 为准。以下行为不可因基座迁移而回退：

- Note 内容和可选 YAML frontmatter 保持无损 round-trip；
- editor 永远不接收 raw frontmatter，只有 Properties UI 的显式操作可以 author properties；
- inactive tab 的 live editor 通过 CSS 隐藏，不因 tab 切换 remount；
- dirty editor 在外部文件变化冲突中继续拥有明确、可测试的优先规则；
- rename/move 保留 collision suffix、链接改写和当前 tab ownership；
- delete 使用 OS Trash，必须异步完成或失败，不允许阻塞 UI 或 silent success；
- full path 必须展开 symlink，relative path 始终相对当前 Vault；
- `.markd/` 是 Vault App Data，不进入 Note tree 或全文搜索；
- Quick Capture 和主窗口操作同一个 Vault，但拥有独立窗口生命周期；
- renderer 永远不能直接访问 Node、Electron、filesystem 或 native library。

# Target architecture

```text
┌─────────────────────────────────────────────────────────────┐
│ Octane Renderer                                             │
│ UI · editor · tabs · view state · @pierre/trees adapter     │
└──────────────────────────┬──────────────────────────────────┘
                           │ window.riffle
                           │ typed + schema validated
┌──────────────────────────▼──────────────────────────────────┐
│ Sandboxed Preload                                           │
│ semantic methods only · no raw ipcRenderer                   │
└──────────────────────────┬──────────────────────────────────┘
                           │ semantic calls / subscriptions
┌──────────────────────────▼──────────────────────────────────┐
│ Electron Main — Desktop Shell                               │
│ windows · native operations · protocol · updater · broker    │
└──────────────────────────┬──────────────────────────────────┘
                           │ lifecycle + native control
┌──────────────────────────▼──────────────────────────────────┐
│ Utility Process — Riffle Engine                              │
│ Vault Engine · Cloud Engine                                 │
│ CRUD · collections · fff scan/index/search/watch             │
└─────────────────────────────────────────────────────────────┘
```

Preload and the utility process communicate over a transferred `MessagePort`; main creates and brokers the
channel but does not relay Vault snapshots or change batches. Renderer code sees only stable semantic wrapper
functions. Main and utility retain a separate, schema-validated control channel for lifecycle and native
operations such as Trash that must execute in main.

The Electron process model is the architectural source of truth: main owns application lifecycle and native
desktop capabilities; renderer behaves as a web page; preload exposes a constrained bridge; `utilityProcess`
hosts CPU-intensive or crash-prone work. See the
[Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model).

# Module ownership

| Module | Process | Owns | Must not own |
| --- | --- | --- | --- |
| Renderer | renderer | UI, editor instances, transient view state, user intent | Node, filesystem, raw IPC channels |
| Desktop Bridge | preload | validation, serialization, semantic `window.riffle` methods | domain state, arbitrary Electron access |
| Desktop Shell | main | windows, app lifecycle, native OS actions, protocol, update, diagnostics | vault scans, parsing, content search |
| Vault Engine | utility | active Vault, path policy, CRUD, Collections, index lifecycle | Electron windows or renderer state |
| Cloud Engine | utility | account session, publish lifecycle, billing and remote metadata requests | Electron windows, updater lifecycle |
| Vault Index | utility, inside Vault Engine | accepted paths, search, watch, incremental changes | product actions, UI state |
| Tree Projection | renderer | conversion from canonical paths to Trees input and interaction mapping | disk persistence, independent file truth |

These are deep modules. Their interfaces are the test surfaces; internal libraries such as fff or
`@pierre/trees` do not leak across the seams.

# Desktop Bridge interface

`window.riffle` exposes semantic modules rather than transport-shaped command names. The exact method inventory
is frozen during implementation reconnaissance, but the target shape is:

```ts
type RiffleDesktop = {
  app: AppDesktop
  vault: VaultDesktop
  collections: CollectionsDesktop
  cloud: CloudDesktop
  updates: UpdatesDesktop
}
```

Rules:

- use `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true` for every Riffle window;
- expose one wrapper function per allowed operation through `contextBridge`; never expose `ipcRenderer`;
- validate requests and responses with Valibot at the process seam;
- transfer serializable values only; paths use explicit absolute or Vault-relative types;
- represent expected failures as tagged data, not Electron's lossy serialized `Error` object;
- subscriptions return teardown functions and stop delivering immediately after teardown;
- renderer stores consume Vault Snapshot and Vault Change values instead of polling `loadTree()` on focus.

Main creates a `MessageChannelMain`, transfers one port to the utility process and the other to the isolated
preload world. Preload retains the raw port and exposes only the semantic interface above; it never transfers the
port or `ipcRenderer` into the renderer main world. Valibot validates every request before preload sends it and
every response/event before preload delivers it. Vault Engine validates inbound requests again because preload is
a transport adapter, not a trust boundary.

T3 Code is a reference for the security and lifecycle shape, not a dependency or architecture template. The
reference snapshot used for this decision is
[`pingdotgg/t3code@0ad91b6`](https://github.com/pingdotgg/t3code/tree/0ad91b6e7fc1fcb6d5f4bc736d84c337e912bc62/apps/desktop).

# Desktop Shell

Desktop Shell uses Electron-native capabilities:

- `BrowserWindow` owns the main and Quick Capture windows;
- `globalShortcut` opens Quick Capture;
- `dialog` selects, creates and exports Vault content;
- `shell.trashItem()` moves entries to OS Trash;
- `shell.showItemInFolder()` reveals files and `shell.openExternal()` opens trusted URLs;
- `nativeTheme` owns system/light/dark integration;
- `protocol.handle('riffle-asset', ...)` serves validated Vault assets after `riffle-asset` is registered with
  `protocol.registerSchemesAsPrivileged()` before `app.ready`;
- updater checks, downloads and relaunch are owned by main;
- renderer crash, unresponsive, console, utility stdout/stderr and utility exit events are observable in dev;
- main never performs synchronous Vault IO, Markdown parsing or recursive traversal.

The asset protocol rejects traversal and only resolves paths inside the active Vault's approved asset roots.
OS operations resolve and validate their target before mutation.

# Vault Engine

Vault Engine is the single owner of the active Vault and derived disk state. It starts after the user chooses a
Vault, initializes one Vault Index, returns one coherent Vault Snapshot, and then emits Vault Change batches.

It owns:

- canonical path resolution and traversal rejection;
- Note/folder create, read, write, rename, move and delete orchestration;
- link rewrites caused by rename or move;
- Collections stored under `.markd/`;
- pasted assets and export preparation;
- fff lifecycle, search-result shaping and watch-event normalization;
- on-demand backlinks candidate lookup and Markdown validation;
- disk conflicts and rescan recovery.

It does not expose fff result types. Search returns Riffle Note hits with title/path matches ranked before content
matches, deduplicated by canonical Vault-relative path.

## Vault Index and fff

fff is preferred because one long-lived native module already combines initial scan, path/content index,
frecency-aware search and background watch. Riffle must not add `@parcel/watcher` beside fff; two event sources
would create duplicate ownership and inconsistent ignore semantics. See
[`dmtrKovalenko/fff.nvim`](https://github.com/dmtrKovalenko/fff.nvim).

The target accepted set is evaluated by fff's ignore implementation from:

```text
fff built-ins
+ a Vault-root .ignore file with a Riffle-owned final block
+ Git user/global excludes
+ Vault .git/info/exclude
+ Vault root and nested .gitignore/.ignore rules
```

This is not naïve string concatenation. fff delegates ignore evaluation to its native walker; `.ignore`, Git
global excludes, `.git/info/exclude`, and root/nested `.gitignore` files keep the precedence and negation semantics
defined by that implementation. The target deliberately adopts `.git/info/exclude`. To preserve current Riffle
behavior, hidden files and directories are excluded from Notes, tree, and content search even inside a Git Vault;
the managed block must cover the difference from fff's context-dependent hidden-file default.

Riffle owns one final, marker-delimited block in the Vault-root `.ignore` file:

```gitignore
# BEGIN RIFFLE MANAGED IGNORE
.markd/
node_modules/
# END RIFFLE MANAGED IGNORE
```

The concrete built-in list is frozen by contract tests before adoption; the example is not the complete list.
If `.ignore` does not exist, Riffle creates it. If it exists, Riffle preserves content outside its block byte for
byte, replaces only one balanced block, and keeps that block last so same-file user rules cannot accidentally
override it. Duplicate or unbalanced markers are an explicit configuration error, never a guessed rewrite.
Updates use an atomic replace and only occur when the managed policy changes or the file drifts; an update forces
fff to rebuild its matcher and rescan before the resulting snapshot is marked ready.

The managed block is the performance layer: ordinary ignored paths must be rejected before they enter fff's
path/content index and before watcher ingestion. Vault Engine separately enforces the small hard-policy set
(`.markd/`, hidden paths, and frozen generated/dependency roots) at its accepted-path seam. This redundant check
is intentional because a more-nested `.ignore` has higher precedence than the root `.ignore`; hard-policy paths
must never appear in a Snapshot, Change, search result, or product mutation even if an external rule re-includes
one. It is not a substitute for pre-index filtering of the general ignore set.

Riffle does not edit `.gitignore`: that file owns Git and collaborator behavior. A Vault-root `.ignore` also affects
other tools that honor the ripgrep ignore convention; this is an explicit, visible Vault contract, not an implicit
side effect. Current fff already supports `.ignore`, so Riffle will not patch native create options or cross FFI once
per path.

fff runs only inside the utility process. Native load failure, crash, overflow/rescan and shutdown are explicit
lifecycle states. A failed index may be rebuilt; it is never the durable source of truth.

Initial and replacement snapshots use fff's atomic resident-entry enumeration: one native read lock and an O(N)
copy, without search ranking, sorting, pagination, or a second filesystem scan. New Note creation asks the same
retained matcher whether the not-yet-created relative path is accepted before the exclusive write. Directory
symlinks are transparent logical mounts: Snapshot, search, Pins and relative paths preserve the Vault-relative
alias while filesystem reads, writes and full-path resolution reach the physical target. fff detects directory
cycles, watches external targets, and maps physical events back to the logical alias so initial, live and mutation
paths share one accepted set. Symlinked Note leaves remain rejected. `.markd/`, assets and export destinations retain
their stricter no-symlink policies.

Renaming or trashing the directory symlink itself operates on the link; operations below it affect the target.
A move between different filesystem volumes fails with `CROSS_DEVICE_MOVE_UNSUPPORTED` before changing the source;
Riffle does not claim an atomic cross-volume move or use a copy-delete fallback.

The Node integration uses the exact `@celados/fff-node` and platform-binary version in `package.json`. A release
that enables directory symlinks must first pin a version whose atomic resident-entry, preflight ignore, cycle-safe
directory-symlink, and physical-to-logical live watcher contracts pass the Riffle gates. It uses `ffi-rs` to load the
fff C `cdylib`; platform binaries are
exact optional dependencies with authoritative
`os`/`cpu` metadata, so a clean consumer installs only the package matching its architecture. It is not treated as
an ordinary N-API `.node` addon. electron-builder configuration must unpack the selected dynamic library from
ASAR and include it in macOS signing, notarization, and packaged smoke evidence.

Renderer consumers apply affected Note rels incrementally. Clean mounted editors reload an external modification;
dirty editors retain the newest revision. External removal closes clean tabs and removes recents, while a dirty or
in-flight editor remains mounted in an explicit missing state with its local draft visible. Before choose/create
can send a Vault-open request, one renderer-owned barrier flushes every mounted editor and awaits all queued writes.
Any failed write aborts the switch before the native dialog or utility root transition, preventing an old-Vault
draft from being written under the new root.

## Search and backlinks

Search is a product projection over fff:

1. path/file search produces title and path candidates;
2. content grep produces Markdown line candidates;
3. Vault Engine restricts results to accepted Notes, merges and deduplicates them;
4. title matches rank before content matches; frecency is a secondary ranking signal;
5. selecting a result records access for later frecency ranking.

Backlinks remain on demand. fff narrows candidate files using exact link forms; the existing Markdown/link parser
then validates real targets. Plain string matches are never reported as backlinks without parsing.

# File tree

The current handwritten `FileTree.tsrx` owns recursive rendering, keyboard navigation, focus, drag/drop, rename
and context menus. It will be replaced by the Vanilla runtime from
[`@pierre/trees`](https://trees.software/), not its React wrapper.

Tree Projection receives sorted canonical paths from Vault Snapshot/Change, prepares presorted input, and maps
Trees interactions to Vault Engine intents. Trees owns virtualization, expansion, selection, keyboard navigation,
rename and drag/drop interaction; Riffle owns persistence and errors.

Pins remain a separate short shortcut list. They are not duplicated into the main tree and are not forced into a
second general-purpose tree model.

Adoption gates:

- pin an exact package version while Trees remains `1.0.0-beta`;
- prove root/Vanilla imports do not install or load React/ReactDOM; Preact used internally by the Vanilla entry is
  acceptable only while it remains hidden behind the Trees interface;
- do not add React/ReactDOM merely to satisfy package peer metadata;
- lock focus, keyboard, rename, drag/drop, context-menu and large-tree behavior with browser journeys;
- preserve Riffle's monochrome tokens and path-first selection contract.

# Development and release toolchain

Riffle keeps Vite 8 because the installed Octane plugin requires it. The Electron integration uses
[`vite-plugin-electron`](https://github.com/electron-vite/vite-plugin-electron), which explicitly supports Vite 8,
rather than stable `electron-vite@5`, whose peer range stops at Vite 7.

Target commands:

- `pnpm run dev` starts Vite and the complete Electron app with renderer HMR plus main/preload restart;
- `pnpm run dev:web` is an explicit renderer-only diagnostic surface;
- `pnpm run build` typechecks and builds renderer, preload, main and utility entries;
- package commands produce installable artifacts through electron-builder;
- release commands sign, notarize, publish and verify updater metadata and artifacts.

Development mode opens Chromium DevTools through the normal Electron shortcut/menu, inherits renderer console in
DevTools, and forwards main/utility logs to the launching terminal. Optional remote debugging is explicit and
disabled in production.

# Reliability and error model

- main stays responsive even when Vault Engine scans, parses, crashes or restarts;
- every request has a stable operation ID so errors and late responses can be correlated;
- expected errors cross seams as tagged `{ kind, message, details? }` data;
- utility exit rejects outstanding calls, emits an unavailable state and may trigger one controlled restart;
- watcher overflow produces an explicit rescan transition, not silent partial state;
- mutations are acknowledged only after the filesystem operation succeeds;
- renderer error boundaries report operation and process context without exposing note content;
- no sync filesystem or child-process call is permitted on renderer or main hot paths.

Main owns the utility generation. Each spawn receives a new monotonically increasing `epoch` and a fresh direct
MessagePort. When that port closes, preload immediately rejects all in-flight calls with `ENGINE_UNAVAILABLE`,
ends the old subscriptions, and emits an unavailable lifecycle event. Main may perform one automatic restart per
failure burst; the restart budget resets only after the replacement utility has produced a valid full snapshot.
Preload re-establishes registered semantic subscriptions on the new port, beginning with that full snapshot;
renderer stores discard changes whose epoch is not current and require monotonically increasing sequence numbers
within an epoch. A sequence gap invalidates that epoch's incremental state and requests a new full snapshot; it
must never leave a silently stale tree.

Mutations are never replayed automatically after a crash: the filesystem may have changed even when the
acknowledgement was lost. The replacement snapshot is the reconciliation source of truth, and the user may retry
an explicitly failed intent. Operation IDs correlate requests, results, and diagnostics; they do not claim
exactly-once execution.

# Test strategy

Existing logic and system-Chrome browser journeys are retained and moved from the Tauri fixture to a fake
`window.riffle` adapter. New test layers are:

| Layer | Required evidence |
| --- | --- |
| domain | path policy, frontmatter, link rewrite, collections and result shaping through pure tests |
| Vault Index contract | internal/global/nested ignore precedence, atomic writes, rename, delete, overflow and rescan |
| utility contract | startup, snapshot, change batches, teardown, crash and restart with a real child process |
| bridge contract | schema rejection, tagged errors, subscription cleanup and denied raw Electron access |
| browser | settings, tabs, editor, tree, search, Quick Capture and error surfaces in system Google Chrome |
| Electron smoke | real main/preload/utility process, native dialog/shell/protocol and DevTools behavior |
| packaged app | native fff binary loading, Trash, asset protocol, signing, notarization, updater and artifact install |

Regression journeys must include the two failures that motivated this redesign:

- opening Settings through its shortcut renders every panel without a runtime error;
- creating an untitled empty Note and moving it to Trash never blocks main or renderer and leaves a coherent tree.

No browser automation may download a Playwright Chromium build. Renderer journeys use system Google Chrome;
Electron smoke launches the application's installed Electron runtime.

# Migration plan

The migration follows dependencies and vertical slices, not file-for-file translation.

## Phase 0 — Freeze behavior and contracts

- inventory the current Tauri command consumers, events, windows, capabilities and release paths;
- freeze renderer-facing behavior in a transport-neutral fake `window.riffle`;
- record current unit/browser/Rust evidence and the known Settings/Trash regressions;
- add missing browser behavior coverage for Quick Capture and search before replacing their transport;
- define tagged error schemas, Snapshot/Change schemas and operation cancellation semantics.

Exit: renderer tests no longer need to know Tauri command names.

## Phase 1 — Electron shell and secure bridge

- add Electron, `vite-plugin-electron`, main, preload and utility build entries;
- implement secure BrowserWindow defaults, lifecycle, DevTools and diagnostic forwarding;
- expose the minimal `window.riffle` modules with schema validation;
- launch one empty Riffle Engine utility process and prove crash/teardown behavior.

Exit: `pnpm run dev` opens the real Electron app; no Vault feature has been claimed migrated.

## Phase 2 — First complete Vault slice

- migrate choose/create/open Vault;
- migrate tree snapshot, Note read/create/write and async OS Trash;
- preserve editor autosave, tab ownership and Quick Capture behavior;
- prove the untitled Note Trash regression in real Electron.

Exit: a user can operate a basic Vault end to end without Tauri for that slice.

## Phase 3 — Vault Index and tree replacement

- land managed `.ignore` reconciliation and prove fff scan/watch/rescan semantics with its packaged dynamic library;
- make fff own scan, search and watch in Vault Engine;
- replace focus-triggered full reload with Snapshot/Change flow;
- replace handwritten FileTree with `@pierre/trees` Vanilla after its adoption gates pass;
- implement search shaping and on-demand backlinks.

Exit: tree and search use one ignore-correct live index; no parallel watcher or full-scan hot path remains.

## Phase 4 — Remaining desktop and domain capabilities

- migrate Pins, Todos, Bookmarks, assets, exports and link metadata;
- migrate cloud account, publish/update/revoke and billing URLs;
- finish Quick Capture, native menu, shortcuts, theme and custom asset protocol;
- migrate updater behavior and release configuration.

Exit: every user-visible capability has an Electron owner and executable evidence.

## Phase 5 — Packaged release closure

- build the supported macOS artifacts;
- verify fff native binaries outside development mode;
- verify code signing, notarization, updater manifests and install/upgrade behavior;
- run packaged native smoke tests and inspect artifact contents.

Exit: installable artifacts pass the same functional contract as development mode.

## Phase 6 — Clean cut

- remove `src-tauri/`, Cargo files, Tauri dependencies, capabilities and release scripts;
- remove obsolete command names and transport fixtures;
- update AGENTS, CI, release docs and source ownership to Electron-only reality;
- prove no `@tauri-apps` or `@octanejs/tauri` imports remain.

Exit: the repository has one desktop architecture and no compatibility shim.

# Gates and unresolved decisions

These are entry gates, not accepted silent workarounds:

1. **fff ignore lifecycle** — managed `.ignore` writes must rebuild the matcher and produce an ignore-correct full
   rescan before fff owns production Vaults; tests cover hidden paths, `.git/info/exclude`, global/root/nested rules,
   negation, marker corruption, and hard-policy defense.
2. **fff packaging** — the `@celados/fff-node` `ffi-rs` loader and selected `@celados/fff-bin-*` cdylib must survive
   pnpm install, ASAR unpacking, macOS packaging, signing, notarization, and runtime smoke.
3. **Trees packaging** — Vanilla entry must not introduce React/ReactDOM; beta behavior must be pinned by journeys.
4. **Cloud ownership** — fork domain/API ownership must be resolved before enabling production publishing.
5. **Updater trust** — Electron signing keys, provider URLs and rollback behavior need release-environment proof.

If a gate fails, record it in [`../.agents/backlog.md`](../.agents/backlog.md) before accepting any temporary
alternative. Do not hide it behind a local compatibility adapter.

# Rejected alternatives

- translating every Tauri command into a same-named IPC handler;
- enabling Node integration in renderer;
- running Vault scans, Markdown parsing or fff in Electron main;
- filtering ignored files only after they enter fff's index;
- combining fff watch with `@parcel/watcher`;
- making Watchman a user-installed runtime dependency;
- retaining Rust through a sidecar or N-API layer solely to preserve old code;
- editing user `.gitignore` files or writing an unmarked, non-preserving `.ignore`;
- patching fff with `additionalIgnorePatterns` while its supported `.ignore` seam satisfies the contract;
- maintaining long-lived Tauri/Electron compatibility paths;
- importing T3 Code's application-scale Effect/server machinery into Riffle.

# Acceptance criteria

The proposal is fully implemented only when:

- `pnpm run dev` launches the complete Electron app and exposes usable DevTools;
- renderer has no direct Node, Electron, filesystem or native-library access;
- main has no recursive scan, content parse or synchronous Vault IO hot path;
- the accepted Note set obeys hard policy plus managed `.ignore`, user-global, `.git/info/exclude`, and root/nested
  `.gitignore`/`.ignore` rules in scan and watch;
- tree, search and external edits derive from one Vault Index;
- all current user journeys pass against the bridge, with native Electron and packaged smoke evidence;
- fff and updater native assets are present and functional in signed artifacts;
- Tauri/Rust source, dependencies, capabilities and release paths are deleted;
- no known behavior gap is represented as silent success.

# Sources of truth

- [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Electron contextBridge](https://www.electronjs.org/docs/latest/api/context-bridge)
- [Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)
- [Electron MessagePorts](https://www.electronjs.org/docs/latest/tutorial/message-ports)
- [Electron protocol](https://www.electronjs.org/docs/latest/api/protocol)
- [vite-plugin-electron](https://github.com/electron-vite/vite-plugin-electron)
- [fff](https://github.com/dmtrKovalenko/fff.nvim)
- [fff Node SDK package](https://github.com/dmtrKovalenko/fff.nvim/tree/main/packages/fff-node)
- [Rust ignore precedence](https://docs.rs/ignore/latest/ignore/struct.WalkBuilder.html#ignore-rules)
- [@pierre/trees documentation index](https://trees.software/llms.txt)
- [T3 Code desktop reference](https://github.com/pingdotgg/t3code/tree/0ad91b6e7fc1fcb6d5f4bc736d84c337e912bc62/apps/desktop)
- [Ripple documentation index](https://ripple-ts.com/llms.txt)
- [Octane documentation index](https://octanejs.dev/llms.txt)
