# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Typed production Go structs and round-trip fixtures for the complete agentd protocol.
- Linux amd64/arm64 agentd release archives, checksums, and an atomic systemd update script.

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
