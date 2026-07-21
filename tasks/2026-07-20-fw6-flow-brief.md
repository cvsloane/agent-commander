# FW6-FLOW — Attach-everywhere navigation + stable grid (Wave 6, batch 1)

Lane: FW6-FLOW · Machine: heavisidelinux (cross-stack: Go + TS) · Worktree: `~/dev/wt/ac-fw6-flow` · Branch: `refactor/fw6-flow` (off `origin/refactor/frontend-command-center`; PUSH to origin regularly)
Context: `tasks/2026-07-20-mobile-tmux-ux-plan.md` (OWNER-LOCKED header). Go toolchain `~/.local/go/bin`. tmux SAFETY: tests use private `-L ac-test-*` sockets ONLY (never the default server).

## Mission

Every navigation lands live, and the grid stops churning. Success = **0 taps from cold open to last night's pane, window-strip taps change what you SEE, and typing/keyboard animation never SIGWINCHes tmux while a desktop client is attached**.

## Work items

1. **Attach-on-navigate everywhere (owner-locked).** In-app selections currently write `session_id` but never `attach=1` (only server hrefs do — `launch.ts:80`, `tmux.ts:37`). Make roster taps (`useTmuxRosterData.ts` ~:407-416), `RecentSessions` (~:10-19), and quick-switch land attached with `mode=terminal`. **Window strip re-targets the viewer**: a tab tap dispatches `select_window` AND switches the viewed pane to that window's active pane (`TmuxWindowStrip.tsx` ~:256-263 + `selectSession`) — same for Prev/Next. Cross-host switch keeps the previous pane warm and attaches the new one in one tap (no roster blanking).
2. **Cold-open restore.** Persist last attached `{host_id, session_id}` (ui store) and on boot with no URL params, restore it live (equivalent of the server's `mode=terminal&attach=1` href). Fallback to roster if the session is gone.
3. **Grid stability (owner-locked: letterbox-when-desktop-attached).**
   - **agentd (Go):** on viewer attach, when the new `letterbox` attach option is set, pin the grouped viewer session's window size (`window-size manual` + fixed dimensions from the attach) so the phone client never shrinks the shared window; release/`window-size latest` on detach. Additive `terminal.attach` option in the protocol (extend the existing envelope additively + fixture; TS side in schema).
   - **Control plane:** pass the option through; expose whether other (non-viewer) clients are attached to the underlying session if cheaply derivable from existing state — the dashboard decides policy: letterbox when a desktop client shares the window, fit-to-viewport when solo.
   - **Dashboard:** letterbox render mode — fixed cols×rows grid, font scales to fit width, vertical pan for overflow; resize dispatches ONLY on settled changes (rotation, keyboard animation END — kill the `visualViewport.scroll`-driven fits at `useTerminalConnection.ts` ~:461-463; debounce until geometry is stable ≥250ms with a min-cell-delta gate).
4. **Warm switching + resume UX.** Serialize/snapshot warm reattach: cache the last buffer per recently-viewed pane client-side and paint it instantly on switch while the live attach resumes (existing capture replay stays the source of truth). Warm-socket window 5min → configurable (default 30min, settings). Toasts: "resumed" vs "session restarted — history truncated"; `idle_timeout`/`detached` states get a one-tap Resume button instead of a dead end.
5. **Command-result feedback (carried A5).** CP: relay `commands.result` outcomes on a UI topic (additive schema + relay, following the `tmux.topology` pattern). Dashboard: optimistic window/pane actions reconcile on real results; failures toast with the error.
6. **WebGL renderer resilience.** On context loss the addon disposes and never returns (`useXtermTerminal.ts` ~:104-111): attempt one re-create after loss (backoff), log a perf-channel metric on permanent fallback.
7. **"＋ window here."** When attached, the launch sheet offers a prefilled "new window in this session" mode (host + tmux target prefilled from context) — 2 taps + prompt instead of 6 (`MobileLaunchSheet.tsx` ~:509-521 free-text target today).
8. **Tests.** Go: letterbox pin/release on the private-socket server; attach-option round-trip fixture. TS: attach-contract unit tests (every nav path emits attach), cold-open restore, settled-resize policy (no dispatch during simulated keyboard animation), command-result reconciliation. Playwright 412×915: cold-open→live journey, window-tab switches the view.

## Ownership firewall

You may edit: `agents/agentd/**` (viewer/grouped-session attach options only — do NOT touch the PTY transport itself), `packages/ac-schema/**` (additive), `services/control-plane/**` (additive relay/passthrough), `tests/fixtures/protocol/` (NEW fixture files for the additive attach option + command-result topic), `apps/dashboard/src/hooks/**`, `src/stores/**` (ui/settings additive), `src/lib/api.ts` (additive), `src/components/tmux/**` navigation wiring, `src/components/terminal/PersistentTerminalHost.tsx` + connection hooks, `MobileLaunchSheet.tsx` (item 7), related tests. You may NOT edit: the rail/key components, `globals.css`, font/full-bleed composition (FW6-CANVAS owns those), `deploy/**`. Shared-file conflicts with FW6-CANVAS (`TmuxWindowStrip`, mobile shell): CANVAS owns presentation, you own navigation/dispatch wiring — keep your edits to handlers/hooks and flag overlaps in your handoff for AI Lead reconciliation.

## Gates

Full TS chain (Playwright from a tmux TTY) + `go build ./... && go vet ./... && go test ./...` in agents/agentd. Commit per work item, prefix `feat(mobile-flow):` / `feat(agentd):`. ≤3 attempts per failure then hold.

## Done

Handoff `tasks/frontend-ux-handoffs/fw6-flow.md`, committed and pushed, then print exactly:
`FW6-FLOW FROZEN <full-sha>`
