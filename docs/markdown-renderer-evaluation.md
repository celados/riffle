---
type: Evaluation
title: Riffle Markdown renderer evaluation
description: >
  评估删除 Tiptap 后的只读 Markdown 渲染、未来 agent 流式输出方案与 Markstream follow-up，
  并判断 Comark 是否仍是 Riffle 当前的最佳选择。
status: completed
version: 1.1
generated: { by: codex/gpt-5, at: 2026-08-22T17:06:01+08:00 }
tags: [markdown, streaming, comark, markstream, streamdown, solid2, renderer]
---

# Riffle Markdown renderer evaluation

## Verdict

**在产品早期以一次性渲染为主、renderer 正从 Octane 迁往 Solid 2 的约束下，Comark 继续作为当前采用方向。**
Comark 自己把 Markdown 解析成框架无关的 document AST；该 AST 与 Octane 或 Solid 的编译器 AST
没有关系。Riffle 需要维护的是把 Comark document nodes 投影成当前 UI framework elements 的薄 view adapter：
今天是 Octane，迁移后是 Solid 2。parser、未来的 stream session、安全策略和产品 URL 语义不随 UI framework 更换。
原评估使用 Ripple 作为长期目标；[ADR 0003](./adr/0003-adopt-solid-2-as-the-renderer-runtime.md) 后继裁决为
Solid 2，但这次 runtime 变化只增强了 framework-neutral seam 的必要性，没有推翻 parser 选型。

