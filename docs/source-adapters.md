---
type: Proposal
title: Source adapters — 把 fs / github / slack 统一成可 URI 定位的文档源
description: >
  裁决 v2 notes 里悬置的 source 问题：live source 为默认、importer 降级为显式
  ingest，非 FS 源投影成 multidoc Markdown，搜索走联邦查询而非统一索引，远程写
  只在 CLI、由 locator 形态决定语义；携带链接按 scheme 分流的 CONTEXT.md delta。
status: draft # draft | accepted | superseded
version: 0.1
resource:
  - ./v2-source-adapter.notes.md
  - ./v2-engine-architecture.notes.md
generated: { by: claude-code/opus-5, at: 2026-08-17T13:05:00+08:00 }
tags: [riffle, v2, source, adapter, slack, github, multidoc, ownership]
---

# Decision

Riffle 引入 **Source adapter** 抽象：`fs` / `github` / `slack` 各自实现 `list` / `search` / `read`（以及能力允许时的 `write`），Engine 统一编排它们。所有 source 下的文档由 URI 定位。

`search` 是**联邦**的——各 adapter 打各自的后端，Engine 不建统一索引。

读是双向的——Desktop UI 和 CLI 都能读。**写不是**：远程源的写只存在于 CLI，Desktop 不提供入口，locator 的形态直接决定动作语义。

产品定位是 **AI context system**：一个入口读到分散在文件、issue、channel 里的上下文。这个定位直接决定了下面几处取舍——它要的是「此刻能读到什么」，不是「永久档案」。

三个 adapter 的树形：

```text
FILES     inbox/  research/          ← 用户拖入的 folder，各自是一个 mount
GITHUB    Issues/  PRs/              ← 单个 issue 是一份 multidoc Markdown
SLACK     #ch1  #ch2                 ← 单个 channel 是一份 multidoc Markdown
```

# 本提案裁决了什么

[`v2-engine-architecture.notes.md`](./v2-engine-architecture.notes.md) 结尾列了七个「修订 v2 时必须过的问题」。本提案回答其中三个半，其余保持悬置：

| # | 问题 | 裁决 |
| --- | --- | --- |
| 2 | 拓扑 A（每源一个 Vault）还是 B（一个 Vault 多个 Source mount） | **采 B 起草**，未裁决。与本轮「FILES 下拖入 folder = mount」的输入一致，也沿用 notes 的倾向；但 A/B 真正的分歧点是 business data 挂在哪一层，那一点仍然悬置（见 Open questions） |
| 3 | 非 Markdown 源读出来是什么 | **投影成 Markdown**，不引入 `note \| transcript \| message` 三种 Entry。但一份投影可以是 multidoc |
| 4 | 不完整源是 importer 还是第四类所有权 | **live source 为默认读路径**，配降级的完整性承诺；**importer 保留为显式 `ingest` 动作**，产物是 Vault 里的真实 Note，所有权随动作转移给用户。隐式的统一物化被排除——它在三类所有权里无处安放 |
| 5 | 写回的冲突模型 | **部分**：写路径的形状已定（暂存 → adapter append），冲突语义仍悬置 |

未裁决：#1（产品词用 Vault / Bind / Workspace + mounts）、#6（只读树上的 wiki link / annotation / pin / Published Share）、#7（agent 的 candidate → evidence 回路）。

# 所有权：用降级的承诺换掉第四类

notes 里那颗地雷说得没错：live Slack 会造出「不完整的远程缓存，而缓存本身才是能恢复的历史」，它不属于 v2 写死的三类所有权中的任何一类。

本提案不是宣布地雷不存在，而是**放弃那个让它成为地雷的承诺**。

Riffle 不声称保管 Slack 的历史。远程 source 的本地数据是纯 derived projection：随时可丢，丢了重新拉，拉不回来的部分就是拉不回来。这样它就落回第三类，不需要新的所有权类别。

代价是真实的，必须写进产品语义而不是藏起来：

- **API 窗口外的旧消息在 Riffle 里读不到。** 不是「暂时没同步」，是没有。
- **搜索的覆盖范围由上游决定，不由我们决定。** 搜索走的是各家的 search API（见「搜索」节），它们各自的覆盖窗口、qualifier 能力和配额都不同，且不受 Riffle 控制。因此 `search_status` 必须对 agent 可见——这条 notes 的 MFS 一节已经有了，这里是它第一个必须落地的场景：报告哪些源查了、哪些源受上游窗口限制。
- **删掉投影再重建 ≠ 原样回来。** fs source 的 projection 可以从磁盘完整重建，windowed source 不能。这是三类所有权模型上的一处显式例外注记，需要写进 CONTEXT.md，只是比引入第四类轻得多。

