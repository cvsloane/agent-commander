# Coolify Deployment

This guide deploys Agent Commander on Coolify with Cloudflare DNS.

## Recommended subdomains

- `agentcommander.co` - documentation (or redirect to docs)
- `docs.agentcommander.co` - documentation
- `app.agentcommander.co` - dashboard (keep private if not public)
- `api.agentcommander.co` - control plane (keep private if not public)

If you are not running a public app, only create DNS records for `agentcommander.co`
and `docs.agentcommander.co`.

## Coolify setup

### 1) Create a project
Create a new project in Coolify and attach a Postgres database.

### 2) Control plane service (private)
Create a service from this repo using `deploy/Dockerfile.control-plane.base`.

Environment:
- `DATABASE_URL` - from Coolify Postgres
- `JWT_SECRET` - strong secret
- `HOST=0.0.0.0`
- `PORT=8080`
- Optional `OPENAI_API_KEY`, `OPENAI_MODEL`
- Optional `DEEPGRAM_API_KEY`

Domain:
- `api.agentcommander.co` (optional, keep private if you are not exposing the API)

Health check:
- `/health`

### 3) Dashboard service (private)
Create a service from this repo using `deploy/Dockerfile.dashboard.base`.

Environment:
- `NEXTAUTH_URL=https://app.agentcommander.co`
- `NEXTAUTH_SECRET` - strong secret
- `CONTROL_PLANE_JWT_SECRET` - must match `JWT_SECRET`
- `NEXT_PUBLIC_CONTROL_PLANE_URL=https://api.agentcommander.co`
- `NEXT_PUBLIC_CONTROL_PLANE_WS_URL=wss://api.agentcommander.co/v1/ui/stream`
- Optional `ACCESS_SECRET` (access code login)
- Optional `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`
- Optional `ADMIN_EMAILS` / `ALLOWED_EMAILS`

Domain:
- `app.agentcommander.co` (optional, keep private if you are not exposing the dashboard)

### 4) GitHub OAuth (optional)
If using GitHub OAuth, set:
- Homepage URL: `https://app.agentcommander.co`
- Callback URL: `https://app.agentcommander.co/api/auth/callback/github`

## Docs site (public)

Create a simple public docs service from this repo using `deploy/Dockerfile.docs`.
Bind it to `agentcommander.co` and/or `docs.agentcommander.co`.

## Cloudflare DNS

Create A records pointing to your Coolify server IP:

- `agentcommander.co` -> `<server-ip>`
- `docs.agentcommander.co` -> `<server-ip>` (optional)
- `www.agentcommander.co` -> `<server-ip>` (optional)

Recommended Cloudflare settings:
- SSL/TLS mode: Full (strict)
- Always use HTTPS: on
- WebSockets: on (default)
- Proxy status: proxied (orange cloud)

If you want a scripted setup, see `scripts/cloudflare-dns.mjs`.

## Notes

- If you want a public demo later, add `app` and `api` and lock them down with Cloudflare Access.
