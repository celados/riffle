---
type: Notes
title: v2 Document page
description: >
  记录 v2 文档页的产品逻辑：文档 = 属性 + 正文；页面叫 Properties，
  文件仍是 YAML front matter；默认只读；只有 files:// 能进 Source；
  渲染虚拟化。本文不是 accepted 合同，不能当实现依据。
status: open # open | absorbed | discarded
version: 0.2
resource: ./v2-engine-architecture.md
generated: { by: grok/grok-4.6, at: 2026-08-13T23:40:00+08:00 }
tags: [riffle, v2, document, front-matter, readonly, source, virtualization]
---

# Status

会话里收敛的产品逻辑，**不是** accepted architecture。

[CONTEXT.md](../CONTEXT.md) 和 [v2 Engine-first architecture](./v2-engine-architecture.md) 仍是当前合同。本文不授权恢复 TipTap、不授权做 Notion 式编辑器、不改 Front Matter 自动写入规则。UI 对照：Paper 文件 Riffle → v2 → Group · Document。

相邻：导航与写入见 [v2-source-adapter.notes.md](./v2-source-adapter.notes.md)。

# 文档的形状

一篇文档永远是 **属性 + 正文**。

产品词是 **Properties**。Front Matter 是文件里的 YAML，不要写在页面上。

| 来源 | Properties 是什么 | 正文是什么 |
| --- | --- | --- |
| `files://` | 人写进 YAML 的属性 | 普通 Markdown |
| `slack://` | adapter 元信息：channel、from、created、messages… | 已被文档化的消息流 |
| `github://` | adapter 元信息：repo、state、author、labels… | issue body + 已被文档化的评论 |

不要自动写属性。没有 YAML 就不要画这一段。

# Chrome

面包屑是 **源图标 + 人能认的宿主路径**，不是 locator scheme。

```text
[folder]  path1 / Q3 Roadmap
[slack]   acme.slack.com / #design
[github]  github.com / celados / riffle / issues / 412
```

`slack://…` / `github://…` 留给 CLI、hover、agent。远程 `source` 属性收成一颗 pill（图标 + `#design` / `#412`），点击用浏览器打开源页面。不要在工具栏再放一个「Open in Slack」。

# 模式

只有 `files://` 能进 Source。Slack / GitHub 没有编辑入口。

```text
files:   read  ←→  source   （28px icon，不是 Read | Source tab）
remote:  read only
```

- **read**（默认）：渲染视图。没有 caret，没有行内富文本。Properties 是只读表。
- **source**（仅 files）：整份文件的源码缓冲，含 `---` 围栏。人要改文档，进这里。Agent 改的是同一份文件。

Read 是投影。Source 才是文件。不要为每种源做一种 composer，也不要把 Properties 做成 Notion 那样的行内编辑器——要改键值，改 YAML。

TipTap 已移除。不要加回来。

# 虚拟化

渲染视图按块虚拟化。一篇很长的文档（Slack thread、GitHub issue、本地长文）用同一条滚动面，像在原对话里往下翻。

它仍然是文档，不是客户端：

- 没有回复框
- 没有 per-source composer
- 写路径仍是暂存 Markdown → adapter（见 source-adapter notes）

# 不要从这里推出的结论

- 不要把 Read 视图做成半编辑器（行内改 FM、点选改 checkbox 写回文件）。
- 不要为 Slack / GitHub 单独做一套「对话 UI」。块长得像消息，是因为文档里就是这样写的。
- 不要在未裁决 completeness 之前当 live Slack 已可实现。
- App 组里的 Notes · Readonly 还是上一轮的 Properties 面，等确认后再替换。
