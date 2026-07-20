# FW4-FLEET — Unified fleet model, terminal attention overlay, prompt composer, badges/filters (Wave 4)

Lane: FW4-FLEET · Machine: homelinux · Worktree: `~/dev/wt/ac-fw4-fleet` · Branch: `refactor/fw4-fleet` (off `refactor/frontend-command-center`; local, do NOT push)
Plan: Workstream D · Evidence: findings doc §§1,5 · Acceptance: checklist Wave 4.

## Backend available (use it)

- `GET /v1/orchestrator/fleet` — one-call aggregate: orchestrator sessions + children rollups + work-item counts + latest report + budget (operator role). Built in Wave 2 exactly to replace the dashboard's per-orchestrator fetch pattern.
- `tmux.topology` UI topic + `POST /v1/sessions/:id/commands` (send_input etc.), attention/approvals stores and endpoints as today.

## Work items

1. **One fleet model.** Replace `useOrchestratorFleet`'s per-orchestrator bundle fetches (and its 4-concurrent cap) with the aggregate endpoint. Merge the two fleet representations — `lib/fleetRoster.ts` (+`TmuxOrchestratorRow`) and `useOrchestratorFleet` (+`OrchestratorFleetCard`) — into ONE store/selector set with two presentations (roster tree row; fleet card). Data flows: aggregate endpoint + `sessions.changed` + `tmux.topology` incrementally update the store; eliminate the 750ms-debounced full roster refetch on every `sessions.changed` (`useTmuxRosterData.ts` ~263-269) in favor of targeted updates with a slow reconciliation refetch (e.g. 30s). Include a timer-based check so a stale live-topology snapshot (host stopped emitting) falls back to roster WITHOUT waiting for the next roster fetch (carried PR-88 review item).
2. **Terminal attention overlay.** When the ATTACHED session has a pending attention item (approval, question, error), show a compact inline card overlaying the terminal bottom edge: item summary + approve/deny/respond actions (respond focuses the composer). Dismissable, reappears on new items; never steals typing focus uninvited.
3. **Prompt composer.** In the workbench (mobile + desktop): a multi-line composer as an alternative to raw terminal typing — textarea with send button (dispatches `send_input` with trailing newline), prompt history (persisted recents, up-arrow recall on desktop), and a "send to other session" affordance reusing the existing copy-to flow. Collapsed by default to a single affordance; never covers the terminal when collapsed.
4. **Health badges + saved filters.** Tune session badges for scanning: waiting-input, waiting-approval, error, idle, dirty-git, host-offline, unmanaged — consistent iconography/colors in roster rows AND fleet cards (one badge component). Roster filter chips: persist last-used filter; add "this host" and "recent" saved filters (settings-store persisted).
5. **Decompose `OrchestratorItem.tsx` (952 lines)** into per-item-type renderers + shared action hooks while you're unifying the attention actions (the overlay in item 2 must reuse these, not fork them).
6. **Tests.** Store unit tests (aggregate ingestion, incremental updates, badge derivation, filter persistence); overlay + composer interaction tests; existing suites green.

## Ownership firewall

You may edit: `src/components/orchestrator/**`, `src/components/tmux/**`, `src/components/session/**`, `src/components/automation/AutomationAgentCard.tsx`, `src/hooks/**` (fleet/roster/attention), `src/lib/fleetRoster.ts`, `src/lib/api.ts` (additive), `src/stores/**` (orchestrator/settings additive + new fleet store), related tests. You may NOT edit: `src/app/**` routes, `src/components/layout/**`, `src/components/ui/**`, `src/components/settings/**`, `src/components/SessionList.tsx`, `src/components/search/**` (FW4-SURFACES owns those), `packages/**`, `services/**`, `agents/**`. No new dependencies.

## Gates

`pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:smoke:dashboard && pnpm build`. Commit per work item, prefix `feat(fleet):`. ≤3 attempts per failure then hold.

## Done

Handoff `tasks/frontend-ux-handoffs/fw4-fleet.md`, committed, then print exactly:
`FW4-FLEET FROZEN <full-sha>`
