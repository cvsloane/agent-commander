# Wave 2 Lane W2-CP-ORCH Brief — Orchestrator API, Structured Completion, Governance Resume

Builder lane. Read `tasks/2026-07-19-massive-refactor-master-plan.md` (workstream C), findings §2 items 7-9, and the freshly merged W2-CONTRACTS + W1 outbox code (session graph, agent_tasks, commandRouter/outbox, hostPresence — read current code first).

## Ground rules
- Worktree `/home/cvsloane/dev/wt/ac-w2-orch`, branch `refactor/wave2-cp-orch`. Commit often; no push; AI Lead integrates.
- Ownership: `services/control-plane/**` (routes/automation*, routes/governanceApprovals.ts, new routes/orchestrator.ts, services/automation.ts additive, db/automationMemory.ts additive), `packages/ac-schema` additive, tests. Migration 035 claimed if needed. Wire protocol additive only.

## Tasks
1. **Structured completion**: `POST /v1/automation-runs/:id/report` (service-auth or session-token) setting result_summary/worker_report_json from the agent; accept `orchestrator.report` events (agentd W2 API emits them) in the events ingest → finalize the matching run the same way. Idle-heuristic completion becomes fallback only.
2. **Governance resume**: on approve, create the `approval_resume` wakeup carrying original wake context + override honored by preflight (budget grace / host pin from decision_payload); on deny, cancel the blocked run cleanly. (Schema source exists; no producer today — findings §2 item 7.)
3. **Orchestrator session API** (new routes/orchestrator.ts, session-scoped auth via a short-lived session token minted at spawn, or service auth): spawn worker on any host (through outbox + session_edges parent linkage + role), list own children + rollups (sessionGraph), send_input to child, get child snapshot/status, claim/complete work_items (work_items.session_id), memory search/write scoped to caller. Reuse existing services; thin route layer.
4. **Nudge**: `POST /v1/automation-agents/:slug/message` → send_input into the agent's attached runtime session (reuse path exists in automation.ts); Hermes/service-auth variant included.
5. Tests for all four (existing patterns; automation suites exist now).

## Gate
`cd /home/cvsloane/dev/wt/ac-w2-orch && DATABASE_URL=postgres://test:test@localhost:5432/test JWT_SECRET=test-secret-for-gate pnpm --filter @agent-command/control-plane test && pnpm --filter @agent-command/control-plane typecheck && pnpm --filter @agent-command/schema test`

## Handoff
`tasks/massive-refactor-handoffs/w2-cp-orch.md` (wave-1 YAML schema), commit. Token: `W2-CP-ORCH FROZEN <sha>`.
