import { useEffect, useMemo, useState } from "react"
import { api, type MediaIoPage, type SitemapTarget } from "./api"

const ranges = [
  { value: "1d", label: "24 小时" },
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
  { value: "90d", label: "90 天" }
]

function time(value?: string) {
  return value ? new Date(value).toLocaleString() : "—"
}

export default function MediaIoPanel({ target }: { target?: SitemapTarget }) {
  const [range, setRange] = useState("7d")
  const [generatorsOnly, setGeneratorsOnly] = useState(true)
  const [pages, setPages] = useState<MediaIoPage[]>([])
  const [discoveredCount, setDiscoveredCount] = useState(0)
  const [generatorCount, setGeneratorCount] = useState(0)
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError("")
    void api.mediaIoPages(range, generatorsOnly)
      .then((result) => {
        if (!active) return
        setPages(result.pages)
        setDiscoveredCount(result.discoveredCount)
        setGeneratorCount(result.generatorCount)
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [range, generatorsOnly, reloadKey])

  const displayed = useMemo(() => {
    const query = search.trim().toLowerCase()
    return query
      ? pages.filter((page) => [page.pageTitle, page.h1, page.keyword, page.url].some((part) => part?.toLowerCase().includes(query)))
      : pages
  }, [pages, search])

  return <section className="media-io">
    <div className="alert info">基于 Media.io Sitemap 快照差异，仅统计基线建立后首次被本监控发现并成功入库的 URL。不是 Google 首次收录日期；页面更新不会重复计为新增。</div>
    <div className="media-io-meta">
      <span>采集：<strong>{target?.enabled ? "已启用" : target ? "已关闭" : "尚未配置"}</strong></span>
      <span>最近成功：<strong>{time(target?.lastSuccessAt)}</strong></span>
      <a href="https://www.media.io/sitemap.xml" target="_blank" rel="noreferrer">查看源 Sitemap ↗</a>
    </div>
    <div className="toolbar media-io-toolbar">
      <div className="segmented">
        {ranges.map((item) => <button key={item.value} className={range === item.value ? "active" : ""} onClick={() => setRange(item.value)}>{item.label}</button>)}
      </div>
      <div className="media-io-controls">
        <label className="check"><input type="checkbox" checked={generatorsOnly} onChange={(e) => setGeneratorsOnly(e.target.checked)} />标题含 AI + Generator</label>
        <input aria-label="筛选页面" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索标题或 URL" />
        <button type="button" onClick={() => setReloadKey((prev) => prev + 1)} disabled={loading}>刷新数据</button>
      </div>
    </div>
    {error && <div className="alert error">Media.io 数据加载失败：{error}</div>}
    <div className="stats">
      <article><strong>{discoveredCount.toLocaleString()}</strong><span>范围内全部新增 URL（不含基线）</span></article>
      <article><strong>{generatorCount.toLocaleString()}</strong><span>标题匹配 AI + Generator</span></article>
      <article><strong>{target?.activeUrlCount?.toLocaleString() ?? "—"}</strong><span>当前 Sitemap 活跃 URL（含基线）</span></article>
    </div>
    <div className="card table-card">
      <table>
        <thead><tr><th>页面标题 / URL</th><th>首次发现（本站）</th><th>状态</th><th>Google</th></tr></thead>
        <tbody>{displayed.map((page) => <tr key={page.url}>
          <td className="media-io-page">
            <a href={page.url} target="_blank" rel="noreferrer">{page.pageTitle || page.h1 || page.keyword || page.url} ↗</a>
            <small>{page.url}</small>
            {!page.pageTitle && <small>未读取到 title；标题条件无法确认</small>}
          </td>
          <td className="media-io-date">{time(page.firstSeenAt)}</td>
          <td><span className={`status ${page.active ? "success" : "failed"}`}>{page.active ? "仍在 Sitemap" : "已从 Sitemap 消失"}</span></td>
          <td><a className="trend" href={`https://www.google.com/search?q=${encodeURIComponent(`site:media.io "${page.url}"`)}`} target="_blank" rel="noreferrer">搜索 ↗</a></td>
        </tr>)}</tbody>
      </table>
      {loading && <div className="empty">正在读取 Media.io URL 记录…</div>}
      {!loading && !error && displayed.length === 0 && <div className="empty">{target?.lastSuccessAt ? "当前条件下暂无新页面。可关闭标题筛选查看全部新增 URL。" : "等待首次 Sitemap 抓取完成并建立历史基线。"}</div>}
      {!loading && !error && pages.length >= 200 && <div className="empty">最多显示最近 200 条匹配记录，可缩短时间范围查看。</div>}
    </div>
  </section>
}
