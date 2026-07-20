# Agent Commander Massive Refactor Master Plan - 2026-07-19

Owner-approved program. Evidence base: `tasks/2026-07-19-subsystem-study-findings.md` (six-subsystem deep study on `refactor/tmux-command-center` @ `9beb9d3`).

## Vision

Agent Commander becomes the command center for an **orchestrator-first workflow**: instead of the operator managing many tmux panes by hand, single tmux-pane orchestrators (Claude Code / Codex sessions) manage many subagents, and the operator supervises everything — launch, steer, approve, attach — **from a phone**, across `heavisidelinux` and `homelinux`.

## Locked Decisions (owner-approved 2026-07-19)

1. **Mobile delivery: PWA-first.** Manifest + service worker + Web Push + installability. No APK in this program (option open later).
2. **Subagent model: both, visibility first.** First surface in-process Claude Code Task/Agent subagents (via hooks) as a live tree with statuses/approvals; then real-pane spawning via the control channel for heavy/parallel workers.
3. **Control channel: API + MCP + thin CLI.** One authenticated API (agentd-local for host ops on 127.0.0.1:7777, control-plane for cross-host/work-items/memory), exposed as both an MCP server and an `ac` CLI.
4. **Automation layer: build on it.** Wake queue / runs / work items / runtime reuse stay the backbone; fix governance resume, host selection, structured completion. Hermes integration preserved.
5. **Scope: full program (workstreams A–G), phased waves with verification gates.**
6. **Dead code: delete + isolate.** Remove unreachable `(workshop)` route + shims + orphaned helpers; lazy-isolate visualizer weight.
7. **Branch/commits: continue on `refactor/tmux-command-center`, commit per verified phase.** No merges to main without owner say-so.

## Product policy decisions (made during planning; owner can veto)

- Multi-viewer terminal: **read-only by default for additional viewers, explicit Take Control** (formalize the current agentd behavior; make read-only real via `tmux attach -r` once per-viewer attach lands).
- Mobile auto-attach: after per-viewer read-only attach exists, **selecting a pane auto-attaches read-only**; control remains explicit. Until then, attach stays explicit except `attach=1` deep links.
- Tenancy: stays **single-tenant**, but read APIs get optional user-scoping and secure defaults (viewer default role).
- agentd transport: add first-class config/docs for pointing agentd at a **Tailscale-direct** control-plane URL; actual infra cutover is an ops task for the owner.

## Workstreams

### A. Connection resilience (multi-host trust)
- agentd: queue durable messages regardless of connection state; fix restart seq collision; replay after hello, paced; **durable vs volatile lanes** (terminal.output / snapshots / console.chunk bypass disk queue); jittered backoff; async command executor (worker pool, per-session ordering) off the WS reader; release `sessionsMu` around subprocess calls; `@ac_session_id` into list-panes format.
- Control plane: server-side ping/pong + liveness timeout on all 3 WS endpoints; fix hostId reconnect-eviction race (socket identity); stop acking failed DB writes; **durable command outbox** (PG table: queued/sent/acked/completed/failed/expired; absorbs commandRouter + mcp.ts pending maps); idempotency keys on spawn/launch/input/approve; unified host-online predicate used by launch/automation/hosts; `hosts.changed` presence push; batch last_seen/acked_seq writes.
- Dashboard: infinite jittered reconnect + reconnect on visibilitychange/online/pageshow + client ping (~25s) in `lib/ws.ts`; terminal auto-reconnect; global connection-state banner.
- Automation: stale-`running` wakeup / session-less run reaper; replace `ambiguous_host_selection` with deterministic preference (repo affinity → least-loaded → name) + `queued_until_host_online`.

