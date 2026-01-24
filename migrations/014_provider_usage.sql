-- Migration 014: Provider Usage
-- Store provider-reported quota/usage snapshots (account or session scoped)

CREATE TABLE IF NOT EXISTS provider_usage (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  host_id UUID REFERENCES hosts(id) ON DELETE SET NULL,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  scope TEXT NOT NULL DEFAULT 'account', -- account | session
  reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Raw payloads
  raw_text TEXT,
  raw_json JSONB,

  -- Parsed/normalized fields (best-effort)
  remaining_tokens BIGINT,
  remaining_requests BIGINT,
  weekly_limit_tokens BIGINT,
  weekly_remaining_tokens BIGINT,
  weekly_remaining_cost_cents INTEGER,
  reset_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_provider_usage_provider ON provider_usage(provider);
CREATE INDEX IF NOT EXISTS idx_provider_usage_host ON provider_usage(host_id);
CREATE INDEX IF NOT EXISTS idx_provider_usage_session ON provider_usage(session_id);
CREATE INDEX IF NOT EXISTS idx_provider_usage_scope ON provider_usage(scope);
CREATE INDEX IF NOT EXISTS idx_provider_usage_reported_at ON provider_usage(reported_at);
