# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-07-20

### Added

- A fleet-to-terminal Command Center at `/` with an aggregate fleet strip,
  structured host/session/window/pane roster, top attention item, persistent
  launch rail, and query-preserving `/tmux` compatibility redirect.
- Live tmux topology snapshots and complete window and pane actions: create,
  rename, close, select, split, resize, zoom, and terminate, with roster-derived
  fallback for hosts that do not emit topology.
- Persistent primary terminals, desktop two-up terminal composition, compact
  recent-pane switching, 10,000-line scrollback search, and separately paged
  terminal history.
- In-terminal attention decisions, a prompt composer with per-session history,
  shared health badges and saved roster filters, and a global command palette
  for routes, sessions, hosts, launches, and themes.
- Responsive dialog, sheet, dropdown, and command primitives; consistent
  Sessions, Hosts, Memory, Automation, and Settings surfaces; and an admin-only
  Add host and token-rotation flow with generated `agentd` configuration.
- Cross-device Playwright journeys for fleet-to-terminal, window and pane
  management, two-terminal work, attention handling, launch/reopen, host
  enrollment, and palette/shortcut workflows at 390x844 and 1280x720.

### Changed

- Upgraded the TypeScript workspaces to TypeScript 7.0.2, linting to ESLint
  10.7.0, dashboard rendering to React 19.2.7, shared validation to Zod 4.4.3,
  `tailwind-merge` to 3.6.0, and `lucide-react` to 1.25.0.
- Unified fleet cards, the tmux roster, session events, graph/task events, and
  topology in one canonical Zustand store with targeted WebSocket updates and
  30-second aggregate/roster reconciliation.
- Consolidated desktop and mobile navigation around Command Center, Attention,
  and Sessions; replaced the legacy spawn dialog with shared New, Recent, and
  Open existing launch surfaces.
- Routed terminal output directly to xterm, kept selection and scroll-follow
  state out of the React render hot path, and consolidated all terminal input
  through the read-only-aware transport.
- Migrated agent protocol validation and control-plane/CLI schemas to Zod 4,
  while keeping byte-exact frozen protocol fixtures for topology and tmux
  commands across TypeScript and Go.

### Fixed

- Preserved the terminal viewport while reading history or selecting output,
  retained one terminal across route changes, and suspended hidden transport
  after five minutes without discarding local history or its resume token.
- Expired silent topology feeds after 30 seconds, restored roster fallback
  immediately, eliminated duplicate roster feeds, and gated percent splits and
  last-window warnings on authoritative host capabilities and topology.
- Preserved newer targeted session updates during aggregate reconciliation,
  pruned removed sessions from the canonical cache, and retained read-only
  permission state across responsive terminal layout changes.
- Superseded only stale terminal channels during resumed attachment and cleaned
  stale `ac-agentd-*` tmux hook signals without disturbing user hooks.

### Security

- Required operator or admin authorization before loading aggregate fleet
  details or dispatching terminal, window, and pane commands; capability checks
  remain enforced per host.
- Kept host enrollment tokens one-time and in memory only, clearing them when
  the enrollment surface closes instead of persisting, caching, or placing them
  in URLs.
- Tolerated future unknown typed agent envelopes without advancing sequence
  state, while continuing to terminate invalid JSON, malformed or oversized
  frames, and known message types with invalid payloads.
- Kept the authenticated connection's host identity authoritative over topology
  payload fields and bounded fleet, scrollback, and batch query work.

## [0.3.0] - 2026-07-19

### Added

- An orchestrator-first command surface with session lineage, worker/task rollups,
  structured results, inline decisions, prompt steering, and a cross-host tmux roster.
- A loopback agentd control API plus the `ac` CLI and stdio MCP tools for local and
  cross-host worker, work-item, memory, and roster operations.
- Installable PWA assets, offline fallback, Web Push subscriptions, attention
  delivery logs, and notification deep links for phone-first supervision.
- Per-viewer terminals with isolated PTYs, read-only observers, explicit control
  transfer, binary/compressed transport, reconnect resume tokens, and mobile keyboard handling.
- Typed production Go structs and round-trip fixtures for the complete agentd protocol.
- Linux amd64/arm64 agentd release archives, checksums, and an atomic systemd update script.

### Changed

- Made agent/control-plane/dashboard connections outage-tolerant with durable command
  delivery, replay, liveness checks, deterministic host selection, and stale-run recovery.
- Promoted stable tmux identity and typed runtime validation across agentd, the control
  plane, shared schemas, and the dashboard.
- Isolated visualizer CSS and Three.js code to its route and removed the unreachable
  workshop route and compatibility shim.

### Security

- Hardened authentication, origin checks, rate limits, terminal auditing, service
  integration credentials, and dependency versions.

### Fixed

- Governance resume, terminal reconnect/scrollback behavior, host presence races,
  command acknowledgement semantics, and release notes generated from this changelog.

## [0.2.1] - 2026-03-28

### Fixed

- Corrected automation distillation grouping queries.

## [0.2.0] - 2026-03-28

### Added

- Tmux-first session management with an inline terminal workbench.
- Autonomous orchestration, governance approvals, scoped memory, and Hermes integration.
- Provider capability reporting and runtime reliability improvements.

## [0.1.0] - 2026-01-24

### Added

- Initial public release
- Control plane API + WebSocket streaming
- Dashboard for sessions, approvals, and analytics
- agentd daemon for tmux session management
- Alerts and notifications (browser, audio, toasts, OpenClaw)

[Unreleased]: https://github.com/cvsloane/agent-commander/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/cvsloane/agent-commander/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/cvsloane/agent-commander/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/cvsloane/agent-commander/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/cvsloane/agent-commander/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/cvsloane/agent-commander/releases/tag/v0.1.0
