# Command Center

The signed-in landing page at `/` is Agent Commander's Command Center. It is
the primary surface for moving from fleet health to a live tmux pane without
changing pages. The old `/tmux` URL is a compatibility redirect to `/` and
preserves launch and selection query parameters.

## Fleet and roster

The fleet strip and host roster render first so an operator can immediately see
online state, sessions that need attention, and the host/session/window/pane
hierarchy. Selecting a pane opens it in the terminal workspace. `/sessions`
remains the full inventory for tmux panes, jobs, and services.

Live `tmux.topology` snapshots provide authoritative window and pane structure
when a host supports them. Until then, the roster derives the same hierarchy
from registered sessions. If a live topology feed is silent for 30 seconds, the
UI returns to the last roster snapshot.

## Windows and panes

The window strip supports selecting, creating, renaming, and closing windows.
Closing a proven last window warns that the tmux session will end; when the UI
only has roster-derived structure it uses a less specific close warning.

Pane controls support horizontal and vertical splits when the host's tmux
version allows them, directional pane selection, zoom, and pane termination.
Window and pane changes are optimistic, then reconcile with authoritative host
state.

## One terminal or two

Desktop operators can open a secondary pane for a two-up terminal layout. Each
slot has its own target selector and can be closed independently. Compact
layouts keep one visible terminal and provide quick switching between panes.

The primary terminal survives navigation around the dashboard. A terminal that
remains hidden is detached after five minutes; the active terminal channel also
has the control plane's ten-minute inactivity timeout.

## Terminal and history

The terminal streams directly into xterm and supports:

- control, read-only, detached, and reconnecting states;
- **Take control** when another viewer owns input;
- a 10,000-line local scrollback buffer;
- `Ctrl+F` or `Cmd+F` search, with next and previous match controls;
- a separate range-based terminal history panel with **Load older** paging;
- tmux key controls for prefix, previous/next window, copy mode, zoom, splits,
  and pane navigation.

New output follows the terminal only while it is already live. Scrolling up or
selecting text does not pull the viewport back to the bottom; use **Live** to
resume following.

## Composer and attention overlay

The prompt composer sends structured input to the active terminal. Use
`Ctrl+Enter` or `Cmd+Enter` to send. On desktop, `ArrowUp` at the beginning of
an empty composer recalls recent prompts.

When a session needs input or approval, the terminal attention overlay keeps
the intervention in context. Operators can approve, deny, or respond without
leaving the terminal. Approve and deny remain available to an operator who is
watching read-only; free-form response and the composer require terminal
control.

## Launch and reopen

The launch rail provides three paths:

- **New** starts Codex or Claude Code on a selected host and allowed directory,
  with an optional initial prompt.
- **Recent** repeats a recorded launch target.
- **Open existing** attaches to a tracked pane or a manually entered tmux
  target.

On compact layouts, the same contract is presented by the mobile launch sheet.
Successful launches and opens return a canonical `/?host_id=...&session_id=...`
URL and select the terminal when it becomes available.

## Add a host

Admins can choose **Add host** on the Hosts page, name the host, and receive a
one-time enrollment token plus generated `agentd` configuration. Copy the token
or configuration before dismissing the result; the dashboard clears the
one-time secret instead of persisting it. Existing hosts expose token rotation
as a separate admin action.

## Command palette and shortcuts

Open the command palette with `Ctrl+K`, `Cmd+K`, `/` outside an editable field,
or the search control. It searches routes, sessions, hosts, launch actions, and
theme actions. Use arrow keys to move, `Enter` to run a command, and `Escape` to
close.

Other surface-specific shortcuts are shown where they apply:

- `Ctrl+F` / `Cmd+F`: search the active terminal.
- `Ctrl+Enter` / `Cmd+Enter`: send the prompt composer.
- `Shift+?`: open keyboard help on the Sessions page.
- `s`, `a`, `d`, `i`: Sessions-page focus and action shortcuts.
- `Shift+1` through `Shift+4`: Sessions-page status filters.
- `Enter` / `Escape`: commit or cancel an inline window rename.

Keyboard commands are ignored while typing in an editable field unless the
shortcut belongs to that field.
