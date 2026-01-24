# Architecture

Agent Commander has four primary components:

- Dashboard (Next.js) - the web UI.
- Control plane (Fastify) - REST + WebSocket API, auth, persistence.
- agentd (Go) - host agent that discovers tmux panes and streams output.
- PostgreSQL - session state, events, approvals, analytics, and settings.

![Architecture Diagram](images/architecture-diagram.svg)

```
Browser (Dashboard)
  |  REST + WS
  v
Control Plane  <---->  PostgreSQL
  ^
  |  Agent WS
  v
agentd (tmux + hooks)
```

## Data flows

### UI data stream
1. The dashboard opens a UI WebSocket to `/v1/ui/stream`.
2. It subscribes to topics (sessions, approvals, snapshots, events, usage).
3. The control plane filters and pushes real time updates.

### Terminal streaming (interactive)
1. The dashboard opens `/v1/ui/terminal/:sessionId` WebSocket.
2. The control plane attaches to the target tmux pane via agentd.
3. agentd bridges the pane using a PTY (preferred) or FIFO fallback.
4. Output is pushed to the UI and input is forwarded back to tmux.

### Approvals
1. Provider hooks (Claude/Codex) send permission requests to agentd.
2. agentd emits `approval.requested` to the control plane.
3. The dashboard shows the approval in the queue and orchestrator.
4. The operator decides, and the control plane sends a decision back to agentd.
5. The hook resumes or denies the action.

### Summaries
1. Session snapshots are stored in Postgres.
2. The dashboard can request a summary for an orchestrator item.
3. The control plane calls the summarizer (OpenAI API) and caches results.

## Reliability and ordering

agentd uses a sequence/ack protocol:
- Each outbound message is sequenced.
- The control plane acks in order.
- agentd persists a resend queue and replays on reconnect.

## Security boundaries

- Dashboard users authenticate via NextAuth (GitHub or access code).
- The dashboard mints short lived JWTs for control plane REST/WS calls.
- agentd connects with a host-scoped token.
- Role based access control (admin/operator/viewer) gates write actions.
