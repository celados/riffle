---
type: Research
title: Graph index for Riffle — 图索引选型调研与架构建议
description: >
  面向 Agent context 摄取的图索引调研:大厂开源引擎、Agent memory 社区项目、
  嵌入式图存储与本地笔记软件先例三条线的结论,以及 SQLite 边表投影方案的落地建议。
  Hypatia 作为后续语义检索架构参考记录在内。
status: draft
version: 0.2
generated: { by: codex/gpt-5, at: 2026-09-02T18:52:26+08:00 }
resource:
  - ./v2-engine-architecture.md
  - ./source-adapters.md
  - https://github.com/MarchLiu/hypatia
tags: [riffle, v2, graph, search, agent-context, sqlite]
---

# Decision(建议)

Riffle 不需要引入任何外部图引擎或图数据库。两类图统一为**一张 SQLite 边表投影**:

- **显式链接图**(wiki link):`links` 表已在 v2 relational model 规划内,零 LLM 成本,随 reconciler 增量维护。
- **隐式语义图**(概念实体关系):同一张边表加 `type` 与置信度列,由可选的 LLM 抽取 pipeline 灌入,bi-temporal 失效语义保证重建安全。

k 跳邻居展开用递归 CTE(万级节点实测毫秒级),向量召回用 sqlite-vec 同连接补齐。调研结论:没有任何现成开源项目可嵌入 Bun runtime;但 Graphiti/LightRAG/LlamaIndex 的六个设计机制可以脱离其实现移植进来。

# 问题

产品需求:图索引将一个概念和关联概念一起找出来,服务 Agent 的 context 摄取(`riffle find` 返回 candidate 后沿概念关系扩展 evidence)。候选直觉是引入现成的图引擎;但 v2 架构约束为:production runtime 无 Rust、Bun 单进程 daemon、SQLite 唯一投影存储、派生数据必须可从 Vault 重建。

本次调研回答三个问题:

1. 大厂开源项目(含阿里系)是否有解决同类问题的引擎?
2. 是否应该以"库开放架构"态度规划未来引入?
3. GitHub 社区是否有更契合的项目?

# 调研发现

## 第一线:大厂开源 — 全部不可嵌入

| 项目 | 形态 | 裁决 | 来源 |
| --- | --- | --- | --- |
| microsoft/graphrag (35.6k★, MIT) | Python 批处理 pipeline,已自述 largely in maintenance mode | 不适配;但 local search(seed 实体 fan-out 邻域)是检索层最佳参考 | github.com/microsoft/graphrag |
| Alibaba GraphScope (3.5k★) | 分布式集群(K8s/Vineyard),C++/Java 引擎 | 不适配;TB 级规模假设与个人 vault 错位 | github.com/alibaba/GraphScope |
| TuGraph-db(蚂蚁) / Apache GeaFlow | 独立 C++ server / 分布式流图计算;db 版维护降温(v4.5.2 停在 2025-03) | 直接排除 | github.com/TuGraph-family/tugraph-db |
| Apache GraphAr(孵化) | 图数据交换文件格式,非引擎 | runtime 不适配;类型化顶点/边表布局可作投影 schema 参考 | github.com/apache/incubator-graphar |
| LlamaIndex PropertyGraphIndex (51.8k★) | 进程内 Python 库;**LlamaIndexTS 无对应实现** | 部分适配:唯一给出"LLM 抽取 → upsert 存储 → 多路检索"完整闭环的项目,TS 自研的最佳蓝本 | docs.llamaindex.ai/en/stable/module_guides/indexing/lpg_index_guide/ |

结论:大厂在这个问题域给出的都是重型基础设施,personal knowledge 场景没有先例。用户的印象"阿里开源了类似索引引擎"对应的正是 GraphScope/TuGraph 一族,它们是分布式图计算系统,与桌面嵌入式场景完全错位。

## 第二线:Agent memory 社区项目 — 生态碎片化,思想可移植

