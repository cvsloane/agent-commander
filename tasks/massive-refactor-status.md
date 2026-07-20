# Massive Refactor — Status Board (compact, updated in place)

Program: `tasks/2026-07-19-massive-refactor-master-plan.md` · Findings: `tasks/2026-07-19-subsystem-study-findings.md`
AI Lead: Claude (Fable 5) on homelinux, session in agent-command repo. Human Owner: Chris.
Integration branch: `refactor/tmux-command-center`. Builders: codex lanes in tmux panes, isolated worktrees.

## PROGRAM COMPLETE 2026-07-20T01:20Z — all 13 lanes (waves 1-6) integrated; full gate green. Held for owner: merge to main, deploy, migrations 031-038 rollout, agentd binary rollout, VAPID key setup, heavisidelinux inotify bump.

| Lane | Machine | Worktree | Branch | Pane | State | Last checked |
|---|---|---|---|---|---|---|
| W1-AGENTD | heavisidelinux | ~/dev/wt/ac-w1-agentd | refactor/wave1-agentd | (done) | INTEGRATED @ 3d67682 | 2026-07-19T16:35Z |
| W1-CP-CORE | homelinux | ~/dev/wt/ac-w1-cp | refactor/wave1-cp | (done) | INTEGRATED @ 2c1a332 | 2026-07-19T17:15Z |
| W1-AUTOMATION | homelinux | ~/dev/wt/ac-w1-auto | refactor/wave1-automation | (done) | INTEGRATED @ 6de9cef | 2026-07-19T16:20Z |
| W1-DASHBOARD | homelinux | ~/dev/wt/ac-w1-dash | refactor/wave1-dashboard | (done) | INTEGRATED @ f65adea | 2026-07-19T16:35Z |

## Ownership firewall (Wave 1)
- W1-AGENTD: `agents/**` + NEW files under `tests/fixtures/protocol/` only. Pushes branch to origin.
- W1-CP-CORE: `services/control-plane/**` (except automation.ts/automationMemory.ts), `migrations/031_command_outbox.sql`, `packages/ac-schema` additive. Local branch only.
- W1-AUTOMATION: `services/control-plane/src/services/automation.ts`, `src/db/automationMemory.ts`, new `tests/automation*.test.ts`. Local branch only.
- W1-DASHBOARD: `apps/dashboard/**`. Local branch only.
- AI Lead: `tasks/**`, integration, shared-file reconciliation (hostPresence call-sites), commits/pushes on integration branch.
- Migration numbers: 031 = CP-CORE outbox. Next free: 032 (claim here before use).

## Completion tokens
`W1-AGENTD FROZEN <sha>` · `W1-CP-CORE FROZEN <sha>` · `W1-AUTOMATION FROZEN <sha>` · `W1-DASHBOARD FROZEN <sha>`
Handoffs land in `tasks/massive-refactor-handoffs/` on each lane branch.

## Gates
- Lane gates: per brief. Wave gate (AI Lead, post-integration): `pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:smoke:dashboard` + `go build ./... && go vet ./... && go test ./...` in agents/agentd.
- Review: AI Lead mechanical review of every lane diff vs ownership + brief; fresh independent reviewer for the integrated wave before commit to integration branch.

## Stop conditions
- 3 attempts reproducing the same failure without new evidence/strategy ⇒ hold lane, escalate in report.
- A lane editing outside its firewall ⇒ objective correction (revert + re-task).
- Baseline (2026-07-19): typecheck + test:ci green at 9e26344.

## Decisions pending Human Owner
(none — wave 1 fully authorized)

## Wave 2 lanes (launched 2026-07-19T17:30Z)
| Lane | Machine | Worktree | Branch | Pane | State |
|---|---|---|---|---|---|
| W2-CONTRACTS | homelinux | ~/dev/wt/ac-w2-contracts | refactor/wave2-contracts | (done) | INTEGRATED @ 9ec6fa6 |
| W2-AGENTD-API | heavisidelinux | ~/dev/wt/ac-w2-agentd | refactor/wave2-agentd | (done) | INTEGRATED @ e6ffc47 |

Wave 2 firewall: CONTRACTS = migrations 032-034, ac-schema additive, CP db/sessionGraph+agentTasks, scoped additive ws-ingest/routes edits. AGENTD-API = agents/** only, pushes to origin. Pending after CONTRACTS freeze: W2-CP-ORCH, W2-MCP-CLI.

## Wave 3+4a lanes (launched 2026-07-19T19:40Z)
| Lane | Machine | Worktree | Branch | Pane | State |
|---|---|---|---|---|---|
| W3-PUSH-BACKEND | homelinux | ~/dev/wt/ac-w3-push | refactor/wave3-push-backend | agent-command:w3-push | active |
| W3-PWA | homelinux | ~/dev/wt/ac-w3-pwa | refactor/wave3-pwa | agent-command:w3-pwa | active |
| W4-AGENTD-TERM | heavisidelinux | ~/dev/wt/ac-w4-term | refactor/wave4-agentd-term | agent-command:w4-term | active |

Migration claims: 036 = push-backend. Next free: 037.
