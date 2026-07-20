# FW1-TMUX-GO — Correction round R2 (Wave 1)

Lane: FW1-TMUX-GO (attempt 2) · Same worktree `~/dev/wt/ac-fw1-tmux-go`, same branch `refactor/fw1-tmux-go`, same firewall (`agents/**` + `tests/fixtures/protocol/` new files only) · Push to origin.
Context: your frozen work at `eaadfe9` passed my mechanical review and the Go gate, and is integrated. An independent adversarial reviewer then confirmed the exact uncertainty you flagged in your handoff — and two more findings. The wave PR is held on these. Fix only what is listed; no scope beyond it.

## C1 (critical) — topology emission must be default-OFF

Confirmed: the deployed control plane validates agent messages against a closed `AgentMessageSchema` and calls `socket.terminate()` on parse failure (`services/control-plane/src/ws/agent.ts` ~163-171). Your `reconcileTmux("startup")` → `queueTmuxTopology` emits ~500ms after start, so a new agentd against the current CP enters a terminate/reconnect loop on tmux activity, and `MarkChannelsStale` churns terminal viewers.

Fix: gate ALL `tmux.topology` emission behind a config flag (suggested: `tmux.topology_events`, YAML `topology_events` under the tmux section), **default false**. When false: no topology envelopes are sent (hooks may still be registered or not — your call, but no wire emission). Keep all machinery and tests (tests enable the flag explicitly). Wave 2 registers the schema + CP handler and flips the story to capability-negotiated emission; until then the flag stays off. Add a test proving that with the flag off, no `tmux.topology` frame is written to the WS client.

## W3 (warning) — tmux hook lifecycle pollution

Confirmed in `agents/agentd/internal/tmux/hooks.go`:
- On crash (no clean shutdown), appended `wait-for -S ac-agentd-<pid>-…` hook commands persist on the user's default tmux server and accumulate across restarts (`set-hook -ag`).
- `hookCommands()` snapshots existing hook commands with no filtering, so leftover `ac-agentd-*` entries from a crashed prior run get captured as "user hooks" and re-installed by `restoreHook()` on clean shutdown — baking them in permanently.

Fix: (1) when snapshotting existing hooks on startup, filter out any command matching the `ac-agentd-` signal pattern; (2) on startup, proactively remove stale `ac-agentd-*` hook commands left by prior runs (rebuild each hook's command list without them); (3) tests for both, on a private `-L` server as before.

## W4 (warning) — stale viewers never reaped

`MarkChannelsStale` leaves `channelID` set, and `Sweep()` only reaps `channelID == ""` viewers, so a stale viewer that is never resumed leaks its PTY bridge + grouped viewer session + goroutine. Fix: record a stale-at timestamp in `MarkChannelsStale`; extend `Sweep` to expire viewers stale longer than the existing idle TTL (close bridge, delete all channel maps, orphan viewer session cleanup). Test: mark stale, advance/emulate TTL, assert full cleanup.

## Recorded, NOT yours to fix (Wave 2/3 scope)

- CP schema registration for `tmux.topology` + the 8 command types, CP log-and-drop on unknown agent envelope types → FW2-CONTRACTS.
- `split_pane -l N%` requires tmux ≥ 3.1 while hooks accept ≥ 2.4; `kill_window` on a session's last window kills the session → Wave 3 UI gating/confirmations. Do not change behavior now.

## Done

Gates as before (`go build ./... && go vet ./... && go test ./...` in agents/agentd). Commit with prefix `fix(agentd):`, push, update your handoff file (`tasks/frontend-ux-handoffs/fw1-tmux-go.md`: attempt: 2, new frozen_sha, append an "R2 corrections" section), then print exactly:

`FW1-TMUX-GO-R2 FROZEN <full-sha>`
