# Tmux Workspace

The tmux workspace is the live working area inside the Command Center at `/`.
The former `/tmux` route redirects to `/` for compatibility.

It is built for keeping several tmux windows open across one or more machines
and jumping directly into the pane you want. The complete Command Center flow,
including launch, host enrollment, the command palette, and shortcuts, is
documented in [Command Center](command-center.md).

## What it shows

- Hosts with tmux capability and current online state
- Tmux sessions grouped into windows
- Panes nested under each window
- Repo, branch, provider, cwd, and activity context for each pane
- A persistent workbench for the selected pane

The dashboard loads the roster through `GET /v1/tmux/roster`, which returns
active, unarchived tmux pane sessions without snapshot payloads. The broader
`/v1/sessions` list remains available for inventory views that need snapshots or
mixed session kinds. Hosts that enable topology events can replace the inferred
structure with live window and pane state.

## Core workflow

1. Open `/`.
2. Select a host from the roster.
3. Choose a tmux session, window, and pane.
4. Work in the embedded terminal, or open a second pane alongside it on desktop.
5. Use the window strip and pane controls to create, rename, close, split, zoom,
   select, or terminate tmux resources.

## Window controls

The window strip reflects the active window plus activity and bell state. It
supports creating a window, selecting it, renaming it inline, and closing it.
Press `Enter` to save an inline rename or `Escape` to cancel. A close action only
uses the stronger session-ending warning when live topology proves it is the
last window.

## Pane controls

Pane controls support directional selection, zoom, termination, and horizontal
or vertical splits. Split actions are enabled only when the connected tmux
version supports the required command. The terminal key bar also exposes prefix,
window navigation, copy mode, zoom, splits, and pane navigation without a
hardware tmux prefix chord.

## Relationship to other pages

- `/` is the primary Command Center and tmux workflow.
- `/tmux` redirects to `/` and preserves its query parameters.
- `/sessions` is the broader inventory across tmux panes, jobs, and services.
- `/sessions/[id]` is the standalone session detail route.
- `/orchestrator` focuses on waiting-for-input, approvals, and errors.
- `/automation` focuses on orchestrators, workers, wakeups, runs, and governance.

## Design constraints

- The workspace reuses the existing session and terminal runtime; it does not
  introduce a second tmux backend model.
- Unmanaged panes already present in the session registry appear automatically.
- Terminal attach and control require an operator-capable user and a host with
  terminal capability enabled.
- Multiple browser viewers can attach to one pane; control and read-only state
  are handled per terminal channel.
- Window and pane actions update optimistically, then reconcile with live
  topology or roster state.

## Launch

The desktop launch rail and compact mobile sheet share the launch contract in
[Mobile Launch](mobile-launch.md). New and reopened panes return a canonical
`/?host_id=...&session_id=...&mode=terminal&attach=1` URL that opens the Command Center terminal directly (mode/attach select and auto-attach the pane).
