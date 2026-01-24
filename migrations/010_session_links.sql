-- Migration 010: Session Links
-- Bidirectional relationships between sessions (e.g., Claude planner ↔ Codex implementer)

CREATE TABLE IF NOT EXISTS session_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  target_session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  link_type VARCHAR(20) NOT NULL CHECK (link_type IN ('complement', 'review', 'implement', 'research')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Prevent duplicate links (same direction)
  UNIQUE (source_session_id, target_session_id),

  -- Prevent self-links
  CONSTRAINT no_self_links CHECK (source_session_id <> target_session_id)
);

-- Index for finding links from a source session
CREATE INDEX IF NOT EXISTS idx_session_links_source ON session_links(source_session_id);

-- Index for finding links to a target session (reverse lookup)
CREATE INDEX IF NOT EXISTS idx_session_links_target ON session_links(target_session_id);

-- Index for filtering by link type
CREATE INDEX IF NOT EXISTS idx_session_links_type ON session_links(link_type);

-- Comment explaining link types
COMMENT ON COLUMN session_links.link_type IS
  'Type of relationship: complement (pair working together), review (one reviews other), implement (implementer of plan), research (research feeding context)';
