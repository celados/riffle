---
type: Plan
title: Markd TSRX 迁移逐文件 manifest
description: >
  冻结 51 个 render 文件及其唯一 owner、TSRX 决策、前置行为修复、可执行 oracle 和并行 wave。
status: completed
version: 0.7
timestamp: 2026-08-05T10:00:00+08:00
resource: ./tsrx-rewrite-plan.md
superseded_by: ./solid2-migration-plan.md
tags: [octane, markd, tsrx, manifest, migration]
---

# Decision

Reconnaissance 与迁移已覆盖 `app/src/components/` 的全部 51 个初始 `.tsx` 文件和 package B 的
`treeMenu.ts`。TSRX 是控制流与 keyed identity 工具，不是覆盖率目标：28 个文件转换，20 个保持
TSX，3 个无 consumer 的残留删除。每个文件只有一个 owner；不存在 residual/F package。

主应用 package manager 已 clean break 到 pnpm。所有 gate 从 `app/` 运行；`site/` 与
`services/cloud-api/` 是独立部署包，不属于本 manifest。

# Serial preconditions

以下工作由主 agent 线性完成，完成前不启动 component rewrite worker。当前 DnD、
property save/focus、unused Motion cleanup 与 system-Chrome baseline 已完成：

1. 修正 `FileTree` 的 DnD 行为漂移：
   - 继续使用 `@octanejs/dnd-kit` 根入口，不恢复 legacy `@dnd-kit/core`，也不改用 sortable；
   - 显式恢复 pointer-only sensor，避免默认 KeyboardSensor 抢占 tree 的
     Enter/Space/Arrow contract；
   - 恢复 nested folder/row 优先于 root drop zone 的 collision 选择。
2. 修正 property portal/save seam：Base UI Popover portal 不属于 `PropertyRow` DOM subtree，
   native blur 不会沿逻辑组件树冒泡。rename 必须由显式提交/dismiss contract 保存，不能继续依赖
   row-level blur 猜测。
3. 删除无 caller 的 `motion/morphing-modal.tsx`、`motion/shared-layout-bg.tsx`、
   `motion/tabs.tsx`；删除 `action-swap.tsx` 中无 caller 的 `ActionSwapButton` surface。
4. 扩展 repo 内 system-Chrome Playwright fixture。当前
   `pnpm exec playwright test tests/browser/app-shell.spec.ts` 已机械覆盖 Note actions 的 initial
   focus、Arrow/End、Escape focus restore、outside dismissal 和 runtime errors；每个 wave
   开工前必须先有对应 spec。

