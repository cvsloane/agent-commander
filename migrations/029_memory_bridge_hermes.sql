-- Migration 029: memory bridge, external wakes, slugs, and structured run artifacts

ALTER TABLE automation_wakeups
  DROP CONSTRAINT IF EXISTS automation_wakeups_source_check;

ALTER TABLE automation_wakeups
  ADD CONSTRAINT automation_wakeups_source_check
  CHECK (source IN ('schedule', 'manual', 'followup', 'approval_resume', 'external'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'automation_agents'
      AND column_name = 'slug'
  ) THEN
    ALTER TABLE automation_agents
      ADD COLUMN slug TEXT;
  END IF;
END $$;

WITH normalized AS (
  SELECT
    id,
    NULLIF(
      trim(both '-' FROM regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')),
      ''
    ) AS base_slug
  FROM automation_agents
),
ranked AS (
  SELECT
    id,
    COALESCE(base_slug, 'automation-agent') AS base_slug,
    row_number() OVER (
      PARTITION BY COALESCE(base_slug, 'automation-agent')
      ORDER BY created_at, id
    ) AS dup_rank
  FROM normalized
  JOIN automation_agents USING (id)
)
UPDATE automation_agents a
SET slug = CASE
  WHEN r.dup_rank = 1 THEN r.base_slug
  ELSE r.base_slug || '-' || r.dup_rank::text
END
FROM ranked r
WHERE a.id = r.id
  AND (a.slug IS NULL OR trim(a.slug) = '');

ALTER TABLE automation_agents
  ALTER COLUMN slug SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_agents_slug_unique
  ON automation_agents(slug);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'automation_runs'
      AND column_name = 'worker_report_json'
  ) THEN
    ALTER TABLE automation_runs
      ADD COLUMN worker_report_json JSONB NOT NULL DEFAULT '{}'::JSONB;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'automation_runs'
      AND column_name = 'log_ref_json'
  ) THEN
    ALTER TABLE automation_runs
      ADD COLUMN log_ref_json JSONB NOT NULL DEFAULT '{}'::JSONB;
  END IF;
END $$;
