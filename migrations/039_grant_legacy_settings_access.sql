-- The 0.4.x settings-claim path reads/writes user_settings_legacy_subjects.
-- That table was created by a superuser-run migration without granting the
-- application role, causing production PUT /v1/settings to 500
-- ("permission denied") and the dashboard to fall back to local-only settings.
-- Idempotent re-grant; applied manually to production 2026-07-21.
--
-- The `agent_console` role only exists in deployments that provision a separate
-- application role. Fresh databases (CI, local dev, new environments) own the
-- table as the connecting user and need no grant, so skip rather than fail --
-- an unconditional GRANT aborts the whole migration chain with
-- `role "agent_console" does not exist`.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_console') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE user_settings_legacy_subjects TO agent_console;
  END IF;
END
$$;
