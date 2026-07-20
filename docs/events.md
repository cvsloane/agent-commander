# Events

Events are stored in Postgres and streamed to the UI in real time.

## Registered event types

- `approval.requested` - approval request created.
- `approval.decided` - approval decision made.
- `command.completed` - command result recorded.
- `claude.hook` - provider hook payload captured.
- `claude.event` - Claude headless job event line.
- `codex.hook` - Codex hook payload captured.
- `codex.event` - codex job event line.
- `workshop.*` - normalized provider lifecycle, tool, and subagent hooks.
- `orchestrator.report` - structured completion from an orchestrator session.
- `terminal.audit` - durable terminal attach, detach, and control transfer.

Each registered type has a Zod payload schema in `@agent-command/schema`. The
control plane warns and increments `agent_command_event_payload_validation_total`
for unknown or invalid payloads, but still stores and streams them so telemetry is
never lost during version skew.

## Retention

Set `DATA_RETENTION_DAYS=30` for the standard 30-day events and snapshots window.
Retention is off when the variable is omitted. Sweeps delete in bounded batches;
each run has an overall batch cap and the timestamp indexes keep pruning work
bounded. Session, approval, command, usage, and audit records are not part of
this job.

## Tool events

Tool events are tracked separately for structured tool usage. The UI subscribes to:
- `tool_event.started`
- `tool_event.completed`

## Snapshots

Snapshot updates are sent via `snapshots.updated` messages and include:
- `session_id`
- `capture_text`
- `capture_hash`
