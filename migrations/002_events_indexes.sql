-- 002_events_indexes.sql
-- Performance indexes for Agent Commander tables

-- Sessions indexes
CREATE INDEX sessions_host_status_idx ON sessions(host_id, status);
CREATE INDEX sessions_last_activity_idx ON sessions(last_activity_at DESC);
CREATE INDEX sessions_provider_status_idx ON sessions(provider, status);

-- Snapshots indexes
CREATE INDEX snapshots_session_created_idx ON session_snapshots(session_id, created_at DESC);

-- Events indexes
CREATE INDEX events_session_ts_idx ON events(session_id, ts DESC);
CREATE INDEX events_type_ts_idx ON events(type, ts DESC);
CREATE UNIQUE INDEX events_dedupe_idx ON events(session_id, event_id) WHERE event_id IS NOT NULL;

-- Approvals indexes
CREATE INDEX approvals_requested_idx ON approvals(ts_requested DESC);
CREATE INDEX approvals_session_requested_idx ON approvals(session_id, ts_requested DESC);
CREATE INDEX approvals_pending_idx ON approvals(ts_requested DESC) WHERE decision IS NULL;

-- Agent tokens indexes
CREATE INDEX agent_tokens_host_idx ON agent_tokens(host_id) WHERE revoked_at IS NULL;

-- Audit log indexes
CREATE INDEX audit_log_ts_idx ON audit_log(ts DESC);
CREATE INDEX audit_log_user_idx ON audit_log(user_id, ts DESC);
CREATE INDEX audit_log_object_idx ON audit_log(object_type, object_id, ts DESC);

-- Hosts indexes
CREATE INDEX hosts_last_seen_idx ON hosts(last_seen_at DESC);

-- Users indexes
CREATE UNIQUE INDEX users_github_id_idx ON users(github_id) WHERE github_id IS NOT NULL;
CREATE INDEX users_email_idx ON users(email);
