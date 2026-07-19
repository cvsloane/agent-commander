---
lane: W2-CP-ORCH
branch: refactor/wave2-cp-orch
frozen_sha: c7c5ed8f300c74c456738748bfc2db3dbd06fbd3
attempt: 1
gate:
  commands:
    - DATABASE_URL=postgres://test:test@localhost:5432/test JWT_SECRET=test-secret-for-gate pnpm --filter @agent-command/control-plane test
    - pnpm --filter @agent-command/control-plane typecheck
    - pnpm --filter @agent-command/schema test
    - pnpm --filter @agent-command/control-plane lint
    - pnpm --filter @agent-command/schema lint
    - DATABASE_URL=postgres://test:test@localhost:5432/test JWT_SECRET=test-secret-for-gate pnpm verify:launch
  results:
    - "PASS: control-plane — 30 files, 107 tests"
    - "PASS: control-plane TypeScript — tsc --noEmit"
    - "PASS: ac-schema — 5 files, 27 tests"
    - "PASS: scoped control-plane and schema lint (ESLintRC deprecation warning only)"
    - "PASS: launch verifier — schema/control-plane tests, control-plane/dashboard typechecks, and 7 Playwright smoke tests"
assumptions:
  - "Migration 035 is applied before the updated control-plane starts."
  - "Integration service credentials are trusted control-plane callers and may report any automation run by ID; session tokens remain bound to their exact run session."
  - "A 15-second grace period beginning with the first observed terminal/idle state is sufficient for a structured report to beat heuristic completion."
  - "Orchestrator child endpoints intentionally expose direct children only; nested rollups remain available through sessionGraph."
  - "Spawn prompt delivery is a second durable command and is idempotently repaired when the caller supplies an Idempotency-Key."
uncertainties:
  - "Migration 035 and its partial-index conflict behavior were reviewed and covered through repository mocks, but were not applied to a live PostgreSQL instance in this worktree."
  - "Concurrent first-time memory ingestions can each pay for embedding generation before the database arbitrates the idempotent insert."
  - "The session token is returned by the spawn response but is not injected into the child process environment because the current control-plane-to-agentd spawn command has no environment field."
  - "The sibling CLI currently uses its existing launch and general memory endpoints; it does not yet consume the new session-scoped orchestrator spawn/memory routes."
blockers: []
---

# Wave 2 CP-ORCH handoff

## Summary

- Added short-lived session JWTs and a strict route allowlist for session-scoped orchestration and structured run reports.
- Added `/v1/orchestrator` routes for durable cross-host worker spawn with parent/role linkage, direct-child status and rollups, durable child input, session work-item claim/completion, and caller-scoped memory search/write.
- Added structured completion through both `POST /v1/automation-runs/:id/report` and authenticated-host `orchestrator.report` event ingest. Run, wakeup, and claimed-work-item terminal transitions commit atomically; enrichment is retry-safe through migration 035 idempotency keys.
- Demoted idle/session-state completion to a 15-second observation-based fallback so structured reports remain authoritative.
- Added transactional governance approval resume/denial behavior, including original wake context, approved budget grace/host pin preflight overrides, and recovery of work items linked only by `checkout_run_id`.
- Added the service/operator nudge endpoint for sending input to an attached automation runtime, with best-effort auditing after successful delivery.
- Added schema contracts and regression coverage for authentication scope, orchestration APIs, structured report replay, cross-host spoof rejection, governance recovery, memory-ingestion races, host selection overrides, and nudge behavior.
- Fresh-eyes adversarial review is clean above nitpick level after two remediation passes. The reviewer verified host ownership, completion grace, transactional finalization, governance checkout recovery, and the migration-backed ingestion race behavior.

The `frozen_sha` is the final implementation commit; the following handoff-only commit adds this file.
