# Operations

This guide covers operational best practices for running Agent Commander.

## Backups

- Back up Postgres regularly.
- Keep the agentd state directory (`storage.state_dir`) on durable storage.

## Monitoring

- Watch `/health` for control plane status.
- Monitor database connections and disk usage.
- Track agentd logs for reconnect loops or tmux errors.

## Scaling

- The control plane is stateless and can be scaled horizontally if it shares the same Postgres.
- Keep WebSocket sticky sessions if you have multiple instances.

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
