---
type: Plan
title: Riffle renderer 从 Octane 迁移到 Solid 2
description: >
  把 renderer runtime 换成 Solid 2 RC 并写标准 TSX：先用生态 spike 作硬门禁验证
  Solid-1.x-era 依赖能否在 2.0 存活，再按 store → 叶子 → 功能簇 → 外壳的依赖方向
  逐 wave 重写 47 个 render 文件，并把 agent 的真相指针从 Octane 翻到 Solid 2 RFC。
status: draft # draft | accepted | in-progress | completed
version: 0.3
generated: { by: claude-code/opus-5, at: '2026-08-19T00:00:00+08:00' }
resource: ./adr/0003-adopt-solid-2-as-the-renderer-runtime.md
supersedes:
  - ./port-plan.md
  - ./tsrx-rewrite-plan.md
  - ./tsrx-migration-manifest.md
  - ./base-ui-capability-matrix.md
tags: [riffle, solid-2, octane, migration, renderer, agent-native, tsrx]
---

# Riffle renderer 从 Octane 迁移到 Solid 2

## 判决

Renderer runtime 换成 `solid-js@2.0.0-rc.0`，语法层写标准 Solid TSX。裁决理由见
[ADR 0003](./adr/0003-adopt-solid-2-as-the-renderer-runtime.md)。

这不是依赖替换。Octane 提供的是 React 形状的 hooks，组件会重跑；Solid 组件 setup-once，
函数体只执行一次。代码里有 **343 处 hook 调用点**（`useState` 104、`useEffect` 85、
`useRef` 77、`useCallback` 33、`useMemo` 24、`lazy` 7、`useLayoutEffect` 4、`memo` 4、
`Suspense` 3、`createRoot` 2），每一处都要按新的执行模型重新想一遍，而不是改个名字。
机械翻译 hooks 会产出能编译、能渲染、行为错的代码——这是本次迁移的头号失败模式。

## 边界

**在范围内**：`src/` 下 47 个 render 文件（8794 行，不含 Sigil 生成的 `icons.tsrx`）、
8 个 store、构建工具链、agent context 与 skill。

**不在范围内**：

- `electron/` — main、preload 和 utility engines 无框架依赖，`window.riffle` bridge 合同不变。
- `CONTEXT.md` — 产品语言刻意独立于 runtime，本次不动一个字。
- `docs/v2-engine-architecture.md` — 仍是 draft。本计划迁移的是当前出货的 renderer；
  v2 的「轻量 Desktop UI」按继承 Solid 2 基座处理，不在这里预先裁决。
- Vault 磁盘格式、Collections、Cloud 协议、updater。

## 迁移成本的真实分布

代价不在 8794 行，在三层耦合：

| 层 | 现状 | 目标 | 性质 |
| --- | --- | --- | --- |
| 反应式语义 | Octane React-hooks，组件重跑 | Solid 2 signals，setup-once | **逐处重想**，343 个调用点 |
| 状态容器 | `@octanejs/zustand`（8 store） | `createStore` / signals + `createRoot` | 重写；module singleton 需显式 owner |
| Headless UI | `@octanejs/base-ui`（5 文件） | 自建 `@celados/solid-zag` + `@celados/solid-ark` | 见「Headless UI 自建」 |
| Motion | `@octanejs/motion`（15 文件） | `solid-motionone` | 上游 2025-04 起未更新 |
| Toast | `@octanejs/sonner`（15 文件） | `solid-sonner` | 活跃（0.3.2 / 2026-08-16） |
| 数据获取 | `@octanejs/tanstack-query`（2 文件） | `@tanstack/solid-query` | 活跃，但 Solid 2 兼容待验 |
| Command palette | `@octanejs/cmdk`（1 文件） | `cmdk-solid` | 上游 2025-02 起未更新 |
| DnD | `@octanejs/dnd-kit` | — | **零使用，直接删依赖** |
| 编译工具链 | `octane/compiler/vite` | `vite-plugin-solid@3.0.0-next.27` | 与 rc.0 同步发布 |
| 图标生成 | `sigil etch --jsx octane` | `--jsx solid` | Sigil 已原生支持，改一个 flag |

## 三个缩小暴露面的既有事实

这些不是计划要做的事，是已经成立的条件，直接削掉了本可以很险的部分：

1. **没有 SSR / hydration。** Riffle 是 client-only Electron renderer。Solid 2 RC 风险最集中
   的那片面——`ssrSource`、`deferStream`、`transparent`、streaming、hydration id 对齐——完全
   不在暴露面内。
