-- The one-time opportunity backfill replayed a large 30-day incremental window.
-- Those rows received app_list_changed_at close together, so ordering only by that
-- timestamp creates an arbitrary backlog. Use Steam's own last_modified timestamp
-- for unresolved baseline rows so recently changed/released apps are checked first.
UPDATE steam_games
SET app_list_changed_at = steam_last_modified_at,
    updated_at = NOW()
WHERE is_baseline = TRUE
  AND opportunity_at IS NULL
  AND store_status = 'unknown'
  AND last_store_checked_at IS NULL
  AND app_list_changed_at IS NOT NULL
  AND steam_last_modified_at IS NOT NULL
  AND app_list_changed_at IS DISTINCT FROM steam_last_modified_at;

CREATE INDEX IF NOT EXISTS idx_steam_games_store_priority
  ON steam_games(steam_last_modified_at DESC NULLS LAST)
  WHERE app_type = 'game' AND store_status = 'unknown';
