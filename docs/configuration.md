# Configuration

Agent Commander uses environment variables for the control plane and dashboard.
Copy the example files and edit the values:

```bash
cp services/control-plane/.env.example services/control-plane/.env
cp apps/dashboard/.env.example apps/dashboard/.env
```

## Control plane

File: `services/control-plane/.env`

Required:

- `DATABASE_URL` - PostgreSQL connection string.
- `JWT_SECRET` - shared secret for control plane JWTs (must match dashboard `CONTROL_PLANE_JWT_SECRET`).

Common:

- `HOST` - bind address (default `0.0.0.0`).
- `PORT` - HTTP port (default `8080`).
- `TAILNET_DOMAIN` - optional, for tailscale hostname display.
- `APP_BASE_URL` - public dashboard origin used for notification and automation deep links.
- `METRICS_TOKEN` - protects `GET /metrics`; clients may send a Bearer token or `x-metrics-token`.

Optional features:

- `OPENAI_API_KEY` - enables orchestrator summaries.
- `OPENAI_MODEL` - model name for summaries (default `gpt-4o-mini`).
- `OPENAI_EMBEDDING_MODEL` - embedding model for memory (default `text-embedding-3-small`).
- `DEEPGRAM_API_KEY` - enables voice transcription WebSocket.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` - all three are required for Web Push. The subject must start with `mailto:` or `https:`.
- `INTEGRATION_SERVICE_TOKENS_JSON` - JSON object of named service credentials used by integration routes. Each entry requires `token` and may set `user_id`, `role`, `name`, or `email`.
- `INTEGRATION_WEBHOOK_SECRET` - HMAC secret for signed integration webhooks (minimum 16 characters).

Example service-token shape (use a real secret outside version control):

```json
{ "hermes": { "token": "replace-with-strong-secret", "role": "operator" } }
```

## Dashboard

File: `apps/dashboard/.env`

Required:

- `NEXTAUTH_URL` - public URL for the dashboard.
- `NEXTAUTH_SECRET` - NextAuth secret.
- `CONTROL_PLANE_JWT_SECRET` - must match control plane `JWT_SECRET`.
- `NEXT_PUBLIC_CONTROL_PLANE_URL` - base URL for REST calls.
- `NEXT_PUBLIC_CONTROL_PLANE_WS_URL` - UI WebSocket URL (example: `ws://localhost:8080/v1/ui/stream`).

Optional:

- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` - GitHub OAuth login.
- `ACCESS_SECRET` - access code login when OAuth is not configured.
- `ADMIN_EMAILS` - comma-separated list of admin emails.
- `ALLOWED_EMAILS` - optional allowlist (comma-separated).
- `AUTH_SESSION_DAYS` - session length in days (default 30).

## Docker deployment

File: `deploy/.env`

Key values:

- `DATABASE_URL`
- `DOMAIN` - base domain (optional)
- `APP_DOMAIN` - dashboard domain
- `API_DOMAIN` - control plane domain
- `JWT_SECRET`, `NEXTAUTH_SECRET`, `CONTROL_PLANE_JWT_SECRET`
- Optional `ACCESS_SECRET`, GitHub OAuth values

See `deploy/.env.example` and `deploy/docker-compose.yml` for the full layout.
The supplied Compose file forwards the core variables listed in that example.
Set optional control-plane variables such as VAPID or integration credentials on
the control-plane service in your deployment platform (or add them to the Compose
service environment explicitly).
