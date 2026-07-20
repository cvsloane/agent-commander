# Subsystem Deep-Study Findings - 2026-07-19

Evidence base for the massive refactor program (see `2026-07-19-massive-refactor-master-plan.md`).
Six parallel deep-study agents covered: dashboard, control plane, agentd, automation/memory, contracts/data-model, deployment/ops. Condensed actionable findings below; file:line refs verified at study time on `refactor/tmux-command-center` @ `9beb9d3`.

## 1. agentd (Go) — `agents/agentd`

Architecture: `cmd/agentd/main.go` is a 5,152-line god-file (CLI, WS dispatch, all command executors, hooks/approvals, tmux polling, snapshots, status derivation, terminal WS handlers, ~1,500 lines of usage parsing). Internal packages: tmux (client/terminal/pty_bridge/pipe_mux/git), ws (client), queue (persistent JSONL outbound), providers (hook HTTP server on 127.0.0.1:7777), usage, console, proc, config, metrics.

Terminal pipeline: PTY mode default (`terminal.go:69`), FIFO fallback. PTY = `tmux attach-session` under creack/pty, per-pane bridge shared by all viewers. Resize wired end-to-end. Single-controller + read-only channels + TakeControl implemented.

### Critical defects
1. **Outage data loss**: `ws/client.go:260-263` — `Send()` returns "not connected" BEFORE pushing to the persistent queue. Disconnected sends (hooks, approvals, upserts) are dropped, not queued. The queue only protects connected-but-unacked messages.
2. **Seq collision on restart**: `ws/client.go:58-61` + `main.go:386-393` — seq counter reset to lastAcked while queue holds unacked messages with higher seq; new messages reuse those seqs.
3. **Replay before hello**: `main.go:378-383` — `ResendQueued()` runs before `sendHello()`; unbounded, unpaced.
4. **Terminal/snapshot traffic persisted to disk queue**: `ws/client.go:272-278` — write amplification + stale terminal frames replayed on reconnect. Need durable vs volatile lanes.
5. **Synchronous command execution on WS reader goroutine**: `ws/client.go:171-174` → `main.go:1805/1834` — a `git fetch` during spawn blocks terminal input for seconds.
6. **`sessionsMu` held across tmux/git subprocess calls**: `main.go:4554-4764`.
7. **O(panes) `GetPaneOption` subprocess per poll**: `main.go:4568` — `@ac_session_id` belongs in the `list-panes -F` format string (`tmux.go:39`).
8. **Read-only attach is dead code**: `terminal.go:141` always `readonly=false`; `pty_bridge.go:52` `-r` branch unreachable. Read-only is app-layer only.
9. **PTY sizing/focus**: hardcoded 24x80 initial (`pty_bridge.go:74`); no size in `terminal.attach` (`main.go:5013`); no `select-window` before `select-pane` (`pty_bridge.go:57`); shared PTY = phone attach resizes/refocuses desktop tmux. Fix: per-viewer grouped session (`tmux new-session -t <sess> -s ac-view-<chan>`).
10. **PTY bridge leak** on lost detach; no sweeper (only path `main.go:5115`).
11. **No backpressure**; N× base64 encode for N viewers (`pty_bridge.go:267-271` + `main.go:5135`); base64-in-JSON transport.
12. **Shell injection in spawn/fork**: unescaped env/paths string-concatenated into send-keys (`main.go:2630-2635, 2771-2778, 2976-2983`).
13. Duplicate `commands.result` for capture_pane (`main.go:2171` + `main.go:1951`).
14. Status detection = snapshot-hash heuristics, 10s window (`main.go:3200-3240`) — quiet-but-running mislabeled WAITING_FOR_INPUT.
15. Hooks for unknown sessions silently dropped (`main.go:3430-3434`).
16. No reconnect jitter (`client.go:220-254`); version literal duplicated (`main.go:127` vs `1666`); ~40 unchecked `Send()` call sites.
17. Go tests: only usage parsing + 3 protocol fixtures. TerminalManager/ptyBridge/queue/reconnect/spawn/status all untested. `tmux.Client` concrete — needs interface seam.

