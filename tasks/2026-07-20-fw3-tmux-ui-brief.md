# FW3-TMUX-UI — Window strip, in-app tmux management, multi-terminal, scrollback pager (Wave 3)

Lane: FW3-TMUX-UI · Machine: homelinux · Worktree: `~/dev/wt/ac-fw3-tmux-ui` · Branch: `refactor/fw3-tmux-ui` (off `refactor/frontend-command-center`; local, do NOT push)
Plan: Workstreams B/C · Evidence: findings doc §2 · Acceptance: checklist Wave 3.

## Backend already available (Waves 1-2 — use it, don't rebuild it)

- UI WebSocket topic `tmux.topology` relays debounced full-host topology snapshots (shape: `tests/fixtures/protocol/tmux-topology.json`) — emitted only by hosts whose agentd has `topology_events: true`; MOST HOSTS MAY NOT EMIT YET.
- 8 commands dispatchable via `POST /v1/sessions/:id/commands`: `new_window`, `kill_window`, `rename_window`, `split_pane` (direction/percent/cwd), `select_window`, `select_pane`, `resize_pane`, `zoom_pane`.
- `POST /v1/sessions/:id/scrollback` — capture modes visible/last_n/range/full, ≤5000 lines/request.

## Work items

1. **Topology store + fallback.** A store fed by the `tmux.topology` topic (per host). When a host emits no topology (old agentd / flag off), derive equivalent window/pane structure from the existing roster data (`useTmuxRosterData`) — the UI must be fully functional either way, with topology giving it real-time freshness. Feature-detect per host, no config.
2. **Window strip.** A compact tab strip above the terminal in the workbench (mobile + desktop): one tab per window of the attached pane's tmux session — name, index, active state, bell/activity dots (topology-fed when available). Tap = `select_window`. Long-press/context = rename (inline input → `rename_window`), close (`kill_window` — and when it's the session's LAST window, a hard confirm: "This ends the whole tmux session"). A "+" tab = `new_window` (optional cwd from the session's path). All dispatches optimistic with rollback on command error toast.
3. **Pane controls.** In the terminal toolbar/action sheet: split horizontal, split vertical (use percent only when the host tmux ≥ 3.1 — read the host/agent version from roster/host data; below that, plain split without `-l`), zoom toggle, select-pane arrows (mobile sheet), kill-pane (confirm). Desktop gets the collapsible `TmuxKeyBar` (currently mobile-only, `TerminalSurface.tsx` gates it): default collapsed, expansion persisted in settings store.
4. **Desktop 2-up multi-terminal.** The desktop workbench can split into two side-by-side independent terminals (two sessions/panes, each its own WS attach). Simple model: primary + secondary slot, close button on secondary, remembered per session pair. Do NOT touch the mobile single-terminal + persistent-host model; verify composition with `PersistentTerminalHost` (the background-terminal budget stays 1 — the visible pair are both foreground).
5. **Mobile quick-switch strip.** A horizontal strip of recent panes (chips w/ session title + status dot) above the mobile terminal for one-tap switching (feeds the same recents the launch rail uses).
6. **Scrollback pager.** "View history" action → overlay/sheet with virtualized older history fetched via the scrollback endpoint (range paging, "load older" at top, monospace, selectable/copyable, searchable via simple text filter). Do NOT attempt to prepend into the xterm buffer.
7. **Tests.** Unit tests for the topology store (topology-fed and roster-fallback paths), window-strip actions (dispatch payloads + last-window confirm), version gating of percent splits; Playwright smoke for strip render + pager open on mobile viewport. All suites green.

## Ownership firewall

You may edit: `apps/dashboard/src/components/tmux/**`, `src/components/terminal/**`, `src/components/session/**`, `src/hooks/**` (tmux/terminal hooks + new ones), `src/lib/tmuxKeys.ts`, `src/lib/api.ts` (additive client functions only), `src/lib/ws.ts` (additive topic only), a new store file (e.g. `src/stores/tmuxTopology.ts`) + `src/stores/settings.ts` (additive key-bar/recents prefs), related tests. You may NOT edit: `src/app/**` route files, `src/components/layout/**`, `src/components/orchestrator/**`, `src/components/launch/**` (FW3-SHELL owns those), `packages/**`, `services/**`, `agents/**`, `tests/fixtures/protocol/**`. No new dependencies.

## Gates

`pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:smoke:dashboard && pnpm build`. Commit per work item, prefix `feat(tmux-ui):`. ≤3 attempts per failure then hold.

## Done

Handoff `tasks/frontend-ux-handoffs/fw3-tmux-ui.md`, committed, then print exactly:
`FW3-TMUX-UI FROZEN <full-sha>`
