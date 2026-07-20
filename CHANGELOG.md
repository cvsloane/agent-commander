# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
