-- Web Push subscriptions, durable notification state/logging, and server-side attention.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS attention_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_attention_reason
  ON sessions(attention_reason)
  WHERE attention_reason IS NOT NULL;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  device_label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON push_subscriptions(user_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS notification_delivery_state (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('web_push', 'openclaw')),
  dedupe_key TEXT NOT NULL,
  last_attempt_at TIMESTAMPTZ,
  last_sent_at TIMESTAMPTZ,
  reserved_until TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  payload_hash TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, channel, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_notification_delivery_retry
  ON notification_delivery_state(next_attempt_at)
  WHERE next_attempt_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS notifications_log (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('web_push', 'openclaw')),
  event_type TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  target TEXT,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'pruned', 'throttled')),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  response_status INTEGER,
  error TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_log_user_created
  ON notifications_log(user_id, channel, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_log_dedupe
  ON notifications_log(user_id, channel, dedupe_key, created_at DESC);
