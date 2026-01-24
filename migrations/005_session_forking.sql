-- 005_session_forking.sql
-- Session forking for cloning sessions to new contexts

-- Add forking columns to sessions table
ALTER TABLE sessions ADD COLUMN forked_from UUID REFERENCES sessions(id) ON DELETE SET NULL;
ALTER TABLE sessions ADD COLUMN fork_depth INTEGER DEFAULT 0;

-- Index for finding forks of a session
CREATE INDEX idx_sessions_forked_from ON sessions(forked_from);

-- Note: Fork logic is handled in the application layer:
-- 1. Fork creates new tmux window with same cwd
-- 2. Copy session metadata and last snapshot to new session
-- 3. Optionally restore Claude conversation context via --resume
