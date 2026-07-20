# Frontend Command Center UX — Status Board (compact, updated in place)

Program: `tasks/2026-07-20-frontend-tmux-ux-master-plan.md` · Findings: `tasks/2026-07-20-frontend-ux-study-findings.md` · Acceptance: `tasks/frontend-ux-acceptance-checklist.md`
AI Lead: Claude (Fable 5) on homelinux, session in agent-command repo. Human Owner: Chris.
Integration branch: `refactor/frontend-command-center`. Builders: codex (gpt-5.6-sol, xhigh) lanes in tmux, isolated worktrees.
Baseline: typecheck + test:ci green at `70fa53e` (2026-07-20). Deploy cadence: per-wave PR to main + production deploy (owner merges/authorizes).

## Wave 1 lanes (launched 2026-07-20)

| Lane | Machine | Worktree | Branch | tmux | State | Last checked |
|---|---|---|---|---|---|---|
| FW1-MODERN | homelinux | ~/dev/wt/ac-fw1-modern | refactor/fw1-modern | (done) | INTEGRATED @ 6f8ce3c (frozen 76d3c5e, gate re-verified by AI Lead) | 2026-07-20 |
| FW1-TMUX-GO | heavisidelinux | ~/dev/wt/ac-fw1-tmux-go | refactor/fw1-tmux-go | (done) | INTEGRATED @ 76d7a12 (R1 eaadfe9 + R2 7a8e6ee; reviewer re-verdict SHIP) | 2026-07-20 |

**WAVE 1 COMPLETE** — final gate (TS+Go) green on integrated tree; independent reviewer verdict SHIP after R2 closed C1/W3/W4 with end-to-end tests. **Held for owner: merge Wave-1 PR to main + production deploy.** Deploy notes: safe for the mixed-version window — topology emission ships default-off; **agentd binary rollout stays HELD until Wave 2** (CP schema registration + unknown-envelope tolerance land in FW2-CONTRACTS). Carried to FW2-CONTRACTS: register `tmux.topology` + 8 command schemas, CP log-and-drop on unknown agent envelopes. Carried to Wave 3: split-pane `-l N%` needs tmux ≥3.1; kill_window last-window confirmation; doc note on the reserved `ac-agentd-` hook namespace. No migrations in this wave.

## Ownership firewall (Wave 1)
- FW1-MODERN: package manifests + lockfile, tsconfig/eslint/turbo configs, and **mechanical** TS/TSX fixes anywhere outside `agents/**`. NO feature/behavior edits, NO Zod changes, NO visualizer/R3F dep changes, NO `agents/**`.
- FW1-TMUX-GO: `agents/**` + NEW files under `tests/fixtures/protocol/` only. Pushes `refactor/fw1-tmux-go` to origin. Fixture shapes frozen per brief — changes need AI Lead sign-off.
- AI Lead: `tasks/**`, integration branch, shared-file reconciliation, wave PRs.
- Migration numbers: next free **039** (no claims yet; claim here before use — expected first claims in FW2-CONTRACTS).

## Completion tokens
`FW1-MODERN FROZEN <sha>` · `FW1-TMUX-GO FROZEN <sha>`
Handoffs land in `tasks/frontend-ux-handoffs/` (heavisidelinux lane commits its handoff on the lane branch).

## Gates
- Lane gates: per brief. Wave gate (AI Lead, post-integration): `pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:smoke:dashboard && pnpm build` + `go build ./... && go vet ./... && go test ./...` in agents/agentd.
- Review: AI Lead mechanical review of every lane diff vs firewall + brief; fresh independent reviewer for the integrated wave before the wave PR (risk tier: standard; FW1-MODERN toolchain swap reviewed against build/runtime proof, not summaries).

## Autonomy lanes
- Worktree code changes, lane-branch commits, lane-branch pushes: autonomous.
- Integration commits on `refactor/frontend-command-center`, brief/steering authoring: autonomous-with-receipt (log entry).
- Merge wave PR to main, production deploy, migration rollout: approval-required (owner).
- Dependency changes outside a brief's list, transport-mode changes, visualizer edits, force-push, kill-session on heavisidelinux tmux: forbidden.

## Budgets & stop conditions
- Wall-clock: FW1-MODERN ≤ 8h, FW1-TMUX-GO ≤ 10h from launch; program soft ceiling 7 days.
- Progress = new commits, passing gate output, or a declared hold in the pane/handoff. No visible progress for 60 min ⇒ AI Lead intervenes (read scrollback, re-task).
- 3 attempts reproducing the same failure without new evidence/strategy ⇒ hold lane, escalate in handoff.
- TS 7 proves infeasible ⇒ declared hold + escalation; approved fallback is TS 5 for the program (plan risk section), owner informed — not silently swallowed.
- Firewall breach ⇒ objective correction (revert + re-task). Red wave gate ⇒ wave held, independent lanes may continue.

## Decisions pending Human Owner
(none — Wave 1 fully authorized under the 2026-07-20 locked decisions; next owner action is the Wave-1 PR merge + deploy)