Wave 0 发现的 Motion transparent-wrapper defect 已提交
[`octanejs/octane#331`](https://github.com/octanejs/octane/pull/331)，并已进入当前正式 binding；旧
pnpm patch 已删除。production browser journeys、logic tests、typecheck 与 build 均通过。

# Ownership and file decisions

## A — shared UI

| file | decision | frozen reason / oracle |
| --- | --- | --- |
| `ui/Button.tsx` | keep TSX | Base UI adoption 已完成；静态单根。验证 native button、loading/disabled、ref/props。 |
| `ui/Input.tsx` | keep TSX | Base UI adoption 已完成；无模板控制流。验证 native `onInput`、ref、disabled/invalid。 |
| `ui/Tooltip.tsx` | keep TSX | 静态 Base UI composition。验证 hover/focus、120ms delay、portal teardown。 |
| `ui/Modal.tsx` | keep TSX | 静态 Base UI Dialog composition。验证 Escape/outside、trap/restore、busy close。 |
| `ui/ContextMenu.tsx` | keep TSX | 等待正式 Base UI ContextMenu 发布；adoption 需要 B 同时拥有 caller trigger。验证 clamp、keyboard、单次 action。 |
| `ui/CopyButton.tsx` | keep TSX | 状态与 timer 比模板分支更重要；依赖 E 的 frozen ActionSwap API。 |
| `ui/ErrorBoundary.tsx` | keep TSX | Octane ErrorBoundary render seam，无列表或结构性收益。 |
| `ui/Spinner.tsx` | keep TSX | 纯静态 visual leaf。 |
| `ui/StatusBadge.tsx` | keep TSX | 纯静态 visual leaf，tone 由 class mapping 表达更直接。 |
| `ui/TagList.tsrx` | converted TSRX | tag chips 使用 `@for key tag`；输入提交与 click propagation 由 shared-ui browser journey 验证。 |
| `ui/TagPicker.tsrx` | converted TSRX | registry 使用 `@for key tag`；assigned toggle 与 accessible trigger 由 shared-ui browser journey 验证。 |
| `ui/TagRail.tsrx` | converted TSRX | tag rail 使用 `@for key tag`；filter/delete/confirm modal 由 shared-ui browser journey 验证。 |

A 的 browser owner 是 `tests/browser/shared-ui.spec.ts`；逻辑 gate 是 `pnpm test`。

## B — tree, sidebar, todos and bookmarks

| file | decision | frozen reason / oracle |
| --- | --- | --- |
| `tree/FileTree.tsrx` | converted TSRX | recursive keyed tree；modern DnD operation/collision、roving focus 和 pinned 去重由 `tree-and-lists.spec.ts` 验证。 |
| `tree/PinnedNotes.tsrx` | converted TSRX | 顶层与递归 keyed tree；pin subtree ownership、expand 与 keyboard 由 browser journey 验证。 |
| `tree/RenameInput.tsx` | keep TSX | 单 input + effect。验证 Enter+blur 单次提交、Escape/empty no-op。 |
| `tree/FolderMorphIcon.tsx` | keep TSX | 静态 Motion leaf，无结构控制流收益。 |
| `tree/treeMenu.ts` | keep TS | 纯 command/data builder，不是 render file。补 item order/callback unit tests。 |
| `layout/Sidebar.tsrx` | converted TSRX | view/update/shortcut branches；`#333` 修复发布后直接使用 keyed `@for`。 |
| `layout/ResizableSidebar.tsx` | keep TSX | pointer-capture state machine 是核心，模板收益低；沿用 `sidebarResize` unit tests。 |
| `bookmarks/BookmarksPage.tsrx` | converted TSRX | rows 使用 `@for key bookmark.id`；保留 edit/image fallback/AnimatePresence identity。 |
| `todos/TodosPage.tsrx` | converted TSRX | rows 使用 `@for key todo.id`；保留 optimistic/edit/filter/AnimatePresence identity。 |

B 的 browser owner 是 `tests/browser/tree-and-lists.spec.ts`；逻辑 gate 包含
`pnpm exec vitest run tests/sidebarResize.test.ts`。DnD package 只能使用
`@octanejs/dnd-kit` 的 modern `operation.source/target`、`ref` 和 `isDropTarget` surface。

## C — app surfaces and overlays

| file | decision | frozen reason / oracle |
| --- | --- | --- |
| `palette/CommandPalette.tsrx` | converted TSRX | Cmdk groups/items 用 `@for key item.id`；保留 Rust ranking、`shouldFilter=false`、stale request guard。 |
| `layout/AppShell.tsrx` | converted TSRX | `NotesWorkspace` 始终 mounted；view switch、note actions 和 runtime-error oracle 已通过。 |
| `editor/PropertyNameMenu.tsrx` | converted TSRX | property types 使用 `@for key option.type`；显式 save/dismiss/focus contract 已通过 portal journey。 |
| `settings/CloudAccountCard.tsrx` | converted TSRX | account/email/code/busy/error state machine 使用 TSRX control flow。 |
| `settings/SettingsModal.tsrx` | converted TSRX | pages 使用 `@for key id`；Dialog focus restore 和 page Motion identity 已通过。 |
| `settings/SettingsPanels.tsrx` | converted TSRX | themes/shortcuts/keys 使用稳定 key 的 `@for`。 |
| `capture/QuickCaptureWindow.tsx` | keep TSX | event/IPC lifecycle 是核心，模板基本静态；另由 quick-capture window journey 验证。 |
| `updater/ReleaseNotesModal.tsx` | keep TSX | 小型 Modal leaf，无 TSRX 控制流收益。 |
| `welcome/Welcome.tsx` | keep TSX | 静态入口页，无 TSRX 控制流收益。 |

C 的 browser owners 是 `tests/browser/app-shell.spec.ts` 与
`tests/browser/app-surfaces.spec.ts`。现已覆盖 Cmdk ordering/focus/activation、Settings Dialog
page switching/focus restore，以及 Property rename 的 portal dismissal paths；quick-capture
独立 window label 保留给未转换的 QuickCapture owner。

## D — editor

| file | decision | frozen reason / oracle |
| --- | --- | --- |
| `editor/BacklinksSidebar.tsx` | keep TSX | 静态 Motion shell；LinkedMentions 由独立文件拥有列表。 |
| `editor/CodeBlock.tsx` | keep TSX | Tiptap NodeView/ProseMirror-owned DOM seam；模板收益低。 |
| `editor/FindReplaceBar.tsrx` | converted TSRX | toolbar 分支用 `@if`；replace pane 仍常驻，只切 grid/inert/ARIA；find/replace browser journey 已通过。 |
| `editor/LinkedMentions.tsrx` | converted TSRX | `@for key sourceRel:line:occurrence`；保留 request-id 防竞态。 |
| `editor/MarkdownSourceEditor.tsx` | keep TSX | 命令式 CodeMirror owner；EditorView 按 source branch mount 创建并在 unmount 显式 destroy。 |
| `editor/NoteBreadcrumb.tsrx` | converted TSRX | folder list 直接使用 indexed keyed `@for`；ActionSwap API 不变。 |
| `editor/NoteEditor.tsrx` | converted TSRX | 只改 render/control-flow；editor lifecycle、effects、IPC、autosave 与 refs 保持原合同。 |
| `editor/NoteLinkPicker.tsrx` | converted TSRX | `@for key note.rel`；mousedown-before-blur 与 insertion range 由 slash→picker journey 验证。 |
| `editor/NoteProperties.tsrx` | converted TSRX | `@for key property.key`；draft/addFocusNonce identity 保持。 |
| `editor/NotesWorkspace.tsrx` | converted TSRX | `@for key rel`；inactive editor 与整个 workspace 都只 `hidden`，live identity journey 已通过。 |
| `editor/PropertyRow.tsx` | keep TSX | focus/blur/save seam 高风险且模板收益低；C 的 PropertyNameMenu 是只读依赖。 |
| `editor/PropertyValueEditor.tsrx` | converted TSRX | checkbox/list/URL/default 使用当前 colon-form `@switch`；DOM type/ref/commit 不变。 |
| `editor/PublishNoteModal.tsrx` | converted TSRX | loading/account/plan/share/error/busy 状态树；IPC/query cache 顺序不变。 |
| `editor/SelectionMenu.tsrx` | converted TSRX | link/color/default state 与 keyed colors；显式 icon 输入删除 opaque children，selection journey 已通过。 |
| `editor/SlashMenu.tsrx` | converted TSRX | `@for key command.id`；动态 icon 与 note-link handoff 已通过。 |
| `editor/TabBar.tsrx` | converted TSRX | `@for key rel`；close/focus、layoutId 和 editor identity 保持。 |
| `editor/TitleInput.tsx` | keep TSX | uncontrolled input leaf；caller 的 `key=rel` 是重建边界。 |

D 的 browser owner 是 `tests/browser/editor.spec.ts`。逻辑 gate 至少运行：

```text
pnpm exec vitest run tests/frontmatter.test.ts tests/markdownPaste.test.ts \
  tests/noteFind.test.ts tests/noteLinks.test.ts
```

Browser oracle 必须观察 live editor identity、500ms autosave/flush、frontmatter round-trip、
paste branches、selection/BubbleMenu、NodeView cleanup、source/rich 往返以及 slash/link picker。

当前 `tests/browser/editor.spec.ts` 已机械覆盖 live editor 跨 tab/view identity、500ms autosave、
close flush 与 owning path、frontmatter 保留、source/rich 双向往返、slash→note-link picker、
find/replace 和 selection formatting。该 oracle 先暴露 icon-only source toggle 缺少 accessible
name，再暴露 Octane branch marker/runtime crash；前者已修正，后者由
[`octanejs/octane#335`](https://github.com/octanejs/octane/issues/335) 的正式修复解决，rich/source
恢复互斥 branch mount。markdown paste 由逻辑测试覆盖；NodeView seam 由 Tiptap 类型门禁和真实 Tauri host
编译覆盖，仍需在用户视觉验收中观察实际 code block mount/copy/unmount。

## E — motion

| file | decision | frozen reason / oracle |
| --- | --- | --- |
| `motion/action-swap.tsrx` | converted TSRX | cascade chars 在 `#333` 修复发布后直接使用 indexed keyed `@for`；Text/Icon 保持显式 `text`/`icon` 输入，避免 opaque children 被测量层与 Motion 层重复消费。 |
| `motion/popover-morph.tsrx` | converted TSRX | Wave 2 browser oracle 证明 TSX opaque-child wrapper 会把 TSRX slot 当普通 node 并崩溃；现收敛为显式 `trigger`/`content` 的单一 Base UI composition。 |
| `motion/morphing-modal.tsx` | delete | 无 caller；手工 focus/scroll/modal primitive 已被 Base UI Dialog 路线取代。 |
| `motion/shared-layout-bg.tsx` | delete | 无 caller；显式 API 没有真实 consumer，`layoutRoot` 当前也无 binding 语义。 |
| `motion/tabs.tsx` | delete | 无 caller；不保留未使用且 keyboard contract 不完整的自制 Tabs primitive。 |

E 的 browser owner 是 `tests/browser/motion.spec.ts`，至少通过 CopyButton、CodeBlock、
breadcrumb 和 AppShell 观察首帧、快速切换、不同长度、reduced motion 与 unmount cleanup。
`AnimatePresence mode/initial`、`layoutRoot`、`layout="position"` 不得被当作已实现能力。

# Dependency waves

1. **Wave 0 — serial correctness:** DnD、property save/focus、unused Motion deletion，补齐 package
   browser specs；全局 gate。
2. **Wave 1 — foundations:** E 的 `action-swap` 与 A 的三个 Tag components 已完成并通过
   system-Chrome journeys。
3. **Wave 2 — product surfaces（完成）:** B 与 C 在独立 worktree 重写后线性合入；主 agent
   发现并删除 opaque-child popover seam。严格 typecheck、41 个 logic tests、production build 与
   8 个 system-Chrome journeys 全部通过。
4. **Wave 3 — editor leaves（完成）:** 10 个 leaf/structural owner 已迁移；严格 typecheck、
   41 个 logic tests、production build 与完整 14 个 system-Chrome journeys 通过。
5. **Wave 4 — editor orchestrator（完成）:** `NoteEditor` 与漏列的 `NoteBreadcrumb` 已迁移；
   严格 typecheck、41 个 logic tests、production build、14 个 system-Chrome journeys、
   59 个 Rust tests 与 Tauri no-bundle host build 全部通过。

任何 wave 开始前，主 agent 从当前 `app/` 创建临时 Git-backed mirror 与独立 worktrees。worker
不能直接并发写 Lore-owned `app/`；主 agent独立审查 patch、运行 browser/logic/type/build gates
后再线性合入。

# Global gates

```text
pnpm install --frozen-lockfile
pnpm test
pnpm run typecheck  # strict consumer check, no dependency diagnostic allowlist
pnpm run build
pnpm exec playwright test
rg React runtime / cloneElement / Children / forwardRef / legacy @dnd-kit imports
```

TSX fallback 是明确裁决，不是未完成。没有 browser oracle、shared API 越权或恢复 React-only
machinery 才是未完成。
