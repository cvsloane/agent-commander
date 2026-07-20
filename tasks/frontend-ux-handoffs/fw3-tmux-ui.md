---
lane: FW3-TMUX-UI
frozen_sha: 6526629f258aca0d6bc16e0b02f4a21d57c0ede6
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
  - "pnpm install → completed before repository inspection or changes; lockfile unchanged and no dependencies added"
  - "CHOKIDAR_USEPOLLING=1 WATCHPACK_POLLING=true pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:smoke:dashboard && pnpm build → complete mandatory gate passed in order on the accepted FW3-SHELL integration"
  - "pnpm lint → 5/5 Turbo tasks passed"
  - "pnpm typecheck → 5/5 Turbo tasks passed; Next route types generated successfully"
  - "pnpm test:ci → 389 tests passed: dashboard 99, control-plane 198, schema 48, CLI 44"
  - "pnpm test:smoke:dashboard → 14/14 Chromium scenarios passed, including canonical root routing, desktop tmux controls, mobile selection, the window strip, and the scrollback pager"
  - "pnpm build → 4/4 Turbo build tasks passed; Next.js 16.2.10 production build completed"
  - "focused tmux Vitest run → 14/14 topology, window-action, pane-version, quick-switch, scrollback-paging, and canonical-route tests passed"
  - "focused integrated Playwright rerun after minimizing the smoke diff → 3/3 desktop/mobile tmux scenarios passed"
  - "PLAYWRIGHT_CAPTURE_UI=1 focused Playwright run → desktop terminal and 390x844 mobile history screenshots captured and visually inspected"
  - "frontend-product-design audit_frontend.sh → lint, typecheck, and tests passed; manual responsive/state audit scored 95/100 with no hard fails"
  - "git diff --name-only 7dfcf787523e524ed48ed42b5b27d3fc922e92f5..6526629f258aca0d6bc16e0b02f4a21d57c0ede6 -- forbidden ownership paths → empty"
assumptions:
  - "A host supports percentage splits only when tmux_version/tmuxVersion or a parseable agent version proves tmux >= 3.1; unknown versions conservatively receive a plain split."
  - "Receipt of tmux.topology feature-detects live topology independently per host; hosts that emit nothing remain fully functional through roster-derived windows and panes."
  - "The existing UI recent-session store is the shared source for the launch rail and mobile pane switcher."
uncertainties:
  - "The command endpoint confirms dispatch acceptance but exposes no UI command-result topic. Optimistic state rolls back on immediate HTTP failure and later authoritative topology reconciles remote execution outcomes."
  - "Real iOS hardware was unavailable; touch targets, horizontal strips, the action sheet, and the history overlay were verified in Chromium at 390x844."
  - "Backend launch/open responses still return legacy /tmux hrefs. The sibling redirect preserves their query state, while roster navigation now targets / directly and avoids that remount."
blockers: []
---

# FW3-TMUX-UI handoff

## What changed

- Topology: a per-host Zustand store consumes `tmux.topology`, joins panes to tracked roster sessions, and derives equivalent sessions/windows/panes from roster metadata until each host actually emits live topology. Repeated identical rosters are reference-stable to avoid subscription render loops.
- Window management: the workbench terminal has an accessible tab strip for active state, activity/bell indicators, select, inline rename, close, and new-window actions. Mutations are optimistic with HTTP-error rollback/toasts, and closing the last window requires the exact hard confirmation that the whole tmux session will end.
- Pane management: desktop and mobile controls dispatch horizontal/vertical splits, zoom, directional selection, and confirmed pane kill. Percentage split payloads are capability-gated. The desktop tmux key bar is collapsible, defaults closed, and persists its preference.
- Terminal composition: desktop can mount one independent secondary foreground terminal beside the persistent primary terminal, remembers a same-host secondary per primary session, and closes without expanding the one-background-terminal budget. Mobile remains single-terminal and adds a horizontally scrollable recent-pane strip sourced from the shared recent-session state.
- History: `View history` opens a responsive, searchable, selectable overlay that requests 500-line ranges, loads older ranges from the top, virtualizes rendered rows, and supports copying all content or matches without mutating the xterm buffer.
- Tests: unit coverage locks topology live/fallback behavior, reference stability, optimistic action payloads/rollback/last-window confirmation, version-gated splits, recent ordering, range paging, and canonical route construction. Playwright covers desktop strip/two-up composition plus mobile strip/history and canonical-root pane selection.

## Decisions within lane latitude

- Live topology is feature-detected by event receipt, not configuration or optimistic assumptions, because most deployed hosts may still have topology events disabled.
- Unknown or old tmux versions omit the split percentage rather than risking an unsupported command flag.
- The primary terminal retains `PersistentTerminalHost`; only the visible desktop secondary uses an additional direct `TerminalView`. The secondary is never mounted on mobile or while hidden.
- Scrollback stays in a separate pager by design; older content is never prepended into xterm.
- Following the AI Lead addendum, `useTmuxRosterData` now builds in-app navigation from `/` while retaining every query parameter. Incoming `/tmux?...` compatibility remains owned by and verified with the sibling query-preserving redirect.

## Frontend quality audit

The integrated surface scored 95/100 with no hard failures: product fit 15/15, information architecture 14/15, visual design 13/15, dashboard/data clarity 15/15, interaction states 9/10, accessibility 14/15, responsive behavior 10/10, and performance polish 5/5. Desktop and mobile screenshots were inspected after rebasing onto the accepted root Command Center shell; compact desktop controls no longer clip at 1280px, and the mobile history sheet has no horizontal overflow.

## Phase commits

- `57f46f6` — `feat(tmux-ui): add live topology store with roster fallback`
- `0932c1c` — `feat(tmux-ui): add optimistic tmux window strip`
- `07e19e5` — `feat(tmux-ui): add pane controls and desktop key bar`
- `ef3746b` — `feat(tmux-ui): add remembered desktop two-up terminals`
- `7a8ecbf` — `feat(tmux-ui): add mobile recent pane switcher`
- `4aca3da` — `feat(tmux-ui): add virtualized scrollback pager`
- `6526629` — `feat(tmux-ui): add tmux interaction coverage`

FW3-TMUX-UI FROZEN 6526629f258aca0d6bc16e0b02f4a21d57c0ede6
