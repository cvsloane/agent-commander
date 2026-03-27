# Universal Memory + Safer Autonomy V2

Date: 2026-03-27

## Goal
- Improve Agent Commander in two practical ways without adding a second runtime:
  - memory across all repos and within specific repos
  - autonomous operation governed by orchestrator agents

## Source Concepts
- Borrowed from Paperclip:
  - explicit wake concurrency policies
  - coalescing follow-up wakes onto active runs
  - persisted runtime state for resumable orchestrators
  - run lifecycle event timelines
  - soft budget warnings and hard budget blocks
  - execution preflight before autonomous work starts
- Borrowed from Ruflo:
  - universal memory bootstrap
  - scoped memory (`repo`, `global`, `working`)
  - `procedural` memory for durable repo/global playbooks
  - trajectory capture plus later distillation
  - semantic retrieval layered on top of the existing memory store

## Deliberate Non-Goals
- No new execution runtime. Autonomous work must continue to create or reuse normal Agent Commander sessions.
- No hybrid memory backend. Postgres remains the only persistence system.
- No filesystem memory sync in this tranche.
- No separate long-form run log store in this tranche.

## Implementation Plan

### 1. Universal Memory For Every Session
- Reuse the shared memory bootstrap service for both automation and dashboard/manual session spawns.
- Automatically bootstrap repo and global memory into newly spawned manual sessions after they leave `STARTING`.
- Expand memory ingestion so finished non-automation sessions also produce episodic memory and a trajectory exactly once.
- Keep retrieval priority:
  - repo `procedural`
  - repo `semantic`
  - repo `episodic`
  - global `procedural`
  - global `semantic`
  - global `episodic`

### 2. Concurrency Limits And Wake Coalescing
- Enforce `max_parallel_runs`.
- Support `wake_policy_json.concurrency_policy`:
  - `coalesce_if_active`
  - `always_enqueue`
  - `skip_if_active`
- Preserve coalesced wake context in the active run’s pending follow-ups and enqueue a consolidated follow-up wake when that run finishes.

### 3. Runtime Resume State
- Persist per-agent, per-repo runtime state with active session and host bindings.
- Reuse an existing session when it is still attached and waiting for input or idle.
- Clear stale runtime bindings when the session ended, disappeared, or the host disconnected.

### 4. Automation Run Event Timeline
- Persist ordered run events for claim, coalesce, skip, warn, block, host choice, spawn/reuse, bootstrap, follow-up queueing, memory ingestion, and errors.
- Publish run events over websocket and expose them through a REST endpoint for the dashboard.

### 5. Procedural Memory And Optional Semantic Retrieval
- Extend memory tiers with `procedural`.
- Support optional pgvector-backed semantic reranking when the extension is available.
- Keep text search as the required fallback.
- Keep automatic ingestion as episodic only; procedural memory is authored or explicitly promoted.

### 6. Budget Warnings And Execution Preflight
- Add budget warning thresholds below the hard budget cap.
- Evaluate host/provider/cwd/budget preflight for automation agents.
- Warn on save and block only on actual execution when there is no viable execution target or the hard budget limit is exceeded.

## Execution Order
1. Schema and migration support for procedural memory, runtime state, run events, vector storage, and session bootstrap metadata.
2. Control-plane runtime updates for universal bootstrap, ingestion, concurrency, resume, run events, semantic retrieval, and preflight.
3. Route and websocket support for run events and preflight.
4. Dashboard updates for automation and memory visibility.
5. Agentd capability reporting for provider availability.
6. Typecheck, build, migrate, deploy, and verify.

## Verification Standard
- Manual sessions receive memory bootstrap.
- Finished manual sessions ingest memory exactly once.
- Automation obeys concurrency policy and reuses sessions when safe.
- Run events and runtime state appear in the API and UI.
- Memory search works with and without pgvector.
- Budget warnings do not block execution, but hard budget limits do.
