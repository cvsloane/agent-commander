# Wave 1 agentd implementation notes

Branch: `refactor/wave1-agentd`

## Baseline

- Confirmed the worktree was clean and based on the latest `origin/refactor/tmux-command-center` at `8cfad09`.
- Toolchain used: `go version go1.22.0 linux/amd64` with `~/.local/go/bin` first on `PATH`.
- Pre-change gate passed: `go build ./...`, `go vet ./...`, and `go test ./...` from `agents/agentd`.

## Connection durability and replay

- Durable messages are appended and synced to the outbound queue before a connection is required. A disconnected durable send is considered successfully queued.
- `terminal.output`, `sessions.snapshot`, and `console.chunk` are volatile: they bypass the queue and are dropped with a visible send error while disconnected.
- Sequence 1 is reserved for the initial hello. On startup, surviving legacy queue entries are rebased above the hello cursor if needed, and the live counter resumes above both the acknowledged cursor and maximum queued sequence.
- Hello bypasses persistence and reuses the acknowledged cursor. Replay begins only after hello and runs in ordered batches of 100 with a 25 ms inter-batch pause.
- Reconnect delay uses full jitter over the configured exponential ceilings, growing beyond the configured list to a 30 second cap. WebSocket handshakes have a 10 second timeout.
- Added focused queue and WebSocket tests, including fake-server reconnect/replay coverage.
- Focused checkpoint: `go test ./internal/queue ./internal/ws ./cmd/agentd` passed.

## Command, polling, hook, and observability paths

- Added a four-worker command executor with in-memory per-session FIFO queues. `commands.dispatch` now returns immediately from the WebSocket reader after enqueueing.
- The executor owns result construction and deduplicates accepted `cmd_id` values. `capture_pane` now returns its capture payload to the executor instead of sending a second result itself.
- `list-panes` now includes the configured session option (`@ac_session_id` by default); both daemon polling and the `sessions` CLI use the parsed value without per-pane option subprocesses.
- Tmux option writes plus git metadata/status resolution occur before the polling mutation lock. Session updates are cloned and sent after releasing `sessionsMu`. The adopt path also no longer holds `sessionsMu` over a tmux subprocess.
- Unknown-pane Claude/Codex hooks are buffered for at least one configured poll cycle (minimum five seconds), retried after polling, and explicitly logged when they expire unmatched.
- Added `Agent.send`, which logs every send error and increments `agentd_message_drops_total{type=...}`. All agent send call sites now use it.
- The single build-stampable `Version` variable is used by CLI/status/hello and supports `-ldflags "-X main.Version=..."`.
- Added command executor, hook buffering, and tmux pane parsing tests.
- Focused checkpoints passed: `go test ./...` and `go test -race ./internal/commands ./internal/queue ./internal/ws ./cmd/agentd`.

## Final gate

Pending.
