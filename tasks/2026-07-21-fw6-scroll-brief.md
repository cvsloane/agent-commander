# FW6-SCROLL — Touch scroll-back in attached tmux terminals (Wave 6 punch-list)

Lane: FW6-SCROLL · Machine: homelinux · Worktree: `~/dev/wt/ac-fw6-scroll` · Branch: `refactor/fw6-scroll` (off `refactor/frontend-command-center`; local, do NOT push)
Owner device finding (S25 Ultra, production): "I can't scroll the tmux session to see the previous history." Attached mode is now the primary mobile surface (attach-everywhere + Focus), and vertical swipe does nothing.

## Root cause (verified empirically by AI Lead — do not re-litigate)

1. An attached tmux client ALWAYS puts the outer terminal on the alternate screen (probe: `ESC[?1049h` on every attach, all pane/zoom states). `terminal.scrollLines()` — what `useTerminalTouchScroll` calls on vertical swipe — is a no-op on xterm's alt buffer. Live swipe scroll-back has never worked in attached mode; pre-Wave-6 the mobile default was the stream view (plain DOM scroll), which masked this.
2. Both hosts run tmux with `set -g mouse on`, so the attached client activates SGR mouse tracking (probe: `?1002h` + `?1006h` requested). Feeding SGR wheel-up reports (`\x1b[<64;COL;ROWM`) into the client PTY enters copy-mode and scrolls the pane history — VERIFIED while zoomed (`in_mode=1 scroll=10`, `zoomed=1`); wheel-down at the bottom exits copy-mode automatically. For alt-screen apps in the pane (codex TUI), tmux passes wheel through and the app scrolls its own transcript. This is exactly native tmux semantics — the owner's benchmark. Desktop trackpad already works this way because xterm.js translates real wheel events to mouse reports; touch is the only gap.
3. Second defect, same deploy: after an in-session window/pane switch (FW6-FOCUS instant navigation), `PersistentTerminalHost` renders `TerminalView` from the ATTACHMENT descriptor, so the ScrollbackPager ("History") fetches capture-pane scrollback for the ORIGINAL session, not the currently selected one.

## Design (locked)

- In `useTerminalTouchScroll`, route the existing vertical-swipe line deltas (live drag AND momentum ticks) through one scroll dispatcher:
  - If `terminal.buffer.active.type === 'alternate'` AND `terminal.modes.mouseTrackingMode !== 'none'` AND the connection is writable (connected, not read-only): emit SGR wheel reports — `\x1b[<64;COL;ROWM` per line scrolled up, `\x1b[<65;COL;ROWM` per line down — via the existing `sendInput` path. COL/ROW are the 1-based cell under the touch start point (derive from container rect + the already-computed cellWidth/lineHeight, clamped to the grid) so the pane under the finger scrolls in multi-pane views.
  - Else: keep `terminal.scrollLines()` exactly as today (normal-buffer sessions must not regress — scroll-freeze/jump-to-live behavior stays intact).
  - tmux scrolls ~5 lines per wheel report (copy-mode default); map swipe line-deltas → wheel-report count with a remainder accumulator so slow swipes still scroll and fast swipes don't overshoot. Keep the pure mapping function exported and unit-tested (same style as `synthesizeCursorDragInput`).
  - Read-only or disconnected attached terminals: no input is sent (explicitly assert this in tests).
- Pager fix: thread the SELECTED session id (store `snapshot.descriptor.sessionId`) into `TerminalView` as a new optional prop (e.g. `historySessionId`) used ONLY by the ScrollbackPager; the WebSocket/attach identity keeps using the attachment sessionId. Additive prop, default = sessionId.
- No protocol, schema, CP, or agentd changes. This is a pure dashboard change.

## Work items

1. Scroll dispatcher in `useTerminalTouchScroll` (+ exported pure mapping/report-builder functions) wired to writable-state + buffer/mode gates; momentum path included.
2. `TerminalView`: pass writability + `sendInput` into the hook (cursor mode already has `onCursorInput` — reuse or parallel it); thread `historySessionId` to `ScrollbackPager`.
3. `PersistentTerminalHost`: pass `historySessionId={snapshot.descriptor.sessionId}`.
4. Tests. Unit: wheel-report synthesis (line→report mapping incl. remainder, up/down, cell coords, clamping), gating matrix (normal buffer → scrollLines; alt+mouse+writable → reports; alt without mouse → scrollLines fallback; read-only → nothing). Component/journey-level: extend an existing terminal touch test to assert emitted `input` frames contain SGR wheel sequences when the mock stream sets `?1049h` + `?1002h`/`?1006h`; History pager uses the selected session after a same-session switch (extend the fw6-focus journey mock).

## Ownership firewall

You may edit: `apps/dashboard/src/hooks/useTerminalTouchScroll.ts`, `apps/dashboard/src/components/TerminalView.tsx`, `apps/dashboard/src/components/terminal/(PersistentTerminalHost|ScrollbackPager).tsx`, related tests, `tests/journeys/**` (additive). You may NOT edit: `agents/agentd/**`, `packages/**`, `services/**`, the terminal host store descriptor-key/navigation contract, letterbox logic, key rail, mobileFocus, cursor-mode/context-menu gesture timers (450/500ms choreography — do not disturb).

## Gates

Full chain: `pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:smoke:dashboard && pnpm test:journeys && pnpm build`. Playwright from a tmux TTY. Commit per work item, prefix `feat(scroll):`. ≤3 attempts per failure then hold.

## Done

Handoff `tasks/frontend-ux-handoffs/fw6-scroll.md`, committed, then print exactly:
`FW6-SCROLL FROZEN <full-sha>`
