# Auto Site Factory — 整体技术方案

> 自动发现新需求 → 验证搜索机会 → 自动建站 → 自动上线 → 持续监控与反馈学习。

## 1. 项目目标

`auto-site-factory` 是整套自动化上站系统的主仓库。

它不只是一个“AI 建站工具”，核心目标是解决两个问题：

1. **发现值得做的新需求**：从官方 API、Wiki、Reddit、YouTube、Discord、X、竞品站等来源尽早发现新实体、新产品、新游戏、新角色、新装备、新功能等候选词。
2. **把高质量机会快速变成可上线的网站**：自动完成调研、项目创建、开发、部署、DNS、GA、GSC、监控等流程。

核心链路：

```text
信号采集
  ↓
候选实体词
  ↓
趋势 / SERP / 持续性验证
  ↓
Opportunity Score
  ↓
高分机会
  ↓
自动建站 / 上线
  ↓
GSC / GA / 收入 / 排名反馈
  ↓
反哺评分模型
```

---

## 2. 系统边界

### 2.1 本仓库负责

```text
auto-site-factory
├─ 第一层：Signal Discovery
├─ 第二层：Validation & Scoring
├─ 第三层：Site Factory / Orchestration
└─ 第四层：Monitoring & Feedback
```

### 2.2 现有仓库的职责

#### `new-keyword-hunter`

Chrome 插件，保留为人工 / 半自动 Google Trends 探索工具。

未来可以增加：

```text
new-keyword-hunter
  ↓ POST candidate
auto-site-factory
```

但它不是主系统运行时。

#### `keyword-kits`

定位为通用 SEO / Data Provider Toolkit。

现有能力包括：

- Google Trends
- SimilarWeb
- Ahrefs
- SEMrush
- AITDK
- query-domain
- Namecheap

`auto-site-factory` 可以复用这些能力，但不把调度、Candidate Pool、数据库等主业务逻辑放进去。

#### `auto-launch-website`

现阶段继续独立存在，作为第三层执行能力。

短期：

```text
auto-site-factory
  ↓ invoke
auto-launch-website
```

长期稳定后，可将其核心能力迁移为：

```text
packages/launcher
```

之后再决定是否 archive 原仓库。

---

## 3. 总体架构

```text
┌─────────────────────────────────────────────────────┐
│                 第一层：信号采集层                    │
│             每 5 小时一轮 + 实时事件源                │
├─────────────────────────────────────────────────────┤
│ ① 官方 API       → 新版本 / 新角色 / 新装备 / 新产品   │
│ ② 社区 Wiki      → 新页面 / revision diff             │
│ ③ Reddit         → 新帖 / 高频实体                     │
│ ④ YouTube        → 新视频标题 / 描述                   │
│ ⑤ Discord        → 公告频道 WebSocket 实时事件         │
│ ⑥ X / Twitter    → 监控指定账号 / 新产品发布           │
│ ⑦ Sitemap Diff   → 竞品新增页面                        │
└───────────────────┬─────────────────────────────────┘
                    │ Raw Signals
                    ▼
┌─────────────────────────────────────────────────────┐
│             Entity Extraction / Normalization       │
├─────────────────────────────────────────────────────┤
│ 去噪 → 实体抽取 → 类型识别 → Alias → 去重 → Context   │
└───────────────────┬─────────────────────────────────┘
                    │ Candidates
                    ▼
┌─────────────────────────────────────────────────────┐
│                第二层：验证 & 打分层                  │
├─────────────────────────────────────────────────────┤
│ Google Trends      → 新鲜度 / 需求速度                │
│ SERP Analyzer      → 竞争格局 / 独立站机会             │
│ LLM Interpreter    → 意图 / 持续性 / 可建站性          │
│ Scoring Engine     → Opportunity Score               │
└───────────────────┬─────────────────────────────────┘
                    │ Approved Opportunity
                    ▼
┌─────────────────────────────────────────────────────┐
│               第三层：Site Factory                  │
├─────────────────────────────────────────────────────┤
│ 域名 → GitHub → 调研 → AI 开发 → QA → 部署           │
│ DNS → HTTPS → Email → GA → GSC → Sitemap             │
└───────────────────┬─────────────────────────────────┘
                    │ Deployed Project
                    ▼
┌─────────────────────────────────────────────────────┐
│             第四层：Monitoring & Feedback            │
├─────────────────────────────────────────────────────┤
│ Technical / SEO / Content / Business                 │
│ 7d / 14d / 30d 数据回流 → 修正 Opportunity Score     │
└─────────────────────────────────────────────────────┘
```

