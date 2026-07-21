---
lane: FW6-HIST
frozen_sha: d94d31ddc96bb0daecfa8d3fa089e9eb005d8612
attempt: 1
state: frozen
gates:
  lint: pass
  typecheck: pass
  test_ci: pass
  smoke: pass
  journeys: pass
  build: pass
proof:
  - "pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:smoke:dashboard && pnpm test:journeys && pnpm build → exact mandatory gate passed in order on attempt 1 from tmux session agent-command:4.0"
  - "pnpm lint → all 5 Turbo tasks passed with zero errors; three existing hook warnings remain"
  - "pnpm typecheck → all 5 Turbo tasks passed"
  - "pnpm test:ci → all 5 Turbo tasks passed, including 27 focused history/touch tests"
  - "pnpm test:smoke:dashboard → 21/21 Chromium scenarios passed"
  - "pnpm test:journeys → 34 passed and 16 expected project skips across mobile and desktop"
  - "pnpm build → 4/4 Turbo build tasks passed; Next.js 16.2.10 production build completed"
  - "FW6 Focus focused journey → 7/7 passed at the mobile-412x915 project, including zero terminal scroll/input frames, stable prepend paging, no-reconnect dismissal, selected-session history, Keyboard, and Cursor"
  - "Playwright trace audit → mobile-412x915 inline overlay and desktop-1280x720 History dialog passed; frontend quality score 96/100 with no hard failures"
assumptions:
  - "The existing historySessionId fallback remains authoritative: direct terminals use sessionId, while PersistentTerminalHost supplies the currently selected pane session."
uncertainties:
  - "A physical Galaxy S25 Ultra was unavailable; native momentum and overscroll were exercised in the mobile-412x915 Chromium project."
blockers: []
---

# FW6-HIST frozen handoff

## Outcome

FW6-HIST replaces attached-tmux touch scrolling with an inline, local-first history surface. An upward terminal swipe now opens bottom-anchored range scrollback with native DOM momentum, dense virtualized lines, automatic older-page loading, and instant return to the still-connected live terminal. The touch path emits no tmux scroll navigation and no SGR input for attached terminals.

## Delivered work

- Added `TerminalHistoryOverlay`, contained to the terminal surface rather than a modal. It fetches the newest 500 plain-text lines through the existing range scrollback API, anchors at the bottom, virtualizes at the configured terminal font size, and refetches on every open.
- Added automatic older-page loading near the top, a compact loading state, empty/error/retry states, end-of-history feedback, and prepend compensation that preserves the visible transcript.
- Added two explicit returns to live: a visible, keyboard-focusable Live pill and a deliberate 48px bottom-edge over-scroll. Closing never disconnects or reattaches the terminal WebSocket.
- Reworked attached-tmux vertical touch dispatch for writable and read-only viewers. Swipe-up opens local history, swipe-down is a no-op, and missing history identity is a graceful no-op.
- Removed the touch-only tmux `navigate scroll` callback, animation-frame coalescer, reducer, and tests. Protocol/schema/control-plane/agentd support remains untouched for other callers.
- Preserved non-tmux normal-buffer `scrollLines()`, non-tmux alternate-buffer SGR fallback, pinch zoom, horizontal window swipe/pan, selection, context menu, and Keyboard/Cursor rail behavior.
- Reused the existing selected `historySessionId` threading, so in-place pane/window focus switches resolve history for the selected pane and close any overlay belonging to the previous selection.
- Extended pure-function and browser coverage for the touch gating matrix, paging/virtualization math, overscroll thresholds, zero-frame handoff, stable prepend, no-reconnect dismissal, session switching, and rail regressions.

## Decisions within the locked design

- The overlay occupies only the terminal surface; the existing dashboard chrome and terminal key rail retain their established layout and behavior.
- Terminal-density rows use the current terminal font size with a fixed 1.2 line-height multiplier so virtualization remains deterministic.
- Older history begins loading within six terminal rows of the top and renders with twelve rows of overscan.
- The existing History dialog now shares capture parsing and prepend compensation helpers, with its interaction and rendering contract unchanged.

## Verification notes

- The complete required command chain passed on its first full-gate attempt from the active tmux-backed TTY. No launch-sheet flake occurred.
- The initial focused browser launch exposed an unbuilt workspace schema in the fresh worktree. Building the existing `@agent-command/schema` package and stopping the stale test server restored the intended path; the clean focused rerun passed 7/7 before the full chain passed.
- Mobile and desktop Playwright traces were visually inspected. The inline overlay showed no clipping, overlap, text-fit issue, horizontal layout collision, or obscured Live action; the existing desktop History dialog remained unchanged.
- The ownership firewall was preserved: no protocol, package source, service, agentd, deploy, host-descriptor contract, letterbox, Focus/zoom, rail-key, or production-state changes were made.

## Work-item commits

- `7f01367` — `feat(hist): add inline terminal history overlay`
- `2937782` — `feat(hist): hand off tmux touch scroll to history`
- `67c1d19` — `feat(hist): cover history touch and paging behavior`
- `d94d31d` — `feat(hist): prove inline history journeys`

The `frozen_sha` is the final implementation/test commit; the following handoff-only commit adds this file.

FW6-HIST FROZEN d94d31ddc96bb0daecfa8d3fa089e9eb005d8612
