CREATE TABLE IF NOT EXISTS steam_monitor_state (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS steam_games (
  appid BIGINT PRIMARY KEY,
  name TEXT NOT NULL,
  first_observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_baseline BOOLEAN NOT NULL DEFAULT FALSE,
  steam_last_modified_at TIMESTAMPTZ,
  price_change_number BIGINT,
  store_status TEXT NOT NULL DEFAULT 'unknown',
  store_url TEXT,
  release_date_text TEXT,
  release_date DATE,
  released_at TIMESTAMPTZ,
  has_demo BOOLEAN NOT NULL DEFAULT FALSE,
  demo_appid BIGINT,
  demo_seen_at TIMESTAMPTZ,
  has_playtest BOOLEAN NOT NULL DEFAULT FALSE,
  playtest_appid BIGINT,
  playtest_seen_at TIMESTAMPTZ,
  ccu_current INTEGER,
  ccu_24h_peak INTEGER,
  ccu_7d_peak INTEGER,
  last_store_checked_at TIMESTAMPTZ,
  last_ccu_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_steam_games_first_observed
  ON steam_games(first_observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_steam_games_status
  ON steam_games(store_status, first_observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_steam_games_ccu
  ON steam_games(ccu_current DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS steam_game_snapshots (
  id BIGSERIAL PRIMARY KEY,
  appid BIGINT NOT NULL REFERENCES steam_games(appid) ON DELETE CASCADE,
  ccu INTEGER NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_steam_game_snapshots_app_time
  ON steam_game_snapshots(appid, recorded_at DESC);
