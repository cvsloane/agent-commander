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

Optional features:
- `OPENAI_API_KEY` - enables orchestrator summaries.
- `OPENAI_MODEL` - model name for summaries (default `gpt-4o-mini`).
- `DEEPGRAM_API_KEY` - enables voice transcription WebSocket.

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