---

## 4. Monorepo 结构

原则：

- `apps`：可独立启动的进程。
- `packages`：业务能力 / 共享能力。
- Collector 属于 discovery 子系统，不单独拆成多个仓库。

推荐结构：

```text
auto-site-factory/
│
├── apps/
│   ├── api/                     # 管理 API
│   ├── worker/                  # 定时任务 / 队列消费者
│   ├── dashboard/               # 管理后台
│   └── discord-gateway/         # Discord WebSocket 常驻进程
│
├── packages/
│   ├── discovery/
│   │   └── src/
│   │       ├── collectors/
│   │       │   ├── official-api/
│   │       │   ├── wiki/
│   │       │   ├── reddit/
│   │       │   ├── youtube/
│   │       │   ├── x/
│   │       │   └── sitemap/
│   │       ├── extraction/
│   │       ├── normalization/
│   │       └── candidates/
│   │
│   ├── validation/
│   │   ├── trends/
│   │   ├── serp/
│   │   └── llm/
│   │
│   ├── scoring/
│   ├── launcher/
│   ├── monitoring/
│   ├── database/
│   ├── queue/
│   ├── llm/
│   └── shared/
│
├── migrations/
├── config/
├── docs/
├── tests/
└── package.json
```

第一阶段只实现：

```text
apps/worker
packages/discovery
packages/database
packages/shared
```

第二层、第三层先保留目录设计，不提前实现。

---

# 5. 第一层：Signal Discovery

## 5.1 第一层职责

第一层只回答：

> “最近有哪些新的实体正在出现？”

第一层不判断：

- 是否已有 Google 搜索量
- 是否值得建站
- 是否竞争低
- 是否能变现

这些属于第二层。

第一层必须优先保证 **Recall**。

原则：

> 第一层多抓一些，第二层还能过滤；第一层漏掉的词，后面永远无法恢复。

建议初始目标：

```text
Recall > 90%
Precision > 80%
```

---

## 5.2 统一 Collector 接口

所有采集器统一输出 `RawSignal`。

```ts
export type SignalSourceType =
  | "official_api"
  | "wiki"
  | "reddit"
  | "youtube"
  | "discord"
  | "x"
  | "sitemap"

export interface RawSignal {
  id: string
  sourceType: SignalSourceType
  sourceTargetId: string
  externalId: string

  title?: string
  content?: string
  url?: string
  author?: string

  publishedAt?: Date
  discoveredAt: Date

  metadata: Record<string, unknown>
  fingerprint: string
}
```

Collector 标准接口：

```ts
export interface Collector {
  type: SignalSourceType
  collect(target: SourceTarget, cursor?: SourceCursor): Promise<CollectResult>
}

export interface CollectResult {
  signals: RawSignal[]
  nextCursor?: string
}
```

---

## 5.3 Source Target

Collector 不硬编码监控对象。

统一配置：

```text
source_targets
```

示例：

```json
{
  "id": "target_xxx",
  "sourceType": "reddit",
  "name": "r/LocalLLaMA",
  "enabled": true,
  "scope": "ai",
  "config": {
    "subreddit": "LocalLLaMA"
  }
}
```

同一种 Collector 可以维护任意数量 Target。

---

# 6. 七个采集器设计

## 6.1 Official API Collector

适用于：

- 游戏 API
- Steam / Roblox 数据
- Hugging Face
- GitHub Release
- 产品 Changelog API
- 自定义 JSON API

采用 Adapter：

```ts
interface OfficialApiAdapter {
  collect(target: SourceTarget, cursor?: string): Promise<CollectResult>
}
```

优先捕获：

```text
created
released
added
introduced
updated
```

官方 API 返回的明确名称优先直接作为高置信实体，不经过 LLM 重写。

---

## 6.2 Wiki Collector

优先使用 MediaWiki / Wiki 自带 RecentChanges 能力。

主要信号：

### 新页面

```text
/wiki/Shadow_Reaper
```

直接产生候选：

```text
Shadow Reaper
```

### Revision Diff

旧页面大幅更新：

```text
Characters
```

新增内容：

```text
Shadow Reaper
Blood Katana
```

则从 diff 中抽取实体。

过滤：

- Talk
- User
- Template
- Category
- 非内容 namespace

---

## 6.3 Reddit Collector

不是简单做分词词频，而是：

