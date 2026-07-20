# Frontend Command Center UX — Acceptance Checklist

Program: `tasks/2026-07-20-frontend-tmux-ux-master-plan.md`. Reconciled by
FW5-QA on 2026-07-20. A checked item has committed evidence below; an unchecked
item is explicitly `NOT-MET`. Handoff references point to files under
`tasks/frontend-ux-handoffs/`, whose frontmatter records the full frozen SHA and
gate results.

Non-waivable across all waves: full gate green
(`pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:smoke:dashboard && pnpm build`,
plus `go build ./... && go vet ./... && go test ./...` in `agents/agentd` when
`agents/` changed); no ownership-firewall breaches; no edits to the per-viewer
PTY transport mode; visualizer and R3F/Drei untouched.

## Global reconciliation

- [x] Integrated Wave 1–4 gates, firewall reviews, and independent review receipts are committed in `tasks/frontend-ux-log.md`; lane-level commands and frozen SHAs are in the eight frozen handoffs. The FW1 agentd handoff includes the required Go build/vet/test gate.
- [x] The frozen handoffs and integration log report no per-viewer PTY transport-mode change and no visualizer/R3F/Drei edit. FW1-MODERN explicitly records the protected dependency audit; FW2-TERM records protocol shapes untouched.
- [ ] **NOT-MET — owner on-device PWA checkpoints.** The program log records the 2026-07-20 owner directive that per-wave on-device checkpoints were deferred to final review; no completed iOS install/push/terminal-typing receipt is committed.
- [ ] **NOT-MET — final Wave 5 polish/probe evidence.** No `fw5-polish.md` frozen handoff or integrated `web-vitals`/terminal frame-timing probe is present on this branch. The static performance contract is documented, but it is not a measurement-probe receipt.

## Wave 1

### FW1-MODERN

- [x] TypeScript 7 is declared across all workspaces and `pnpm typecheck` passed on 7.0.2. Evidence: `fw1-modern.md` frozen SHA `76d3c5e2bc5e03c4f3a2f534f053ae6a9bc8f000`, including `pnpm exec tsc --version`.
- [x] ESLint 10 and `eslint-plugin-react-hooks` 7.1.1 landed with the override removed; lint passed after fixing `SessionList` without suppression. Evidence: `fw1-modern.md`, commits `65cc1b4` and frozen gate.
- [x] React/React DOM and their types moved to 19; the smoke suite passed with no intended runtime behavior change. Evidence: `fw1-modern.md`, commit `20ee1f6`, 10/10 Chromium scenarios.
- [x] `tailwind-merge` 3.6.0 and `lucide-react` 1.25.0 landed as source-compatible utility upgrades. Evidence: `fw1-modern.md`, commit `76d3c5e`.
- [x] The three `MobileLaunchSheet` exhaustive-deps warnings were fixed by memoizing `data?.targets`, not suppressed. Evidence: `fw1-modern.md` “What changed” and suppression scan.
- [x] The production build passed; the remaining Next native-compiler and peer-range warnings are documented. Evidence: `fw1-modern.md`, `pnpm build` proof and “Decisions and compatibility notes”.
- [x] Zod remained 3.25.76 in this lane; `agents/**`, visualizer dependencies, and feature behavior were untouched. Evidence: `fw1-modern.md` compatibility notes and ownership audit.
- [x] Frozen handoff and token exist. Evidence: `fw1-modern.md`, `FW1-MODERN FROZEN 76d3c5e2bc5e03c4f3a2f534f053ae6a9bc8f000`.

### FW1-TMUX-GO

