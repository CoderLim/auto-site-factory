import { useEffect, useState } from "react"
import "./global-loading.css"

type LoadingListener = (loading: boolean) => void

type FetchInput = Parameters<typeof window.fetch>[0]

const listeners = new Set<LoadingListener>()
let activeRequestCount = 0
let installed = false

function notify(): void {
  const loading = activeRequestCount > 0
  for (const listener of listeners) listener(loading)
}

function beginRequest(): void {
  activeRequestCount += 1
  notify()
}

function endRequest(): void {
  activeRequestCount = Math.max(0, activeRequestCount - 1)
  notify()
}

function shouldTrack(input: FetchInput): boolean {
  try {
    const rawUrl = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url
    const url = new URL(rawUrl, window.location.href)
    return url.origin === window.location.origin && url.pathname.startsWith("/api/")
  } catch {
    return false
  }
}

export function installGlobalLoadingFetch(): void {
  if (installed) return
  installed = true

  const nativeFetch = window.fetch.bind(window)
  window.fetch = (async (...args: Parameters<typeof window.fetch>) => {
    const tracked = shouldTrack(args[0])
    if (tracked) beginRequest()
    try {
      return await nativeFetch(...args)
    } finally {
      if (tracked) endRequest()
    }
  }) as typeof window.fetch
}

export function GlobalLoadingOverlay() {
  const [loading, setLoading] = useState(activeRequestCount > 0)

  useEffect(() => {
    const listener: LoadingListener = (nextLoading) => setLoading(nextLoading)
    listeners.add(listener)
    setLoading(activeRequestCount > 0)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  if (!loading) return null

  return (
    <div className="global-loading-overlay" role="status" aria-live="polite" aria-busy="true">
      <div className="global-loading-card">
        <span className="global-loading-spinner" aria-hidden="true" />
        <span>数据加载中…</span>
      </div>
    </div>
  )
}
