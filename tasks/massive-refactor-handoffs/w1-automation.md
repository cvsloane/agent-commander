---
lane: W1-AUTOMATION
branch: refactor/wave1-automation
frozen_sha: a05a599ca9453e25f171715172c46fea91362937
attempt: 1
gate:
  commands:
    - pnpm --filter @agent-command/control-plane test
    - pnpm --filter @agent-command/control-plane typecheck
    - pnpm --filter @agent-command/control-plane lint
  results:
    - command: pnpm --filter @agent-command/control-plane test
      status: passed
      detail: 11 files and 39 tests passed with ephemeral DATABASE_URL and JWT_SECRET test values. The unqualified command in this clean worktree otherwise aborts two pre-existing suites during config loading because no local .env is present.
    - command: pnpm --filter @agent-command/control-plane typecheck
      status: passed
      detail: tsc --noEmit completed successfully.
    - command: pnpm --filter @agent-command/control-plane lint
      status: passed
      detail: ESLint completed successfully; it emitted only the repository's ESLintRC deprecation warning.
assumptions:
  - wake_policy_json.require_host_selection_approval is the explicit opt-in flag for host_selection governance; its default is false.
  - Offline host waits default to a 15-minute TTL and 5-second exponential backoff capped at 60 seconds; wake_policy_json may override the initial values with host_offline_ttl_minutes and host_offline_backoff_seconds.
  - A two-minute stale threshold is sufficient beyond the normal 30-second spawn-readiness wait; locally active wakeup tasks are excluded from reaping regardless of age.
  - Host load counts active runs that already have a session and therefore an attributable host; session-less starting runs are handled by the separate crash reaper.
uncertainties:
  - The AI Lead must reconcile the local hostIsOnline wrapper with the sibling lane's services/hostPresence.ts module.
  - Repository SQL was typechecked and exercised through mocked repository seams, but this lane did not run a live PostgreSQL integration test.
blockers: []
---

# Summary

- Replaced ambiguous multi-host blocking with deterministic fixed-host, repo-affinity, active-load, name, and ID preference order.
- Added opt-in-only host-selection governance approvals.
- Added offline-host wakeup requeueing with persisted backoff/TTL state and run events; deferred wakeups are excluded from claims until due.
- Added startup/periodic recovery for stale session-less starting runs and orphaned running wakeups, with atomic updates, bounded retries, and run events.
- Kept runs in `starting` until an atomic session attachment succeeds, preventing reaper races from resurrecting failed runs.
- Moved slow wakeup execution into a persistent concurrency-three task pool so scheduler reconciliation remains responsive.
- Added 14 table-driven/focused Vitest cases across host selection, offline TTL/governance, both reapers, live-task recovery exclusion, and concurrency capping.

The `frozen_sha` is the final implementation commit; the following handoff-only commit adds this file.
