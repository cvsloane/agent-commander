# Reliability Primitives

This doc inventories how **retry/backoff**, **rate limiting**, and **ops metrics** currently work in Agent Command, and proposes a migration path toward consistent, observable behavior.

## Inventory (Current State)

### Retry + Backoff

**agentd (Go)**
- WebSocket reconnect loop: `agents/agentd/internal/ws/client.go`
  - Policy: fixed backoff schedule from config `control_plane.reconnect_backoff_ms` (default `[250, 500, 1000, 2000, 5000]` ms) and then retries forever at the max delay.
  - No jitter.
  - No per-attempt timeout (relies on the underlying dial behavior).
- Ad-hoc “retry once” for Claude usage command parsing: `agents/agentd/cmd/agentd/main.go` (`maybeRetryClaudeUsage`)
  - If output looks incomplete, re-runs the command using `script -c` to force a TTY.
  - No backoff.

**control-plane (TypeScript)**
- No shared retry helper (outbound HTTP calls generally rely on per-call timeouts).
- One “retry for race” pattern exists in group creation logic (check-then-recheck on unique collision): `services/control-plane/src/routes/groups.ts` and `services/control-plane/src/db/index.ts`.

### Rate Limiting

**control-plane (TypeScript)**
- In-memory per-user throttle for Clawdbot notifications: `services/control-plane/src/services/clawdbot.ts`
  - Default: `maxPerHour = 30` with additional dedupe + session cooldown rules.
  - Not distributed-safe (assumes a single control-plane instance for correct enforcement).

### Metrics / Observability

**Before 2026-02-16:** operational metrics (Prometheus-style) were not exposed; only session analytics existed in Postgres (`migrations/009_session_analytics.sql`).

**After 2026-02-16:** operational `/metrics` endpoints exist:
- control-plane: `GET /metrics` (token optional via `METRICS_TOKEN`)
- agentd: `GET /metrics` served from the hooks HTTP server (same listen address as `providers.claude.hooks_http_listen`)

## Standard Primitives (Recommended)

### Go (agentd)
1. **Retry/backoff standard:** exponential backoff with jitter and a hard cap.
2. **Timeout standard:** every outbound operation should be bounded by context deadlines.
3. **Metrics standard:** Prometheus counters/histograms for reconnect attempts, failures, and backoff delays.

### TypeScript (control-plane)
1. **Retry/backoff standard:** one shared helper (jitter, caps, per-attempt timeout, and explicit “non-retryable” classification).
2. **Rate limiting standard:** if control-plane is ever scaled horizontally, move throttles to Redis-backed primitives (in-memory is fine only when single-instance is guaranteed).
3. **Metrics standard:** Prometheus counters/histograms for decisioning (allowed/blocked + reason) and key outbound call failures.

## Migration Plan (Incremental)

1. **(Done) Add operational metrics endpoints and key counters**
   - control-plane `/metrics` + Clawdbot allow/deny reasons
   - agentd `/metrics` + reconnect/backoff counters
2. **Centralize retry/backoff**
   - Introduce a small `retry` helper in each language (repo-local), then migrate high-value call sites first.
3. **Rate limiting hardening (only if/when needed)**
   - If control-plane becomes multi-instance: add Redis and migrate Clawdbot throttle to distributed-safe limits.
4. **Dashboards/alerts**
   - Alert on reconnect storms, reconnect failure rates, and sustained Clawdbot rate-limit blocks.

