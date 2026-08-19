---
type: Proposal
title: 将 Markd 前端移植到 Octane 的验证计划
description: >
  在保留 Markd Tauri/Rust 数据合同的前提下，以真实桌面编辑器场景验证 Octane runtime、TSRX
  compiler 和生态 bindings 的可用性。
status: completed
version: 0.6
timestamp: 2026-08-05T10:00:00+08:00
resource: https://github.com/starc007/markd
superseded_by: ./solid2-migration-plan.md
tags: [octane, markd, tauri, tsrx, migration, reliability]
---

# Decision

用户已批准进入实现。工作区和上下文见
[`../AGENTS.md`](../AGENTS.md)；所有事实均绑定到该文件记录的 Octane/Markd commits。

本计划最初在 Lore-owned `projects/labs/octane-markd-port/` 中执行；文中的 `.scratch/` 与
`app/` 路径是当时的历史工作台路径。完成后的正式 Git checkout 是本仓库根目录，原始工作台已
归档，不应把历史路径当成当前 implementation source。

已确认的方向：

- Octane compiler first；`.tsrx` 是独立 authoring syntax，不是 `.tsx` 的后缀替换。逐文件
  TSRX 重写已按 manifest 完成；静态、第三方和 imperative owner 明确保留 `.tsx`，纯逻辑保留
  `.ts`；
- 旧版 `@dnd-kit/core` 直接切换到 Octane 已支持的现代 surface，tree behavior 需要重写；
- `cloneElement`/`Children` 直接删除，使用 Octane native component/data-flow 设计；
- Vite 直接升级到 8.1.5；Octane 当前 catalog 与 TSRX plugin 的真实 TypeScript 边界是 5.9.3。
  TypeScript 7.0.2 会在 plugin 解析 `typescript/lib/tsc.js` 时失败，等工具链发布兼容版本再升级；
- cloud website 与 Rust backend 保持合同不变，只接受迁移导致的回归修复。

`.scratch/octane` 与 `.scratch/markd` 继续只读；迁移实现位于 `app/`。

# Objective and boundary

目标不是证明“任何 React 应用都能跑在 Octane”，而是让 Markd 这个含 Tauri IPC、持久化文件、
富文本 editor、拖放树、多个窗口和动画的真实应用在 Octane 下保持可观察行为，并把失败归因到
明确的 Octane gap、binding gap 或 Markd seam。

首个 target 保持：

- `src-tauri/` Rust backend、vault layout、IPC command names/error payloads、capabilities、
  two-window Tauri configuration 和 cloud API 不做架构迁移；
- `src/` UI/state/frontend integration 迁移到 Octane；纯业务逻辑和 framework-neutral Tiptap/
  Tauri plugin calls 尽量复用；
- React-only runtime imports、React-specific types、StrictMode、forwardRef、children cloning、
  legacy dnd-kit API 作为明确迁移面处理；
- 不以性能 benchmark 替代正确性证明，不引入没有实际 consumer 的 compatibility shim。

# Phase 0 — Baseline and reproducibility

在 `app/` 创建 Markd 的可提交工作副本，原始上游继续留在 `.scratch/markd/`。记录：

- 上游 commit、pnpm/Node/Rust/Cargo、实际安装的 TypeScript/Vite/Tauri/TipTap 版本；
- 当前 pnpm/Vitest 纯逻辑 tests、`cargo test`、frontend typecheck/build、Tauri dev/build 的
  结果和失败原文；
- 主窗口、quick-capture、fresh vault、existing vault、external edit、update/error paths 的
  手工/浏览器 baseline 截图和可重放步骤。

这一阶段的出口是“基线可重复，失败可归因”。TypeScript 直接适配当前 Octane/TSRX 要求，不为
Markd 原有版本 pin 保留包袱。

# Phase 1 — Octane toolchain shell

在 `app/` 用包管理器添加当前 Octane 所需依赖，保留 Tauri 的 `base: './'` 与 `frontendDist`：

1. 用 `octane/compiler/vite` 接入 Vite；移除 React JSX plugin 和 React root wiring。
2. 配置 `jsxImportSource: octane`、`@tsrx/typescript-plugin` 和 `tsrx-tsc`；让 `.tsrx`、`.tsx`、
   `.ts` 的 include/resolution 与 Octane doctor 合同一致。
