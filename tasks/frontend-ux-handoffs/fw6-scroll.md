---
lane: FW6-SCROLL
frozen_sha: 3f085d9bce82bece71b452f5fa82a8feedeb904c
attempt: 1
state: frozen
gates:
  lint: pass
  typecheck: pass
  test_ci: pass
  smoke: pass
  journeys: pass
  build: pass
  go: n/a
proof:
  - "pnpm install --frozen-lockfile → existing lockfile installed without changes"
  - "focused useTerminalTouchScroll suite → 12/12 tests passed, including mapping remainder, report direction/coordinates, clamping, and the complete dispatcher gating matrix"
  - "focused FW6 mobile journeys → touch swipe emitted an SGR wheel input frame and History requested the selected window session after an in-place switch"
  - "CHOKIDAR_USEPOLLING=1 WATCHPACK_POLLING=true pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:smoke:dashboard && pnpm test:journeys && pnpm build → exact fail-fast chain passed on attempt 1 from tmux TTY /dev/pts/19"
  - "pnpm lint and pnpm typecheck → 5/5 Turbo tasks passed for each gate"
  - "pnpm test:ci → CLI 3 files/44 tests, schema 8 files/52 tests, control plane 49 files/200 tests, and dashboard 58 files/219 tests passed"
  - "pnpm test:smoke:dashboard → 21/21 Chromium scenarios passed"
  - "pnpm test:journeys → 30 passed and 12 expected project-specific/opt-in skips; both new FW6-SCROLL journeys passed"
  - "pnpm build → 4/4 Turbo tasks passed; Next.js 16.2.10 production build compiled and generated routes"
assumptions: []
uncertainties:
  - "A physical Galaxy S25 Ultra was unavailable; the attached-terminal touch path was exercised in Chromium at the repository's 412x915 mobile viewport with real xterm alternate-screen and mouse-tracking modes."
blockers: []
---

# FW6-SCROLL frozen handoff

## Outcome

Attached mobile tmux terminals now translate vertical touch drag and momentum into native SGR wheel reports whenever xterm is on the alternate buffer with mouse tracking active and the connection is writable. Normal-buffer and no-mouse terminals retain the prior xterm `scrollLines` path. The History pager now captures scrollback for the selected pane/window session after an in-place same-tmux-session switch while the WebSocket remains attached to its original session descriptor.

## Delivered work

- Added exported pure helpers for signed five-lines-per-report mapping, one-based touch-cell resolution with grid clamping, and SGR wheel report construction.
- Added one dispatcher used by live drag and momentum. It routes writable alternate+mouse terminals through the existing `sendInput` path, preserves xterm scrolling for normal/no-mouse buffers, and sends nothing for read-only or disconnected attached terminals.
- Kept pixel-level drag remainder separate from the signed wheel-line remainder, preserving fractional motion across live drag and momentum without changing pinch, cursor-mode, context-menu, horizontal swipe, or scroll-anchor behavior.
- Captured the 1-based cell under the touch start point and reused it for every report in the gesture so tmux can target the pane under the operator's finger.
- Added additive `TerminalView.historySessionId`, defaulting to `sessionId` and used only by `ScrollbackPager`; writable state and `sendInput` are passed explicitly to the touch hook.
- Updated `PersistentTerminalHost` to keep the attachment descriptor as the terminal/WebSocket identity while passing `snapshot.descriptor.sessionId` as the History identity.
- Added unit coverage for line mapping/remainders, both wheel directions, repeated reports, coordinate derivation/clamping, normal/alternate/mouse/writable gates, and blocked input.
- Extended the FW6 Focus journey mock with xterm mode output and scrollback session recording. Browser coverage proves touch-to-SGR input and selected-session History after an in-place window switch with no new terminal WebSocket.

## Locked-design implementation notes

- Wheel direction follows existing touch semantics: dragging down yields negative scroll lines and SGR button 64 (wheel up); dragging up yields positive lines and button 65 (wheel down).
- A signed remainder accumulator emits one report per five mapped lines and carries incomplete motion from live drag into momentum.
- The connection gate is `status === 'connected' && !readOnly`. Alternate+mouse input is suppressed when that gate is false; non-mouse buffers remain locally scrollable.
- No protocol, schema, control-plane, agentd, descriptor-key/navigation contract, letterbox, key-rail, mobile Focus, or gesture-timer code changed.

## Verification and ownership

- The mandatory chain ran in order from a real tmux TTY between 08:56:05 and 08:58:17 EDT and ended with `__FW6_GATES_EXIT__:0`.
- The only changed implementation surfaces are the owned touch hook, `TerminalView`, and `PersistentTerminalHost`; all remaining changes are directly related unit/journey tests and this handoff.
- No push, deployment, production operation, live tmux mutation, secret change, protocol change, or data mutation was performed.
- The `frozen_sha` is the final implementation/test commit; the following handoff-only commit adds this file.

## Work-item commits

- `3b890fb` — `feat(scroll): dispatch touch scroll through tmux wheel reports`
- `eb93db8` — `feat(scroll): wire writable touch input and history identity`
- `7078095` — `feat(scroll): target history at the selected session`
- `3f085d9` — `feat(scroll): cover tmux touch scroll and selected history`

FW6-SCROLL FROZEN 3f085d9bce82bece71b452f5fa82a8feedeb904c
