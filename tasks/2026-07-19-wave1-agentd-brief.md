# Wave 1 agentd Brief — Connection Resilience (heavisidelinux)

You are an implementation agent on heavisidelinux executing Wave 1 of the massive refactor program. Read first:
- `tasks/2026-07-19-massive-refactor-master-plan.md` (program + coordination protocol)
- `tasks/2026-07-19-subsystem-study-findings.md` §1 agentd (defect list with file:line refs)

## Ground rules
- Branch: `refactor/wave1-agentd` off latest `refactor/tmux-command-center` (pull first).
- Touch ONLY `agents/agentd/**` (and `agents/hook-proxy/**` if strictly needed). New protocol fixture files under `tests/fixtures/protocol/` may be ADDED, never edited.
- Wire protocol stays backward-compatible: the control plane is NOT being changed in lockstep on this branch. Additive only.
- Go toolchain: `export PATH=$HOME/.local/go/bin:$PATH` (Go 1.23.4, installed 2026-07-19). Do NOT touch the system-installed/running agentd binary or service.
- Commit early and often with conventional messages; push the branch when the gate is green.
- Keep a running log in `tasks/2026-07-19-wave1-agentd-notes.md` (on your branch): what changed, decisions, anything you could not verify.

## Tasks (in order)

1. **Fix outage data loss** (`internal/ws/client.go:257-295`): durable messages must be pushed to the persistent queue regardless of connection state; sends while disconnected are queued, not dropped. Fix the restart **seq collision** (`client.go:58-61` + `cmd/agentd/main.go:386-393`): seq counter must start above the max seq surviving in the reloaded queue.
2. **Durable vs volatile lanes**: `terminal.output`, `sessions.snapshot`, `console.chunk` must BYPASS the disk queue entirely (send-if-connected, else drop). Everything else (hooks, events, upserts, prune, commands.result, usage, approvals) is durable. Eliminate stale-terminal-frame replay.
3. **Replay after hello, paced**: `onConnect` currently runs `ResendQueued()` before `sendHello()` (`main.go:378-383`). Invert; pace/batch the replay (e.g. chunks with small delays) so reconnect doesn't hammer the control plane.
4. **Jittered reconnect backoff** (`client.go:208-255`): exponential with full jitter, cap ~30s; add dial timeout.
5. **Async command executor**: move `commands.dispatch` handling off the WS reader goroutine into a worker pool with per-session FIFO ordering (terminal.* handling must never be blocked by a spawn/git op). Preserve exactly-one `commands.result` per cmd_id — and fix the existing **duplicate result for capture_pane** (`main.go:2171` + `main.go:1951`).
6. **Lock hygiene**: stop holding `sessionsMu` across tmux/git subprocess calls (`main.go:4554-4764`). Gather subprocess results first, then take the lock to mutate.
7. **Poll efficiency**: include `#{@ac_session_id}` in the `list-panes -F` format (`internal/tmux/tmux.go:39`) and delete the per-pane `GetPaneOption` exec loop (`main.go:4568`).
8. **Hook buffering**: hooks for sessions not yet known (pane not yet polled) are currently dropped (`main.go:3430-3434`). Buffer them briefly (≥1 poll cycle, e.g. 5s) and retry match before dropping; log drops.
9. **Send() error visibility**: `Send` errors are ignored at ~40 call sites. Add a small helper (send-or-log with a Prometheus drop counter by message type); convert call sites mechanically.
10. **Version stamping**: single Version constant used everywhere (fix `main.go:127` vs `main.go:1666` duplication); wire `-ldflags -X` support.
11. **Tests** (this is a gate, not a nice-to-have):
    - `internal/queue`: push/ack/prune/compaction/reload + seq-resume semantics incl. the collision case.
    - `internal/ws`: reconnect/backoff/queue interaction against an in-process fake WS server; durable-vs-volatile lane behavior; replay-after-hello ordering.
    - Command executor: per-session ordering, non-blocking of terminal messages, single-result-per-cmd invariant.
    - Where a seam is needed, introduce a minimal `TmuxRunner` interface over `tmux.Client` — smallest possible change, don't refactor the world.
12. **Incidental decomposition allowed**: if a task requires carving code out of `cmd/agentd/main.go` (e.g. executor → `internal/commands`), do it minimally and keep behavior identical; full decomposition is a later wave.

## Gate (must pass before pushing)
```bash
cd agents/agentd
go build ./... && go vet ./... && go test ./...
```
Record gate output in the notes file. If something cannot pass (e.g. environment limits), document it precisely rather than skipping silently.
