# Wave 2 Lane W2-MCP-CLI Brief — `ac` CLI + MCP Server over the Orchestrator APIs

Builder lane. Read `tasks/2026-07-19-massive-refactor-master-plan.md` (workstream C decision: API + MCP + thin CLI), findings §4, the W2-AGENTD-API handoff (`tasks/massive-refactor-handoffs/w2-agentd-api.md` — local API surface on 127.0.0.1:7777), and W2-CONTRACTS handoff (graph/agent-tasks endpoints).

## Ground rules
- Worktree `/home/cvsloane/dev/wt/ac-w2-cli`, branch `refactor/wave2-mcp-cli`. Commit often; no push; AI Lead integrates.
- Ownership: NEW workspace package `packages/ac-cli/**` only (add to pnpm-workspace via its own package.json under packages/*; do NOT edit other packages — note any needed schema exports in handoff). TypeScript, minimal deps (commander or node:util parseArgs; @modelcontextprotocol/sdk for MCP).
- Contract-first: agentd local API (spawn/sessions/send/kill/wait/report, X-AC-Session-Id auth) + control-plane REST (graph, agent-tasks, launch, tmux roster, work items, memory, automation wake/report as available). Feature-detect 404s gracefully — CP orchestrator routes are landing in a sibling lane.

## Tasks
1. `ac` CLI (bin): subcommands `spawn`, `ls` (sessions w/ tree), `send`, `kill [--tree]`, `wait`, `report`, `work ls|claim|done`, `memory search|add`, `roster`. Local-first: talk to agentd 127.0.0.1:7777 using $AC_SESSION_ID; cross-host ops via control-plane URL/token from env/config file (~/.config/agent-command/cli.json). JSON output with `--json`.
2. MCP server (`ac mcp` stdio subcommand): tools mirroring the same operations (spawn_worker, list_sessions, send_input, kill_session, wait_for, report_result, claim_work_item, complete_work_item, memory_search, memory_write, get_roster) so a pane-resident Claude/Codex orchestrator gets them natively. Session identity from $AC_SESSION_ID env.
3. Unit tests with a mocked HTTP layer for every subcommand/tool; a README.md in the package documenting setup (hook into Claude Code mcpServers config example).
4. Build wiring: package builds with tsc; `pnpm --filter @agent-command/cli build && test` green; do not break root turbo tasks.

## Gate
`cd /home/cvsloane/dev/wt/ac-w2-cli && pnpm install && pnpm --filter @agent-command/cli build && pnpm --filter @agent-command/cli test && pnpm typecheck`

## Handoff
`tasks/massive-refactor-handoffs/w2-mcp-cli.md` (wave-1 YAML schema), commit. Token: `W2-MCP-CLI FROZEN <sha>`.
