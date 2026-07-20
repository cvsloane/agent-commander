# Orchestrator Control Channel

Agent Commander exposes the same orchestrator operations through a thin `ac`
CLI and a stdio MCP server. Same-host pane operations go directly to agentd;
cross-host sessions, work items, memory, and roster reads go through the control
plane.

## Local agentd API

agentd serves the local API on the provider hook listener, which defaults to
`127.0.0.1:7777` through `providers.claude.hooks_http_listen`. Keep this listener
on loopback. Requests from a non-loopback address are rejected.

The local endpoints are:

- `POST /v1/agent/spawn`
- `GET /v1/agent/sessions`
- `POST /v1/agent/send`
- `POST /v1/agent/kill`
- `POST /v1/agent/wait`
- `POST /v1/agent/report`

Every request must include `X-AC-Session-Id` for a session currently tracked by
agentd. Pane launches receive that identity as `AC_SESSION_ID`; the CLI adds the
header automatically. The `security.allow_spawn`, `allow_send_input`, and
`allow_kill` agentd settings still apply.

## CLI

Build the CLI from the repository root:

```bash
pnpm --filter @agent-command/cli build
node packages/ac-cli/dist/bin.js --help
```

When installed, the binary is named `ac`:

```bash
ac spawn "Investigate the failing test" --provider codex --cwd /path/to/repo
ac ls
ac send <session-id> "Continue"
ac wait <session-id> --until done
ac report succeeded "Gate is green"
```

Set `AC_AGENTD_URL` only when agentd uses a non-default loopback port. Cross-host
operations also require `AC_CONTROL_PLANE_URL` and `AC_CONTROL_PLANE_TOKEN`.
See [`packages/ac-cli/README.md`](../packages/ac-cli/README.md) for every command,
authentication mode, and configuration-file option.

## MCP

Start the stdio server with:

```bash
ac mcp
```

It exposes worker spawn/list/send/kill/wait/report tools plus work-item, memory,
and roster operations. Configure an MCP client to launch `ac mcp` inside the
pane environment so it inherits the pane-specific `AC_SESSION_ID`. Do not place
session or operator tokens in repository files.
