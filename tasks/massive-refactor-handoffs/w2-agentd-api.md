---
lane: W2-AGENTD-API
branch: refactor/wave2-agentd
frozen_sha: e6ffc47c06370d57781f765124744b9d28d1d1ef
attempt: 1
gate:
  commands:
    - go build ./...
    - go vet ./...
    - go test ./...
  results:
    - command: go build ./...
      status: passed
      detail: All agentd packages built successfully from agents/agentd.
    - command: go vet ./...
      status: passed
      detail: Vet completed without findings across all agentd packages.
    - command: go test ./...
      status: passed
      detail: All agentd package tests passed, including the new orchestrator API, launch-template, tmux-placement, hierarchy, rollback, race-regression, and hook-fidelity coverage.
assumptions:
  - A caller authenticated by an active tracked pane session may control other tracked sessions on the same host, subject to the existing allow_spawn, allow_send_input, and allow_kill policy flags.
  - The default per-parent active child cap is eight unless max_children_per_parent overrides it.
  - Interactive provider readiness is established by a provider hook or by polling a verified non-shell provider process before a queued prompt is delivered.
uncertainties:
  - Spawn placement and lifecycle behavior were exercised through the required TmuxRunner fake rather than by creating or killing live user tmux panes.
  - Provider-specific headless output schemas beyond the existing Codex and Claude event-name fields remain passed through as additive provider events.
blockers: []
---

# Wave 2 AGENTD-API handoff

## Summary

- Added a loopback-only, active-session-authenticated orchestrator API on the existing hook server for spawn, list, send, kill, wait, and structured report operations.
- Added synchronous tmux window/split spawning, immediate session/parent/provider stamps, readiness-gated prompts, per-parent concurrency caps, rollback, and deterministic child-first cascade kills.
- Replaced provider command concatenation with configurable argv/env launch templates, POSIX-safe shell quoting, and Claude/Codex headless execution.
- Added parent/child session metadata and child-status rollups, plus correlated workshop subagent lifecycle events for native hooks and legacy Task tool calls.
- Serialized tmux topology mutations with polling and prompt delivery to prevent duplicate identity, orphan-pane, and kill/readiness races.
- Added focused API, auth, placement, injection, hierarchy, hook, rollback, concurrency, and partial-failure tests. The auxiliary `go test -race ./...` verification also passed.

The `frozen_sha` is the final implementation commit; the following handoff-only commit adds this file.
