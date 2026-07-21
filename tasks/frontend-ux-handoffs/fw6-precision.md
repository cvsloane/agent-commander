---
lane: FW6-PRECISION
frozen_sha: adc996e1bb39926e2e12b432b71ee6d97053b70d
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
  - "pnpm install → completed successfully as the first repository operation"
  - "focused dashboard unit coverage → freeze/live-follow state, touch selection geometry, exact history ranges, pane ordering, spatial navigation, triage targeting, command marks, settings fail-soft, and swipe resolution passed"
  - "CHOKIDAR_USEPOLLING=1 WATCHPACK_POLLING=true pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:smoke:dashboard && pnpm test:journeys && pnpm build → exact mandatory gate passed in order on gate attempt 2 from the fw6-precision-pw tmux TTY"
  - "pnpm lint → 5/5 Turbo tasks passed; one pre-existing useXtermTerminal exhaustive-deps warning remains non-failing"
  - "pnpm typecheck → 5/5 Turbo tasks passed; Next route types generated"
  - "pnpm test:ci → 5/5 Turbo tasks passed; dashboard 56 files/199 tests, control-plane 49 files/199 tests, schema 8 files/50 tests, and CLI 3 files/44 tests passed"
  - "pnpm test:smoke:dashboard from the fw6-precision-pw tmux TTY → 21/21 Chromium scenarios passed without browser exceptions"
  - "pnpm test:journeys from the fw6-precision-pw tmux TTY after the capture-only audit case was added → 19 passed and 7 expected skips across mobile and desktop projects"
  - "412x915 FW6 journey coverage → freeze plus explicit jump-to-tail, exact contiguous pager copy, and thumbnail pane open/switch all passed"
  - "pnpm build → 4/4 Turbo tasks passed; Next.js 16.2.10 production build completed"
  - "Go 1.24 Docker gate in agents/agentd → gofmt clean, go build ./..., go vet ./..., and go test ./... passed"
  - "PLAYWRIGHT_CAPTURE_UI=1 responsive audit case → 360x800, 768x1024, and 1366x768 captures produced and visually inspected"
  - "frontend-product-design audit script plus manual three-width review → 94/100 with no hard failures"
  - "git diff --check 133bb1e..adc996e → pass; ownership scan found only permitted dashboard terminal/tmux/mobile/settings/hooks/libs, related tests, and the minimal agentd shell-launch surface"
assumptions:
  - "Negative pager line numbers are tmux-relative capture positions and remain stable within each loaded range."
  - "The default owned Bash template is the correct boundary for shell integration; custom commands and non-Bash shells must remain untouched."
  - "A pane thumbnail cap of 12 preserves fast scanning while prioritizing selected, waiting, and recently used panes."
uncertainties:
  - "A physical Android/Brave device was unavailable; touch, clipboard, gesture, and 412x915 behavior were exercised in Chromium through Playwright."
  - "Live OSC 133 passthrough through a real spawned tmux shell and browser viewer was not exercised end to end. Agentd command generation, allow-passthrough setup, dashboard parsing, decorations, and rail navigation are tested; agent prompt marks remain intentionally labeled Approx."
  - "The visual harness intentionally returns 404 for PUT /v1/settings, so tablet and desktop captures show the new one-time local-settings toast; the app remains usable underneath as designed."
blockers: []
---

# FW6-PRECISION handoff

## Outcome

FW6-PRECISION extends the shipped Wave 6 rail, full-bleed terminal, attach-everywhere flow, and letterbox behavior with precise mobile reading and navigation tools. Streamed output now respects a reader's saved viewport and reports buffered lines, touch selection is cell-owned, scrollback copies exact line ranges, and pane/window movement is both visual and spatial. Collapsed waiting work is directly actionable, shell and agent turns gain navigable marks, and cloud-settings failures stay local and non-fatal.

## Delivered work

