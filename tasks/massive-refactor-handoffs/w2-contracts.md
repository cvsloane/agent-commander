---
lane: W2-CONTRACTS
branch: refactor/wave2-contracts
frozen_sha: 9ec6fa6140996bf2fc4cac7c0238d5076e451972
attempt: 1
gate:
  commands:
    - pnpm --filter @agent-command/schema test
    - pnpm --filter @agent-command/control-plane test
    - pnpm --filter @agent-command/control-plane typecheck
    - pnpm --filter @agent-command/schema typecheck
    - pnpm --filter @agent-command/schema lint
    - pnpm --filter @agent-command/control-plane lint
    - pnpm verify:launch
  results:
    - "PASS: ac-schema — 4 files, 23 tests"
    - "PASS: control-plane — 23 files, 91 tests"
    - "PASS: control-plane TypeScript — tsc --noEmit"
    - "PASS: ac-schema TypeScript — tsc --noEmit"
    - "PASS: scoped schema and control-plane lint (ESLintRC deprecation warning only)"
    - "PASS: launch verifier — schema/control-plane tests, control-plane/dashboard typechecks, 7 Playwright smoke tests"
assumptions:
  - "Migrations 032 through 034 are applied before the updated control-plane starts."
  - "A parent-linked spawn uses the caller-supplied role when present and otherwise preserves the additive standalone default."
  - "Repeated session inventories may restate lineage; existing edges are treated as idempotent and are not republished."
uncertainties:
  - "The W2-AGENTD-API lane owns adding stable identifiers and descriptions to workshop.subagent_start/stop; this lane also supports the current Task pre_tool_use/post_tool_use payloads and will consume richer lifecycle payloads when available."
  - "Migration behavior is covered by query-level repository tests and review, but migrations 032 through 034 were not applied to a live PostgreSQL instance in this worktree."
  - "Trigger-created lineage from asynchronous session arrival is published when the updated control-plane processes the corresponding inventory; older control-plane versions do not publish the new additive message."
blockers: []
---

# Wave 2 CONTRACTS handoff

- Added session roles, typed orchestration edges, durable fork/spawn lineage backfill and reconciliation, agent-task tracking, and direct work-item session claims in migrations 032 through 034.
- Added additive schema contracts for roles, edges, agent tasks, parent-linked spawn/launch requests, session-linked work items, UI subscriptions, and graph/task change messages.
- Added dedicated session-graph and agent-task repositories with idempotent upserts, deletion/listing, terminal-safe task updates, child/task status rollups, and stable hook-event mapping.
- Added failure-safe WebSocket ingestion for Task/subagent lifecycle events and session-inventory lineage, publishing only durable changes while preserving Wave 1 acknowledgement semantics.
- Added parent/role-aware spawn and launch handling, pre-dispatch graph persistence, durable asynchronous fork reconciliation, graph and agent-task REST endpoints, and additive pub/sub routing.
- Added regression coverage for repository queries, hook ingestion/redelivery, graph endpoints and rollups, spawn/fork edge writes, parent validation, dispatch ordering, duplicate inventory suppression, and wire compatibility.
- A fresh adversarial review found no remaining issues above nitpick after lineage publication, durable delayed-fork handling, pre-dispatch persistence, and duplicate-change suppression were tightened.
