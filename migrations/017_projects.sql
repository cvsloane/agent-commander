-- Migration 017: Projects Table
-- Project manager with multi-host scoping for tracking project directories.
-- Each project is scoped to a specific user and host to support multi-machine workflows.

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  host_id UUID NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  display_name TEXT,
  description TEXT,

  -- Usage tracking
  last_used_at TIMESTAMPTZ,
  usage_count INTEGER DEFAULT 0,

  -- Git metadata (cached)
  git_remote TEXT,
  default_branch TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Unique constraint: one project per path per user per host
  UNIQUE(user_id, host_id, path)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_host ON projects(host_id);
CREATE INDEX IF NOT EXISTS idx_projects_path ON projects(path);
CREATE INDEX IF NOT EXISTS idx_projects_last_used ON projects(last_used_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_user_host ON projects(user_id, host_id);

-- Comments
COMMENT ON TABLE projects IS 'Tracked project directories across hosts';
COMMENT ON COLUMN projects.user_id IS 'User who owns this project entry';
COMMENT ON COLUMN projects.host_id IS 'Host where this project path exists';
COMMENT ON COLUMN projects.path IS 'Absolute path to the project directory';
COMMENT ON COLUMN projects.display_name IS 'User-friendly name for the project';
COMMENT ON COLUMN projects.usage_count IS 'Number of times this project has been used';

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_projects_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_projects_updated_at ON projects;
CREATE TRIGGER trigger_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION update_projects_updated_at();
