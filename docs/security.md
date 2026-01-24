# Security

This guide covers the security model and hardening tips.

## Authentication

- Dashboard users authenticate via NextAuth (GitHub OAuth or access code).
- The dashboard mints short lived JWTs for the control plane.
- agentd connects with a host scoped token created by an admin.

## Authorization

Role based access control:
- `admin` - host creation and token management.
- `operator` - commands, approvals, and write actions.
- `viewer` - read only access.

## Secrets

- Store secrets in a secret manager in production.
- Rotate `JWT_SECRET`, `NEXTAUTH_SECRET`, and host tokens if exposed.
- Never commit `.env` files or tokens to version control.

## Network

- Place the control plane behind HTTPS.
- Restrict access using a VPN or tailnet if possible.
- Limit inbound access to the control plane to known IP ranges.

## agentd capabilities

agentd exposes powerful controls. Use the config flags to reduce risk:
- `security.allow_send_input`
- `security.allow_kill`
- `security.allow_spawn`
- `security.allow_console_stream`

## Logging and audit

- Approval decisions, group changes, and links are logged in audit tables.
- Consider centralizing logs and enabling database backups.
