# Wave 1 Lane AUTOMATION Brief — Scheduler Reliability for a 2-Host Fleet

You are the AUTOMATION Builder lane of the agent-command massive refactor (Wave 1). Read first:
- `tasks/2026-07-19-massive-refactor-master-plan.md`
- `tasks/2026-07-19-subsystem-study-findings.md` §2 items 6,10,11 and the "Automation lifecycle (as-built)" section

## Ground rules
- Work ONLY in your worktree `/home/cvsloane/dev/wt/ac-w1-auto` on branch `refactor/wave1-automation`. Commit early/often. Do NOT push; the AI Lead integrates.
- Ownership: `services/control-plane/src/services/automation.ts`, `services/control-plane/src/db/automationMemory.ts`, NEW test files `services/control-plane/tests/automation*.test.ts`. Nothing else. (Another lane owns ws/pubsub/routes/commandRouter/migrations.)
- Host presence: keep using `pubsub.isAgentConnected` via a tiny local wrapper `function hostIsOnline(hostId)` inside automation.ts — a sibling lane is introducing `services/hostPresence.ts`; the AI Lead reconciles at merge. Note it in your handoff.
- This subsystem has ZERO tests today. Tests are the core deliverable, not an afterthought. If testability requires a thin injectable seam, add the smallest one possible (no big refactor).

## Tasks
1. Host selection (`automation.ts:398-412`): replace the `ambiguous_host_selection` hard-error with deterministic preference: fixed_host → repo affinity (`repos.last_host_id`) → fewest active runs → stable name order. Create a `host_selection` governance approval ONLY when the agent's policy explicitly opts in (new optional policy flag, default off).
2. `queued_until_host_online`: when the selected/required host is offline, do not block the run — requeue the wakeup with backoff + a run event noting the wait, up to a TTL, after which it blocks as today.
3. Crash reapers, on service start AND periodically in the tick: (a) wakeups stuck `running` beyond a threshold ⇒ requeue (bounded retries then failed + run event); (b) runs stuck `starting` with no session_id beyond a threshold ⇒ failed + wakeup requeued once. (`syncActiveRuns` currently skips session-less runs — automation.ts:1244.)
4. De-serialize wakeup processing: move per-wakeup spawn + up-to-30s readiness wait + memory bootstrap off the serial 5s tick into concurrency-capped (≈3) fire-and-forget tasks so one slow host cannot stall claiming/finalization/reconciliation (`automation.ts:1194-1201, 1394-1435`). Keep advisory-lock semantics for schedule enqueue.
5. Tests: table-driven vitest for host-selection order, offline⇒queued behavior + TTL, both reapers, concurrency-capped processing. Mock the db layer per existing test patterns in `services/control-plane/tests/`.

## Gate
```bash
cd /home/cvsloane/dev/wt/ac-w1-auto
pnpm --filter @agent-command/control-plane test
pnpm --filter @agent-command/control-plane typecheck
```

## Handoff
Write `tasks/massive-refactor-handoffs/w1-automation.md` in your worktree (YAML frontmatter: lane, branch, frozen_sha, attempt, gate results, assumptions, uncertainties, blockers; then summary), commit it. End your final message with: `W1-AUTOMATION FROZEN <sha>`.
