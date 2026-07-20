-- Promote tmux pane coordinates out of session metadata so roster reads do not
-- need to reconstruct identity from display strings.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS tmux_session_name TEXT,
  ADD COLUMN IF NOT EXISTS tmux_window_index INTEGER,
  ADD COLUMN IF NOT EXISTS tmux_pane_index INTEGER;

UPDATE sessions
SET tmux_session_name = COALESCE(
      NULLIF(metadata #>> '{tmux,session_name}', ''),
      CASE
        WHEN tmux_target LIKE '%:%' THEN NULLIF(split_part(tmux_target, ':', 1), '')
        ELSE NULL
      END
    ),
    tmux_window_index = COALESCE(
      CASE
        WHEN metadata #>> '{tmux,window_index}' ~ '^\d+$'
          THEN (metadata #>> '{tmux,window_index}')::INTEGER
        ELSE NULL
      END,
      CASE
        WHEN tmux_target ~ ':\d+(\.\d+)?$'
          THEN (substring(tmux_target FROM ':(\d+)'))::INTEGER
        ELSE NULL
      END
    ),
    tmux_pane_index = COALESCE(
      CASE
        WHEN metadata #>> '{tmux,pane_index}' ~ '^\d+$'
          THEN (metadata #>> '{tmux,pane_index}')::INTEGER
        ELSE NULL
      END,
      CASE
        WHEN tmux_target ~ ':\d+\.\d+$'
          THEN (substring(tmux_target FROM '\.(\d+)$'))::INTEGER
        ELSE NULL
      END
    )
WHERE kind = 'tmux_pane'
  AND (
    tmux_session_name IS NULL
    OR tmux_window_index IS NULL
    OR tmux_pane_index IS NULL
  );

ALTER TABLE sessions
  DROP CONSTRAINT IF EXISTS sessions_tmux_window_index_nonnegative,
  ADD CONSTRAINT sessions_tmux_window_index_nonnegative
    CHECK (tmux_window_index IS NULL OR tmux_window_index >= 0),
  DROP CONSTRAINT IF EXISTS sessions_tmux_pane_index_nonnegative,
  ADD CONSTRAINT sessions_tmux_pane_index_nonnegative
    CHECK (tmux_pane_index IS NULL OR tmux_pane_index >= 0);

CREATE INDEX IF NOT EXISTS sessions_tmux_roster_idx
  ON sessions(host_id, tmux_session_name, tmux_window_index, tmux_pane_index)
  WHERE kind = 'tmux_pane' AND archived_at IS NULL;
