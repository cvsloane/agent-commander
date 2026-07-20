---
lane: FW2-CONTRACTS
frozen_sha: 38c1a12df57589c822363f53a36c4b7adc4f44b4
attempt: 2
state: frozen
gates:
  lint: pass
  typecheck: pass
  test_ci: pass
  smoke: pass
  build: pass
  go: n/a
proof:
  - "pnpm install → completed before repository inspection or changes; only the brief-authorized Zod upgrade changed dependency resolution"
  - "pnpm lint → 5/5 Turbo tasks passed with zero lint warnings"
  - "pnpm typecheck → 5/5 Turbo tasks passed across schema, CLI, control plane, and dashboard"
  - "pnpm test:ci → 75 test files and 366 tests passed across all four workspaces"
  - "CHOKIDAR_USEPOLLING=1 WATCHPACK_POLLING=true pnpm test:smoke:dashboard → 10/10 Chromium scenarios passed across desktop, mobile, and tablet flows"
  - "CHOKIDAR_USEPOLLING=1 WATCHPACK_POLLING=true pnpm build → 4/4 Turbo build tasks passed; Next.js 16.2.10 production build completed"
  - "pnpm --filter @agent-command/schema test -- protocol-fixtures.test.ts → 16/16 protocol tests passed, including byte-exact round trips for tmux.topology and all eight frozen window/pane commands"
  - "pnpm --filter @agent-command/control-plane test → 49 test files and 198 tests passed, including scoped fleet batching, fleet role enforcement, known-invalid envelope termination, trusted topology host identity, and all R1 behavior"
  - "frontend-product-design audit_frontend.sh → lint, typecheck, and tests passed; dashboard smoke supplied equivalent preservation verification because no dashboard source, route, DOM, or styling changed"
  - "git diff --exit-code refactor/frontend-command-center...38c1a12df57589c822363f53a36c4b7adc4f44b4 -- tests/fixtures/protocol → empty; every frozen JSON fixture is unchanged"
  - "git diff --name-only refactor/frontend-command-center...38c1a12df57589c822363f53a36c4b7adc4f44b4 -- apps/dashboard migrations agents deploy → empty"
  - "package manifest/lockfile audit → direct dependency changes are limited to zod 3.25.76 → 4.4.3 in ac-schema, control-plane, and ac-cli; dashboard has no direct Zod declaration"
assumptions:
  - "tmux.topology is a volatile full-state snapshot and intentionally remains outside the durable sequence/ack path because the frozen envelope has no seq."
  - "The fleet aggregate associates an automation agent through active_session_id or last_session_id within the orchestrator's direct family, matching the existing dashboard hook."
  - "Full scrollback responses retain the newest 5000 lines when defensive result capping is needed."
uncertainties: []
blockers: []
---

# FW2-CONTRACTS handoff

## What changed

### Zod 4 migration

- Upgraded the three direct TypeScript Zod declarations from 3.25.76 to 4.4.3 and migrated schema, control-plane, and CLI call sites. The dashboard has no direct Zod dependency or Zod imports, so no dashboard file required a mechanical edit.
- Converted record schemas to Zod 4's explicit key/value form. `AlertProviderFiltersSchema` and `UsageThresholdsSchema` use `z.partialRecord(...)` so missing enum keys remain valid exactly as they were under Zod 3.
- Replaced the removed CLI `z.AnyZodObject` type with `z.ZodObject`. MCP tool raw shapes still come from `.shape`; the callback boundary casts to the schema input only after the MCP SDK has validated that raw shape. CLI schema and MCP behavior remain covered by all 44 CLI tests.
- No `.strict()`, `.passthrough()`, coercion, transform, default, or error-response behavior required a semantic change. Existing validation tests remained green, and added partial-record tests lock the only tightened enum-record sites.

### Tmux protocol and forward compatibility

- Registered the frozen unsequenced `tmux.topology` envelope, added the UI subscription topic, and relayed authenticated host-scoped snapshots as latest-state fan-out without persistence or sequence acknowledgment.
- Unknown frames with a JSON object and string `type` are now dropped with a per-connection, once-per-minute warning. They do not advance sequence state. Invalid JSON, missing/non-string type, and frames above 1 MiB still terminate the agent socket.
- Registered and policy-routed `new_window`, `kill_window`, `rename_window`, `split_pane`, `select_window`, `select_pane`, `resize_pane`, and `zoom_pane`. All require operator auth plus host tmux and terminal capabilities, and none is classified as a privileged-blocked generic command.
- The TypeScript protocol suite reads the frozen topology and command JSON files and proves parsed serialization is byte-identical. No fixture was edited.

