---
type: Notes
title: v2 Allocation and comments
description: >
  Allocation UX：Comments 是 docked sidebar（不是 drawer）。
  选区本身不在 Paper 里画。零件是 Action menu / Composer / Card /
  Toggle。CLI 与 Copy 是同一份 buffer。
status: open # open | absorbed | discarded
version: 0.2
resource: ./v2-engine-architecture.md
generated: { by: grok/grok-4.6, at: 2026-08-13T23:55:00+08:00 }
tags: [riffle, v2, allocation, comment, agent, plannotator]
---

# Status

会话里收敛的产品逻辑，**不是** accepted architecture。

[CONTEXT.md](../CONTEXT.md) 仍是合同。本文不改 Note 文件格式，不授权把评论写回 Markdown / frontmatter。

UI 对照：Paper 文件 Riffle → v2 → Group · Allocation。

交互语法的 oracle 是 [Plannotator](https://github.com/backnotprop/plannotator)（选区 → 就地写 → 右栏汇总 → 导出），不是它的皮肤、Ask AI、redline 或分享。更细的 buffer 格式、锚点和 non-goals 仍见 [note-annotation-comment-buffer.md](./note-annotation-comment-buffer.md)。那份提案里的「显式批注模式」在 v2 里**不再采用**。

# 词

| 词 | 是什么 |
| --- | --- |
| **allocation** | 钉在文档上的一段（或 general，不钉正文） |
| **comment** | allocation 上的一条消息。可以 reply，所以是 thread |
| **buffer** | 从 comments 派生的 Markdown，给人 / agent 粘贴 |

页面上的动词是 **Comment**。Allocation 是对象，不是按钮文案。

# 面板是什么

**Comments 是 docked sidebar，不是 drawer。**

| | Drawer | Docked sidebar（采用） |
| --- | --- | --- |
| 占位 | 盖在文档上 | 吃掉右侧 272px，文档 reflow |
| 关掉 | 点遮罩 / 滑走 | toolbar toggle |
| 滚动 | 和文档抢层 | 自己滚，文档自己滚 |
| 适合 | 临时 inspector | 边看正文边点 card |

Drawer 会盖住正在批的那一行。双向定位（mark ↔ card）需要两边同时在。

打开时机：第一次 Add comment 成功，或按下 toolbar 的 Comments toggle。默认 Read 是关的。

# 零件

Paper 画不出真实选区。不要从画板上读「黑底高亮」。选区只表现为 **Action menu** 和 **Composer** 的出现。

| 零件 | 是什么 | 何时 |
| --- | --- | --- |
| Action menu | 浮在选区旁的 pill：Comment · Copy · × | 非空选区 |
| Composer · selection | 浮层 popover：quote + draft + Add | 点了 Comment |
| Composer · general | 同上，无 span | + General comment |
| Composer · edit | 按钮变 Save | card → Edit |
| Sidebar | 272px dock | toggle on / 已有评论 |
| Card | quote + thread + Reply/Edit/Delete | hover 才出 actions |
| Reply | card 内嵌草稿，不是新 popover | card → Reply |
| Orphaned card | `Original text changed`，仍进 buffer | 正文改了、锚失败 |
| Toggle | 28px，pressed = invert，count = comments | 文档 toolbar |
| Copy | sidebar footer。空则 disabled。成功短暂 Copied | 不清空评论 |

没有 annotate mode。Action menu 不拦截 `Cmd+C`。

# 循环

```text
Read · toggle off
  → select
  → Action menu
  → Composer popover
  → save
  → sidebar docks（若还关着）
  → mark ↔ card
  → Reply 在 card 里 / Edit 回到 composer
  → Copy comments  ==  riffle comment read
```

# CLI

和 UI 是同一套对象。Locator 用文档 URI + `comment` query。

```sh
riffle comment read files://path1/Q3\ Roadmap.md
riffle comment reply -p 'files://path1/Q3 Roadmap.md?comment=1' -m "OK"
```

`comment read` 打出来的 Markdown，就是 Copy comments 写入剪贴板的那份。`reply` 追加到同一个 allocation，不是新开一条。

远程源（Slack / GitHub）也可以 allocation：钉的是文档化之后的正文，不是 live 消息。写路径仍不进 adapter。

# 明确不做

- 不写回 Note body / frontmatter
- 不做 Notion 式行内编辑
- 不移植 Ask AI、Share、Markup、redline
- 不在 Source 模式里批注（overlay 只活在 Read）
- 持久化落 local session 还是 Engine，回头再裁决（见原提案）

# 不要从这里推出的结论

- 不要把 allocation 做成任务分派 / assignee。它是 span，不是工单。
- 不要为每种源做一种评论 UI。
- 不要在未裁决 completeness 之前当 live Slack 评论已可同步回 Slack。
