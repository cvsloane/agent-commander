-- Migration 013: Approval Lifecycle Improvements
-- Adds timed_out_at for approval expiration and partial index for pending approvals

-- Add timed_out_at column to track approval expiration
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS timed_out_at TIMESTAMPTZ;

-- Partial index for fast pending approval queries (decision IS NULL and not timed out)
CREATE INDEX IF NOT EXISTS idx_approvals_pending
  ON approvals(session_id) WHERE decision IS NULL AND timed_out_at IS NULL;

-- Comment explaining the columns
COMMENT ON COLUMN approvals.timed_out_at IS
  'Timestamp when approval was superseded by a newer prompt. Null means active.';
