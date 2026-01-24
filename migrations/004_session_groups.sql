-- 004_session_groups.sql
-- Session groups/folders for hierarchical organization

-- Session groups table
CREATE TABLE session_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  parent_id UUID REFERENCES session_groups(id) ON DELETE SET NULL,
  color VARCHAR(7) DEFAULT '#6366f1',
  icon VARCHAR(50) DEFAULT 'folder',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for efficient parent queries
CREATE INDEX idx_session_groups_parent ON session_groups(parent_id);

-- Proper uniqueness for root-level names (case-insensitive)
CREATE UNIQUE INDEX session_groups_root_name_unique
  ON session_groups (lower(name)) WHERE parent_id IS NULL;

-- Proper uniqueness for child names under the same parent (case-insensitive)
CREATE UNIQUE INDEX session_groups_child_name_unique
  ON session_groups (parent_id, lower(name)) WHERE parent_id IS NOT NULL;

-- Add group_id to sessions table
ALTER TABLE sessions
  ADD COLUMN group_id UUID REFERENCES session_groups(id) ON DELETE SET NULL;

-- Index for filtering sessions by group
CREATE INDEX idx_sessions_group ON sessions(group_id);

-- Trigger to update updated_at
CREATE TRIGGER update_session_groups_updated_at
  BEFORE UPDATE ON session_groups
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Helper function to check for cycles in group hierarchy
-- Returns true if setting parent_id would create a cycle
CREATE OR REPLACE FUNCTION check_group_cycle(group_id UUID, new_parent_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  current_id UUID := new_parent_id;
BEGIN
  IF new_parent_id IS NULL THEN
    RETURN FALSE;
  END IF;

  WHILE current_id IS NOT NULL LOOP
    IF current_id = group_id THEN
      RETURN TRUE;
    END IF;
    SELECT parent_id INTO current_id FROM session_groups WHERE id = current_id;
  END LOOP;

  RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

-- Helper function to get all descendant group IDs
CREATE OR REPLACE FUNCTION get_group_descendants(root_group_id UUID)
RETURNS TABLE(id UUID) AS $$
WITH RECURSIVE descendants AS (
  SELECT sg.id FROM session_groups sg WHERE sg.parent_id = root_group_id
  UNION ALL
  SELECT sg.id FROM session_groups sg
  INNER JOIN descendants d ON sg.parent_id = d.id
)
SELECT id FROM descendants;
$$ LANGUAGE sql;
