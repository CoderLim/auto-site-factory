CREATE TABLE IF NOT EXISTS app_chart_apps (
  app_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  artist TEXT,
  icon_url TEXT,
  store_url TEXT,
  primary_genre_name TEXT,
  release_date TIMESTAMPTZ,
  rating_count BIGINT,
  average_rating NUMERIC(4,2),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_baseline BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_chart_snapshots (
  country TEXT NOT NULL,
  chart TEXT NOT NULL,
  genre TEXT NOT NULL,
  app_id TEXT NOT NULL REFERENCES app_chart_apps(app_id) ON DELETE CASCADE,
  rank INTEGER NOT NULL CHECK (rank > 0),
  captured_at TIMESTAMPTZ NOT NULL,
  source_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (country, chart, genre, app_id, captured_at)
);

CREATE INDEX IF NOT EXISTS idx_app_chart_snapshots_scope_time
  ON app_chart_snapshots(country, chart, genre, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_chart_snapshots_app_time
  ON app_chart_snapshots(app_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS app_chart_terms (
  term TEXT PRIMARY KEY,
  display_term TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_app_id TEXT REFERENCES app_chart_apps(app_id) ON DELETE SET NULL,
  is_baseline BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_chart_terms_first_seen
  ON app_chart_terms(first_seen_at DESC);

CREATE TABLE IF NOT EXISTS app_chart_app_terms (
  app_id TEXT NOT NULL REFERENCES app_chart_apps(app_id) ON DELETE CASCADE,
  term TEXT NOT NULL REFERENCES app_chart_terms(term) ON DELETE CASCADE,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_new_signal BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (app_id, term)
);

CREATE INDEX IF NOT EXISTS idx_app_chart_app_terms_new
  ON app_chart_app_terms(is_new_signal, first_seen_at DESC);
