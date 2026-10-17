import { useEffect, useState } from "react"
import { api, type MediaIoPage, type SitemapTarget } from "./api"

type View = "all" | "new" | "baseline"

const ranges = [
  { value: "1d", label: "24 小时" },
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
  { value: "90d", label: "90 天" }
]

const views: Array<{ value: View; label: string }> = [
  { value: "all", label: "全部" },
  { value: "new", label: "仅新增" },
  { value: "baseline", label: "历史基线" }
]

function time(value?: string) {
  return value ? new Date(value).toLocaleString() : "—"
}

export default function MediaIoPanel({ target }: { target?: SitemapTarget }) {
  const [range, setRange] = useState("7d")
  const [view, setView] = useState<View>("all")
  const [generatorsOnly, setGeneratorsOnly] = useState(true)
  const [pages, setPages] = useState<MediaIoPage[]>([])
  const [discoveredCount, setDiscoveredCount] = useState(0)
  const [generatorCount, setGeneratorCount] = useState(0)
  const [baselineCount, setBaselineCount] = useState(0)
  const [baselineGeneratorCount, setBaselineGeneratorCount] = useState(0)
  const [matchedCount, setMatchedCount] = useState(0)
  const [search, setSearch] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(search), 300)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError("")
    void api.mediaIoPages(range, generatorsOnly, view, searchQuery)
      .then((result) => {
        if (!active) return
        setPages(result.pages)
        setDiscoveredCount(result.discoveredCount)
        setGeneratorCount(result.generatorCount)
        setBaselineCount(result.baselineCount)
        setBaselineGeneratorCount(result.baselineGeneratorCount)
        setMatchedCount(result.matchedCount)
      })
      .catch((e: unknown) => {
        if (active) {
          setPages([])
          setMatchedCount(0)
          setError(e instanceof Error ? e.message : String(e))
        }
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [range, generatorsOnly, view, searchQuery, reloadKey])

  return <section className="media-io">
    <div className="alert info">
      已保存的首批 Sitemap URL 作为「历史基线」展示，不计入新增。
      新增只统计后续抓取首次发现的 URL，时间不代表 Google 首次收录日期。
      旧 URL 尚未采集页面 title，「AI + Generator」可先按 URL 识别候选；标题匹配会明确标注。
    </div>
    <div className="media-io-meta">
      <span>采集：<strong>{target?.enabled ? "已启用" : target ? "已关闭" : "尚未配置"}</strong></span>
      <span>最近成功：<strong>{time(target?.lastSuccessAt)}</strong></span>
      <a href="https://www.media.io/sitemap.xml" target="_blank" rel="noreferrer">查看源 Sitemap ↗</a>
    </div>
    <div className="toolbar media-io-toolbar">
      <div className="segmented">
        {views.map((item) => <button key={item.value} className={view === item.value ? "active" : ""} onClick={() => setView(item.value)}>{item.label}</button>)}
      </div>
      <div className="segmented">
        {ranges.map((item) => <button key={item.value} className={range === item.value ? "active" : ""} onClick={() => setRange(item.value)}>{item.label}</button>)}
      </div>
    </div>
    <div className="toolbar media-io-toolbar">
      <div className="media-io-controls">
        <label className="check"><input type="checkbox" checked={generatorsOnly} onChange={(e) => setGeneratorsOnly(e.target.checked)} />AI + Generator（标题或 URL 候选）</label>
        <input aria-label="搜索全部页面" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索所有标题或 URL" />
        <button type="button" onClick={() => setReloadKey((prev) => prev + 1)} disabled={loading}>刷新数据</button>
      </div>
      <small className="media-io-note">时间范围只影响「新增」，历史基线始终可查。搜索在服务端执行，不限当前 200 条。</small>
    </div>
    {error && <div className="alert error">Media.io 数据加载失败：{error}</div>}
    <div className="stats media-io-stats">
      <article><strong>{discoveredCount.toLocaleString()}</strong><span>时间范围内新增 URL</span></article>
      <article><strong>{generatorCount.toLocaleString()}</strong><span>新增 AI + Generator 候选</span></article>
      <article><strong>{baselineCount.toLocaleString()}</strong><span>历史基线 URL</span></article>
      <article><strong>{baselineGeneratorCount.toLocaleString()}</strong><span>基线 AI + Generator URL 候选</span></article>
    </div>
    <div className="card table-card">
      <div className="media-io-results">当前筛选：<strong>{matchedCount.toLocaleString()}</strong> 条{matchedCount > 200 ? "（显示前 200 条，可按关键词缩小范围）" : ""}</div>
      <table>
        <thead><tr><th>页面标题 / URL</th><th>来源 / 匹配依据</th><th>首次发现（本站）</th><th>状态</th><th>Google</th></tr></thead>
        <tbody>{pages.map((page) => <tr key={page.url}>
          <td className="media-io-page">
            <a href={page.url} target="_blank" rel="noreferrer">{page.pageTitle || page.h1 || page.keyword || page.url} ↗</a>
            <small>{page.url}</small>
            {!page.pageTitle && <small>URL 派生的关键词，实际页面 title 尚未验证</small>}
          </td>
          <td>
            <span className={`status ${page.isBaseline ? "" : "running"}`}>{page.isBaseline ? "历史基线" : "新增"}</span>
            {page.matchSource && <small className="muted">{page.matchSource === "title" ? "页面标题匹配" : "URL 匹配（待验标题）"}</small>}
          </td>
          <td className="media-io-date">{time(page.firstSeenAt)}</td>
          <td><span className={`status ${page.active ? "success" : "failed"}`}>{page.active ? "仍在 Sitemap" : "已从 Sitemap 消失"}</span></td>
          <td><a className="trend" href={`https://www.google.com/search?q=${encodeURIComponent(`site:media.io "${page.url}"`)}`} target="_blank" rel="noreferrer">搜索 ↗</a></td>
        </tr>)}</tbody>
      </table>
      {loading && <div className="empty">正在读取 Media.io URL 记录…</div>}
      {!loading && !error && pages.length === 0 && <div className="empty">{target?.lastSuccessAt ? "没有符合当前条件的 URL。可切换「历史基线」或关闭筛选。" : "等待首次 Sitemap 抓取完成并建立历史基线。"}</div>}
    </div>
  </section>
}
