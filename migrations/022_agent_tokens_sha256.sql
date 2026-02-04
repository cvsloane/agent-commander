-- 022_agent_tokens_sha256.sql
-- Add SHA256 token hash for fast agent token lookup

ALTER TABLE agent_tokens
  ADD COLUMN IF NOT EXISTS token_sha256 TEXT;

CREATE INDEX IF NOT EXISTS idx_agent_tokens_sha256
  ON agent_tokens(token_sha256)
  WHERE revoked_at IS NULL;
