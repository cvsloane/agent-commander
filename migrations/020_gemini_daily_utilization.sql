-- Add daily utilization fields for Gemini provider support
ALTER TABLE provider_usage
  ADD COLUMN IF NOT EXISTS daily_utilization REAL,
  ADD COLUMN IF NOT EXISTS daily_reset_at TIMESTAMPTZ;
