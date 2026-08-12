# Sitemap Source

`auto-site-factory` 的 Sitemap Source 已吸收独立项目 `CoderLim/sitemap-monitor` 的成熟能力，并改造成 Factory 的第一层 Discovery Source。

## 已迁移能力

- 单个或多个 sitemap root：`sitemapUrl` / `sitemapUrls`
- `sitemapindex` 递归
- 普通 XML `urlset`
- 纯文本 `sitemap.txt`
- gzip sitemap（通过 magic bytes 判断，不依赖 `.gz` 后缀）
- URL 去重与递归 visited 防循环
- HTTP 403 时可选 `curl` fallback
- 首次运行 baseline，不把历史全量 URL 当新词
- URL slug → keyword
- `.html/.php/.aspx/.jsp/.xml` 等尾部清理
- `game-name-342970` 这类 6 位以上稳定 ID 尾缀清理
- 新 URL 的 title / H1 抓取
- 新 keyword 直接进入 RawSignal → Entity → Candidate
- Web Dashboard：最近新词、站点管理、手动抓取、运行记录、异常中心

## 与旧 sitemap-monitor 的差异

旧项目使用：

```text
Python CLI -> data/*.json -> reports/*.json -> Git commit -> Cloudflare Worker -> Dashboard
```

Factory 使用：

```text
Sitemap Collector
  -> sitemap_urls (PostgreSQL)
  -> RawSignal
  -> Entity / Candidate
  -> Factory API
  -> apps/dashboard
```

因此不再维护 `data/*.json` / `reports/*.json` 两套状态，也不需要 Dashboard 通过 GitHub PAT 读取监控数据。

## 为什么 sitemap URL 不再放 source_cursors

大型站点可能有数万甚至数十万 URL。Factory 使用 `sitemap_urls` 表持久化：

```text
source_target_id + url (PK)
keyword
page_title
h1
first_seen_at
last_seen_at
signal_emitted_at
is_active
```

`source_cursors` 只保留 `snapshotAt / urlCount / pendingNewUrls` 等轻量摘要。

`signal_emitted_at` 用于保证当单次新增 URL 超过 `maxNewUrls` 时，剩余 URL 下次还能继续产生 Signal，而不会因为已经写入快照而永久丢失。

## 配置

```json
{
  "id": "sitemap-example",
  "sourceType": "sitemap",
  "name": "Example Sitemap",
  "scope": "games",
  "enabled": true,
  "config": {
    "sitemapUrls": [
      "https://example.com/sitemap-1.xml",
      "https://example.com/sitemap-2.xml.gz"
    ],
    "entityType": "GAME",
    "baselineOnFirstRun": true,
    "fetchPageMetadata": true,
    "curlFallback": true,
    "timeoutSeconds": 30,
    "maxSitemaps": 30,
    "maxUrls": 20000,
    "maxNewUrls": 100,
    "urlIncludes": [],
    "urlExcludes": []
  }
}
```

## 旧项目监控站点

旧 `sitemap-monitor/config.yaml` 中 Poki、CrazyGames、Gamepix、Lagged、Kizi、Y8、Miniplay、Playhop 已转换为 Factory SourceTarget，保存在：

```text
config/sitemap-targets.migrated.json
```

这些 Target 默认关闭，避免在 Factory 的 5 小时全局调度下直接把旧项目“每天一次”的抓取频率提高到 5 小时一次。需要启用时，可以复制到 `config/source-targets.json`，或者通过 Dashboard 添加/启用。

## 运行

```bash
npm install
npm run db:migrate
npm run targets:sync
npm run sitemap:once
```

只运行 Sitemap Source：

```bash
node --env-file=.env apps/worker/dist/index.js --once --source=sitemap
```

## Dashboard

终端 1：

```bash
npm run api
```

终端 2：

```bash
npm run dashboard:dev
```

打开：

```text
http://127.0.0.1:5173
```

Dashboard 提供：

- 最近 1 天 / 7 天 / 30 天新增关键词
- 按 Sitemap Target 过滤
- Google Trends 快捷入口
- 新增/编辑/启停 Sitemap Target
- 手动触发仅 Sitemap 的 Discovery Run
- 最近运行结果
- 失败或超过 12 小时没有成功抓取的异常提示

如果设置了 `DASHBOARD_TOKEN`，构建 Dashboard 时设置相同的 `VITE_DASHBOARD_TOKEN`。