3. 先把最小 `main`/`App`/Tauri mock bridge 编译并在普通浏览器 mount；再接回真实 Tauri shell。
4. 若 Vite 7 与当前 Octane peer 不兼容，由 `pnpm add` 升级并让 lockfile 成为唯一版本记录，
   不手写猜测版本号。

出口：`tsrx-tsc --noEmit` 无 app diagnostics、production SPA 能在相对 asset URL 下构建，且 Tauri
Rust command/event contract 未改名。当前 Octane CLI 位于源码仓库的未发布 `@octanejs/cli` package，
因此不能把 `octane doctor/analyze` 当作本 app 可执行命令。

# Phase 2 — Framework-neutral core and official bindings

按依赖簇迁移 import 和类型，不同时重写 UI seam：

- `zustand` → `@octanejs/zustand`；验证 `useVault`、`useTabs`、`useUi` 等 store 的 selector、
  external update、session restore 和 store reset。
- `@tanstack/react-query` → `@octanejs/tanstack-query`；验证 publish status query key、focus
  invalidation、retry/error/reset，不启用与桌面 SPA 无关的 SSR 假设。
- `@tiptap/react` → `@octanejs/tiptap`、menus → `@octanejs/tiptap/menus`；核心 extension 继续
  使用 framework-neutral `@tiptap/*`。单独处理 3.23.6 → 当前 binding 3.28.0 的版本族变化。
- `motion/react`、`sonner`、`cmdk` 换到官方 Octane bindings；Lucide 图标由 Sigil manifest
  vendoring 并生成 Octane-native TSRX module，避免把 raw icon package source 带入 consumer
  typecheck。对其余 binding 先读 `status.json` divergence，再迁移调用点。
- Tauri 的 window/opener/process/updater plugin 继续直接 import；IPC/event hook 只在能保持
  `IpcError`、retry 和 teardown 合同时引入 `@octanejs/tauri`。

出口：所有 import 都有明确 owner；纯逻辑 tests 通过；尚未迁移的 React-specific seams 被列为
可搜索的 inventory，不以 `any` 或 module declaration 隐藏。

# Phase 3 — TSRX authoring and non-portable seams

按组件簇将 render-bearing files 转成 `.tsrx`，纯逻辑留在 `.ts`。使用 `@for`/`@if`/`@try`，
给无法静态证明为 string 的 text hole 加类型收窄，保留显式 effect dependency 的 authored 语义。

优先人工定义以下新合同，再允许 ast-grep/受控 subagent 批量转换相似文件：

1. `Input`/`Button`：普通 `ref` prop，删除 `forwardRef`；动作和 native event 类型重写。
2. `Tooltip`/`MorphPopoverTrigger`：取消 child cloning，采用显式 trigger props 或专用 trigger
   component；保留 aria、focus、outside-click 和 portal 行为。
3. `SharedLayoutBg`：取消 `Children.toArray` 和 `cloneElement`，调用者显式传入 row/item
   component 或数据；不能为了省事删除 shared background animation。
4. `ContextMenu`/`Modal`/`Tooltip`：用 Octane portal 只替换 renderer，单独验证 detached DOM、
   focus restore 和 unmount cleanup。
5. React `memo`/`lazy`/`ReactNode`/event types：使用 Octane 对应 API/types；不保留 React runtime。
6. 所有原生文本输入逐一判断：逐字编辑改 `onInput`，故意 commit/blur 的保持 `onChange` 并加
   `suppressNativeChangeWarning`；组件级 `onChange` callback 名称不改。

出口：`tsrx-tsc` 无 app compiler diagnostic；所有 children/refs/event 改写都有行为测试；不再
出现 `forwardRef`、React children introspection 或 legacy JSX assumptions。

# Phase 4 — High-risk feature clusters

## Editor cluster

以 `NoteEditor` 的“不 remount tab editor”为不可回退合同，迁移并验证：

- Tiptap `useEditor`/`EditorContent` 生命周期与 inactive panes 的 CSS hiding；
- Markdown/frontmatter 分离、autosave debounce、external edit reload、dirty editor wins；
- `CodeBlockWithCopy` 的 Octane NodeView、`NodeViewContent`、copy action；
- BubbleMenu/SelectionMenu、slash menu、find/replace、wiki links、image asset protocol；
- markdown paste、link sanitizer、property editing 和 raw source editor。

