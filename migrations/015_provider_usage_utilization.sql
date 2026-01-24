-- Migration 015: Add utilization percentage columns to provider_usage
-- Supports Claude and Codex APIs that return utilization percentages instead of token counts

ALTER TABLE provider_usage
  ADD COLUMN IF NOT EXISTS five_hour_utilization REAL,
  ADD COLUMN IF NOT EXISTS five_hour_reset_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS weekly_utilization REAL,
  ADD COLUMN IF NOT EXISTS weekly_reset_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS weekly_opus_utilization REAL,
  ADD COLUMN IF NOT EXISTS weekly_opus_reset_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS weekly_sonnet_utilization REAL,
  ADD COLUMN IF NOT EXISTS weekly_sonnet_reset_at TIMESTAMPTZ;

COMMENT ON COLUMN provider_usage.five_hour_utilization IS 'Percentage (0-100) of 5-hour rate limit used';
COMMENT ON COLUMN provider_usage.weekly_utilization IS 'Percentage (0-100) of weekly limit used';
COMMENT ON COLUMN provider_usage.weekly_opus_utilization IS 'Percentage (0-100) of weekly Opus limit used (Claude only)';
COMMENT ON COLUMN provider_usage.weekly_sonnet_utilization IS 'Percentage (0-100) of weekly Sonnet limit used (Claude only)';
