---
lane: FW2-TERM
frozen_sha: 9b34dfbf7bd7005c7dd2d30c03c78f7682db6a71
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
  - "pnpm install -> completed before repository inspection or changes; @xterm/addon-search is the only dependency added"
  - "CHOKIDAR_USEPOLLING=1 WATCHPACK_POLLING=true pnpm lint && CHOKIDAR_USEPOLLING=1 WATCHPACK_POLLING=true pnpm typecheck && CHOKIDAR_USEPOLLING=1 WATCHPACK_POLLING=true pnpm test:ci && CHOKIDAR_USEPOLLING=1 WATCHPACK_POLLING=true pnpm test:smoke:dashboard && CHOKIDAR_USEPOLLING=1 WATCHPACK_POLLING=true pnpm build -> mandatory gate passed in order at 9b34dfbf7bd7005c7dd2d30c03c78f7682db6a71"
  - "pnpm lint -> 5/5 Turbo tasks passed"
  - "pnpm typecheck -> 5/5 Turbo tasks passed; Next route types generated successfully"
  - "pnpm test:ci -> 327 tests passed: dashboard 80, control-plane 166, schema 37, CLI 44"
  - "terminalFrameRouter.test.ts -> 250 steady-state output frames produced zero status/store writes"
  - "terminalHostStore.test.ts -> the same terminal object and buffer survived roster/terminal flips and route removal/return; changing descriptors replaced it"
  - "useTerminalScrollAnchor.test.ts -> new output preserved a scrolled-up viewport and explicit jump-to-live restored follow mode"
  - "pnpm test:smoke:dashboard -> 10/10 Chromium desktop, mobile, and tablet scenarios passed"
  - "pnpm build -> 4/4 Turbo tasks passed; Next.js 16.2.10 production build completed"
  - "mocked Playwright terminal check at 390x844 -> mobile search sheet rendered without overflow, exposed 1 / 2 match count, highlighted results, and retained 44px actions"
  - "frontend-product-design audit -> 97/100 with no hard fails; lint, typecheck, tests, responsive browser behavior, focus treatment, and keyboard search verified"
  - "git diff d565b005bcbdb204b40211392676e1be685a9ce5..9b34dfbf7bd7005c7dd2d30c03c78f7682db6a71 -- ownership audit -> only permitted terminal/dashboard paths changed; terminal protocol diff empty"
  - "git diff d565b005bcbdb204b40211392676e1be685a9ce5..9b34dfbf7bd7005c7dd2d30c03c78f7682db6a71 -- package manifests/lockfile -> only @xterm/addon-search 0.16.0 added"
assumptions:
  - "A terminal is hidden when no registered route slot is visible; the single host keeps one xterm instance and suspends its WebSocket after five hidden minutes."
  - "Opening a different terminal descriptor intentionally replaces the one allowed background terminal."
uncertainties:
  - "Real iOS hardware was not available; touch-sized controls, momentum-safe anchoring, and the mobile search sheet were verified in headless Chromium at 390x844."
blockers: []
---

# FW2-TERM handoff

## What changed

- The terminal output hot path now routes frames directly to xterm. Connection status and error state are guarded by refs and change only on actual transitions, so steady output causes no store/status writes or forced scrolling.
- Scroll following is anchored to whether the viewport is already live. Users reading history are not yanked down by output, and a compact `Live` action restores follow mode. Xterm scroll events and touch movement update the anchor without React writes per frame.
- Selection text stays in refs while dragging. The mobile selection popup and context menu read and position imperatively, with one React commit allowed when selection completes.
- Raw xterm data, Shift+Enter, clipboard paste/clear, and the virtual keyboard all send through `useTerminalConnection.sendInput`, including its read-only guard. There is one production `type: 'input'` construction site.
- `PersistentTerminalHost` is mounted once in `LayoutShell` and adopts the active route slot through a portal. It retains one xterm/connection across tmux roster flips and route navigation, keeps the existing in-page persistent region behavior, suspends the hidden WebSocket after five minutes, and reconnects through the existing resume-token path on return.
- Xterm scrollback is 10,000 lines. `@xterm/addon-search` supplies highlighted previous/next search, live match counts, and Ctrl/Cmd+F. Search is inline on desktop and a bottom sheet on mobile. Proposed xterm APIs are enabled because decorated search results require them in xterm 6.
- Stateful regression coverage proves object/buffer persistence, zero hot-path store writes across 250 output frames, descriptor replacement, and scroll anchoring.

## Decisions within lane latitude

- The host store owns at most one terminal descriptor. A second descriptor disposes the previous instance instead of growing a background terminal pool.
- A hidden timeout suspends the transport without discarding xterm history or the resume token. This satisfies the five-minute background limit while allowing the existing server flow to resume the terminal when its route returns.
- Search match state is held alongside the xterm search addon and surfaced through accessible labels and a polite live count. Search activation does not alter terminal protocol messages.
- The existing protocol shapes and server behavior remain untouched. The only dependency change is `@xterm/addon-search`.

## Verification and audit notes

- The complete required gate passed in one chained run at the frozen implementation SHA.
- The browser check initially exposed xterm's decorated-result API guard; enabling `allowProposedApi` fixed the runtime failure, and the corrected implementation then passed focused tests, the visual check, and the complete gate again.
- The frontend audit scored 97/100 with no hard failures: product fit 15/15, information architecture 15/15, visual design 14/15, dashboard clarity 15/15, interaction states 10/10, accessibility 14/15, responsive behavior 9/10, and performance polish 5/5. Deductions reflect the absence of real-device iOS verification.
- Existing smoke fixtures still print non-failing validation fallbacks for omitted `capture_hash` and `groups` fields; all ten smoke scenarios pass, and those schema/fixture shapes are outside this lane's ownership.

## Phase commits

- `d51302c` — `perf(terminal): remove state writes from output hot path`
- `e6c787b` — `feat(terminal): preserve scroll position on live output`
- `efca878` — `perf(terminal): remove selection drag from render path`
- `d35a327` — `perf(terminal): consolidate terminal input transport`
- `7e8bc29` — `feat(terminal): persist one terminal across navigation`
- `24cb0a7` — `feat(terminal): add scrollback search`
- `a8aa117` — `perf(terminal): prove persistence and output behavior`
- `9b34dfb` — `feat(terminal): enable decorated search results`

FW2-TERM FROZEN 9b34dfbf7bd7005c7dd2d30c03c78f7682db6a71
