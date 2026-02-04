-- 025_sessions_repo_root_idx.sql
-- Index to speed up repo_root lookups

CREATE INDEX IF NOT EXISTS idx_sessions_repo_root
  ON sessions(repo_root);
