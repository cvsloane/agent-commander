-- Summaries table for caching AI-generated orchestrator summaries
CREATE TABLE IF NOT EXISTS summaries (
  id SERIAL PRIMARY KEY,
  capture_hash VARCHAR(64) NOT NULL UNIQUE,
  session_id VARCHAR(255) NOT NULL,
  action_type VARCHAR(50) NOT NULL,
  summary TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for quick lookups by capture_hash
CREATE INDEX IF NOT EXISTS idx_summaries_capture_hash ON summaries(capture_hash);

-- Index for session-based queries
CREATE INDEX IF NOT EXISTS idx_summaries_session_id ON summaries(session_id);
