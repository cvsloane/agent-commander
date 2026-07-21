# FW6-FOCUS — Single-pane focus + instant in-session switching (Wave 6 punch-list)

Lane: FW6-FOCUS · Machine: homelinux · Worktree: `~/dev/wt/ac-fw6-focus` · Branch: `refactor/fw6-focus` (off `refactor/frontend-command-center`; local, do NOT push)
Owner device findings (S25 Ultra, production): (1) selecting a pane shows ALL panes of the window — unusable compression on mobile; single-pane focus is "a big deal". (2) Window switching via the strip "takes a while to connect" — every switch is a full detach/reattach round-trip.

## Design (locked by AI Lead from the findings)

The per-viewer grouped session IS an independent tmux client: it has its own current-window/current-pane. In-session navigation must happen INSIDE the live PTY (viewer-session `select-window`/`select-pane`/zoom) with the WebSocket and descriptor kept stable; only cross-tmux-session switches reattach. Single-pane focus = tmux zoom of the selected pane (shared window property — the desktop view zooms too; acceptable single-user trade-off, must be visible/predictable, and ALWAYS unzoomed on detach/switch-away).

## Work items

1. **agentd: viewer-scoped navigation ops.** New channel-scoped terminal messages (client→CP→agent alongside `terminal.input`/`resize`): `terminal.navigate` with `{op: 'select_window', window_index}` | `{op: 'select_pane', pane_id}` | `{op: 'zoom', on: boolean}` — executed against the VIEWER grouped session (`select-window -t <viewer>:<idx>` etc.), NOT the origin session, so the desktop's active window/pane is never yanked by phone navigation. Zoom uses `resize-pane -Z` on the viewer's current pane (window-shared by tmux semantics — document it). Additive protocol + fixture + Go tests on private sockets.
2. **CP: relay** the new terminal message type channel-scoped (same pattern as `terminal.input`); additive schema; tests.
3. **Dashboard: in-session switching.** When the window strip (or Prev/Next, quick-switch, spatial pane nav) targets a window/pane in the SAME tmux session as the attached pane: keep the descriptor/WS untouched, send `terminal.navigate`, optimistically update the strip/URL (session_id still updates for state, but WITHOUT remounting the terminal — the descriptor key must stay stable across same-session retargets; extend the key/store contract accordingly). Cross-session targets keep today's reattach. Result: window switches feel instant.
4. **Dashboard: Focus mode.** Mobile status row gets a Focus toggle (maximize icon). Behavior: attaching a MULTI-pane window on mobile auto-enables Focus (zoom on the selected pane) — setting `autoFocusPane` default ON, toggleable; switching pane/window while focused re-zooms the new target; leaving the terminal, detaching, or toggling off unzooms. Desktop unaffected by default (no auto-zoom ≥1024px). The zoomed state must reflect tmux truth (topology `zoomed` flag) not just local state.
5. **Unzoom safety.** agentd unzooms the viewer's window on channel detach/supersede/sweep if the channel applied the zoom (track per-channel), so a dropped phone connection never leaves the desktop zoomed.
6. **Tests.** Go: viewer-scoped ops + unzoom-on-detach on private sockets. TS: same-session switch keeps the terminal instance (no remount — extend the existing same-instance test), focus toggle state machine, navigate-message emission. Journey: window-strip switch with no reconnect (assert no new terminal WS) + focus zoom round-trip. All suites green.

## Ownership firewall

You may edit: `agents/agentd/**`, `packages/ac-schema/**` (additive), `services/control-plane/**` (additive relay), `apps/dashboard/src/(components/(terminal|tmux|mobile)|hooks|stores|lib)/**`, `tests/fixtures/protocol/` (NEW files), `tests/journeys/**` (additive spec), related tests. You may NOT edit: `deploy/**`, launch/orchestrator/layout components, the letterbox freeze logic from the attach-loop hotfix (extend, don't rewrite — the descriptor-key contract note in `terminalHostStore.ts` explains why).

## Gates

Full chain: `pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:smoke:dashboard && pnpm test:journeys && pnpm build` + Go build/vet/test. Playwright from a tmux TTY. Commit per work item, prefix `feat(focus):`. ≤3 attempts per failure then hold.

## Done

Handoff `tasks/frontend-ux-handoffs/fw6-focus.md`, committed, then print exactly:
`FW6-FOCUS FROZEN <full-sha>`
