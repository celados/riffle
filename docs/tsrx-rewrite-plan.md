---
type: Plan
title: Markd render layer 的 TSRX 组件簇重写计划
description: 将 Octane TSX 迁移副本按语义簇重写为 TSRX，并以明确的 TSX owner、行为合同和完整门禁收敛结果。
status: completed
version: 1.0
timestamp: 2026-08-05T10:00:00+08:00
resource: https://tsrx.dev/llms.txt
superseded_by: ./solid2-migration-plan.md
tags: [octane, tsrx, markd, migration]
---

# Outcome

初始 51 个 render 文件已收敛为 28 个 TSRX、20 个明确保留的 TSX owner 和 3 个删除项，没有
React compatibility shim。TS5.9.3 保持不变：TSRX plugin 目前需要 TS5，TS7 只是后续 toolchain
适配项，不构成此次迁移的技术 blocker。

TSX 只保留在纯结构更清楚且没有 TSRX 控制流收益的组件，以及第三方/命令式 DOM owner（如
Tiptap NodeView、CodeMirror）中。每个保留点在 manifest 中有理由，不代表待迁移。

迁移时记录的 `octane#332/#333/#335/#336` 均已由正式版本吸收。当前严格 typecheck 无 dependency
diagnostic allowlist；`#333` 的 position-key materialization 与 `#335` 的 rich/source 双 owner
绕行也已删除。完整 production browser 与 Electron journeys 继续作为 AOT/runtime 回归门禁。

Reconnaissance 与逐文件 owner 已冻结在
[`tsrx-migration-manifest.md`](./tsrx-migration-manifest.md)。该 manifest 取代本文件的候选
A–E 清单成为实际 dispatch source；本文件继续拥有迁移原则与 handoff contract。

# Source contracts

