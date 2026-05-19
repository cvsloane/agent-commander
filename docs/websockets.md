# WebSockets

Agent Commander uses three WebSocket channels:
- UI stream
- Terminal stream
- Agent stream

## UI stream

Endpoint: `/v1/ui/stream?token=<jwt>`

The UI sends a subscription message:
```json
{ "type": "ui.subscribe", "payload": { "topics": [
  { "type": "sessions", "filter": { "status": "RUNNING" } },
  { "type": "approvals", "filter": { "status": "pending" } }
]}}
```

Server to UI messages include:
- `sessions.changed`
- `approvals.created`
- `approvals.updated`
- `events.appended`
- `console.chunk`
- `snapshots.updated`
- `tool_event.started`
- `tool_event.completed`
- `session_usage.updated`
- `automation.run.updated`
- `automation.run.event`
- `automation.runtime_state.updated`
- `automation.wakeup.updated`
- `governance_approval.updated`
- `work_item.updated`

## Terminal stream

Endpoint: `/v1/ui/terminal/:sessionId?token=<jwt>`

Terminal WebSocket attach and control require an operator-capable user. The target host must also advertise `capabilities.terminal`; otherwise the socket closes before a terminal attach command is sent to `agentd`.

Multiple browser viewers may attach to the same session. Each viewer gets its own terminal channel; `agentd` reports whether that channel is `readonly` or has `control`, and the UI can request control explicitly.

The UI sends:
- `input`, `resize`, `control`, `detach`

The server sends:
- `output`
- `attached`, `detached`, `readonly`, `control`, `idle_timeout`

See [Console Streaming](console.md).

## Agent stream

Endpoint: `/v1/agent/connect`

agentd connects and exchanges:
- `agent.hello` / `agent.ack` for sequencing
- `sessions.upsert` and `sessions.prune`
- `events.append` for timeline entries
- `approvals.requested` for approval flow
- `terminal.output` and terminal status events

Server to agent messages include:
- `commands.dispatch`
- `terminal.attach` / `terminal.input` / `terminal.resize` / `terminal.detach`
- `approvals.decision`