- Stream freeze records the exact xterm viewport when the operator scrolls away, counts incoming newlines, and restores the saved viewport after each write. The explicit pill is the only path back to live output. Frames that begin at the live tail continue following it without stealing focus, including xterm's intermediate write-time scroll events.
- Mobile touch selection maps screen coordinates to buffer cells. Double-tap selects and copies a word; start/end handles extend ordered multi-row selections cell by cell; the accessible local status surface exposes Copy and clears when cursor mode begins.
- The history pager renders stable tmux-relative line numbers with 32px rows. First tap anchors, second tap extends, and Copy selected lines emits the exact underlying contiguous text while filter and Copy all/matches remain independent.
- The pane switcher presents up to 12 selected/waiting/recent panes with the last six snapshot lines and distinct Approval, Waiting, Running, Error, and Idle badges. A horizontal terminal swipe moves to the adjacent tmux window through the existing real select-window and viewer-retarget path, while letterbox horizontal pan wins when available.
- Directional pane controls parse leaf geometry from `window_layout`, rank half-plane candidates by overlap and distance, and fall back to linear order only when topology geometry is absent or incomplete.
- Collapsed cluster and orchestrator rows expose separate approval/waiting badges. Badge activation and the Waiting filter expand the relevant group, focus it, and smooth-scroll the first matching pane without attaching or leaving the roster.
- Owned default Bash launches enable tmux passthrough and inject OSC 133 command boundaries. Exact shell boundaries render green; heuristic agent prompt boundaries render violet and carry an explicit `Approx.` label. The expanded rail exposes previous/next marks, and the current boundary remains sticky while its output scrolls.
- Both initial and debounced settings PUTs pass through one fail-soft saver. Failure never rejects into React or mutates hydrated local stores, and only the first failure emits the `Settings saved locally` toast.
- A new 412x915 journey file proves freeze/release, exact pager clipboard content, and pane thumbnail switching. Its opt-in visual case captures the changed surfaces at the required mobile, tablet, and desktop widths.

## Decisions within lane latitude

- The existing terminal hot path remains imperative: buffered line text and pill visibility update without adding React state or timers per frame.
- Exact selection and spatial ranking live in pure helpers, keeping xterm and topology UI adapters small and directly unit-testable.
- Shell markers are injected only for the repository-owned default Bash template. Custom shell templates and configured non-Bash shells retain their prior command and environment exactly.
- Settings failure notification is deduplicated for the lifetime of `SettingsSync`; subsequent local changes continue to work and may retry persistence without multiplying toasts.
- Batch 1 composition was extended in place. No replacement rail, terminal surface, attachment contract, letterbox grid policy, or navigation system was introduced.

## Verification and quality review

- The complete required gate passed from a real tmux TTY on the second gate attempt. The first attempt exposed two real integration defects: xterm write-time scroll events could create a false freeze, and Tailwind's `inline-flex` could override the pill's HTML `hidden` attribute. Both were corrected and regression-covered before the green run.
- The final standalone journey run, after adding the opt-in screenshot case, finished with 19 passes and 7 intentional skips. The screenshot-only case separately passed 1/1 with capture enabled.
- Captures inspected: pane thumbnails at 360x800, attached terminal and rail at 768x1024, and the desktop Command Center terminal at 1366x768. Labels truncate intentionally, controls remain separated, the preview grid stays readable, and no primary action clips or overlaps.
- Frontend audit: product fit 15/15, information architecture 14/15, visual design 13/15, dashboard/data clarity 14/15, interaction states 9/10, accessibility 14/15, responsive behavior 10/10, and performance polish 5/5 = 94/100. Deductions reflect inherited operator density, the mock-only settings toast in captures, and unavailable physical-device/screen-reader proof; there were no hard failures.
- The Go launch surface passed formatting, build, vet, and all package tests in the pinned Go 1.24 container. No schema, service, deployment, secret, paid operation, live tmux server, or production data was changed.
- No code was pushed. The `frozen_sha` is the final implementation/test commit; the following handoff-only commit adds this file.

## Work-item commits

- `50ee717` — `feat(mobile-precision): freeze streamed output while reading`
- `bca57c7` — `feat(mobile-precision): own touch terminal selection`
- `e5aed44` — `feat(mobile-precision): copy exact history line ranges`
- `2155bd7` — `feat(mobile-precision): switch panes with previews and swipes`
- `4df6285` — `feat(mobile-precision): navigate panes by layout geometry`
- `028fd70` — `feat(mobile-precision): chain waiting roster triage`
- `84a2728` — `feat(mobile-precision): tighten spatial target typing`
- `4cbb827` — `feat(mobile-precision): mark shell commands and agent turns`
- `330d424` — `feat(mobile-precision): keep settings sync fail-soft`
- `adc996e` — `feat(mobile-precision): prove precision mobile journeys`

FW6-PRECISION FROZEN adc996e1bb39926e2e12b432b71ee6d97053b70d
