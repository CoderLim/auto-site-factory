# Discovery Candidates Panel

## Goal

「新增关键词」从仅展示 Sitemap 信号，改为展示全源去重后的 Candidates，并支持按 `sourceType` 过滤（默认全部）。

## Decisions

- Data: `candidates` JOIN `entities`（非 raw_signals）
- Filter: `sourceType` only；空 = 全部
- Time range: `first_seen_at` over 1d / 7d / 30d
- Sitemap 管理 / 运行记录 / 异常中心不变

## API

`GET /api/discovery/candidates?range=1d&sourceType=`

Response:

```json
{
  "candidates": [
    {
      "id": "cand_...",
      "entityId": "ent_...",
      "name": "Canonical Name",
      "entityType": "TOOL",
      "scope": "ai",
      "status": "pending_validation",
      "mentionCount": 3,
      "sourceCount": 2,
      "sourceTypes": ["official_api", "wiki"],
      "firstSeenAt": "...",
      "lastSeenAt": "..."
    }
  ],
  "enabledTargetCount": 12
}
```

Filter SQL: when `sourceType` set, `AND $type = ANY(c.source_types)`.

## UI

- Toolbar: range segmented control + sourceType `<select>`（全部 / 各 SignalSourceType）
- Stats: 新增候选、来源类型数（当前结果去重）、启用源数
- Table: 候选词 / 类型 / scope / 来源 / 提及 / 首次发现 / Trends
- Eyebrow: `DISCOVERY`；侧栏副标题改为 Discovery

## Out of scope

- Signals 原始排查页
- Sources 全源管理页
- target 级过滤