```text
新帖
 ↓
Title + Selftext
 ↓
实体抽取
 ↓
实体 Mention 聚合
```

例如：

```text
Anyone tried the new Quantum Katana in Wend?
```

抽取：

```text
Quantum Katana
```

而不是：

```text
Anyone
tried
new
Quantum
Katana
```

Reddit Provider 必须可替换，避免绑定某一种 API 获取方式。

---

## 6.4 YouTube Collector

两种模式。

### Channel Monitoring

用于已知高价值频道：

```text
频道新视频
 ↓
Title + Description
 ↓
Entity Extractor
```

### Discovery Search

用于少量主动探索，不做大规模高频搜索。

优先策略：

```text
Channel Monitoring > Search Discovery
```

---

## 6.5 Discord Collector

Discord 不采用 5 小时轮询。

采用常驻：

```text
apps/discord-gateway
```

流程：

```text
Discord Gateway
 ↓
MESSAGE_CREATE
 ↓
Raw Signal DB
```

优先监控：

- announcements
- updates
- patch-notes
- news
- releases

每 5 小时 Worker 统一处理过去窗口中的 Discord Signals。

---

## 6.6 X Collector

优先监控精选账号，而不是全网搜索。

维护：

```text
Signal Accounts
```

例如：

```text
AI KOL
游戏开发者
官方产品账号
技术公司创始人
```

每轮按 `since_id` 增量拉取。

---

## 6.7 Sitemap Diff Collector

流程：

```text
竞品 sitemap
 ↓
URL Snapshot
 ↓
下一轮重新抓取
 ↓
Set Diff
 ↓
新增 URL
 ↓
抓 Title / H1 / Slug
 ↓
Entity Extractor
```

不能直接把完整 slug 当关键词。

例如：

```text
/games/how-to-get-shadow-reaper-fast
```

应该抽取：

```text
Shadow Reaper
```

而不是：

```text
how to get shadow reaper fast
```

---

# 7. Signal Processing Pipeline

```text
Raw Signal
  ↓
PreFilter
  ↓
Entity Extraction
  ↓
Entity Normalization
  ↓
Alias Resolution
  ↓
Entity Registry
  ↓
Candidate Aggregation
```

---

## 7.1 Raw Signal 永久保留

不要只保存 LLM 抽出的词。

必须保留：

```text
原始标题
原始正文
URL
Source
发布时间
抓取时间
metadata
```

原因：

未来调整：

- Prompt
- Entity Type
- Extractor
- Normalizer
- Alias 规则

可以直接对历史 Raw Signals 重新处理，而不用重新爬数据。

---

## 7.2 Entity Extraction

采用：

```text
Rules + LLM
```

### Rule Extractor

高确定性来源直接抽：

- Wiki page title
- Official API name
- GitHub Release name
- 明确 sitemap title

### LLM Extractor

适合：

- Reddit
- YouTube
- Discord
- X
- 网页标题
- Revision diff

输出严格 JSON：

```json
{
  "entities": [
    {
      "name": "Blood Scythe",
      "type": "ITEM",
      "confidence": 0.96
    }
  ]
}
```

---

## 7.3 Entity Types

V1：

```text
GAME
TOOL
AI_MODEL
PRODUCT
CHARACTER
ITEM
FEATURE
MAP
EVENT
MODE
OTHER
```

不要第一版做过度细分。

---

## 7.4 Context

实体不能脱离上下文。

例如：

```json
{
  "name": "Blood Scythe",
  "type": "ITEM",
  "context": {
    "parent": "Wend",
    "topic": "game"
  }
}
```

后续第二层可以正确验证：

```text
wend blood scythe
```

而不是只搜索：

```text
blood scythe
```

---

# 8. Entity Normalization & Alias

## 8.1 基础规范化

```text
Unicode normalize
trim
lowercase key
collapse spaces
normalize punctuation
```

不要随意删除：

- 数字
- 版本号
- 型号
- Roman numerals

例如：

```text
GPT-5
GPT-5.1
GPT-5.2
```

必须是不同实体。

---

## 8.2 Alias

示例：

```text
Project Genie
Google Project Genie
Project Genie AI
```

统一到：

```text
canonical_name = Project Genie
```

实体结构：

```text
entity_id
canonical_name
normalized_key
entity_type
parent
first_seen_at
last_seen_at
```

别名：

```text
entity_aliases
```

---

# 9. Candidate Pool

第一层最终输出的不是简单字符串数组。

标准 Candidate：

