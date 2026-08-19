---
type: ADR
title: Adopt Solid 2 as the renderer runtime
status: accepted
generated: { by: claude-code/opus-5, at: '2026-08-19T00:00:00+08:00' }
tags: [riffle, solid-2, octane, renderer, runtime, tsrx]
---

# Adopt Solid 2 as the renderer runtime

Riffle 的 renderer 从 Octane 换成 Solid 2（`solid-js@2.0.0-rc.0`），语法层写标准 Solid TSX，
不使用 TSRX Solid target。Electron 主/utility 进程、Vault 合同和产品语言不受影响。

选择 Octane 的原始理由是从 React fork 迁移时的兼容成本最低——Octane 提供 React 形状的 hooks
API，`starc007/markd` 的组件可以逐个搬。这个理由已经用完：port 早已完成，剩下的是长期
runtime 押注，判据应该换成 signal 与 async 模型本身。

Solid 2 把 async 做成 reactive graph 的属性而不是外挂：computation 可以直接返回 Promise，
pending 作为状态位在图里传播，`Loading` 边界默认保留已渲染内容而不是掉回 fallback，
`isPending`/`latest` 表达 in-flight，optimistic lanes 让乐观更新不被挂起的 transition 阻塞。
配套的收紧（owned scope 禁写、`flush` 取代 `batch`、effect 拆 tracking/effect 两相）正是这套
异步语义能成立的前提。Octane 的 React-hooks 语义下没有等价物，而这类语义无法后补——React 的
concurrent 重写就是成本先例。

语法层不走 TSRX Solid target：`@tsrx/solid@0.1.60`（2026-08-17）的 peer 仍精确锁
`solid-js@2.0.0-beta.15`，落后 rc.0 十九个 beta 加一个 RC，而 Solid 2 的发布节奏是两天一版；
官方 `vite-plugin-solid@3.0.0-next.27` 与 `babel-preset-solid@2.0.0-rc.0` 则与 rc.0 同步。
本次迁移已经是语义级重写，再叠一个滞后一个月的实验编译器会让故障同时横跨两层，归因成本高于
迁移本身。TSRX Solid target 保留为后续 re-entry gate，条件是 peer 追上 Solid 2 stable，且
`tsrx-solid-dogfood-strategy.md` 的 qualification lab 先行过关。

执行计划见 [`../solid2-migration-plan.md`](../solid2-migration-plan.md)。
