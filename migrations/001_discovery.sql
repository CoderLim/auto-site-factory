CREATE TABLE IF NOT EXISTS source_targets (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  name TEXT NOT NULL,
  scope TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_source_targets_enabled_type
  ON source_targets(enabled, source_type);

CREATE TABLE IF NOT EXISTS source_cursors (
  source_target_id TEXT PRIMARY KEY REFERENCES source_targets(id) ON DELETE CASCADE,
  cursor JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_success_at TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS collection_runs (
  id TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'RUNNING',
  signal_count INTEGER NOT NULL DEFAULT 0,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE TABLE IF NOT EXISTS collection_run_targets (
  run_id TEXT NOT NULL REFERENCES collection_runs(id) ON DELETE CASCADE,
  source_target_id TEXT NOT NULL REFERENCES source_targets(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  signal_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  PRIMARY KEY (run_id, source_target_id)
);

CREATE TABLE IF NOT EXISTS raw_signals (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_target_id TEXT NOT NULL REFERENCES source_targets(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  title TEXT,
  content TEXT,
  url TEXT,
  author TEXT,
  published_at TIMESTAMPTZ,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  fingerprint TEXT NOT NULL UNIQUE,
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_raw_signals_unprocessed
  ON raw_signals(processed_at, discovered_at);
CREATE INDEX IF NOT EXISTS idx_raw_signals_target_external
  ON raw_signals(source_target_id, external_id);

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  scope TEXT NOT NULL,
  parent TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(scope, normalized_name, entity_type)
);

CREATE TABLE IF NOT EXISTS entity_aliases (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(entity_id, normalized_alias)
);

CREATE TABLE IF NOT EXISTS entity_mentions (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  raw_signal_id TEXT NOT NULL REFERENCES raw_signals(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  confidence REAL NOT NULL,
  evidence TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(entity_id, raw_signal_id)
);

CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL UNIQUE REFERENCES entities(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending_validation',
  mention_count INTEGER NOT NULL DEFAULT 0,
  source_count INTEGER NOT NULL DEFAULT 0,
  source_types TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_candidates_status_last_seen
  ON candidates(status, last_seen_at DESC);
