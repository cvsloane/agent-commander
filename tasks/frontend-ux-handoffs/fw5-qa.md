---
lane: FW5-QA
frozen_sha: 75d18392f44ea0d5d112d640d68dcb17d3f66186
attempt: 3
state: frozen
gates:
  lint: pass
  typecheck: pass
  test_ci: pass
  smoke: pass
  build: pass
  go: n/a
proof:
  - 'pnpm install && pnpm exec playwright install chromium → completed first in the worktree before implementation'
  - 'pnpm test:journeys from tmux TTY → 14/14 Chromium journeys passed at 390x844 and 1280x720'
  - 'pnpm lint → 5/5 Turbo tasks passed'
  - 'pnpm typecheck → 5/5 Turbo tasks passed; Next route types generated'
  - 'pnpm test:ci → 5/5 Turbo tasks passed: schema 48, CLI 44, control-plane 198, dashboard 124 (414 total)'
  - 'pnpm build → 4/4 Turbo build tasks passed; Next.js 16.2.10 production build completed'
  - 'pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:journeys && pnpm build from tmux TTY → exact FW5 gate passed in order with exit 0'
  - 'pnpm test:smoke:dashboard from tmux TTY → 20/20 Chromium scenarios passed'
  - 'focused terminal/fleet performance-contract tests → 4 files and 15/15 tests passed'
  - 'Prettier checks and git diff --check → all changed documentation and checklist files passed'
  - 'ownership scan fa0ba72..75d1839 → only tests/journeys, journey config, package scripts, docs/docs-site/README, CHANGELOG, and the acceptance checklist changed; protected source, packages, services, agents code, deploy, and smoke tests are untouched'
assumptions:
  - "The program's release day is the brief date, 2026-07-20, used for the 0.4.0 changelog entry."
  - 'A mocked control plane is the intended journey boundary; real hosts are deliberately excluded by the FW5-QA brief.'
uncertainties:
  - 'FW5-POLISH has no frozen handoff or integrated diff in this tree, so runtime web-vitals/frame-to-paint probe evidence and a refreshed docs-site screenshot are recorded as NOT-MET rather than inferred.'
  - 'Owner on-device PWA checkpoints were explicitly deferred in the program log and have no committed completion receipt.'
blockers: []
---

# FW5-QA handoff

## What changed

- Journey suite: added a dedicated two-project Playwright configuration and a
  deterministic mocked control plane under `tests/journeys/`. The seven program
  journeys cover sign-in/first paint, attach/type/detach, window lifecycle and
  last-window warning, history load-older, read-only control transfer, launch,
  and terminal-overlay approval at both required viewports. The root
  `test:journeys` script is the only package-manifest change.
- Acceptance: reconciled every original Wave 1–5 checkbox against frozen
  handoffs, named tests, integration receipts, and this lane's commits. Broad
  outline items were split where necessary so shipped work can be checked
  without hiding missing evidence.
- Product docs: made `/` the documented canonical Command Center, described the
  roster, window/pane controls, persistent and two-up terminals, history,
  composer/attention behavior, launch/reopen paths, Add host, command palette,
  and shortcuts. `/tmux` is consistently documented as a compatibility
  redirect. The agentd guide reserves `ac-agentd-` for owned tmux hook signals.
- Release prep: added the dated Keep a Changelog 0.4.0 entry with comparison
  links and Wave 1–5 Added/Changed/Fixed/Security coverage.
- Performance contract: named the zero-write terminal output bar, scroll-anchor
  and selection rules, single input path, one-background-terminal limit, and
  canonical fleet reconciliation/TTL/pruning rules with their existing tests.

## Acceptance gaps recorded honestly

- Runtime `web-vitals` and sampled terminal frame-to-paint probes are NOT-MET;
  they belong to the absent FW5-POLISH lane. Static budgets and their focused
  tests do not substitute for those measurements.
- The master plan's refreshed docs-site screenshot asset is NOT-MET. Earlier
  Wave 3/4 browser captures were inspected but were not committed as a refreshed
  docs-site asset.
- Owner iOS/PWA install, push, and terminal-typing checkpoints are NOT-MET. The
  program log says they were deferred to final review and contains no receipt.

These gaps did not trigger replacement implementations or inferred proof. They
remain visible in `tasks/frontend-ux-acceptance-checklist.md` for the AI Lead and
owner.

## Verification notes

- Playwright ran only from the real tmux TTY window
  `agent-command:fw5-qa-tests` as required. The journey implementation reached
  green on attempt 3; the final complete gate and separate smoke gate each
  passed on their first run.
- The existing non-failing control-plane notification mock diagnostics and the
  documented Next native-compiler notice remain visible. No new suppression or
  workaround was added.
- Next regenerated `apps/dashboard/next-env.d.ts` during the real gate; it was
  restored to the committed production route-type reference. The frozen tree is
  clean.

## Work-item commits

- `63b1946` — `test(journeys): cover Command Center program flows`
- `7fa0f0b` — `docs: document the Command Center experience`
- `9a136fa` — `docs: prepare 0.4.0 changelog`
- `faa4db3` — `docs: record frontend performance budgets`
- `75d1839` — `docs: reconcile frontend UX acceptance`

The `frozen_sha` is the final implementation/checklist commit; the following
handoff-only commit adds this file.

FW5-QA FROZEN 75d18392f44ea0d5d112d640d68dcb17d3f66186