### Control-plane endpoints

- Added bounded `POST /v1/sessions/:id/scrollback`, mapping visible, last-N, inclusive range, and full requests to `capture_pane`. Request ranges and results are capped at 5000 lines, with capability/auth checks and audit logging.
- Added `GET /v1/orchestrator/fleet`. One response contains every non-archived orchestrator session, snapshots, direct children, graph edges and rollup, agent tasks, complete work-item counts, mapped automation agent, latest run/report summary, budget policy and complete server-computed budget use, and runtime usage rollup.
- Title updates through `PATCH /v1/sessions/:id` now persist first, then send `rename_session` to the owning agent when it is connected. An offline agent or disconnect during dispatch is logged but does not roll back or fail the database update.

## Decisions and ownership notes

- Fleet work-item totals are computed with an unbounded grouped query rather than the existing list endpoint's pagination, so cards receive complete counts. An item matching both the session family and automation agent is counted once.
- A mapped agent's latest run takes precedence; without one, the endpoint falls back to the newest run attached to the orchestrator family, matching the current hook's behavior.
- No migration was needed or claimed. No dashboard file, agentd file, deploy file, protected terminal/mobile/session/tmux component, or frozen protocol fixture changed.
- Dashboard consumption of the fleet endpoint remains Wave 4 scope as directed. This lane only exposes and tests the aggregate contract.

## R2 corrections

- Replaced the fleet endpoint's global unbounded session read with 100-row orchestrator pages filtered by `role = 'orchestrator'`. It now derives the direct-child ID union first and fetches sessions and snapshots only for that scoped family.
- Batched graph edges, agent tasks, graph rollups, latest automation runs, and budget totals in 100-ID chunks. Batch work is capped at four concurrent queries, edge/task repository pages are capped at 1000 rows, and work-item aggregation is restricted to the resolved family and mapped automation-agent IDs. The response schema and card values remain unchanged.
- Raised `GET /v1/orchestrator/fleet` to operator-or-admin authorization before any session snapshot, budget, or work-item query. A viewer regression test proves the sensitive loaders are never called.
- Added an agent-WebSocket regression proving a known `sessions.upsert` envelope with an invalid payload still terminates the socket, preserving the boundary between unknown-type tolerance and known-type validation.
- Moved the authenticated `host_id` assignment after the topology payload spread. A forged/future payload `host_id` test proves the server-authenticated host remains authoritative.

## Verification notes

- The complete required gate sequence passed at the R2 frozen implementation SHA. `test:ci` retains pre-existing, non-failing notification mock diagnostics, and dashboard smoke retains pre-existing mocked-response validation warnings for omitted `capture_hash`/`groups` fields; both suites completed green.
- The scope-limited frontend preservation audit scores 93/100 with no hard fails: product fit 15/15, information architecture 15/15, visual design 15/15, dashboard/data clarity 15/15, interaction states 8/10, accessibility 11/15, responsive behavior 10/10, and performance polish 4/5. Deductions reflect the absence of new UI-specific state, accessibility, or performance work. Screenshots of changed routes are not applicable because there were no visual or dashboard-source changes; the existing browser suite verified desktop, mobile, and tablet preservation.

## Work-item commits

- `0b807c8` — `chore(schema): migrate TypeScript validation to Zod 4`
- `20d5bbf` — `feat(cp): relay volatile tmux topology snapshots`
- `616895b` — `feat(cp): tolerate unknown agent envelope types`
- `03d9b1e` — `feat(cp): register tmux window and pane commands`
- `2d3d900` — `feat(cp): add bounded session scrollback endpoint`
- `e74cd04` — `feat(cp): aggregate orchestrator fleet cards`
- `40bbd14` — `feat(cp): sync session titles to connected agents`
- `38c1a12` — `fix(cp): harden fleet and topology contracts` (R2)

The `frozen_sha` is the final implementation commit; the following handoff-only commit adds this file.

FW2-CONTRACTS-R2 FROZEN 38c1a12df57589c822363f53a36c4b7adc4f44b4
