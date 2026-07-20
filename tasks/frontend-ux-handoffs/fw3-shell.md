---
lane: FW3-SHELL
frozen_sha: 5bba177668402700f393fa9b64b64d8dc9dc83f5
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
  - "pnpm install → completed before implementation; lockfile unchanged"
  - "pnpm lint → 5/5 Turbo tasks passed"
  - "pnpm typecheck → 5/5 Turbo tasks passed; Next route types generated"
  - "pnpm test:ci → 5/5 Turbo tasks passed, including the new launch-definition and shell-contract tests"
  - "PLAYWRIGHT_DASHBOARD_PORT=3320 CHOKIDAR_USEPOLLING=1 WATCHPACK_POLLING=true pnpm test:smoke:dashboard → 13/13 passed"
  - "CHOKIDAR_USEPOLLING=1 WATCHPACK_POLLING=true pnpm build → 4/4 Turbo tasks passed; Next production build completed"
  - "PLAYWRIGHT_DASHBOARD_PORT=3321 CHOKIDAR_USEPOLLING=1 WATCHPACK_POLLING=true pnpm verify:launch → schema 48/48, control-plane 198/198, typechecks, and dashboard smoke 13/13 passed"
  - "Browser screenshots → test-results/dashboard-renders-Command--3c155-redirects-legacy-tmux-links-chromium/command-center-{mobile,tablet,desktop}.png"
  - "Orchestrator browser screenshots → test-results/dashboard-uses-unified-bot-6e796-orchestrator-card-on-mobile-chromium/orchestrator-mobile{-top,}.png"
  - "Frontend quality audit → 93/100, no hard fails"
assumptions:
  - "The existing design tokens and tmux component behavior remain the source of truth; this lane changes only shell-owned composition around them."
  - "The /orchestrator route remains the durable deep-link target while its presentation is shared with the desktop attention sheet."
uncertainties:
  - "useTmuxRosterData still emits /tmux query URLs. The canonical redirect preserves every query parameter, but a plain mobile roster selection remounts at / and leaves the operator on Roster with Terminal enabled; the verified path uses the Terminal tab. A sibling tmux lane can remove that extra tap by letting TmuxPageClient/useTmuxRosterData accept the canonical route base without duplicating shell state."
blockers: []
---

# FW3-SHELL handoff

## What changed

- Command Center: `/` now frames the live tmux fleet with the top attention item and persistent launch rail. The v0.2 landing was removed, `/tmux` redirects to `/` while retaining query parameters, PWA/sign-in entry points are canonical, and the displaced usage/quick-stat surfaces live under Settings.
- Navigation: desktop and mobile share the Command Center, Attention, and Sessions destinations. Mobile has a single More-owned drawer, the hamburger is gone, the header is reduced to identity, connection, attention, theme, and account controls, and nav targets meet the 44px minimum.
- Attention: page and desktop-sheet presentations now render one `OrchestratorSurface` tree fed by `useAttentionQueue`; the prior modal/page duplication is deleted. Mobile bell and tab both route to the page, while desktop bell opens the focus-restoring sheet.
- Launch: Command Center and Sessions use one `LaunchRail` and one `MobileLaunchSheet` for New, Recent, and Open existing. Provider/template definitions and recent-launch persistence are centralized, repository recents lead the picker, and the legacy spawn dialog is deleted.
- Tests: added shell-contract and definition unit coverage plus mobile/tablet/desktop smoke coverage for canonical routing, unified navigation, shared attention presentation, launch entry points, tap sizes, and horizontal overflow.

## Decisions and quality review

- Kept the 768px navigation contract and the explicit 1024px Command Center shell switch in the shared `useIsMobile` source.
- Preserved the tmux ownership firewall. No files under `src/components/tmux/**`, terminal/session internals, packages, services, agents, or deploy were edited.
- Frontend audit: Product fit 15/15, information architecture 15/15, visual design 13/15, dashboard clarity 14/15, interaction states 9/10, accessibility 13/15, responsive behavior 10/10, performance polish 4/5 = 93/100. No hard fails. Chromium screenshots were visually inspected at 390x844, 768x1024, and 1280x720.

## Deferred to the tmux owner

Expose a canonical route-base option for `TmuxPageClient`/`useTmuxRosterData` so root-mounted selection updates `/?...` directly. That will preserve the existing automatic mobile roster-to-terminal transition without this lane changing tmux internals.

FW3-SHELL FROZEN 5bba177668402700f393fa9b64b64d8dc9dc83f5
