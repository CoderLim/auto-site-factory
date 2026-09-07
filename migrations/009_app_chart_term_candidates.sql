ALTER TABLE app_chart_terms
  ADD COLUMN IF NOT EXISTS is_candidate BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_app_chart_terms_candidate_first_seen
  ON app_chart_terms(is_candidate, first_seen_at DESC);