### Orchestrator-model gaps (agentd)
- No agent-facing spawn API: a pane orchestrator cannot ask agentd to spawn/kill/list subagents. Hooks HTTP server (127.0.0.1:7777) is the natural mount point, auth via `AC_SESSION_ID`.
- Parent/child vestigial: `ForkedFrom`/`ForkDepth`/`GroupID` exist (`main.go:92-94`); only fork sets lineage; no cascade kill, no rollup, no completion notification.
- No result plumbing between sessions (only `copy_to_session` pane-scrape, `main.go:2185`).
- Window-only placement (`tmux.go:382`), no split-window support.
- Provider launch is bare binary + raw flags (`buildProviderCommand`, `main.go:3086`); headless jobs codex-only.
- `workshop.subagent_stop` hook events observed (`main.go:3883-3907`) but nothing models subagents.

## 2. Control plane — `services/control-plane`

~13.4k LOC. Fastify 5 + pg. `db/index.ts` 2,513-line god module; `automation.ts` 1,435; `pubsub.ts` 764 (all in-memory registries).

### Critical defects
1. **No server-side WS heartbeat** on any of the 3 WS endpoints — zombie sockets; `isAgentConnected` lies after silent drops.
2. **Reconnect race**: `ws/agent.ts:63-68` removes connection by hostId without socket-identity check — stale close evicts fresh connection.
3. **Ack-on-failure**: `ws/agent.ts:173-180, 471-473` — acks `ok` after swallowed DB errors, defeating agentd's at-least-once queue.
4. **Fire-and-forget CP→agent**: no outbox/retry (`pubsub.ts:444-454`); offline host = immediate failure; approval decide requires live host (`approvals.ts:82-84`).
5. **Host "online" defined 3 ways**: `launch.ts:20-25` vs `automation.ts:129` vs raw hosts route.
6. **`ambiguous_host_selection` hard-error** when >1 viable host (`automation.ts:407-412`) — hostile to 2-host fleet.
7. **Governance approval dead-end**: `approval_resume` wakeup never created (`governanceApprovals.ts:24-49`); approving a blocked run does nothing.
8. **Orchestrator role is a label**: `reports_to_automation_agent_id`/`worker_pool_json` stored, never read (`automationMemory.ts:680-739`); only role branch at `automation.ts:888`.
9. **Run success = session idle 15s** (`automationMemory.ts:1912-1916`, `automation.ts:1266-1270`); `result_summary = session.title`.
10. **Stuck-state leaks**: no reaper for `running` wakeups / session-less `starting` runs (`automation.ts:1244` skips them).
11. **Serial 5s tick, ≤3 wakeups**, spawn+30s-wait inline (`automation.ts:1194-1201, 1394-1435`).
12. No rate limiting; CORS `origin:true`+credentials (`index.ts:68-73`); JWTs in WS query strings; no WS Origin checks.
13. Not user-scoped reads: sessions/approvals/search/hosts (`db/index.ts:504-558`).
14. `/v1/sessions` embeds full snapshot text by default (`sessions.ts:102-117`); no permessage-deflate; terminal output base64-in-JSON; no backpressure (`terminal.ts:34`).
15. No UI stream resume (no cursor/seq); UI WS no initial snapshot, no ping (`ws/ui.ts`).
16. Two parallel pending-command maps (commandRouter.ts vs `mcp.ts:9-49`).
17. Per-message host UPDATEs ×2 (`ws/agent.ts:248-254`); spawn readiness = 500ms DB polling (`sessionSpawn.ts:199-234`).
18. Tests: 7 files cover auth/commandRouter/terminal/launch/tmux-open/session-policy. Zero coverage: automation state machine, agent WS ingest, pubsub, memory.