实现以 [`tsrx.dev/llms.txt`](https://tsrx.dev/llms.txt) 和 working-dir 的
[`../AGENTS.md`](../AGENTS.md) 为上下文来源。Octane 的 `.tsrx` target 规则包括：

- setup 使用 `@{}`，并在模板输出前完成；模板分支使用 `@if`、`@for`、`@switch`、`@try`；
- 需要稳定 identity 的列表使用 keyed `@for`，不能把 slot-keyed hook 放入普通 JS loop；
- 动态 render region 使用有语义的显式 props（如 `trigger`、`content`、`icon`），由 owner
  直接组合，不转发或解析 opaque children；
- native text input 的逐字语义使用 `onInput`，commit/blur 语义才使用 `onChange`；
- hook、store、Tiptap、Tauri API 的迁移按当前 Octane binding 的真实 API 做，不由 TSRX 语法转换器
  猜测 React 语义。

# P0 — Base UI adoption and contract freeze

`src/components/ui/` 不是默认 TSRX 重写范围。先核对并采用 Octane 已有的
`@octanejs/base-ui`，只有 binding 无法表达的 Markd-specific behavior 才进入后续重写。

当前安装的 `@octanejs/base-ui@0.1.21` 提供 Dialog、Popover、Tooltip、Menu、Menubar、ContextMenu
和表单控件。它仍是 alpha；具体采用能力必须以 package exports、source、tests 与 Riffle browser
journeys 为准，不能把“package 存在”直接等同于行为兼容。

P0 由主 agent 线性完成，拥有 `app/package.json`、`app/pnpm-lock.yaml`、
`app/pnpm-workspace.yaml` 和以下 adapter 文件：

- `app/src/components/ui/Button.tsx` → `@octanejs/base-ui/button`
- `app/src/components/ui/Input.tsx` → `@octanejs/base-ui/input`
- `app/src/components/ui/Tooltip.tsx` → `@octanejs/base-ui/tooltip`
- `app/src/components/ui/ContextMenu.tsx` → `@octanejs/base-ui/context-menu` after caller ownership migration
- `app/src/components/ui/Modal.tsx` → `@octanejs/base-ui/dialog`（确认语义另核对 alert-dialog）

这些 local files 可以保留为 Markd styling/API adapters；它们不是 React compatibility shim，而是把
Markd 的 variant、class、label/side 和 menu item contract 接到 headless Base UI primitive。P0
`motion/popover-morph.tsrx` 已改用 `@octanejs/base-ui/popover`，并以显式 `trigger`/`content`
输入取代 opaque children：Base UI 接管 trigger composition、portal、positioning、dismissal 和 focus，clip-path appearance 由
`data-starting-style`/`data-ending-style` CSS transition 保留。两个 caller 都没有 shared
`layoutId` 合同，因此删除本地 Motion lifecycle 不构成行为降级。

P0 输出必须是：base-ui capability matrix、每个 adapter 的行为 oracle、已知 alpha divergence、
依赖变更、以及后续 worker 的冻结 manifest。没有这份输出，不启动并行 TSRX conversion。

当前 P0 进度见 [`base-ui-capability-matrix.md`](./base-ui-capability-matrix.md)：dependency、Input、
Button、Tooltip、Modal/Dialog、Popover adoption 已完成并通过 frozen install、typecheck/build/test；
Modal 与 Note actions Popover 的语义交互另经 system Chrome 验证。ContextMenu 已正式发布，但其
Root/Trigger owner 位于 FileTree/PinnedNotes callers，不能只替换 adapter 文件；当前 local owner
保留是尚未执行 app migration，而不是 dependency limitation。

Motion 崩溃已确认不是 hook slot 错位：TSRX call site 传 children render function，而 TSX
value position 传 createElement descriptor；`octane@0.1.17` 的 `hostComponent` 错把后者也当函数。
修复与更新回归已提交 [`octanejs/octane#328`](https://github.com/octanejs/octane/pull/328)，并已进入
当前安装的正式版本；旧 pnpm patch 已删除。fresh pnpm install、typecheck、production build
以及 system Chrome 的 Welcome、Settings/Motion、Dialog focus 和 ready AppShell journey 已通过。
因此 Motion 不再是 reconnaissance blocker。Button/Modal/Popover 保留当前更简单的 CSS state transition，不为
“恢复 Motion”而恢复没有产品价值的 composition。

# Subagent work packages

每个 package 都应在独立副本中完成，输入和输出必须限定在列出的文件簇。主 agent 合并前独立运行
`pnpm run typecheck`、`pnpm run build`，并检查是否偷偷恢复 React-only API。

## MUST READ references

子 agent 收到任务后，开始编码前必须读取以下 references；任务提示中必须逐项列出它们，不能只给
一个目录或一句“参考 Octane”:

- [`AGENTS.md`](../AGENTS.md)：working-dir 边界、Markd 数据合同、Octane 规则、已知 seam 和证据门槛；
- [`docs/port-plan.md`](./port-plan.md)：已接受的迁移范围、已落地 binding 替换和不可回退行为；
- 本计划：当前组件簇的边界、编排顺序和 handoff 合同；
- [`tsrx.dev/llms.txt`](https://tsrx.dev/llms.txt)：TSRX setup、`@for`/`@if`、hook slot、children
  和 native event 的 source of truth；
- [`base-ui.com/llms.txt`](https://base-ui.com/llms.txt)：Base UI 1.6.0 component、composition、
  accessibility 和 animation 文档入口；具体采用能力仍须与 Octane port 的 status/source/tests 交叉核对；
- `.scratch/octane/examples/workbench/` 中与任务相关的先例，以及目标 binding 的
  `README.md`、`status.json` 和 source/type tests；
- `.scratch/markd/` 中对应的原始实现、tests 和 Rust/IPC 合同；不得只读取迁移后的 `app/`。

按 package 追加的 MUST READ references：

| package | additional MUST READ |
| --- | --- |
| A | [`base-ui-capability-matrix.md`](./base-ui-capability-matrix.md)；`base-ui.com/llms.txt` 链接的 Button/Input/Tooltip/ContextMenu/Dialog/Popover/Composition/Animation pages；`app/src/components/ui/{Button,Input,Tooltip,ContextMenu,Modal}.tsx`；`.scratch/octane/packages/base-ui/{README.md,status.json,src/{button,input,tooltip,context-menu,dialog,popover}.ts,tests/}` |
| B | manifest 中 B 的当前 `.tsrx`/`.tsx` owners、原始对应文件和 stores；`.scratch/octane/packages/dnd-kit/`；keyed `@for` examples |
| C | manifest 中 C 的当前 `.tsrx`/`.tsx` owners；`motion/popover-morph.tsrx` 的 frozen API；`.scratch/octane/packages/{cmdk,base-ui}/README.md`、`status.json`、portal tests |
| D | manifest 中 D 的当前 `.tsrx`/`.tsx` owners；原始 editor tests；`.scratch/octane/packages/tiptap/{README.md,status.json,src,tests}` |
| E | manifest 中 E 的当前 owner/deletion decisions 与 callers；`.scratch/octane/packages/motion/{README.md,status.json,src,tests}` |

| package | input cluster | work | invariants |
| --- | --- | --- | --- |
| A | P0 已完成的 base-ui adapters（仅上述 5 个文件） | 先替换 primitive owner；TSRX 只在 adapter 确实从 `@{}`/`@if` 获益时转换 | variant/class、ref、native input、aria、focus、portal 合同不变 |
| B | 上述封闭 tree/sidebar/bookmark/todo 文件 | 将 render loops 改为 keyed `@for`；不修改 A 的 UI adapters 或共享 stores | root/folder drop、invalid descendant、keyboard navigation、selection 和 reorder 不变 |
| C | 上述封闭 palette/AppShell/PropertyNameMenu 文件 | 在 P0 冻结 popover API 后使用 Base UI Popover/Cmdk；只改显式 trigger/content data-flow | outside click、focus restore、portal cleanup、escape 和 selected item 不变 |
| D | `editor/*.tsx` 除 `PropertyNameMenu.tsx` | 用 TSRX statement container 和控制流表达 editor panes、menus、find/replace、source view | 每个 tab 的 editor 不 remount；autosave、frontmatter、paste、selection 和 NodeView 不变 |
| E | 上述 5 个 motion 文件；callers 只读 | 只转换明确收益的 render branches；shared layout 输入保持显式 item/renderItem | 不删除动画掩盖 binding gap；layout/layoutId、reduced-motion、unmount cleanup 有证据 |

# Handoff contract

交给子 agent 的任务必须包含以下内容，而不是只给一个“把 TSX 转 TSRX”的目标：

1. `MUST READ` references 清单，以及每份 reference 对本任务的具体用途；
2. 文件清单和允许修改的目录；
3. 当前实现已经满足的行为合同，以及不能顺手改变的 props/store/IPC API；
4. 目标语法示例：setup 用 `@{}`、列表用 keyed `@for`、动态 children 用显式 prop；
5. 明确禁止的模式：后缀批量替换、普通 JS loop 中调用 hook、React children introspection、
   为了通过类型检查加入 `any` shim；
6. 完成时必须报告：修改文件、仍保留 TSX 的文件及理由、typecheck/build 结果、未验证行为和
   可能的 binding gap。

# Orchestration and isolation

前几轮严格串行；parallel 是 reconnaissance 完成后的结论，不是开工时的假设。这里的 A–E 只是
候选 work-package 标签，不代表已经批准并行，也不是目录名。主 agent 必须按以下顺序推进：

1. **P0 base-ui adoption（串行）**：完成 capability matrix、primitive adapter、依赖边界和
   第一版行为 oracle。
2. **Reconnaissance（串行）**：逐文件梳理所有 render-bearing components、import/API graph、
   repeated patterns、TSX→TSRX 转换收益、binding gaps、测试入口和 browser journey。此阶段可以
   使用只读 explorer，但不并行写入，不把同类文件提前分派给多个 worker。
3. **Manifest freeze（串行）**：主 agent 生成最终逐文件 manifest，明确每个文件唯一 owner、只读
   caller、禁止修改的 shared store/IPC/editor contract，并为每个簇绑定 executable command 和
   oracle。这里没有 “F package”：未归类文件由主 agent 在 manifest 中逐项归属，不能用 residual
   wildcard 委派。
4. **Parallel decision**：只有在 manifest 完成后，才检查哪些任务真正具有重复性且 write scopes
   不重叠；满足条件才建立并行 wave。没有重复性或存在共享 API 依赖，就保持线性。任何 parallel
   wave 都必须使用独立 Git-backed worktrees；没有隔离就不并行。
5. **Linear integration**：主 agent 按依赖合并、运行全局 gates、补齐 browser/Tauri evidence；不
   把 worker 自报成功当作证据。

当前 working_dir 是 Lore-owned、非 Git 目录，不能直接用 `git worktree`。若启用并行子 agent，
主 agent 必须先从当前 `app/` 创建临时 Git-backed migration mirror，再为每个 package 创建独立
worktree；结果以可审查 patch 方式合回 `app/`，临时 mirror/worktrees 不得成为 workspace project。
如果没有可用的 worktree 隔离，就退回按上述依赖顺序线性执行，不在同一 `app/` 上并发写入。

# Merge and evidence gates

合并顺序按依赖关系：P0 base-ui adoption → serial reconnaissance → manifest freeze →（若满足
条件）parallel wave → linear integration。任何簇都不得以“其它簇之后会修”掩盖自己的 compiler
error。

每簇完成后至少执行：

- `pnpm run typecheck`
- `pnpm run build`
- P0 冻结的该簇 browser journey command、oracle 和对应纯逻辑测试；不存在“若已有”豁免
- `rg` 检查 React runtime、`cloneElement`、`Children`、`forwardRef` 和 legacy dnd imports

TSX fallback 不是失败；未完成的行为验证才是未完成。最终目标是尽量让高重复、控制流密集、列表
identity 敏感的 UI 使用 TSRX，同时保持可读、可验证的 Octane-native 边界。
