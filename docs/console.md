# Console Streaming

Agent Commander exposes live tmux panes in the web UI. You can watch output, send input, and resize the terminal.

## How it works

- The dashboard opens a WebSocket to `/v1/ui/terminal/:sessionId`.
- The control plane authenticates the request with a JWT.
- agentd attaches to the tmux pane using a PTY bridge (preferred).
- Output is streamed back to the UI and rendered with xterm.

## Control vs read only

Only one viewer has control at a time. Additional viewers are attached in read only mode and receive output but cannot send input.

Status messages:
- `attached` - channel connected.
- `control` - you have control.
- `readonly` - another viewer has control.
- `detached` - channel closed.
- `idle_timeout` - viewer timed out.

## Idle timeout

Terminal channels automatically detach after 10 minutes of inactivity to prevent stale connections.

## Input messages

The UI sends JSON messages:
- `{ "type": "input", "data": "ls -la\n" }`
- `{ "type": "resize", "cols": 120, "rows": 30 }`
- `{ "type": "control" }` (request control)
- `{ "type": "detach" }`

## Notes

- PTY mode preserves terminal semantics (cursor, colors, Ctrl+C).
- FIFO mode is used as a fallback when PTY attach fails.
