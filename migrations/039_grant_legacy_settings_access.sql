-- The 0.4.x settings-claim path reads/writes user_settings_legacy_subjects.
-- That table was created by a superuser-run migration without granting the
-- application role, causing production PUT /v1/settings to 500
-- ("permission denied") and the dashboard to fall back to local-only settings.
-- Idempotent re-grant; applied manually to production 2026-07-21.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE user_settings_legacy_subjects TO agent_console;
