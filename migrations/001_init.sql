-- 001_init.sql
-- Agent Commander database initialization
-- Creates core tables for hosts, sessions, snapshots, events, approvals, audit log, and agent tokens

-- Note: Using gen_random_uuid() which is built into PostgreSQL 13+
-- This avoids needing the uuid-ossp extension

-- Hosts table - Machine registry with capabilities and tailscale info
CREATE TABLE hosts (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  tailscale_name TEXT,
  tailscale_ip INET,
  capabilities JSONB NOT NULL DEFAULT '{}'::JSONB,
  agent_version TEXT,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Session enums
CREATE TYPE session_kind AS ENUM ('tmux_pane', 'job', 'service');
CREATE TYPE session_provider AS ENUM ('claude_code', 'codex', 'shell', 'unknown');
CREATE TYPE session_status AS ENUM (
  'STARTING', 'RUNNING', 'IDLE',
  'WAITING_FOR_INPUT', 'WAITING_FOR_APPROVAL',
  'ERROR', 'DONE'
);

-- Sessions table - Core session state
CREATE TABLE sessions (
  id UUID PRIMARY KEY,
  host_id UUID NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  kind session_kind NOT NULL,
  provider session_provider NOT NULL,
  status session_status NOT NULL,
  title TEXT,
  cwd TEXT,
  repo_root TEXT,
  git_remote TEXT,
  git_branch TEXT,
  tmux_pane_id TEXT,           -- e.g. "%12"
  tmux_target TEXT,            -- optional richer identity e.g. "session:win.pane"
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ
);

-- Session snapshots - Captured terminal content (last 200 lines)
CREATE TABLE session_snapshots (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  capture_text TEXT NOT NULL,
  capture_hash TEXT NOT NULL
);

-- Events - Append-only event log for telemetry
CREATE TABLE events (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  type TEXT NOT NULL,
  event_id TEXT,               -- ULID from agentd (dedupe)
  payload JSONB NOT NULL
);

-- Approval decision enum
CREATE TYPE approval_decision AS ENUM ('allow', 'deny');

-- Approvals - Permission request queue + decisions
CREATE TABLE approvals (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  provider session_provider NOT NULL,
  ts_requested TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ts_decided TIMESTAMPTZ,
  decision approval_decision,
  requested_payload JSONB NOT NULL,
  decided_payload JSONB,
  decided_by_user_id UUID
);

-- Audit log - All state-changing operations
CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id UUID,
  action TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id UUID,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB
);

-- Agent tokens - Per-host bearer tokens (hashed)
CREATE TABLE agent_tokens (
  id BIGSERIAL PRIMARY KEY,
  host_id UUID NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

-- Users table (for NextAuth)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  github_id TEXT UNIQUE,
  email TEXT,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add user reference to audit_log
ALTER TABLE audit_log ADD CONSTRAINT audit_log_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

-- Add user reference to approvals
ALTER TABLE approvals ADD CONSTRAINT approvals_decided_by_user_id_fkey
  FOREIGN KEY (decided_by_user_id) REFERENCES users(id) ON DELETE SET NULL;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_hosts_updated_at
    BEFORE UPDATE ON hosts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sessions_updated_at
    BEFORE UPDATE ON sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
