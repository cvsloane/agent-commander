# Launch and Reopen

The Command Center uses one launch contract across desktop and compact layouts.
Desktop presents it as a launch rail; mobile presents the same choices in a
sheet.

## Operator flow

1. Open Agent Commander.
2. Choose **New**, **Recent**, or **Open existing**.
3. For a new launch, select a machine, an allowed directory or recent project,
   and Codex or Claude Code. An initial prompt is optional.
4. For an existing target, select a tracked pane or enter a tmux target/pane ID.
5. Launch or open the pane and land on
   `/?host_id=...&session_id=...&mode=terminal&attach=1`.

The server waits briefly for a newly spawned tmux pane to become openable. When
it is ready, the response includes `terminal.openable: true`; otherwise the
dashboard can still navigate to the canonical URL and let normal roster
reconciliation select the pane when it appears.

## API shape

- `GET /v1/launch/targets` returns host aliases, online state, terminal/spawn
  support, providers, allowed directory roots, recent projects, recent tmux
  panes, and recent launches.
- `POST /v1/launch` starts a provider through the existing session spawn
  service, waits up to `wait_timeout_ms` for `tmux_pane_id`, optionally sends an
  initial prompt, and returns a Command Center navigation URL.
- `POST /v1/tmux/open` opens an existing pane by target or pane ID, adopts an
  unmanaged pane already in the registry, and returns the same navigation URL.

The path reuses the normal session, memory, terminal, audit, and `agentd`
command runtime. It does not create a second tmux model.

## Recent launches and defaults

Successful launches are recorded by the control plane and shown by the launch
surface when a matching host is available. Browser state retains the most recent
launch target, while synced settings retain default provider, machine, and tmux
target preferences.

## Permissions and command routing

Launch-target discovery is available to viewers. Starting a provider or opening
a controllable terminal requires operator permission.

Privileged commands such as `spawn_session`, `spawn_job`, `list_directory`, and
`kill_session` are blocked from generic session command dispatch. They use
dedicated capability-checked endpoints. Host-level commands use the shared
command router with host command session ID
`00000000-0000-0000-0000-000000000000`.

## Verification

`pnpm verify:launch` runs the focused schema, control-plane, dashboard
typecheck, and dashboard smoke checks for this workflow.
