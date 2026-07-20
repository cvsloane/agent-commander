---
lane: W3-PUSH-BACKEND
branch: refactor/wave3-push-backend
frozen_sha: d2136a6802662c3e107d4c957345cd00837587fb
attempt: 1
gate:
  commands:
    - DATABASE_URL=postgres://test:test@localhost:5432/test JWT_SECRET=test-secret-for-gate pnpm --filter @agent-command/control-plane test
    - pnpm --filter @agent-command/control-plane typecheck
    - pnpm --filter @agent-command/schema test
    - pnpm --filter @agent-command/control-plane lint
    - pnpm --filter @agent-command/schema lint
    - DATABASE_URL=postgres://test:test@localhost:55436/test JWT_SECRET=test-secret-for-gate pnpm --filter @agent-command/control-plane db:migrate
  results:
    - "PASS: control-plane — 40 files, 132 tests"
    - "PASS: control-plane TypeScript — tsc --noEmit"
    - "PASS: ac-schema — 6 files, 30 tests"
    - "PASS: scoped control-plane and schema lint (ESLintRC deprecation warning only)"
    - "PASS: migrations 001-036 on disposable PostgreSQL 16; push_subscriptions, notification_delivery_state, notifications_log, and sessions.attention_reason verified"
assumptions:
  - "Migration 036 is applied before the updated control-plane starts."
  - "APP_BASE_URL plus VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT are configured to enable deep-linked Web Push delivery; missing notification configuration leaves existing control-plane behavior operational."
  - "The persisted settings key and channel selector remain clawdbot for backward compatibility, while all user-facing integration copy uses OpenClaw."
  - "A numeric ui.subscribe payload.since remains backward-compatible and applies to every replayable topic; clients combining event IDs with per-run sequences should use the additive per-topic since map."
uncertainties:
  - "Web Push and OpenClaw HTTP delivery were verified with mocked vendor boundaries, including retry, 404/410 pruning, and failure accounting; no live device or OpenClaw endpoint was contacted."
  - "The sibling W3-PWA lane owns browser/service-worker integration. This lane supports its current /v1/push/subscriptions flat-payload contract plus the browser-native /v1/push-subscriptions nested-key contract."
blockers: []
---

# Wave 3 PUSH-BACKEND handoff

## Summary

- Added migration 036 with user-owned push subscriptions, persistent notification reservations/backoff/dedupe, delivery logs, and nullable session attention state.
- Added VAPID-configured Web Push, safe subscription REST routes, deep-linked payloads, transient retry/backoff, success/failure accounting, and automatic 404/410 subscription pruning.
- Replaced OpenClaw's in-memory throttle/dedupe maps with PostgreSQL state, added retry/backoff and delivery logging, preserved legacy settings keys, and added deep links.
- Ported the dashboard DetectionEngine regex semantics into the control plane, evaluates session status and snapshots on ingest, persists transitions atomically with attention events, and publishes additive attention.changed messages.
- Wired approval requests, waiting-input attention, failed/blocked automation runs, governance approval creation, and host-offline transitions into the unified dispatcher.
- Added optional ServerToUI sequence cursors, event/attention/run-event replay from PostgreSQL, numeric and per-topic ui.subscribe since cursors, and one-time filtered initial session/snapshot/attention state.
- Added 25 control-plane tests and 3 schema tests covering vendor dispatch, persistent throttle behavior, attention fixtures/transitions, source wiring, user-scoped routes, cursor replay, and WebSocket resume behavior.

The `frozen_sha` is the final implementation commit; the following handoff-only commit adds this file.
