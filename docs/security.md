# Security

This guide describes the control plane and dashboard security model.

## Authentication

- Dashboard users authenticate via NextAuth (GitHub OAuth or access code).
- The dashboard mints short-lived JWTs for control-plane REST requests.
- GitHub OAuth is denied unless `ALLOWED_EMAILS` contains the account email. An empty allowlist denies every OAuth sign-in.
- Access codes are compared with a timing-safe digest check. Failed attempts are limited per source address by `ACCESS_CODE_MAX_ATTEMPTS` (default `5`) during `ACCESS_CODE_WINDOW_SECONDS` (default `300`).
- agentd connects with an admin-created, host-scoped bearer token.

## Authorization

Role-based access control:
- `admin` - host creation and token management.
- `operator` - commands, approvals, and write actions.
- `viewer` - read only access.

Authenticated users default to `viewer`. Put the owner email in `ADMIN_EMAILS` to retain admin/operator capabilities. For GitHub sign-in, put that email in `ALLOWED_EMAILS` as well.

## Browser WebSockets

Browser clients exchange their JWT with `POST /v1/auth/ws-ticket`, then connect to the UI, terminal, or voice WebSocket with `?ticket=<ticket>`. Tickets expire after `WS_TICKET_TTL_SECONDS` (default `30`, maximum `300`) and are deleted on first redemption.

Legacy `?token=<jwt>` WebSocket authentication remains temporarily compatible and emits a server deprecation warning. New clients must not put reusable JWTs in WebSocket URLs.

Every browser WebSocket upgrade must have either the same Origin as the request host or an Origin in `APP_BASE_URL` / `WS_ALLOWED_ORIGINS`. Originless UI, terminal, and voice upgrades are rejected. The agent stream is the exception: originless `/v1/agent/connect` upgrades are allowed only when they carry the host bearer header that agentd uses.

## Secrets

- Store secrets in a secret manager in production.
- Rotate `JWT_SECRET`, `NEXTAUTH_SECRET`, and host tokens if exposed.
- Never commit `.env` files or tokens to version control.

## Network

- Place the control plane behind HTTPS.
- Restrict access using a VPN or tailnet if possible.
- Limit inbound access to the control plane to known IP ranges.
- Set `APP_BASE_URL` to the exact dashboard origin in production. It restricts CORS to that origin; leaving it unset retains reflective CORS for development and emits a startup warning.
- REST endpoints are globally rate-limited by `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS`. `/health` and WebSocket upgrades are exempt from the HTTP limiter; WebSockets have their own authentication and Origin checks.

### Tailscale-direct agentd connection

Prefer a tailnet route over the public Cloudflare route for host agents. Set agentd's `control_plane.ws_url` to a control-plane endpoint reachable directly on Tailscale, for example:

```yaml
control_plane:
  ws_url: "wss://apps-vps.<tailnet>.ts.net/v1/agent/connect"
```

That hostname must actually terminate TLS and route to the control-plane listener, such as through Tailscale Serve or a reverse proxy bound to the tailnet. A raw `ws://100.x.y.z:8080/v1/agent/connect` URL is acceptable only when port `8080` is explicitly exposed on the tailnet and never to the public internet. Changing the URL is an operations cutover; verify `/health` through the selected tailnet path before restarting agentd.

## agentd capabilities

agentd exposes powerful controls. Use the config flags to reduce risk:
- `security.allow_send_input`
- `security.allow_kill`
- `security.allow_spawn`
- `security.allow_console_stream`

## Logging and audit

- Approval decisions, group changes, links, and terminal lifecycle actions are persisted in `audit_log`.
- Terminal attach, control-grant, and detach rows include the acting user, session, host, pane/channel, source, and elapsed connection duration. agentd-originated `terminal.audit` events are also persisted on ingest.
- Admins can read recent rows through `GET /v1/audit` with optional `limit`, `offset`, `action`, and `object_type` query parameters.
- Consider centralizing logs and enabling database backups.
