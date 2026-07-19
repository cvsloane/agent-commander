# Agent Commander CLI + MCP server

`@agent-command/cli` provides the `ac` command and an MCP server over the same operation layer.
Local session operations use agentd on `127.0.0.1:7777`; cross-host, work-item, memory,
and roster operations use the Agent Commander control plane.

## Build and run

From the repository root:

```bash
pnpm install
pnpm --filter @agent-command/cli build
node packages/ac-cli/dist/bin.js --help
```

When installed as a package, the binary name is `ac`.

Every pane-resident orchestrator needs its session identity:

```bash
export AC_SESSION_ID="<agent-command-session-uuid>"
```

The optional environment variables are:

- `AC_AGENTD_URL` — defaults to `http://127.0.0.1:7777`.
- `AC_CONTROL_PLANE_URL` — base URL for cross-host and durable operations.
- `AC_CONTROL_PLANE_TOKEN` — session or operator Bearer token.
- `AC_CONTROL_PLANE_AUTH_MODE` — `session` or `operator`; defaults to `session` when
  `AC_SESSION_ID` is present and otherwise to `operator`.
- `AC_CONFIG_FILE` — alternate config file path.

Control-plane URL/token settings can instead live at
`~/.config/agent-command/cli.json`:

```json
{
  "agentdUrl": "http://127.0.0.1:7777",
  "controlPlaneUrl": "https://agent-command.example.com",
  "controlPlaneAuthMode": "session",
  "token": "replace-with-token"
}
```

Environment variables take precedence over the file. For integration/service authentication,
`ac` also sends `X-AC-Session-Id` from `AC_SESSION_ID` so the control plane can scope the caller.
Tokens whose JWT claim is `token_use=orchestrator_session` are always treated as session-scoped,
even if stale configuration says `operator`.

## CLI

```bash
ac spawn "Investigate the failing test" --provider codex --cwd /path/to/repo
ac spawn "Run on another host" --provider claude_code --cwd /path/to/repo --host <host-uuid>
ac ls
ac ls --remote
ac send <session-id> "Continue with option B"
ac kill <session-id> --tree
ac wait <session-id> --until done --timeout 120000
ac report succeeded "Implementation and tests are complete"

ac work ls --status queued
ac work claim [work-item-id]
ac work done <work-item-id> --result '{"tests":42,"gate":"green"}'
ac memory search "queue retry policy" --scope repo
ac memory add --scope repo --tier procedural --summary "Queue retries" --content "Use bounded backoff."
ac roster --host <host-uuid>
```

Add `--remote` to `ls`, `send`, `kill`, or `wait` for cross-host session operations.
Add global `--json` for machine-readable stdout and structured errors on stderr.

The control-plane orchestrator routes are feature-detected. If an older control plane lacks a
session-scoped route, session credentials return a `feature_unavailable` error rather than being
sent to a global endpoint. Explicit operator mode may fall back to legacy operator routes.

Remote `kill` uses an operator-only control-plane API and therefore requires
`AC_CONTROL_PLANE_AUTH_MODE=operator` with an operator credential. Remote tree kill walks the graph
recursively and submits descendants before their parent. In session mode, the roster is derived
from the caller's scoped child list; operator mode can read the global roster. Session mode limits remote listing,
input, waiting, work items, and memory to the caller's orchestrator scope. Use operator mode for
explicit repository/agent work filters, global repository memory selectors, host aliases, or
administrative reads. Session-scoped work filtering will remain unavailable until the control-plane
endpoint supports those filters or pagination without truncating the candidate set.

## MCP server

Run the stdio server with:

```bash
ac mcp
```

It exposes:

- `spawn_worker`
- `list_sessions`
- `send_input`
- `kill_session`
- `wait_for`
- `report_result`
- `claim_work_item`
- `complete_work_item`
- `memory_search`
- `memory_write`
- `get_roster`

Claude Code `mcpServers` example:

```json
{
  "mcpServers": {
    "agent-command": {
      "command": "node",
      "args": [
        "/home/cvsloane/dev/agent-command/packages/ac-cli/dist/bin.js",
        "mcp"
      ],
      "env": {
        "AC_SESSION_ID": "<session-uuid>",
        "AC_CONTROL_PLANE_URL": "https://agent-command.example.com",
        "AC_CONTROL_PLANE_TOKEN": "<session-or-operator-token>"
      }
    }
  }
}
```

If Claude Code starts inside a pane that already exports these variables, omit the `env` block so
the MCP process inherits the pane-specific values.
