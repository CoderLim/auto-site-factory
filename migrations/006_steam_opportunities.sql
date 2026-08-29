ALTER TABLE steam_games ADD COLUMN IF NOT EXISTS app_list_changed_at TIMESTAMPTZ;
ALTER TABLE steam_games ADD COLUMN IF NOT EXISTS opportunity_at TIMESTAMPTZ;
ALTER TABLE steam_games ADD COLUMN IF NOT EXISTS opportunity_reason TEXT;

-- Existing non-baseline rows were already considered discoveries. Backfill them so
-- the dashboard keeps its previous behavior while switching to opportunity time.
UPDATE steam_games
SET opportunity_at = COALESCE(opportunity_at, first_observed_at),
    opportunity_reason = COALESCE(opportunity_reason, 'new_app')
WHERE is_baseline = FALSE;

CREATE INDEX IF NOT EXISTS idx_steam_games_opportunity
  ON steam_games(opportunity_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_steam_games_app_list_changed
  ON steam_games(app_list_changed_at DESC NULLS LAST);

-- Rewind the official incremental cursor once so games modified during the last
-- month are replayed through the new update path. This is important for baseline
-- apps that released after the monitor baseline was created.
UPDATE steam_monitor_state
SET value = jsonb_set(
      value,
      '{ifModifiedSince}',
      to_jsonb(FLOOR(EXTRACT(EPOCH FROM (NOW() - INTERVAL '30 days')))::bigint),
      TRUE
    ),
    updated_at = NOW()
WHERE key = 'steam_store_service_v1';
