# W1 Builder Brief — Shared Terminal Repair

## Outcome

Produce the smallest reviewed candidate that fixes the existing Agent Command web terminal enough to satisfy `WEB-1` through `WEB-4` in `tasks/2026-07-22-android-terminal-daily-driver-acceptance-checklist.md`, while preserving `WEB-5`.

Production evidence already captured by the AI Lead:

- The live dashboard/control-plane containers run production commit `7b30df046208f1a2ba14b8e34b0095afe9888750`.
- Several laptop terminal WebSocket attaches negotiated `110x1` or `110x9` dimensions.
- The control plane reported successful terminal attachment, and heavisidelinux agentd reported successful PTY attachment for the same channels.
- Direct Termius SSH into the same machine/tmux environment has good scrollback.
- This base includes the newer transactional pane-focus work, but it has not yet been deployed.

The first feedback loop must reproduce the unusable viewport through an existing dashboard/Playwright path or a direct inspection of that real layout path. Do not proceed from source speculation alone.

## Kill / Non-Goals

- No Android code, native renderer, direct SSH transport, protocol v2, sequence/replay system, retry layer, alternate terminal implementation, new service, or new dependency.
- No broad terminal UX redesign, cleanup refactor, performance project, notification work, or session-launch rewrite.
- No new smoke harness, fixture family, stress matrix, soak test, or synthetic fallback built because reproduction is difficult.
- Do not deploy, push, merge, rotate credentials, or mutate production from this Builder lane. The AI Lead owns integration and rollout.

## Keep

- Existing xterm terminal, persistent host, shared schema, control-plane/agentd broker, grouped tmux viewer, public WSS path, launch flow, and transactional focus protocol.
- Existing tests and Playwright journey infrastructure.

## Deliverable

- A frozen commit on `fix/android-w1-shared-terminal` containing only the reproduced direct fix and its narrow regression proof.
- A Builder handoff at `tasks/2026-07-22-android-terminal-daily-driver-handoffs/w1-shared-terminal.md` using the canonical YAML-plus-Markdown schema.
- Final pane output token: `W1 READY <sha>` or `W1 BLOCKED <exact wall>`.

## Assignment Tuple

- Repo: `/home/cvsloane/dev/agent-command`
- Authoritative base: the W1 launch commit supplied by the AI Lead
- Worktree: `/home/cvsloane/dev/wt/ac-android-w1-terminal`
- Branch: `fix/android-w1-shared-terminal`
- Machine: `heavisidelinux`
- Runtime/model: OpenAI Codex CLI 0.145.0, exact model `gpt-5.6-sol`, reasoning `xhigh`
- Launch: `codex exec -m gpt-5.6-sol -c model_reasoning_effort="xhigh" -s danger-full-access --ephemeral -C /home/cvsloane/dev/wt/ac-android-w1-terminal "Read tasks/2026-07-22-android-w1-shared-terminal-brief.md and execute it exactly."`
- Minimum reserve: HOLD if the UI reports 15% or less quota remaining
- Fallback: same model/xhigh through homelinux login shell; then HOLD
- Handoff trigger: no progress for 60 minutes, three repeated failures, or direct-fix wall

## Ownership Firewall

Allowed primary paths:

- `apps/dashboard/src/components/terminal/**`
- `apps/dashboard/src/hooks/useXtermTerminal.ts`
- `apps/dashboard/src/hooks/useTerminalConnection.ts`
- The smallest directly related dashboard/tmux component or existing journey file required by the reproduced cause
- `tasks/2026-07-22-android-terminal-daily-driver-handoffs/w1-shared-terminal.md`

Conditionally allowed only if evidence proves the defect crosses the boundary:

- `packages/ac-schema/src/terminal.ts` and its existing tests/fixtures
- `services/control-plane/src/routes/terminal.ts` and its existing test
- `agents/agentd/internal/tmux/**` and directly related existing tests

Forbidden:

- Android paths, deployment files, migrations, auth/credentials, unrelated dashboard surfaces, package dependency manifests, project plan/checklist/status/log/metrics, and production state.

If a forbidden/shared path is genuinely required, stop and hand the exact evidence to the AI Lead; do not expand ownership yourself.

## Diagnosis Sequence

1. Establish the feedback loop and reproduce the user's unusable terminal symptom, prioritizing the observed one-row attach/layout path.
2. Write 3–5 ranked falsifiable hypotheses and test one variable at a time.
3. Minimize the repro to the correct existing seam.
4. Add at most one regression test per confirmed root cause.
5. Apply the smallest direct fix.
6. Re-run the original feedback loop and affected existing tests.
7. Remove all debug instrumentation and temporary artifacts.

## Test Delta Ceiling

Expected maximum:

- One changed or new regression test at the layout/connection seam that escaped.
- Affected existing dashboard unit test file(s).
- One existing Playwright journey file on the applicable desktop path.
- Existing typecheck for the affected package.

Do not run or add broader matrices merely for confidence. The AI Lead owns integrated repository gates and production verification.

## Progress and Stop Rules

Progress means a reproduced symptom, falsified hypothesis, smaller failing case, direct passing fix, or frozen candidate. Reading more files without narrowing the cause is not progress.

After three attempts with the same failure and no new evidence, stop. If the direct fix is blocked, issue the wall report; do not build a second path, defensive retry/fallback, abstraction, or harness around it.
