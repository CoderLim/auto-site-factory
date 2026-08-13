import { FormEvent, useEffect, useMemo, useState } from "react"
import {
  SOURCE_TYPE_OPTIONS,
  api,
  getDashboardToken,
  setDashboardToken,
  type DiscoveryCandidate,
  type SitemapAnomaly,
  type SitemapRun,
  type SitemapTarget
} from "./api"

type Tab = "keywords" | "sites" | "runs" | "anomalies"
const ranges = [
  { value: "1d", label: "最近 1 天" },
  { value: "7d", label: "最近 7 天" },
  { value: "30d", label: "最近 30 天" }
]

function formatTime(value?: string) {
  if (!value) return "—"
  return new Date(value).toLocaleString()
}

function targetRoots(target: SitemapTarget): string {
  const many = Array.isArray(target.config.sitemapUrls)
    ? target.config.sitemapUrls.filter((item): item is string => typeof item === "string")
    : []
  const single = typeof target.config.sitemapUrl === "string" ? target.config.sitemapUrl : ""
  return (many.length > 0 ? many : single ? [single] : []).join("\n")
}

export default function App() {
  const [tab, setTab] = useState<Tab>("keywords")
  const [range, setRange] = useState("1d")
  const [sourceType, setSourceType] = useState("")
  const [targets, setTargets] = useState<SitemapTarget[]>([])
  const [candidates, setCandidates] = useState<DiscoveryCandidate[]>([])
  const [enabledTargetCount, setEnabledTargetCount] = useState(0)
  const [runs, setRuns] = useState<SitemapRun[]>([])
  const [anomalies, setAnomalies] = useState<SitemapAnomaly[]>([])
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

  const refreshAll = async () => {
    setError("")
    setLoading(true)
    try {
      await Promise.all([refreshCore(), refreshCandidates()])
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
    void refreshCandidates().catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [range, sourceType])

  const sourceTypeCount = useMemo(() => {
    const seen = new Set<string>()
    for (const candidate of candidates) {
      for (const item of candidate.sourceTypes) seen.add(item)
    }
    return seen.size
  }, [candidates])

  const connect = async () => {
    setDashboardToken(token)
    await refreshAll()
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

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">ASF</span><div><strong>Auto Site Factory</strong><small>Discovery</small></div></div>
        <nav>
          <button className={tab === "keywords" ? "active" : ""} onClick={() => setTab("keywords")}>新增关键词</button>
          <button className={tab === "sites" ? "active" : ""} onClick={() => setTab("sites")}>Sitemap 管理</button>
          <button className={tab === "runs" ? "active" : ""} onClick={() => setTab("runs")}>运行记录</button>
          <button className={tab === "anomalies" ? "active" : ""} onClick={() => setTab("anomalies")}>异常中心 {anomalies.length > 0 && <span className="badge">{anomalies.length}</span>}</button>
        </nav>
      </aside>

      <main>
        <header>
          <div><p className="eyebrow">{tab === "keywords" ? "DISCOVERY" : "DISCOVERY / SITEMAP"}</p><h1>{tab === "keywords" ? "新增关键词" : tab === "sites" ? "Sitemap 管理" : tab === "runs" ? "运行记录" : "异常中心"}</h1></div>
          <div className="header-actions">
            <div className="token-control">
              <input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Dashboard token（如已配置）" />
              <button onClick={() => void connect()}>连接</button>
            </div>
            <button className="primary" onClick={runNow} disabled={busy}>{busy ? "启动中…" : "立即抓取"}</button>
          </div>
        </header>

        {error && <div className="alert error">{error}</div>}
        {notice && <div className="alert success">{notice}</div>}

        {loading ? <div className="empty">加载中…</div> : tab === "keywords" ? (
          <section>
            <div className="toolbar">
              <div className="segmented">{ranges.map((item) => <button key={item.value} className={range === item.value ? "active" : ""} onClick={() => setRange(item.value)}>{item.label}</button>)}</div>
              <select value={sourceType} onChange={(event) => setSourceType(event.target.value)}>
                <option value="">全部来源</option>
                {SOURCE_TYPE_OPTIONS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
              </select>
            </div>
            <div className="stats">
              <article><strong>{candidates.length}</strong><span>新增候选</span></article>
              <article><strong>{sourceTypeCount}</strong><span>来源类型</span></article>
              <article><strong>{enabledTargetCount}</strong><span>启用源</span></article>
            </div>
            <div className="card table-card">
              <table>
                <thead>
                  <tr>
                    <th>候选词</th>
                    <th>类型</th>
                    <th>Scope</th>
                    <th>来源</th>
                    <th>提及</th>
                    <th>首次发现</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((candidate) => (
                    <tr key={candidate.id}>
                      <td><strong>{candidate.name}</strong></td>
                      <td>{candidate.entityType}</td>
                      <td>{candidate.scope}</td>
                      <td>{candidate.sourceTypes.join(", ")}</td>
                      <td>{candidate.mentionCount}</td>
                      <td>{formatTime(candidate.firstSeenAt)}</td>
                      <td>
                        <a
                          className="trend"
                          href={`https://trends.google.com/trends/explore?date=today%205-y&q=${encodeURIComponent(candidate.name)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Trends ↗
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {candidates.length === 0 && <div className="empty">这个时间范围还没有新的 Discovery 候选</div>}
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
