---
lane: W5-DATA
branch: refactor/wave5-data-contracts
frozen_sha: b9d7ea118d6a2822c762d0fb3dc6336d8675bae6
attempt: 1
gate:
  command: DATABASE_URL=postgres://test:test@localhost:5432/test JWT_SECRET=test-secret-for-gate pnpm --filter @agent-command/control-plane test && pnpm --filter @agent-command/schema test && pnpm --filter @agent-command/dashboard test && pnpm typecheck
  status: passed
  results:
    - control-plane: 43 files, 157 tests passed
    - schema: 8 files, 37 tests passed
    - dashboard: 13 files, 70 tests passed
    - workspace typecheck: 5 tasks passed
additional_verification:
  - PostgreSQL 16 applied migrations 001-038 from scratch with seeded legacy user-setting collisions and a null fork_depth row.
  - Verified migration 038 recovery mappings, normalized fork depth, conditional service-kind removal, and retention indexes.
  - Adversarial review completed with no remaining critical or warning findings.
assumptions:
  - DATA_RETENTION_DAYS remains disabled when unset; production should explicitly set the documented standard of 30 days.
  - Database migrations run before the new control-plane process starts.
  - The implementation commit is frozen separately from this handoff-only commit.
uncertainties:
  - Migration 038 removes the legacy service enum label only when no service rows exist. If rows exist it leaves the database label; read contracts tolerate them while all new upserts reject service.
  - WeeklyUsage.tsx is outside the lane's normal dashboard ownership, but the brief explicitly required fixing its providerUsage/provider-usage query-key drift; the change is one line.
  - index.ts is shared with W5-SECURITY. This lane only adds the data-maintenance import, startup, and awaited shutdown; it does not touch CORS, authentication, rate limits, terminal tickets, or security policy.
blockers: []
---

# Wave 5 DATA handoff

## Summary

- Added migrations 037 and 038 for promoted tmux identity, roster indexing, normalized fork depth, summary/project/settings foreign keys, recoverable single-UUID user settings, conditional session-kind cleanup, and retention indexes.
- Promoted typed W5-GO tmux identity during session ingest, including Go's omitted zero indexes, grouped the roster in SQL, and made known pane IDs re-adopt safely without permitting cross-host UUID takeover.
- Added a complete emitted-event payload registry, non-dropping ingest validation with bounded-cardinality Prometheus metrics, durable terminal audit events, and atomic approval.decided events.
- Added serialized retention and approval-timeout maintenance. Retention drains bounded batches with an overall cap; timeout reconciliation updates approvals and sessions transactionally and publishes both changes.
- Added tolerant WebSocket boundary parsing and runtime Zod validation for sessions, roster, graph, launch, and spawn responses; removed dashboard/control-plane duplicate contract types and fixed the provider usage query key.
- Added focused coverage for registry completeness, unknown/invalid telemetry preservation, SQL roster parity, pane re-adoption and ownership, zero-valued tmux identity, runtime validation, migration hygiene, retention, and timeout maintenance.
- Updated configuration, event, approval, and data-model documentation.

## Integration and rollback notes

- Reconcile the three additive data-maintenance edits in `services/control-plane/src/index.ts` when merging W5-SECURITY; keep that lane's security changes intact.
- Apply migrations before starting the merged control plane. Take the normal database backup first because migration 038 is forward-only: it converts summary IDs, replaces the user-settings primary identity, and may recreate the session-kind enum.
- The legacy-subject recovery table preserves unmatched settings until first authenticated claim. Do not remove it until all remaining recovery rows have been audited.
- Application rollback after migration is safe for the additive tmux columns, but older settings code expects `user_subject`; restoring a pre-038 application therefore requires restoring the pre-migration database backup or a forward compatibility migration.

The `frozen_sha` is the final implementation commit; the following handoff-only commit adds this file.

W5-DATA FROZEN b9d7ea118d6a2822c762d0fb3dc6336d8675bae6