```json
{
  "candidateId": "cand_xxx",
  "entityId": "entity_xxx",
  "name": "Project Genie",
  "normalizedName": "project genie",
  "type": "PRODUCT",
  "context": {
    "parent": "Google",
    "topic": "AI"
  },
  "firstSeenAt": "2026-08-12T01:25:00Z",
  "lastSeenAt": "2026-08-12T05:02:00Z",
  "signals": {
    "total": 6,
    "sourceCount": 3,
    "sources": ["youtube", "x", "reddit"]
  },
  "status": "pending_validation"
}
```

第一层只保存事实：

```text
Reddit 4 次
YouTube 2 次
Wiki 1 次
```

不要在第一层计算 Opportunity Score。

---

# 10. Cursor / 增量采集

每个 Source Target 独立保存 cursor。

```text
source_cursors
```

不同来源使用：

| Source | Cursor |
|---|---|
| Wiki | timestamp / continue token |
| Reddit | newest id |
| YouTube | video id / publishedAt |
| Discord | message id |
| X | since_id |
| Sitemap | snapshot hash |
| Official API | adapter-defined cursor |

统一采用：

```text
overlap + idempotency
```

例如：

```text
last_success_at - 10 min → now
```

允许重复抓，依靠 fingerprint 去重。

---

# 11. Fingerprint / 幂等

Signal：

```text
sha256(sourceType + sourceTargetId + externalId)
```

如果来源没有稳定 externalId：

```text
sha256(sourceType + normalizedUrl + title + publishedAt)
```

所有采集、处理、写库步骤必须支持重复执行。

---

# 12. 调度

默认：

```text
每 5 小时运行一轮
```

不是串行：

```text
Official
Wiki
Reddit
YouTube
X
Sitemap
```

并行 fan-out。

Discord 为实时 Gateway。

任务流程：

```text
Create Collection Run
  ↓
fan-out collectors
  ↓
store Raw Signals
  ↓
extract entities
  ↓
normalize / alias
  ↓
aggregate candidates
  ↓
finish Collection Run
```

---

# 13. 失败隔离

某个 Collector 失败不能让整轮失败。

例如：

```text
Wiki        SUCCESS
Reddit      SUCCESS
YouTube     SUCCESS
Discord     SUCCESS
X           FAILED
Sitemap     SUCCESS
Official    SUCCESS
```

整轮：

```text
PARTIAL_SUCCESS
```

X 单独重试：

```text
1 min
5 min
30 min
```

仍失败则记录错误，下一轮继续。

---

# 14. 第一阶段核心数据表

建议先实现：

```text
source_targets
collection_runs
source_cursors
raw_signals
entity_mentions
entities
entity_aliases
candidates
```

关系：

```text
source_target
  ↓
raw_signal
  ↓
entity_mention
  ↓
entity
  ↓
candidate
```

后续第二层追加：

```text
trend_snapshots
serp_snapshots
scores
decisions
```

第三层追加：

```text
projects
domains
deployments
```

第四层追加：

```text
site_metrics
health_events
feedback_snapshots
```

---

# 15. Candidate 状态机

整个系统不要设计成一条巨大不可恢复 Workflow。

统一状态：

```text
DISCOVERED
  ↓
NORMALIZED
  ↓
VALIDATING
  ↓
WATCHING
  ↓
APPROVED
  ↓
DOMAIN_RESERVED
  ↓
BUILDING
  ↓
QA
  ↓
DEPLOYED
  ↓
INDEXED
  ↓
TRACTION
  ↓
MONETIZED
  ↓
SCALE / KILL
```

每个状态必须：

- 可重试
- 可追踪
- 可恢复
- 可人工干预

---

# 16. 第二层：Validation

第二层只在 Candidate Pool 之后运行。

## 16.1 Google Trends

验证：

- 是否近期才出现
- 过去 5 年历史
- 最近增速
- 是否持续
- 关联词

Google Trends Provider 做抽象层：

```ts
interface TrendProvider {
  getInterest(keyword: string, options: TrendQueryOptions): Promise<TrendResult>
}
```

可复用 `keyword-kits/google-trends`。

---

## 16.2 SERP Analyzer

不能只判断：

```text
有没有独立站
```

至少分析：

- Exact-match title 数量
- 官方站数量
- Reddit / Forum / UGC 占比
- YouTube 占比
- 独立站数量
- 弱域名比例
- 内容发布时间 / 新鲜度
- 搜索意图匹配程度
- 是否缺少专门回答该需求的页面

输出：

```text
SERP Opportunity Score
```

