-- Tighten dormant data-model relationships without discarding legacy rows.

UPDATE sessions SET fork_depth = 0 WHERE fork_depth IS NULL;
ALTER TABLE sessions ALTER COLUMN fork_depth SET DEFAULT 0;
ALTER TABLE sessions ALTER COLUMN fork_depth SET NOT NULL;

-- Summaries may outlive a session, but must not retain dangling identifiers.
ALTER TABLE summaries ALTER COLUMN session_id DROP NOT NULL;

UPDATE summaries AS summary
SET session_id = NULL
WHERE session_id IS NOT NULL
  AND (
    session_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR NOT EXISTS (
      SELECT 1
      FROM sessions
      WHERE sessions.id::TEXT = summary.session_id
    )
  );

ALTER TABLE summaries
  ALTER COLUMN session_id TYPE UUID
  USING CASE WHEN session_id IS NULL THEN NULL ELSE session_id::UUID END;

ALTER TABLE summaries
  DROP CONSTRAINT IF EXISTS summaries_session_id_fkey,
  ADD CONSTRAINT summaries_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;

-- Resolve legacy subject-only settings before making the UUID user the sole
-- identity. Unmatched rows receive a deterministic viewer user so settings are
-- preserved rather than deleted during the migration.
UPDATE user_settings AS settings
SET user_id = users.id
FROM users
WHERE settings.user_id IS NULL
  AND users.github_id = settings.user_subject
  AND NOT EXISTS (
    SELECT 1
    FROM user_settings AS occupied
    WHERE occupied.user_id = users.id
  );

-- Email is not globally unique in the legacy schema. Only adopt an email
-- identity when it resolves to exactly one user and that user has no settings
-- row yet; ambiguous or duplicate rows fall through to the preserved legacy
-- identities below.
WITH email_matches AS (
  SELECT
    settings.user_subject,
    MIN(users.id::TEXT)::UUID AS user_id
  FROM user_settings AS settings
  JOIN users ON users.email = settings.user_subject
  WHERE settings.user_id IS NULL
  GROUP BY settings.user_subject
  HAVING COUNT(DISTINCT users.id) = 1
), available_email_matches AS (
  SELECT email_matches.*
  FROM email_matches
  WHERE NOT EXISTS (
    SELECT 1
    FROM user_settings AS occupied
    WHERE occupied.user_id = email_matches.user_id
  )
)
UPDATE user_settings AS settings
SET user_id = available_email_matches.user_id
FROM available_email_matches
WHERE settings.user_subject = available_email_matches.user_subject;

INSERT INTO users (id, name, role)
SELECT DISTINCT
  md5('legacy-user-settings:' || user_subject)::UUID,
  'Legacy user settings',
  'viewer'
FROM user_settings
WHERE user_id IS NULL
ON CONFLICT (id) DO NOTHING;

UPDATE user_settings
SET user_id = md5('legacy-user-settings:' || user_subject)::UUID
WHERE user_id IS NULL;

-- Keep a narrow recovery map until each legacy subject next authenticates. The
-- application atomically claims the UUID-keyed settings row for the real auth
-- identity, so unmatched legacy settings remain reachable after this migration.
CREATE TABLE IF NOT EXISTS user_settings_legacy_subjects (
  user_subject TEXT PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE
);

INSERT INTO user_settings_legacy_subjects (user_subject, user_id)
SELECT user_subject, user_id
FROM user_settings
WHERE user_id = md5('legacy-user-settings:' || user_subject)::UUID
ON CONFLICT (user_subject) DO UPDATE SET user_id = EXCLUDED.user_id;

ALTER TABLE user_settings
  DROP CONSTRAINT IF EXISTS user_settings_user_id_fkey,
  DROP CONSTRAINT IF EXISTS user_settings_pkey;

DROP INDEX IF EXISTS idx_user_settings_user_id;

ALTER TABLE user_settings
  ALTER COLUMN user_id SET NOT NULL,
  DROP COLUMN user_subject,
  ADD CONSTRAINT user_settings_pkey PRIMARY KEY (user_id),
  ADD CONSTRAINT user_settings_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE user_settings_legacy_subjects
  DROP CONSTRAINT IF EXISTS user_settings_legacy_subjects_user_id_fkey,
  ADD CONSTRAINT user_settings_legacy_subjects_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES user_settings(user_id) ON DELETE CASCADE;

-- Link legacy project shortcuts to the canonical repo registry. Exact host/path
-- matches are safe to backfill; unresolved projects remain nullable.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS repo_id UUID;

UPDATE projects AS project
SET repo_id = repo.id
FROM repos AS repo
WHERE project.repo_id IS NULL
  AND repo.last_host_id = project.host_id
  AND repo.last_repo_root = project.path;

ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_repo_id_fkey,
  ADD CONSTRAINT projects_repo_id_fkey
    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_projects_repo_id ON projects(repo_id);

-- PostgreSQL cannot drop one enum label in place. Recreate session_kind only
-- when the legacy value is present and proven unused at migration time.
DROP INDEX IF EXISTS sessions_tmux_roster_idx;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum
    JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
    WHERE pg_type.typname = 'session_kind'
      AND pg_enum.enumlabel = 'service'
  ) AND NOT EXISTS (
    SELECT 1 FROM sessions WHERE kind::TEXT = 'service'
  ) THEN
    ALTER TABLE sessions ALTER COLUMN kind TYPE TEXT USING kind::TEXT;
    DROP TYPE session_kind;
    CREATE TYPE session_kind AS ENUM ('tmux_pane', 'job');
    ALTER TABLE sessions
      ALTER COLUMN kind TYPE session_kind USING kind::session_kind;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS sessions_tmux_roster_idx
  ON sessions(host_id, tmux_session_name, tmux_window_index, tmux_pane_index)
  WHERE kind = 'tmux_pane' AND archived_at IS NULL;

-- No production read filters events by type; the session timelines, dedupe,
-- cursor, and full-text indexes remain in place.
DROP INDEX IF EXISTS events_type_ts_idx;

CREATE INDEX IF NOT EXISTS events_retention_idx ON events(ts, id);
CREATE INDEX IF NOT EXISTS session_snapshots_retention_idx
  ON session_snapshots(created_at, id);
