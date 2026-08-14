---
type: Notes
title: v2 Source adapter and write staging
description: >
  记录 v2 导航与写入的产品逻辑：第一级永远是 Source；agent 先在暂存区写成
  Markdown，需要显式路径时才触发 source adapter 的创建动作。本文不是 accepted
  合同，不能当实现依据。
status: open # open | absorbed | discarded
version: 0.1
resource: ./v2-engine-architecture.md
generated: { by: grok/grok-4.6, at: 2026-08-13T20:30:00+08:00 }
tags: [riffle, v2, source, adapter, write, cli, sidebar]
---

# Status

会话里收敛的产品逻辑，**不是** accepted architecture。

[CONTEXT.md](../CONTEXT.md) 和 [v2 Engine-first architecture](./v2-engine-architecture.md) 仍是当前合同。本文不改 Registry schema、不改产品词、不授权实现 live Slack/GitHub。回头修订 v2 时必须显式裁决。

相邻未决见 [v2-engine-architecture.notes.md](./v2-engine-architecture.notes.md)。UI 对照：Paper 文件 Riffle → v2 → Group · Sidebar。

# 导航：第一级永远是 Source

Sidebar 的第一级只枚举 **Source**，不是混在一起的文件夹、channel 和 issue。

```text
FILES | Slack | GitHub | …
```

选中一个 Source 之后，第二级才是该 adapter 的树：

| Source | 树上的节点 | 叶子 |
| --- | --- | --- |
| `files://` | mount（`path1`、`path2/3/4`）→ 真实文件夹 | Note |
| `slack://` | workspace → channel → thread | message |
| `github://` | owner/repo → issues | issue / comment |

Todos 和 Bookmarks **不是** Source。它们是应用级全局状态，两个 YAML 在 UI 上的投影，和今天一样。

树上给人看的是短名（Files、Slack、GitHub）。Locator（`files://path1/…`、`slack://acme.slack.com/…`）是 protocol 身份，hover / CLI / agent 用，不占第一级。

这和「一个 Vault 下挂虚拟子树」可以同时成立：Engine 拓扑未决，**UI 第一级已经决了**——人先选 Source，再进那棵树。不要做成所有源摊在同一条树上。

# 写入：先 Markdown，再 adapter

Agent-native 的写路径不是「在 Slack 里开输入框」。统一对象是一份 Markdown 文档。

```text
agent 产出 Markdown
        ↓
   暂存区（tmp1.md）
        ↓  需要显式路径时
   source adapter 的创建 / 追加
```

暂存区是 Riffle 自己的草稿，还没有 Source 身份。`riffle write <locator> $DOC` 才把这份文档交给对应 adapter。

没有显式路径时，文档可以留在暂存（Quick Capture 只贴 URL 进 Drafts 属于这一层，不在 sidebar 上画）。

# Adapter 创建动作

同一份 `DOC`，locator 决定 adapter 做什么：

| Locator | 动作 | 含义 |
| --- | --- | --- |
| `files://path1/1.md` | save | 把暂存写成该 mount 下的文件 |
| `github://a/b/issues` | create issue | 集合路径 → 新 issue |
| `github://a/b/issue/1` | reply comment | 已有 issue → 一条评论 |
| `slack://acme/channels/design` | post | channel → 新消息 |
| `slack://acme/channels/design/threads/ts` | reply | thread → 回复 |

Slack 的 channel / thread 和 GitHub 的 issues / issue/:id 是同一形状：集合路径创建，实例路径追加。

Sidebar 上的 `+` 只是这个动作的人机入口。它不自己长表单。它打开暂存（或 Capture），agent / 人写 Markdown，确认路径后走 adapter。

# CLI

Desktop 和 agent 用同一套动词。路径是 Source locator，不是本地文件系统假设。

```sh
DOC="markdown doc"

riffle write github://a/b/issues/ "$DOC"
riffle read  github://a/b/issues/1
riffle search -p github://a/b/issues -q "bug"
```

读、搜、写都带 `-p` / locator，这样 `search` 可以锁在一个 Source 里。snippet 仍不可引用，证据走 `read`。

`write` 的输入永远是 Markdown。Adapter 负责把 Markdown 投影成 issue body、comment、Slack mrkdwn 或文件字节。投影失败是 adapter 错误，不是换一套编辑器。

# Sidebar 状态

- **source-selected**：第一级高亮。只挂这一棵树。
- **expanded / collapsed**：只作用于当前源的树节点。
- **item-selected**：当前阅读的叶子。
- **create-pending**：暂存里有未落路径的文档。不在第一级占一项。
- **create-resolved**：locator 已定，adapter 已执行（或失败）。

`+` 的语义跟 `source-selected`（以及树上的焦点节点）走，没有全局「New document」与源无关。

# 不要从这里推出的结论

- 不要把 Slack/GitHub 叫做 Vault。
- 不要在未裁决 completeness 之前当 live Slack 已可实现。
- 不要让暂存区变成第三个用户可见的 Source。它是 write 管线的一步。
- 不要为每种源做一种 composer。Composer 只有一种：Markdown。