### Automation lifecycle (as-built, for reference)
Wake sources: manual route, schedule tick (advisory lock 427001), Hermes (service-auth + HMAC webhook), followups. Claim via FOR UPDATE SKIP LOCKED (`automationMemory.ts:810-879`). Runtime reuse via `automation_runtime_states` (agent×repo). Concurrency: coalesce/skip/enqueue. Preflight: budget (automation_runs usage only), host selection, provider capability. Blocked → governance_approvals. Execute: reuse (send_input typed into pane) or spawn (`spawn_session` → tmux pane, memory bootstrap prompt typed in + memory files for claude_code). Finalize: idle-heuristic success, episodic memory + trajectory ingest, hourly md5-grouped distillation (near-dead: `automationMemory.ts:553`).

## 3. Dashboard — `apps/dashboard`

~40k LOC src. Largest: BotspaceOrbit 1,630; automation/page 1,401; SettingsPanel 1,122; api.ts 1,037; stores/orchestrator 1,022.

### Critical defects
1. **Event WS gives up after 5 attempts** (`lib/ws.ts:24,103-117`), console.error only; zero visibilitychange/online/pageshow handlers anywhere in src.
2. **Terminal has no reconnect at all** (`useTerminalConnection.ts:200-212`).
3. **Terminal unmounts on mobile mode switch** (`TmuxMobileShell.tsx:251`) — full reconnect + scrollback loss per roster round-trip.
4. **Zero PWA plumbing**: no manifest, no SW, no icons (public/ has only sounds/), no viewport export, no safe-area-inset usage, `LayoutShell.tsx:116` uses 100vh.
5. Sessions in 3 stores (RQ cache + stores/session + orchestrator.sessionsById); query-key drift `provider-usage` vs `providerUsage` double-polls; polling stacked on WS invalidation (automation 6×15s + orchestrator 10s).
6. Legacy `xterm@5.3` DOM renderer; migrate `@xterm/*` + WebGL; base64 char-loop decode (`useTerminalConnection.ts:145-151`); ~60 lines WS-URL logic duplicated with ws.ts.
7. Keyboard-height blindspot: static calc heights (`TmuxPageClient.tsx:180`, `SessionWorkbench.tsx:139`); visualViewport only refits cols/rows.
8. Orchestrator concept split across 3 surfaces: /automation (admin forms, no open-pane action), /orchestrator (regex DetectionEngine attention inbox, client-side only), /tmux (roster). No parent→child rendering; no prompt composer (send_input without terminal focus).
9. OrchestratorModal desktop-anchored (`OrchestratorModal.tsx:222`); automation TabsList unscrollable on mobile (`components/ui/tabs.tsx:16`).
10. Dead weight: `(workshop)` route group unreachable (next.config.js redirect) + 8 CSS files; visualizer ~160KB CSS + three.js deps for default-off surface; workshopVibe shim; SidebarNav dead badge code.
11. Type duplication vs schema: api.ts SessionMetrics/AnalyticsSummary/ProviderUsage/TimeSeriesPoint/BulkOperationResult/MCP types/SpawnProvider; stores/usage.ts SessionUsage.
12. ESLint disables no-explicit-any/no-unused-vars/react-hooks rules; vitest include only `.test.ts` (no .tsx), node env, 2 test files total; Playwright Desktop-Chrome-only project.
13. MobileLaunchSheet providers hardcoded codex|claude_code (`MobileLaunchSheet.tsx:491`); window.confirm for terminate (`TmuxPageClient.tsx:118`).

## 4. Contracts & data model — `packages/ac-schema`, `migrations/`

