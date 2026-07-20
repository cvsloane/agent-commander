# W5-SECURITY — Secure Defaults, Rate Limits, WS Tickets, Terminal Audit

Read master plan workstream E + findings §5 items 2-4. Worktree `/home/cvsloane/dev/wt/ac-w5-sec`, branch `refactor/wave5-security`. Ownership: `services/control-plane/**`, `apps/dashboard/src/lib/auth.ts` + `src/app/api/control-plane-token/**` + WS URL/ticket client touchpoints, `docs/security.md`, tests. No push; handoff `tasks/massive-refactor-handoffs/w5-security.md`; token `W5-SECURITY FROZEN <sha>`.

1. Auth defaults: default role `viewer` (auth.ts:19-22); REFUSE GitHub OAuth sign-in when ALLOWED_EMAILS is empty (auth.ts:79-84); timing-safe ACCESS_SECRET compare + in-route attempt throttling. Keep single-owner UX working (owner email in ADMIN_EMAILS retains admin/operator).
2. `@fastify/rate-limit` global (sane defaults, exempt /health, WS upgrade paths configured correctly); CORS: restrict to APP_BASE_URL origin when set (fallback: current behavior + startup warning); Origin check on all WS upgrades (same origin or configured allowlist; agentd connects with no Origin — allow originless bearer-auth agent path).
3. WS ticket auth: `POST /v1/auth/ws-ticket` (JWT-authed) → short-lived one-time ticket; ui/terminal/voice WS accept `?ticket=`; keep `?token=` working with a deprecation log line. Update dashboard clients to use tickets.
4. Terminal audit: persist audit_log rows on attach/control-grant/detach at the terminal route (who/session/host/duration); agentd terminal.audit events (already flowing) persisted to audit_log on ingest; add `GET /v1/audit` (admin) so audit_log finally has a reader.
5. Update docs/security.md to reality (incl. Tailscale-direct agentd URL guidance) and .env.example entries.
6. Tests: role defaults, OAuth refusal, ticket mint/expiry/single-use, rate-limit 429, origin rejection, audit rows.

Gate (bare exit codes): `DATABASE_URL=postgres://test:test@localhost:5432/test JWT_SECRET=test-secret-for-gate pnpm --filter @agent-command/control-plane test && pnpm --filter @agent-command/dashboard test && pnpm typecheck && pnpm test:smoke:dashboard`
