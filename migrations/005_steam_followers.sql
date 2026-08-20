ALTER TABLE steam_games
  ADD COLUMN IF NOT EXISTS followers_current INTEGER,
  ADD COLUMN IF NOT EXISTS followers_source TEXT,
  ADD COLUMN IF NOT EXISTS last_follower_checked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_steam_games_followers
  ON steam_games(followers_current DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS steam_follower_snapshots (
  id BIGSERIAL PRIMARY KEY,
  appid BIGINT NOT NULL REFERENCES steam_games(appid) ON DELETE CASCADE,
  followers INTEGER NOT NULL CHECK (followers >= 0),
  source TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_steam_follower_snapshots_app_time
  ON steam_follower_snapshots(appid, recorded_at DESC);