因此 `SourceRef` 的 `complete` 轴不是文档里的一个形容词，它有可观察的后果，而且 read 和 search 的后果是**两个不同的窗口**：read 受限于分页游标拉到哪里，search 受限于上游 API 的覆盖边界。两者都要携带完整性信息，不能互相推断。

# 能力矩阵

沿用 notes 里已经收敛的 `SourceRef` 形状，填入三个 adapter。`file` 与 `slack` 两列取自 notes 原表，`github` 整列是本提案新增的判断：

| 轴 | `file` | `github` | `slack` |
| --- | --- | --- | --- |
| `mutate` | `tree`（create / write / move / trash） | `append`（评论） | `append`（发消息 / 回复） |
| `complete` | `yes` | `windowed` | `windowed` |
| `search` | 本地索引（fff → 其后继） | 上游 search API | 上游 search API |
| `watch` | native | 慢 poll + 写触发立即拉 | 慢 poll + 写触发立即拉，丢事件是常态 |
| `identity` | vault-relative path | `owner/repo` + number | channel + `ts` |
| `dialect` | Riffle Markdown | 投影 Markdown | 投影 Markdown |
| `auth` | 无 | 有 | 有 |

`auth: 有` 的直接后果：凭据不能写进 Vault 文件，只能进 authoritative business 存储。这是 Slack/GitHub 与 fs 之间除完整性以外的第二处结构性差异。

# 读：multidoc 与密度阶梯

一个 GitHub issue 是「body + N 条 comment」，一个 Slack channel 是「N 条 message，其中一些带 thread」。它们投影成一份 Markdown 文档，但这份文档由多个 part 组成，且**永远可能还有更多**。

这与「一篇很长的文档 + 块虚拟化」（[`v2-document-page.notes.md`](./v2-document-page.notes.md)）不冲突，是对它的细化：虚拟化解决的是渲染，multidoc 解决的是**获取**——read 带游标，返回的永远是一个窗口，不是全部。

对 agent 这是关键差异，而不是实现细节：一个 channel 的全文可能远超任何 context 预算。因此 read 遵循 notes 里已经写下的密度阶梯——peek / range / 全文 / 太大则拒——并且响应必须能自我描述「这是第几段、还有没有更多」。

## Thread 是引用，不是折叠块

Slack 的 thread 不内嵌进主时间线。投影把它渲染成一个指向另一份文档的普通链接：

```markdown
有人在这条消息下讨论了实现方案

[3 replies](slack://acme.slack.com/design/1723459200.001)
```

点击 = 在 Riffle 内导航到那份 thread 文档。它有自己的 locator、自己的分页、自己的属性——和 channel 文档是同一种东西，只是范围更小。

这比把 reply 折叠进 `<details>` 更同构，而且顺带消掉两个问题：不需要扩 HTML element allowlist；也不需要在一份文档的分页窗口里再套另一份文档的分页窗口（一个 thread 本身可以有几百条 reply）。

embed 形态（`![3 replies](...)`）不采用——感叹号意味着在此处内联渲染，那会把嵌套分页带回文档流。引用就是引用，点开就是导航。

