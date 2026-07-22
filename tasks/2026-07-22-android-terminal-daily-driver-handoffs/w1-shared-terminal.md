---
handoff_type: builder
work_unit: "W1 — Shared terminal repair"
state: ready_for_review
builder: "OpenAI Codex gpt-5.6-sol/xhigh"
deliverable_ref: "d83e2cb7f203bae7e5a67fd5450efdca574cc943"
proof_refs:
  - "production 7b30df0 desktop cold-open repro: topology-independent attach negotiated 1 row"
  - "launch-base desktop command-center journey: 14 passed, 5 mobile-only skipped"
  - "focused dashboard terminal units: 4 files, 20 tests passed"
  - "dashboard typecheck: passed"
assumptions:
  - "The authoritative launch base intentionally includes commit 46e26eb64adf40334b589812ffd425fbc1359023; its desktop breakpoint guard is the direct viewport fix under review."
  - "At 1280x720, 11 negotiated rows is the minimum regression floor because it is strictly above the observed one-row and nine-row failures; the candidate produced 13 rows."
uncertainties:
  - "This Builder lane did not mutate production; the AI Lead/Reviewer still owns the real production laptop check for WEB-1 through WEB-3."
blocked_on: []
attempt: 1
completion_token: "W1 READY d83e2cb7f203bae7e5a67fd5450efdca574cc943"
created_at: "2026-07-22T12:23:08-04:00"
---

# W1 Shared Terminal Builder Handoff

## Root cause and direct fix

Production commit `7b30df046208f1a2ba14b8e34b0095afe9888750` applied the mobile `.terminal-viewport` height rule to every terminal. On a desktop cold open before topology arrived, `calculateTerminalViewportHeight` clamped the below-fold terminal to `0px`; xterm therefore negotiated a one-row grid despite healthy `254px` and `421px` ancestors.

The authoritative launch base already carries the smallest direct fix in `46e26eb64adf40334b589812ffd425fbc1359023`: apply `.terminal-viewport` only below the command-center mobile breakpoint. The same topology-independent attach rose from 1 row to 11 with that guard alone and to 13 rows on the supplied base. The W1 commit adds the missing regression lock to the existing desktop cold-open journey.

## Verification

```text
CHOKIDAR_USEPOLLING=1 WATCHPACK_POLLING=true pnpm exec playwright test -c playwright.journeys.config.ts tests/journeys/command-center.journey.spec.ts --project=desktop-1280x720
# 14 passed, 5 mobile-only skipped

pnpm --filter @agent-command/dashboard exec vitest run src/components/terminal/viewport.test.ts src/components/terminal/terminalHostStore.test.ts src/components/terminal/terminalNavigationRequests.test.ts src/hooks/useTerminalScrollAnchor.test.ts
# 4 files, 20 tests passed

pnpm --filter @agent-command/dashboard typecheck
# passed
```

The desktop journey covers local-fit cold attach, keyboard input, scrollback paging, delayed/reconnected transactional pane focus, and the existing launch rail. No schema, control-plane, agentd, dependency, Android, or production path changed in this lane.
