# Frontend Command Center UX Program - 2026-07-20

Evidence: `tasks/2026-07-20-frontend-ux-study-findings.md` (studied at main `70fa53e`, 0.3.0 deployed). Execution model: Autonomous Development Loop (SloaneVault `20 - Development/26 - Multi-Agent/Integrator-Supervisor Harness - Native Multi-Agent Orchestration.md`) — Claude as AI Lead, codex Builder lanes in tmux panes with isolated worktrees, same harness as the 2026-07-19 massive refactor.

## Vision

Opening the app should feel like sitting down at your tmux command center — **the first paint is your fleet**: every host, every agent, every pane, one tap from a live terminal that behaves like native tmux (windows, panes, scrollback, search, copy), wrapped in agent-aware superpowers native tmux can't offer (attention queue, inline approvals, prompt composer, push deep links). 0.3.0 built the engine — real per-viewer PTY attach, resilient transport, fleet data; this program builds the cockpit. Native tmux parity first, agent superpowers on top, one design language everywhere.

## Locked Decisions (owner-approved 2026-07-20)

1. **Landing surface: the Command Center.** Post-signin lands on the fleet/tmux surface, not `/`. The v0.2.0 hero-card dashboard is retired; its stats/usage content relocates into the Command Center header and `/settings`→usage. Signin `callbackUrl` and PWA `start_url` both point at the Command Center. Old `/` redirects.
2. **One orchestrator surface.** The header bell and the bottom tab converge on a single attention/fleet component (rendered as sheet on desktop, full page on mobile). `OrchestratorModal` vs `OrchestratorPageClient` duplication is eliminated; push deep links land on the unified surface.
3. **Structured tmux via hooks + format extensions, NOT control mode.** We keep the per-viewer grouped-session PTY transport exactly as shipped and add out-of-band structure: extended `list-panes` formats (active/layout/zoom/flags/sizes) and tmux hook-driven topology events. No `-CC` transport replacement this program (stays a future option; consistent with the earlier `webtmux_fix.md` rejection).
4. **Full frontend-stack modernization, including TS 7.** Waves 1–2 clear the deferred debt: React 18→19 (+types), TypeScript 5→7 (native compiler, repo-wide TS toolchain), ESLint 9→10 + `eslint-plugin-react-hooks` unpin (with the `SessionList` fix it requires), Node types, tailwind-merge 3, lucide 1.x, `MobileLaunchSheet` exhaustive-deps fixes, and Zod 3→4 across ac-schema + control plane + dashboard. **Excluded:** R3F/Drei bumps (visualizer-only; visualizer stays untouched). Zod 4 is co-scheduled with the new tmux contract authoring in one lane, since both edit the same schema/CP files.
5. **Branching + deploy cadence: ship per wave.** Integration branch `refactor/frontend-command-center` off main; lane branches `refactor/fw<N>-<shortname>`; commit-per-phase. **Each wave that passes its gate goes to main via PR and deploys to production** (owner merges/authorizes), so on-device feedback steers the next wave — unlike 0.3.0's single end-drop.
6. **PWA-first stands** (carryover lock from 0.3.0). No APK. iOS verification happens on the owner's device after each wave deploy (builders have no iOS hardware).
7. **`/sessions` is retained** as the management/list view (bulk ops, groups, archive), restyled to the design system with a mobile-fit toolbar. The Command Center is the primary surface; no attempt to merge the two mental models this program.

## Product policy decisions (made during planning; owner can veto)

- **Desktop key bar:** ship a compact, collapsible tmux key bar on desktop too (parity with mobile); default collapsed, remembered per user.
- **Multi-terminal:** desktop gets a 2-up split workbench (two independent pane attachments side by side); mobile stays single-terminal with a quick-switch strip (recent panes) — no mobile grid.
- **Persistent terminal:** the terminal host moves to the app layout level so navigation doesn't kill the socket; at most 1 hidden background terminal kept live, auto-detached after 5 min hidden (battery/memory).
- **`rename_session` gets wired end-to-end** (schema+executor already exist; UI rename currently diverges DB-only) and window rename ships with it.
- **CP fleet aggregate endpoint** replaces the dashboard's 4-concurrent per-orchestrator fetch cap.
- **Scrollback:** raise xterm local scrollback 4000→10000; history beyond that comes from the new capture-pane paging endpoint on demand, not from resume replay.
- **Visualizer stays untouched** (already isolated in W6-CLEANUP); still sidebar-gated, never in the bottom nav.
- **Migration numbers:** next free is 039; claims recorded in the status board before use.

## Workstreams

