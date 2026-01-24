-- Migration 012: Tool Events
-- Real-time activity timeline for AI tool usage

CREATE TABLE IF NOT EXISTS tool_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  provider VARCHAR(32) NOT NULL,
  tool_name VARCHAR(64) NOT NULL,
  tool_input JSONB,
  tool_output JSONB,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  success BOOLEAN,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for session timeline queries (most recent first)
CREATE INDEX IF NOT EXISTS tool_events_session_started_idx
  ON tool_events(session_id, started_at DESC);

-- Index for tool name lookups (aggregations)
CREATE INDEX IF NOT EXISTS tool_events_tool_name_idx
  ON tool_events(tool_name);

-- Index for provider filtering
CREATE INDEX IF NOT EXISTS tool_events_provider_idx
  ON tool_events(provider);

-- Comment explaining usage
COMMENT ON TABLE tool_events IS
  'Tracks AI tool invocations for real-time activity timeline. Each row represents a tool call from Claude, Codex, Gemini, etc.';
