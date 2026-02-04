-- 023_provider_usage_latest_idx.sql
-- Composite index to speed up latest provider usage queries

CREATE INDEX IF NOT EXISTS idx_provider_usage_latest
  ON provider_usage(provider, host_id, scope, session_id, reported_at DESC);
