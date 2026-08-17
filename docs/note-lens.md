---
type: Proposal
title: Note Lens — 把看板/表格/日历做成 Note 集合的投影模式
description: >
  引入 Lens：一个本身就是普通 Note 的「范围 + 过滤 + 分组 + 渲染模式」定义。
  board / table / calendar 由此成为同一机制的渲染模式，而不是三个各自独立的功能。
status: draft # draft | accepted | superseded
version: 0.2
generated: { by: claude-code/opus-5, at: 2026-08-17T12:10:00+08:00 }
tags: [riffle, vault, index, frontmatter, projection, proposal]
---

# Decision

Riffle 引入 **Lens**：一个持久化为普通 Note 的对象，声明「取哪些 Note、按什么过滤、按哪个属性分组、用哪种模式渲染」。看板不是一个功能，而是 Lens 的一种渲染模式；表格、日历是同一机制的另外两种模式。

在可写的 FS 源上，Lens 定义存在 Vault 里（一个 `.md` 文件），不进 app data。这样 agent 创建一个看板 = 写一个 markdown 文件，无需 app API，也不会产生只在 Riffle 内可读的数据。只读源是唯一的例外，见 [视图定义存哪](#视图定义存哪由-source-的-mutate-能力决定)。

v1 是**只读投影**：Lens 渲染集合，但不通过拖动改写被投影的 Note。

# 起因

`~/workspace/inbox/` 已经是一个纯 markdown 的消息 feed：每条消息一个 OKF 文件，frontmatter 带 `type` / `description` / `timestamp` / `status` / `source`，triage 就是 `mv` 到别处（见 workspace `inbox/AGENTS.md`）。这个模型本身不需要改进——它缺的只是一个能一眼看完的视图。

Riffle 这边，产品模型已经对上了：Vault 就是文件夹，Note 按路径寻址，属性就是 YAML frontmatter，Properties 已经是一等产品词。缺的是两样东西——把「一组 Note 按属性分组渲染」变成 Vault 里的一等对象，以及一层能按属性检索的索引（后者是真实成本，见下文）。

# 语言（CONTEXT.md delta）

新增一条，并修订 Collection 的边界说明：

> **Lens**:
> 一个 Note，其 frontmatter 声明了对 Vault 中其他 Note 的范围、过滤、分组与渲染模式。Lens 不拥有被它引用的数据——它是一次可持久化、可版本控制的投影声明，被投影的 Note 仍然只属于自己的文件。
> _Avoid_: Collection, database, view, board

`board` / `table` / `calendar` 是 Lens 的**渲染模式**（mode），不是独立概念，不进 Language。

**为什么不能叫 Collection**：`Collection` 在 CONTEXT.md 里已经指「Riffle 拥有的结构化条目」，当前是 Todos 与 Bookmarks。那是 Riffle 拥有数据；Lens 恰恰相反，它一个字节的用户数据都不拥有。复用这个词会让两种相反的所有权语义共享一个名字。

> v2 草案把 Collection 的**存储位置**解绑了（不再必然在 `.markd/`，Todos/Bookmarks 迁往 authoritative business tables），但**所有权语义**反而更强了。这条命名论据不受影响。

**为什么不能叫 View**：`Readonly View` 已占用，且指的是单个 Note 的渲染投影。

> 词本身待定。`Lens` 是本提案的推荐；备选见 [Open questions](#open-questions)。全文用 Lens 指代该对象。

# 设计

## Lens 是 Note 级投影，不是 body 里的嵌入组件

Riffle 当前对一个 Note 有两种投影：Readonly View 与 Source Editor。**Lens 渲染是与它们并列的第三种 Note 级投影**，由 frontmatter 的 `type: Lens` 选择，而不是由 body 里的某个语法块触发。

这条边界是刻意的：它让 Lens 不触碰 Riffle Markdown 的方言定义（CONTEXT.md 明确「agent-native UI components 不属于当前方言」），也不触碰 ADR-0002 的 Embedded Markup 渲染政策。Lens Note 的 body 仍然是普通 markdown（可以写这个看板是干嘛的），Source Editor 打开它就是看到那段 YAML 和那段说明——永远有逃生舱。

## Lens 的 frontmatter 契约（v1）

```yaml
---
type: Lens
mode: board # board | table
scope: inbox/2026-08 # Vault 相对文件夹路径
group_by: type # 用哪个 frontmatter 属性分列
group_values: [task, notification, ping, digest] # 可选：声明列集合与列序
sort_by: timestamp # 用哪个属性排序（缺省 modifiedMs）
sort_dir: desc # asc | desc
card_title: description # 卡片标题取哪个属性，缺省文件名 stem
filter_source: gmail # filter_<属性> = 等值过滤，可有多条
---

这个看板盯的是本月 inbox。
```

刻意保持全部 flat：Riffle 的 Properties Editor 只能作者 flat text/list 属性，Lens 定义如果引入嵌套对象，就变成一种只有专用 UI 能编辑的格式。`filter_<key>` 这种前缀约定比嵌套 `filter: {}` 丑，但保住了「Lens 是普通 Note，任何工具都能改」。

## 分组的现实：`group_values` 与 `(none)` 桶

markdown frontmatter 没有 schema。这是它和 Notion database 之间**唯一真正的结构性差距**：Notion 的 select 字段有一个声明好的选项集，而一堆 markdown 文件只有「碰巧出现过的值」。

如果列集合从数据推断，就会出现这种情况：inbox 里如果一条 `status: read` 都还没有，看板上就没有 `read` 列——空列不存在，于是永远没有把东西挪进去的地方。纯只读模式下问题轻一些，但列序会随数据漂移，一个昨天在最左边的列今天可能跑到中间。

因此 `group_values` 是可选声明：给了就以它为准（含空列，且列序固定），没给就从数据推断并按字典序排。

无论哪种情况，缺失该属性的 Note 都进入一个显式的 `(none)` 桶，不被静默丢弃。这不是边角情况：inbox 约定「`status` 缺省即 unread」，绝大多数消息根本没写这个字段——丢掉无属性 Note 的看板在 inbox 上会是一块空白。

## v1 是只读投影：不做拖动写回

Lens 渲染出来的卡片**不可拖动**。改一个 Note 的属性仍然只有一条路：打开它，改 Properties 或改 YAML。

这一条与 v2 的两处记录立场一致，不是临时妥协：

> 不要把 Read 视图做成半编辑器（行内改 FM、点选改 checkbox 写回文件）。
> Read 是投影。Source 才是文件。要改键值，改 YAML。
> —— [`docs/v2-document-page.notes.md`](./v2-document-page.notes.md)

看板拖动就是「行内改 FM」的集合版本，它并不因为发生在集合视图上就变成另一件事。

只读还顺带消掉了这个提案里最毛的两个实现问题：写回回声（写文件 → 触发 Vault Change → 回流刷新 → 卡片先弹回原列再跳）和乐观更新的回滚语义。以及 AGENTS.md 那条 `Never add frontmatter automatically` 完全不用动。

对第一个真实用例几乎没有损失：inbox 的 triage 本来就是把文件 `mv` 出去，不是改属性。

拖动写回作为未来路径保留，裁决条件见 [Open questions](#open-questions)。

## Lens 不投影自己

Lens Note 通常就放在它 scope 的文件夹里（`inbox/board.md` 盯着 `inbox/`），会把自己投影成一张卡片。v1 行为：Lens 从自己的投影结果中排除所有 `type: Lens` 的 Note。

# 未来若开拖动写回，需要一并改的东西

本节不是 v1 的一部分，记录在这里是为了让「以后要不要开」这个裁决有完整的代价清单。

AGENTS.md 现在写着：

> Never add frontmatter automatically; only explicit actions in the Properties UI may author it.

拖动卡片会写 frontmatter，因此直接触碰这条。要开就得**修订而非绕过**：把判据从「哪个 UI」改成「是不是用户的显式动作」——

> 只有用户的显式动作可以作者或移除 frontmatter；显式动作包括 Properties Editor 的编辑与 Lens 的卡片拖动。渲染、索引、打开 Note 一律不写。

「移除」要一并写进去：拖进 `(none)` 列会删掉一个属性，而 Properties Editor 本来就有 add / edit / remove 三种权限。

支持开的那一面：拖动写的是 properties 而不是 body，它更接近 Properties Editor 的一次结构化编辑，而不是把 Read 视图变成富文本编辑器；而 v2 的 Engine-first 架构（唯一 mutation owner、ordered change stream、mutation confirmation）正好是让这类乐观写入第一次能安全落地的基底。这些都不足以在 v1 就动那条规则。

# v1 范围

**做**：

- 文件夹 scope（单个文件夹，含子文件夹）
- flat 属性等值过滤（`filter_<key>`，多条为 AND）
- 单属性 group by，可选 `group_values` 声明列集合与列序
- 单属性排序
- `board` 与 `table` 两种模式

**不做**：

- **拖动写回**。v1 是纯只读投影，理由见上。
- 查询语言（布尔组合、范围、正则）。scope + 等值过滤能覆盖 inbox 这类真实用例；查询语言是一旦发布就再也删不掉的表面积。
- **卡片手动排序**。见 [Rejected alternatives](#rejected-alternatives)。
- 跨 Vault、跨 scope 聚合。
- 在 Lens 里创建新 Note（v1 只投影已存在的 Note）。

**明确留给下一步、但索引设计不得排除它**：`calendar` 模式。日历只是「按一个日期型属性分组到时间轴上」的渲染模式——同一个 Lens 机制。这意味着属性索引必须能保留可解析为日期的值，而不是把一切都当字符串桶。

# 真实成本在索引，不在 UI

看板 UI 本身是这个提案里最容易的部分。真实工作量在下面这处：

`electron/vault-index.ts` 的 `VaultIndexEntry` 当前只有三个字段：

```ts
export type VaultIndexEntry = {
  rel: string;
  kind: "note" | "folder";
  modifiedMs: number;
};
```

**索引完全不知道 frontmatter 的存在。** 它服务的是 tree / search / backlinks，这三者都只需要路径和时间戳。Lens 需要的是按属性值分组、过滤、排序，也就是索引必须新增一层 properties 投影，并解决三个问题：

1. **解析成本与时机**——每个 Note 的 YAML 由谁解析、什么时候解析。
2. **增量更新**——`VaultChange` 目前只带 entry 元数据；属性变了必须重新解析并只更新受影响的桶。

（第三个问题「写回回声」因为 v1 取只读而不存在。它是开拖动时才要付的账。）

这些是这个提案能不能落地的实际门槛。UI 层面 board 就是一组按桶分列的卡片。

## 但这笔成本取决于建在哪一层

上面说的是**当前 accepted 架构**（`docs/electron-native-architecture.md` + fff 驱动的 `vault-index.ts`）。

[v2 Engine-first architecture](./v2-engine-architecture.md) 草案里，这一层已经在规划中了——它的 rebuildable projection tables 明确列着 `note_properties`，named read models 也是既有概念。若 Lens 建在 v2 Engine 上，属性索引不是新增成本，Lens 基本退化成「一个 named read model + 一种渲染模式」。

因此这个提案的实际工作量对 v2 的落地顺序高度敏感。注意 v2 目前是 **draft**，它自己写着 "this draft must not be used to migrate persisted data" —— 先后顺序是要单独裁决的，本提案不预设。

# 与 v2 的关系

v2 那批文档里已经收敛过一部分相邻问题，本提案不重复它们，只标出接口：

- [`v2-source-adapter.notes.md`](./v2-source-adapter.notes.md) —— Sidebar 第一级永远是 Source（`FILES | Slack | GitHub`）。Lens 不需要知道 Source 存在：它作用在「一组已经被 document source 语义覆盖的 Note」上。
- [`v2-engine-architecture.notes.md`](./v2-engine-architecture.notes.md) —— 外部源的默认读路径是 **live source**（fs / github / slack 各自实现 list / search / read）；那份 notes 里的 importer 降级为显式的 `ingest` 动作，其产物是 Vault 里的真实 Note，**Lens 原样适用**。Lens 本身不关心投影从哪来，只有「Lens 定义存哪」受 source 能力影响，见下。
- [`v2-document-page.notes.md`](./v2-document-page.notes.md) —— read↔source 双模式只有 `files://` 有。这与 v1 取只读投影方向一致。

## 视图定义存哪：由 source 的 `mutate` 能力决定

一个自然的问题是「Lens 定义能不能不放在文件夹里，改成 Riffle 内部的一份 path → config 元数据」。

对可写的 FS 源，答案是**不能，也不必**：

- v2 自己写着，把一个域从 Vault 文件迁进 SQLite 是 format migration 而不是 cache 优化，必须先定义 portability、export、backup、restore、cloud-sync 才能移。为一个视图定义付这一整套义务，换来的只是「文件夹里少一个文件」。
- 更要命的是 agent 那条命脉：Lens 存成 Note，agent 建看板 = 写一个 markdown 文件。存进内部数据，agent 就必须通过 app 或 CLI protocol 才能建视图。在一个由 `hq`、agent 写文件驱动的 workspace 里，这个差别决定这个功能是活的还是死的。

但对**只读源**（只读挂载、未来的 `github://`、拓扑 B 里的只读虚拟子树），Lens 定义确实无家可归——`SOURCE_READ_ONLY` 会直接拒掉写入。那种情况下它只能落到 authoritative business 表，并按 v2 的要求补齐 portability/export/backup 定义。

所以判据不是二选一，是 `SourceRef.mutate`：**可写源的 Lens 是 Note，只读源的 Lens 才是 Engine 里的一行**。v2 notes 里那张 capability 表已经把这个轴准备好了。

# Open questions

1. **术语**——`Lens` / `Facet` / `Board`（放弃通用性）/ 其他。它进 CONTEXT.md Language，并影响文件名、frontmatter `type` 值和 UI 措辞。
2. **建在 v1 还是等 v2**——决定这个提案是「新增一层属性索引」还是「加一个 named read model」。见上文成本节。
3. **拖动写回以后开不开**——v1 明确不做。真要开，裁决的是那条 `Never add frontmatter automatically` 规则和 v2-document-page 的「要改键值改 YAML」立场，不是实现难度。
4. **属性索引的粒度**——全 Vault 索引所有 Note 的 frontmatter（内存与解析成本随 Vault 线性增长），还是只对当前打开的 Lens 的 scope 惰性解析（打开时有延迟，但成本随使用而非 Vault 大小）。需要在真实 Vault 规模上量过再定。
5. **属性值的类型**——全部当字符串桶最简单，但 `calendar` 模式要求日期可比较，`sort_by: timestamp` 也要求。是引入最小类型推断（date / number / string），还是让 Lens 显式声明属性类型。
6. **Lens Note 在文件树里怎么显示**——和普通 Note 混在一起，还是有视觉区分。

# Rejected alternatives

**把 Lens 定义存成 Riffle 内部的 path → config 元数据**（今天的 `.markd/collections.json`，或 v2 的 authoritative 表）——技术上更简单，也不往用户文件夹里多塞文件，但代价是看板不能被 git 版本控制、不能被 agent 用普通文件写入创建、换个工具就消失，而且按 v2 的规矩还要补齐一整套 portability/export/backup 义务。完整论证见 [视图定义存哪](#视图定义存哪由-source-的-mutate-能力决定)；只读源是这条路唯一站得住的场景。

**v1 支持卡片手动排序**——Notion 类系统的经典难题：手动顺序在纯 markdown 里没有天然存放处。唯一的实现路径是往每个被排序的 Note 里写一个 `order` 字段，这会为了一个纯视图偏好去污染用户的内容文件，而且多个 Lens 引用同一批 Note 时会互相打架。v1 只支持按属性排序。如果之后确实需要手动顺序，它应该存在 Lens Note 自己的 frontmatter 里（一个路径列表），而不是散进被引用的 Note。

**做成 body 里的代码块（Dataview / Obsidian Bases 风格）**——会把查询语法变成 Riffle Markdown 方言的一部分，而 CONTEXT.md 明确把 agent-native UI components 排除在方言之外。用 frontmatter 选择 note 级渲染模式，能拿到同样的能力而不动方言定义。

# 落到 workspace 上的几个 wrinkle

第一个真实用例是把 `~/workspace` 接进 Riffle，因此这些要先想清楚：

- **Vault 开在哪**——开 workspace 根（一个 Vault 覆盖 inbox / knowledge / actions / research，Lens 可以跨这些文件夹）还是只开 `inbox/`。开根意味着 `.markd/` 会出现在 workspace 根目录，需要进 `.loreignore`；Lore 与 Riffle 都会盯同一批文件。
- **triage 惯例不变**——inbox 的 triage 仍然是把文件 `mv` 出去。从 Lens 的角度这就是一次普通的 removal（Note 离开了 scope），不需要额外语义。
- **卡片标题**——inbox 文件名是 `20260710T073810Z-clonesite-vp-create-starter.md`，直接当标题不可读。`card_title: description` 取 frontmatter 的一句话摘要，缺失时回落到文件名 stem。
- **inbox 的 frontmatter 已经够用**——`type` 分列（notification / task / ping / digest）或 `status` 分列（缺省即 unread，走 `(none)` 桶），不需要为看板改造 inbox 的既有约定。
