---
type: Notes
title: Multi-source insight for v2 Engine
description: >
  记录将 Slack channel、agent session 等非 FS source 纳入 Vault Registry 的未收敛 insight。
  供回头修订 v2 Engine 架构时一并裁决。本文不改变当前 v2 合同，也不是可执行的设计。
status: open # open | absorbed | discarded
version: 0.3
resource: ./v2-engine-architecture.md
generated: { by: grok/grok-4.6, at: 2026-08-13T20:30:00+08:00 }
tags: [riffle, v2, source, vault, registry, multi-source]
---

# Status

这是会话里落下的 insight，**不是** accepted architecture，也还不能指导实现。

当前仍以 [v2 Engine-first architecture](./v2-engine-architecture.md) 和 [CONTEXT.md](../CONTEXT.md) 为准：Vault 是用户选定的 Markdown 文件夹；Registry 登记的是 filesystem root。回头梳理 v2 时必须显式裁决本文，再决定是否改合同。未裁决前不要按「Slack 也是 Vault」改 Registry、protocol 或产品语言。

# Trigger

对照 [MFS](https://github.com/zilliztech/mfs) 时看到：agent 要的是稳定可浏览的树，而不是另一份 RPC 清单。Riffle 的 Registry 今天只面对 FS。一个未收敛的想法是：把 **source** 当成统一抽象——Slack channel、Claude Code / Grok / Codex session 也可以进入同一套登记与浏览面。表面上像只多了只读 / 读写，实际上会碰到所有权模型。

# Insight

Registry 不该永远是 `root: string`。Engine 面对的应是 **Source**：能 enumerate / stat / read / fingerprint，可选 watch 与 write。`file` 是第一个、也是特权 adapter，不是唯一可能的 kind。

统一的是 Source，不是把每个外部系统升格成产品意义上的 Vault。

# 不要把词压扁

今天的 Vault 绑定的是一组产品不变量，不只是「能 `ls` 的树」：

- portable Markdown
- path = identity
- 外部编辑器是一等公民
- 删除 projection 能从 document source 重建
- todos / pins / `.markd` 有明确归属

Slack channel 几乎一条都不满足。Session 目录更接近完整本地文件，也仍然不是 Note。

在改 [CONTEXT.md](../CONTEXT.md) 之前：

- **Source** 是 adapter / registry 对象
- **Vault** 仍是可写、可带走的知识工作区

把 Slack 直接叫做 Vault，会弄废这个词，而不是完成一次小的 Registry 扩展。

# 真正的轴不是 ro / rw

`note.create` 碰到 `mutate: none` 回 `SOURCE_READ_ONLY` 是便宜的那一层。要冻进 Registry 的是一组能力：

| 轴 | FS Vault | Session 目录 | Slack channel |
| --- | --- | --- | --- |
| **mutate** | tree（create / write / move / trash） | 通常 none，顶多 append | 看起来 none；产品上会有人想 reply |
| **complete** | 是；删 index 能重建 | 本地 jsonl 完整就是是 | **否**。API 窗口、分页、已删消息 |
| **watch** | native | native（文件） | poll / events，丢事件是常态 |
| **identity** | vault-relative path | session id + turn | channel + `ts` |
| **dialect** | Riffle Markdown | transcript / jsonl | message thread |
| **auth** | 无 | 无 | 有，且不能写进 Vault 文件 |

Session 和 Slack 不是同类源。前者可以当 document source；后者不行，除非先物化进文件夹。

# Completeness 是所有权地雷

v2 写死了三类所有权：document source / authoritative business / derived projection。projection 可删，可从源重建。

活接 Slack API 会多出第四类：**不完整的远程缓存，缓存本身才是能恢复的历史**。这不是 `readonly: true`。两条出路，回头必须二选一或显式发明第三种：

1. **Importer**：`riffle ingest slack://eng --into Inbox/slack/`，落地后仍是 FS Vault。Slack 不是 source，是导入器。
2. **Live source**：承认第四类所有权，并改 recovery / backup / stale 语义。

未选之前不要实现 live Slack。

# 两种拓扑，尚未裁决

## A. 每个 source 是一个 Vault

`vault.list` 并排出现 `~/notes`、`slack://eng`、`session://codex/abc`。todos / pins / annotations / cwd /「当前 Vault」都按 `vault_id` 挂到一个不可 portable 的东西上。说起来简单，业务表和 Desktop 的单 active Vault 假设都会脏。

## B. 一个 Vault，多个 Source mount

```text
vault: ~/notes          file://     mutate=tree, complete
  sessions/             session://  mutate=none, complete
  slack/eng             slack://    先不要活挂
```

可写根永远是 FS。只读源挂成虚拟子树。Business data、Published Share、Quick Capture 仍属于那个 FS Vault。只读子树里的 mutation 直接 `SOURCE_READ_ONLY`。

会话倾向 **B**：统一的是 Source，Vault 这个词不被弄废。这不是决定。

# 第一个非 FS 源

若以后做非 FS adapter，候选顺序应是 **本地 session 目录**，不是 Slack：

- 本地、无凭证、文件完整
- 和 v2 的 agent-first 目标同方向
- watch / rebuild 仍可落在现有 document source 语义上

Slack 默认走物化进 Vault，除非准备改 ownership 模型。

# 以后若写入 v2，最多先冻这些

这些可以在不实现任何非 FS adapter 的前提下写入合同。现在 **不要** 写入；只是回头时的起点：

```text
SourceRef
  scheme      file | session | …
  locator     绝对路径 / session root / …
  mutate      none | append | replace | tree
  complete    yes | windowed
  watch       native | poll | none
  dialect     riffle-md | transcript | …
```

- Note Store / Reconciler 对 Source 说话，不再直接假设 `fs`
- Protocol 按 capability 拒命令
- Phase 1 仍然只实现 `file`
- 读路径可以有 file-like browse（`ls` / `cat` / `grep` + locator）；写路径保持 domain command

# 导航第一级（2026-08-13）

UI 上又收了一刀，和上面的拓扑未决要分开看：

- Sidebar **第一级永远是 Source**（FILES \| Slack \| GitHub）。不是一棵混树。
- 写路径：agent 先在暂存区写成 Markdown，需要显式 locator 时才触发 adapter 创建。集合路径 = 新建，实例路径 = 追加。
- CLI：`riffle write|read|search` 带 source locator。

全文见 [v2-source-adapter.notes.md](./v2-source-adapter.notes.md)。那份同样是 open，不是合同。

# 文档页（2026-08-13）

文档 = 属性 + 正文。页面叫 Properties。默认 Read；只有 files:// 能进 Source（紧凑 icon，不是 tab）。远程 source 是 outbound pill。渲染按块虚拟化。

全文见 [v2-document-page.notes.md](./v2-document-page.notes.md)。open，不是合同。

# Allocation（2026-08-13）

Read 上划一段 → Comment → 右栏 thread。Copy / `riffle comment read` 产出同一份 Markdown 给 agent。没有 annotate mode。不写回文件。

全文见 [v2-allocation.notes.md](./v2-allocation.notes.md)。open。

# 仍未想清楚、修订 v2 时必须过的问题

1. Source 进 Registry 之后，产品词用 Vault、Bind 还是 Workspace + mounts？
2. 选拓扑 A 还是 B？Business data 挂在哪一层？
3. 非 Markdown 源读出来是什么：投影成 Markdown，还是引入 `note | transcript | message` 三种 Entry？
4. 不完整源是 importer，还是第四类所有权？
5. 写回（回 session、回 Slack）的冲突模型是什么？没想清楚之前 capability 停在 `none`。
6. 只读树上的 wiki link、annotation、pin、Published Share 是否有定义？
7. Agent 的 candidate → evidence 回路（find 返回 `source + locator`，再 `cat`/`note.read` 重开）如何接到多源树上，而不把 Engine 做成检索服务器？

# Adjacent：从 MFS 只偷界面语法

同一轮对照里还有一条独立 insight，修订 agent CLI / skill 时一并看，不要和「多源」绑死：

- search 给候选，`cat` / `note.read` 给证据；snippet 不可引用
- browse 不依赖 index；`search_status` 对 agent 可见
- 密度阶梯：peek / range / 全文 / 太大则拒
- skill 编码策略（find vs write），`@schema` 编码能力

这条不依赖 Slack 或 session 是否成为 Source。

# Sources

- [v2 Engine-first architecture](./v2-engine-architecture.md)
- [Riffle domain language](../CONTEXT.md)
- [MFS](https://github.com/zilliztech/mfs)（对照对象，不是要移植的产品）
