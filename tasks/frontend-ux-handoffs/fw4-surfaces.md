---
lane: FW4-SURFACES
frozen_sha: 9cf7bef61c1e35f939ee374851adfd496045125e
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
  - "pnpm install → completed before implementation; lockfile and package manifests unchanged"
  - "pnpm lint → 5/5 Turbo tasks passed with zero dashboard lint warnings"
  - "pnpm typecheck → 5/5 Turbo tasks passed; Next route types generated"
  - "pnpm test:ci → 5/5 Turbo tasks passed: schema 48, CLI 44, control-plane 198, dashboard 112 (402 total)"
  - "CHOKIDAR_USEPOLLING=1 WATCHPACK_POLLING=true PLAYWRIGHT_CAPTURE_UI=1 pnpm test:smoke:dashboard → 18/18 Chromium scenarios passed"
  - "CHOKIDAR_USEPOLLING=1 WATCHPACK_POLLING=true pnpm build → 4/4 Turbo tasks passed; Next.js production build completed"
  - "Focused surface coverage → palette keyboard/fuzzy navigation, 390x844 toolbar targets/overflow/long-press, host create/rotate one-time enrollment, and post-403 action hiding passed"
  - "Browser captures → sessions/hosts/memory/automation/settings desktop plus sessions-mobile-toolbar and sessions-mobile-command-palette under test-results/"
  - "frontend-product-design audit_frontend.sh → lint, typecheck, and tests passed; manual rubric 94/100 with no hard fails"
  - "Ownership scan from f3df15d..9cf7bef → no edits in forbidden orchestrator, tmux, terminal, session, launch, automation-component, package, service, or agent paths"
assumptions:
  - "The existing HSL token system and established dashboard primitives remain the visual source of truth."
  - "NextAuth's session role is the optimistic visibility signal for host administration; a control-plane 403 remains authoritative and removes enrollment actions."
  - "The browser-visible control-plane origin is the correct agent enrollment origin when runtime configuration contains a Docker-internal hostname."
uncertainties:
  - "Screenshot-enabled smoke runs log transient hydration notices for a caret-color:inline style that Playwright injects while capturing; no caret-color source exists in the dashboard and all assertions/builds pass."
blockers: []
---

# FW4-SURFACES handoff

## What changed

- Primitives: added Radix-backed shadcn-style dialog, sheet, dropdown-menu, and command primitives with focus traps, responsive bounds, accessible close controls, and 44px action targets. Owned group, import, settings, search, and sessions overflow surfaces now use them. No dependency was added.
- Surfaces: `/sessions`, `/memory`, `/hosts`, and `/automation` now share a `max-w-7xl` container and spacing rhythm. Sessions keeps Select, Search, New, and More visible at 390px; the remaining actions and views move into a bottom sheet. Owned controls use design tokens, visible focus states, accessible names, and at least 44px touch targets.
- Decomposition: Settings is now a 26-line route composition over workspace, notifications, alerts, session defaults, launch, and usage panels. Sessions route state, selection, and drag/drop live in targeted hooks; filters and pagination are presentational. Session list rows, workflow/list rendering, and the CSS virtualization boundary are split from the data/realtime controller.
- Command palette: one global `components/ui/command` surface mounts in `LayoutShell`. Ctrl/Command-K, `/`, the existing Search button, and mobile long press open it. It paginates through all sessions and fuzzy-matches title/host, jumps to hosts, routes across owned destinations, opens the existing launch sheet, and toggles theme through the current store.
- Host enrollment addendum: administrators can create a host with name and optional Tailscale name through `POST /v1/hosts`, or rotate a row token through `POST /v1/hosts/:id/token`. Both paths show host ID, the one-time agent token, copy actions, a clear irreversible warning, generated `~/.config/agentd/config.yaml` with `wss://<origin>/v1/agent/connect`, and concise build/download plus user-systemd steps referencing `deploy/install-agentd.sh`. Token material is held only in component state and discarded when the panel closes. Non-admin roles never see the actions; a server-side 403 hides them immediately.
- Tests: added host enrollment/config/403 unit coverage, extracted session-hook coverage, fuzzy search coverage, an actual six-panel settings render test, and browser tests for palette navigation, mobile toolbar/overflow/long press, host create/rotate guidance, and 403 hiding.

## Decisions and quality review

- Existing APIs and stores are reused throughout. The palette uses the paginated sessions helper plus `getHosts`, the existing theme store, and the sibling-owned `MobileLaunchSheet`; no new data path or launch implementation was introduced.
- The CSS virtualization boundary uses `content-visibility: auto` and an intrinsic size while preserving the existing list/realtime behavior; it is disabled during drag operations.
- The one-time host token is intentionally never persisted, cached, or placed in a URL. Closing the enrollment dialog clears it from UI state.
- Frontend audit: product fit 15/15, information architecture 14/15, visual design 14/15, dashboard/data clarity 14/15, interaction states 9/10, accessibility 14/15, responsive behavior 10/10, performance polish 4/5 = 94/100. No hard fails. Chromium captures were inspected at 390x844 and 1280x720, including the command palette, mobile toolbar, hosts, memory, automation, sessions, and settings.
- The ownership firewall stayed intact. `LayoutShell` received only the palette import and mount; sibling-owned launch, automation components, orchestrator, tmux, terminal, session internals, packages, services, and agents were not edited.

## Phase commits

- `31992ff` — `feat(surfaces): add Radix overlay primitives`
- `341d400` — `feat(surfaces): unify command surfaces and host enrollment`
- `9dfe2ba` — `feat(surfaces): decompose settings and sessions`
- `a4eb136` — `feat(surfaces): add global command palette`
- `bf92f3b` — `feat(surfaces): improve owned surface accessibility`
- `9485b66` — `feat(surfaces): cover palette and mobile surfaces`
- `9cf7bef` — `feat(surfaces): search all sessions from command palette`

FW4-SURFACES FROZEN 9cf7bef61c1e35f939ee374851adfd496045125e
