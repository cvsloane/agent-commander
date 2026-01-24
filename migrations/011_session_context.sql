-- Migration 011: Session Context Store
-- Key-value store for sharing context between linked sessions

CREATE TABLE IF NOT EXISTS session_context (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One value per key per session
  UNIQUE (session_id, key)
);

-- Index for looking up context by session
CREATE INDEX IF NOT EXISTS idx_session_context_session ON session_context(session_id);

-- Index for key lookups
CREATE INDEX IF NOT EXISTS idx_session_context_key ON session_context(key);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_session_context_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER session_context_update_timestamp
  BEFORE UPDATE ON session_context
  FOR EACH ROW
  EXECUTE FUNCTION update_session_context_updated_at();

-- Comment explaining usage
COMMENT ON TABLE session_context IS
  'Key-value context store for sessions. Use to share plans, notes, and artifacts between linked sessions.';
