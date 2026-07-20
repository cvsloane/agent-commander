# Wave 2 Lane W2-CONTRACTS Brief — Session Graph, Agent Tasks, Orchestrator Data Model

Builder lane, agent-command massive refactor Wave 2. Read `tasks/2026-07-19-massive-refactor-master-plan.md` (workstream C) and `tasks/2026-07-19-subsystem-study-findings.md` §4.

## Ground rules
- Worktree `/home/cvsloane/dev/wt/ac-w2-contracts`, branch `refactor/wave2-contracts` (off integration tip 7b02c25+). Commit early/often; do NOT push; AI Lead integrates.
- Ownership: `migrations/032_*.sql, 033_*.sql, 034_*.sql` (claimed here), `packages/ac-schema/**` (additive), `services/control-plane/src/db/sessionGraph.ts + agentTasks.ts` (new), scoped ADDITIVE edits to `src/ws/agent.ts` (events ingest only), `src/routes/sessions.ts` (new endpoints only), `src/services/sessionSpawn.ts` (edge writes), tests. Nothing else. Wire protocol additive only.
- Wave 1 just landed heartbeats/outbox in ws/agent.ts and sessionSpawn.ts — read the current code first; build on it, do not restructure it.

## Tasks
1. Migration 032_session_graph.sql: `session_edges` (parent_session_id FK, child_session_id FK, edge_type CHECK IN (orchestrates,spawned,forked,reviews,implements), created_at, PK (parent_session_id, child_session_id, edge_type), index on child). Add `sessions.role` TEXT CHECK (orchestrator|worker|standalone) DEFAULT standalone.
2. Migration 033_agent_tasks.sql: `agent_tasks` (id uuid PK, session_id FK, tool_use_id text, description text, status CHECK (running|completed|failed), started_at, ended_at, metadata jsonb, UNIQUE (session_id, tool_use_id)) — tracks in-process subagents of a session (Claude Code Task tool), fed from hook events.
3. Migration 034_work_item_session.sql: `work_items.session_id` nullable FK + index (direct session claims).
4. ac-schema additive: SessionEdge/SessionRole/AgentTask schemas + types; ServerToUI messages `session_edges.changed`, `agent_tasks.changed`; UISubscribe topics to match. Export from index.
5. CP repositories `src/db/sessionGraph.ts` and `src/db/agentTasks.ts` (per-domain modules, NOT db/index.ts): upsert/list/delete; rollup query (counts of child sessions + agent_tasks by status for a parent).
6. Ingest: in the events.append handler (ws/agent.ts), detect `workshop.subagent_start` / `workshop.subagent_stop` (and tool events carrying Task tool_use_id if present — inspect actual agentd payloads in agents/agentd/cmd/agentd/main.go around workshop handling) → upsert agent_tasks rows → publish `agent_tasks.changed`. Keep it additive and failure-safe (Wave 1 ack semantics).
7. Edge writes: sessions spawned via spawn with a `parent_session_id` in payload/metadata get a `spawned` edge; forks get `forked` (metadata.forked_from already exists — backfill edge on fork path in routes/sessions.ts or sessionSpawn.ts). Accept optional `parent_session_id` + `role` in SpawnSessionPayload/launch additively.
8. REST additive: `GET /v1/sessions/:id/graph` (edges + child rollups), `GET /v1/sessions/:id/agent-tasks`. Publish `session_edges.changed` on edge writes.
9. Tests: migrations-shaped repo tests (query-level like tests/commandOutbox.test.ts), ingest mapping (subagent hook fixtures → rows + publish), graph endpoint, edge writes on spawn/fork.

## Gate
```bash
cd /home/cvsloane/dev/wt/ac-w2-contracts
pnpm --filter @agent-command/schema test && pnpm --filter @agent-command/control-plane test && pnpm --filter @agent-command/control-plane typecheck && pnpm --filter @agent-command/schema typecheck
```

## Handoff
`tasks/massive-refactor-handoffs/w2-contracts.md` (same YAML schema as wave 1), commit. Completion token: `W2-CONTRACTS FROZEN <sha>`.
