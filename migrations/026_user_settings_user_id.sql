-- 026_user_settings_user_id.sql
-- Add UUID user_id to user_settings for deterministic user IDs

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS user_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_settings_user_id
  ON user_settings(user_id)
  WHERE user_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_settings_user_id_fkey'
  ) THEN
    ALTER TABLE user_settings
      ADD CONSTRAINT user_settings_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;
