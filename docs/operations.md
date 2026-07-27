# Operations

This guide covers operational best practices for running Agent Commander.

## Backups

- Back up Postgres regularly.
- Keep the agentd state directory (`storage.state_dir`) on durable storage.

## Monitoring

- Watch `/ready` for control plane serving status (503 when Postgres is unreachable).
- Watch `/health` for liveness only; it stays 200 during dependency outages by design.
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
- For releases that change the live agent protocol, upgrade the control plane before
  agentd; roll back agentd before rolling back the control plane. In particular,
  control planes that support unsequenced `terminal.navigation_result` messages must
  be live before an agentd version that emits them.
- Upgrade agentd with the same release after the control plane is healthy to keep the
  fleet schema in sync.

## Secrets

- Rotate host tokens if a host is compromised.
- Rotate `JWT_SECRET` and `NEXTAUTH_SECRET` on a schedule.

## DNS and TLS

- If using Cloudflare, set SSL/TLS to Full (strict).
- Ensure WebSockets are enabled (default on Cloudflare).
- Use proxied records for `app` and `api` unless you have a reason not to.