2. **Markdown 层已经和框架解耦。** `src/markdown/riffle-markdown.ts`（557 行）是纯 TS：把
   Comark AST 投影成 framework-agnostic 的 `ProjectedNode`。Comark 本身零框架 peer。只有
   `readonly-markdown-view.tsx`（535 行）是框架层，需要重写。
3. **CodeMirror 与 `@pierre/trees` 是 vanilla runtime。** Source Editor 和文件树的核心不随
   框架走，改的是它们的宿主组件与生命周期接线。

## Phase 0 — 生态 spike（硬门禁）

**这一阶段不通过，不动任何产品代码。**

### 生态候选：peer range 已经给出答案

不需要逐个 spike。Solid 生态的 peer 声明直接排除 2.0：

| 候选 | peer | 结论 |
| --- | --- | --- |
| `@kobalte/core` | `^1.9.8` | 装不上 |
| `solid-sonner` | `^1.6.0` | 装不上 |
| `@tanstack/solid-query` | `^1.6.0` | 装不上 |
| `solid-motionone` | `^1.8.0` | 装不上 |
| `cmdk-solid` | `^1.8.0` | 装不上 |
| `@ark-ui/solid` | `>=1.6.0` | 范围宽松但用了已删 API，见「Headless UI 自建」 |
| `@zag-js/*` | **无 peer** | 框架无关，可用 |

Solid 2 上没有可直接消费的第三方 UI / 状态生态，替代路径全部是自建或框架无关库：

- toast：Riffle 用法很薄，自建。
- 数据获取：`@tanstack/solid-query` 直接删掉——async `createMemo` + `Loading` 是 2.0 原生
  能力，两个调用点不值得引一层。
- 动效：纯 CSS。Riffle 的动效合同本来就只有 100–160ms ease-out。
- command palette 与 headless：solid-ark。
- `@octanejs/dnd-kit` 零使用，直接从 `package.json` 删除。

### solid-zag 地基验证 — 已通过

自建路线唯一的真实未知是「Zag 机器能不能在 Solid 2 上跑」。已验证：**能**。

`.scratch/solid2-spike/` 把 `@zag-js/solid@1.43.1` 移植到 Solid 2 RC，dialog 与 menu 两台
机器的完整交互链（trigger → transition → DOM）跑通，且 machine 建立过程零 strict-read
警告。移植改动只有四处，全部记在该目录的 `SPIKE.md`：`onMount`/`mergeProps` 换名、
`createEffect` 改两相形式、初始化期的 reactive 读显式 `untrack`、effect 回调不能有返回值。

这份代码是 `@celados/solid-zag` 的第一版实现，repo 建立后直接搬——不要从上游重拷。
未覆盖的是 presence（退出动画）、focus trap、嵌套机器（menu 的 submenu）和 SSR，
它们属于 solid-ark 的 class-(b) 面。

**门禁状态**：地基已过。Wave 1（状态层）可以开始——它不依赖 headless 层。

## Headless UI 自建

Solid 的 headless 生态在 2.0 上不是「需要验证」，是**装不上**：`@kobalte/core` 的 peer 是
`solid-js ^1.9.8`，`solid-sonner` 是 `^1.6.0`——两者都硬性排除 2.0。`@ark-ui/solid` 的
`>=1.6.0` 只是范围碰巧宽松，不代表测过：它的库代码里 `onMount` 有真实调用（`use-fieldset.ts`、
`menu-root.tsx`——后者正是 Riffle 需要的 menu），`<Index>` 有 12 个文件在用，这两个 API 在
Solid 2 都不存在。

所以 headless 层自建，分两个包，形状照搬
`projects/ripple-ark`（同一套设计已在 Ripple 上跑通并发布到
`npm.celados.com`）：

- `@celados/solid-zag` — Zag core 的 Solid 2 绑定：`normalizeProps` + `useMachine`。
- `@celados/solid-ark` — Ark 的 compound 组件词汇表（`Root`/`Trigger`/`Content`/context），
  由 codegen 从 Ark 上游生成。

两条既定合同直接沿用，不重新讨论：

- **组合走 Base UI 的 function-form `render` prop，不做 asChild。** 不是风格偏好——asChild
  依赖 React 的 element cloning，在 Solid 的求值模型下没有对应物。`render` 收到的是 part
  合并后的活 props 对象，回调里读属性仍订阅机器状态，返回值整个替换默认元素。同时排除
  `as` prop 和 element-form `render={<X />}`。