| 项目 | 关键事实 | 裁决 | 来源 |
| --- | --- | --- | --- |
| getzep/graphiti (30.2k★) | temporal KG;强制 Neo4j/FalkorDB 外部图库,Kuzu 支持已弃用 | 不适配;**bi-temporal 失效机制必抄** | github.com/getzep/graphiti |
| topoteretes/cognee (30.2k★) | 默认组合已是全嵌入式(SQLite+LanceDB+Kuzu),但运行时是 Python pipeline | 不适配;其 Kuzu 弃用轨迹是生态警示 | github.com/topoteretes/cognee |
| HKUDS/LightRAG (39.1k★, MIT) | 每 chunk 一次 LLM 调用抽取;upsert 合并同名实体;按文档删除派生数据 | 思想最契合、实现不适配 | github.com/HKUDS/LightRAG |
| mem0ai/mem0 (63.8k★) | **v3 起 graph memory 从 OSS 移除、收进商业平台**,无 OSS 替代 | 不适配(OSS 已无图);三信号融合检索可抄 | docs.mem0.ai/open-source/graph-memory.md |
| basicmachines-co/basic-memory (3.7k★, AGPL) | Markdown 真源 + 文件监听 sync 到 SQLite + MCP;零 LLM 抽取,图完全来自 wikilink | **与 Riffle 投影哲学同构的方向验证**;其未做隐式语义层 = Riffle 差异化空间 | github.com/basicmachines-co/basic-memory |
| MarchLiu/hypatia (235★, MIT; inspected @ `862bef1`, 2026-09-02) | Rust agent-memory CLI;v0.3 为单 SQLite 源真相 + FTS5/JSON 倒排/HRT 三元组/JSE/递归 CTE k-hop,向量 BLOB 为 truth、usearch 为可重建缓存;jieba 预分词支持中文 | **不作为 runtime 依赖**;作为语义检索架构参考。其 shelf/name/triple identity 与多 agent 直写模型,和 Riffle 的 Vault path、watch reconciliation、single Engine owner 不一致 | github.com/MarchLiu/hypatia |

Hypatia 的价值在于把 FTS、向量、JSON 字段过滤和 k-hop 图遍历组合成可运行的 agent-memory 系统。Riffle 不应复制它的存储所有权:Markdown Vault 仍是源真相,Hypatia 式能力应落成 Engine SQLite 的 rebuildable projection,并把每条语义边绑定到 `source_path + source_rev`。另外其 README 仍描述 DuckDB+SQLite 双库,而 v0.3 设计/代码已切到单 SQLite;引用时以源码和 `docs/sqlite-refactor-plan.md` 为准。

## 第三线:嵌入式存储与笔记软件先例 — 行业已收敛于 SQLite

### 两个改变格局的生态信号

1. **Kùzu 已死**:2025-10 仓库归档,团队被 Apple acqui-hire;社区 fork LadybugDB 续命。"嵌入式原生图库"作为赛道的供应商可靠性被证伪——这是反对引入任何专用图存储的最强现实论据。(theregister.com/software/2025/10/14/kuzudb-graph-database-abandoned-community-mulls-options/)
2. **本地笔记软件无一使用图数据库**:Obsidian 用内存邻接表(resolvedLinks);Logseq DB 版从内存 DataScript 撤退到 SQLite-WASM 持久层;Roam 是 Datalog over DataScript/Datomic;思源笔记 Go kernel 维护 SQLite blocks/spans/refs 表;Anytype 本地 SQLite 存对象图。个人知识库规模的图,行业收敛点是 SQLite 引用表。

### 嵌入式候选逐个排除后的正解

