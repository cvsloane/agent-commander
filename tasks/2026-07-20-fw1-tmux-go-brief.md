# FW1-TMUX-GO — Structured tmux model in agentd (Wave 1)

Lane: FW1-TMUX-GO · Machine: heavisidelinux · Worktree: `~/dev/wt/ac-fw1-tmux-go` · Branch: `refactor/fw1-tmux-go` (off `origin/refactor/frontend-command-center`; PUSH to origin regularly)
Program: `tasks/2026-07-20-frontend-tmux-ux-master-plan.md` · Acceptance: `tasks/frontend-ux-acceptance-checklist.md` (Wave 1 / FW1-TMUX-GO section is your contract)
Go toolchain: `~/.local/go/bin`.

## Mission

Give the dashboard a structured, real-time tmux model and in-app window/pane management — all in agentd. The per-viewer PTY terminal transport is NOT to be modified (locked decision #3); you are adding out-of-band structure beside it. The JSON fixture shapes below are the frozen cross-language contract: Wave 2 implements the TypeScript side against your committed fixtures.

## SAFETY — heavisidelinux tmux

The host tmux server on this machine has crashed on `kill-session` before. **Never run kill-session/kill-server against the default tmux server.** All tests that need tmux MUST spawn a private server via a dedicated socket (`tmux -L ac-test-$RANDOM ...`) and clean up only that socket's server.

## Work items

1. **Extended pane collection.** Extend the `list-panes -a` format in `agents/agentd/internal/tmux/tmux.go` (`ListPanes`, format at ~line 50) with: `pane_active`, `window_active`, `window_zoomed_flag`, `window_layout`, `pane_width`, `pane_height`, `window_bell_flag`, `window_activity_flag`. Plumb the new fields through `syncPanes` into `sessions.upsert` `metadata.tmux` (see `cmd/agentd/main.go` ~4641-4757). Additive only — existing metadata keys unchanged.
2. **`tmux.topology` event.** New agent→CP envelope emitting a debounced (≥500ms coalesce) full topology snapshot for the host's tmux sessions, with a `reason` field. Shape frozen below. Emit on hook triggers (item 3) and whenever a reconciliation poll detects drift vs the last emitted snapshot. Unknown-envelope tolerance: the current CP will ignore it until Wave 2 — that is expected and fine.
3. **tmux hooks.** On agentd start, feature-detect tmux hook support (version check) and register global hooks that touch a trigger (e.g. run a tiny `tmux wait-for -S`-style signal or write to a pipe agentd watches — your choice, but no busy-polling): `after-new-window`, `after-kill-pane`, `after-split-window`, `window-renamed`, `session-renamed`, `session-created`, `session-closed`, `after-resize-pane` (register only supported ones). Hooks are additive — preserve any pre-existing user hook values by appending, and restore on shutdown. If hooks unsupported → poll-only degradation with a log line. Existing `pollTmux` cadence stays as reconciliation.
4. **Window/pane command executor.** Add `CommandPayload` handling in the executor switch (`cmd/agentd/main.go` ~1916) for: `new_window`, `kill_window`, `rename_window`, `split_pane`, `select_window`, `select_pane`, `resize_pane`, `zoom_pane`. Client methods `NewWindow`/`SplitPane`/`KillPane`/`ResizePane` exist in `internal/tmux/tmux.go`; add the missing ones (`KillWindow`, `RenameWindow`, `SelectWindow`, `SelectPane`, `ZoomPane`). Target resolution: the dispatch's `session_id` resolves to its tracked pane; window ops apply to that pane's tmux session, using `window_index` from the payload where given. Results go back via the existing `commands.result` path (ok / structured error). Unit tests per op against a private-socket tmux server.
5. **Resume supersede after CP restart.** Close the deferred W4-TERM-CLIENT item: when a `terminal.attach` arrives for a channel whose previous CP connection is gone (stale attached channel), agentd must supersede the stale channel (detach it, honor the new attach — resume token validation unchanged) instead of rejecting. Add an integration test that simulates a CP reconnect (new WS connection, same pane, valid resume token) and asserts the new attach succeeds and the old channel is cleaned up. Relevant: `internal/tmux/terminal.go` (~300-330), `viewer_pty.go`.
6. **Scrollback paging verification.** Prove `capture_pane` `range` mode supports stable history paging: a test that fills a pane with known numbered lines, captures two consecutive ranges, and asserts contiguity/non-overlap. Extend `CapturePaneRange` (`tmux.go` ~187) only if the proof fails.
7. **Protocol fixtures.** Commit NEW files under `tests/fixtures/protocol/` exactly matching the shapes below (naming follows existing `commands-dispatch-<type>.json`), and extend the Go round-trip fixture test to cover them. After you freeze, these shapes change only with AI Lead sign-off.

## Frozen contract shapes

`tests/fixtures/protocol/tmux-topology.json` (agent→CP; one snapshot per host, sessions sorted by name, windows by index, panes by index):

```json
{"v":1,"type":"tmux.topology","ts":"2026-07-20T14:00:00Z","payload":{"reason":"hook:window-renamed","tmux_sessions":[{"session_name":"agent-command","attached":true,"windows":[{"window_index":1,"window_name":"fw1-modern","active":true,"zoomed":false,"layout":"tiled","bell":false,"activity":false,"panes":[{"pane_id":"%12","pane_index":0,"active":true,"width":190,"height":45,"title":"codex","current_command":"codex","current_path":"/home/cvsloane/dev/wt/ac-fw1-modern"}]}]}]}}
```

`reason` values: `"hook:<hook-name>"`, `"poll"`, `"startup"`.

Command dispatch fixtures (same envelope as existing `commands-dispatch-*.json`; payloads):

```json
{"type":"new_window","payload":{"window_name":"scratch","cwd":"/home/cvsloane/dev/agent-command"}}
{"type":"kill_window","payload":{"window_index":3}}
{"type":"rename_window","payload":{"window_index":3,"name":"builds"}}
{"type":"split_pane","payload":{"direction":"vertical","percent":50,"cwd":"/home/cvsloane/dev/agent-command"}}
{"type":"select_window","payload":{"window_index":2}}
{"type":"select_pane","payload":{"pane_id":"%14"}}
{"type":"resize_pane","payload":{"pane_id":"%14","width":120,"height":30}}
{"type":"zoom_pane","payload":{"pane_id":"%14"}}
```

Optionality: `new_window` both fields optional; `split_pane` `direction` required (`"horizontal"|"vertical"`), `percent`/`cwd` optional; `resize_pane` needs `pane_id` plus at least one of `width`/`height`; `zoom_pane` toggles. File names: `commands-dispatch-new-window.json`, `-kill-window`, `-rename-window`, `-split-pane`, `-select-window`, `-select-pane`, `-resize-pane`, `-zoom-pane`.

## Ownership firewall

You may edit: `agents/**` and NEW files under `tests/fixtures/protocol/`. Nothing else — no `packages/`, `services/`, `apps/`, `migrations/`. The TS side of these contracts is Wave 2's job.

## Gates (all must pass before freeze)

`cd agents/agentd && go build ./... && go vet ./... && go test ./...` — including your new unit/integration tests and the extended fixture round-trip test. Commit per work item, message prefix `feat(agentd):` / `test(agentd):`. Push the branch to origin as you go.

## Done

All acceptance items checked, gates green, handoff written to `tasks/frontend-ux-handoffs/fw1-tmux-go.md` (schema in that directory's README), committed on your branch and pushed, then print exactly:

`FW1-TMUX-GO FROZEN <full-sha>`

If blocked (≤3 attempts on the same failure), set `state: held` in the handoff with exact evidence and stop — do not lower the bar.
