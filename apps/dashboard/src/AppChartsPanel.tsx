import { useEffect, useMemo, useState } from "react"
import { api, type AppChartEntry, type AppChartNewTerm } from "./api"
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
  { value: "1d", label: "最近 1 天" },
  { value: "7d", label: "最近 7 天" },
  { value: "30d", label: "最近 30 天" }
]

type SignalFilter = "all" | "new-apps" | "new-terms"

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

function HighlightedName({ name, terms }: { name: string; terms: string[] }) {
  if (terms.length === 0) return <strong>{name}</strong>
  const normalized = new Set(terms.map((term) => term.normalize("NFKC").toLocaleLowerCase("en-US")))
  const parts = name.normalize("NFKC").split(/([\p{L}\p{N}]+)/gu)
  return (
    <strong>
      {parts.map((part, index) => normalized.has(part.toLocaleLowerCase("en-US"))
        ? <mark className="new-word-mark" key={`${part}-${index}`}>{part}</mark>
        : <span key={`${part}-${index}`}>{part}</span>)}
    </strong>
  )
}

function NewTermStrip({ terms }: { terms: AppChartNewTerm[] }) {
  if (terms.length === 0) return null
  return (
    <section className="new-term-panel">
      <div className="new-term-heading">
        <div><span className="signal-dot" />新出现的词</div>
        <small>首次出现在历史 App Charts 中 · baseline 不计入</small>
      </div>
      <div className="new-term-list">
        {terms.slice(0, 30).map((item) => (
          <a
            className="new-term-chip"
            href={`https://trends.google.com/trends/explore?date=today%203-m&q=${encodeURIComponent(item.displayTerm)}`}
            target="_blank"
            rel="noreferrer"
            key={`${item.term}-${item.firstSeenAt}`}
            title={`${item.appName ?? "Unknown app"} · ${formatTime(item.firstSeenAt)}`}
          >
            <strong>{item.displayTerm}</strong>
            {item.appName && <span>{item.appName}</span>}
          </a>
        ))}
      </div>
    </section>
  )
}

export default function AppChartsPanel() {
  const [entries, setEntries] = useState<AppChartEntry[]>([])
  const [newTerms, setNewTerms] = useState<AppChartNewTerm[]>([])
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
        range,
        newAppsOnly: signalFilter === "new-apps",
        newTermsOnly: signalFilter === "new-terms"
      })
      setEntries(result.entries)
      setNewTerms(result.newTerms)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [genre, sort, range, signalFilter])

  const stats = useMemo(() => ({
    rising: entries.filter((entry) => (entry.rank24hDelta ?? entry.rank6hDelta ?? 0) > 0).length,
    newApps: entries.filter((entry) => entry.isNewApp).length,
    termApps: entries.filter((entry) => entry.newTerms.length > 0).length
  }), [entries])

  const capturedAt = entries[0]?.capturedAt

  return (
    <section className="app-charts-page">
      <div className="app-charts-intro">
        <div>
          <strong>US · iPhone · Top Free</strong>
          <span>每 6 小时保存一次榜单快照。重点看 First Seen、排名跃升和第一次出现的新词。</span>
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
            <option value="new-terms">✨ 有新词</option>
          </select>
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="rising">🔥 按上涨</option>
            <option value="new">🆕 按首次发现</option>
            <option value="rank">按当前排名</option>
          </select>
          <button className="copy-keywords" onClick={() => void refresh()} disabled={loading}>{loading ? "刷新中…" : "刷新"}</button>
        </div>
      </div>

      <NewTermStrip terms={newTerms} />

      <div className="stats app-chart-stats">
        <article><strong>{entries.length}</strong><span>当前列表</span></article>
        <article><strong>{stats.rising}</strong><span>正在上涨</span></article>
        <article><strong>{stats.newApps}</strong><span>7d First Seen</span></article>
        <article><strong>{newTerms.length}</strong><span>{range} 新词</span></article>
      </div>

      <div className="card table-card app-chart-table">
        <table>
          <thead>
            <tr><th>Rank</th><th>App</th><th>6h</th><th>24h</th><th>新信号</th><th>Ratings</th><th>Release</th><th>First Seen</th></tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.appId} className={entry.newTerms.length > 0 ? "has-new-term" : entry.isNewApp ? "is-new-app" : ""}>
                <td className="rank-cell"><strong>#{entry.rank}</strong>{entry.previousRank != null && <small>prev #{entry.previousRank}</small>}</td>
                <td>
                  <div className="app-identity">
                    {entry.iconUrl ? <img src={entry.iconUrl} alt="" loading="lazy" /> : <span className="app-icon-placeholder" />}
                    <div>
                      <a href={entry.storeUrl ?? `https://apps.apple.com/us/app/id${entry.appId}`} target="_blank" rel="noreferrer">
                        <HighlightedName name={entry.name} terms={entry.newTerms} />
                      </a>
                      <small>{entry.artist ?? entry.primaryGenreName ?? `App ID ${entry.appId}`}</small>
                    </div>
                  </div>
                </td>
                <td className={(entry.rank6hDelta ?? 0) > 0 ? "positive" : (entry.rank6hDelta ?? 0) < 0 ? "negative" : ""}>{delta(entry.rank6hDelta)}</td>
                <td className={(entry.rank24hDelta ?? 0) > 0 ? "positive" : (entry.rank24hDelta ?? 0) < 0 ? "negative" : ""}>{delta(entry.rank24hDelta)}</td>
                <td>
                  <div className="signal-stack">
                    {entry.isNewApp && <span className="signal-pill new-app">NEW APP</span>}
                    {entry.newTerms.map((term) => <span className="signal-pill new-term" key={term}>✨ {term}</span>)}
                    {!entry.isNewApp && entry.newTerms.length === 0 && <span className="muted-inline">—</span>}
                  </div>
                </td>
                <td>{formatNumber(entry.ratingCount)}{entry.averageRating != null && <small className="rating-score">★ {entry.averageRating.toFixed(1)}</small>}</td>
                <td>{formatDate(entry.releaseDate)}</td>
                <td>{formatTime(entry.firstSeenAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <div className="empty">正在读取 App Store 榜单…</div>}
        {!loading && entries.length === 0 && <div className="empty">还没有榜单快照。首次 App Charts Monitor 运行会建立 baseline，之后开始识别 First Seen 和新词。</div>}
      </div>
    </section>
  )
}
