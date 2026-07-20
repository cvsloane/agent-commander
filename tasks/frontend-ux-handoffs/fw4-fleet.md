---
lane: FW4-FLEET
frozen_sha: 9081a13b336a5dcf84c3074aef4f4d15105b767b
attempt: 1
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
  - "PLAYWRIGHT_DASHBOARD_PORT=3424 CHOKIDAR_USEPOLLING=1 WATCHPACK_POLLING=true pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:smoke:dashboard && pnpm build → complete mandatory gate passed in order at the frozen implementation SHA"
  - "pnpm lint → 5/5 Turbo tasks passed"
  - "pnpm typecheck → 5/5 Turbo tasks passed; Next route types generated successfully"
  - "pnpm test:ci → 90 test files and 408 tests passed: dashboard 118, control-plane 198, schema 48, CLI 44"
  - "pnpm test:smoke:dashboard → 15/15 Chromium scenarios passed, including desktop and mobile terminal attention/composer interaction"
  - "pnpm build → 4/4 Turbo build tasks passed; Next.js 16.2.10 production build completed"
  - "focused fleet tests → aggregate ingestion, card/roster projection, incremental session/edge/task updates, snapshot retention, deletion, topology TTL fallback, badge derivation, filter persistence, prompt history, and per-type renderer routing passed"
  - "PLAYWRIGHT_CAPTURE_UI=1 focused Playwright run → 2/2 passed; terminal-attention-composer-{desktop,mobile}.png captured at 1280x720 and 390x844 and visually inspected"
  - "frontend-product-design audit_frontend.sh → lint, typecheck, and tests passed; manual audit scored 96/100 with no hard failures"
  - "git diff --name-only f3df15d..9081a13b336a5dcf84c3074aef4f4d15105b767b → only brief-authorized dashboard component/hook/lib/store paths and related tests changed"
  - "git diff suppression scan → no net-new eslint-disable, @ts-expect-error, @ts-ignore, or any casts"
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

## Decisions within lane latitude

- `stores/tmuxTopology.ts` remains as a compatibility re-export of the unified fleet store so existing tmux consumers do not require a parallel state model or a broad migration.
- Roster snapshots remain available while topology is live; expiry switches authority back to that snapshot instead of triggering a network request.
- Fleet cards retain their latest automation-run status badge, while every session-health signal is rendered through the shared health component.
- Existing app route shells, layout, UI primitives, settings UI, `SessionList`, search, packages, services, agents, and dependencies were not changed.

## Verification and quality review

- The final mandatory gate passed on isolated Playwright port 3424. A prior rerun on the shared default port reused a transient dev server that exited after the first passing smoke, yielding only `ERR_CONNECTION_REFUSED`; no assertion or application failure was involved.
- The frontend audit scored 96/100 with no hard failures: product fit 15/15, information architecture 14/15, visual design 13/15, dashboard/data clarity 15/15, interaction states 10/10, accessibility 14/15, responsive behavior 10/10, and performance polish 5/5. Deductions reflect the deliberately dense inherited operator shell and lack of real-device/screen-reader verification.
- Desktop and mobile screenshots show the overlay contained within the terminal, the composer in document flow beneath it, readable labels/actions, no horizontal overflow, and unobstructed navigation. Browser assertions prove Respond transfers focus only after activation.

## Phase commits

- `90c6272` — `feat(fleet): unify fleet and roster state`
- `e0f0ed9` — `feat(fleet): overlay terminal attention actions`
- `b1abfda` — `feat(fleet): add terminal prompt composer`
- `fbb70b2` — `feat(fleet): unify health badges and saved filters`
- `7f16bcf` — `feat(fleet): decompose attention item renderers`
- `9081a13` — `feat(fleet): cover attention composer interactions`

FW4-FLEET FROZEN 9081a13b336a5dcf84c3074aef4f4d15105b767b
