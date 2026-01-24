-- 003_host_seq.sql
-- Add host-level ack tracking for agent WS reliability

ALTER TABLE hosts
  ADD COLUMN IF NOT EXISTS last_acked_seq BIGINT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS hosts_last_acked_seq_idx ON hosts(last_acked_seq);
