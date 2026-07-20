---
lane: FW1-TMUX-GO
frozen_sha: 7a8e6eeb6e2b93f6fdc2d75dcae7dddf17f308a3
attempt: 2
state: frozen
gates:
  lint: pass
  typecheck: pass
  test_ci: pass
  smoke: pass
  build: pass
  go: pass
proof:
  - "~/.local/go/bin/go build ./... → pass from agents/agentd at R2 frozen_sha"
  - "~/.local/go/bin/go vet ./... → pass from agents/agentd at R2 frozen_sha"
  - "~/.local/go/bin/go test ./... → pass at R2 frozen_sha; cmd/agentd, tmux, ws, fixture matrix, and all other agentd packages green"
  - "TestQueueTmuxTopologyDefaultOffWritesNoWebSocketFrame → connected WS client received no frame with tmux.topology_events omitted/default false"
  - "TestHookCommandsFiltersAgentdSignalsFromSnapshot + TestTopologyHooksRemoveStaleAgentdSignalsOnStartup → private ac-test-* servers filtered prior agent signals, removed crash leftovers, and preserved user hooks"
  - "TestTerminalSweeperReapsStaleViewerAndChannelState → stale TTL removed both viewer indexes, all channel/controller maps, PTY/grouped session, and resume option"
  - "TestTopologyHooksAppendSignalAndRestoreExistingHooks → private ac-test-* tmux hook fired, existing hook preserved, exact hook set restored"
  - "TestExecute*AgainstPrivateTmux → all eight window/pane dispatch operations changed observable private-server state"
  - "TestTerminalAttachSupersedesStaleChannelAfterControlPlaneReconnect → two real WebSocket connections resumed one private-server pane and removed the old channel"
  - "TestCapturePaneRangePagesStableContiguousHistory → repeated and adjacent 20-line history pages stable, contiguous, and non-overlapping"
  - "TestProtocolFixtureMatrixRoundTripsProductionTypes → all frozen topology and command fixtures round-trip through registered Go types"
assumptions:
  - "split_pane horizontal maps to tmux -h and vertical maps to tmux -v; percent uses tmux -l <n>% for current-version compatibility."
  - "tmux 2.4 is the minimum hook-capable version; each requested hook is also probed individually and unsupported hooks are skipped."
  - "The full-state tmux.topology envelope is volatile and intentionally unsequenced because the frozen fixture omits seq."
uncertainties: []
blockers: []
---

# FW1-TMUX-GO handoff

## What changed

- Extended tmux pane discovery and `sessions.upsert` metadata with active state, zoom, raw layout, pane dimensions, bell/activity flags, and attached-session state used by topology.
- Added sorted full-host `tmux.topology` snapshots, 500 ms coalescing, startup emission, poll drift reconciliation, and a frozen unsequenced wire envelope. Emission is gated by `tmux.topology_events` and defaults off until the control plane accepts the envelope.
- Added version-detected, per-hook-probed global tmux hooks using blocking `wait-for` signals. Agentd appends beside user hooks, scrubs stale agent signals, and restores the exact prior user hook arrays on shutdown; unsupported/no-server startup degrades to the existing poll with a log line.
- Added validated executor handling and tmux client methods for new/kill/rename/select window and split/select/resize/zoom pane. Pane targets are constrained to the dispatch session's tmux session.
- Marked terminal viewers stale when their control-plane WebSocket disappears. A valid resumed attach supersedes only a stale prior channel; a still-active token remains protected from takeover.
- Proved existing `CapturePaneRange` range behavior without changing it and froze all nine new shared JSON fixtures with Go round-trip coverage.

## Decisions within lane latitude

- Topology is latest-state data, so it is not persisted in the durable sequence queue; later snapshots supersede earlier ones.
- `tmux.topology_events` defaults false because the deployed control plane terminates connections on its currently unknown envelope; Wave 2 can explicitly enable it after schema and handler support land.
- Hook signals are unique per process and hook and do not use shell scripts or polling.
- Every real tmux test starts through a dedicated `tmux -L ac-test-*` wrapper and cleans up only that private server with `kill-server`; no test targets the default server and no test uses `kill-session` against it.
- The real reconnect test exposed and fixed a pre-existing literal-`\\t` pane-description format that fake-runner tests had masked.

## Deferred

- TypeScript schema, control-plane routing, and dashboard consumption remain owned by Wave 2, using the committed fixtures unchanged.
- tmux version gating for percent splits and last-window session termination behavior remain Wave 3 scope.

## R2 corrections

- Gated every topology emission path at the shared debounce queue behind the default-off `tmux.topology_events` config flag; existing emission tests now opt in, and a connected-WebSocket regression test proves default-off sends nothing.
- Filtered stale `wait-for -S ac-agentd-*` commands out of hook snapshots and rebuilt each supported hook on startup before registering the current process signal. Private-socket tests prove stale cleanup and exact user-hook restoration.
- Timestamped control-plane-stale terminal viewers and extended the existing TTL sweep to remove their viewer/token entries, channel and controller maps, PTY bridge, grouped session, resume option, and newly orphaned viewer sessions.

The `frozen_sha` is the final implementation commit; the following handoff-only commit adds this file.

FW1-TMUX-GO-R2 FROZEN 7a8e6eeb6e2b93f6fdc2d75dcae7dddf17f308a3
