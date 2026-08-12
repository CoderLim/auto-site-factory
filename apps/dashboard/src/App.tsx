import { FormEvent, useEffect, useMemo, useState } from "react"
import { api, type SitemapAnomaly, type SitemapRun, type SitemapSignal, type SitemapTarget } from "./api"

type Tab = "keywords" | "sites" | "runs" | "anomalies"
const ranges = [{ value: "1d", label: "最近 1 天" }, { value: "7d", label: "最近 7 天" }, { value: "30d", label: "最近 30 天" }]

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
  const [targetId, setTargetId] = useState("")
  const [targets, setTargets] = useState<SitemapTarget[]>([])
  const [signals, setSignals] = useState<SitemapSignal[]>([])
  const [runs, setRuns] = useState<SitemapRun[]>([])
  const [anomalies, setAnomalies] = useState<SitemapAnomaly[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const refreshCore = async () => {
    const [targetResult, runResult, anomalyResult] = await Promise.all([api.targets(), api.runs(), api.anomalies()])
    setTargets(targetResult.targets)
    setRuns(runResult.runs)
    setAnomalies(anomalyResult.anomalies)
  }

  const refreshSignals = async () => {
    const result = await api.signals(range, targetId || undefined)
    setSignals(result.signals)
  }

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true)
        await refreshCore()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  useEffect(() => {
    void refreshSignals().catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [range, targetId])

  const uniqueKeywords = useMemo(() => {
    const seen = new Set<string>()
    return signals.filter((signal) => {
      if (!signal.keyword || seen.has(signal.keyword)) return false
      seen.add(signal.keyword)
      return true
    })
  }, [signals])

  const runNow = async () => {
    setBusy(true)
    setError("")
    try {
      await api.run()
      setNotice("Sitemap 抓取已启动")
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
        <div className="brand"><span className="brand-mark">ASF</span><div><strong>Auto Site Factory</strong><small>Sitemap Monitor</small></div></div>
        <nav>
          <button className={tab === "keywords" ? "active" : ""} onClick={() => setTab("keywords")}>新增关键词</button>
          <button className={tab === "sites" ? "active" : ""} onClick={() => setTab("sites")}>Sitemap 管理</button>
          <button className={tab === "runs" ? "active" : ""} onClick={() => setTab("runs")}>运行记录</button>
          <button className={tab === "anomalies" ? "active" : ""} onClick={() => setTab("anomalies")}>异常中心 {anomalies.length > 0 && <span className="badge">{anomalies.length}</span>}</button>
        </nav>
      </aside>

      <main>
        <header>
          <div><p className="eyebrow">DISCOVERY / SITEMAP</p><h1>{tab === "keywords" ? "新增关键词" : tab === "sites" ? "Sitemap 管理" : tab === "runs" ? "运行记录" : "异常中心"}</h1></div>
          <button className="primary" onClick={runNow} disabled={busy}>{busy ? "启动中…" : "立即抓取 Sitemap"}</button>
        </header>

        {error && <div className="alert error">{error}</div>}
        {notice && <div className="alert success">{notice}</div>}

        {loading ? <div className="empty">加载中…</div> : tab === "keywords" ? (
          <section>
            <div className="toolbar">
              <div className="segmented">{ranges.map((item) => <button key={item.value} className={range === item.value ? "active" : ""} onClick={() => setRange(item.value)}>{item.label}</button>)}</div>
              <select value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">全部站点</option>{targets.map((target) => <option value={target.id} key={target.id}>{target.name}</option>)}</select>
            </div>
            <div className="stats">
              <article><strong>{uniqueKeywords.length}</strong><span>新增关键词</span></article>
              <article><strong>{signals.length}</strong><span>新增 URL</span></article>
              <article><strong>{targets.filter((target) => target.enabled).length}</strong><span>启用站点</span></article>
            </div>
            <div className="card table-card">
              <table><thead><tr><th>关键词</th><th>站点</th><th>发现时间</th><th>页面</th><th></th></tr></thead>
                <tbody>{uniqueKeywords.map((signal) => <tr key={signal.id}><td><strong>{signal.keyword}</strong></td><td>{signal.targetName}</td><td>{formatTime(signal.discoveredAt)}</td><td><a href={signal.url} target="_blank" rel="noreferrer">{signal.title ?? signal.url}</a></td><td><a className="trend" href={`https://trends.google.com/trends/explore?date=today%205-y&q=${encodeURIComponent(signal.keyword ?? "")}`} target="_blank" rel="noreferrer">Trends ↗</a></td></tr>)}</tbody>
              </table>
              {uniqueKeywords.length === 0 && <div className="empty">这个时间范围还没有新的 Sitemap 关键词</div>}
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
