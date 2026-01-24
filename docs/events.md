# Events

Events are stored in Postgres and streamed to the UI in real time.

## Core event types

- `session.created` - a session appeared or was spawned.
- `session.updated` - metadata changes (status, title, repo, etc.).
- `session.deleted` - session removed.
- `approval.requested` - approval request created.
- `approval.decided` - approval decision made.
- `command.dispatched` - a command was sent to agentd.
- `command.completed` - command result recorded.
- `claude.hook` - provider hook payload captured.
- `codex.event` - codex job event line.
- `console.chunk` - console output chunk (streamed, not always persisted).
- `error` - error or failure event.

## Tool events

Tool events are tracked separately for structured tool usage. The UI subscribes to:
- `tool_event.started`
- `tool_event.completed`

## Snapshots

Snapshot updates are sent via `snapshots.updated` messages and include:
- `session_id`
- `capture_text`
- `capture_hash`
