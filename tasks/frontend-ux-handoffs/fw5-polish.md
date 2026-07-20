---
lane: FW5-POLISH
frozen_sha: 9ceed372d75d39eac2d9406bd48ca2b5f1f54436
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
  - "pnpm install → completed successfully as the first repository operation, before inspection or implementation"
  - "CHOKIDAR_USEPOLLING=1 WATCHPACK_POLLING=true PLAYWRIGHT_CAPTURE_UI=1 pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:smoke:dashboard && pnpm build → exact mandatory gate passed in order on attempt 1 in the fw5-polish-gate tmux TTY; exit 0"
  - "pnpm lint → 5/5 Turbo tasks passed"
  - "pnpm typecheck → 5/5 Turbo tasks passed; Next route types generated"
  - "pnpm test:ci → 5/5 Turbo tasks passed; dashboard 38 files/145 tests and control-plane 49 files/198 tests passed"
  - "pnpm test:smoke:dashboard → 20/20 Chromium scenarios passed in 1.1 minutes from a real tmux TTY"
  - "pnpm build → 4/4 Turbo tasks passed; Next.js 16.2.10 production build completed"
  - "PLAYWRIGHT_CAPTURE_UI=1 → desktop, tablet, and 390x844 mobile Command Center/terminal/surface artifacts captured under test-results and visually inspected"
  - "Dark-theme browser probe → persisted dark theme rendered the Command Center with token-consistent surfaces and controls; html class was dark"
  - "Frontend product-design audit → 97/100 with no hard failures"
  - "git diff --name-only fa0ba72..9ceed37 → dashboard visual/a11y/motion/probe code, related dashboard tests, dashboard package manifest, and generated pnpm lockfile only; no packages, services, agents, smoke journeys, deploy files, or program docs changed"
assumptions:
  - "The existing opt-in sessions performance channel, enabled by window.__sessionsPerf or ?perf=1, is the intended telemetry path for measurement-only browser probes."
  - "A one-percent random sample of binary terminal output frames is sufficient to bound frame-to-paint instrumentation overhead."
  - "Semantic warning, error, and success colors may remain explicit when paired for light and dark contrast; decorative accents should use shared theme tokens."
uncertainties:
  - "Real iOS hardware and a physical software keyboard were unavailable; safe areas, visualViewport keyboard insets, focus behavior, and 390x844 containment were verified in Chromium."
  - "A full screen-reader session was unavailable; browser roles, names, expanded/selected state, keyboard contracts, Radix focus behavior, and reduced-motion CSS are covered by tests and review."
blockers: []
---

# FW5-POLISH handoff

## What changed

- Loading and empty states: added shared skeleton and empty-state primitives, reserved roster/fleet loading space to avoid layout shift, and applied one empty-state treatment to tmux, fleet attention, and hosts. Mobile roster/terminal changes use a short CSS transition, and connection banners plus toasts now stack above the fixed navigation safely.
- Accessibility: the tmux roster now exposes a tree/treeitem/group hierarchy with expanded and selected state. Window tabs and the key bar support arrow, Home, and End navigation; icon-only controls have accessible names; focus-visible rings are consistent; and animated transitions honor reduced motion. The launch and tmux action surfaces now use the existing Radix Sheet primitive for focus trapping, Escape dismissal, and trigger-focus restoration.
- Mobile viewport: a visualViewport/editable-focus hook publishes `--keyboard-inset-height` and virtual-keyboard state. Bottom navigation and key controls yield to the software keyboard, while the terminal, prompt composer, search sheet, and safe-area padding reserve their own space instead of overlapping.
- Performance probes: added `web-vitals` 5.3.0 to the dashboard manifest and lockfile, reporting CLS, FCP, INP, LCP, and TTFB through the existing opt-in `[perf] client.metric` channel. A one-percent terminal probe measures binary WebSocket receipt through xterm's write callback and the following animation frame. The obsolete JSON/base64 terminal-output client decoder was removed; string output frames are rejected.
- Theme harmony: replaced decorative hardcoded accent colors on Wave 3/4 command surfaces with shared primary, destructive, muted, and background tokens. Explicit status colors now include suitable light/dark variants.
- Coverage: added source-contract accessibility tests, terminal frame-timing tests, binary-only protocol coverage, and viewport keyboard-inset assertions without editing the FW5-QA-owned Playwright journey suite.

## Decisions within lane latitude

- Shared primitives were extended or reused rather than introducing another loading, empty-state, or overlay system.
- Keyboard-open state requires both a reduced visual viewport and focus in an editable control. This avoids hiding navigation for ordinary viewport resizing while still handling iOS software-keyboard overlap.
- Core Web Vitals are dynamically loaded on the client, and both probe families feed the existing opt-in console telemetry path; this lane adds no transport, storage, dashboard, or data-flow behavior.
- Terminal sampling starts only for negotiated binary payloads. The xterm completion callback plus the next animation frame is the closest low-overhead browser-side paint boundary available without adding an observer or changing terminal behavior.
- The caret-color hydration notices printed during screenshot smoke runs are Playwright capture instrumentation already documented by the preceding surfaces lane; no dashboard caret-color source exists, and all assertions and builds pass.

## Verification and quality review

- The complete mandatory gate passed once, in the prescribed order. Playwright ran inside a dedicated tmux TTY with filesystem polling enabled and screenshot capture on.
- Captures inspected: Command Center desktop/tablet/mobile, tmux terminal desktop, terminal attention/composer mobile, and the separate dark-theme Command Center probe. No clipped primary actions, unsafe fixed-surface overlap, illegible status treatment, theme-token regression, or accessibility hard failure was found.
- Frontend audit: product fit 15/15, information architecture 14/15, visual design 14/15, dashboard/data clarity 14/15, interaction states 10/10, accessibility 15/15, responsive behavior 10/10, and performance polish 5/5 = 97/100. Deductions reflect inherited operator density and the lack of physical iOS/screen-reader verification.
- Scope remained inside the timebox. No follow-on feature, data-flow, backend, smoke-suite, deployment, or program-document change was included.

## Work-item commits

- `9a2936b` — `polish: refine loading and empty command states`
- `5c7509c` — `polish: complete command center accessibility pass`
- `665fd5f` — `polish: harden mobile safe area layout`
- `c4d3e5b` — `polish: instrument frontend performance probes`
- `028c18b` — `polish: harmonize command center themes`
- `9ceed37` — `polish: lock accessibility contracts`

FW5-POLISH FROZEN 9ceed372d75d39eac2d9406bd48ca2b5f1f54436
