-- Migration 008: Add session archive support
-- Adds archived_at column for soft-delete functionality

-- Add archived_at column to sessions
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Partial index for archived sessions (for filtering)
CREATE INDEX IF NOT EXISTS idx_sessions_archived
  ON sessions(archived_at) WHERE archived_at IS NOT NULL;

-- Index for non-archived sessions (for default queries)
CREATE INDEX IF NOT EXISTS idx_sessions_not_archived
  ON sessions(id) WHERE archived_at IS NULL;