- [x] Pane/window active state, zoom, layout, dimensions, bell/activity, and attached-session metadata reach topology and `sessions.upsert`. Evidence: `fw1-tmux-go.md` frozen SHA `7a8e6eeb6e2b93f6fdc2d75dcae7dddf17f308a3`.
- [x] Debounced `tmux.topology` snapshots, hook triggers, startup/poll reconciliation, hook feature detection, and poll-only degradation landed. Evidence: `fw1-tmux-go.md`; `TestTopologyHooksAppendSignalAndRestoreExistingHooks` and topology queue tests.
- [x] All eight window/pane commands execute and acknowledge through the agent executor. Evidence: `fw1-tmux-go.md`; `TestExecute*AgainstPrivateTmux` observed state changes for every operation.
- [x] A resumed attach supersedes only a stale channel after control-plane reconnect. Evidence: `TestTerminalAttachSupersedesStaleChannelAfterControlPlaneReconnect` in `fw1-tmux-go.md`.
- [x] Range capture paging is stable, contiguous, and non-overlapping. Evidence: `TestCapturePaneRangePagesStableContiguousHistory` in `fw1-tmux-go.md`.
- [x] All nine frozen fixtures match the brief and round-trip through production Go types. Evidence: `TestProtocolFixtureMatrixRoundTripsProductionTypes` and the handoff ownership notes.
- [x] Real tmux tests use private `tmux -L ac-test-*` servers and never target the live server. Evidence: `fw1-tmux-go.md` “Decisions within lane latitude”.
- [x] Frozen handoff, pushed branch, and token exist. Evidence: `fw1-tmux-go.md`, `FW1-TMUX-GO-R2 FROZEN 7a8e6eeb6e2b93f6fdc2d75dcae7dddf17f308a3`, and `origin/refactor/fw1-tmux-go`.

### Wave 1 integration (AI Lead)

- [x] Both lanes were reviewed against their firewalls and briefs, integrated, re-gated with TypeScript and Go, and independently reviewed to SHIP after R2. Evidence: `tasks/frontend-ux-log.md`, integration commits `6f8ce3c` and `76d7a12`.
- [x] Wave 1 PR #86 merged at `d565b00` and production deployment was verified by `SOURCE_COMMIT`, `/health`, and agent connection. Evidence: `tasks/frontend-ux-log.md` 18:20Z–18:30Z entries.
- [ ] **NOT-MET — owner on-device PWA pass.** The log explicitly defers this checkpoint to final review and contains no completion receipt.

## Wave 2

### FW2-CONTRACTS

- [x] Every direct TypeScript Zod declaration (`ac-schema`, control-plane, and `ac-cli`) moved to 4.4.3 with behavior-preserving migrations; the dashboard had no direct Zod dependency or import to bump. Evidence: `fw2-contracts.md` frozen SHA `38c1a12df57589c822363f53a36c4b7adc4f44b4`, `partialRecord` compatibility tests, and listed semantic sites.
- [x] `tmux.topology` is registered, authenticated-host scoped, relayed on the UI topic, and byte-exact against the frozen fixture. Evidence: `fw2-contracts.md`; protocol fixture suite 16/16 and agent WebSocket tests.
- [x] Unknown typed envelopes are rate-limited/logged and dropped while malformed, oversized, and known-invalid envelopes terminate. Evidence: `fw2-contracts.md`; unknown-envelope and known-invalid termination tests.
- [x] All eight command schemas match the frozen fixtures and dispatch through operator/capability authorization without privileged blocking. Evidence: `fw2-contracts.md`; 16/16 protocol tests and command-router tests.
- [x] Bounded `POST /v1/sessions/:id/scrollback` supports visible, last-N, range, and full capture modes with auth, capability, audit, and 5,000-line caps. Evidence: `fw2-contracts.md`, scrollback route tests.
- [x] `GET /v1/orchestrator/fleet` returns the aggregate card contract with scoped, batched loaders and operator authorization. Evidence: `fw2-contracts.md` R2 proof and fleet tests.
- [x] Title PATCH persists first and dispatches `rename_session` when connected without failing offline updates. Evidence: `fw2-contracts.md`, rename route tests.
- [x] Frozen handoff and token exist; all protocol fixtures remained unmodified. Evidence: `fw2-contracts.md`, `FW2-CONTRACTS FROZEN 38c1a12df57589c822363f53a36c4b7adc4f44b4`.

### FW2-TERM

