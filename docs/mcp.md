# MCP Integration

Agent Commander can query and configure MCP servers available on each host.

## Host level

- `GET /v1/hosts/:id/mcp/servers` lists MCP servers discovered by agentd.

## Session level

- `GET /v1/sessions/:id/mcp` returns the MCP config for a session.
- `PUT /v1/sessions/:id/mcp` updates MCP enablement for a session (operator role).

## Project level

- `GET /v1/projects/mcp?repo_root=...` returns the project default.
- `PUT /v1/projects/mcp` updates MCP defaults for a repo root.

MCP settings are propagated to the host via the agent WebSocket.