- **所有元素渲染走一个 `Part` frame**，由它统一持有 render 分支、presence gate、composed ref
  和 void-tag 处理；生成的声明只写 `tag` / `options` / `gate` 这些真正变化的部分。

**首批只做 5 个机器**：dialog、popover、tooltip、menu、combobox。这是 Riffle 现在真正用到的
面——`Input` 和 `Button` 在 Zag 里没有对应机器，Wave 2 直接写成原生元素，`@octanejs/base-ui`
随之整个退出依赖表。ripple-ark 的 generator 覆盖 51 个组件，codegen 让后续扩面很便宜；
现在就承诺全量 parity 会让这个 lib 变成整条迁移的关键路径。

移植成本的分布沿用 ripple-ark 的 upstream-sync 分类法（见该仓库
`.agents/skills/upstream-sync/SKILL.md`）：

- **class (a) 声明式表面**（tag + zag getter + prop keys + context 链）几乎零成本转移，
  换的只是 emit 模板。
- **class (b) 命令式语义**（effect、嵌套机器、presence、派生 children）是真正的移植工作，
  必须逐个手工重写——而且这正是上游 Solid 1.x 惯用法聚集的地方（`onMount`、`<Index>`、
  `createEffect` 的旧形态），不能跨 target 复用 Ripple 版的 override。
- **class (c) hook 层注入**（`id` / `dir` / `getRootNode`）是一份共享实现。

生成器（`scripts/generate-bindings.ts`，1512 行）、`binding-runtime`（497 行）、
`create-machine.ts` 和这套分类法是可复用资产；per-target 重写的是 emit 模板、
binding-runtime 的框架接触面和 class-(b) override。

Zag 版本先与 ripple-ark 对齐在 `^1.43.0`，除非有明确理由才独立升。

## Wave 清单

依赖方向自底向上：store 是所有组件的依赖根，外壳最后换。每个 wave 独立可验证，
oracle 见下节。沿用 [`tsrx-migration-manifest.md`](./tsrx-migration-manifest.md) 的单一 owner
约定：一个文件在一个 wave 内只有一个负责人，跨 wave 的行为变更必须先在本文件登记。

**Wave 0 — 基座与真相指针**（不碰组件）

- `package.json` / `vite.config.ts` / `tsconfig.json`：Octane 依赖与 `jsxImportSource` 换成 Solid；
  删 `@octanejs/dnd-kit`；`icons:generate` 改 `--jsx solid`。
- `AGENTS.md`：framework sources of truth 从 Octane/Ripple llms.txt 翻到 Solid 2 RFC 目录
  （见「Agent-native workstream」）。**这一步必须和工具链切换同一个 commit**——AGENTS.md 描述
  的是当前代码库，提前翻会让每一次 agent session 都基于错误前提工作。
- `.agents/skills/solid2/` 落地并提交。
- 建立一条能跑起来的空 Solid 2 shell（`main.tsx` + 一个占位组件），证明 build / typecheck /
  Electron 装载链路通。

**Wave 1 — 状态层**（`src/stores/` 8 个文件 + `src/lib/`）

`vault`、`tabs`、`todos`、`bookmarks`、`pins`、`ui`、`shortcuts`、`updater`。纯 TS，无 JSX，
可以完全先于组件完成。

需要显式裁决的一点：zustand store 是 module singleton，随便在哪都能订阅；Solid 的 store
要有 owner。用 `createRoot` 建一个应用级 reactive root 承载这些 store，并明确它的 dispose
时机——这是 Solid 有公开 ownership 协议的直接收益，别用「反正 app 不卸载」糊过去。

`lib/session.ts` 的 localStorage 持久化要跟着改订阅方式（当前依赖 zustand subscribe）。

**Wave 2 — 叶子元件**（`components/ui/` 12 文件 + `components/motion/` 2 文件）

`Button`、`Input`、`Spinner`、`StatusBadge`、`Tooltip`、`CopyButton`、`Modal`、`ContextMenu`、
`ErrorBoundary`、`TagList`、`TagPicker`、`TagRail`、`action-swap`、`popover-morph`。

