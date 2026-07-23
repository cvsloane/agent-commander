---
lane: W4-BACKEND-TERMINATE
branch: feat/android-tmux-parity-w4-backend
frozen_sha: 70ca24e7609da78b4929e1ecb51b250aa3d986e6
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

`POST /v1/sessions/bulk` now treats `operation: "terminate"` as successful only after the existing `commandRouter.dispatchAndWait` path returns a correlated successful `kill_session` result. A rejected dispatch, timeout, or explicit agent failure remains a per-session bulk error and is not counted or archived.

The existing bulk request/result schemas, endpoint, sequential multi-item behavior, audit, and change publication flow are unchanged. Other bulk operations are untouched.

## Changed paths

- `services/control-plane/src/routes/sessions.ts`
- `services/control-plane/tests/bulkTerminateRoute.test.ts`

No Android, dashboard, schema, retry, fallback, harness, deployment, or production file was changed.

## Regression and receipts

The route regression exercises one multi-item request containing:

- a kill held pending to prove no archive occurs before correlated success;
- an agent-declared failure whose exact message is returned and not archived;
- a timeout whose exact message is returned and not archived.

RED:

- `pnpm --filter @agent-command/control-plane test -- bulkTerminateRoute.test.ts`
- Failed as expected because `dispatchAndWait` was never called by the old route: `expected "vi.fn()" to be called once, but got 0 times`.

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

- **PANE-2:** REST acceptance alone no longer archives or counts a terminated session. Only correlated `ok: true` completion does; exact agent or timeout messages stay in the existing per-session error string.
- **REG-1:** Focused route coverage, control-plane typecheck, and control-plane build pass. No shared contract or unrelated route behavior changed.

Fresh-context review and integration remain AI Lead-owned. No true wall was encountered.
