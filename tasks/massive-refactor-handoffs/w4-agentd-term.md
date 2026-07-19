---
lane: W4-AGENTD-TERM
branch: refactor/wave4-agentd-term
frozen_sha: 194baa685702604d90711d6a2b4782311a4269e6
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
      detail: All agentd tests passed, including grouped viewer lifecycle, PTY read-only control transfer, initial sizing, backpressure, coalescing, resume, sweeping, config, and additive wire-event coverage.
assumptions:
  - Control-plane terminal attach messages may add cols, rows, and resume_token without requiring synchronized deployment; omitted dimensions retain the 80x24 default.
  - A detached viewer remains resumable for 30 seconds before its grouped session and pane token are reaped.
  - terminal.lag is volatile transport status, while terminal.audit remains durable through the existing agent message queue.
uncertainties:
  - Grouped tmux lifecycle was exercised through the required TmuxRunner fake rather than by attaching to or modifying live user tmux sessions.
  - The legacy shared PTY/FIFO fallback remains available behind terminal.per_viewer_pty=false and retains its prior shared-focus semantics.
blockers: []
---

# Wave 4 AGENTD-TERM handoff

## Summary

- Added default-on per-viewer PTYs backed by grouped `ac-view-*` tmux sessions, with explicit window/pane selection and initial attach sizing from additive `cols`/`rows` fields.
- Enforced viewer roles at the tmux client layer using read-only `attach-session -r`; control transfer re-creates the prior and next controller clients with swapped roles.
- Added per-channel bounded drop-oldest output queues, `terminal.lag` notices, approximately 16 ms PTY read coalescing, and one base64 encoding per fan-out chunk.
- Added crash-safe grouped-session cleanup, detached-viewer expiry, and additive `terminal.audit` attach/detach/control-transfer events.
- Added additive resume tokens stored in memory and pane options; reconnects and agentd restarts validate the token, seed from `capture-pane`, and continue live PTY output.
- Preserved the legacy shared PTY/FIFO implementation behind `terminal.per_viewer_pty: false`; the flag defaults to true in loaded configuration.
- Added focused fake-runner, output-ring, config, and wire-handler coverage. The auxiliary `go test -race ./internal/tmux` verification also passed.

The `frozen_sha` is the final implementation commit; the following handoff-only commit adds this file.
