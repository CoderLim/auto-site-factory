import { useEffect, useMemo, useState } from "react"
import { api, type AppChartEntry } from "./api"
import "./app-charts.css"

const GENRES = [
  { value: "all", label: "Overall" },
  { value: "6007", label: "Productivity" },
  { value: "6002", label: "Utilities" },
  { value: "6008", label: "Photo & Video" },
  { value: "6027", label: "Graphics & Design" },
  { value: "6017", label: "Education" },
  { value: "6012", label: "Lifestyle" },
  { value: "6014", label: "Games" }
]

const RANGES = [
  { value: "1d", label: "最近 1 天", hours: 24 },
  { value: "7d", label: "最近 7 天", hours: 7 * 24 },
  { value: "30d", label: "最近 30 天", hours: 30 * 24 }
]

type SignalFilter = "all" | "new-apps"

function formatTime(value?: string): string {
  if (!value) return "—"
  return new Date(value).toLocaleString()
}

function formatDate(value?: string): string {
  if (!value) return "—"
  return new Date(value).toLocaleDateString()
}

function formatNumber(value?: number): string {
  return value == null ? "—" : value.toLocaleString()
}

function delta(value?: number): string {
  if (value == null) return "—"
  return `${value > 0 ? "+" : ""}${value}`
}

function rangeHours(range: string): number {
  return RANGES.find((item) => item.value === range)?.hours ?? 7 * 24
}

function isFirstSeenInRange(entry: AppChartEntry, range: string): boolean {
  if (entry.isBaseline) return false
  const timestamp = Date.parse(entry.firstSeenAt)
  if (!Number.isFinite(timestamp)) return false
  return timestamp >= Date.now() - rangeHours(range) * 60 * 60 * 1000
}

function NewAppStrip({ entries, range }: { entries: AppChartEntry[]; range: string }) {
  if (entries.length === 0) return null
  return (
    <section className="new-term-panel">
      <div className="new-term-heading">
        <div><span className="signal-dot" />新 App 名称</div>
        <small>完整展示 App Store 名称，不拆词 · 首次进入我们的 App Charts 历史</small>
      </div>
      <div className="new-term-list">
        {entries.slice(0, 30).map((entry) => (
          <a
            className="new-term-chip"
            href={entry.storeUrl ?? `https://apps.apple.com/us/app/id${entry.appId}`}
            target="_blank"
            rel="noreferrer"
            key={entry.appId}
            title={`First Seen: ${formatTime(entry.firstSeenAt)}`}
          >
            <strong>{entry.name}</strong>
            <span>#{entry.rank} · {entry.primaryGenreName ?? entry.artist ?? range}</span>
          </a>
        ))}
      </div>
    </section>
  )
}

