# Deployment

Agent Commander ships as two services (dashboard + control plane) plus Postgres.
The host agent (agentd) runs separately on each machine you want to manage.

See [Coolify Deployment](deployment-coolify.md) for a production setup with
`app.yourdomain.com` and `api.yourdomain.com` subdomains.

**Example URLs:**
- Production: `app.yourdomain.com`, `api.yourdomain.com`
- Local: `localhost:3000` (dashboard), `localhost:8080` (control plane)

## Docker Compose (quick start)

```bash
cp deploy/.env.example deploy/.env
# edit deploy/.env
cd deploy

docker compose up -d
```

For subdomains, set `APP_DOMAIN` and `API_DOMAIN` in `deploy/.env`.

This starts:
- Control plane (Fastify)
- Dashboard (Next.js)
- PostgreSQL

## Production notes

- Put the dashboard and control plane behind a reverse proxy.
- Ensure WebSocket upgrades are enabled for:
  - `/v1/ui/stream`
  - `/v1/ui/terminal/:sessionId`
  - `/v1/voice/transcribe` (optional)
- Use HTTPS and strong secrets for `JWT_SECRET` and `NEXTAUTH_SECRET`.
- If you change the public domain, update `NEXTAUTH_URL` and the control plane URLs.

## Postgres

For production, run Postgres externally and point `DATABASE_URL` at it.
Apply migrations after updates:

```bash
pnpm db:migrate
```

## agentd deployment

Install agentd on each host and configure `/etc/agentd/config.yaml`.
See [agentd](agentd.md) for full details.