---

## 16.3 LLM 的职责

LLM 不直接根据内部知识判断“现在火不火”。

原则：

> 让 LLM 解释数据，而不是产生数据。

LLM 输入：

- Trends 数据
- SERP 结果
- 多源 Signals
- Entity Context

LLM 输出：

- Intent
- Persistence
- Buildability
- Risk
- Suggested Site Type

---

# 17. Opportunity Score

V1 建议：

```text
Freshness             15
Demand Velocity       20
Cross-source Evidence 10
SERP Gap              20
Buildability          15
Monetization          10
Persistence           10
------------------------
Total                100
```

风险扣分：

```text
Trademark Risk             -10
Copyright/Data Dependency  -10
Pure Content Site          -15
Adult/Gambling/Ad Risk     -20
Fragile Data Source         -5
```

决策：

```text
< 60      DROP
60 - 74   WATCH 24-72h
75 - 84   BUILD PREVIEW
85+       LAUNCH
```

阈值后续根据实际 Day 7 / Day 30 结果迭代。

---

# 18. 第三层：Site Factory

第二层 APPROVED 后进入执行层。

流程：

```text
Approved Candidate
 ↓
Domain Strategy
 ↓
Research
 ↓
Project Spec
 ↓
Create GitHub Repo
 ↓
AI Development
 ↓
Launch Audit
 ↓
Deploy
 ↓
DNS / HTTPS
 ↓
Email
 ↓
GA
 ↓
GSC
 ↓
Sitemap
```

短期复用：

```text
auto-launch-website
```

---

# 19. 建站价值原则

Site Factory 不应该默认只生成 1000 字 SEO 内容页。

优先构建真正有价值的功能：

```text
calculator
tracker
database
interactive game
tier list
codes checker
map
comparison tool
live status
build planner
search / filter
update timeline
```

纯 AI 内容站的 Buildability 应降低。

---

# 20. Launch Audit

部署前必须 QA。

建议检查：

```text
HTTP 200
robots.txt
sitemap
canonical
OG
schema
title
description
H1
broken links
mobile
CWV
404
favicon
SSL
redirects
www
GA
GSC
ads.txt
copyright
source citations
```

建议：

```text
LaunchScore >= 90
```

才进入 DEPLOYED。

---

# 21. 广告策略

不要站点刚部署就自动注入 AdSense。

推荐：

```text
DEPLOYED
 ↓
INDEXED
 ↓
TRACTION
 ↓
MONETIZATION GATE
 ↓
AdSense / Alternative Ads
```

避免低价值 / 未收录站点过早进入广告审核。

---

# 22. 外链策略

不把“大规模自动发外链”作为系统默认能力。

更安全的自动化边界：

```text
发现潜在外链机会
 ↓
判断相关性
 ↓
生成回复 / 投稿草稿
 ↓
质量检查
 ↓
发布
```

外链模块应与主建站链路解耦。

---

# 23. 第四层：Monitoring

监控拆成四类。

## 23.1 Technical

- Uptime
- SSL
- DNS
- Deployment
- 500
- 404
- API Failure

## 23.2 SEO

- Indexed Pages
- GSC Errors
- Impressions
- Clicks
- Rankings
- Canonical
- Sitemap

## 23.3 Content

- 数据是否过期
- 外部数据源失效
- 新版本 / 新角色 / 新功能
- Wiki 变化

## 23.4 Business

- Traffic
- CTR
- RPM
- Revenue
- Ad policy

---

# 24. 告警设计

不能只依赖一个 Health Score。

硬规则：

```text
HTTP >= 500       → P0
DNS Fail           → P0
SSL < 7 days       → P1
Indexed -50%       → P1
Impressions -60%   → P1
Health < 70        → P2
```

Aggregate Health Score 只作为辅助指标。

---

# 25. Feedback Loop

这是整套系统最终形成壁垒的部分。

每个 Candidate 保存：

```json
{
  "keyword": "example",
  "launchScore": 88,
  "day7": {
    "indexed": 12,
    "impressions": 800
  },
  "day30": {
    "clicks": 220,
    "revenue": 8.4
  }
}
```

后续统计：

```text
哪些 Signal 组合成功率最高？
哪些 SERP 特征最容易拿排名？
哪些站型更容易获得点击？
哪些 Opportunity Score 权重需要调整？
```

例如逐渐学习：

```text
Discord + YouTube + Trends breakout + Reddit-heavy SERP
```

比：

```text
X-only + no Trends movement
```

