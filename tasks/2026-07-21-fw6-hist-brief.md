# FW6-HIST — Local history overlay for attached-terminal touch scrolling (device finding 6)

Lane: FW6-HIST · Machine: homelinux · Worktree: `~/dev/wt/ac-fw6-hist` · Branch: `refactor/fw6-hist` (off `refactor/frontend-command-center`; local, do NOT push)
Owner device finding (S25 Ultra, production): FW6-TOUCH server-side scrolling is "slow, error-filled, and unusable for the most part"; the earlier local/DOM scroll experience was "smooth and fast" with no character artifacts, just size-limited. Owner interview locked the direction below — do not re-litigate.

## Root causes (verified by AI Lead — do not re-derive)

1. Server-side scroll physics: every coalesced swipe frame = WS `navigate {op:'scroll'}` → CP → agentd `display-message` + `send-keys` subprocess execs (serialized under the manager lock) → full alt-screen tmux repaint → full-frame xterm rebuild on the phone. Feel is bounded by RTT + two process spawns + full redraw per step; it can never match native browser scroll.
2. Artifacts (owner: codex panes, transient while scrolling): torn full-frame copy-mode repaints rendered mid-stream, plus the read-state-once-per-message race in the four-branch agentd dispatch that can deliver literal SGR/arrow bytes to a pane whose mode changed. Local-first scrolling removes both classes structurally — touch never injects tmux input.
3. KEY probe fact (heavisidelinux, live codex pane): codex runs on the tmux NORMAL screen (`alternate_on=0`, `mouse_any_flag=0`) and accumulates real pane history (5,423 lines observed); `capture-pane -S -5300` returns clean, readable transcript text. Therefore capture-pane range paging — the exact feed the ScrollbackPager/History dialog already uses in production (`POST /v1/sessions/:id/scrollback`, mode `range`) — serves shell AND codex panes through ONE uniform path. No snapshot/pipe-pane stream, no protocol change, no agentd change.

## Design (owner-locked)

### 1. New inline `TerminalHistoryOverlay` (dashboard-only)

- Vertical swipe-up on an attached tmux terminal (writable OR read-only — history reads need no write permission) opens an inline overlay covering the terminal surface (NOT a Radix modal; the existing History dialog stays untouched).
- Content: plain-text scrollback lines fetched via the existing `getSessionScrollback(sessionId, {mode:'range', strip_ansi:true})` path, using the already-threaded `historySessionId` (same default/fallback semantics as ScrollbackPager — it must follow the SELECTED pane after FW6-FOCUS window/pane switches).
- Initial fetch = newest `SCROLLBACK_PAGE_LINES` (500) page, rendered anchored at the bottom. Scrolling near the top auto-loads older pages (reuse `scrollbackPaging.ts` helpers and ScrollbackPager's prepend-with-scroll-compensation pattern) — history is effectively unlimited; show a small loading affordance while a page is in flight and stop when `hasOlder` is false.
- Scrolling is 100% native DOM (`overflow-y: auto`, momentum): virtualized like ScrollbackPager but at terminal density (mono font, current terminal font size ≈14px line metrics, terminal background) — not the pager's 32px rows.
- Dismiss: over-scrolling past the bottom edge OR a visible "Live" pill returns to the live attached view. The WS attachment stays connected underneath the whole time — closing is instant, no reattach. Detach/leave/session-switch closes the overlay.
- Overlay content is snapshot semantics (like the History dialog): re-opening refetches the newest page. No live-tail inside the overlay.
- If no session id is resolvable for the current pane, swipe-up is a graceful no-op.

### 2. Touch dispatch rework (`useTerminalTouchScroll.ts`)

- For attached tmux terminals (the current `navigate` path): vertical swipe NO LONGER sends anything to tmux. Swipe-up opens the overlay (hand the gesture off so the open feels continuous — at minimum the overlay opens bottom-anchored and immediately responds to native touch scrolling). Swipe-down at live view stays a no-op.
- Delete the touch-path `navigate {op:'scroll'}` emission, the rAF coalescer, and the SGR wheel-report synthesis FOR THE TMUX PATH, plus the now-unused exported pure helpers and their tests. `TerminalView`'s `handleNavigateScroll`/`onNavigateScroll` wiring goes too if nothing else consumes it.
- KEEP unchanged: normal-buffer local `terminal.scrollLines()` path (non-tmux/desktop must not regress); the non-tmux alt-buffer SGR `sendInput` fallback (direct PTY input, no agentd round trip); pinch-zoom, horizontal pan/window swipe, selection, context menu, Keyboard/Cursor rail keys and their gating — all exactly as-is.
- Protocol, schema, CP relay, and agentd scroll op stay UNTOUCHED (desktop/API callers may use the op; touch just stops calling it). No binary rollout this round.

## Work items

1. `TerminalHistoryOverlay` component + paging/virtualization (reuse `scrollbackPaging.ts`; extract shared helpers rather than duplicating ScrollbackPager logic where reasonable).
2. Touch dispatcher rework: overlay handoff, tmux-path emission deletion, dead-helper cleanup; `TerminalView`/`PersistentTerminalHost` wiring for the overlay (`historySessionId` threading reuse).
3. Unit tests: gesture gating matrix (attached tmux → overlay incl. read-only; normal buffer → scrollLines; non-tmux alt+mouse → SGR fallback unchanged; no-session → no-op), paging math, dismiss thresholds.
4. Journeys: swipe-up on an attached terminal opens the overlay AND emits ZERO `navigate scroll` frames / ZERO SGR bytes on the terminal WS; older-page load prepends with stable scroll position; bottom over-scroll dismisses back to live without a new terminal WS connection; overlay follows the selected session after a window switch (extend the fw6-focus journey mock); Keyboard/Cursor rail journeys stay green.

## Ownership firewall

You may edit: `apps/dashboard/src/hooks/useTerminalTouchScroll.ts`, `apps/dashboard/src/components/TerminalView.tsx`, `apps/dashboard/src/components/terminal/**` (new overlay file, PersistentTerminalHost/TerminalSurface wiring, `scrollbackPaging.ts` extraction), related unit tests, `tests/journeys/**`. You may NOT edit: `agents/agentd/**`, `packages/**`, `services/**`, `deploy/**`, the descriptor-key/attachment contract in `terminalHostStore.ts`, letterbox logic, Focus/zoom (`mobileFocus.ts`), the Keyboard/Cursor rail keys, the existing ScrollbackPager dialog behavior (extraction refactors must keep its tests green), gesture timers not named above.

## Gates

Full chain: `pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:smoke:dashboard && pnpm test:journeys && pnpm build`. Playwright from a real tmux TTY. Run `pnpm install --frozen-lockfile` first if `node_modules` is absent. Commit per work item, prefix `feat(hist):`. ≤3 attempts per failure then hold. Known journey load-flake (launch-sheet fill timeout): if it reds once, re-run it isolated (×5) before counting an attempt.

## Done

Handoff `tasks/frontend-ux-handoffs/fw6-hist.md` (same frontmatter format as fw6-touch.md), committed, then print exactly:
`FW6-HIST FROZEN <full-sha>`
