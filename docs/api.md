# API Reference

All REST endpoints are served by the control plane. Most endpoints require a
short lived JWT from the dashboard in the `Authorization: Bearer` header.

Trusted integrations can also authenticate with service headers:

- `X-Agent-Command-Service`
- `X-Agent-Command-Service-Key`

## Health
- `GET /health` - service status and connection stats.

## Sessions
- `GET /v1/sessions` - list sessions with filters.
- `GET /v1/sessions/:id` - get session detail.
- `PATCH /v1/sessions/:id` - update title or idle state.
- `POST /v1/sessions/:id/commands` - dispatch a command to agentd.
- `POST /v1/sessions/:id/fork` - fork a session into a new tmux window.
- `POST /v1/sessions/:id/copy-to` - copy pane content into another session.
- `POST /v1/sessions/spawn` - spawn a new session and automatically bootstrap repo/global memory when available. Claude Code sessions also receive curated memory-file exports when the host `agentd` supports them.
- `POST /v1/sessions/bulk` - bulk archive/unarchive/idle/terminate.
- `GET /v1/sessions/:id/events` - event timeline.
- `GET /v1/sessions/:id/tool-events` - tool event timeline.
- `GET /v1/sessions/:id/tool-stats` - tool usage summary.
- `GET /v1/sessions/:id/analytics` - aggregate metrics.
- `GET /v1/sessions/:id/analytics/timeseries` - time series usage.

## Approvals
- `GET /v1/approvals` - list approvals.
- `GET /v1/approvals/:id` - approval detail.
- `POST /v1/approvals/:id/decide` - allow or deny.

## Groups and links
- `GET /v1/groups` - list groups (tree + flat).
- `POST /v1/groups` - create group.
- `POST /v1/groups/ensure` - idempotent create.
- `PATCH /v1/groups/:id` - update group.
- `DELETE /v1/groups/:id` - delete group.
- `POST /v1/sessions/:id/group` - assign group to session.
- `POST /v1/sessions/:id/links` - create link.
- `GET /v1/sessions/:id/links` - list links.
- `DELETE /v1/sessions/:id/links/:linkId` - delete link.

## Hosts
- `GET /v1/hosts` - list hosts.
- `POST /v1/hosts` - create host and token (admin).
- `PATCH /v1/hosts/:id` - update host capabilities (admin).
- `POST /v1/hosts/:id/adopt-panes` - adopt orphan panes.
- `GET /v1/hosts/:id/directories` - list directories (operator, if enabled).

## Search and projects
- `GET /v1/search` - full text search across sessions, events, snapshots.
- `GET /v1/projects` - list projects for a user.
- `GET /v1/repos` - list canonical repos the user has touched.

## Memory
- `GET /v1/memory/search` - search repo, global, or working memory, with semantic reranking when pgvector is available.
- `POST /v1/memory` - create a memory entry.

## Automation
- `GET /v1/automation-agents` - list automation agents.
- `POST /v1/automation-agents` - create an automation agent.
- `PATCH /v1/automation-agents/:id` - update status or policy fields.
- `GET /v1/automation-agents/:id/preflight` - inspect execution preflight for a specific agent, optionally scoped by `repo_id`.
- `POST /v1/automation-agents/:id/wake` - queue a manual wakeup.
- `GET /v1/automation-runs` - list recent automation runs.
- `GET /v1/automation-runs/:id/events` - ordered run timeline events.
- `GET /v1/automation-wakeups` - list queued and historical wakeups.
- `GET /v1/governance-approvals` - list governance approvals.
- `POST /v1/governance-approvals/:id/decide` - approve or deny a governance approval.
- `GET /v1/work-items` - list worker queue items.
- `POST /v1/work-items` - create a work item.
- `PATCH /v1/work-items/:id` - update status, priority, or assignment.

## Integrations
- `POST /v1/integrations/automation-agents/:slug/wake` - authenticated service or operator wake by stable agent slug.
- `POST /v1/integrations/webhooks/automation-agents/:slug/wake` - signed external wake endpoint.
- `GET /v1/integrations/hermes/watchdog-summary` - deterministic automation/host health summary for Hermes.
- `GET /v1/integrations/hermes/governance-summary` - pending governance and blocked-run summary for Hermes.
- `GET /v1/integrations/hermes/recent-runs-summary` - recent automation run digest for Hermes.

Webhook calls must include:

- `X-Agent-Command-Timestamp`
- `X-Agent-Command-Signature`

The signature is `sha256=<hex>` over `${timestamp}.${jsonBody}` using `INTEGRATION_WEBHOOK_SECRET`.

## Context and settings
- `GET /v1/sessions/:id/context` - list context keys.
- `GET /v1/sessions/:id/context/:key` - get context value.
- `PUT /v1/sessions/:id/context/:key` - set context.
- `DELETE /v1/sessions/:id/context/:key` - delete context.
- `GET /v1/settings` - get user settings.
- `PUT /v1/settings` - update user settings.

## Analytics
- `GET /v1/analytics/usage/weekly`
- `GET /v1/analytics/summary`
- `GET /v1/analytics/provider-usage`
- `POST /v1/analytics/token-usage` (agentd)
- `POST /v1/analytics/approval-metrics` (agentd)

## MCP
- `GET /v1/hosts/:id/mcp/servers`
- `GET /v1/sessions/:id/mcp`
- `PUT /v1/sessions/:id/mcp`
- `GET /v1/projects/mcp`
- `PUT /v1/projects/mcp`

## Summaries
- `GET /v1/summaries/status`
- `POST /v1/summaries/generate`

## Notifications
- `POST /v1/notifications/test`

## WebSockets
- `GET /v1/ui/stream` - UI subscription stream.
- `GET /v1/ui/terminal/:sessionId` - interactive terminal.
- `GET /v1/agent/connect` - agentd connection.
- `GET /v1/voice/transcribe` - voice transcription (optional).

See [WebSockets](websockets.md) and [Events](events.md) for message formats.