export default function AppChartsPanel() {
  const [entries, setEntries] = useState<AppChartEntry[]>([])
  const [genre, setGenre] = useState("all")
  const [sort, setSort] = useState("rising")
  const [range, setRange] = useState("7d")
  const [signalFilter, setSignalFilter] = useState<SignalFilter>("all")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const refresh = async () => {
    setLoading(true)
    setError("")
    try {
      const result = await api.appCharts({
        country: "us",
        chart: "top-free",
        genre,
        sort,
        range
      })
      setEntries(result.entries)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [genre, sort, range])

  const newApps = useMemo(
    () => entries.filter((entry) => isFirstSeenInRange(entry, range)),
    [entries, range]
  )

  const visibleEntries = useMemo(
    () => signalFilter === "new-apps" ? newApps : entries,
    [entries, newApps, signalFilter]
  )

  const stats = useMemo(() => ({
    rising: visibleEntries.filter((entry) => (entry.rank24hDelta ?? entry.rank6hDelta ?? 0) > 0).length,
    newApps: newApps.length
  }), [visibleEntries, newApps])

  const capturedAt = entries[0]?.capturedAt

  return (
    <section className="app-charts-page">
      <div className="app-charts-intro">
        <div>
          <strong>US · iPhone · Top Free</strong>
          <span>每 6 小时保存一次榜单快照。重点看 First Seen、排名跃升和新进入榜单的完整 App 名称。</span>
        </div>
        <div className="capture-meta">最新快照<br /><strong>{formatTime(capturedAt)}</strong></div>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="toolbar app-chart-toolbar">
        <div className="segmented">{RANGES.map((item) => <button key={item.value} className={range === item.value ? "active" : ""} onClick={() => setRange(item.value)}>{item.label}</button>)}</div>
        <div className="app-chart-filters">
          <select value={genre} onChange={(event) => setGenre(event.target.value)}>
            {GENRES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <select value={signalFilter} onChange={(event) => setSignalFilter(event.target.value as SignalFilter)}>
            <option value="all">全部 App</option>
            <option value="new-apps">🆕 First Seen</option>
          </select>
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="rising">🔥 按上涨</option>
            <option value="new">🆕 按首次发现</option>
            <option value="rank">按当前排名</option>
          </select>
          <button className="copy-keywords" onClick={() => void refresh()} disabled={loading}>{loading ? "刷新中…" : "刷新"}</button>
        </div>
      </div>

      <NewAppStrip entries={newApps} range={range} />

      <div className="stats app-chart-stats">
        <article><strong>{visibleEntries.length}</strong><span>当前列表</span></article>
        <article><strong>{stats.rising}</strong><span>正在上涨</span></article>
        <article><strong>{stats.newApps}</strong><span>{range} First Seen</span></article>
      </div>

      <div className="card table-card app-chart-table">
        <table>
          <thead>
            <tr><th>Rank</th><th>App</th><th>6h</th><th>24h</th><th>新信号</th><th>Ratings</th><th>Release</th><th>First Seen</th></tr>
          </thead>
          <tbody>
            {visibleEntries.map((entry) => {
              const isNew = isFirstSeenInRange(entry, range)
              return (
                <tr key={entry.appId} className={isNew ? "is-new-app" : ""}>
                  <td className="rank-cell"><strong>#{entry.rank}</strong>{entry.previousRank != null && <small>prev #{entry.previousRank}</small>}</td>
                  <td>
                    <div className="app-identity">
                      {entry.iconUrl ? <img src={entry.iconUrl} alt="" loading="lazy" /> : <span className="app-icon-placeholder" />}
                      <div>
                        <a href={entry.storeUrl ?? `https://apps.apple.com/us/app/id${entry.appId}`} target="_blank" rel="noreferrer">
                          <strong>{entry.name}</strong>
                        </a>
                        <small>{entry.artist ?? entry.primaryGenreName ?? `App ID ${entry.appId}`}</small>
                      </div>
                    </div>
                  </td>
                  <td className={(entry.rank6hDelta ?? 0) > 0 ? "positive" : (entry.rank6hDelta ?? 0) < 0 ? "negative" : ""}>{delta(entry.rank6hDelta)}</td>
                  <td className={(entry.rank24hDelta ?? 0) > 0 ? "positive" : (entry.rank24hDelta ?? 0) < 0 ? "negative" : ""}>{delta(entry.rank24hDelta)}</td>
                  <td>
                    <div className="signal-stack">
                      {isNew ? <span className="signal-pill new-app">NEW APP</span> : <span className="muted-inline">—</span>}
                    </div>
                  </td>
                  <td>{formatNumber(entry.ratingCount)}{entry.averageRating != null && <small className="rating-score">★ {entry.averageRating.toFixed(1)}</small>}</td>
                  <td>{formatDate(entry.releaseDate)}</td>
                  <td>{formatTime(entry.firstSeenAt)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {loading && <div className="empty">正在读取 App Store 榜单…</div>}
        {!loading && visibleEntries.length === 0 && <div className="empty">这个时间范围内还没有新的 App First Seen。</div>}
      </div>
    </section>
  )
}
