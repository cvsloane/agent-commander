-- 031_command_outbox.sql
-- Durable control-plane to agent command delivery and idempotency.

CREATE TABLE IF NOT EXISTS commands (
  cmd_id UUID PRIMARY KEY,
  host_id UUID NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  session_id UUID,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  class TEXT NOT NULL CHECK (class IN ('durable', 'volatile')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sent', 'completed', 'failed', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  result JSONB,
  error JSONB,
  idempotency_key TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_commands_host_idempotency
  ON commands(host_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_commands_host_deliverable
  ON commands(host_id, created_at, cmd_id)
  WHERE status IN ('queued', 'sent');

CREATE INDEX IF NOT EXISTS idx_commands_expires_at
  ON commands(expires_at)
  WHERE status IN ('queued', 'sent');
