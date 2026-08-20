import { FormEvent, useEffect, useMemo, useState } from "react"
import {
  SOURCE_TYPE_OPTIONS,
  api,
  getDashboardToken,
  setDashboardToken,
  type DiscoveryCandidate,
  type KeywordCandidate,
  type SitemapAnomaly,
  type SitemapRun,
  type SitemapTarget,
  type SteamGame
} from "./api"

type Tab = "keywords" | "discover" | "steam" | "sites" | "runs" | "anomalies"
const ranges = [
  { value: "1d", label: "最近 1 天" },
  { value: "7d", label: "最近 7 天" },
  { value: "30d", label: "最近 30 天" }
]
const steamRanges = [...ranges, { value: "90d", label: "最近 90 天" }]

function formatTime(value?: string) {
  if (!value) return "—"
  return new Date(value).toLocaleString()
}

function formatNumber(value?: number) {
  return value == null ? "—" : value.toLocaleString()
}

function formatDelta(value?: number) {
  if (value == null) return "—"
  return `${value > 0 ? "+" : ""}${value.toLocaleString()}`
}

function statusLabel(status: SteamGame["storeStatus"]) {
  if (status === "coming_soon") return "Coming Soon"
  if (status === "released") return "Released"
  if (status === "unavailable") return "Unavailable"
  return "Unknown"
}

function keywordStatusLabel(status: KeywordCandidate["status"]) {
  return status === "pending_validation" ? "待 Google 验证" : "低可搜性"
}

function targetRoots(target: SitemapTarget): string {
  const many = Array.isArray(target.config.sitemapUrls)
    ? target.config.sitemapUrls.filter((item): item is string => typeof item === "string")
    : []
  const single = typeof target.config.sitemapUrl === "string" ? target.config.sitemapUrl : ""
  return (many.length > 0 ? many : single ? [single] : []).join("\n")
}

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.opacity = "0"
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand("copy")
  document.body.removeChild(textarea)
  if (!copied) throw new Error("浏览器未允许复制到剪贴板")
}

