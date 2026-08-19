# Riffle — agent guide

Local-first markdown notes app for macOS. Electron is the only desktop shell and release path. The UI uses
Octane + Vite + Tailwind v4. Comark powers the Readonly View; CodeMirror powers the Source Editor.

## Runtime migration in flight

Renderer runtime 已裁决迁移到 Solid 2（[ADR 0003](docs/adr/0003-adopt-solid-2-as-the-renderer-runtime.md)），
执行计划见 [`docs/solid2-migration-plan.md`](docs/solid2-migration-plan.md)。**本文其余部分描述的仍是当前
代码库，它现在是 Octane**——迁移尚未开始，不要按 Solid 语义读下面的内容或修改代码。计划的 Wave 0 会在
同一个 commit 里切换工具链并重写本文。在此之前新增功能仍走 Octane，但先问一句它是否应该等 Wave 0。

## Project provenance

Riffle is Celados' independent Octane/Electron continuation of
[`starc007/markd`](https://github.com/starc007/markd), based on upstream commit
`1d9f0e7f7f2a3cce1a8c83966ff07f6ed2448fb4`. The port was validated against Octane snapshot
`bbb668df31c3a7f13c79b5bbea6fb7d2e8f4db10`; current package versions and pnpm patches are the
runtime source of truth. Historical decisions, the reviewed plan, and the per-file migration
manifest live under `docs/`; unresolved framework/release seams live in `.agents/backlog.md`.

The UI is Octane-native. Do not reintroduce React compatibility layers or mechanically translate
React composition patterns. Use TSRX where keyed/control-flow ownership benefits from compiler
visibility; TSX remains valid for straightforward structure and imperative third-party owners.

## Framework sources of truth

Before changing application code, read both current documentation indexes:

- [Ripple LLM documentation](https://ripple-ts.com/llms.txt) — TSRX language-family context
- [Octane LLM documentation](https://octanejs.dev/llms.txt) — the active compiler, runtime, and
  binding contracts used by this fork

Do not work from remembered React, Ripple, or Octane semantics. The installed package versions,
pnpm patches, and these current indexes are the source of truth. If the docs and installed compiler
disagree, inspect the installed source and record the unresolved drift in `.agents/backlog.md`.

The root app uses pnpm exclusively. `pnpm-lock.yaml` is the dependency source of truth and
`pnpm-workspace.yaml` owns patch/install policy. `site/` and `services/cloud-api/` are independent deployment
packages with their own Bun lockfiles; do not run their scripts from the root or silently absorb them into the
root pnpm workspace.

## Commands

- `pnpm run dev` — run the complete Electron + Vite desktop app
- `pnpm run dev:web` — renderer-only diagnostic surface in system browser; it is not the desktop product
- `pnpm run build` — strict app typecheck + Vite production build
- `pnpm run typecheck` — strict TSRX typecheck；不保留 dependency diagnostic allowlist
- `pnpm run icons:generate` — 从根 `icons.json` 用 Sigil 生成 Octane-native `src/icons/icons.tsrx`；
  Sigil 通过 workspace 的 `bun link` 提供，只参与开发期 AOT codegen，生成物必须提交，app
  runtime 和 consumer 安装不依赖 Bun/Sigil
- `pnpm run test:browser` — rebuild, then run production-preview journeys in system Google Chrome;
  do not invoke Playwright directly against a potentially stale `dist/`
- `pnpm run test:electron` — rebuild, then launch the installed Electron runtime for secure-shell and real
  utility/native smoke tests in background mode; it neither activates the app nor downloads a Playwright browser
- `pnpm run package:test` — build an unsigned macOS arm64 Electron package, verify its exact native/updater
  payload, then run the packaged smoke in background mode
- `.github/workflows/release-macos.yml` — tag-only signed/notarized macOS arm64 release; local package commands do
  not claim signing or publication

## Architecture

The renderer is UI + state only. Filesystem, index, Collections, Cloud, and capture persistence belong to the
utility-owned engines under `electron/`; OS-authority operations belong to Electron main. The isolated preload
exposes the typed, semantic `window.riffle` bridge. Renderer modules consume the domain-shaped services in
`src/lib/desktop-services.ts`; there is no transport compatibility layer.

The Electron-native architecture and migration gates are recorded in
[`docs/electron-native-architecture.md`](docs/electron-native-architecture.md); new migration work must follow that
accepted proposal and the current implementation.

### Vault model

User picks any folder as a vault:

- `<vault>/` — plain `.md` files live directly in the selected vault root, filename = title, no IDs. Folders are real folders. `.markd/` remains reserved app data. Portable plain-markdown. Frontmatter is optional: Riffle preserves external YAML and only authors flat properties after an explicit user action in the Properties UI.
- `<vault>/.markd/` — app data: atomic `collections.json`, `assets/` (pasted images). Electron
  migrates the legacy `todos.json` / `bookmarks.json` and tag registries once when the canonical
  Collection store is absent.
- Vault path + theme persist in the app config dir (`config.json`).

Notes are addressed by path relative to the vault root (e.g. `projects/app.md`), never by ID. Deletes go to OS trash. The live Vault Index projects external edits; a dirty editor keeps its local draft until the explicit write conflict is resolved.

### Electron (`electron/`)

- `main.ts` — secure windows, dialogs, Trash, Finder reveal, trusted external navigation, asset protocol, updater
- `preload.ts` / `bridge-contract.ts` — narrow validated `window.riffle` interface; never expose `ipcRenderer`
- `engine.ts` / `vault-engine.ts` — utility-owned Vault operations and coherent snapshots
- `vault-index.ts` — the single ignore-aware fff index shared by tree, search, backlinks, and live changes
- `collections-engine.ts` / `cloud-engine.ts` — Vault App Data and remote publishing owners
- `link-metadata.ts` — bounded bookmark metadata fetch and mature HTML parsing

Main must not perform recursive scans, Markdown parsing, or synchronous Vault IO. The renderer must not import
Node, Electron, or native libraries.

### Frontend (`src/`)

- `stores/` — zustand: `vault` (tree, view, theme, recents), `tabs` (open note tabs; active = derived from `vault.view`), `todos`, `bookmarks`, `ui`
- `components/` — by feature: `layout/`, `tree/`, `editor/`, `todos/`, `bookmarks/`, `palette/`, `settings/`, `welcome/`, `ui/`
- `icons.json` 是图标依赖清单；`src/icons/icons.tsrx` 由 Sigil 生成，禁止手改。新增图标先
  `sigil add lucide/<name>`，再运行 `pnpm run icons:generate`。
- Note views: the Comark-backed Readonly View never mutates the body; the CodeMirror Source Editor autosaves with a 500ms debounce and flushes on unmount. Images stay as Vault-relative paths and render through the asset protocol.
- Tabs: `NotesWorkspace` keeps one live Note view per open tab, with inactive panes hidden via `display:none` — tab switch is a CSS toggle, never a remount/re-parse. Keep it that way.
- Session: `lib/session.ts` persists per-vault UI layout (open tabs, active view, todo/bookmark tag filters) to localStorage keyed by vault root, restoring it on launch. Tag filters live in the `todos`/`bookmarks` stores (not component state) so they're subscribable.
- Page links: internal Markdown links use a Vault-relative href (`[Title](projects/app.md)`). The Markdown module projects `[[wiki]]`/`[[target|alias]]` syntax to the same navigation semantics without rewriting Source Editor content; clicking an existing target opens that Note.
- Frontmatter: `lib/frontmatter.ts` splits a leading `---` YAML block off the body on load and re-attaches it on save. `NoteProperties` can add, edit, and remove flat text or list properties while preserving unrelated YAML. The Markdown renderer receives only the body.

## UI conventions

- Strict monochrome: only the semantic tokens in `styles.css` (`bg`, `panel`, `sunken`, `ink`, `muted`, `faint`, `line`, `hover`, `active`, `invert`…). `sunken` is the recessed surface (tab strip), darker than `panel`. Never hardcode colors; `danger` is the sole exception, for destructive actions.
- Dark mode = `.dark` class on `<html>`; themes: system/light/dark.
- Active/selected rows use inverted style (`bg-invert text-invert-ink`) — the signature look.
- Motion: 100–160ms ease-out only. Fonts: Inter Variable (UI), JetBrains Mono (code).
- No autocorrect anywhere: global `focusin` hook in `main.tsx` handles inputs; editor sets its own attrs.

## Adding beui components

Animated components come from the beui registry (the user's own library). A compatibility layer is already in place so pulled components inherit our monochrome theme unchanged:

- `src/lib/utils.ts` exports `cn()` (clsx + tailwind-merge) — what beui/shadcn files import. Our own components use `cx()`.
- `src/lib/ease.ts` — shared motion tokens (`SPRING_PANEL`, `EASE_OUT`, …). `styles.css` mirrors `--ease-out` and defines the `.press` utility.
- `styles.css` maps shadcn semantic tokens (`--color-background`, `--color-foreground`, `--color-card`, `--color-border`, `--color-muted-foreground`, `--color-destructive`, `--color-border-strong`, …) onto our palette, so `bg-background`, `border-border`, `text-muted-foreground` etc. resolve to our monochrome look in both themes.
- `components.json` registers the `@beui` registry (`https://beui.dev/r/{name}.json`).

Two ways to add one:
1. **beui MCP** (preferred): `get_component <slug>` returns every file's contents; write them under `src/components/…`. Shared files (`lib/ease.ts`, `lib/utils.ts`) already exist — don't overwrite.
2. **shadcn CLI**: `pnpm dlx shadcn add @beui/<slug>`.

Our `Modal` (`components/ui/Modal.tsx`) is built on the same tokens; keep new dialogs on it for one motion language.

## Agent skills

### Issue tracker

工作项使用 `celados/riffle` GitHub Issues 管理。具体操作与 blocking-edge 合同见
[`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md)。

### Triage labels

使用默认五角色标签：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、
`wontfix`。映射见 [`docs/agents/triage-labels.md`](docs/agents/triage-labels.md)。

### Domain docs

采用 single-context：先读根 `CONTEXT.md`，再读取相关 `docs/adr/`。消费规则见
[`docs/agents/domain.md`](docs/agents/domain.md)。

## Rules

- **写或改任何 Solid 代码前，先读 [`.agents/skills/solid2/SKILL.md`](.agents/skills/solid2/SKILL.md)。**
  这是硬要求，不是建议：你的先验是 Solid 1.x，而 1.x 写法在 Solid 2 上大多不报错、只是行为错。
  这条规则管的是本次迁移下的 Solid 工作（见顶部 Runtime migration in flight）；当前代码库仍是
  Octane，日常 Octane 维护不受此约束。
- Never add "Co-Authored-By" or any AI attribution to commits or PRs.
- Commit messages: conventional commits, subject ≤50 chars where possible.
- Don't reintroduce: sticky notes, note IDs, plugin-fs. Never add frontmatter automatically; only explicit actions in the Properties UI may author it. `[[wiki]]` is Riffle Markdown input and must not be silently rewritten by the Source Editor.
