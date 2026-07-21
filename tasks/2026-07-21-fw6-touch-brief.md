# FW6-TOUCH — Natural touch scrolling + explicit keyboard/cursor modes (Wave 6 punch-list)

Lane: FW6-TOUCH · Machine: homelinux · Worktree: `~/dev/wt/ac-fw6-touch` · Branch: `refactor/fw6-touch` (off `refactor/frontend-command-center`; local, do NOT push)
Owner device finding (S25 Ultra, production): "The scrolling barely works... combining the touch to focus and touch to scroll doesn't work very well." Owner interview locked all three fixes below — do not re-litigate.

## Root causes (verified by AI Lead)

1. SGR-wheel emulation is quantized: tmux scrolls 5 lines per wheel report → ~125px of finger travel per visible jump with a dead zone under 5 lines.
2. Every terminal tap focuses xterm's textarea → Android keyboard pops → viewport/PTY resize → tmux re-flows mid-read.
3. The 450ms stationary hold arms cursor-drag, so a slow deliberate scroll start sends arrow-key spam instead of scrolling.

## Design (owner-locked)

### 1. agentd-native scroll (replaces SGR-wheel emulation for tmux terminals)

- Extend `terminal.navigate` with `{op: 'scroll', lines: <signed int>}` (clamp |lines| ≤ 120 per message; positive = scroll down toward live, negative = scroll up into history). Additive schema variant + fixture + CP relay (relay code is generic over navigate — schema + tests only).
- agentd `Navigate` handling (under the manager lock, against the VIEWER session's current pane P — resolve `#{pane_id}` of the viewer's active pane):
  - Read `#{pane_in_mode} #{alternate_on} #{mouse_any_flag}` for P in ONE display-message call.
  - If `pane_in_mode=1` → `send-keys -X -t P -N <|lines|> scroll-up|scroll-down`. (Entry always uses `copy-mode -e`, so scrolling down past the bottom exits copy-mode naturally.)
  - Else if `alternate_on=1 && mouse_any_flag=1` (full-screen TUI that wants mouse, e.g. codex) → deliver SGR wheel to the APP: `send-keys -t P -l` with literal `\x1b[<64;C;RM` / `\x1b[<65;C;RM` bytes, one event per 3 lines (remainder carried by the client), C;R = center cell of P. This mirrors tmux's own wheel passthrough; the app scrolls its own transcript.
  - Else if `alternate_on=1` (alt-screen app without mouse) → send Up/Down arrows ×|lines| (tmux's alternate-scroll parity).
  - Else (normal pane, live view): lines<0 → `copy-mode -e -t P` then `send-keys -X -N <|lines|> scroll-up`; lines>0 → no-op (already at live).
  - Zoom/Focus does not change any of this (P is the zoomed pane). Go tests on private sockets for all four branches + the copy-mode auto-exit round trip.
- Dashboard dispatcher (`useTerminalTouchScroll`): for connected writable tmux attachments (has `tmuxSessionKey`), convert vertical drag + momentum pixel deltas to line deltas (existing lineHeight math, now 1:1) and send `navigate {op:'scroll'}` via the controller, COALESCED per animation frame (sum lines, one message per frame, skip zero). Keep: normal-buffer → local `scrollLines` (unchanged); alternate-buffer WITHOUT a tmux navigate path → keep the existing SGR-wheel input fallback. Remove the 5-line report mapping from the tmux path (it stays only in the fallback).

### 2. Explicit keyboard (tap never summons)

- On mobile, xterm's textarea gets `inputMode='none'` by default — taps still focus/deliver key events but never pop the Android keyboard.
- New rail key `keyboard` (icon/label like the existing special keysyms, placed in the DEFAULT ultra-minimal set): toggles typing mode — sets `inputMode='text'` + focuses (keyboard opens); toggle off returns to `'none'`. Pressed state visible (like sticky-Ctrl). Detach/leave resets to off. Desktop behavior unchanged (inputMode untouched ≥1024px).
- The PromptComposer keeps its own input untouched. Hardware keyboards keep working in both modes (focus is preserved).

### 3. Explicit cursor-drag (rail-armed)

- DELETE the 450ms cursor-arm timer path from `useTerminalTouchScroll` (and the `terminal-cursor-armed` stand-down event it dispatched — the 500ms context-menu long-press no longer has a competitor; leave the context menu and touch-selection overlay code otherwise untouched).
- New rail key `cursor` (in the EXPANDED set, not the minimal default): arms cursor-drag for the NEXT touch gesture — that drag runs the existing `synthesizeCursorDragInput` machinery, then auto-disarms on gesture end. Pressed state visible while armed.
- Plain touches therefore always scroll. Keep pinch-zoom, horizontal pan/swipe, selection, and context-menu behavior exactly as-is.

## Work items

1. Schema + fixture: `scroll` navigate variant (+ CP schema test).
2. agentd: scroll op with the four-branch pane-state dispatch + Go tests (private sockets).
3. Dashboard: touch dispatcher rework (frame-coalesced navigate scroll; fallback preservation; cursor-timer removal) + unit tests for the mapping/gating/coalescing (pure functions exported, same style as today).
4. Rail: `keyboard` + `cursor` special keys, wiring in TerminalView/TerminalSurface (`inputMode` control), settings/config plumbing, pressed-state UI; update rail config tests.
5. Tests: extend journeys — swipe on attached terminal emits `navigate scroll` frames (no SGR in the tmux path), keyboard key toggles `inputMode`, no keyboard summon on plain tap (assert `inputMode` stays `'none'` after tap), cursor key arms exactly one gesture. All suites green.

## Ownership firewall

You may edit: `agents/agentd/**`, `packages/ac-schema/**` (additive), `services/control-plane/**` (tests only unless the relay genuinely needs a change), `apps/dashboard/src/(components/(terminal|tmux|mobile)|hooks|stores)/**`, `tests/fixtures/protocol/**` (new), `tests/journeys/**`, related tests. You may NOT edit: `deploy/**`, launch/orchestrator components, the descriptor-key/attachment contract in `terminalHostStore.ts`, letterbox logic, Focus/zoom logic in `mobileFocus.ts`/agentd zoom ownership (extend `Navigate` alongside, don't restructure), the scrollback pager, gesture timers you aren't explicitly told to remove.

## Gates

Full chain: `pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:smoke:dashboard && pnpm test:journeys && pnpm build` + Go build/vet/test in agents/agentd. Playwright from a tmux TTY. Commit per work item, prefix `feat(touch):`. ≤3 attempts per failure then hold. Note: two known journey load-flakes (roster attach/type input race; launch-sheet fill timeout) — if one fails, re-run it isolated before counting an attempt.

## Done

Handoff `tasks/frontend-ux-handoffs/fw6-touch.md`, committed, then print exactly:
`FW6-TOUCH FROZEN <full-sha>`
