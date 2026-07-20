# W4-FLEET-UI — Orchestrator Command Surface, Fleet Tree, Cross-Host Roster, Mobile Nav

Read master plan workstreams C-UI/D + findings §3 (orchestrator-UI gap). Worktree `/home/cvsloane/dev/wt/ac-w4-ui`, branch `refactor/wave4-fleet-ui`. Ownership: `apps/dashboard/**` EXCEPT the terminal stack (hooks/useTerminalConnection, useXtermTerminal, components/terminal/**, TerminalView.tsx — sibling lane owns those; consume as-is), plus a small additive CP route if needed (`/v1/tmux/roster?all_hosts=1` aggregate) + its test. No push; handoff `tasks/massive-refactor-handoffs/w4-fleet-ui.md`; token `W4-FLEET-UI FROZEN <sha>`.

Backend already provides (read handoffs w2-contracts, w2-cp-orch, w3-push-backend): session graph + rollups (`/v1/sessions/:id/graph`), agent_tasks, roles, structured reports, attention_reason, `attention.changed`/`session_edges.changed`/`agent_tasks.changed` topics.
1. **Orchestrator command surface**: make `/orchestrator` (or a new tab there) show one card per orchestrator-role session: subagent tree (child sessions + agent_tasks with statuses), latest report, inline approve/deny, **prompt composer** posting send_input via existing command API (no terminal focus needed), one-tap "open terminal" deep link. Mobile-first.
2. **Fleet tree in /tmux**: group roster by orchestrator when edges exist (orchestrator row expands to its workers regardless of tmux window layout); keep plain tmux grouping otherwise.
3. **Cross-host roster**: "All machines" option fetching roster for every online tmux host in parallel (or the aggregate route), sorted waiting-first.
4. **Global mobile bottom-tab nav**: tmux / Orchestrator / Sessions / More (drawer keeps the rest); 44px targets, safe-area padded, no layout shift.
5. **Automation page decomposition**: split the 1,401-line `automation/page.tsx` into components with URL tab state, scrollable TabsList, forms in sheets; agent cards get wake/nudge buttons + budget bar (mobile-sized).
6. Tests: fleet grouping logic unit tests, attention-merge additions, smoke passes; add one Playwright mobile scenario for bottom-nav + orchestrator card.

Gate (bare exit codes): `pnpm --filter @agent-command/dashboard test && pnpm --filter @agent-command/dashboard typecheck && pnpm --filter @agent-command/dashboard lint && pnpm test:smoke:dashboard` (+ control-plane test if you add the aggregate route)