链接指向 source locator 而非 Vault 路径，这需要一条链接语义的扩展，见 [CONTEXT.md delta](#contextmd-delta)。

# 搜索：联邦查询，不建统一索引

每个 adapter 自己实现 `search`：fs 走本地索引，`github` / `slack` 走各自的上游 API。Engine 做 fan-out 与结果编排，**不把远程内容物化落盘喂进一个统一索引**。

## 为什么不统一

统一物化在 v2 的三类所有权里无处安放：

- **derived projection 放不下。** 按定义 projection 可从源重建，而 windowed source 的物化不可重建——上游窗口滚走之后，本地这份就是孤本。`search_documents` 正是 projection 表，所以「统一进 v2 的搜索表」这条路被 v2 自己的 invariant 堵死。
- **authoritative 不该放。** 那一类是用户创造的、必须定义 migration / backup / restore 的业务数据，一份 Slack 缓存不是。
- **fs 索引器不承接。** v2 写着「新产品逻辑不再进入 fff」，clean cut 后删除。

更根本的是它与本提案的所有权裁决直接冲突：我们用「Riffle 不承诺保管远程历史」换掉了第四类所有权，而一份持续物化的本地索引恰恰就是在保管历史——本地有、上游已经拉不回来的内容，就是那句「缓存本身才是能恢复的历史」。

还有一个常被低估的运维事实：远程源的主要变化不是 edit 而是 **append**，Slack 尤其高频。物化索引要保证「昨天的消息搜得到」，需要的不是偶尔一次一致性修补，而是一条长期运行的同步管道。联邦查询没有这个问题——search 打的是上游，上游永远是最新的。

## 结果按 source 分组，不做全局混排

各家的相关性分数不可比，强行归一化出来的全局排序是假的。因此结果按 source 分组返回（FILES / GITHUB / SLACK 各一组），分数不可比的问题在展示层直接消解。

agent 侧同理：`find` 返回按 source 分组的 candidates 加上 `search_status`，agent 自己决定读哪个——这正是 notes 的 MFS 一节写的「search 给候选，`read` 给证据」。

## 显式 ingest：importer 的归宿

需要把远程内容**留下来**时，走一个显式动作而不是隐式缓存：

```bash
riffle ingest slack://acme.slack.com/design --into inbox/slack/
```

产物是 Vault 里的真实 Markdown 文件。落地之后它就是普通 Note——所有权、索引覆盖、[Lens](./note-lens.md) 适用性三个问题一次答完，不需要任何新机制。

关键差别在所有权随动作转移：隐式缓存是 Riffle 替用户保管历史（与上面的裁决冲突）；显式 ingest 是用户选择把它变成自己的文件（没有冲突）。notes 里的 importer 路线因此不必推翻，只是从「所有远程源的默认路径」降级为「一个按需的动作」。

# 写：远程源没有 UI 入口，只有 CLI

FS 源的新建与编辑照旧，不在本节讨论范围。

**远程源（`github` / `slack`）在 Desktop UI 上不提供任何写入口。** UI 只显示；数据源变了，UI 反映变化。写发生在 `riffle` CLI。

两个理由，产品的那个更重：

- **写入口本身没有存在必要。** 在 agent 已经承担绝大部分写作的前提下，「人打开一个 composer 敲字发出去」不是这个产品要优化的路径。Riffle 要做的是把上下文读进来。
- **远程写是一组按源而异的语义动作**——GitHub 有创建 issue、回复 comment、创建 PR、回复 PR；Slack 有发消息、回复消息——而不是「编辑一份文档然后保存」。硬塞进文档 UI 就要为每种源做一套 composer，这正是 [`v2-document-page.notes.md`](./v2-document-page.notes.md) 已经拒绝过的方向。

## URI 的形态决定动作

这些语义不需要各自的命令，locator 自己就能 resolve —— 这是 [`v2-source-adapter.notes.md`](./v2-source-adapter.notes.md) 那条「集合路径 = 新建，实例路径 = 追加」的 URI 化：

```bash
riffle write github://owner/repo/issues/       # 集合路径 → 新建 issue
riffle write github://owner/repo/issues/123    # 实例路径 → 在该 issue 下新增 comment
riffle write github://owner/repo/pulls/        # 新建 PR
riffle write github://owner/repo/pulls/456     # 回复 PR
riffle write slack://acme.slack.com/design     # 向 channel 发消息
riffle write slack://acme.slack.com/design/1723459200.001  # 回复该 thread
```

内容仍走暂存区模型：agent 产出 Markdown → 暂存 → `riffle write <locator>` 交给 adapter。

## 两条保留的例外

把写移出 UI 之后，原先「不进 optimistic 通道」「必须是显式动作而非 autosave」两条自动成立——UI 里没有乐观状态要管，CLI 调用本身就是显式动作。剩下两条仍需显式声明：

1. **不可回滚。** v2 的一致性策略建立在「filesystem commit 成功后不做不安全的反向操作」之上；远程 API 调用连反向操作都没有。消息发出去就是发出去了。这与入口在哪无关。
2. **UI 的反映依赖回流，不是写入的一部分。** 「数据源有变，UI 只会显示」意味着 UI 看到的永远是重新拉取的结果，而不是本地构造的乐观状态。写成功和 UI 更新是两件事，中间隔着一次拉取——正常路径见「新鲜度」节，丢事件时的兜底仍悬置。

写回**已存在**的远程内容（编辑已发出的消息、改 issue body）的冲突模型仍然悬置。在裁决之前，`mutate` 停在 `append`。

# 新鲜度：watch 与自读回

FS 源有原生 watch，不变。远程源有两种可选架构：

**架构 A — 客户端慢 poll + 写触发立即拉（优先）**

常态是低频 poll。write 之后不等下一个 poll 周期：CLI 的 `riffle write` 成功返回后，Engine 立即重新拉取该 locator，产生的变更通过 v2 既有的 subscription / delta 通道推给正在订阅的 Desktop。

这条路径不需要新机制——v2 的 protocol 已经有「快照 at sequence N + 严格之后的 delta」。它只是给远程 source 补上一个「写完主动拉一次」的触发点。

这回答了上一节例外 2 里「刚发出去的消息凭什么出现在界面上」：靠写触发的立即拉取，而不是靠 poll 撞上。

**架构 B — Cloudflare Worker 订阅 webhook / events（候选，不优先）**

在 CF Worker 上起服务，订 GitHub webhook 与 Slack 事件，推给客户端。延迟更低，也不受 poll 频率限制。

标为候选而非否决，但它有一条 A 没有的成本：它引入一个**常驻云端组件**，而 v2 的 Non-goals 明确写着「不建设网络账户服务」。启用 B 需要先过那条边界——这是产品边界问题，不是实现难度问题。

无论 A 还是 B，丢事件之后的重同步语义仍然悬置（见 Open questions）。

# CONTEXT.md delta

以下修订在本提案 accepted 时与实现同一次落地。格式参照 [v2 Engine-first architecture](./v2-engine-architecture.md) 的「Domain language changes on acceptance」。

**Riffle Markdown 的链接语义**——当前定义里内部链接只解析 Vault 相对路径。投影文档会带入 source locator，因此链接目标扩为两类，按 scheme 分流：

| 链接形态 | 行为 |
| --- | --- |
| Vault 相对路径 | Riffle 内导航（现状不变） |
| `slack://` `github://` 等 source locator | **Riffle 内导航**，打开该 locator 的文档 |
| `https://` | 外部浏览器 |

这条分流同时安顿了 [`v2-document-page.notes.md`](./v2-document-page.notes.md) 里那颗「远程 `source` 属性收成 pill、点击用浏览器打开源页面」：pill 是 `https://` 形态，走外部浏览器；locator 链接是「在 Riffle 里继续读」。两者不冲突，是两个不同的动作。

> 这条裁决在另一次会话中已经确定，此前没有落地成文档；本节是它第一次成文。**CONTEXT.md 本体未改**——它是 accepted 合同，而本提案还是 draft。

# 与 Lens 的关系

[Note Lens](./note-lens.md) 提出的「集合 → 分组 → 渲染模式」作用在 source 投影出来的文档上，不关心投影从哪来。用户描述的第一个用例正是这个组合：`FILES` 下拖入 `inbox/`，默认文件树，配上 Lens 后同一批文档变成看板。

两处接口：

- **Lens 定义存哪**由 `mutate` 决定。可写的 FS 源存成 Note（agent 建看板 = 写文件）；`github` / `slack` 这类 `append` 源没有地方放 Lens 定义，只能落 authoritative 存储。论证见 note-lens.md。
- **分组属性从哪来**。fs 源是用户写的 YAML frontmatter；远程源的 Properties 是 adapter 元信息（issue 的 state / labels / author，channel 的 from / created）。后者对 Lens 完全可用，且天然有 schema——这恰好补上了 markdown frontmatter 缺少 schema 的那个缺口，但只在远程源上成立。

# Open questions

1. **拓扑 A/B 的真正分歧：business data 挂哪层**（notes #2 的核心）——todos / pins / annotations / 「当前 Vault」按 `vault_id` 挂在谁身上。本提案采 B 起草，但没有回答这个；`slack://` 这种不可移植的东西一旦成为 business data 的宿主，Vault 的可携带性就破了。
2. **产品词**（notes #1）——Source 进 Registry 之后，顶层概念叫 Vault、Bind 还是 Workspace + mounts。本提案沿用 Vault + mount 的说法但不裁决。
3. **远程写的冲突模型**（notes #5 的另一半）——编辑已存在的远程内容如何处理并发修改。悬置期间 `mutate: append`。
4. **只读树上的既有概念**（notes #6）——wiki link、annotation、pin、Published Share 在 `slack://` 文档上是否有定义。annotation 尤其现实：给一条 Slack 消息加批注，批注挂在一个可能滚出窗口的锚点上。
5. **凭据存储与 Vault 可移植性**——`auth` 源的 token 进 authoritative 存储后，Vault 的「拷走就能用」属性对这些 mount 不再成立。需要定义导出行为。
6. **丢事件之后的重同步语义**——Slack 丢事件是常态，而 v2 的 product invariant 写着「sequence gap 是 protocol 错误，不是 rescan 提示」。远程 source 需要一条不同的重同步路径。（自读回那一半已答：写触发立即拉，见「新鲜度」节。）
7. **查询翻译**——联邦需要一个统一的查询表达再翻译成各家语法。取最小公分母（全文 + 少量通用 qualifier），还是允许 pass-through（`slack: from:@ethan in:#design`）？这是联邦方案的主要设计成本。
8. **要不要提供全局混排**——本提案主张不提供。若 agent 侧确实需要「相关性 top N 不管来自哪」的入口，就要发明一个跨源可比的分数，那是独立的一块设计。

各家 search API 的 token 类型、qualifier 能力与配额差异很大，需按 adapter 实测核实。这不是架构选择，是实现前的必查项。