若 TipTap 版本差异造成行为变化，先判断是依赖族不兼容还是 binding defect，再决定升级、降级或
在 Octane binding 上补 evidence；不在 Markd 内复制一套 editor adapter。

## Tree and command cluster

- `FileTree` 从 legacy `DndContext`/sensor/collision API 改到现代 `DragDropProvider`、
  `useDraggable`/`useDroppable` 或 `useSortable`；保持 root/folder drop、不能 drop 到自身/后代、
  overlay、rename、keyboard tree navigation 和 pin filtering。
- `CommandPalette` 使用 `@octanejs/cmdk`，重点确认 native `onInput`、Dialog portal、selection、
  recent/search item ranking，以及没有依赖 `asChild`。

## Tauri/window cluster

- 维持 `main`/`quick-capture` 的 window label 分流，真实 Tauri command 与 event 名称不改。
- 先用 Workbench 风格的 browser mock bridge 覆盖 UI journeys，再用真实 Tauri host 验证 IPC、
  event unlisten、asset protocol、capability 和 relative bundle path。
- `@octanejs/tauri` 的 missing-host/error semantics 若与 Markd 现有 `IpcError` 不同，显式保留
  wrapper 或设计迁移边界，不让错误变成 silent rejection。

# Phase 5 — Reliability evidence

验证按“纯逻辑 → browser preview → real Tauri”递进：

| layer | required evidence |
| --- | --- |
| preserved backend | existing Rust tests；vault traversal、layout migration、notes CRUD/move/trash、search、backlinks、todos/bookmarks |
| preserved logic | frontmatter、markdown paste、note links、session、shortcuts、sidebar resize、publish data |
| Octane compiler | `tsrx-tsc`、production build；源码仓库的 `@octanejs/cli` 尚未发布，不能把 `doctor/analyze` 当作 app 命令 |
| browser | system Google Chrome 的 clean-profile Playwright journeys；fresh/existing vault mock、editor/autosave、tabs、menus、tree drag/drop、quick capture/error paths |
| Tauri | real main/quick-capture windows, Rust commands, events, asset protocol, capability and release bundle |
| comparison | React baseline vs Octane DOM/focus/selection/input/editor lifecycle/drag state/unmount cleanup；性能另表记录 |

浏览器自动化必须使用系统 Chrome，禁止下载 Playwright Chromium；若需要 clean profile，在 `app/`
内使用 repo-local `@playwright/test` 配置。每个失败要标记为 `confirmed`、`inference` 或
`unverified`，不能用“能打开窗口”覆盖功能缺失。

# Remaining implementation notes

1. **Legacy dnd-kit**：直接按现代 Octane binding 重写；只有真实编译/行为证据证明 API 无法表达
   tree contract 时，才重新评估 binding 边界。
2. **Children cloning**：直接以显式 trigger/item props 或子组件替代，不保留 React VDOM seam。
3. **Motion layout gap**：先跑真实 UI；缺失行为作为待实现 binding/应用 seam 处理，不预先删动画。
4. **TipTap version family**：依赖升级后直接验证 editor/NodeView，不为旧版本建立兼容层。
5. **Scope creep**：cloud website、release notarization 和 Rust domain logic 不属于 renderer port；
   只有迁移导致失败时才修复。

# Final implementation status

技术迁移完成，待用户做视觉验收。51 个初始 render 文件已收敛为 28 个 TSRX、20 个有明确 owner
理由的 TSX 和 3 个删除项；现代 dnd、native events、ErrorBoundary、ref、Base UI
Dialog/Popover/Tooltip 和 Tiptap 3.28 dependency boundary 已落地。

当前证据：严格 typecheck 无 dependency diagnostic allowlist；迁移时依赖 `#333/#335` 的本地绕行
已在正式修复发布后删除。Vitest、Vite production build、system-Chrome Playwright 与真实 Electron
journeys 均通过。历史 Tauri/Rust 门禁只描述迁移阶段，不再是当前 Electron 产品的验收合同。
