---
lane: FW4-FLEET
frozen_sha: f0d7b898e75bf5e0b2a7e49f0d7401aa93c99d64
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
  - "pnpm install → completed before repository inspection or implementation; lockfile unchanged and no dependencies added"
  - "pnpm lint && pnpm typecheck && pnpm test:ci && PLAYWRIGHT_DASHBOARD_PORT=3444 pnpm test:smoke:dashboard && pnpm build → complete mandatory gate passed in order at the attempt-2 frozen implementation SHA"
  - "pnpm lint → 5/5 Turbo tasks passed"
  - "pnpm typecheck → 5/5 Turbo tasks passed; Next route types generated successfully"
  - "pnpm test:ci → 92 test files and 414 tests passed: dashboard 124, control-plane 198, schema 48, CLI 44"
  - "pnpm test:smoke:dashboard → 16/16 Chromium scenarios passed, including desktop-to-mobile read-only retention, disabled Respond/composer affordances, Take Control recovery, and 390px control containment"
  - "pnpm build → 4/4 Turbo build tasks passed; Next.js 16.2.10 production build completed"
  - "focused R2 tests → 9 fleet-store tests plus 6 read-only surface/host tests passed, covering late aggregate freshness, canonical pruning, both gated actions, approval availability, and responsive surface transfer"
  - "PLAYWRIGHT_CAPTURE_UI=1 focused Chromium run → terminal-readonly-{desktop,mobile}.png captured at 1280x720 and 390x844 and visually inspected; permission hints and controls fit without overlap"
  - "frontend-product-design audit_frontend.sh → lint, typecheck, and tests passed; manual attempt-2 audit scored 97/100 with no hard failures"
  - "git diff --name-only 9081a13b336a5dcf84c3074aef4f4d15105b767b..f0d7b898e75bf5e0b2a7e49f0d7401aa93c99d64 → only R2 store/orchestrator/tmux/test paths plus the brief-mandated narrow terminal permission bridge changed; no sibling-owned app routes, UI primitives, settings, SessionList, or search paths changed"
  - "git diff suppression scan → no net-new eslint-disable, @ts-expect-error, @ts-ignore, or as-any casts"
assumptions:
  - "Recent sessions means activity within the last 30 minutes; the persisted this-host target follows the operator's last explicitly selected host because the browser has no separate local-host identity contract."
  - "A send_input command with one trailing newline and enter=false is the canonical prompt-composer submission, avoiding a second implicit Enter."
  - "The 30-second aggregate/roster reconciliation cadence and 30-second topology TTL are the slow safety net behind targeted WebSocket updates."
uncertainties:
  - "Real iOS hardware was unavailable; focus, touch layout, overflow, and mobile composition were verified in Chromium at 390x844."
blockers: []
---

# FW4-FLEET handoff

## What changed

- Fleet state: `GET /v1/orchestrator/fleet`, roster responses, `sessions.changed`, graph/task events, and `tmux.topology` now feed one Zustand store. Fleet cards and roster-tree rows are selectors over the same canonical sessions and families. Session events patch only affected records; 30-second reconciliation remains as a safety net. A one-second expiry check drops silent topology feeds after 30 seconds and immediately restores the existing roster snapshot without waiting for another fetch.
- Terminal attention: the attached primary session shows one compact, dismissible bottom-edge attention card. Approval decisions and responses share the same pure routing and action hook as the queue. The overlay never autofocuses; Respond explicitly opens and focuses the composer.
- Prompt composer: mobile and desktop workbenches have a collapsed-by-default, in-flow multiline composer. It sends exactly one trailing newline, supports Ctrl/Cmd+Enter, desktop-only ArrowUp history recall, 20 deduplicated persisted prompts per session, success/error feedback, and the existing send-to-linked-session flow.
- Health and filters: one icon/color/label badge component represents waiting input, waiting approval, error, idle, dirty git, offline host, and unmanaged sessions across roster rows and fleet cards. The roster persists All/Waiting/Errors/Active/Dirty/Untracked/This host/Recent selection and the last explicit host target.
- Attention architecture: `OrchestratorItem.tsx` is now a small composition shell over shared presentation, per-item-type renderers, and `useAttentionItemActions`. The terminal overlay reuses that action layer instead of maintaining a second decision implementation.
- Coverage: store tests lock both fleet projections and targeted updates; unit tests cover badges, saved filters, prompt history/payloads, approval routing, and renderer dispatch; Playwright proves overlay-to-composer focus, exact command payload, success feedback, and desktop/mobile fit.

## R2 corrections

- Aggregate freshness: aggregate reconciliation now compares each session's `updated_at` against canonical targeted-update state, preserving the newer record in the canonical map and both fleet projections.
- Canonical pruning: every aggregate ingest rebuilds `sessionsById` from the exact union of current aggregate and roster IDs, releasing archived or otherwise removed session snapshots while preserving current roster-only sessions.
- Read-only input gating: the terminal controller publishes its permission through the persistent host into `TmuxTerminalWorkspace`; the composer and overlay Respond action disable with “Read-only — take control to type,” while approve/deny remain enabled as governance actions.
- Responsive permission continuity: the persistent controller retains read-only state while the same pane transfers between desktop and mobile terminal surfaces. Mobile status labels remain available to assistive technology while collapsing visually so Take Control and Focus fit at 390px.

## Decisions within lane latitude

- `stores/tmuxTopology.ts` remains as a compatibility re-export of the unified fleet store so existing tmux consumers do not require a parallel state model or a broad migration.
- Roster snapshots remain available while topology is live; expiry switches authority back to that snapshot instead of triggering a network request.
- Fleet cards retain their latest automation-run status badge, while every session-health signal is rendered through the shared health component.
- Existing app route shells, layout, UI primitives, settings UI, `SessionList`, search, packages, services, agents, and dependencies were not changed.
- The correction brief explicitly required wiring the terminal connection's existing permission state into the workbench. Terminal changes are limited to that controller/host bridge, its responsive permission continuity, and tests; no terminal protocol or input semantics changed.

## Verification and quality review

- The final mandatory gate passed on isolated Playwright port 3444 at the attempt-2 frozen implementation SHA.
- The frontend audit scored 97/100 with no hard failures: product fit 15/15, information architecture 14/15, visual design 14/15, dashboard/data clarity 15/15, interaction states 10/10, accessibility 14/15, responsive behavior 10/10, and performance polish 5/5. Deductions reflect the deliberately dense inherited operator shell and lack of real-device/screen-reader verification.
- Desktop and mobile screenshots show both exact permission hints, disabled input-equivalent actions, enabled Take Control, and no narrow-width control clipping. Browser assertions prove the permission survives desktop/mobile surface transfer and both gated actions re-enable after taking control.

## Phase commits

- `90c6272` — `feat(fleet): unify fleet and roster state`
- `e0f0ed9` — `feat(fleet): overlay terminal attention actions`
- `b1abfda` — `feat(fleet): add terminal prompt composer`
- `fbb70b2` — `feat(fleet): unify health badges and saved filters`
- `7f16bcf` — `feat(fleet): decompose attention item renderers`
- `9081a13` — `feat(fleet): cover attention composer interactions`
- `57fbbb7` — `fix(fleet): preserve fresher session updates`
- `7e25eb0` — `fix(fleet): prune reconciled session cache`
- `27d1643` — `fix(fleet): gate terminal input while read only`
- `d8f31d7` — `fix(fleet): retain terminal permission across layouts`
- `f0d7b89` — `fix(fleet): fit read only controls on mobile`

FW4-FLEET-R2 FROZEN f0d7b898e75bf5e0b2a7e49f0d7401aa93c99d64
