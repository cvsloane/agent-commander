# W3-PUSH-BACKEND — Web Push, Server-Side Attention, UI Stream Resume

Read master plan workstream B + findings §2 (mobile gaps), §5 items 7-8. Worktree `/home/cvsloane/dev/wt/ac-w3-push`, branch `refactor/wave3-push-backend`. Ownership: `services/control-plane/**`, `migrations/036_push_subscriptions.sql` (claimed), `packages/ac-schema` additive, tests. No push; wave-1 YAML handoff `tasks/massive-refactor-handoffs/w3-push-backend.md`; token `W3-PUSH-BACKEND FROZEN <sha>`.

1. Migration 036: `push_subscriptions` (user_id, endpoint unique, p256dh, auth, device_label, created/last_seen, failure_count) + notification throttle/dedupe state table (move clawdbot's in-memory throttle to PG).
2. Web-push service (`web-push` npm, VAPID keys via env, document in .env.example): send on approval.requested, waiting_input attention, run blocked/failed, governance approval created, host offline. Deep-link URLs (APP_BASE_URL): `/tmux?host_id&session_id&mode=terminal`, `/orchestrator`. Prune subscriptions on 404/410; failure_count discipline. Subscribe/unsubscribe REST routes (user-scoped).
3. Server-side attention state: port the dashboard DetectionEngine regex semantics (see `apps/dashboard/src/components/orchestrator/DetectionEngine.ts` + `stores/orchestrator.ts` — read-only reference) into a CP service evaluating session snapshots/status on ingest; persist `sessions.attention_reason` (nullable text col — fold into migration 036) + publish additive `attention.changed` UI message; drive push from it (dedupe/throttled).
4. UI stream resume: additive seq cursor on ServerToUI envelope (events have bigserial ids; run events have seq), `ui.subscribe {since}` replays missed messages from PG for events/attention topics + initial snapshot on subscribe; keep full backward compat with current clients.
5. OpenClaw: add deep links to messages, retry w/ backoff, `notifications_log` rows (same 036), wire governance approvals + run failures in.
6. Tests for all (push dispatch mocked, attention detection port fixtures, resume replay, throttle persistence).

Gate: `DATABASE_URL=postgres://test:test@localhost:5432/test JWT_SECRET=test-secret-for-gate pnpm --filter @agent-command/control-plane test && pnpm --filter @agent-command/control-plane typecheck && pnpm --filter @agent-command/schema test` (run bare, check exit codes).