[`@octanejs/streamdown`](https://github.com/octanejs/octane/tree/main/packages/streamdown) 仍是短期接入成本最低、
验证流式 UX 最快的候选，但它的主要优势来自 Octane binding；既然 Octane 不是长期架构约束，这项便利不应主导
核心选型。Comark 0.x 的 AST 也不应被宣称为稳定 ABI：它只能封装在 Riffle 的 Markdown module 内部，不能成为
持久化格式、IPC contract 或跨 domain 公共类型。

结论置信度：**高**。能力判断由官方源码支撑，累计 snapshot、canonical finish、DOM identity、选区与滚动稳定性
已经由 throwaway prototype 验证。真实产品 bundle 与持久化更新链仍由实现 tickets 验收。

## Decision drivers

1. 静态 vault 文档必须正确渲染 CommonMark/GFM，并保留 Riffle 自己的 note link、vault asset 和外链策略。
2. 产品早期默认一次性渲染完整 Note body，不为尚未交付的 agent streaming consumer 扩大 runtime；未来 agent
   输出若以“不断增长的累计 Markdown 字符串”进入 UI，未闭合的 fence、inline marker、表格、链接和 frontmatter
   仍不应让当前帧崩坏。
3. renderer 必须是只读边界。不得为了渲染重新引入编辑器 transaction、selection、schema 或序列化模型。
4. Markdown 和其中的 HTML、链接、图片均按可携带主动内容的数据处理；Readonly View 支持受约束的 Embedded
   Markup，但不授予其应用代码权限。
5. Riffle 当前使用 Octane，已裁决迁移到 Solid 2；parser 与产品策略必须独立于二者，framework adapter 应可替换。
6. 稳定块应尽量保留 DOM identity，避免流式输出期间选区、复制和滚动锚点持续抖动。
7. 本轮 Riffle Markdown contract 是 CommonMark/GFM、wiki links、Vault assets 与 Embedded Markup；不借 renderer
   迁移加入 Comark components、MDX、Mermaid、math 或 agent-native UI components。

## Pre-cleanup Riffle baseline (historical)

本节记录 issue #42 实施前、commit `f91d8a1` 的依赖与源码形态，仅作为选型和 bundle 对照证据；
当前 runtime contract 以根 `AGENTS.md`、`CONTEXT.md` 与实现为准。

### Confirmed

- 当前 rich-text view 实际是 Tiptap 3.28.0 + ProseMirror，并直接依赖 `@octanejs/tiptap`、大量
  `@tiptap/extension-*`、`@tiptap/markdown`；Markdown source mode 另有 CodeMirror。本轮删除 Tiptap editor
  schema、slash/bubble menu、ProseMirror find/replace decoration、wiki-link input rule 和富文本/源码双向
  round-trip，但保留现有 CodeMirror Source Editor。
  [Riffle package metadata at f91d8a1](https://github.com/celados/riffle/blob/f91d8a1/package.json)
  [NoteEditor at f91d8a1](https://github.com/celados/riffle/blob/f91d8a1/src/components/editor/NoteEditor.tsrx)
- vault 图片在文件中保持 `.markd/assets/...` 相对路径，显示时改写为受 Electron main 校验的
  `riffle-asset:` URL；相对 note link 由 Riffle 自己路由。任何 renderer 都必须允许 Riffle 覆盖 `a`、`img`
  与 code block，而不是自行解释这些 URL。
  [Tiptap extensions at f91d8a1](https://github.com/celados/riffle/blob/f91d8a1/src/components/editor/extensions.ts)
  [asset protocol](https://github.com/celados/riffle/blob/main/electron/native-content.ts)
- Riffle 已在读取时把 YAML frontmatter 与 body 分离，因此 Markdown renderer 应只接收 body；parser 自带的
  frontmatter 处理不应成为第二个 metadata source of truth。
  [frontmatter boundary](https://github.com/celados/riffle/blob/main/src/lib/frontmatter.ts)

### Inference

- 删除 Tiptap 后，tab pane 不再需要“一 tab 一个常驻 editor instance”来保护 dirty draft。静态 preview 可以按
  Markdown 字符串派生；agent stream 则为每条正在生成的 message 保留独立 stream state。
- Source Editor 是保留的独立编辑能力；本轮不迁移或重写其 CodeMirror 实现。Tiptap 专属的 slash command、
  selection toolbar、ProseMirror find/replace 和 rich-text mutation path 随 Tiptap 删除；copy/export/publish、
  页面导航与查找继续作为独立能力。Source Editor 保留 find/replace；Readonly View 只提供 find/highlight，不能 replace。

### Accepted update paths

- Properties Editor、Source Editor、agent 与外部工具产生的持久化修改统一写入 Vault file；Readonly View 从最新
  accepted Note source 重新解析。该低频路径不要求 AST 级增量优化，避免 props/source 各自持有并回写 body 快照。
- Markdown Stream 是独立的内存路径，不经过 filesystem change。只有该路径使用 Comark streaming session、稳定
  AST node 复用与 DOM identity 优化。

### Accepted delivery scope

- 本轮产品只交付 Vault Note 的 static Readonly View 并删除 Tiptap；没有 agent-output consumer，因此不加入
  production stream UI、transport、global session store 或其它无人调用的 app machinery。
- streaming 是已通过的 Comark adoption evidence：prototype 已验证 cumulative snapshots、correction fallback、DOM
  stability 与 final equivalence。未来第一位真实 consumer 复用该合同再接入 production。
- batch 可以视为单次大 snapshot，但 canonical completed document 使用无历史状态的 full parse；streaming mode 的
  auto-close、position preservation 与 node reuse 不能替代 finish 时的 canonical parse。

### Confirmed product boundaries

- Properties Editor 保留为独立、可编辑的 frontmatter surface；它只拥有 frontmatter mutation，不能从旧快照重写
  Note body。TitleInput 保留为 Vault rename operation，而不是 Markdown mutation；Note 本身确定为可变数据源。
- 未来 agent 输出是否包含受信任的自定义组件语法尚未确定。本轮不应因这个假设提前采用 Comark components。

## Candidate evaluation

### 1. Comark 0.6.0

#### Confirmed strengths

- Comark core 把 Markdown 解析成紧凑、可序列化的 tuple AST，并提供 Vue、React、Svelte、Angular、HTML 和
  ANSI renderer；core 与 renderer 分离，符合 Riffle 建立窄 parser/renderer seam 的长期方向。
  [Introduction](https://comark.dev/raw/getting-started/introduction.md)
  [Document model](https://comark.dev/raw/getting-started/document-model.md)
- parser 支持 CommonMark/GFM、表格、task list、raw HTML、frontmatter 和 Comark component/attribute syntax；
  plugin API 有 pre/post hooks，也能复用 markdown-it plugins。
  [Markdown support](https://comark.dev/raw/syntax/markdown.md)
  [Plugin API](https://comark.dev/raw/plugins/custom/plugin-api.md)
  [markdown-it integration](https://comark.dev/raw/plugins/custom/markdown-it.md)
- `createMarkdownParser()` 的 streaming mode 不是单纯每帧全量解析：当新输入以前一输入为前缀时，源码保留
  已稳定的顶层 AST nodes，并从最后一个可能变化的 block 附近重解析尾部；非 append 更新回退到全量解析。
  [parser source](https://github.com/comarkdown/comark/blob/main/packages/comark/src/parse.ts)
  [incremental reuse source](https://github.com/comarkdown/comark/blob/main/packages/comark/src/internal/parse/incremental.ts)
- `autoCloseMarkdown()` 对流式帧补齐未闭合的 emphasis、inline code、link/image、table、frontmatter、math 和
  Comark components；实现声明为单次线性扫描，并有专门 streaming/auto-close tests。
  [Streaming API](https://comark.dev/raw/api/auto-close.md)
  [auto-close source](https://github.com/comarkdown/comark/blob/main/packages/comark/src/internal/parse/auto-close/index.ts)
  [streaming tests](https://github.com/comarkdown/comark/blob/main/packages/comark/test/streaming.test.ts)
- 官方 security plugin 会去除事件属性和危险 protocol，并可限制 tags、link/image prefixes 与 data images；
  Shiki highlight plugin 支持按需语言、双主题和 transformer。
  [Security plugin](https://comark.dev/raw/plugins/built-in/security.md)
  [security tests](https://github.com/comarkdown/comark/blob/main/packages/comark/test/plugins/security.test.ts)
  [Syntax highlighting](https://comark.dev/raw/plugins/built-in/syntax-highlight.md)
- 当前 npm `comark@0.6.0` 为 MIT；2026-02 首次发布，0.6.0 在 2026-08-04 发布。core 包的 registry
  `dist.unpackedSize` 为 478,835 bytes，依赖 `markdown-exit@1.1.0-beta.2`、`htmlparser2`、`js-yaml` 和
  `entities`。这说明项目活跃，但也明确处于年轻的 0.x 与 beta parser dependency 阶段。
  [npm registry metadata](https://registry.npmjs.org/comark/latest)
  [0.6.0 release](https://github.com/comarkdown/comark/releases/tag/comark%400.6.0)
  [MIT license](https://github.com/comarkdown/comark/blob/main/LICENSE)

#### Costs and risks

- Comark 没有 Octane 或 Ripple renderer。使用 `@comark/html` 再插入 HTML string 会把 DOM ownership、事件路由
  和安全边界推向 `innerHTML`；使用 core AST 则必须由 Riffle 分别提供 Octane 与 Ripple view adapter。这里处理的
  输入是 Comark document AST，不是两种 framework 的 compiler AST。
  [Installation / supported renderers](https://comark.dev/raw/getting-started/installation.md)
- security plugin 是**显式 opt-in**；core 默认解析 HTML，security 默认也不 block `script`/`iframe`/`style`
  tags，protocol/prefix 策略较宽且允许 data images。Riffle 需要显式 element/attribute allowlist 加上自有 URL
  policy；不能把“提供 security plugin”误读成“默认适合 Electron 主应用 DOM”。
  [parser defaults](https://github.com/comarkdown/comark/blob/main/packages/comark/src/parse.ts)
  [security defaults](https://github.com/comarkdown/comark/blob/main/packages/comark/src/plugins/security.ts)
- parser instance 保存 `lastInput`/`lastOutput`。因此每个并发 agent message 必须有独立 parser instance；共用一个
  global parser 会污染增量复用状态。这是源码推导，不是文档承诺。
  [parser state source](https://github.com/comarkdown/comark/blob/main/packages/comark/src/parse.ts)
- 0.6.0 本身是 breaking release，刚完成公开 API 大规模重命名。现在把 AST type 和 plugin surface 暴露给整个
  app 会扩大升级面。
  [0.6.0 release notes](https://github.com/comarkdown/comark/releases/tag/comark%400.6.0)

#### Assessment

Comark 的 parser 设计比“对完整字符串跑普通 Markdown renderer”更适合流式内容，也比 framework-bound renderer
更适合成为长期 core。投影层仍有真实成本，但它只需覆盖 Riffle 接受的 Markdown node allowlist、链接和 asset
语义，不需要拥有 editor transaction、selection、schema 或 serialization；这与维护编辑器不是同一量级的问题。

### 2. `@octanejs/streamdown` 0.1.4 / Streamdown 2.5.0

#### Confirmed strengths

- Streamdown 是专门为 AI streaming 设计的 GFM renderer，包含未闭合 Markdown 修复、按 Markdown block 拆分、
  memoized block rendering、caret/animation、Shiki code、KaTeX、Mermaid、CJK 与可替换 components。
  [official docs](https://streamdown.ai/en/docs)
  [block parser source](https://github.com/vercel/streamdown/blob/main/packages/streamdown/lib/parse-blocks.tsx)
  [renderer source](https://github.com/vercel/streamdown/blob/main/packages/streamdown/index.tsx)
- 未闭合语法由独立 `remend` preprocessor 修复；官方列出 links/images、fences、inline markers、HTML、math 等
  情况，并允许 custom handlers。streaming mode 把累计文档切成 block，已完成 block 通过 key 与 memo 保持，
  只有尾部变化 block 重渲染；含 footnote 时会退化为单 block 以保持全局语义。
  [termination docs](https://streamdown.ai/en/docs/termination)
  [remend source](https://github.com/vercel/streamdown/tree/main/packages/remend)
  [block parser source](https://github.com/vercel/streamdown/blob/main/packages/streamdown/lib/parse-blocks.tsx)
- Octane 已有官方列出的完整 port：`@octanejs/streamdown@0.1.4` 对齐 Streamdown 2.5.0 root runtime/types，
  并带 code 1.1.1、math 1.0.2、Mermaid 1.0.2、CJK 1.0.3 subpaths。HAST adapter 委托 Octane
  `createElement`，已有 static/streaming、custom components、code/math、SSR/hydration tests。
  [Octane binding status](https://github.com/octanejs/octane/blob/main/docs/bindings-status.md#octanejsstreamdown)
  [binding provenance](https://github.com/octanejs/octane/blob/main/packages/streamdown/UPSTREAM.md)
  [binding README](https://github.com/octanejs/octane/blob/main/packages/streamdown/README.md)
- Streamdown 默认经过 `rehype-sanitize`；可覆盖 `a`、`img`、`code` 等节点，能让 Riffle 保留 note navigation、
  `riffle-asset:` URL 和 code controls，而不接管 parser 或 DOM reconciler。
  [security docs](https://streamdown.ai/en/docs/security)
  [custom components](https://streamdown.ai/en/docs/components)
- upstream 为 Apache-2.0；项目始于 2025-08，`streamdown@2.5.0` registry 解压大小约 96 KB。Octane binding 同样为
  Apache-2.0，当前 registry 解压大小约 380 KB，peer 为 Octane 0.1.25。
  [Streamdown npm metadata](https://registry.npmjs.org/streamdown/latest)
  [Octane binding npm metadata](https://registry.npmjs.org/%40octanejs%2Fstreamdown/latest)
  [upstream license](https://github.com/vercel/streamdown/blob/main/LICENSE)

#### Costs and risks

- Streamdown 的 incomplete repair 与 block boundaries 仍是 heuristic，不是“任意 prefix 都具有正式 Markdown
  语义”的规范。block parser 依赖 Marked lexer，实际 AST/render pipeline 是 unified + remark/rehype；两个 parser
  family 的边界组合需要 Riffle corpus 验证。
  [block parser source](https://github.com/vercel/streamdown/blob/main/packages/streamdown/lib/parse-blocks.tsx)
  [package dependencies](https://github.com/vercel/streamdown/blob/main/packages/streamdown/package.json)
- 默认 harden policy 允许任意 link/image prefix、任意 protocol 和 data image；`rehype-sanitize` 仍在，但这不是
  Riffle 所需的网络隐私与 Electron navigation policy。覆盖 rehype plugins 时还会替换默认数组，漏掉 sanitizer
  会退化为 XSS 风险。
  [security defaults and warning](https://streamdown.ai/en/docs/security)
- Octane port 和上游都年轻；port 的 public surface/SSR 证据充分，但 Riffle 的 Electron、CSP、asset scheme、
  system Chrome 与长流性能尚未被该 binding 的通用 suite 覆盖。
  [binding status](https://github.com/octanejs/octane/blob/main/docs/bindings-status.md#octanejsstreamdown)
- Octane package 声明 Shiki、KaTeX、Mermaid 等为 direct dependencies。subpath 与 tree-shaking 理论上可避免把未用
  plugin 送入 renderer bundle，但 package install footprint、Vite chunk graph 和 Electron startup 必须实测，
  不能从 `dist.unpackedSize` 推断。
  [binding package metadata](https://github.com/octanejs/octane/blob/main/packages/streamdown/package.json)

#### Assessment

这是当前唯一同时覆盖流式 Markdown、GFM、安全 pipeline、代码高亮与 **Octane-native DOM ownership** 的成熟度
足够候选，因此是最好的短期战术方案和 UX reference。但它把主要价值放在 Octane component layer；在 Ripple 是
明确长期方向后，不应仅为少写一个当前 adapter 而把 parser/core 选择绑定到这层。

### 3. micromark 4.0.2 + GFM extensions

#### Confirmed

- micromark 100% 对照 CommonMark、提供 GFM/MDX/directive/frontmatter/math extensions，默认编码 raw HTML 并
  丢弃危险 protocol；官方 suite 覆盖 CommonMark cases、额外测试、100% branch coverage 与 fuzzing。MIT，
  项目和 semver 历史远长于另外两个候选。
  [official README](https://github.com/micromark/micromark#feature-highlights)
  [tests](https://github.com/micromark/micromark#test)
  [security](https://github.com/micromark/micromark#security)
  [npm metadata](https://registry.npmjs.org/micromark/latest)
- 它的 Node `stream()` 只增量 tokenize/buffer；源码明确说明最终仍需 buffering，并只在 `end()` 时 compile 与
  emit HTML。它不是 agent UI 所需的逐帧 partial renderer。
  [stream source](https://github.com/micromark/micromark/blob/main/packages/micromark/dev/stream.js)

#### Assessment

micromark 是最稳健的完整文档 parser 基线，也适合做 differential oracle，但要支持当前帧仍需自己实现
auto-close、AST-to-Octane renderer 和 DOM incremental update。它的“stream API”不能满足本需求，不能因名字
里有 stream 就误选。

### 4. `streaming-markdown` 0.2.15

#### Confirmed

- 这是 framework-agnostic、真正 append-only 的 parser/renderer interface：chunk 可多次 `parser_write`，默认
  renderer 只向 DOM 追加 token，目标是保持已渲染文本的选区；官方声称 minified 约 3 KB gzip，MIT，无 runtime
  dependency。
  [official repository and API](https://github.com/thetarnav/streaming-markdown)
  [npm metadata](https://registry.npmjs.org/streaming-markdown/latest)
- 官方 README 自称 experiment/WIP，feature matrix 明确缺少 reference links、完整 autolinks、HTML、table
  alignment/multiline cells 等。最新 npm 版仍是 0.2.15（2025-05）。
  [feature matrix](https://github.com/thetarnav/streaming-markdown#markdown-features)

#### Assessment

它的 DOM 稳定性思想很好，但 Markdown coverage 与成熟度不足，且自带 DOM mutation owner 会绕开 Octane。可把其
append-only/selection 测试思想纳入 Riffle suite，不应作为主 renderer。

## Comparative matrix

| Dimension | Comark | `@octanejs/streamdown` | micromark | `streaming-markdown` |
| --- | --- | --- | --- | --- |
| Streaming correctness | 增量复用 AST 尾部 + auto-close；需验证所有 chunk boundaries | remend + block memo；面向 AI，footnotes 退化全块 | 只在 end 后输出，不满足实时帧 | 真 append-only，但语法覆盖不完整 |
| Markdown/GFM | 官方声明 CommonMark/GFM + components | GFM + code/math/Mermaid/CJK plugins | 最强 conformance + extensions | 自定义子集 |
| Framework portability | framework-neutral AST；需薄 Octane/Ripple adapters | Octane port 完整；Ripple 需要重新选型或移植 | framework-neutral；需自建 streaming/view | imperative DOM，绕开 framework owner |
| DOM owner | 自建时由 Riffle；HTML renderer 时是 string | Octane component tree；稳定 block memo | 自建 | library imperative renderer |
| Security | 强 plugin，但 opt-in 且默认宽 | sanitize 默认在；harden 默认宽，须收紧 | 默认安全 HTML output；extensions 另审 | renderer policy 需自审 |
| Extensibility | 最强：serializable AST、plugins、components | remark/rehype + components + optional plugins | 底层 syntax/HTML extensions，复杂 | renderer callbacks，语法扩展弱 |
| Runtime/bundle | core 较轻但需 renderer；highlight 可按需 | 完整 feature graph 较重，tree-shaking 待测 | parser 约 14 KB 官方口径 | 约 3 KB gzip 官方口径 |
| Maturity | 活跃但 0.6、刚 breaking、beta parser dep | 上游与 Octane port 都年轻；port 有 parity evidence | 最成熟 | WIP 0.x |
| License | MIT | Apache-2.0 | MIT | MIT |
| Riffle migration risk | 中：需写当前 adapter，但 parser 跨 Octane/Ripple 保留 | 短期低、Ripple 迁移时中高 | 高 | 高 |

上述行分别由各候选的官方 docs/source/package metadata 支撑：
[Comark](https://comark.dev/llms-full.txt)、
[Streamdown](https://streamdown.ai/llms.txt)、
[Octane binding status](https://github.com/octanejs/octane/blob/main/docs/bindings-status.md#octanejsstreamdown)、
[micromark](https://github.com/micromark/micromark)、
[`streaming-markdown`](https://github.com/thetarnav/streaming-markdown)。

## Recommended architecture

```text
Vault note body ───────────────┐
                              ├─> Riffle MarkdownEngine ─> Comark document AST
Agent cumulative text stream ─┘          │
                                         ├─ URL / asset / Embedded Markup policy
                                         ├─ OctaneMarkdownView (now)
                                         └─ RippleMarkdownView (later)
```

### Public seam

UI-facing `MarkdownRenderer` 应只接收产品语义。Comark types 留在同一 Markdown module 内部，不进入 store、IPC 或
其他 domain：

```ts
type MarkdownRendererProps = {
  markdown: string;
  source: { kind: "vault-note"; rel: string };
};
```

Properties Editor 不属于 `MarkdownRenderer`：Properties 与 Source edits 都通过 Vault file 形成 Persisted Note
Update，Readonly View 再从最新 accepted Note source 分离 frontmatter 与 body。Properties write 不能携带加载时的
旧 body 快照；toggle 或 split view 都遵循同一事实源，不需要为该低频路径设计 AST 增量状态。

- 当前 public seam 只交付无历史状态的完整 document parse，不暴露 `streamId`、provider chunk 或 parser session。
  未来有真实 agent consumer 时，再为每条 stream 建立独立 session：接收上游累积的 snapshot，prefix extension
  复用稳定节点，non-prefix correction 回退完整解析，finish 后以 static/full parse 验证最终语义。
- framework view adapter 覆盖 `a` 与 `img`：relative `.md` link 进入 note router，外链只交给 Electron main 的 trusted
  navigation，vault-relative image 经 `window.riffle.vault.assets.url()`，其余 remote/data image 默认拒绝。
- Embedded Markup 通过显式 element、attribute、navigation 和 resource policy 渲染；script、事件属性、特权 embed
  与 Riffle bridge access 不进入 Markdown renderer。未来 MDX、完整 HTML 或其它可执行文档格式单独立 proposal。
- 初始只启用 GFM；code block 保留 copy action，但不因 renderer 迁移新增 highlighting dependency。Math、Mermaid、
  动画、下载控件都不进入第一版。
- prototype 已证明 static 与 streaming 对同一 corpus 产生相同的最终语义；该证据不要求把 streaming mode 暴露为
  当前产品 contract。library 的额外语法支持也不能自动变成产品 contract。
- 不导出 Comark nodes、plugins 或 component props 到 store/domain 层。Comark 0.x 的 AST shape 若发生 breaking
  change，只允许影响 Markdown module 内的 parser tests 与 framework adapter。它不进入 Vault store、IPC、
  Electron main、持久化缓存或公开 fixture schema；当前调用方只传 Markdown source 与 Vault Note context。

### Why not Comark HTML

`@comark/html` 适合 SSR/static string，不适合作为 Riffle renderer seam：它要求再用 HTML injection 把字符串交给
DOM，Riffle 随后还要重绑内部链接、asset、copy controls 和安全策略。直接渲染 Comark AST 虽然更干净，但等同于
新建一个 framework adapter；在明确需要 Comark components 或多 renderer AST 前，没有足够收益。

## Prototype evidence and implementation gates

Throwaway branch `prototype/comark-engine-20260805`（commits `6011407`、`642c145`）完成了选型验证，且不合并
prototype machinery 到 main：

- 同一 corpus 在 static 与 cumulative streaming 的最终语义一致；每个 UTF-16 boundary、prefix update、non-prefix
  correction、last-known-good fallback 与 canonical finish 均通过。
- system Chrome 中，21/21 个 completed-prefix elements 在连续 snapshots 和 semantic-equal finish 后保留精确 DOM
  identity、selection anchor/focus、selection text、scroll position 与 anchor offset。active changing tail 不承诺稳定。
- 10/100/500 KiB static parse 约为 2.4/24.0/113.2 ms；累计 1 KiB snapshot p95 约为
  4.8/30.7/222.6 ms。500 KiB heap 增长明显，因此这些数据只描述特性，不构成未经产品 workload 支撑的阈值。
- narrow projection 与不使用 `innerHTML` 的 Embedded Markup policy 均已证明可行；Comark AST 与 keys 保持 module-private。

实现仍须通过 #37 及其子 tickets 规定的 Riffle semantics、Embedded Markup negative corpus、system Chrome browser
contracts、Electron persisted-update journey、真实 Vite/asar bundle evidence 和完整回归。失败应优先归类为 adapter 或
upstream Comark 问题，而不是在应用内堆 workaround。

## Issue #42 bundle evidence

main baseline 与 clean cut 都在相同 pnpm/Vite toolchain 下运行 `pnpm run build`。baseline commit
`f91d8a1` 已包含 Comark 0.6.0 与 Readonly View，也仍包含 Tiptap/ProseMirror；因此下面的差值隔离的是
issue #42 删除旧 editor runtime 后的应用 bundle 变化，不把 registry unpacked size 当成 bundle 证据。

| Vite renderer asset | `f91d8a1` baseline | issue #42 clean cut | Delta |
| --- | ---: | ---: | ---: |
| AppShell raw | 1,539.76 kB | 1,285.27 kB | -254.49 kB (-16.53%) |
| AppShell gzip | 514.38 kB | 435.82 kB | -78.56 kB (-15.27%) |
| CSS raw | 101.35 kB | 98.90 kB | -2.45 kB (-2.42%) |
| CSS gzip | 20.57 kB | 20.14 kB | -0.43 kB (-2.09%) |

hash 只标识该次可复核构建：baseline 为 `AppShell-BQykB3rl.js` / `index-Cg-7pRt4.css`，clean cut
为 `AppShell-B_08HyHT.js` / `index-D5fQd2TK.css`。最终依赖图保留 direct `comark@0.6.0`，且
`pnpm why @tiptap/core` 无结果；dependency/source gate 同时锁住 package manifest、lockfile、active
source/config 与已废弃 editor module paths。

## Markstream follow-up (2026-08-22)

本节记录对 [`Simon-He95/markstream-vue`](https://github.com/Simon-He95/markstream-vue) 的后续评估。
检查基于 upstream commit
[`02d8bbaa9b1b4e2e9a99ce19a2ed23844946b75c`](https://github.com/Simon-He95/markstream-vue/tree/02d8bbaa9b1b4e2e9a99ce19a2ed23844946b75c)，
当时 npm stable line 为 `markstream-vue@2.0.1`、`markstream-core@2.0.1`、
`stream-markdown-parser@1.2.9`，仓库 root 已进入 `2.0.2-beta.0`。版本与体积事实是该日快照，未来采用前必须重查。

### Architecture finding

Markstream 已经不是纯 Vue library，但也不是一个 `core + thin framework binding` 的完整实现：

| Layer | Package | Responsibility | Riffle assessment |
| --- | --- | --- | --- |
| Parsing | [`stream-markdown-parser`](https://github.com/Simon-He95/markstream-vue/tree/02d8bbaa9b1b4e2e9a99ce19a2ed23844946b75c/packages/markdown-parser) | framework-neutral Markdown-it based parser、自定义 structured nodes、stream/final mode、stable top-level node reuse、source map | 是真实可独立采用的 parser，但 surface 明显大于 Riffle 当前 Markdown contract |
| Stream pacing | [`markstream-core`](https://github.com/Simon-He95/markstream-vue/tree/02d8bbaa9b1b4e2e9a99ce19a2ed23844946b75c/packages/markstream-core) | framework-neutral smooth stream controller、append detection、fence-safe reveal、diff/language helpers | 边界最干净；未来 agent stream 可优先单独 spike |
| View adapters | Vue 3 / React / Svelte / Angular / Vue 2 / [`Octane`](https://github.com/Simon-He95/markstream-vue/tree/02d8bbaa9b1b4e2e9a99ce19a2ed23844946b75c/packages/markstream-octane) | 完整 component tree、HTML policy、code diff、Mermaid、KaTeX、D2、Infographic、workers、virtualization | 不是薄 binding；没有 Solid adapter，完整移植会把大量产品能力及维护面带入 Riffle |

`markstream-core` 的名字容易造成误读：它不拥有 Markdown parser 或 framework-neutral render tree；parser 是另一个包，
而高级 block 生命周期和大部分 rendering policy 仍由每个 framework adapter 实现。Riffle 若只接 parser，工作量可控；
若要获得完整 Markstream UX，就需要编写并长期维护 Solid adapter，不能按“换一个 parser dependency”估算。

### Capability versus architectural fit

Markstream 作为完整的 AI streaming Markdown renderer 明显比 Comark 丰富：它已经覆盖流式代码 diff、渐进 Mermaid/KaTeX、
长文档 live-node bounding、worker、source map、custom components 和多框架 smoke/security gates。这些是可信的未来候选能力，
但不是 Riffle 早期 Note view 的当前需求。

它没有成为当前更好 core replacement，原因如下：

- Riffle 早期主要对完整 Note body 做一次性 parse；尚无真实 consumer 支撑引入 stream pacing、heavy blocks 或 virtualization。
- `stream-markdown-parser` 为处理中间态、math、HTML 和 custom tags 带有较多 heuristic transform；能力更宽，也扩大了语义与回归面。
- 2026-08-22 registry `dist.unpackedSize` 快照约为 parser 3.36 MB、Comark 0.51 MB。这不是应用 bundle 证据，
  但足以说明 parser-only adoption 也不是无成本替换，必须另做相同 toolchain 的 bundle measurement。
- Markstream `safe` policy 仍允许普通 HTTP/HTTPS links 和 images；Riffle 必须继续执行自己的 Vault asset、trusted external
  navigation 与 remote/data/file resource policy，不能把 adapter 默认安全策略当成产品合同。
- Riffle 已经把 Comark AST 收敛到 module-private [`ProjectedNode`](../src/markdown/riffle-markdown.ts)；替换 parser
  不会消除这层产品语义投影，只会更换它的内部输入 AST。

### Decision

当前 stack decision 不变：

1. Note Markdown View 保留 Comark，并继续使用无历史状态的完整 document parse。
2. 不添加 Markstream dependency，不移植 `markstream-octane`，也不因 upstream 的完整 feature set 扩大 Riffle Markdown contract。
3. 将 Markstream 记录为未来 `AgentMarkdownStream` 的首要候选，而不是静态 Note renderer 的直接替代。
4. 若真实 agent streaming consumer 出现，先单独 spike `markstream-core`；只有它不足以满足需求时，才让
   `stream-markdown-parser` 在既有 `ProjectedDocument` seam 后与 Comark 做 differential prototype。
5. 无论内部 parser 是什么，其 AST、plugins 与 stream session 都不得进入 store、IPC、persistence 或 public fixture schema。

以下任一条件出现时可重开评估：

- 产品交付持续更新的 agent Markdown，并需要明确的 pacing、pause、flush 或 correction semantics；
- 真实内容需要渐进 Mermaid/KaTeX、streaming diff、source map 或 renderer-owned long-document virtualization；
- Comark 触发下述 fallback condition，且问题无法在 module-private adapter 内干净隔离；
- Markstream 发布经过验证的 Solid 2 adapter，或把高级 block lifecycle 收敛为足够窄的 framework-neutral contract。

重开时必须复用 Riffle corpus，验证 static/final equivalence、non-prefix correction、stable DOM identity、selection/scroll、
Embedded Markup negative corpus、Vault URL/resource policy，以及相同 toolchain 下的 10/100/500 KiB latency、heap 和 bundle。

## Fallback conditions for Streamdown

满足任一条件时放弃或暂停 Comark，回退评估 `@octanejs/streamdown`：

- Comark 的 streaming parse 与 full parse 无法在 Riffle corpus 上维持 final equivalence；
- 稳定 AST nodes 无法映射成稳定 DOM identity，导致选区或滚动持续破坏；
- 安全 allowlist 必须依赖大量 app-local parser workaround；
- Octane view adapter 的实际复杂度明显超出支持 Riffle Markdown node set 的薄投影层；
- Comark 0.x 或 beta parser dependency 在真实升级中持续产生不可隔离的 breaking change。

## Residual risks

- Comark incremental reuse 在未来加入会改写既有节点的 plugin、跨块 reference definition 或 heading ID policy 后，
  仍须扩展 Riffle differential corpus；当前 prototype 不能替代未来语法扩展的回归证据。
- 500 KiB 累计 streaming 的 heap 与 latency 已出现明显增长。当前产品不交付 streaming consumer；未来接入真实
  agent workload 时，应以实际 snapshot cadence 决定 batching、节流或后台解析，而不是提前加入无人调用的机制。