- FalkorDB:Redis module + SSPL,双违规出局。
- Apache AGE:要求常驻 Postgres,摧毁单一投影存储前提,出局。
- sqlite-vec:纯 C 零依赖扩展,Mozilla 赞助,npm 活跃;无 ANN 但万级向量暴力扫描即毫秒级。**已知集成坑:macOS 上 Apple 自带 SQLite 编译禁用扩展加载,需 `Database.setCustomSQLite()` 指向非 Apple 构建**(asg017/sqlite-vec#78),须进 Phase 1 验证清单。
- 递归 CTE 实测参照:10k 节点 BFS 约 27ms(sqlitegraph benchmark);工程三要点:`UNION`(非 UNION ALL)去重防环、`level < k` 限深、set-based frontier 替代路径枚举。

# 核心假设验证

**"万级稀疏浅层图的 k 跳遍历,SQLite 递归 CTE 足够" — 成立。**

依据:每跳 = 一次走索引的 join,k≤3 展开是个位到几十毫秒;LLM 抽取管道耗时比查询高三 个数量级,存储层永远不是瓶颈;B 线五家产品提供了反面无例外的行业证据。

真正需要专用图存储的判据(全部远离 Riffle 当前场景):① 边数千万级以上且要多跳分析(PageRank/社区发现);② 任意两点最短路径为核心交互且要求早停低延迟;③ openCypher 式变长路径模式匹配成为用户能力;④ 图写入吞吐超单机事务。

# 推荐架构

## 一张边表覆盖两类图

```sql
CREATE TABLE graph_edges (
  id            TEXT PRIMARY KEY,
  src           TEXT NOT NULL,          -- note path 或规范化实体名
  dst           TEXT NOT NULL,
  kind          TEXT NOT NULL,          -- 'link' | 'mention' | <抽取的关系类型>
  layer         TEXT NOT NULL           -- 'explicit' | 'semantic'
                CHECK (layer IN ('explicit','semantic')),
  weight        REAL DEFAULT 1.0,
  -- bi-temporal(Graphiti 模式):失效而非删除,历史可回放
  valid_at      INTEGER,
  invalid_at    INTEGER,
  -- 溯源(LightRAG/MENTIONS 模式):从源重建的通用原语
  source_path   TEXT,
  source_rev    TEXT
);
CREATE INDEX idx_edges_src ON graph_edges(src, layer);
CREATE INDEX idx_edges_dst ON graph_edges(dst, layer);
```

显式层由 reconciler 从 wiki link 解析直填(已有 links 表可合并于此);语义层由可选抽取 pipeline 灌入。重建语义:`DELETE FROM graph_edges WHERE layer='semantic' AND source_path=? AND source_rev != current`。

## seed 扩展查询(Agent context 摄取的主查询)

```
seed 概念 → FTS 命中实体/别名 → 递归 CTE 取 1–2 跳邻域 → 反查源 notes/chunks
```

即 LightRAG local 模式的 SQL 化;"把概念及关联概念一起找出来"是一条 SQL。

## 可移植机制清单(来自调研,脱离原实现)

1. **Bi-temporal 失效**(graphiti):重抽取矛盾旧边置 `invalid_at`,查询默认 `WHERE invalid_at IS NULL`。
2. **溯源边**(graphiti MENTIONS / LightRAG):每条派生边带 source path + revision。
3. **upsert 合并**(LightRAG):实体按规范化名去重,跨文档累加计数;删文档计数递减,归零才删。
4. **增量 upsert 抽取**(LlamaIndex:"all inserts are already upserts")。
5. **多信号融合**(mem0 v3 / graphiti):FTS5 + sqlite-vec + 实体命中三路召回 RRF 融合。
6. **分层成本控制**(basic-memory / LightRAG):显式层零 LLM 成本先行;语义层每 chunk 单次便宜模型调用,结果按 chunk hash 缓存,文件未变不重复计费。
7. **中文 FTS 前置分词**(hypatia):写入和查询前用 jieba `cut_for_search` 为 CJK 词加空格,再交给 `porter unicode61`;Riffle 的中文语料检索应单独验证这条机制。
8. **结构化查询面**(hypatia):JSE 展示了 agent 可靠表达 `$and/$or/$search/$similar/$triple/$k-hop` 的价值;Riffle 应借语义而非直接采纳第二套查询协议,避免与 versioned Engine protocol 竞争。

## 开放架构的态度

采纳"接口先行,依赖后置":Search module 先定义 `expand(seed, hops, filters)` 能力接口并以 SQL CTE 实现;未来若确需 Cypher 级模式匹配,唯一候选项是 LadybugDB(Kùzu API 等价续命 fork),届时再评估——不预先引入。

# 分阶段路线

1. **Phase A(随 v2 Phase 1)**:显式链接层落地(links/graph_edges 投影 + 递归 CTE expand),进入 conformance corpus;sqlite-vec 的 Bun/macOS 集成坑验证。
2. **Phase B(独立提案 gate)**:语义层——确认产品承诺、embedding/抽取模型选型(本地 vs API)、成本模型,然后按上表机制实现抽取 pipeline。
3. **持续不变量**:任何一层都可停服、删除、从 Vault 全量重建;FFF 教训(symlink dedup policy 泄漏)不得在新层重现——policy 留在 Engine,边表只存事实。

# Sources

各节表格内已附主来源。补充:Hypatia 源码快照 `862bef14475d161efdd72d4c530b00d173544bb3` 与其 `docs/sqlite-refactor-plan.md`;Kùzu 收购报道(betanews/The Register 2025-10);Logseq DB 版 PR#10639 与 deepwiki 架构页;思源内核架构(siyuannote.com/article/1724743405);sqlite-vec macOS 坑(github.com/asg017/sqlite-vec#78);10k BFS 基准(oldnordic/sqlitegraph BENCHMARK_REPORT.md);递归 CTE 工程指南(mako.ai/guides/sqlite/common-table-expressions-advanced)。
