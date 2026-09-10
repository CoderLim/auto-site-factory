ALTER TABLE entity_mentions
  ADD COLUMN IF NOT EXISTS source_target_id TEXT,
  ADD COLUMN IF NOT EXISTS author TEXT,
  ADD COLUMN IF NOT EXISTS platform TEXT;

UPDATE entity_mentions em
SET source_target_id = COALESCE(em.source_target_id, rs.source_target_id),
    author = COALESCE(em.author, rs.author),
    platform = COALESCE(
      em.platform,
      NULLIF(rs.metadata->>'platform', ''),
      em.source_type
    )
FROM raw_signals rs
WHERE rs.id = em.raw_signal_id
  AND (
    em.source_target_id IS NULL
    OR em.author IS NULL
    OR em.platform IS NULL
  );

UPDATE entity_mentions
SET platform = source_type
WHERE platform IS NULL OR platform = '';

CREATE INDEX IF NOT EXISTS idx_entity_mentions_entity_platform
  ON entity_mentions(entity_id, platform);

CREATE INDEX IF NOT EXISTS idx_entity_mentions_entity_target
  ON entity_mentions(entity_id, source_target_id);

CREATE INDEX IF NOT EXISTS idx_entity_mentions_entity_author
  ON entity_mentions(entity_id, author)
  WHERE author IS NOT NULL AND author <> '';
