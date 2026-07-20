# Wave 1 Lane CP-CORE Brief — Control-Plane Connection Hardening + Command Outbox

You are the CP-CORE Builder lane of the agent-command massive refactor (Wave 1). Read first:
- `tasks/2026-07-19-massive-refactor-master-plan.md` (program, coordination rules)
- `tasks/2026-07-19-subsystem-study-findings.md` §2 (defect list with file:line refs)

## Ground rules
- Work ONLY in your worktree `/home/cvsloane/dev/wt/ac-w1-cp` on branch `refactor/wave1-cp`. Commit early/often, conventional messages. Do NOT push; the AI Lead integrates from your local branch.
- Ownership (do not touch anything else): `services/control-plane/**`, `migrations/031_command_outbox.sql` (new), `packages/ac-schema/**` (ADDITIVE exports only). Do NOT touch `src/services/automation.ts` or `src/db/automationMemory.ts` (another lane owns them) except the single `isAgentConnected` call-site noted below — skip it if it risks conflict and note it in your handoff instead.
- Wire protocol stays backward-compatible: agentd on hosts is NOT updated in lockstep. Additive only.
- Every behavior change ships with vitest coverage in the same commit series (follow existing patterns in `services/control-plane/tests/`).

## Part A — WS/connection hardening (do first)
1. Server-side heartbeat: ws ping/pong + liveness timeout on all three WS endpoints (`src/ws/agent.ts`, `src/ws/ui.ts`, `src/routes/terminal.ts`). Terminate dead sockets and clean registry entries.
2. Fix reconnect race `src/ws/agent.ts:63-68`: remove the agent connection entry only if it still points at THIS socket (identity compare in the pubsub registry).
3. Stop acking failed writes (`src/ws/agent.ts:~173-180, 471-473`): handler failure ⇒ error ack (or no ack) so agentd's queue redelivers; add log + Prometheus counter; confirm redelivery is idempotent-safe (events unique key, upserts naturally idempotent).
4. Unified presence: new `src/services/hostPresence.ts` (`isHostOnline(hostId)`, `getHostPresence()`) = WS-connected + heartbeat-fresh; use it in `src/routes/launch.ts:20-25` and the hosts route; emit a `hosts.changed` UI-stream message from add/removeAgentConnection (`src/services/pubsub.ts:110-116`) — add the message type to ac-schema ADDITIVELY if missing.
5. Batch/debounce per-message `updateHostLastSeen`/`updateHostAckedSeq` (`src/ws/agent.ts:248-254`): flush ≤ every 5s per host + on disconnect.

## Part B — durable command outbox + idempotency (after Part A)
6. New migration `migrations/031_command_outbox.sql`: `commands` table — cmd_id uuid PK, host_id FK, session_id nullable, type text, payload jsonb, class text CHECK (durable/volatile), status text CHECK (queued/sent/completed/failed/expired), created_at/sent_at/completed_at, expires_at, result jsonb, error jsonb, idempotency_key text, partial unique (host_id, idempotency_key) WHERE idempotency_key IS NOT NULL. Match existing migration style.
7. New `src/db/commandOutbox.ts` repository (do NOT extend db/index.ts): enqueue, markSent/completed/failed, listDeliverable(host), expireStale.
8. Rework `src/services/commandRouter.ts` to persist through the outbox, preserving the `dispatchAndWait` API: interactive/terminal-adjacent commands stay volatile (fail fast when host offline — current behavior); spawn/kill/adopt/fork/automation dispatches become durable — host offline ⇒ queue with TTL, deliver in order on agent hello (surgical hook), correlate `commands.result` ⇒ outbox completion. Absorb the parallel pending map in `src/routes/mcp.ts` into the router.
9. Idempotency-Key support on `POST /v1/sessions/spawn`, `POST /v1/launch`, approval decide: same key ⇒ return original result, no double dispatch.
10. Offline approval decide (`src/routes/approvals.ts:82-84`): queue the decision as a durable command (expiring at the approval timeout) instead of failing.

## Gate (must pass before freezing)
```bash
cd /home/cvsloane/dev/wt/ac-w1-cp
pnpm --filter @agent-command/schema test
pnpm --filter @agent-command/control-plane test
pnpm --filter @agent-command/control-plane typecheck
```

## Handoff (required to finish)
Write `tasks/massive-refactor-handoffs/w1-cp-core.md` in your worktree, commit it. YAML frontmatter: `lane, branch, frozen_sha, attempt, gate: {commands, results}, assumptions: [], uncertainties: [], blockers: []`, then a short markdown summary of changes. End your final message with the completion token: `W1-CP-CORE FROZEN <sha>`.
