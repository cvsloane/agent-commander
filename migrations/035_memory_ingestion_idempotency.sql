-- Make autonomous session-to-memory ingestion retry-safe without holding
-- connection-level locks. Existing rows remain unchanged; only new ingestions
-- opt into the idempotency key.

ALTER TABLE memory_entries
  ADD COLUMN ingestion_key TEXT;

CREATE UNIQUE INDEX idx_memory_entries_ingestion_key
  ON memory_entries(ingestion_key)
  WHERE ingestion_key IS NOT NULL;

ALTER TABLE memory_trajectories
  ADD COLUMN ingestion_key TEXT;

CREATE UNIQUE INDEX idx_memory_trajectories_ingestion_key
  ON memory_trajectories(ingestion_key)
  WHERE ingestion_key IS NOT NULL;
