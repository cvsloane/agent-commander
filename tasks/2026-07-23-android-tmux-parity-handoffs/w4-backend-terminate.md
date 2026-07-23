---
lane: W4-BACKEND-TERMINATE
branch: feat/android-tmux-parity-w4-backend
frozen_sha: 4ccad1598b00052b7732a3f3b4167d86b30e1423
acceptance:
  - PANE-2
  - REG-1
gate:
  focused_test: passed
  typecheck: passed
  build: passed
blockers: []
---

# W4 backend terminate handoff

## Outcome

`POST /v1/sessions/bulk` now treats `operation: "terminate"` as successful only after the existing `commandRouter.dispatchAndWait` path returns a correlated successful `kill_session` result. Valid kills are dispatched concurrently with an explicit 12-second per-command timeout, safely inside the shortest 15-second client deadline. A rejected dispatch, timeout, or explicit agent failure remains a per-session bulk error and is not counted or archived.

The existing bulk request/result schemas, endpoint, input-order result semantics, audit, and change publication flow are unchanged. Successful IDs are archived once after all kill outcomes settle. Other bulk operations are untouched.

Implementation history:

- Initial truth correction: `70ca24e7609da78b4929e1ecb51b250aa3d986e6`
- Review correction / frozen implementation: `4ccad1598b00052b7732a3f3b4167d86b30e1423`

## Changed paths

- `services/control-plane/src/routes/sessions.ts`
- `services/control-plane/tests/bulkTerminateRoute.test.ts`

No Android, dashboard, schema, retry, fallback, harness, deployment, or production file was changed.

## Regression and receipts

The route regression exercises one multi-item request containing:

- a kill held pending to prove no archive occurs before correlated success;
- an agent-declared failure whose exact message is returned and not archived;
- a timeout whose exact message is returned and not archived.
- all three dispatches observed before the held success resolves, proving independent kills are not serialized;
- an explicit `12_000` timeout on every `dispatchAndWait` call.

RED:

- `pnpm --filter @agent-command/control-plane test -- bulkTerminateRoute.test.ts`
- Failed as expected because `dispatchAndWait` was never called by the old route: `expected "vi.fn()" to be called once, but got 0 times`.
- Review correction RED: failed because the first awaited kill blocked later dispatches: `expected "vi.fn()" to be called 3 times, but got 1 times`.

GREEN:

- `pnpm --filter @agent-command/control-plane test -- bulkTerminateRoute.test.ts`
- PASS: 1 file, 1 test.
- `pnpm --filter @agent-command/control-plane typecheck`
- PASS.
- `pnpm --filter @agent-command/control-plane build`
- PASS.
- `git diff --check`
- PASS before the implementation freeze.

The clean worktree initially had no installed dependencies, so the first command stopped at `tsc: not found`. `pnpm install --frozen-lockfile` restored the lockfile-defined workspace dependencies with zero downloads; the same focused test then produced the RED receipt above.

## Acceptance mapping

- **PANE-2:** REST acceptance alone no longer archives or counts a terminated session. Independent valid kills start concurrently and wait at most 12 seconds each; only correlated `ok: true` completion does, while exact agent or timeout messages stay in the existing per-session error string in request order.
- **REG-1:** Focused route coverage, control-plane typecheck, and control-plane build pass. No shared contract or unrelated route behavior changed.

Fresh-context review and integration remain AI Lead-owned. No true wall was encountered.
