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

## Final gate

Pending.
