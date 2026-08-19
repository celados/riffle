---
type: Backlog
title: Riffle deferred work
description: Known follow-ups deliberately left outside completed Riffle changes.
status: active
---

# Deferred work

- updater signing key、release URL 与 updater endpoint 已切到 `celados/riffle`。Cloud Engine 已迁移
  现有协议，但 production ownership gate 在源码层保持关闭；只有 tests 可用 loopback origins 启用。
  在启用 production publishing 或部署 Riffle site 前，必须裁决产品域名与 Cloud API ownership，并把
  canonical origins 作为新的源码级 trusted configuration；不能仅靠继承上游环境变量打开 gate。
- Vaultwarden 服务版本尚未兼容 Bitwarden CLI `2026.7.0`，会在解密 item 时抛出
  `invalid type: JsValue(...), expected a string`。本次发布 setup 受控固定官方 CLI `2026.6.0`；后续应升级
  Vaultwarden 到支持 2026.7.0+ client 的版本，再删除这个临时版本 pin。
- production bundle 仍报告大 chunk，尤其 editor 与 AppShell；这是 code-splitting/performance
  follow-up，不是 build correctness failure。
- Readonly View 本轮只支持受约束的 Embedded Markup，不执行 Note 内代码。未来若引入 MDX、完整 HTML 或其它
  可执行文档格式，必须单独设计 document type、trust、sandbox、navigation、resource 与 Riffle capability
  边界；不能通过放宽 Markdown renderer allowlist 偷渡实现。
- Playwright browser journeys 仍绑定固定 preview port `4173`；并行 agent 同时运行 suite 时可能因端口
  已占用而在用例开始前失败。单独复跑已通过 35/35，确认这不是产品 bug；后续应由测试编排分配隔离端口，
  不能通过杀掉其他 agent 的进程来掩盖冲突。
- `@octanejs/base-ui` 已正式发布 Menu/Menubar/ContextMenu subpaths，但 Riffle 仍保留现有
  ContextMenu。后续 adoption 需要把 Root/Trigger owner 移入 FileTree/PinnedNotes callers，并以
  browser journey 验证右键、键盘导航、dismissal 和 focus restore；不要复制 binding source。
- Octane `0.1.23` 的 TSRX key selector 仍不能直接捕获 component-local `label`：
  `ReadonlyShortcutRow` 使用 ``key `${label}-${key}-${index}` `` 时 production Shortcuts 页面消失。
  当前只在该 owner 预计算 `{ key, id }`；待上游修复后用 `tests/browser/settings.spec.ts` 证明可删除。
- `@pierre/trees` 当前仍是 `1.0.0-beta`，且 package metadata 声明 React peers。采用 Vanilla runtime
  前必须证明不会安装或加载 React，并以 browser journeys 锁住 focus、keyboard、rename、drag/drop
  和 context-menu 行为。
- `@celados/fff-node` 通过 `ffi-rs` 加载平台 `@celados/fff-bin-darwin-*` cdylib。#13 已对 unsigned local
  artifact 验证 ASAR header、exact unpacked native payload、updater metadata 与 packaged utility smoke；
  Developer ID 签名、公证和 Gatekeeper 验证只能由 tag release workflow 使用真实 Apple credentials 闭环。
- `v0.2.6` 的 canonical assets、匿名 readback 与 production updater smoke 已通过，网站源码也已切到
  该版本。Riffle 不拥有 `usemarkd.app`，当前 Cloudflare 凭据可见的账户均不包含该 zone，因此
  不能把源码更新宣称为线上部署。只有产品域名 ownership 完成裁决、对应账户明确授权后，才能绑定并
  验证 Riffle 的公开网站；在此之前以公开 GitHub Release 作为正式下载入口。
- Directory symlink support is implemented across local `fff` and Riffle sources and passes against the locally
  rebuilt `libfff_c.dylib`, but the user chose not to publish a new FFF nightly. Before shipping Riffle, publish the
  matching `@celados/fff-node` plus platform binaries, update the exact dependency and lockfile, then rerun the
  Electron linked-folder journey. The currently published `0.10.2-nightly.dbc0f62` can scan linked folders initially
  but does not keep external targets live.
- zlob currently deduplicates followed directories globally by physical `(dev, ino)`. If two Vault symlinks point
  to the same target, only one logical alias is indexed. Before releasing directory symlinks, add a dual-alias
  regression and change cycle detection to track the current logical branch if the product contract keeps both
  mounts visible; the current “transparent logical mounts” wording otherwise overstates the implementation.
- Solid 2 迁移使两条 Octane 特定条目失去意义，保留在此仅为迁移期间的历史判据：`@octanejs/base-ui`
  的 Menu/Menubar/ContextMenu adoption，以及 Octane TSRX key selector 无法捕获 component-local
  `label` 的 workaround。前者的替代不是换一个现成库——Solid headless 生态
  的 peer range 直接排除 2.0，替代方案是自建单包 `@celados/solid-ark`（基线 zag v2），见
  [`docs/solid2-migration-plan.md`](../docs/solid2-migration-plan.md) 的「Headless UI 自建」；后者随 TSRX
  一起退出，`ReadonlyShortcutRow` 的预计算 `{ key, id }` 在 Wave 5 重写时直接用 Solid 的 keyed
  `<For>` 表达，不要移植 workaround。
- `@octanejs/dnd-kit` 在 `package.json` 里但 `src/` 与 `electron/` 零引用。Phase 0 直接删依赖，
  不要为它在 Solid 侧找对应物——现存候选 `@thisbeyond/solid-dnd` 自 2023-11 未更新，真需要拖拽时
  重新评估。
- Solid 2 目前是 `2.0.0-rc.0`，发布节奏约两天一版。迁移期间精确 pin、不跟版本；Wave 6 收敛后统一
  评估一次升级。升级判据与登记要求见迁移计划的 RC churn policy。
