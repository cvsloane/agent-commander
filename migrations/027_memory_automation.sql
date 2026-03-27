-- Migration 027: Canonical repos, scoped memory, and autonomous orchestration

-- Canonical repos (shared across users; memory remains user-scoped)
CREATE TABLE IF NOT EXISTS repos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_key TEXT NOT NULL UNIQUE,
  git_remote_normalized TEXT,
  repo_root_hash TEXT,
  display_name TEXT,
  last_host_id UUID REFERENCES hosts(id) ON DELETE SET NULL,
  last_repo_root TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (git_remote_normalized IS NOT NULL OR repo_root_hash IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_repos_git_remote ON repos(git_remote_normalized);
CREATE INDEX IF NOT EXISTS idx_repos_last_host ON repos(last_host_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'sessions' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE sessions
      ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'sessions' AND column_name = 'repo_id'
  ) THEN
    ALTER TABLE sessions
      ADD COLUMN repo_id UUID REFERENCES repos(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_repo_id ON sessions(repo_id);

-- Scoped memory entries
CREATE TABLE IF NOT EXISTS memory_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'repo', 'working')),
  repo_id UUID REFERENCES repos(id) ON DELETE SET NULL,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  tier TEXT NOT NULL CHECK (tier IN ('working', 'episodic', 'semantic')),
  summary TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  embedding JSONB,
  embedding_model TEXT,
  embedding_dimensions INTEGER,
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', COALESCE(summary, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(content, '')), 'B')
  ) STORED,
  CHECK ((scope_type = 'repo' AND repo_id IS NOT NULL) OR scope_type <> 'repo'),
  CHECK ((scope_type = 'working' AND session_id IS NOT NULL) OR scope_type <> 'working')
);

CREATE INDEX IF NOT EXISTS idx_memory_entries_user_scope ON memory_entries(user_id, scope_type, tier);
CREATE INDEX IF NOT EXISTS idx_memory_entries_repo ON memory_entries(repo_id, tier);
CREATE INDEX IF NOT EXISTS idx_memory_entries_session ON memory_entries(session_id);
CREATE INDEX IF NOT EXISTS idx_memory_entries_expires_at ON memory_entries(expires_at);
CREATE INDEX IF NOT EXISTS idx_memory_entries_search ON memory_entries USING GIN(search_vector);

CREATE TABLE IF NOT EXISTS memory_trajectories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repo_id UUID REFERENCES repos(id) ON DELETE SET NULL,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  automation_run_id UUID,
  objective TEXT,
  outcome TEXT NOT NULL DEFAULT 'unknown',
  summary TEXT NOT NULL,
  steps_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  distilled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_trajectories_user_repo ON memory_trajectories(user_id, repo_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_trajectories_session ON memory_trajectories(session_id);
CREATE INDEX IF NOT EXISTS idx_memory_trajectories_undistilled ON memory_trajectories(distilled_at) WHERE distilled_at IS NULL;

-- Autonomous orchestration
CREATE TABLE IF NOT EXISTS automation_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('orchestrator', 'worker')),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  reports_to_automation_agent_id UUID REFERENCES automation_agents(id) ON DELETE SET NULL,
  provider session_provider NOT NULL,
  default_cwd TEXT,
  fixed_host_id UUID REFERENCES hosts(id) ON DELETE SET NULL,
  wake_policy_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  memory_policy_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  budget_policy_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  worker_pool_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  max_parallel_runs INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_automation_agents_user_status ON automation_agents(user_id, status);
CREATE INDEX IF NOT EXISTS idx_automation_agents_reports_to ON automation_agents(reports_to_automation_agent_id);

CREATE TABLE IF NOT EXISTS automation_wakeups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_agent_id UUID NOT NULL REFERENCES automation_agents(id) ON DELETE CASCADE,
  repo_id UUID REFERENCES repos(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('schedule', 'manual', 'followup', 'approval_resume')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'skipped', 'blocked', 'coalesced', 'failed')),
  idempotency_key TEXT,
  context_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_automation_wakeups_agent_status ON automation_wakeups(automation_agent_id, status, requested_at);
CREATE INDEX IF NOT EXISTS idx_automation_wakeups_repo_status ON automation_wakeups(repo_id, status, requested_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_wakeups_active_dedupe
  ON automation_wakeups(automation_agent_id, COALESCE(repo_id, '00000000-0000-0000-0000-000000000000'::uuid), idempotency_key)
  WHERE idempotency_key IS NOT NULL AND status IN ('queued', 'running', 'blocked');

CREATE TABLE IF NOT EXISTS automation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_agent_id UUID NOT NULL REFERENCES automation_agents(id) ON DELETE CASCADE,
  wakeup_id UUID NOT NULL REFERENCES automation_wakeups(id) ON DELETE CASCADE,
  repo_id UUID REFERENCES repos(id) ON DELETE SET NULL,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('starting', 'running', 'succeeded', 'failed', 'blocked', 'cancelled')),
  objective TEXT NOT NULL,
  memory_snapshot_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  result_summary TEXT,
  usage_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_agent_started ON automation_runs(automation_agent_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_runs_session ON automation_runs(session_id);
CREATE INDEX IF NOT EXISTS idx_automation_runs_repo_status ON automation_runs(repo_id, status, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_runs_active_repo
  ON automation_runs(automation_agent_id, repo_id)
  WHERE repo_id IS NOT NULL AND status IN ('starting', 'running');

CREATE TABLE IF NOT EXISTS governance_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  automation_agent_id UUID NOT NULL REFERENCES automation_agents(id) ON DELETE CASCADE,
  automation_run_id UUID REFERENCES automation_runs(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('budget_override', 'plan_review', 'host_selection', 'scope_escalation')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'cancelled')),
  request_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  decision_payload JSONB,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ,
  decided_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_governance_approvals_user_status ON governance_approvals(user_id, status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_governance_approvals_agent_status ON governance_approvals(automation_agent_id, status);

CREATE TABLE IF NOT EXISTS work_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repo_id UUID REFERENCES repos(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'in_progress', 'blocked', 'done', 'cancelled')),
  priority INTEGER NOT NULL DEFAULT 0,
  assigned_automation_agent_id UUID REFERENCES automation_agents(id) ON DELETE SET NULL,
  checkout_run_id UUID REFERENCES automation_runs(id) ON DELETE SET NULL,
  dedupe_key TEXT,
  payload_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_items_user_repo_status ON work_items(user_id, repo_id, status, priority DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_work_items_assignee_status ON work_items(assigned_automation_agent_id, status, priority DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_items_active_dedupe
  ON work_items(user_id, COALESCE(repo_id, '00000000-0000-0000-0000-000000000000'::uuid), dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'in_progress', 'blocked');

-- Add deferred FK now that automation_runs exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'memory_trajectories'
      AND constraint_name = 'memory_trajectories_automation_run_id_fkey'
  ) THEN
    ALTER TABLE memory_trajectories
      ADD CONSTRAINT memory_trajectories_automation_run_id_fkey
      FOREIGN KEY (automation_run_id) REFERENCES automation_runs(id) ON DELETE SET NULL;
  END IF;
END $$;

-- updated_at triggers
CREATE TRIGGER update_repos_updated_at
  BEFORE UPDATE ON repos
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_memory_entries_updated_at
  BEFORE UPDATE ON memory_entries
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_memory_trajectories_updated_at
  BEFORE UPDATE ON memory_trajectories
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_automation_agents_updated_at
  BEFORE UPDATE ON automation_agents
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_work_items_updated_at
  BEFORE UPDATE ON work_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
