# Wave 2 Lane W2-AGENTD-API Brief — Local Orchestrator API, Launch Templates, Hierarchy Primitives

Builder lane, agent-command massive refactor Wave 2 (heavisidelinux). Read `tasks/2026-07-19-massive-refactor-master-plan.md` (workstream C) and `tasks/2026-07-19-subsystem-study-findings.md` §1 (orchestrator-model gaps + shell-injection defect).

## Ground rules
- Worktree `/home/cvsloane/dev/wt/ac-w2-agentd`, branch `refactor/wave2-agentd` off latest `origin/refactor/tmux-command-center`. Work ONLY there — never in /home/cvsloane/dev/agent-command. `export PATH=$HOME/.local/go/bin:$PATH`.
- Ownership: `agents/**` only (+ NEW fixture files under tests/fixtures/protocol/). Events sent to CP must be additive event_types on the existing `events.append` message. Push branch to origin when gate is green.
- Wave 1 just landed: durable/volatile queue lanes, keyed command executor (internal/commands), jittered reconnect. Read the current code first; build on it.

## Tasks — the keystone for orchestrator-first
1. **Local orchestrator API** on the existing 127.0.0.1:7777 HTTP server (internal/providers/claude.go hosts it today; extract/extend sensibly):
   - Auth: header `X-AC-Session-Id` must equal a currently-tracked session's id (the pane's exported AC_SESSION_ID); loopback only. Reject otherwise.
   - `POST /v1/agent/spawn` {provider, cwd, prompt?, placement: "window"|"split", split_target?: self|<pane>, name?, env?, flags?} → creates tmux window OR split pane, launches provider via templates (below), stamps `@ac_session_id` AND `@ac_parent_session_id` immediately, registers the session synchronously (no 2s poll wait), sends prompt after readiness if given. Returns {session_id, tmux_target, pane_id}.
   - `GET /v1/agent/sessions` → sessions on this host with parent/child linkage and status.
   - `POST /v1/agent/send` {session_id, input, enter?} · `POST /v1/agent/kill` {session_id, tree?: bool} (tree = cascade via parent stamps) · `POST /v1/agent/wait` {session_id, until: done|waiting|any-change, timeout_ms} · `POST /v1/agent/report` {outcome: succeeded|failed|blocked, summary, detail?} → emits additive `orchestrator.report` event upward (durable lane) tagged with the caller session id.
2. **Provider launch templates**: replace string-concatenated launch commands with a per-provider template table (argv arrays + env map) and PROPER shell quoting everywhere (fixes injection at the spawn/fork sites — study findings §1 item 12). Config-overridable per provider; support headless variants where they exist.
3. **Hierarchy primitives**: parent stamping via `@ac_parent_session_id` pane option; include parent_session_id in sessions.upsert metadata (additive); `kill_tree` walking child stamps; child status rollup map included in upsert metadata for orchestrator panes (additive, cheap).
4. **Subagent hook fidelity**: ensure workshop.subagent_start/stop (and Task tool_use_id where available) flow upward with tool_use_id, description, timestamps in payload (CP lane is building agent_tasks ingest against these).
5. **Tests**: API auth rejection, spawn placement (window vs split) via a TmuxRunner fake, quoting (injection attempt strings stay inert), kill_tree ordering, report event emission. `go build ./... && go vet ./... && go test ./...` is the gate.

## Handoff
`tasks/massive-refactor-handoffs/w2-agentd-api.md` (wave-1 YAML schema), commit, push branch. Completion token: `W2-AGENTD-API FROZEN <sha>`.
