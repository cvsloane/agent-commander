# Automation and Memory

Agent Commander now has two additive control-plane layers on top of normal sessions:

- scoped memory for repo and cross-repo recall
- autonomous orchestration for scheduled and manually queued agents

Both layers preserve the existing session runtime. Autonomous runs still become normal Agent Commander sessions, so the dashboard, terminal streaming, snapshots, approvals, and multi-host spawn flow all keep working.

## Concept lineage

- Paperclip inspired the wake queue, transactional claim flow, work checkout, budget stops, and lightweight orchestrator/worker hierarchy.
- Ruflo inspired scoped memory, tiered memory (`working`, `episodic`, `semantic`, `procedural`), and trajectory capture that can later promote repeated successful patterns into durable knowledge.

The implementation is intentionally narrower than either source repo. It keeps Postgres as the only persistence system and avoids a second runtime or memory backend.

## Canonical repos

Repo-scoped memory and automation runs use a canonical `repos` table rather than the older per-host `projects` table.

- preferred identity: normalized git remote
- fallback identity: normalized repo root hash
- sessions now carry `repo_id`

This lets the same repo be recognized across hosts and clones while keeping existing project pickers intact.

## Memory model

Memory is user-scoped and stored in Postgres.

- `global`: cross-repo knowledge, preferences, and reusable lessons
- `repo`: codebase-specific architecture, debugging, and implementation knowledge
- `working`: session-scoped short-term memory

Each memory entry also has a tier:

- `working`: active scratch context
- `episodic`: run or session summaries
- `semantic`: distilled durable lessons
- `procedural`: durable repo or global playbooks and repeatable operator knowledge

Supporting tables:

- `memory_entries`
- `memory_trajectories`

Memory now applies to all spawned sessions, not only autonomous runs.

- manual and autonomous spawns both bootstrap repo/global memory into the session after it leaves `STARTING`
- finished non-automation sessions are ingested into episodic memory and trajectories exactly once
- automation runs keep a memory snapshot of which entries were injected into the run
- Claude Code sessions also receive a one-way memory file export written by `agentd` before provider launch:
  - repo export: `.claude/agent-commander-memory.md` in the working tree
  - global export: `~/.claude/agent-commander-global-memory.md`
- non-Claude providers stay prompt-only for now

Search blends text ranking with semantic reranking when pgvector is available. If the extension is unavailable, the system stays on Postgres text search with the same scope filters.

Manual authoring is exposed for global and repo memories on `/memory`.

Repeated successful trajectories can now promote into durable memory:

- recurring patterns become `semantic` or `procedural` memories depending on the kind of lesson detected
- auto-promoted `procedural` memories are created conservatively and marked for operator review before they should be treated as trusted playbooks

## Automation model

Autonomous operation is built from a small set of records:

- `automation_agents`: orchestrators and workers
- `automation_wakeups`: queued, running, blocked, skipped, or completed wake requests
- `automation_runs`: the execution record linked back to a normal session
- `governance_approvals`: non-session approvals for budget, host, or scope decisions
- `work_items`: explicit queued work for workers

The control plane runs a background tick that:

1. enqueues scheduled wakes
2. claims queued wakes transactionally
3. enforces per-agent concurrency policy (`coalesce_if_active`, `always_enqueue`, `skip_if_active`)
4. reconciles persisted runtime state and reuses an existing idle session when possible
5. performs preflight for budget, host, provider support, and working directory
6. spawns a normal session through the existing spawn path when reuse is not possible
7. bootstraps the session with objective and memory context
8. records ordered run events for timeline inspection
9. writes a structured worker report and stable run artifact refs back onto the run
10. finalizes the run back into memory when the session settles

Runtime state is stored per automation agent and repo scope, which lets an orchestrator keep an attached session alive across wakes without inventing a second execution runtime.

Budget policy now supports warning thresholds in addition to hard limits. Warning-level issues stay visible in the run timeline and agent preflight; hard-limit breaches still block execution and create governance approvals.

Scheduling policy now also supports:

- `scheduler_mode`: `native`, `external`, or `hybrid`
- catch-up rules for missed intervals
- queue depth caps to avoid runaway backlog after downtime

`external` mode is intended for Hermes-managed agents. Agent Commander still executes the work and keeps the full operator surface, but Hermes becomes the outer wake/scheduling layer so the same automation does not fire twice.

## Dashboard surfaces

- `/automation`: create agents, queue wakeups, manage work items, review governance approvals, inspect runs and wakeups, view preflight state, inspect runtime binding, and open run timelines
- `/memory`: search scoped memory and add manual global or repo memories, including `procedural` memory
- `/orchestrator`: unchanged human attention queue for live sessions and session-bound approvals

## Hermes integration

Hermes is the recommended outer scheduler and watchdog for Heaviside production.

- Hermes wakes Agent Commander agents through authenticated integration endpoints
- Agent Commander remains the source of truth for sessions, runs, approvals, memory, and operator actions
- Hermes consumes deterministic JSON summaries for watchdog, governance, and recent-run briefing jobs
- autonomous approvals stay in Agent Commander rather than being pushed into Discord

The integration endpoints are documented in [API Reference](api.md).

## Current limits

- provider preflight is strongest on hosts running the newer agentd that reports provider availability and writes memory file exports; older hosts fall back to warn-only behavior
- scheduled wake policy currently uses `interval_minutes` rather than cron expressions
- runtime self-hiring and complex board governance are intentionally out of scope