1. **Tmux identity "promotion" is nominal**: `TmuxPaneIdentitySchema` (session.ts:37-45) used only by tmuxRoster.ts which still regex-parses `tmux_target` (:45-53) with `pane_id: session.tmux_pane_id || session.id` fallback (:79). agentd sends loose `metadata.tmux` map (`main.go:4625-4632`). No SQL columns for session_name/window_index/pane_index.
2. **Go has zero shared types**: encodes `map[string]any`, decodes inline anonymous structs; fixture tests decode into test-local structs, not production types. 3 of ~40 wire shapes meaningfully cross-checked. 10/17 agent→CP types unfixtured; 13/14 command payloads; ServerToUI: zero.
3. **Dashboard validates nothing at runtime**: all schema imports type-only; `res.json() as T`; WS `JSON.parse as ServerToUIMessage`.
4. **Terminal UI protocol defined twice outside schema** (`routes/terminal.ts:110-115` vs `useTerminalConnection.ts:139-189`); `idle_timeout` implementation-only.
5. **Events**: enum decorative (Event.type is z.string()); `workshop.*`/`codex.hook` not in enum; `session.created/updated/deleted`, `command.dispatched`, `approval.decided`, `error` never inserted; every insert pays 4 btree + GIN + tsvector trigger; no retention.
6. **Session table severely overloaded**: panes+jobs+never-used `service` kind+groups+forks+archive tombstone (`archived_at` conflated: agentd pane-vanish vs user archive)+metadata JSONB bag.
7. Session identity ephemeral: pane option only; tmux restart = all-new UUIDs; `AC_SESSION_ID` env exported but never used for re-adoption.
8. Half-dead: session_metrics token columns (always 0), audit_log write-only, approvals.timed_out_at never written (orphaned helpers), kind='service', duplicate migration number 017, summaries.session_id VARCHAR no-FK, user_settings dual identity, projects not linked to repos.
9. Four overlapping usage stores: session_metrics / token_events / session_usage_latest / provider_usage.
10. Needed for goals: `session_edges` (parent/child typed graph) + `sessions.role`; `agent_tasks` (subagent tracking from hooks); durable `commands` outbox table; `push_subscriptions`; host presence in DB; UI stream seq/cursor; typed event registry; real tmux identity columns.

## 5. Deployment / ops / security

1. **Dashboard WS + phone**: see dashboard #1/#2; plus no client ping — Cloudflare ~100s idle timeout masked only by 2s upsert firehose.
2. **Default role operator for every authenticated user** (`apps/dashboard/src/lib/auth.ts:19-22`); GitHub OAuth + empty ALLOWED_EMAILS = anyone gets shell. `ACCESS_SECRET` plain `===` compare (auth.ts:36), no rate limit/lockout, grants admin.
3. **Terminal attach/input not audit-logged** (terminal.ts: zero createAuditLog calls).
4. agentd connects via public URL through Cloudflare (`config.example.yaml:9`); Tailscale is display metadata only.
5. Release workflow ships no binaries/images; CHANGELOG missing 0.2.0 (empty release body); agent_version hardcoded 0.1.0 twice, stored but never compared; migrations manual (deploy-order footgun).
6. docs drift: compose has no Postgres (deployment.md:25-28); "horizontally scalable" claim false (operations.md:19-20); DEEPGRAM_API_KEY absent from config.ts; APP_BASE_URL unused for alert links.
7. OpenClaw notifier: no deep links (`clawdbot.ts:427-433`), fire-and-forget, no delivery log; governance approvals notify nothing (`pubsub.ts:732-740`).
8. No host-status push topic: host online/offline changes not broadcast; UI polls, 5-min stale window; zero-pane connected host can flap offline in UI.
9. CI missing: Postgres-backed integration tests, e2e agentd↔CP protocol test, go vet/lint.

## What's real vs dormant

Active daily surface (May 2026 investment): /tmux command center, mobile launch flow, terminal streaming, hook approvals + orchestrator attention queue, OpenClaw alerts, usage analytics.
Dormant since 2026-03-28 (zero tests, dead ends): the automation/memory layer — the plumbing (wake queue, runtime reuse, run events) is good and we build on it (locked decision), but governance resume, worker fan-out, distillation, and budget enforcement need finishing/fixing.