- [x] The output path performs zero store/status writes per steady frame and preserves scrolled-back view until explicit **Live**. Evidence: `fw2-term.md` frozen SHA `9b34dfbf7bd7005c7dd2d30c03c78f7682db6a71`; 250-frame and scroll-anchor tests.
- [x] Selection text/anchor stay in refs during drag with a single completed-selection React commit. Evidence: `fw2-term.md` “What changed”.
- [x] xterm data, Shift+Enter, paste/clear, and virtual keyboard input share the guarded `sendInput` path. Evidence: `fw2-term.md`; one production `type: 'input'` construction site.
- [x] `PersistentTerminalHost` survives navigation, retains at most one background terminal, suspends after five hidden minutes, and resumes through the existing token path. Evidence: `fw2-term.md`; `terminalHostStore.test.ts` same-instance/buffer proof.
- [x] xterm search is available inline on desktop and in a mobile sheet with 10,000-line scrollback. Evidence: `fw2-term.md`, commit `24cb0a7` and frozen browser/gate proof.
- [x] Frozen handoff and token exist; server protocol shapes were untouched. Evidence: `fw2-term.md`, `FW2-TERM FROZEN 9b34dfbf7bd7005c7dd2d30c03c78f7682db6a71`.

### Wave 2 integration (AI Lead)

- [x] Both diffs and the reconciled lockfile were reviewed, the complete gate passed, adversarial notes were closed in R2, PR #87 merged/deployed at `effab04`, and the agentd rollout decision was revisited. Evidence: `tasks/frontend-ux-log.md` 20:30Z–21:20Z entries; rollout later completed on both hosts at 02:30Z.

## Wave 3

- [x] Command Center is the canonical `/` landing for sign-in and PWA entry; `/tmux` (the checklist's intended “old route”) redirects while preserving queries; navigation/breakpoints and attention presentation are unified; shared launch surfaces replaced the deleted `SpawnSessionDialog`. Evidence: `fw3-shell.md` frozen SHA `5bba177668402700f393fa9b64b64d8dc9dc83f5`, shell-contract tests, 13/13 smoke, and `pnpm verify:launch`.
- [x] Live/fallback topology, window strip/actions, pane controls, desktop key bar, remembered desktop two-up terminals, compact recent-pane switching, and paged history landed. Evidence: `fw3-tmux-ui.md` frozen SHA `c2bcfbecec86b13cc7b2da80a0b4182a3838eb81`, focused unit/browser coverage and R2 corrections.

## Wave 4

- [x] The aggregate endpoint replaced client per-orchestrator fetches and the client four-concurrent cap; fleet/roster share one store with targeted updates and slow reconciliation. Terminal attention, composer, health badges, and saved filters landed. Evidence: `fw4-fleet.md` frozen SHA `f0d7b898e75bf5e0b2a7e49f0d7401aa93c99d64`, 124 dashboard tests and 16/16 smoke at R2.
- [x] Sessions, Memory, Hosts, Automation, and Settings use shared surface primitives; large Settings/Sessions components were decomposed; the global command palette and Add host/rotate-token flow landed. Evidence: `fw4-surfaces.md` frozen SHA `9cf7bef61c1e35f939ee374851adfd496045125e`, 18/18 browser scenarios and surface audit.

## Wave 5

- [x] The seven deterministic Playwright journeys pass at 390x844 and 1280x720: sign-in/first paint, attach/type/detach, window create/rename/kill with last-window warning, history load-older, take-control, launch, and terminal-overlay approval. Evidence: commit `63b1946`, `command-center.journey.spec.ts`, and 14/14 Chromium results from a tmux TTY.
- [ ] **NOT-MET — runtime performance probes.** `docs/performance.md` at `faa4db3` names and test-backs the zero-write/scroll-anchor/fleet-reconciliation budgets, but the separate FW5-POLISH `web-vitals` and sampled terminal frame-to-paint probe work is absent.
- [x] Keep a Changelog 0.4.0 release entry is dated 2026-07-20 and covers Waves 1–5. Evidence: `CHANGELOG.md`, commit `9a136fa`.
- [x] README, docs, and Docsify navigation describe the current Command Center, tmux workspace, multi-terminal, composer/overlay, launch, Add host, palette, shortcuts, and `ac-agentd-` namespace. Evidence: commits `7fa0f0b` and `faa4db3`.
- [ ] **NOT-MET — refreshed docs-site screenshot asset.** Wave 3/4 browser captures were inspected in their handoffs, but the master plan's refreshed docs-site screenshot was not committed and no FW5-POLISH handoff supplies it.
- [x] Every original Wave 1–5 acceptance item is reconciled here with committed evidence or an explicit `NOT-MET` explanation. Evidence: this FW5-QA checklist work item.
