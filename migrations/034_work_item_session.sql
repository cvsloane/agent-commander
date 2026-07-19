-- Allow work items to be claimed directly by a concrete session.

ALTER TABLE work_items
  ADD COLUMN session_id UUID REFERENCES sessions(id) ON DELETE SET NULL;

CREATE INDEX idx_work_items_session_id
  ON work_items(session_id);