成功率高。

---

# 26. 推荐技术栈

V1：

```text
Node.js 20+
TypeScript
pnpm workspaces
PostgreSQL / Supabase
Redis + BullMQ（任务规模上来后）
LLM Provider abstraction
```

部署：

```text
API / Dashboard
  → Cloudflare / Vercel / Node Hosting

Worker
  → 长期 Node Runtime

Discord Gateway
  → 长期 Node Runtime

PostgreSQL
  → Supabase / Managed Postgres
```

第一版若任务量小，可以先不用 Redis，采用数据库任务表 + Cron，后续再迁 BullMQ。

---

# 27. Dashboard

V1 后台建议三个核心页面。

## Sources

```text
Source
Target
Enabled
Last Run
Last Success
Signals 24h
Error
```

## Signals

```text
来源
时间
原始标题
原始正文
提取实体
```

用于快速排查：

> 为什么这个实体没有被抽出来？

## Candidates

```text
Candidate
Type
Context
First Seen
Sources
Mentions
Status
```

后续增加：

- Validation
- Scores
- Projects
- Monitoring

---

# 28. 第一阶段验收标准

第一阶段仅完成 Discovery。

必须做到：

1. Source Target 可配置。
2. Collector 可插拔。
3. 至少 2-3 个真实 Collector 跑通。
4. Raw Signal 可追溯。
5. Entity Extraction 可重新处理历史数据。
6. 同实体跨来源可归并。
7. Candidate 可看到所有 Evidence。
8. Cursor 可恢复。
9. 某个 Collector 失败不影响其他 Collector。
10. 每一轮 Collection Run 有完整日志。

指标：

```text
Recall > 90%
Precision > 80%
```

---

# 29. 开发优先级

## P0 — Discovery Core

先做：

```text
Monorepo skeleton
Shared Types
Database Schema
Collector Framework
Raw Signal Store
Entity Extractor
Normalizer
Candidate Pool
Scheduler
```

## P1 — 首批 Collector

优先：

```text
Wiki
YouTube
Sitemap Diff
```

原因：

- API 相对明确
- 信号质量高
- 易于测试
- 不依赖复杂授权

之后：

```text
Official API
Discord
Reddit
X
```

## P2 — Validation

```text
Google Trends
SERP Analyzer
```

## P3 — Scoring

```text
Opportunity Score
Decision Engine
```

## P4 — Site Factory

接入：

```text
auto-launch-website
```

## P5 — Feedback

```text
Day 7 / 14 / 30 Review
Score Weight Learning
```

---

# 30. 当前开发范围

当前只实现：

```text
第一层：新词 / 新实体挖掘
```

即：

```text
Collectors
 ↓
Raw Signals
 ↓
Entity Extraction
 ↓
Normalization / Alias
 ↓
Candidate Pool
```

当前阶段明确 **不实现**：

- Trends Validation
- SERP Score
- Opportunity Score
- 自动买域名
- 自动建站
- 自动广告
- 自动外链
- Monitoring

这些模块只保留接口和目录边界。

---

# 31. 核心原则

整个项目遵循以下原则：

### 1. 事实和判断分离

```text
Discovery 保存事实
Validation 解释事实
Scoring 做判断
Launcher 做执行
```

### 2. LLM 不充当实时数据源

```text
让 LLM 解释数据，而不是产生数据
```

### 3. Recall 优先于 Precision

第一层宁可多抓，不要漏掉真正新词。

### 4. 所有 Workflow 可恢复

每一步必须支持：

```text
Retry
Resume
Trace
Manual Override
```

### 5. Site Factory 生成价值，不只是内容

优先工具、数据库、互动功能、实时数据和真正解决搜索意图的产品。

### 6. Feedback 最终反哺 Discovery 和 Scoring

系统最终要从“规则驱动”逐步变成“历史结果驱动”。

---

## 32. 最终形态

```text
                    AUTO SITE FACTORY

Signal Sources
     │
     ▼
Discovery Engine
     │
     ▼
Candidate Pool
     │
     ▼
Validation Engine
     │
     ▼
Opportunity Score
     │
     ▼
Decision Engine
     │
     ▼
Site Factory
     │
     ▼
Deployment / Launch
     │
     ▼
Monitoring
     │
     ▼
Feedback Engine
     └──────────────────────→ Scoring / Discovery
```

最终真正的核心资产不是“建站速度”，而是：

> **比别人更早发现新需求，并且更准确地判断哪个需求值得做。**
