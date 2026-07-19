# Massive Refactor — Acceptance Checklist

Ground truth = executed commands + diffs + tests on frozen SHAs, never builder prose.

## Wave 1 — Connection resilience
- [x] agentd: disconnected sends of durable messages (hooks/events/upserts/results) are queued and replayed after hello, paced; volatile lanes (terminal.output/snapshots/console.chunk) bypass the disk queue. Proven by Go tests incl. the restart seq-collision case.
- [x] agentd: commands execute off the WS reader (per-session FIFO), terminal input never blocked by spawn/git; exactly one commands.result per cmd_id (capture_pane dup fixed). Proven by Go tests.
- [x] agentd: jittered backoff; version single-sourced; Send() drops counted (Prometheus); hook buffering for unknown sessions.
- [x] CP: all 3 WS endpoints heartbeat + reap dead sockets; reconnect race fixed (socket-identity compare); failed ingests are NOT acked ok. Proven by vitest.
- [x] CP: durable command outbox (migration 031) with deliver-on-hello, TTL expiry, result correlation; mcp pending map absorbed; Idempotency-Key on spawn/launch/approve; offline approval decide queues. Proven by vitest.
- [x] CP: single host-online predicate used by launch/hosts (+automation reconciled at merge); hosts.changed pushed on connect/disconnect.
- [x] Automation: deterministic host selection (no ambiguous_host_selection error by default); offline host ⇒ queued-until-online with TTL; both crash reapers; concurrency-capped wakeup processing. Proven by NEW vitest suite (subsystem had zero tests).
- [x] Dashboard: event WS never permanently gives up; reconnects on visibility/online/pageshow; keepalive defeats proxy idle timeouts; terminal auto-reattaches on transient closes preserving buffer; connection banner. Proven by vitest on the extracted state machine.
- [x] Protocol backward compatible: agent WS changes additive only (old agentd works against new CP).
- [x] Integrated: full wave gate green (lint, typecheck, test:ci, dashboard smoke, go build/vet/test); diffs within ownership firewall.

## Non-waivable (program-wide)
- No pushes to main; no production deploys; no data deletion; secrets untouched.
- Every wave integrated only from frozen, reviewed lane SHAs.
