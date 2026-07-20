-- Session hierarchy and orchestration roles.

ALTER TABLE sessions
  ADD COLUMN role TEXT NOT NULL DEFAULT 'standalone'
    CHECK (role IN ('orchestrator', 'worker', 'standalone'));

CREATE TABLE session_edges (
  parent_session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  child_session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  edge_type TEXT NOT NULL
    CHECK (edge_type IN ('orchestrates', 'spawned', 'forked', 'reviews', 'implements')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (parent_session_id, child_session_id, edge_type)
);

CREATE INDEX idx_session_edges_child
  ON session_edges(child_session_id);

-- Preserve lineage already stored on sessions before the graph table existed.
INSERT INTO session_edges (parent_session_id, child_session_id, edge_type)
SELECT forked_from, id, 'forked'
FROM sessions
WHERE forked_from IS NOT NULL
  AND forked_from <> id
ON CONFLICT DO NOTHING;

INSERT INTO session_edges (parent_session_id, child_session_id, edge_type)
SELECT parent.id, child.id, 'spawned'
FROM sessions AS child
JOIN sessions AS parent
  ON parent.id = CASE
    WHEN child.metadata->>'parent_session_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (child.metadata->>'parent_session_id')::uuid
    ELSE NULL
  END
WHERE parent.id <> child.id
ON CONFLICT DO NOTHING;

-- Keep graph lineage durable for every session producer, including agentd-local
-- spawns/forks whose child row arrives asynchronously after command dispatch.
CREATE OR REPLACE FUNCTION sync_session_edges_from_lineage()
RETURNS TRIGGER AS $$
DECLARE
  parent_id_text TEXT;
BEGIN
  IF NEW.forked_from IS NOT NULL AND NEW.forked_from <> NEW.id THEN
    INSERT INTO session_edges (parent_session_id, child_session_id, edge_type)
    VALUES (NEW.forked_from, NEW.id, 'forked')
    ON CONFLICT DO NOTHING;
  END IF;

  parent_id_text := NEW.metadata->>'parent_session_id';
  IF parent_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    INSERT INTO session_edges (parent_session_id, child_session_id, edge_type)
    SELECT id, NEW.id, 'spawned'
    FROM sessions
    WHERE id = parent_id_text::uuid
      AND id <> NEW.id
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sync_session_edges_from_lineage_trigger
  AFTER INSERT OR UPDATE OF forked_from, metadata ON sessions
  FOR EACH ROW
  EXECUTE FUNCTION sync_session_edges_from_lineage();