`ErrorBoundary.tsx` 不是原地重写，是**删除**：Solid 2 的 `Errored` 是包在消费者外面的边界组件，
不是这个文件的替身。删掉自建实现，把它的调用点改成 `<Errored>`；注意 fallback 的 callback 形态
收到的是 error accessor 加 reset action（`(err, reset) => ...`，读值要 `err()`），和现有 render prop
不是一对一。这里的目的是让错误只有一条路径，包一层 shim 保住旧签名就把这个设计废掉了。
`ContextMenu.tsx`、`Modal.tsx`、`Tooltip.tsx`、`popover-morph.tsx` 都**阻塞在 solid-ark 上**——
首批 5 个机器不到位，Wave 2 只能推进不依赖 headless 的那部分。`Input`/`Button` 不受影响，
它们变成原生元素。

**Wave 3 — 树与命令面板**（`components/tree/` 4 文件 + `components/palette/` 1 文件）

`trees-file-tree.tsx`（522 行，`@pierre/trees` 宿主）、`PinnedNotes`、`FolderMorphIcon`、
`RenameInput`、`CommandPalette`（314 行，cmdk 宿主）。

`CommandPalette` 阻塞在 solid-ark 的 combobox 上。

两个都是第三方 vanilla runtime 的宿主，重点是生命周期与 ref 接线，不是渲染逻辑。
backlog 里 `@pierre/trees` 声明 React peers 却要跑 vanilla 的那条待验证项，在这个 wave 一并
证明——换框架后「不会安装或加载 React」这个判据反而更容易立。

**Wave 4 — 编辑器簇**（`components/editor/` 14 文件 + `markdown/` 1 文件）

最大的一簇：`NoteEditor`（590）、`PublishNoteModal`（442）、`FindReplaceBar`（256）、
`TabBar`（217）、`PropertyRow`（211）、`PropertyValueEditor`（194）、`PropertyNameMenu`（185）、
`MarkdownSourceEditor`（135）、`LinkedMentions`（119）、`NoteProperties`（113）、
`BacklinksSidebar`（59）、`TitleInput`（48）、`NoteBreadcrumb`（37）、`NotesWorkspace`（31）、
`readonly-markdown-view`（535）。

三条必须原样保住的行为合同：

- **Tab 切换是 CSS toggle，不是 remount。** `NotesWorkspace` 用 `display:none` 隐藏非活动
  pane。Solid 的 `<Show>` 默认会销毁分支——这里要的是 keyed 保留，改错了会让每次切 tab 重新
  解析 Markdown，而且不会有任何报错。
- **Source Editor 500ms debounce autosave，unmount 时 flush。** 在 Solid 里 flush 挂
  `onCleanup`，且要确认 owner 销毁顺序不会先干掉 CodeMirror 实例。
- **脏编辑器保留本地草稿直到显式解决写冲突。**

**Wave 5 — 功能页与面板**（settings / todos / bookmarks / welcome / updater / capture，9 文件）

`SettingsPanels`（506）、`CloudAccountCard`（346）、`BookmarksPage`（308）、`TodosPage`（263）、
`SettingsModal`（173）、`QuickCaptureWindow`（215）、`ReleaseNotesModal`（74）、`Welcome`（62）、
`ResizableSidebar`（117）。

`QuickCaptureWindow` 是独立窗口入口，有自己的 mount 路径，别漏。

**Wave 6 — 外壳与入口**（`layout/` 2 文件 + `App.tsx` + `main.tsx`）

`AppShell`（625）、`Sidebar`（237）、`App`（200）、`main`（32）。

`main.tsx` 的 `createRoot` 语义在 Solid 里不同（`render` from `@solidjs/web`），
`main.tsx` 里的全局 `focusin` no-autocorrect hook 要保留。
`App.tsx` 的 `Suspense` 换成 `Loading`；`lazy` 在 Solid 2 保留（不在 core 的 Not Implemented
清单里），换的是它外层的边界，不是它本身。

## 门禁与 oracle

每个 wave 的收敛判据，按成本从低到高：

1. `pnpm run typecheck` — 严格通过，不保留 dependency diagnostic allowlist。
2. `pnpm run build` — 生产构建通过。
3. `pnpm run test:browser` — **现有 35 条 browser journey 是本次迁移的行为合同**。它们覆盖了
   tab、编辑器、树、设置、todos、bookmarks 的真实路径，正好是「能编译但行为错」这类失败的
   唯一有效探测器。每个 wave 结束跑全量，不跑子集。
4. `pnpm run test:electron` — secure-shell 与 native smoke。
5. `pnpm run package:test` — 仅在 Wave 6 之后跑一次，验证打包产物。

