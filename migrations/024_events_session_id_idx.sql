-- 024_events_session_id_idx.sql
-- Support event pagination ordered by id

CREATE INDEX IF NOT EXISTS idx_events_session_id
  ON events(session_id, id DESC);
