-- 030_recent_launches.sql
-- Cross-device recent mobile launch shortcuts.

CREATE TABLE IF NOT EXISTS recent_launches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  host_id UUID NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  provider session_provider NOT NULL,
  working_directory TEXT NOT NULL,
  tmux_target TEXT,
  title TEXT,
  prompt_preview TEXT,
  launch_count INTEGER NOT NULL DEFAULT 1,
  last_launched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recent_launches_user_last
  ON recent_launches(user_id, last_launched_at DESC);

CREATE INDEX IF NOT EXISTS idx_recent_launches_user_host_last
  ON recent_launches(user_id, host_id, last_launched_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_recent_launches_unique_combo
  ON recent_launches(user_id, host_id, provider, working_directory, COALESCE(tmux_target, ''));

DROP TRIGGER IF EXISTS update_recent_launches_updated_at ON recent_launches;
CREATE TRIGGER update_recent_launches_updated_at
  BEFORE UPDATE ON recent_launches
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