export default function App() {
  const [tab, setTab] = useState<Tab>("keywords")
  const [range, setRange] = useState("1d")
  const [sourceType, setSourceType] = useState("")
  const [keywordStatus, setKeywordStatus] = useState("pending_validation")
  const [targets, setTargets] = useState<SitemapTarget[]>([])
  const [candidates, setCandidates] = useState<DiscoveryCandidate[]>([])
  const [keywords, setKeywords] = useState<KeywordCandidate[]>([])
  const [enabledTargetCount, setEnabledTargetCount] = useState(0)
  const [runs, setRuns] = useState<SitemapRun[]>([])
  const [anomalies, setAnomalies] = useState<SitemapAnomaly[]>([])
  const [steamGames, setSteamGames] = useState<SteamGame[]>([])
  const [steamRange, setSteamRange] = useState("30d")
  const [steamStatus, setSteamStatus] = useState("")
  const [steamMinCcu, setSteamMinCcu] = useState("")
  const [steamSort, setSteamSort] = useState("recent")
  const [includeBaseline, setIncludeBaseline] = useState(false)
  const [steamLoading, setSteamLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [token, setToken] = useState(() => getDashboardToken())

  const refreshCore = async () => {
    const [targetResult, runResult, anomalyResult] = await Promise.all([api.targets(), api.runs(), api.anomalies()])
    setTargets(targetResult.targets)
    setRuns(runResult.runs)
    setAnomalies(anomalyResult.anomalies)
  }

  const refreshCandidates = async () => {
    const result = await api.candidates(range, sourceType || undefined)
    setCandidates(result.candidates)
    setEnabledTargetCount(result.enabledTargetCount)
  }

  const refreshKeywords = async () => {
    const result = await api.keywords(range, {
      sourceType: sourceType || undefined,
      status: keywordStatus || undefined
    })
    setKeywords(result.keywords)
  }

  const refreshSteam = async () => {
    setSteamLoading(true)
    try {
      const result = await api.steamGames({
        range: steamRange,
        status: steamStatus || undefined,
        minCcu: steamMinCcu || undefined,
        sort: steamSort,
        includeBaseline
      })
      setSteamGames(result.games)
    } finally {
      setSteamLoading(false)
    }
  }

  const refreshAll = async () => {
    setError("")
    setLoading(true)
    try {
      await Promise.all([refreshCore(), refreshCandidates(), refreshKeywords()])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refreshAll()
  }, [])

  useEffect(() => {
    if (loading) return
    if (tab === "discover") void refreshCandidates().catch((e) => setError(e instanceof Error ? e.message : String(e)))
    if (tab === "keywords") void refreshKeywords().catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [tab, range, sourceType, keywordStatus])

  useEffect(() => {
    if (tab !== "steam") return
    setError("")
    void refreshSteam().catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [tab, steamRange, steamStatus, steamMinCcu, steamSort, includeBaseline])

  const sourceTypeCount = useMemo(() => {
    const seen = new Set<string>()
    for (const candidate of candidates) {
      for (const item of candidate.sourceTypes) seen.add(item)
    }
    return seen.size
  }, [candidates])

  const keywordSourceTypeCount = useMemo(() => {
    const seen = new Set<string>()
    for (const keyword of keywords) {
      for (const item of keyword.sourceTypes) seen.add(item)
    }
    return seen.size
  }, [keywords])

  const averageKeywordScore = useMemo(() => {
    if (keywords.length === 0) return 0
    return Math.round(keywords.reduce((sum, item) => sum + item.searchabilityScore, 0) / keywords.length)
  }, [keywords])

  const steamStats = useMemo(() => ({
    demos: steamGames.filter((game) => game.hasDemo).length,
    playtests: steamGames.filter((game) => game.hasPlaytest).length,
    active: steamGames.filter((game) => (game.ccuCurrent ?? 0) > 0).length
  }), [steamGames])

  const connect = async () => {
    setDashboardToken(token)
    await refreshAll()
    if (tab === "steam") await refreshSteam()
  }

  const copyKeywords = async (values: string[]) => {
    const currentKeywords = values.map((value) => value.trim()).filter(Boolean)
    if (currentKeywords.length === 0) {
      setNotice("当前页没有可复制的关键词")
      return
    }

    try {
      await writeClipboard(currentKeywords.join("\n"))
      setError("")
      setNotice(`已复制 ${currentKeywords.length} 个关键词，每行一个`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const runNow = async () => {
    setBusy(true)
    setError("")
    try {
      const result = await api.run()
      setNotice(result.workflow_run_id ? `Discovery Cron 已启动 #${result.workflow_run_id}` : "Discovery Cron 已触发")
      window.setTimeout(() => void refreshCore(), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const saveTarget = async (target: SitemapTarget, rootsText: string, enabled: boolean) => {
    const roots = rootsText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
    const config = { ...target.config }
    delete config.sitemapUrl
    delete config.sitemapUrls
    if (roots.length === 1) config.sitemapUrl = roots[0]
    else config.sitemapUrls = roots
    await api.updateTarget({ ...target, enabled, config })
    setNotice(`已保存 ${target.name}`)
    await refreshCore()
  }

  const addTarget = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const id = String(data.get("id") ?? "").trim()
    const name = String(data.get("name") ?? "").trim()
    const scope = String(data.get("scope") ?? "").trim()
    const sitemapUrl = String(data.get("sitemapUrl") ?? "").trim()
    if (!id || !name || !scope || !sitemapUrl) return
    setBusy(true)
    try {
      await api.createTarget({
        id,
        name,
        scope,
        enabled: true,
        config: { sitemapUrl, baselineOnFirstRun: true, fetchPageMetadata: true }
      })
      event.currentTarget.reset()
      setNotice(`已添加 ${name}`)
      await refreshCore()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const pageTitle = tab === "keywords" ? "新增关键词"
    : tab === "discover" ? "发现候选"
      : tab === "steam" ? "Steam 游戏"
        : tab === "sites" ? "Sitemap 管理"
          : tab === "runs" ? "运行记录"
            : "异常中心"

  const eyebrow = tab === "keywords" ? "LAYER 2 / KEYWORDS"
    : tab === "discover" ? "LAYER 1 / DISCOVERY"
      : tab === "steam" ? "DISCOVERY / STEAM"
        : "DISCOVERY / SITEMAP"

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">ASF</span><div><strong>Auto Site Factory</strong><small>Discovery</small></div></div>
        <nav>
          <button className={tab === "keywords" ? "active" : ""} onClick={() => setTab("keywords")}>新增关键词</button>
          <button className={tab === "discover" ? "active" : ""} onClick={() => setTab("discover")}>发现候选</button>
          <button className={tab === "steam" ? "active" : ""} onClick={() => setTab("steam")}>Steam 游戏</button>
          <button className={tab === "sites" ? "active" : ""} onClick={() => setTab("sites")}>Sitemap 管理</button>
          <button className={tab === "runs" ? "active" : ""} onClick={() => setTab("runs")}>运行记录</button>
          <button className={tab === "anomalies" ? "active" : ""} onClick={() => setTab("anomalies")}>异常中心 {anomalies.length > 0 && <span className="badge">{anomalies.length}</span>}</button>
        </nav>
      </aside>

      <main>
        <header>
          <div><p className="eyebrow">{eyebrow}</p><h1>{pageTitle}</h1></div>
          <div className="header-actions">
            <div className="token-control">
              <input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Dashboard token（如已配置）" />
              <button onClick={() => void connect()}>连接</button>
            </div>
            {tab !== "steam" && <button className="primary" onClick={runNow} disabled={busy}>{busy ? "启动中…" : "立即抓取"}</button>}
          </div>
        </header>

        {error && <div className="alert error">{error}</div>}
        {notice && <div className="alert success">{notice}</div>}

        {loading ? <div className="empty">加载中…</div> : tab === "keywords" ? (
          <section>
            <div className="alert info">这里是从 Layer 1 实体生成的“可搜索词候选”。Searchability 是启发式评分，不代表 Google 搜索量；当前状态仍需 Google Suggest / Trends / SERP 的真实验证。</div>
            <div className="toolbar">
              <div className="segmented">{ranges.map((item) => <button key={item.value} className={range === item.value ? "active" : ""} onClick={() => setRange(item.value)}>{item.label}</button>)}</div>
              <div className="filter-row">
                <select value={keywordStatus} onChange={(event) => setKeywordStatus(event.target.value)}>
                  <option value="pending_validation">待 Google 验证</option>
                  <option value="low_searchability">低可搜性</option>
                  <option value="">全部状态</option>
                </select>
                <select value={sourceType} onChange={(event) => setSourceType(event.target.value)}>
                  <option value="">全部来源</option>
                  {SOURCE_TYPE_OPTIONS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
                </select>
                <button className="copy-keywords" onClick={() => void copyKeywords(keywords.map((item) => item.keyword))} disabled={keywords.length === 0}>复制关键词</button>
              </div>
            </div>
            <div className="stats">
              <article><strong>{keywords.length}</strong><span>当前关键词候选</span></article>
              <article><strong>{averageKeywordScore}</strong><span>平均 Searchability</span></article>
              <article><strong>{keywordSourceTypeCount}</strong><span>来源类型</span></article>
            </div>
            <div className="card table-card">
              <table>
                <thead><tr><th>关键词候选</th><th>Searchability</th><th>状态</th><th>来源实体</th><th>类型 / Scope</th><th>来源</th><th>首次发现</th><th></th></tr></thead>
                <tbody>
                  {keywords.map((keyword) => (
                    <tr key={keyword.id}>
                      <td><strong>{keyword.keyword}</strong><small className="muted">{keyword.generationKind === "scope_context" ? "已补主题上下文" : "实体名清洗"}</small></td>
                      <td><span className={`score score-${keyword.searchabilityScore >= 75 ? "high" : keyword.searchabilityScore >= 55 ? "mid" : "low"}`}>{keyword.searchabilityScore}</span></td>
                      <td><span className={`status ${keyword.status === "pending_validation" ? "running" : "failed"}`}>{keywordStatusLabel(keyword.status)}</span></td>
                      <td>{keyword.entityName === keyword.keyword ? "—" : keyword.entityName}</td>
                      <td>{keyword.entityType}<small className="muted">{keyword.scope}</small></td>
                      <td>{keyword.sourceTypes.join(", ")}</td>
                      <td>{formatTime(keyword.firstSeenAt)}</td>
                      <td><a className="trend" href={`https://trends.google.com/trends/explore?date=today%205-y&q=${encodeURIComponent(keyword.keyword)}`} target="_blank" rel="noreferrer">Trends ↗</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {keywords.length === 0 && <div className="empty">还没有符合当前条件的关键词候选。下一次 Discovery Cron 会自动生成和回填。</div>}
            </div>
          </section>
        ) : tab === "discover" ? (
          <section>
            <div className="alert info">这里展示 Layer 1 原始实体，目标是高召回。它们不是 Google 关键词，因此不会直接拿实体名做搜索量结论。</div>
            <div className="toolbar">
              <div className="segmented">{ranges.map((item) => <button key={item.value} className={range === item.value ? "active" : ""} onClick={() => setRange(item.value)}>{item.label}</button>)}</div>
              <select value={sourceType} onChange={(event) => setSourceType(event.target.value)}>
                <option value="">全部来源</option>
                {SOURCE_TYPE_OPTIONS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
              </select>
            </div>
            <div className="stats">
              <article><strong>{candidates.length}</strong><span>实体候选</span></article>
              <article><strong>{sourceTypeCount}</strong><span>来源类型</span></article>
              <article><strong>{enabledTargetCount}</strong><span>启用源</span></article>
            </div>
            <div className="card table-card">
              <table>
                <thead><tr><th>实体</th><th>类型</th><th>Scope</th><th>来源</th><th>提及</th><th>首次发现</th></tr></thead>
                <tbody>
                  {candidates.map((candidate) => (
                    <tr key={candidate.id}>
                      <td><strong>{candidate.name}</strong></td>
                      <td>{candidate.entityType}</td>
                      <td>{candidate.scope}</td>
                      <td>{candidate.sourceTypes.join(", ")}</td>
                      <td>{candidate.mentionCount}</td>
                      <td>{formatTime(candidate.firstSeenAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {candidates.length === 0 && <div className="empty">这个时间范围还没有新的 Discovery 实体</div>}
            </div>
          </section>
        ) : tab === "steam" ? (
          <section>
            <div className="toolbar steam-toolbar">
              <div className="segmented">{steamRanges.map((item) => <button key={item.value} className={steamRange === item.value ? "active" : ""} onClick={() => setSteamRange(item.value)}>{item.label}</button>)}</div>
              <div className="steam-filters">
                <select value={steamStatus} onChange={(event) => setSteamStatus(event.target.value)}>
                  <option value="">全部状态</option>
                  <option value="coming_soon">Coming Soon</option>
                  <option value="demo">有 Demo</option>
                  <option value="playtest">有 Playtest</option>
                  <option value="released">Released</option>
                  <option value="unavailable">Unavailable</option>
                </select>
                <select value={steamMinCcu} onChange={(event) => setSteamMinCcu(event.target.value)}>
                  <option value="">全部 CCU</option>
                  <option value="10">CCU ≥ 10</option>
                  <option value="100">CCU ≥ 100</option>
                  <option value="500">CCU ≥ 500</option>
                </select>
                <select value={steamSort} onChange={(event) => setSteamSort(event.target.value)}>
                  <option value="recent">按首次发现</option>
                  <option value="followers">按 Followers</option>
                  <option value="follower_growth">按 7d +Followers</option>
                  <option value="ccu">按 CCU</option>
                  <option value="growth">按 CCU 24h 增长</option>
                </select>
                <label className="check"><input type="checkbox" checked={includeBaseline} onChange={(event) => setIncludeBaseline(event.target.checked)} />包含初始化基线</label>
                <button className="copy-keywords" onClick={() => void copyKeywords(steamGames.map((game) => game.name))} disabled={steamGames.length === 0 || steamLoading}>复制关键词</button>
              </div>
            </div>
            <div className="stats">
              <article><strong>{steamGames.length}</strong><span>当前列表</span></article>
              <article><strong>{steamStats.demos} / {steamStats.playtests}</strong><span>Demo / Playtest</span></article>
              <article><strong>{steamStats.active}</strong><span>当前 CCU &gt; 0</span></article>
            </div>
            <div className="card table-card">
              <table>
                <thead><tr><th>游戏</th><th>首次发现</th><th>状态</th><th>Demo</th><th>Playtest</th><th>Followers</th><th>24h +F</th><th>7d +F</th><th>CCU</th><th>24h Peak</th><th>7d Peak</th><th>CCU 24h 增长</th><th>Release</th></tr></thead>
                <tbody>
                  {steamGames.map((game) => (
                    <tr key={game.appid}>
                      <td>
                        <a href={game.storeUrl ?? `https://store.steampowered.com/app/${game.appid}/`} target="_blank" rel="noreferrer"><strong>{game.name}</strong></a>
                        <small className="muted">AppID {game.appid}{game.isBaseline ? " · baseline" : ""}</small>
                      </td>
                      <td>{formatTime(game.firstObservedAt)}</td>
                      <td><span className={`status steam-${game.storeStatus}`}>{statusLabel(game.storeStatus)}</span></td>
                      <td>{game.hasDemo ? (game.demoAppid ? <a href={`https://store.steampowered.com/app/${game.demoAppid}/`} target="_blank" rel="noreferrer">Yes ↗</a> : "Yes") : "—"}</td>
                      <td>{game.hasPlaytest ? (game.playtestAppid ? <a href={`https://store.steampowered.com/app/${game.playtestAppid}/`} target="_blank" rel="noreferrer">Yes ↗</a> : "Yes") : "—"}</td>
                      <td><strong>{formatNumber(game.followersCurrent)}</strong>{game.followersSource && <small className="muted">{game.followersSource === "store_dlc" ? "store" : "community"}</small>}</td>
                      <td className={(game.followers24hDelta ?? 0) > 0 ? "positive" : (game.followers24hDelta ?? 0) < 0 ? "negative" : ""}>{formatDelta(game.followers24hDelta)}</td>
                      <td className={(game.followers7dDelta ?? 0) > 0 ? "positive" : (game.followers7dDelta ?? 0) < 0 ? "negative" : ""}>{formatDelta(game.followers7dDelta)}{game.followers7dGrowthPct != null && <small className="muted">{game.followers7dGrowthPct > 0 ? "+" : ""}{game.followers7dGrowthPct}%</small>}</td>
                      <td><strong>{formatNumber(game.ccuCurrent)}</strong>{game.ccuSource && <small className="muted">{game.ccuSource}</small>}</td>
                      <td>{formatNumber(game.ccu24hPeak)}</td>
                      <td>{formatNumber(game.ccu7dPeak)}</td>
                      <td className={(game.ccu24hGrowthPct ?? 0) > 0 ? "positive" : (game.ccu24hGrowthPct ?? 0) < 0 ? "negative" : ""}>{game.ccu24hGrowthPct == null ? "—" : `${game.ccu24hGrowthPct > 0 ? "+" : ""}${game.ccu24hGrowthPct}%`}</td>
                      <td>{game.releaseDateText ?? game.releaseDate ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {steamLoading && <div className="empty">正在刷新 Steam 游戏…</div>}
              {!steamLoading && steamGames.length === 0 && <div className="empty">还没有符合条件的新 Steam 游戏。初始化基线默认不会混进新发现列表。</div>}
            </div>
          </section>
        ) : tab === "sites" ? (
          <section className="sites-grid">
            <form className="card add-site" onSubmit={addTarget}><h2>添加 Sitemap</h2><input name="id" placeholder="target id，例如 sitemap-poki" /><input name="name" placeholder="站点名称" /><input name="scope" placeholder="scope，例如 games" /><input name="sitemapUrl" placeholder="https://example.com/sitemap.xml" /><button className="primary" disabled={busy}>添加并启用</button></form>
            {targets.map((target) => <SiteEditor key={target.id} target={target} onSave={saveTarget} />)}
          </section>
        ) : tab === "runs" ? (
          <section className="card table-card"><table><thead><tr><th>站点</th><th>状态</th><th>Signals</th><th>开始</th><th>错误</th></tr></thead><tbody>{runs.map((run) => <tr key={`${run.runId}-${run.targetId}`}><td>{run.targetName}</td><td><span className={`status ${run.status.toLowerCase()}`}>{run.status}</span></td><td>{run.signalCount}</td><td>{formatTime(run.startedAt)}</td><td className="error-cell">{run.error ?? "—"}</td></tr>)}</tbody></table>{runs.length === 0 && <div className="empty">暂无运行记录</div>}</section>
        ) : (
          <section className="anomaly-list">{anomalies.map((item, index) => <article className={`card anomaly ${item.severity}`} key={`${item.targetId}-${item.code}-${index}`}><div><strong>{item.code}</strong><p>{item.message}</p></div><time>{formatTime(item.recordedAt)}</time></article>)}{anomalies.length === 0 && <div className="card empty">目前没有 Sitemap 异常</div>}</section>
        )}
      </main>
    </div>
  )
}

function SiteEditor({ target, onSave }: { target: SitemapTarget; onSave: (target: SitemapTarget, roots: string, enabled: boolean) => Promise<void> }) {
  const [roots, setRoots] = useState(targetRoots(target))
  const [enabled, setEnabled] = useState(target.enabled)
  const [saving, setSaving] = useState(false)

  useEffect(() => { setRoots(targetRoots(target)); setEnabled(target.enabled) }, [target])

  return <article className="card site-card"><div className="site-head"><div><h2>{target.name}</h2><code>{target.id}</code></div><label className="switch"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span /></label></div><div className="site-meta"><span>{target.activeUrlCount.toLocaleString()} active URLs</span><span>last: {formatTime(target.lastSuccessAt)}</span></div><textarea value={roots} onChange={(event) => setRoots(event.target.value)} rows={4} /><button onClick={() => { setSaving(true); void onSave(target, roots, enabled).finally(() => setSaving(false)) }} disabled={saving}>{saving ? "保存中…" : "保存"}</button></article>
}