### B. Phone reachability (PWA + push + attention)
- PWA baseline: manifest, icons, viewport export (`viewport-fit=cover`, themeColor), safe-area insets, `dvh` in LayoutShell, minimal service worker (app-shell cache + offline page).
- Web Push: `push_subscriptions` table + VAPID; push service with dedupe/throttle (shared with clawdbot logic, state in PG); events: approval.requested, waiting_input, run blocked/failed, governance approval, host offline; deep links (`/tmux?...&mode=terminal&attach=1`, `/orchestrator?item=...`).
- Server-side attention state: move DetectionEngine semantics into control plane (shared package) so push fires with no tab open; single source for badge counts.
- UI stream resume: seq/cursor on ServerToUI + `ui.subscribe {since}` replay; initial snapshot on subscribe.
- OpenClaw: deep links, retry + delivery log; governance approvals wired in.

### C. Orchestrator-first (the keystone)
- Data model: `session_edges` (parent_id, child_id, edge_type: orchestrates/spawned/forked/reviews/implements) + `sessions.role` (orchestrator/worker/standalone); `agent_tasks` table (in-process subagent tracking: session_id, tool_use_id, description, status, timestamps) fed from `workshop.subagent_*` / hook events; `work_items.session_id` direct claims.
- agentd local API (on 127.0.0.1:7777, auth `AC_SESSION_ID`): spawn/list/kill/send/wait subagent panes (with parent stamping, synchronous registration), report-result, memory write. Split-window support + spawn concurrency caps + cascade kill (`kill_tree`).
- Control-plane API: spawn worker with parent linkage (cross-host), structured `POST /v1/automation-runs/:id/report` (agent-authored result_summary/worker_report_json; idle-heuristic demoted to fallback), work items CRUD for agents, memory search/write for sessions, snapshot/status reads, `POST /v1/automation-agents/:slug/message` nudge (send_input into standing runtime session).
- Governance resume: approve → `approval_resume` wakeup carrying override the preflight honors; deny → clean cancel.
- MCP server (new package `packages/ac-mcp` or `services/mcp`): tools wrapping the above; stdio for local sessions; provisioned tokens.
- `ac` CLI (thin, same API), installable on hosts.
- Provider launch templates: per-provider argv-array command/env/headless variants with proper quoting (fixes shell injection); claude headless jobs alongside codex.
- UI: orchestrator fleet view — session tree (orchestrator + subagents/worker panes) with status rollups in /tmux and a mobile-first orchestrator command surface: card per orchestrator, subagent rollup, inline approve/deny (both approval kinds), **prompt composer** (send_input without terminal focus), one-tap attach. Decompose `automation/page.tsx` into it.

### D. Terminal excellence
- Transport: binary WS frames browser-leg + permessage-deflate; single-encode fan-out agentd-side; bounded per-channel buffers with drop-oldest + lag notice; coalesce small reads (~16ms flush).
- Per-viewer PTY: grouped tmux session per viewer (`new-session -t`), `select-window` fix, initial size from attach payload, true read-only via `attach -r`, bridge sweeper for viewer-less PTYs, channel-resume tokens surviving reconnects.
- Client: migrate `@xterm/xterm` + `@xterm/addon-fit` + WebGL renderer (canvas fallback); keep terminal mounted across mobile mode switches (CSS-hide + small LRU of live connections); keyboard-height-aware layout (visualViewport-driven CSS var, key bar pinned above OS keyboard); scrollback preservation.
- Terminal protocol into ac-schema (incl. idle_timeout), one definition.

### E. Security hardening
- Default role viewer; refuse OAuth sign-in when allowlist empty; timing-safe ACCESS_SECRET compare + rate limiting on auth; @fastify/rate-limit globally; CORS restricted to app origin; WS Origin checks; terminal attach/input/control audit logging; WS auth via short-lived ticket instead of query-string JWT; Tailscale-direct agentd config option + docs.

