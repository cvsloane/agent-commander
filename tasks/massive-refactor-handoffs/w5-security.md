---
lane: W5-SECURITY
branch: refactor/wave5-security
frozen_sha: 7efddc27e23b997607563dab6b69443803aa1e3b
attempt: 1
gate:
  commands:
    - DATABASE_URL=postgres://test:test@localhost:5432/test JWT_SECRET=test-secret-for-gate pnpm --filter @agent-command/control-plane test
    - pnpm --filter @agent-command/dashboard test
    - pnpm typecheck
    - pnpm test:smoke:dashboard
  results:
    - command: pnpm --filter @agent-command/control-plane test
      status: passed
      detail: 43 files and 150 tests passed, including role/JWT verification, rate-limit 429s, browser and agent Origin rejection, ticket mint/expiry/single-use, terminal lifecycle audits, agentd audit ingest, and the admin audit reader.
    - command: pnpm --filter @agent-command/dashboard test
      status: passed
      detail: 14 files and 72 tests passed, including viewer defaults, stale-operator downgrade, OAuth refusal, access-code throttling, one-time ticket exchange, and ticket-based terminal/voice/event URL construction.
    - command: pnpm typecheck
      status: passed
      detail: All five Turbo tasks passed across schema build/typecheck, CLI, control plane, and dashboard.
    - command: pnpm test:smoke:dashboard
      status: passed
      detail: All 10 Chromium dashboard smoke scenarios passed; the harness now mocks the ticket exchange and ticket-authenticated event stream without reconnect noise.
assumptions:
  - The control plane remains a single running process, matching the current deployment model. One-time WS tickets and the default rate-limit store are process-local; a future multi-replica deployment must move both to a shared atomic store or add sticky routing.
  - `APP_BASE_URL` is the exact public dashboard origin in production. Additional legitimate browser origins are explicitly listed in `WS_ALLOWED_ORIGINS`.
  - agentd's current originless bearer-header connection is the only originless WebSocket path; browser UI, terminal, and voice upgrades always send Origin.
uncertainties:
  - The Tailscale-direct agentd URL is documented but not cut over. Operations must expose a tailnet-reachable listener/TLS route, verify `/health`, update agentd config, and restart agentd separately.
  - Legacy `?token=` WebSocket authentication remains intentionally compatible with a deprecation warning; its removal belongs to a later compatibility-breaking release after deployed clients are confirmed upgraded.
  - Scoped lint passed with no errors; three pre-existing `MobileLaunchSheet.tsx` React hook dependency warnings remain outside this lane.
blockers: []
---

# Wave 5 SECURITY handoff

## Summary

- Changed the dashboard's default authenticated role to `viewer`, recalculating roles on every JWT callback so stale operator sessions are downgraded. `ADMIN_EMAILS` still grants the owner admin/operator controls, while empty `ALLOWED_EMAILS` now denies every GitHub OAuth sign-in.
- Replaced plain access-code equality with timing-safe SHA-256 digest comparison and bounded per-source failure throttling. Added environment controls and capped in-memory source tracking.
- Added Fastify-wide REST rate limiting with sane defaults, explicit `/health` and WebSocket-route exemptions, APP_BASE_URL-restricted CORS, and a startup warning for the reflective development fallback.
- Enforced browser WebSocket Origin checks across UI, terminal, and voice, plus the agent route. Originless bearer-authenticated agentd remains supported; forged forwarded-host headers do not influence same-origin decisions.
- Added JWT-authenticated `POST /v1/auth/ws-ticket` with short-lived, cryptographically random, one-time tickets. Dashboard event, terminal, and voice clients now mint tickets; `?token=` remains compatible and logs a deprecation warning.
- Added user-attributed terminal attach, confirmed control-grant, and detach audit rows with session, host, pane/channel, source, reason, and duration context. Confirmed agentd `terminal.audit` events remain durably ingested.
- Added admin-only `GET /v1/audit` with bounded pagination and optional action/object filters, finally exposing `audit_log` through a supported reader.
- Updated control-plane/dashboard/deploy environment examples, deployment wiring, and `docs/security.md`, including requirements for a safe Tailscale-direct agentd cutover.
- Completed a separate fresh-eyes review. It caught and fixed Upgrade-header rate-limit bypass, forged forwarded-origin trust, request-vs-grant audit semantics, stale operator JWTs, and smoke-harness ticket drift before freeze.

The `frozen_sha` is the final implementation commit; the following handoff-only commit adds this file.

W5-SECURITY FROZEN 7efddc27e23b997607563dab6b69443803aa1e3b
