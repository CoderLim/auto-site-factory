CREATE TABLE IF NOT EXISTS sitemap_urls (
  source_target_id TEXT NOT NULL REFERENCES source_targets(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  keyword TEXT,
  page_title TEXT,
  h1 TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  signal_emitted_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (source_target_id, url)
);

CREATE INDEX IF NOT EXISTS idx_sitemap_urls_target_first_seen
  ON sitemap_urls(source_target_id, first_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_sitemap_urls_pending
  ON sitemap_urls(source_target_id, first_seen_at)
  WHERE signal_emitted_at IS NULL AND is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_sitemap_urls_keyword
  ON sitemap_urls(keyword)
  WHERE keyword IS NOT NULL;