### A. Command Center IA reset
- Dashboard: new Command Center landing (mobile-first): fleet roster as the home screen — host chips, orchestrator groups, health-badged sessions, launch rail; header slims to logo + connection + attention + account; retire `/` hero grid and relocate stats. Single nav model: bottom tabs (Command Center / Attention / Sessions / More) with the drawer reachable only from More; delete the duplicate hamburger path. Unify breakpoints on one `useIsMobile` contract (tmux's 1024 vs everyone's 768 reconciled) and one container/spacing convention.
- Dashboard: launch rail (prior program's deferred #34): persistent New / Recent / Open-existing entry on Command Center and Sessions; `MobileLaunchSheet` becomes the single launch surface on all form factors; delete legacy `SpawnSessionDialog`; make `SessionGenerator`/`RepoPicker` recent-first and mobile-capable; centralize `LAUNCH_PROVIDERS`/`SESSION_TEMPLATES` in one module.
- Dashboard: attention surface unification (Locked #2): one component tree fed by `useAttentionQueue`, presented as sheet/page; push deep links land there.

### B. Terminal excellence (client)
- Dashboard: hot-path fixes — stop running reconnect-state transitions + store writes + forced `scrollToBottom()` on every output frame (`useTerminalConnection.ts:159-163`); scroll-anchor semantics (only autoscroll when at bottom); move xterm selection state out of React render path; consolidate the three `input`-frame emitters behind one `sendInput` API.
- Dashboard: scrollback — `@xterm/addon-search` with a search UI (mobile sheet + desktop inline), 10k local buffer, "load older" pager backed by the new capture-pane endpoint, copy-last-N retained.
- Dashboard: window/pane management UI — window strip (tabs) above the terminal driven by structured topology (C), with new/rename/kill window, split/zoom/kill pane, per-pane resize handles on desktop; key bar on desktop (collapsible); all actions call structured commands (C), no raw prefix-byte dependence for common ops.
- Dashboard: persistent app-level terminal host + reattach-on-return; mobile quick-switch strip; desktop 2-up split workbench; a stateful test proving the xterm instance survives roster→terminal→roster and route changes (the missing W4 test).

### C. Structured tmux model (agentd + schema + CP)
- agentd: extend `ListPanes` format with `pane_active/window_active/window_layout/window_zoomed_flag/pane_width/pane_height` + window flags (bell/activity/silence); emit topology events from tmux hooks (`window-linked/unlinked/renamed`, `pane-exited`, `after-split-window`, `client-session-changed`) debounced into a `tmux.topology` envelope; keep polling as reconciliation, not primary.
- agentd: executor cases for `new_window`, `kill_window`, `rename_window`, `split_pane`, `select_window`, `select_pane`, `resize_pane`, `zoom_pane` (client methods already exist in `internal/tmux/tmux.go`); wire `rename_session` producers; scrollback command using `CapturePaneRange` modes; fix the stale attached-channel supersede so resume works across a full CP restart (open W4-TERM-CLIENT item).
- Schema: new `CommandPayload` types for the ops above; `tmux.topology` event; pane/window field additions to `TmuxPaneIdentity`/roster types; scrollback request/response; protocol fixtures (TS + Go) extended in the same wave — schema authored first, dependents consume frozen contracts.
- Control plane: relay topology events to a `tmux.topology` UI topic; `POST /v1/sessions/:id/scrollback` (or `/v1/tmux/scrollback`) paging endpoint; command routes for window/pane ops with authz via existing `commandRouter`/`terminalPolicy`; roster endpoint returns the new fields; fleet aggregate endpoint (one call returns orchestrator cards' graph/task/report bundle).

### D. Agent-aware fleet
- Dashboard: one fleet model — merge `lib/fleetRoster.ts`+`TmuxOrchestratorRow` and `useOrchestratorFleet`+`OrchestratorFleetCard` into a single store/selector set with two presentations; consume the CP aggregate endpoint; kill the 750ms-debounced full roster refetch in favor of `tmux.topology` + `sessions.changed` incremental updates.
- Dashboard: terminal-context agent overlay — when attached to a pane with pending attention (approval/question), show an inline card over the terminal with approve/deny/respond; prompt composer with history and multi-line editing as an alternative to raw typing; send-to-session reachable from the composer.
- Dashboard: session health badges tuned for scanning (waiting-input, waiting-approval, error, idle, dirty-git, detached/offline, unmanaged) and saved roster filters ("this host", "recent", plus the six chips) — both long-standing BACKLOG items.

### E. Design system & surface migration
- Dashboard: complete `components/ui` primitives (dialog, sheet, dropdown-menu, command, toast alignment) so feature code stops hand-rolling Radix; codify tokens (containers, spacing, tap targets ≥44px, typography scale) in one doc + lint hints; migrate `/sessions` (toolbar → overflow sheet on mobile), `/memory`, `/hosts`, `/automation` shells to the system; decompose `SettingsPanel` (1125) into per-domain panels, `OrchestratorItem` (952) into per-type renderers, `SessionsPageClient` (666) into filter/selection/dnd hooks + presentational list.
- Dashboard: command palette (⌘K / long-press search): jump to pane/session/host, run launch, toggle theme — desktop power-user spine.
- Dashboard: motion/polish pass — view transitions between roster↔terminal, skeletons for roster/fleet loads, safe-area + keyboard-aware audits on all new surfaces; a11y pass (focus traps in sheets, roles on roster tree).

### F. Platform modernization
- Dashboard/repo: the full modernization (Locked #4) — Wave 1: TS 7 toolchain, ESLint 10 + react-hooks unpin (+`SessionList` fix), React 19 + types, tailwind-merge 3, lucide 1.x, exhaustive-deps fixes; Wave 2: Zod 3→4 across ac-schema, control plane, and dashboard (co-lane with new tmux contracts). Plus removal of the dead JSON terminal-output branch client-side; `web-vitals` + a terminal frame-timing probe (write-to-paint) recorded to the existing metrics path so perf work is measured, not vibes.

### G. Verification & release
- All: Playwright journeys at 390×844 + 1280×720 for: signin→Command Center first paint, roster→attach→type→detach, window create/rename/kill, scrollback search+page, take-control handoff, launch rail spawn, attention approve from terminal overlay; smoke stays green per wave; acceptance checklist **extended per wave this time** (last program only ever filled Wave 1); CHANGELOG 0.4.0; docs-site screenshots refreshed; owner on-device iOS check at each wave gate.

## Wave plan

Waves are dependency-ordered; each ends with the verification gate + integration commit on `refactor/frontend-command-center`. Machine split: heavisidelinux runs the Go/agentd lane (pushes to origin); homelinux runs TS lanes (local branches, AI Lead integrates). Note the heavisidelinux tmux kill-session fragility — snapshot-check before any session teardown, one at a time.

Each wave that passes its gate merges to main via PR and deploys to production (Locked #5) — the modernization is proven in prod before the visible IA switch, and the owner steers from the device between waves.

| Wave | Content | Lanes | Primary machine |
|---|---|---|---|
| 1 | F modernization part 1: TS 7 toolchain, React 19, ESLint 10 + hooks unpin (+SessionList fix), Node types, tailwind-merge 3, lucide 1.x (repo-wide TS, mechanical only); C agentd topology events + executor ops + resume-supersede + Go fixtures | FW1-MODERN, FW1-TMUX-GO | homelinux ×1, heavisidelinux ×1 |
| 2 | F/C contracts: Zod 3→4 across schema/CP/dashboard + new tmux contract types, topology event + UI topic, scrollback endpoint, window/pane command routes, fleet aggregate endpoint; B terminal client perf hot-path + persistent app-level host + search addon + 10k local scrollback | FW2-CONTRACTS, FW2-TERM | homelinux ×2 |
| 3 | A Command Center landing + nav/breakpoint unification + attention unification + launch rail + legacy retirement; B/C window strip + window/pane management UI + desktop key bar + 2-up multi-terminal + scrollback pager wiring | FW3-SHELL, FW3-TMUX-UI | homelinux ×2 |
| 4 | D unified fleet model + aggregate consumption + terminal attention overlay + prompt composer + health badges/saved filters; E surface migration (/sessions, /memory, /hosts, settings) + god-component decomposition + ui primitives + command palette | FW4-FLEET, FW4-SURFACES | homelinux ×2 |
| 5 | E motion/a11y/polish pass; G Playwright journeys, perf budgets, acceptance checklist completion, docs, CHANGELOG 0.4.0, release | FW5-POLISH, FW5-QA | homelinux ×2 |

Lane→ownership firewall, migration claims, and completion tokens (`FW1-MODERN FROZEN <sha>` etc.) are maintained in `tasks/frontend-ux-status.md`; per-lane briefs land as `tasks/2026-07-20-fw<N>-<lane>-brief.md`; narrative log `tasks/frontend-ux-log.md`; handoffs in `tasks/frontend-ux-handoffs/`.

Indicative firewalls: FW1-MODERN = package manifests, tsconfig/eslint configs, and mechanical code fixes anywhere in TS (no feature/behavior edits); FW1-TMUX-GO = `agents/**` + new `tests/fixtures/protocol/` files only; FW2-CONTRACTS = `packages/ac-schema/**`, `services/control-plane/**`, migrations from 039, plus scoped mechanical Zod call-site edits in `apps/dashboard`; FW2-TERM = dashboard terminal/tmux components + hooks; Wave 3+ dashboard lanes split by directory (SHELL = app/(dashboard) shells + layout + launch + orchestrator components; TMUX-UI/TERM = terminal/tmux components + hooks) with shared-file reconciliation owned by the AI Lead.

### Verification gates

Every wave: `pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:smoke:dashboard` **plus a production build (`pnpm build`)** — mandatory given the TS 7/React 19 toolchain swap — and, when `agents/` changed, `go build ./... && go vet ./... && go test ./...` in agents/agentd; `pnpm verify:launch` when launch surfaces change; protocol fixture round-trips must pass on both TS and Go when schema changes (the Zod 4 wave re-runs the full fixture suite as its primary contract check). New behavior lands with tests in the same wave. Wave 3+ adds the new Playwright journey suite to the gate. After each wave's deploy, owner does an on-device PWA pass (install, push, terminal typing) before the next wave launches.

### Coordination protocol

- Canonical docs: this plan + findings doc; live board `tasks/frontend-ux-status.md` (lane table, firewalls, migration claims, decisions pending owner); `tasks/frontend-ux-log.md` narrative; handoffs per lane with YAML front-matter.
- Builders: codex agents in tmux windows (`agent-command:fw1-*` …), worktrees `~/dev/wt/ac-fw<N>-<short>`; heavisidelinux lanes push `refactor/fw*` to origin; homelinux lanes stay local until the AI Lead integrates. Go toolchain at `~/.local/go/bin` on both machines.
- Contracts order: the AI Lead authors the new envelope/command shapes as JSON protocol fixtures in the FW1-TMUX-GO brief (fixtures are the cross-language contract, as in the last program); FW1-TMUX-GO implements Go against them, FW2-CONTRACTS implements the TS schema against the same frozen fixtures. Any shape change after FW1 freeze goes through the AI Lead, both sides re-gate.
- Prohibitions: no lane edits outside its firewall (violation ⇒ revert + re-task); no dependency changes outside the modernization lanes' briefs (R3F/Drei and the visualizer stay untouched); no transport-mode changes to the per-viewer PTY path; no direct commits to main — per-wave merge is a PR the owner merges/authorizes, migrations rolled out with that wave's deploy.
- Stop conditions: 3 attempts at the same failure without new evidence ⇒ hold lane and escalate; baseline green at program start must be re-verified before Wave 1 launches.

## Risks

- **TS 7 + React 19 in one wave** is the program's biggest single bet → FW1-MODERN is mechanical-only (no feature edits), gated on lint+typecheck+tests+**production build**, and deployed alone so any breakage is isolated to one revertable wave; TS 7 fallback is staying on TS 5 for the program (one-line decision reversal, rest of the plan unaffected).
- **Zod 3→4 semantic drift** (parse/validation behavior changes in ac-schema hit CP runtime validation and agentd-facing envelopes) → co-lane with contract authoring so one owner sees both; full TS+Go fixture round-trip suite is the gate's primary check; CP runtime-validation tests re-run.
- **Per-wave deploys shipping half-states** → each wave is scoped to leave coherent UX (the visible landing switch waits until Wave 3, after the modernization has already survived production).
- **tmux hook behavior varies by tmux version** (homelinux vs heavisidelinux vs prod hosts) → agentd feature-detects hooks, polling remains as reconciliation; integration test against a real tmux in CI lane gate.
- **Terminal regressions** in the hot-path/persistence work → per-viewer PTY server path untouched (Locked #3); client changes behind the existing protocol; the new stateful rerender test + resume tests are part of the same lane's gate.
- **Homelinux lane congestion** (most lanes are TS) → max 2 concurrent dashboard lanes with directory-split firewalls; AI Lead owns shared files (layout, stores) and reconciles.
- **Scope creep in polish** → FW4-POLISH is timeboxed; anything beyond its brief goes to BACKLOG, not the lane.
- **iOS blind spots** (no hardware in lanes) → owner device checks at wave gates; Playwright mobile-viewport coverage is a floor, not proof.
- **Landing-page switch surprises muscle memory** → old `/` route 302s to the Command Center (no dead link), sessions/automation reachable in two taps; revert is a one-line callback change.
