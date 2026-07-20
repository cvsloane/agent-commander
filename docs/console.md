# Console Streaming

Agent Commander exposes live tmux panes in the Command Center. Operators can
watch output, search scrollback and saved history, send input, resize the
terminal, and transfer control between viewers.

## How it works

- The dashboard opens a WebSocket to `/v1/ui/terminal/:sessionId`.
- The control plane authenticates the request with a JWT.
- `agentd` attaches to the tmux pane using a PTY bridge when available.
- Output frames are routed directly to xterm instead of through React state.
- Status changes update the terminal connection state separately from output.

## Control and read-only modes

Only one viewer controls input at a time. Additional viewers attach read-only
and continue receiving output. **Take control** requests ownership. The prompt
composer and free-form attention responses are disabled without control, while
operator approval and denial actions remain available.

See [Per-viewer Terminal](per-viewer-terminal.md) for `agentd` configuration,
control transfer, and reconnect behavior.

Status messages:

- `attached` - channel connected.
- `control` - you have control.
- `readonly` - another viewer has control.
- `detached` - channel closed.
- `idle_timeout` - viewer timed out.

## Persistence and timeouts

The primary terminal remains mounted while the operator navigates between
dashboard pages. A terminal that stays hidden is detached after five minutes.
Separately, a terminal channel automatically detaches after ten minutes without
terminal activity to prevent stale connections.

## Scrollback, search, and history

- xterm retains 10,000 lines of local scrollback.
- `Ctrl+F` or `Cmd+F` opens terminal search; the search controls move to the
  next or previous match.
- New output follows only while the viewport is live. Scrolling up or selecting
  text preserves the operator's position until **Live** is selected.
- The history panel reads stored output by range and offers **Load older**; it
  is separate from the active terminal scrollback.

## Input messages

The UI sends JSON messages:

- `{ "type": "input", "data": "ls -la\n" }`
- `{ "type": "resize", "cols": 120, "rows": 30 }`
- `{ "type": "control" }` to request control
- `{ "type": "detach" }`

Raw xterm data, paste, the virtual key bar, and the prompt composer share one
guarded input path so read-only viewers cannot bypass control ownership.

## Notes

- PTY mode preserves terminal semantics such as cursor state, colors, and
  `Ctrl+C`.
- FIFO mode is used only when PTY attach is unavailable.
- Desktop can mount a second terminal alongside the primary; compact layouts
  expose quick switching while keeping one visible terminal.