### F. Contracts & data model
- Real tmux identity: agentd sends `TmuxPaneIdentity` verbatim; SQL columns (tmux_session_name, window_index, pane_index); server-side roster query; delete client regex reconstruction; pane re-adoption via `AC_SESSION_ID` after tmux/agentd restart.
- Event schema registry: typed payload schemas per event type (add workshop.*/codex.hook; emit-or-delete unused enum values); ingest validation; retention job; index diet.
- Dashboard runtime validation: `parseServerToUIMessage()` + zod-checked fetchAPI; delete drifted local types (api.ts, stores/usage.ts, pubsub TopicType).
- Go: typed production structs for protocol (mirrored or JSON-Schema-generated), fixture tests decode production types, fixture matrix expanded (all message types, command payloads, ServerToUI).
- Hygiene batch: drop kind='service'; wire approval timeouts; collapse session_metrics into token_events rollups; FK summaries.session_id; single user identity; renumber dup 017; projects.repo_id.

### G. Cleanup, CI, release
- Delete `(workshop)` route group + CSS + shims + orphaned DB helpers; lazy-isolate visualizer CSS/three.js out of main bundle.
- Decompose god modules **incrementally as waves touch them**: main.go → internal/commands, internal/hooks, internal/terminal, usage into internal/usage; db/index.ts → per-domain repositories; automation.ts → scheduler/preflight/lifecycle/finalizer.
- agentd release engineering: version via ldflags; Go build+vet in CI; goreleaser artifacts (linux amd64/arm64) on tag; install/update script; CP version-skew banner.
- Migrations on container start; compose/Coolify healthchecks; docs corrections (compose/Postgres, horizontal-scaling claim, config schema completeness, CHANGELOG 0.2.0).
- Test ratchet: vitest .tsx + jsdom for dashboard; automation state-machine + agent WS ingest suites; Playwright mobile device project + reconnect scenario; re-enable disabled lint rules.

## Wave plan

Waves are dependency-ordered; each ends with a verification gate + commit. Work is distributed:
- **homelinux** (orchestrator + local subagents): control plane, dashboard, schema, migrations, docs.
- **heavisidelinux** (agents in the `agent-command` tmux session): Go/agentd workstream on branch `refactor/wave<N>-agentd`, merged locally after review. Go toolchain: `~/.local/go/bin` (installed 2026-07-19).

| Wave | Content | Primary owner |
|---|---|---|
| 1 | Workstream A (all of it) + outbox migration + reapers | agentd→heavisidelinux; CP/dashboard→homelinux |
| 2 | Workstream C backend: session_edges/agent_tasks migrations, agentd local API + templates + hierarchy, CP orchestrator API + governance resume + structured completion, MCP server + ac CLI | split same way |
| 3 | Workstream B: PWA, push, server-side attention, UI resume, OpenClaw | homelinux |
| 4 | Workstream D + C-UI: terminal transport/PTY/xterm + fleet view + orchestrator command surface + bottom-tab nav | agentd terminal→heavisidelinux; UI→homelinux |
| 5 | Workstreams E + F | split |
| 6 | Workstream G + docs + final sweep | homelinux |

### Verification gates
Every wave: `pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:smoke:dashboard` (homelinux) and `go build ./... && go vet ./... && go test ./...` in `agents/agentd` (heavisidelinux). New behavior lands with tests in the same wave. `pnpm verify:launch` after launch-path changes.

### Coordination protocol
- Plan + findings docs live in `tasks/`; both machines pull before starting a wave.
- heavisidelinux agents: branch `refactor/wave<N>-agentd` off latest `refactor/tmux-command-center`, commit early/often, push; do NOT touch files outside `agents/`, `tests/fixtures/protocol/` (new files only), or Go docs.
- homelinux merges remote branches into `refactor/tmux-command-center` after review + full gate, then pushes.
- Shared contracts (ac-schema, fixtures) are authored on homelinux first when a wave needs them; agentd consumes.
- No pushes to `main`; no deploys; no data deletion; secrets untouched.

## Risks
- Cross-machine merge conflicts → mitigated by directory ownership + branch-per-wave.
- Protocol changes must stay backward-compatible per wave (agentd on hosts may lag CP during the program); additive-first, remove later.
- Terminal rework (Wave 4) is the highest-regression-risk area → per-viewer PTY behind config flag until verified on real phones.
- Automation revival touches dormant code with zero tests → tests land before behavior changes (Wave 1 reapers included).
