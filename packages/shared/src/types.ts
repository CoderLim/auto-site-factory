export type SignalSourceType =
  | "official_api"
  | "wiki"
  | "reddit"
  | "youtube"
  | "discord"
  | "x"
  | "sitemap"

export type EntityType =
  | "GAME"
  | "TOOL"
  | "AI_MODEL"
  | "PRODUCT"
  | "CHARACTER"
  | "ITEM"
  | "FEATURE"
  | "MAP"
  | "EVENT"
  | "MODE"
  | "OTHER"

export interface SourceTarget {
  id: string
  sourceType: SignalSourceType
  name: string
  scope: string
  enabled: boolean
  config: Record<string, unknown>
}

export type CursorState = Record<string, unknown>

export interface RawSignal {
  id: string
  sourceType: SignalSourceType
  sourceTargetId: string
  externalId: string
  title?: string
  content?: string
  url?: string
  author?: string
  publishedAt?: Date
  discoveredAt: Date
  metadata: Record<string, unknown>
  fingerprint: string
}

export interface SitemapUrlEntry {
  url: string
  keyword?: string
}

export interface SitemapReconcileResult {
  initialized: boolean
  pendingUrls: string[]
  pendingCount: number
}

export interface SitemapStateStore {
  reconcile(
    targetId: string,
    entries: SitemapUrlEntry[],
    seenAt: Date,
    baselineOnFirstRun: boolean,
    limit: number
  ): Promise<SitemapReconcileResult>
  markEmitted(targetId: string, urls: string[], emittedAt: Date): Promise<void>
  updateMetadata(
    targetId: string,
    url: string,
    metadata: { pageTitle?: string; h1?: string }
  ): Promise<void>
}

export interface CollectResult {
  signals: RawSignal[]
  nextCursor?: CursorState
  afterPersist?: () => Promise<void>
}

export interface CollectorContext {
  now: Date
  fetch: typeof fetch
  sitemapStore?: SitemapStateStore
}

export interface Collector {
  type: SignalSourceType
  collect(
    target: SourceTarget,
    cursor: CursorState | undefined,
    context: CollectorContext
  ): Promise<CollectResult>
}

export interface ExtractedEntity {
  name: string
  type: EntityType
  confidence: number
  parent?: string
  evidence?: string
}

export interface StoredSignal extends RawSignal {
  scope: string
}
