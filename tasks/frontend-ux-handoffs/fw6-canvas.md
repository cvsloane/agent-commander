---
lane: FW6-CANVAS
frozen_sha: a593fc69a95c93fd934814cba2ff7105b7133cbb
attempt: 1
state: frozen
gates:
  lint: pass
  typecheck: pass
  test_ci: pass
  smoke: pass
  build: pass
  go: n/a
proof:
  - "pnpm install → completed successfully as the first repository operation"
  - "focused dashboard unit suite → 4 files and 14/14 rail-config, sticky-Ctrl, prefix, pinch, and cursor-drag tests passed"
  - "412x915 Android Playwright check from the fw6-canvas-pw tmux TTY → attached terminal exposed at least 40 protocol rows at 14px, had no page scroll, docked the rail above a simulated 360px keyboard inset, and kept the connection plus rail alive after pinch zoom"
  - "PLAYWRIGHT_CAPTURE_UI=1 → terminal-full-bleed-android.png captured at 412x915 and visually inspected; only the status row, compact window strip, terminal, rail, and transient attention overlay were visible"
  - "pnpm lint → 5/5 Turbo tasks passed"
  - "pnpm typecheck → 5/5 Turbo tasks passed; Next route types generated"
  - "pnpm test:ci → 5/5 Turbo tasks passed; dashboard 41 files/158 tests, control-plane 49 files/198 tests, schema 8 files/48 tests, and CLI 3 files/44 tests passed"
  - "pnpm test:smoke:dashboard from the fw6-canvas-pw tmux TTY → 21/21 Chromium scenarios passed in 1.0 minute"
  - "CHOKIDAR_USEPOLLING=1 WATCHPACK_POLLING=true pnpm build → 4/4 Turbo tasks passed; Next.js 16.2.10 production build completed"
  - "frontend-product-design audit script plus manual 412x915 review → 96/100 with no hard failures"
  - "ownership scan d34b3c2..a593fc6 → dashboard terminal/tmux/mobile/session components, terminal hooks/libs/settings, globals CSS, and related tests only; no packages, services, agents, terminal protocol shapes, useTerminalConnection resize policy, or navigation wiring changed"
assumptions:
  - "A 360px inset is a representative keyboard-open simulation for the locked 412x915 Android viewport; the existing visualViewport hook supplies the same inherited CSS variable on devices without VirtualKeyboard overlay support."
  - "An xterm line height of 1.15 preserves the locked 14px font while meeting the closed-keyboard row budget without shrinking the 44px rail targets."
  - "Actions remains part of the attached full-screen surface while its sheet is open; returning to Roster restores the existing Command Center chrome."
uncertainties:
  - "Physical S25 Ultra / Brave verification was unavailable in this lane; Chromium Android metrics, touch events, VirtualKeyboard/CSS inset behavior, and the Brave user agent were exercised in Playwright."
  - "Clipboard permission prompts differ by Brave installation state; the Chromium readText path and a prompt fallback are implemented, but the owner-locked guided device check remains the final hardware proof."
blockers: []
---

# FW6-CANVAS handoff

## What changed

- Full-bleed canvas: attached mobile terminals now occupy a fixed `100dvh` surface above the Command Center, with one compact status row, the ~28px auto-scrolling window strip, the terminal, and one rail. App chrome, mode/card/terminal headers, bottom navigation, and the collapsed prompt launcher no longer consume terminal rows; Actions stays available from the overflow button and Roster restores its prior chrome.
- Readable terminal type: the default is 14px, the settings slider clamps to 11–18px, and two-finger pinch updates the live xterm fit without disconnecting. A 1.15 line height provides at least 40 rows at 412x915 while retaining the locked font size.
- Unified key rail: `TerminalKeyRail` replaces the two terminal key strips with the locked Esc, sticky-Ctrl, and arrow default. Ctrl supports one-shot, hold/chaining, and double-tap lock; active Ctrl swaps arrows to Home/End/PgUp/PgDn. The default six keys fit without horizontal scrolling and retain 44px targets, haptic ticks, popup gestures, and keyboard-inset docking.
- Configurable input: settings now persist validated JSON keysym/chord/macro/popup definitions and offer the expanded Tab/prefix/History/`y↵`/`/compact` preset. History opens the existing scrollback pager rather than creating another surface.
- Touch cursor mode: long-press plus movement emits proportional arrow sequences at three acceleration tiers and exits on release. The movement threshold cancels the context menu; a stationary long-press continues to open it.
- Host prefix and paste: prefix bindings resolve each selected host's configured tmux prefix (default C-b) without a hard-coded runtime byte. Android/Brave paste tries `navigator.clipboard.readText()` and falls back to an actionable prompt; the obsolete iOS-only hint is gone.
- Coverage: unit tests exercise rail parsing/resolution, sticky Ctrl, host prefixes, pinch, and cursor synthesis. The new Playwright scenario proves the 412x915 row budget, no-scroll full bleed, keyboard-open rail position, and pinch connection stability, while existing mobile smoke assertions were updated for the status-row and Actions-sheet contracts.

## Decisions within lane latitude

- The attached shell is fixed to the mobile viewport instead of hiding unrelated Command Center siblings by selector. This makes the four-part terminal surface independent of the route that selected it and leaves navigation wiring untouched.
- The collapsed prompt launcher is omitted only in full-bleed mode. Attention `Respond` still opens and focuses the composer imperatively, preserving agent workflows without permanently spending terminal rows.
- Font updates use a ref for initial xterm construction and the existing live option/fit effect afterward. This keeps connection callbacks stable during pinch and slider changes.
- Grid/resize behavior and viewer retargeting remain entirely with FW6-FLOW/FW6-NAV as required by the firewall.

## Verification and quality review

- The mandatory gates passed in order. The full Playwright suite ran from the dedicated `fw6-canvas-pw` tmux TTY and finished 21/21 green; the production build followed successfully.
- The 412x915 capture was inspected in both keyboard-closed behavior and a 360px keyboard-inset simulation. The rail sat directly above the simulated OS keyboard region, the status and window labels fit, primary controls remained named and visible, and pinch retained `Connected` state.
- Frontend audit: product fit 15/15, information architecture 14/15, visual design 14/15, dashboard/data clarity 15/15, interaction states 9/10, accessibility 14/15, responsive behavior 10/10, and performance polish 5/5 = 96/100. Deductions reflect the lack of physical Brave keyboard and full screen-reader verification; there were no hard failures.
- No code was pushed. The `frozen_sha` is the final implementation/test commit; the following handoff-only commit adds this file.

## Work-item commits

- `30e0473` — `feat(mobile): make attached terminal full bleed`
- `eb26f5d` — `feat(mobile): add readable terminal font controls`
- `8ad343b` — `feat(mobile): replace terminal key strips with rail`
- `b4643d0` — `feat(mobile): add touch cursor drag mode`
- `c4bf7a6` — `feat(mobile): support per-host tmux prefixes`
- `a71bc80` — `feat(mobile): make Android terminal paste actionable`
- `5c91e16` — `fix(mobile): meet attached terminal row budget`
- `a593fc6` — `test(mobile): cover terminal canvas and rail`

FW6-CANVAS FROZEN a593fc69a95c93fd934814cba2ff7105b7133cbb
