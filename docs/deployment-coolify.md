# Coolify Deployment

This guide deploys Agent Commander on Coolify with Cloudflare DNS.

## Recommended subdomains

**Production:**
- `yourdomain.com` - public feature dive site
- `docs.yourdomain.com` - documentation
- `app.yourdomain.com` - dashboard (keep private if not public)
- `api.yourdomain.com` - control plane (keep private if not public)

**Local development:**
- `localhost:3000` - dashboard
- `localhost:8080` - control plane

If you are not running a public app, only create DNS records for `yourdomain.com`,
`docs.yourdomain.com`, and `www.yourdomain.com` (redirect to apex).

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
- `api.yourdomain.com` (optional, keep private if you are not exposing the API)

Health check:
- `/health`

### 3) Dashboard service (private)
Create a service from this repo using `deploy/Dockerfile.dashboard.base`.

Environment:
- `NEXTAUTH_URL=https://app.yourdomain.com`
- `NEXTAUTH_SECRET` - strong secret
- `CONTROL_PLANE_JWT_SECRET` - must match `JWT_SECRET`
- `NEXT_PUBLIC_CONTROL_PLANE_URL=https://api.yourdomain.com`
- `NEXT_PUBLIC_CONTROL_PLANE_WS_URL=wss://api.yourdomain.com/v1/ui/stream`
- Optional `ACCESS_SECRET` (access code login)
- Optional `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`
- Optional `ADMIN_EMAILS` / `ALLOWED_EMAILS`

Domain:
- `app.yourdomain.com` (optional, keep private if you are not exposing the dashboard)

### 4) GitHub OAuth (optional)
If using GitHub OAuth, set:
- Homepage URL: `https://app.yourdomain.com`
- Callback URL: `https://app.yourdomain.com/api/auth/callback/github`

## Public sites

Create two static services from this repo:\n\n1) **Feature site** (apex)\n- Dockerfile: `deploy/Dockerfile.site`\n- Domain: `yourdomain.com`\n\n2) **Docs site**\n- Dockerfile: `deploy/Dockerfile.docs`\n- Domain: `docs.yourdomain.com`

## Cloudflare DNS

Create A records pointing to your Coolify server IP:

- `yourdomain.com` -> `<server-ip>`
- `docs.yourdomain.com` -> `<server-ip>`
- `www.yourdomain.com` -> `<server-ip>` (redirect to apex)

Recommended Cloudflare settings:
- SSL/TLS mode: Full (strict)
- Always use HTTPS: on
- WebSockets: on (default)
- Proxy status: proxied (orange cloud)

If you want a scripted setup, see `scripts/cloudflare-dns.mjs`.
For `www` redirects, see `scripts/cloudflare-redirect.README.md`.

## Notes

- If you want a public demo later, add `app` and `api` and lock them down with Cloudflare Access.
