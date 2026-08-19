CREATE TABLE IF NOT EXISTS keyword_candidates (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  normalized_keyword TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_validation',
  searchability_score INTEGER NOT NULL DEFAULT 0,
  generation_kind TEXT NOT NULL DEFAULT 'entity_name',
  generation_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  validation JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(entity_id, normalized_keyword)
);

CREATE INDEX IF NOT EXISTS idx_keyword_candidates_status_first_seen
  ON keyword_candidates(status, first_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_keyword_candidates_normalized
  ON keyword_candidates(normalized_keyword);

CREATE INDEX IF NOT EXISTS idx_keyword_candidates_score
  ON keyword_candidates(searchability_score DESC, first_seen_at DESC);
