-- 006_search.sql
-- Full-text search for sessions and events

-- Add search vectors to sessions
ALTER TABLE sessions ADD COLUMN search_vector tsvector;

-- Add search vector to events
ALTER TABLE events ADD COLUMN search_vector tsvector;

-- Add search vector to session_snapshots
ALTER TABLE session_snapshots ADD COLUMN search_vector tsvector;

-- Create GIN indexes for fast full-text search
CREATE INDEX idx_sessions_search ON sessions USING GIN(search_vector);
CREATE INDEX idx_events_search ON events USING GIN(search_vector);
CREATE INDEX idx_snapshots_search ON session_snapshots USING GIN(search_vector);

-- Trigger function for sessions search vector
-- Columns: title (A weight), cwd (B), git_branch (B), repo_root (C), git_remote (D)
CREATE OR REPLACE FUNCTION sessions_search_trigger() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.cwd, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.git_branch, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.repo_root, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.git_remote, '')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for sessions
CREATE TRIGGER sessions_search_update
  BEFORE INSERT OR UPDATE OF title, cwd, git_branch, repo_root, git_remote
  ON sessions
  FOR EACH ROW
  EXECUTE FUNCTION sessions_search_trigger();

-- Trigger function for events search vector
-- Columns: type, payload (as text)
CREATE OR REPLACE FUNCTION events_search_trigger() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    coalesce(NEW.type, '') || ' ' ||
    coalesce(NEW.payload::text, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for events
CREATE TRIGGER events_search_update
  BEFORE INSERT OR UPDATE OF type, payload
  ON events
  FOR EACH ROW
  EXECUTE FUNCTION events_search_trigger();

-- Trigger function for snapshots search vector
CREATE OR REPLACE FUNCTION snapshots_search_trigger() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', coalesce(NEW.capture_text, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for snapshots
CREATE TRIGGER snapshots_search_update
  BEFORE INSERT OR UPDATE OF capture_text
  ON session_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION snapshots_search_trigger();

-- Backfill existing data (run once after migration)
-- Sessions
UPDATE sessions SET search_vector =
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(cwd, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(git_branch, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(repo_root, '')), 'C') ||
  setweight(to_tsvector('english', coalesce(git_remote, '')), 'D');

-- Events
UPDATE events SET search_vector = to_tsvector('english',
  coalesce(type, '') || ' ' ||
  coalesce(payload::text, '')
);

-- Snapshots
UPDATE session_snapshots SET search_vector =
  to_tsvector('english', coalesce(capture_text, ''));
