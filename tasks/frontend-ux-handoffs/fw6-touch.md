---
lane: FW6-TOUCH
frozen_sha: 3008c251b80c79b06975c54c79503d7c4a0620b7
attempt: 1
state: frozen
gates:
  lint: pass
  typecheck: pass
  test_ci: pass
  smoke: pass
  journeys: pass
  build: pass
  go: pass
proof:
  - "CHOKIDAR_USEPOLLING=1 WATCHPACK_POLLING=true pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:smoke:dashboard && pnpm test:journeys && pnpm build && (cd agents/agentd && go build ./... && go vet ./... && go test ./...) → exact mandatory gate passed in order on attempt 1 from the fw6-touch-builder tmux TTY"
  - "pnpm lint → all 5 Turbo tasks passed with zero errors; three existing hook warnings remain"
  - "pnpm typecheck → all 5 Turbo tasks passed"
  - "pnpm test:ci → all 5 Turbo tasks passed, including schema, dashboard, control-plane, and CLI suites"
  - "pnpm test:smoke:dashboard → 21/21 Chromium scenarios passed"
  - "pnpm test:journeys → 32 passed and 14 expected project skips across mobile and desktop"
  - "pnpm build → 4/4 Turbo build tasks passed; Next.js 16.2.10 production build completed"
  - "go build ./... && go vet ./... && go test ./... from agents/agentd → all packages passed, including private-socket tmux integration coverage"
  - "FW6 Touch focused journeys → native-scroll, keyboard, cursor, history, and zoom scenarios passed 5/5 at 412x915"
  - "Playwright trace audit → mobile 412x915 and desktop 1280x720 attachment flows passed; frontend quality score 96/100 with no hard failures"
assumptions:
  - "A signed scroll line uses the locked protocol convention: negative enters history and positive moves toward live."
uncertainties:
  - "A physical Galaxy S25 Ultra was unavailable; the owner-device layout and touch behavior were exercised in the 412x915 Chromium mobile project."
blockers: []
---

# FW6-TOUCH frozen handoff

## Outcome

FW6-TOUCH replaces coarse tmux wheel emulation with frame-coalesced native line scrolling and removes the two competing mobile touch behaviors. Plain terminal touches now scroll without opening the software keyboard, while Keyboard and Cursor modes are explicit rail actions with visible pressed state and deterministic reset behavior.

## Delivered work

- Added the bounded `terminal.navigate` scroll variant with signed integer lines, protocol fixtures, schema boundary coverage, Go fixture parity, and control-plane relay proof.
- Added viewer-scoped agentd scroll dispatch under the terminal manager lock. A single pane-state lookup selects copy-mode scrolling, literal SGR delivery for mouse-aware alternate-screen apps, arrow-key parity for non-mouse alternate-screen apps, or live normal-pane copy-mode entry. Private tmux sockets prove all four branches and copy-mode auto-exit.
- Reworked connected writable tmux touch scrolling to map pixel movement to lines 1:1, coalesce and clamp frames, preserve overflow for later frames, and skip zero-line messages. Normal-buffer scrolling remains local, and alternate-buffer attachments without a navigate path retain the existing SGR fallback.
- Removed the 450ms cursor-arm path and its stand-down event. The expanded Cursor rail key arms exactly one gesture, delegates to the existing cursor-drag synthesizer, and auto-disarms at gesture end.
- Added Keyboard to the ultra-minimal rail. On mobile, xterm's helper textarea defaults to `inputMode="none"`; Keyboard toggles it to `text` and focuses it, while toggling off, detaching, leaving, or disconnecting resets it. Desktop textareas are untouched and PromptComposer was not changed.
- Extended rail configuration, accessibility contracts, pure-function unit tests, and Playwright journeys for native scroll frames, no-SGR tmux dispatch, plain-tap keyboard suppression, keyboard toggling, and one-shot cursor gestures.

## Decisions within the locked design

- The existing stable host/tmux-session descriptor supplies the navigate path; its attachment-key contract was passed through without restructuring.
- Coalescing is isolated in a pure reducer: each animation frame emits at most one message bounded to 120 lines and carries any excess into a later scheduled frame.
- Built-in presets are resolved from current definitions so persisted minimal/expanded selections receive the new keys without rewriting user storage. Custom rail configurations continue to honor their saved key list.
- Mobile input-mode control is applied to the active xterm helper textarea and guarded by the existing `<1024px` breakpoint; focus is preserved so hardware keyboards continue working in either software-keyboard mode.

## Verification notes

- The complete required command chain passed on its first attempt from the `fw6-touch-builder` tmux TTY. No known journey load flake occurred.
- Additional trace-on browser runs passed for the 412x915 Keyboard journey and the 1280x720 attach/type/detach journey. Visual inspection found no clipping, horizontal overflow, overlap, illegible state, or desktop input regression; the audit score was 96/100 with no hard fail.
- Agentd tests used repository-private tmux sockets and did not query or mutate the default tmux server.
- The ownership firewall was preserved: no deploy, launch/orchestrator, descriptor-key contract, letterbox, Focus/zoom, scrollback pager, unrelated gesture timer, production state, or remote branch was changed.

## Work-item commits

- `500232d` — `feat(touch): add native terminal scroll contract`
- `6616c89` — `feat(touch): dispatch native scroll in agentd`
- `4d01a5a` — `feat(touch): dispatch coalesced native scroll`
- `8bfb225` — `feat(touch): add keyboard and cursor rail modes`
- `3008c25` — `feat(touch): cover explicit mobile touch modes`

The `frozen_sha` is the final implementation/test commit; the following handoff-only commit adds this file.

FW6-TOUCH FROZEN 3008c251b80c79b06975c54c79503d7c4a0620b7
