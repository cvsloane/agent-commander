# W1-R2 Builder Brief — Authoritative Pane Convergence

## Outcome

Correct the single W1 Reviewer blocker without changing the accepted viewport, input, scrollback, font zoom, launch, transport, or backend design.

Frozen inputs:

- Production baseline: `7b30df046208f1a2ba14b8e34b0095afe9888750`
- W1 candidate: `d83e2cb7f203bae7e5a67fd5450efdca574cc943`
- Reviewer handoff: `tasks/2026-07-22-android-terminal-daily-driver-handoffs/w1-shared-terminal-review.md`
- Reviewer finding commit: `e0188e0`
- Worktree: `/home/cvsloane/dev/wt/ac-android-w1-terminal-r2`
- Branch: `fix/android-w1-shared-terminal-r2`
- Machine/runtime: Heavisidelinux, Codex 0.145.0, exact `gpt-5.6-sol`, xhigh

## Required Invariant

Terminal and prompt input may be enabled only when the selected UI descriptor and verified tmux viewer pane/zoom state converge.

Two unsafe paths must close:

1. After acknowledged A→B same-attachment focus, a disconnect/resume on B must reconcile against selected pane B, not the original WebSocket attachment pane A. Preserve the existing WebSocket/xterm instance; do not reattach merely to avoid state reconciliation.
2. A rejected, timed-out, or mismatched focus result must not clear the input fence while the authoritative pane is unknown or differs from the selected pane. Recovery may retry the selected focus or adopt an authoritative UI selection, but input stays fenced until convergence is verified.

## Scope Firewall

Allowed:

- `apps/dashboard/src/components/terminal/PersistentTerminalHost.tsx`
- `apps/dashboard/src/components/terminal/terminalHostStore.ts`
- `apps/dashboard/src/components/terminal/terminalHostStore.test.ts`
- `apps/dashboard/src/components/TerminalView.tsx`
- `apps/dashboard/src/hooks/useTerminalConnection.ts`
- The smallest directly related existing terminal test or `tests/journeys/command-center.journey.spec.ts` / `tests/journeys/controlPlaneMock.ts`
- `tasks/2026-07-22-android-terminal-daily-driver-handoffs/w1-shared-terminal-r2.md`

Forbidden:

- Schema, control plane, agentd, protocol changes, Android, auth, dependencies, deployment, migrations, project control files, new services, alternate transports, renderer changes, layout redesign, and unrelated cleanup.

If the direct UI-state fix genuinely requires a forbidden boundary, stop with the exact evidence. Do not build a retry framework, parallel implementation, or fallback around it.

## Proof Ceiling

- Add or strengthen at most one existing journey for successful A→B→resume convergence.
- Add or strengthen at most one focused store/connection test for the rejected/mismatched result fence.
- Run only the affected focused unit file(s), the applicable desktop journey grep or file, and dashboard typecheck.
- No full repository matrix, stress, repetition loop, new harness, or broader refactor. The AI Lead owns integrated gates.

The tests must fail on the reviewed candidate behavior before the fix and prove that input cannot route to a pane different from the selected descriptor.

## Deliverable

- Frozen code/proof commit on `fix/android-w1-shared-terminal-r2`.
- Canonical Builder handoff at `tasks/2026-07-22-android-terminal-daily-driver-handoffs/w1-shared-terminal-r2.md`, committed separately if required by the schema.
- Clean worktree and final token: `W1-R2 READY <sha>` or `W1-R2 BLOCKED <exact wall>`.
- Do not push, merge, deploy, or mutate production; the AI Lead owns integration and rollout.

