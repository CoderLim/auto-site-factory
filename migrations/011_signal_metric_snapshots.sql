CREATE TABLE IF NOT EXISTS signal_metric_snapshots (
  id BIGSERIAL PRIMARY KEY,
  raw_signal_id TEXT NOT NULL REFERENCES raw_signals(id) ON DELETE CASCADE,
  observed_at TIMESTAMPTZ NOT NULL,
  score BIGINT,
  comments BIGINT,
  views BIGINT,
  shares BIGINT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(raw_signal_id, observed_at)
);

CREATE INDEX IF NOT EXISTS idx_signal_metric_snapshots_signal_time
  ON signal_metric_snapshots(raw_signal_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_metric_snapshots_observed_at
  ON signal_metric_snapshots(observed_at DESC);
