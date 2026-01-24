-- Migration 009: Session Analytics
-- Track token usage, tool calls, and duration metrics per session

-- Session metrics table for aggregated stats
CREATE TABLE IF NOT EXISTS session_metrics (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,

  -- Token usage
  tokens_in BIGINT DEFAULT 0,
  tokens_out BIGINT DEFAULT 0,
  tokens_cache_read BIGINT DEFAULT 0,
  tokens_cache_write BIGINT DEFAULT 0,

  -- Activity counts
  tool_calls BIGINT DEFAULT 0,
  approvals_requested BIGINT DEFAULT 0,
  approvals_granted BIGINT DEFAULT 0,
  approvals_denied BIGINT DEFAULT 0,

  -- Timing
  first_event_at TIMESTAMPTZ,
  last_event_at TIMESTAMPTZ,

  -- Cost estimate (in USD cents, calculated from token usage)
  estimated_cost_cents INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(session_id)
);

CREATE INDEX IF NOT EXISTS idx_session_metrics_session ON session_metrics(session_id);
CREATE INDEX IF NOT EXISTS idx_session_metrics_updated ON session_metrics(updated_at);

-- Token usage events for detailed tracking (optional, for charts)
CREATE TABLE IF NOT EXISTS token_events (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  event_id BIGINT REFERENCES events(id) ON DELETE SET NULL,

  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  tokens_cache_read INTEGER DEFAULT 0,
  tokens_cache_write INTEGER DEFAULT 0,

  tool_name TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_token_events_session ON token_events(session_id);
CREATE INDEX IF NOT EXISTS idx_token_events_recorded ON token_events(recorded_at);

-- Function to update session_metrics from token_events
CREATE OR REPLACE FUNCTION update_session_metrics_from_event()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO session_metrics (session_id, tokens_in, tokens_out, tokens_cache_read, tokens_cache_write, tool_calls, first_event_at, last_event_at)
  VALUES (
    NEW.session_id,
    COALESCE(NEW.tokens_in, 0),
    COALESCE(NEW.tokens_out, 0),
    COALESCE(NEW.tokens_cache_read, 0),
    COALESCE(NEW.tokens_cache_write, 0),
    CASE WHEN NEW.tool_name IS NOT NULL THEN 1 ELSE 0 END,
    NEW.recorded_at,
    NEW.recorded_at
  )
  ON CONFLICT (session_id) DO UPDATE SET
    tokens_in = session_metrics.tokens_in + COALESCE(NEW.tokens_in, 0),
    tokens_out = session_metrics.tokens_out + COALESCE(NEW.tokens_out, 0),
    tokens_cache_read = session_metrics.tokens_cache_read + COALESCE(NEW.tokens_cache_read, 0),
    tokens_cache_write = session_metrics.tokens_cache_write + COALESCE(NEW.tokens_cache_write, 0),
    tool_calls = session_metrics.tool_calls + CASE WHEN NEW.tool_name IS NOT NULL THEN 1 ELSE 0 END,
    first_event_at = LEAST(COALESCE(session_metrics.first_event_at, NEW.recorded_at), NEW.recorded_at),
    last_event_at = GREATEST(COALESCE(session_metrics.last_event_at, NEW.recorded_at), NEW.recorded_at),
    updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER token_events_update_metrics
  AFTER INSERT ON token_events
  FOR EACH ROW
  EXECUTE FUNCTION update_session_metrics_from_event();