Playwright 固定 preview port `4173` 的并发冲突（见 `.agents/backlog.md`）在多 wave 并行时会
更频繁地撞上。并行推进前先给测试编排分配隔离端口，别靠杀进程绕过。

## Agent-native workstream

这条线和代码 wave 同等重要，因为**默认失败模式是 agent 写出 Solid 1.x**。

问题的形状：Solid 2 删掉了 `createResource`、`batch`、`startTransition`/`useTransition`，
把 `Suspense` 改成 `Loading`、`ErrorBoundary` 改成 `Errored`、`onMount` 改成 `onSettled`。
所有模型的训练语料都是 1.x，而 **1.x 写法在 2.0 里大多不报错，只是行为不对**。
更糟的是 `docs.solidjs.com` 整站仍是 1.x 文档，`ctx` 的 `solidjs` llms 索引就指向它——
agent 去「查文档」会查到错误的那一份。

三件事：

1. **`.agents/skills/solid2/`**（Wave 0 交付）。以删除清单和替换映射为主体，不是教程。
   核心内容：被删 API 的对照表、写入 owned scope 的禁令、顶层 reactive read 的禁令、
   `Loading`/`Errored`/`isPending` 的用法、以及「不要读 docs.solidjs.com」的显式警告。
2. **真相指针翻转**（Wave 0，与工具链同 commit）。`AGENTS.md` 的 framework sources of truth
   段落改指：
   - `https://github.com/solidjs/solid/tree/next/documentation/solid-2.0` — RFC 目录，Solid 2
     语义的事实来源
   - 同目录 `MIGRATION.md` — 1.x → 2.0 的完整替换表
   - 显式声明 `docs.solidjs.com` 是 1.x，不适用
   同时删掉 Octane 与 Ripple llms.txt 两条指针。
3. **工作项路由**。每个 wave 按 [`docs/agents/issue-tracker.md`](./agents/issue-tracker.md)
   的合同开 issue，用 blocking edge 表达 wave 依赖顺序，`ready-for-agent` 标签控制并行度。

## RC churn policy

Solid 2 从 beta.15 到 rc.0 用了约五周、二十个版本，节奏是两天一版。迁移期间上游还会动。

- **精确 pin** `solid-js` 与 `@solidjs/web` 到 `2.0.0-rc.0`，不用 `^`。
  `vite-plugin-solid` 同样精确 pin。
- 迁移进行中**不跟版本**。只有当某个版本修掉了正在阻塞 wave 的确切 bug 时才升，升了要在
  本文件登记版本号与理由。
- Wave 6 收敛后统一评估一次是否升到当时的最新 RC / stable。
- Solid 2 正式版发布后，重新评估 TSRX Solid target（ADR 0003 里的 re-entry gate）。

## 风险登记

| 风险 | 判据 | 处理 |
| --- | --- | --- |
| Solid 1.x 生态包在 2.0 运行时坏掉 | Phase 0 每个候选的三选一结论 | 门禁不过不进 Wave 1 |
| 机械翻译 hooks 产出「能跑但行为错」 | 35 条 browser journey 全量通过 | 每 wave 跑全量，不跑子集 |
| agent 写出 1.x 语法且不报错 | skill + 真相指针 | Wave 0 先落地，早于任何组件改动 |
| Solid headless 生态整体不支持 2.0 | Kobalte/solid-sonner 的 peer 直接排除 2.0 | 自建 solid-zag + solid-ark，首批 5 机器 |
| solid-ark 在 Wave 2/3 的关键路径上 | 首批 5 机器是否就绪 | 单人 lib 卡住整条迁移是真实风险；Wave 2 先做不依赖 headless 的部分，必要时缩到 3 个机器 |
| Tab CSS-toggle 语义被 `<Show>` 悄悄改成 remount | 切 tab 不重新解析 Markdown | Wave 4 的显式合同，加 journey 断言 |
| RC 上游 churn 打断迁移 | 精确 pin + 不跟版本 | 见 RC churn policy |
| 多 wave 并行撞 Playwright 固定端口 | 现有 backlog 条目 | 并行前先隔离端口 |

## 不做什么

- 不保留 Octane 兼容层，不写 hooks shim。旧路径直接删。
- 不在迁移期间做产品功能变更。行为合同就是当前 35 条 journey，变更另开 issue。
- 不动 `CONTEXT.md`、`electron/`、Vault 磁盘格式。
- 不预先为 v2 engine 架构做设计让步。
