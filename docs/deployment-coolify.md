# Coolify Deployment

This guide deploys Agent Commander on Coolify with Cloudflare DNS.

## Recommended subdomains

- `agentcommander.co` - marketing or redirect
- `app.agentcommander.co` - dashboard
- `api.agentcommander.co` - control plane
- `docs.agentcommander.co` - optional docs site

You can use fewer domains by pointing `app` and `api` to the same host.

## Coolify setup

### 1) Create a project
Create a new project in Coolify and attach a Postgres database.

### 2) Control plane service
Create a service from this repo using `deploy/Dockerfile.control-plane.base`.

Environment:
- `DATABASE_URL` - from Coolify Postgres
- `JWT_SECRET` - strong secret
- `HOST=0.0.0.0`
- `PORT=8080`
- Optional `OPENAI_API_KEY`, `OPENAI_MODEL`
- Optional `DEEPGRAM_API_KEY`

Domain:
- `api.agentcommander.co`

Health check:
- `/health`

### 3) Dashboard service
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
- `app.agentcommander.co`

### 4) GitHub OAuth (optional)
If using GitHub OAuth, set:
- Homepage URL: `https://app.agentcommander.co`
- Callback URL: `https://app.agentcommander.co/api/auth/callback/github`

## Cloudflare DNS

Create A records pointing to your Coolify server IP:

- `agentcommander.co` -> `<server-ip>`
- `app.agentcommander.co` -> `<server-ip>`
- `api.agentcommander.co` -> `<server-ip>`
- `docs.agentcommander.co` -> `<server-ip>` (optional)

Recommended Cloudflare settings:
- SSL/TLS mode: Full (strict)
- Always use HTTPS: on
- WebSockets: on (default)
- Proxy status: proxied (orange cloud)

If you want a scripted setup, see `scripts/cloudflare-dns.mjs`.

## Notes

- If you want a docs site, deploy a static docs service on Coolify and bind `docs.agentcommander.co`.
- If you prefer a single domain, set both app and api to the same host and route by path.
