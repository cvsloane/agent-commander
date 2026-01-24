-- Migration 018: Extend session_usage_latest with utilization + context fields
-- Adds percent-based usage and reset text fields parsed from CLI output.

ALTER TABLE session_usage_latest
  ADD COLUMN IF NOT EXISTS session_utilization_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS session_left_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS session_reset_text TEXT,
  ADD COLUMN IF NOT EXISTS weekly_utilization_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS weekly_left_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS weekly_reset_text TEXT,
  ADD COLUMN IF NOT EXISTS weekly_sonnet_utilization_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS weekly_sonnet_reset_text TEXT,
  ADD COLUMN IF NOT EXISTS weekly_opus_utilization_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS weekly_opus_reset_text TEXT,
  ADD COLUMN IF NOT EXISTS context_used_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS context_total_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS context_left_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS five_hour_left_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS five_hour_reset_text TEXT;

CREATE INDEX IF NOT EXISTS idx_session_usage_context_left ON session_usage_latest(context_left_percent);
