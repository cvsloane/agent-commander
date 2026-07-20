---
lane: W1-CP-CORE
branch: refactor/wave1-cp
frozen_sha: 68adaf17d78ef37b1dbd67dc272c08dccc2d2adc
attempt: 1
gate:
  commands:
    - pnpm --filter @agent-command/schema test
    - pnpm --filter @agent-command/control-plane test
    - pnpm --filter @agent-command/control-plane typecheck
  results:
    - "PASS: ac-schema — 3 files, 21 tests"
    - "PASS: control-plane — 15 files, 59 tests"
    - "PASS: control-plane TypeScript — tsc --noEmit"
assumptions:
  - "Existing agentd does not deduplicate inbound cmd_id values, so only queued rows are claimed and delivered; ambiguous sent rows are deliberately not replayed."
  - "The legacy provider approval wait is ten minutes and approvals.decision has no receipt, so it expires at that deadline and is completed after its first successful send."
  - "Terminal command rows are retained for seven days after reaching a terminal status, then pruned by the control-plane maintenance sweep."
  - "Migration 031 is applied before the updated control-plane starts."
uncertainties:
  - "A process crash after atomically claiming one command but before the socket write can leave that single row sent and unretried; safe at-least-once replay requires future agent-side cmd_id deduplication and a capability handshake."
  - "An empty host that reconnects without a queued inventory message may defer delivery until its next sessions.prune inventory report."
  - "The gate validates migration/repository behavior with query-level tests but does not apply migration 031 to a live PostgreSQL instance."
blockers: []
---

# Wave 1 CP-CORE handoff

- Added ping/pong liveness to all control-plane WebSockets, identity-safe reconnect cleanup, heartbeat-fresh host presence updates, and batched host progress persistence.
- Made agent ingest serialized and failure-safe: durable handler failures are logged, counted, left unacknowledged, and retried through idempotent database writes.
- Added the command outbox migration/repository, durable-versus-volatile routing, inventory-ready one-at-a-time delivery, host-bound result correlation, MCP pending-map consolidation, expiry, and bounded retention.
- Added actor/endpoint-scoped request fingerprints for session spawn, launch, and approval idempotency. Approval state changes and outbox enqueue now commit in one PostgreSQL transaction, including offline decisions.
- Preserved the legacy wire protocol. One-way approval messages complete on send, legacy ULID results bypass UUID outbox queries, and sent destructive commands are not replayed without agent-side deduplication.
- Added regression coverage for heartbeat cleanup, reconnect races, failed-write redelivery, presence/progress batching, command lifecycle and ordering, readiness gating, transactional rollback, concurrent idempotency races, cross-host response isolation, and legacy result compatibility.
