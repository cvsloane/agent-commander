-- Add idled_at column for manual idle/snooze state
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS idled_at TIMESTAMPTZ;

-- Index for filtering idled sessions
CREATE INDEX IF NOT EXISTS idx_sessions_idled_at
  ON sessions(idled_at) WHERE idled_at IS NOT NULL;
