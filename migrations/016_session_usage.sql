-- Migration 016: Session Usage Summary Table
-- Summary table that stores only the latest usage per session to avoid unbounded growth.
-- This complements provider_usage for per-session token tracking displayed in the UI.

CREATE TABLE IF NOT EXISTS session_usage_latest (
  session_id UUID PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,

  -- Token counts (parsed from console output or hooks)
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,

  -- Cost estimates
  estimated_cost_cents INTEGER,

  -- Metadata
  reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_usage_line TEXT -- Original usage line for debugging
);

CREATE INDEX IF NOT EXISTS idx_session_usage_reported ON session_usage_latest(reported_at);
CREATE INDEX IF NOT EXISTS idx_session_usage_provider ON session_usage_latest(provider);

COMMENT ON TABLE session_usage_latest IS 'Summary table storing only the latest usage per session';
COMMENT ON COLUMN session_usage_latest.raw_usage_line IS 'Original usage line from console output for debugging';
