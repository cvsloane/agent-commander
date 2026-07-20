# Deployment

Agent Commander ships as two application services (dashboard + control plane) and
requires Postgres. The host agent (agentd) runs separately on each machine you
want to manage.

See [Coolify Deployment](deployment-coolify.md) for a production setup with
`app.yourdomain.com` and `api.yourdomain.com` subdomains.

**Example URLs:**

- Production: `app.yourdomain.com`, `api.yourdomain.com`
- Local: `localhost:3000` (dashboard), `localhost:8080` (control plane)

## Docker Compose (quick start)

```bash
cp deploy/.env.example deploy/.env
# edit deploy/.env
docker compose --project-directory . --env-file deploy/.env -f deploy/docker-compose.yml up -d
```

Set `DATABASE_URL` to a reachable Postgres instance. For subdomains, set
`APP_DOMAIN` and `API_DOMAIN` in `deploy/.env`.

This starts:

- Control plane (Fastify)
- Dashboard (Next.js)

The supplied Compose file does **not** provision PostgreSQL.

## Production notes

- Put the dashboard and control plane behind a reverse proxy.
- Ensure WebSocket upgrades are enabled for:
  - `/v1/ui/stream`
  - `/v1/ui/terminal/:sessionId`
  - `/v1/voice/transcribe` (optional)
- Use HTTPS and strong secrets for `JWT_SECRET` and `NEXTAUTH_SECRET`.
- If you change the public domain, update `NEXTAUTH_URL` and the control plane URLs.

## Postgres

Run Postgres externally and point `DATABASE_URL` at it. This is required for
both the Compose quick start and production deployments.
Apply migrations after updates:

```bash
pnpm db:migrate
```

## agentd deployment

Install agentd on each host and configure `/etc/agentd/config.yaml`.
See [agentd](agentd.md) for full details.
