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

Search blends text ranking with semantic reranking when pgvector is available. If the extension is unavailable, the system stays on Postgres text search with the same scope filters.

Manual authoring is exposed for global and repo memories on `/memory`.

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
9. finalizes the run back into memory when the session settles

Runtime state is stored per automation agent and repo scope, which lets an orchestrator keep an attached session alive across wakes without inventing a second execution runtime.

Budget policy now supports warning thresholds in addition to hard limits. Warning-level issues stay visible in the run timeline and agent preflight; hard-limit breaches still block execution and create governance approvals.

## Dashboard surfaces

- `/automation`: create agents, queue wakeups, manage work items, review governance approvals, inspect runs and wakeups, view preflight state, inspect runtime binding, and open run timelines
- `/memory`: search scoped memory and add manual global or repo memories, including `procedural` memory
- `/orchestrator`: unchanged human attention queue for live sessions and session-bound approvals

## Current limits

- provider preflight is strongest on hosts running the newer agentd that reports provider availability; older hosts fall back to warn-only behavior
- scheduled wake policy currently uses `interval_minutes` rather than cron expressions
- runtime self-hiring and complex board governance are intentionally out of scope
