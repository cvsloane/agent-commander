-- Migration 028: procedural memory, runtime state, run events, and semantic retrieval support

ALTER TABLE memory_entries
  DROP CONSTRAINT IF EXISTS memory_entries_tier_check;

ALTER TABLE memory_entries
  ADD CONSTRAINT memory_entries_tier_check
  CHECK (tier IN ('working', 'episodic', 'semantic', 'procedural'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_trajectories_session_unique
  ON memory_trajectories(session_id)
  WHERE session_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'automation_wakeups'
      AND column_name = 'coalesced_into_run_id'
  ) THEN
    ALTER TABLE automation_wakeups
      ADD COLUMN coalesced_into_run_id UUID REFERENCES automation_runs(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'automation_runs'
      AND column_name = 'pending_followups_json'
  ) THEN
    ALTER TABLE automation_runs
      ADD COLUMN pending_followups_json JSONB NOT NULL DEFAULT '[]'::JSONB;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS automation_runtime_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_agent_id UUID NOT NULL REFERENCES automation_agents(id) ON DELETE CASCADE,
  repo_id UUID REFERENCES repos(id) ON DELETE CASCADE,
  active_session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  active_host_id UUID REFERENCES hosts(id) ON DELETE SET NULL,
  last_session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  last_run_id UUID REFERENCES automation_runs(id) ON DELETE SET NULL,
  runtime_status TEXT NOT NULL DEFAULT 'idle' CHECK (runtime_status IN ('idle', 'attached', 'stale', 'error')),
  state_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  usage_rollup_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_runtime_states_scope
  ON automation_runtime_states (
    automation_agent_id,
    COALESCE(repo_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
CREATE INDEX IF NOT EXISTS idx_automation_runtime_states_active_session
  ON automation_runtime_states(active_session_id);

CREATE TABLE IF NOT EXISTS automation_run_events (
  id BIGSERIAL PRIMARY KEY,
  automation_run_id UUID NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warn', 'error')),
  message TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (automation_run_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_automation_run_events_run_seq
  ON automation_run_events(automation_run_id, seq);

CREATE TRIGGER update_automation_runtime_states_updated_at
  BEFORE UPDATE ON automation_runtime_states
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    BEGIN
      EXECUTE 'CREATE EXTENSION IF NOT EXISTS vector';
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'Skipping vector extension install because of insufficient privilege';
      WHEN undefined_file THEN
        RAISE NOTICE 'Skipping vector extension install because extension is unavailable';
    END;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'memory_entries'
        AND column_name = 'embedding_vector'
    ) THEN
      EXECUTE 'ALTER TABLE memory_entries ADD COLUMN embedding_vector vector(1536)';
    END IF;

    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_memory_entries_embedding_vector ON memory_entries USING ivfflat (embedding_vector vector_cosine_ops) WITH (lists = 100)';
  END IF;
END $$;
