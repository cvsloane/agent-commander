# Backlog

Repo: `agent-command`

Scope: `repository`

Git root: `/home/cvsloane/dev/agent-command`

This is the git-tracked backlog for this workstream. Keep local next steps here; use SloaneVault narrative notes for broader context and synthesis.

## Next

- [x] Refactor `/tmux` safely: extract tmux roster derivation from `TmuxPageClient.tsx` into a pure dashboard module and add Vitest coverage for target parsing, metadata fallback, grouping, sorting, filtering, unmanaged panes, and selected pane choice.
- [x] Redesign `/tmux` as a dense operator surface: persistent compact roster, selected-session workbench, first mobile roster/terminal/actions shell, roster filter chips, tmux key bar, and compact default session rows are in place.
- [x] Expand dashboard Playwright smoke coverage with mocked tmux-capable hosts and multiple session/window/pane fixtures, including mobile viewport assertions.
- [x] Add a tmux-specific control-plane roster query or route that returns only active tmux pane data and can omit snapshots.
- [x] Harden terminal control: enforce operator role and host terminal capability checks on `/v1/ui/terminal/:sessionId`.

## Backlog

- [x] Split `/tmux` into smaller units: `useTmuxRosterData`, `TmuxHostPicker`, `TmuxRoster`, `TmuxClusterRow`, `TmuxWindowRow`, `TmuxPaneRow`, and `TmuxWorkbenchHeader`.
- [x] Add mobile-specific `/tmux` structure: `TmuxMobileShell`, roster/terminal/actions mode switch, filter chips, and compact tmux virtual key bar.
- [x] Reconcile terminal multi-viewer behavior between the browser route and `agentd` terminal manager so read-only/control handoff is a deliberate product behavior.
- [x] Add WebSocket-level integration tests for `/v1/ui/terminal/:sessionId` close codes, attach behavior, and input/control forwarding.
- [x] Fix or replace the control-plane package lint script; it currently invokes ESLint 6 without a package config.
- [x] Introduce a command routing service for authorization, capability checks, audit, timeout handling, and command result correlation.
- [x] Promote tmux identity to a shared schema instead of relying on ad hoc `tmux_target` parsing plus loose `metadata.tmux`.
- [x] Reduce duplicated dashboard API/domain types where `@agent-command/schema` already exports the contract.
- [x] Add schema/agent protocol drift fixtures for tmux session upserts, terminal messages, command dispatch/results, and host capabilities.
- [x] Bring release workflow closer to CI parity by running package tests, dashboard smoke, and Docker image validation before tagged releases.

## Future / New Features

- [ ] **Deep open-agents/Hermes integration** (owner-requested 2026-07-19). Today Hermes can wake automation agents (service-auth + HMAC webhook) and poll three JSON summaries; nothing pushes to Hermes. Build on the 2026-07 refactor surfaces:
  - Push run lifecycle to Hermes: structured completion reports (`worker_report_json`), run blocked/failed, governance approvals — outbound webhooks with retry, mirroring the notifications_log pattern.
  - Let Hermes dispatch work as a first-class client: create work_items with `session_id` claims, wake orchestrators with objectives via the nudge endpoint, and consume session-graph rollups for its own dashboards/digests.
  - Expose the `ac` CLI / MCP server contract to Hermes relay tasks so Hermes jobs can spawn/steer agent-command sessions cross-host (coding-dispatch skill alignment).
  - Bridge memory: share repo-scoped memory entries with Hermes' knowledge stores (dedupe direction TBD), and let Hermes trigger memory distillation review.
  - Unify identity: map Hermes agent slugs ↔ automation_agents.slug (already exists) and reconcile scheduler_mode=external semantics with the new queued-until-host-online behavior.

## Ideas

- Mobile `/tmux` should support a thumb-friendly "roster / terminal / actions" mode switch, with roster search always one tap away and terminal controls pinned above the mobile virtual key row.
- Add session health badges tuned for scanning: waiting input, waiting approval, error, idle, dirty git tree, detached/offline host, and unmanaged pane.
- Consider saved roster filters such as "waiting", "active", "dirty", "this host", and "recent".

## Open Questions

- Should mobile terminal attach happen automatically when selecting a pane, or should it remain explicit to avoid accidental control/input on touch devices?
- Should multiple browser viewers be supported as read-only by default with explicit "take control", or should the current single-viewer eviction remain?
- Is Agent Commander intended to remain single-tenant, or should session/read APIs be scoped by authenticated user before broader use?

## Blockers

## Captured Sessions

## From Frontend Command Center UX program close (2026-07-20)
- [ ] Complete the binary-only terminal migration properly: remove the server JSON output path + schema output message AND the client fallback together, with a hello-before-output ordering guarantee (Wave-5 review MEDIUM; client fallback restored at program close as the safe posture).
- [ ] Terminal frame-timing probe: short-circuit sampling on isEnabled() before any per-frame work; gate the web-vitals dynamic import on the perf flag (Wave-5 review LOWs).
- [ ] Window-strip arrow-key navigation dispatches live select_window per keypress (valid ARIA auto-activation but can burst commands) — consider focus-only + Enter-to-activate (Wave-5 review INFO).
- [ ] Commit a refreshed docs-site screenshot of the Command Center (acceptance checklist residual NOT-MET).
- [ ] Wave-6 batch-2 review LOWs: prune command-mark seenRef on marker disposal; 4px selection-handle offset; double-tap vs touch-scroll listener ordering; thumbnail "live capture" wording; scroll-freeze anchor drift at 10k scrollback saturation; heuristic ❯/› prompt-glyph tuning; stuck suppressClickRef edge (touch tap then BT-keyboard click).
