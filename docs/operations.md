# Operations

This guide covers operational best practices for running Agent Commander.

## Backups

- Back up Postgres regularly.
- Keep the agentd state directory (`storage.state_dir`) on durable storage.

## Monitoring

- Watch `/health` for control plane status.
- Scrape `/metrics` for operational counters (reconnect/backoff, OpenClaw rate-limit decisions). If `METRICS_TOKEN` is set on the control plane, Prometheus must send `Authorization: Bearer <token>` (or `x-metrics-token`).
- Monitor database connections and disk usage.
- Track agentd logs for reconnect loops or tmux errors.

## Scaling

- Run one control-plane replica. Active agent/UI sockets, terminal channels,
  command routing, and notification delivery state include process-local ownership.
- PostgreSQL advisory locks prevent duplicate scheduler claims, but they do not
  coordinate those process-local registries. A shared database and sticky WebSocket
  sessions are not sufficient for safe horizontal scaling today.

## Upgrades

- Run database migrations before restarting services.
- Upgrade the dashboard and control plane together when possible.
- Upgrade agentd with the same release to keep schema in sync.

## Secrets

- Rotate host tokens if a host is compromised.
- Rotate `JWT_SECRET` and `NEXTAUTH_SECRET` on a schedule.

## DNS and TLS

- If using Cloudflare, set SSL/TLS to Full (strict).
- Ensure WebSockets are enabled (default on Cloudflare).
- Use proxied records for `app` and `api` unless you have a reason not to.
