# Mobile Launch

Mobile launch is the workflow for starting or reopening coding work from a phone.
It is built around launch targets instead of the full desktop session generator.

## Operator Flow

1. Open Agent Commander on a phone.
2. Choose a machine by alias, such as `heavisidelinux` or `homelinux`.
3. Pick a recent project or enter an allowed working directory.
4. Choose Codex or Claude Code.
5. Optionally enter an initial prompt.
6. Launch and land on `/tmux?host_id=...&session_id=...&mode=terminal&attach=1`.

The server waits briefly for the new tmux pane to become openable. If the pane is
ready, the response includes `terminal.openable: true`; if not, the dashboard can
still navigate to the returned tmux URL and continue normal roster refresh.

## API Shape

- `GET /v1/launch/targets` returns host aliases, online state, terminal/spawn
  support, provider support, allowed directory roots, recent projects, and recent
  tmux panes, and recent launches.
- `POST /v1/launch` starts a provider in tmux through the existing session spawn
  service, waits up to `wait_timeout_ms` for `tmux_pane_id`, optionally sends the
  initial prompt after the pane is ready, and returns a tmux navigation URL.
- `POST /v1/tmux/open` opens an existing tmux pane by target or pane id, adopts
  unmanaged panes that are already in the session registry, and returns the same
  terminal navigation URL.

The launch path reuses the normal session, memory, terminal, audit, and agentd
command runtime. It does not create a second tmux model.

## Policy Notes

Launch is an operator action. Discovery of launch targets is available to viewer
roles, but starting a provider requires operator permissions.

Privileged commands such as `spawn_session`, `spawn_job`, `list_directory`, and
`kill_session` are blocked from generic session command dispatch. They must go
through dedicated capability-checked endpoints.

Host-level commands, such as directory listing, use the shared command router
with the host command session id `00000000-0000-0000-0000-000000000000`.

## Current State

- The backend launch contract is in place.
- The `/tmux` mobile header has a plus button that opens a launch sheet for
  recent projects, manual paths, Codex/Claude selection, optional prompts, and
  tracked existing panes.
- Successful launches are remembered in browser local storage for the planned
  repeat-last fallback, recorded in the control plane recent launch store, and
  exposed in the launch sheet when a matching host is available.
- Successful launches also update synced settings for default mobile launch
  provider, machine, and tmux target.
- Opening an existing tmux target uses `POST /v1/tmux/open`; tracked panes can be
  opened from the list, and a manual target or pane id can be entered.
- Mobile pane actions use a typed terminal controller ref instead of a
  window-level custom event bridge.
- The terminal view has started moving into smaller pieces: the toolbar,
  surface, and clipboard behavior are now separated from the main terminal
  runtime.
- `pnpm verify:launch` runs the focused schema, control-plane, dashboard
  typecheck, and dashboard smoke checks for this workflow.
