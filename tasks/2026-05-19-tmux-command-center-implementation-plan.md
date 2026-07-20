# Tmux Command Center Implementation Plan - 2026-05-19

## Objective

Turn Agent Commander into a reliable browser-based tmux command center, with a dense desktop workflow and first-class mobile interaction for managing many tmux sessions, windows, and panes.

The end state should let an operator:

- Find any active tmux session quickly.
- Inspect windows and panes without leaving the browser.
- Open and control the right pane.
- Switch between panes without fighting page scroll.
- Use a phone for real terminal work, including copy, paste, Ctrl-C, Esc, Tab, arrows, and tmux-specific commands.
- Avoid accidental destructive actions.
- Trust the terminal control path from a security and capability standpoint.

## Current Baseline

- `/tmux` exists and is correctly positioned as the primary tmux workflow.
- The current implementation is functional but too monolithic.
- `TmuxPageClient.tsx` mixes roster derivation, URL state, host selection, websocket refresh, selected-session actions, workbench rendering, and roster rendering.
- Mobile terminal support already exists in `TerminalView`, including virtual keyboard, touch scrolling, long-press menu, and selection popup.
- The mobile `/tmux` page is currently a stacked desktop page, not a purpose-built mobile workflow.
- Test coverage is thin around the tmux browser workflow.

## Guiding Product Decision

Do not treat mobile as "desktop stacked vertically."

Desktop should become a dense two-pane operator surface:

- Persistent compact roster.
- Selected-session workbench.

Mobile should become a mode-based workflow:

- `Roster`
- `Terminal`
- `Actions`

This keeps the common task fast: find a pane, open it, interact, switch, and act.

## Phase 0: Baseline And Branch

### Tasks

1. Create a working branch:

   ```bash
   git switch -c refactor/tmux-command-center
   ```

2. Commit or intentionally preserve planning files:

   - `BACKLOG.md`
   - `tasks/2026-05-19-codebase-study.md`
   - `tasks/2026-05-19-mobile-tmux-ux-pass.md`
   - `tasks/2026-05-19-tmux-command-center-implementation-plan.md`

3. Run baseline verification:

   ```bash
   pnpm lint
   pnpm typecheck
   pnpm test:ci
   go test ./...
   pnpm test:smoke:dashboard
   ```

### Exit Criteria

- Baseline state is known.
- Any existing failures are recorded before refactor work starts.
- Planning files are not lost.

## Phase 1: Safety Rails First

This phase protects the tmux behavior before changing the UI structure.

### Tasks

1. Extract pure roster derivation from:

   - `apps/dashboard/src/app/(dashboard)/tmux/TmuxPageClient.tsx`

2. Create:

   - `apps/dashboard/src/lib/tmuxRoster.ts`

3. Move and export:

   - `parseTargetIndexes`
   - `getPaneData`
   - `buildTmuxClusters`
   - `matchesTmuxFilter`

4. Add dashboard test support:

   - Add a `test` script to `apps/dashboard/package.json`.
   - Ensure `turbo test` includes dashboard tests.

5. Add Vitest coverage for:

   - `tmux_target` parsing.
   - malformed targets.
   - metadata fallback.
   - session/window/pane grouping.
   - sorting by activity.
   - selected pane choice.
   - unmanaged panes.
   - filters by session, cwd, branch, repo, provider, and display name.

6. Expand Playwright fixtures with realistic tmux data:

   - tmux-capable host.
   - multiple tmux sessions.
   - multiple windows.
   - multiple panes.
   - waiting/error/idle/unmanaged states.

7. Add smoke assertions for:

   - compact session rows.
   - expand/collapse behavior.
   - pane selection.
   - URL `session_id` update.
   - selected pane header/workbench.
   - mobile viewport rendering.

### Exit Criteria

- Current tmux grouping behavior is covered by unit tests.
- `/tmux` has non-empty mocked data in smoke tests.
- The feature can be refactored without relying on visual inspection alone.

## Phase 2: Split `/tmux` Into A Feature Module

This phase decomposes the page without making the major UX change yet.

### New Files

Create a tmux feature area:

- `apps/dashboard/src/hooks/useTmuxRosterData.ts`
- `apps/dashboard/src/components/tmux/TmuxPageShell.tsx`
- `apps/dashboard/src/components/tmux/TmuxDesktopShell.tsx`
- `apps/dashboard/src/components/tmux/TmuxMobileShell.tsx`
- `apps/dashboard/src/components/tmux/TmuxHostPicker.tsx`
- `apps/dashboard/src/components/tmux/TmuxRoster.tsx`
- `apps/dashboard/src/components/tmux/TmuxSessionRow.tsx`
- `apps/dashboard/src/components/tmux/TmuxWindowRow.tsx`
- `apps/dashboard/src/components/tmux/TmuxPaneRow.tsx`
- `apps/dashboard/src/components/tmux/TmuxTerminalHeader.tsx`
- `apps/dashboard/src/components/tmux/TmuxActionSheet.tsx`
- `apps/dashboard/src/components/tmux/TmuxKeyBar.tsx`

### Responsibilities

`useTmuxRosterData` should own:

- host loading.
- selected host fallback.
- session loading.
- URL parameter adapter.
- websocket invalidation.
- selected session ID.
- selected cluster/window helpers.

`TmuxRoster` should own:

- search UI.
- filter chips.
- session/window/pane list rendering.
- selection callbacks.

`TmuxDesktopShell` should own:

- desktop layout.
- persistent roster.
- selected workbench.

`TmuxMobileShell` should own:

- mobile mode state.
- roster/terminal/actions navigation.
- mobile-specific header.

`TmuxActionSheet` should own:

- selected session actions.
- destructive confirmation flow.

`TmuxPageClient.tsx` should become a thin coordinator or disappear.

### Exit Criteria

- Behavior remains equivalent.
- `TmuxPageClient.tsx` is no longer the center of all tmux logic.
- Components have clear boundaries.
- Existing tests still pass.

## Phase 3: Desktop UX Upgrade

### Target Layout

Desktop `/tmux` should become:

- Left: persistent dense roster.
- Right: selected terminal/workbench.

The operator should be able to switch panes without scrolling below the terminal.

### Tasks

1. Replace stacked layout with a two-pane layout.
2. Make roster independently scrollable.
3. Keep selected workbench visible while navigating the roster.
4. Change default closed session rows to one compact row.
5. Use fixed row heights where possible to avoid layout shift.
6. Add sticky search.
7. Add filter chips:

   - `All`
   - `Waiting`
   - `Errors`
   - `Active`
   - `Dirty`
   - `Untracked`

8. Render expanded session structure:

   - session row
   - windows
   - panes

9. Move secondary information behind details/actions instead of crowding the row.
10. Keep current `SessionWorkbench` available for desktop selected-pane work.

### Closed Session Row Should Show

- Status marker.
- tmux session name.
- window count.
- pane count.
- last activity.
- cwd/repo tail or branch.
- exceptional badges only.

### Exit Criteria

- Desktop can show many sessions without becoming a card wall.
- A selected terminal stays visible while the user changes roster selection.
- Closed rows are compact and scannable.

## Phase 4: Mobile UX Upgrade

### Primary Modes

Mobile `/tmux` should have three modes:

1. `Roster`
2. `Terminal`
3. `Actions`

Use segmented controls, icon tabs, or a compact thumb-reachable mode switch.

### Roster Mode

Roster mode is the default mobile entry point.

Tasks:

1. Add compact tmux-specific mobile header.
2. Pin search/filter at the top.
3. Render host selector as compact chips.
4. Render session rows at 48-56px target height.
5. Let tap on a session expand/collapse.
6. Let tap on a pane select it and switch to `Terminal`.
7. Let long press on a pane open `Actions`.

Closed session row should show:

- status dot/symbol.
- tmux session name.
- window/pane counts.
- last activity.
- branch or cwd tail.
- exceptional badges only.

### Terminal Mode

Terminal mode is focused interaction with the selected pane.

Tasks:

1. Header shows:

   - host.
   - tmux session/window/pane.
   - status/control state.
   - roster button.
   - actions button.

2. Terminal takes most of the viewport.
3. Use dynamic viewport units where possible.
4. Keep one-tap return to roster.
5. Keep one-tap access to actions.
6. Preserve existing mobile terminal assets:

   - virtual keyboard.
   - touch scrolling.
   - selection popup.
   - long-press context menu.
   - visual viewport resize handling.

7. Make attach/control explicit on mobile until control safety is fully handled.

### Actions Mode

Use a bottom sheet.

Actions:

- Attach terminal.
- Detach terminal.
- Take Control.
- Copy selection.
- Copy last 50 lines.
- Copy all browser-buffered terminal text.
- Paste.
- Send to another session.
- Idle / Wake.
- MCP.
- Open full session page.
- Terminate.

Destructive actions:

- `Terminate` must be separated visually.
- `Terminate` must confirm with the selected session/pane name.

### Exit Criteria

- First mobile `/tmux` screen shows a useful roster without scrolling past the workbench.
- A pane can be opened and interacted with in no more than two taps after search/filter.
- The operator can return to the roster from the terminal in one tap.
- Routine terminal controls do not sit beside destructive actions.

## Phase 5: Terminal Interaction Improvements

### Tasks

1. Fix auto-scroll behavior:

   - Track whether the terminal is near the bottom.
   - Auto-scroll only when already near bottom.
   - Preserve scrollback position when user scrolls up.

2. Improve read-only/control states:

   - Clear `Read-only` chip.
   - Primary `Take Control` action.
   - Clear detached/offline messaging.

3. Decide attach policy:

   - Default recommendation: explicit attach on mobile.
   - Possible future setting: auto-attach selected pane.

4. Improve terminal command controls:

   - Keep generic `VirtualKeyboard`.
   - Add tmux/operator key bar.

### `TmuxKeyBar` Keys

Start with:

- Esc.
- Tab.
- Enter.
- Arrow keys.
- Ctrl-C.
- Copy.
- Paste.
- tmux prefix.
- previous window.
- next window.
- pane left/right/up/down.

Future:

- split horizontal.
- split vertical.
- zoom pane.
- copy mode.
- configurable prefix.

### Exit Criteria

- Active output does not steal scrollback review.
- Mobile terminal control feels deliberate.
- Phone keyboards are not the only way to send common terminal/tmux commands.

## Phase 6: Backend And Security Hardening

### Terminal Authorization

Fix:

- `services/control-plane/src/routes/terminal.ts`

Tasks:

1. Require operator role for terminal `input` and `control`.
2. Decide viewer behavior:

   - allow read-only attach for viewer, or
   - deny terminal access for viewer.

3. Check host terminal capability before attach.
4. Return clear close reasons for:

   - unauthorized.
   - no terminal capability.
   - host offline.
   - session has no pane.

### Command Routing

Introduce a command routing service around:

- `pubsub.sendToAgent`
- pending command waits
- timeout handling
- authorization
- capability checks
- audit/event logging
- command result correlation

Likely file:

- `services/control-plane/src/services/commandRouter.ts`

### Tmux Roster Endpoint

Add optimized roster path or query.

Options:

- `GET /v1/tmux/roster?host_id=...`
- `GET /v1/sessions?host_id=...&kind=tmux_pane&include_snapshots=false`

Recommendation:

- Prefer a specific tmux roster route if the response shape becomes grouped or heavily optimized.
- Prefer session query parameters if the response remains a flat session list.

The route should:

- return active tmux panes only.
- optionally omit latest snapshots.
- include only fields needed for roster rendering.
- support host filtering.

### Multi-Viewer Policy

Current mismatch:

- browser terminal route evicts existing viewers.
- `agentd` terminal manager supports multiple channels with controller/read-only handoff.

Recommended policy:

- support multiple viewers.
- one controller.
- others read-only.
- explicit `Take Control`.

### Exit Criteria

- Terminal control path is role-aware.
- Host capability is enforced.
- Roster data path is efficient for many panes.
- Multi-viewer behavior is deliberate, not accidental.

## Phase 7: Contract Hardening

### Tmux Identity Schema

Promote tmux identity to a shared schema.

Suggested shape:

```ts
type TmuxPaneIdentity = {
  pane_id: string;
  target: string;
  session_name: string;
  window_name: string;
  window_index: number;
  pane_index: number;
};
```

Use this to reduce ad hoc parsing of `tmux_target`.

### Contract Tests

Add fixtures for:

- agent session upsert.
- terminal attach.
- terminal output.
- terminal input.
- terminal control.
- command dispatch.
- command result.
- host capabilities.

### Type Cleanup

Reduce duplicated dashboard local types where `@agent-command/schema` already exports the contract.

### Go Drift Protection

Options:

- JSON fixtures parsed by TypeScript schemas and Go tests.
- JSON schema emitted from `ac-schema`.
- Hand-maintained fixture set as first step.

### Exit Criteria

- Tmux identity has one shared contract.
- Go/TypeScript protocol drift becomes visible in tests.
- Dashboard local type duplication is reduced.

## Phase 8: Production Readiness

### Verification

Run:

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test:ci
pnpm test:smoke:dashboard
go test ./...
docker build -f deploy/Dockerfile.dashboard.base -t agent-commander-dashboard .
docker build -f deploy/Dockerfile.control-plane.base -t agent-commander-control-plane .
```

### Browser QA

Test:

- desktop wide.
- laptop.
- tablet width.
- iPhone-width portrait.
- Android-width portrait.
- phone landscape.
- mobile Safari if available.
- Chrome mobile emulation.

Scenarios:

- many tmux sessions.
- multiple windows.
- multiple panes.
- active output.
- terminal scrollback.
- copy/paste.
- virtual keys.
- read-only/take-control.
- offline host.
- unmanaged pane.
- waiting/error state.
- terminate confirmation.

### Docs

Update:

- `docs/tmux-manager.md`
- `docs/api.md` if roster endpoint changes.
- `docs/websockets.md` if terminal/control behavior changes.
- `README.md` if product language changes.

### Release Workflow

Bring release closer to CI parity:

- package tests.
- dashboard smoke.
- Docker image validation.

### Exit Criteria

- Full verification passes.
- Docs match behavior.
- Mobile flow is tested with mocked data and manually checked.
- `origin/main` can be made to represent the production-ready state when deployed.

## Recommended Execution Order

Do not begin with the big mobile UI.

Recommended order:

1. Extract and test `tmuxRoster`.
2. Expand Playwright tmux fixtures.
3. Split `/tmux` into feature components.
4. Implement desktop dense roster.
5. Implement mobile `Roster / Terminal / Actions`.
6. Improve terminal scroll/control states.
7. Harden terminal authorization and capability checks.
8. Add optimized tmux roster API.
9. Promote tmux identity schema.
10. Run full verification and update docs.

This sequence gives useful improvements early while keeping each step reviewable and reversible.

## First Implementation Slice

The first concrete implementation slice should be:

1. Create `apps/dashboard/src/lib/tmuxRoster.ts`.
2. Move roster parsing/grouping/filtering into it.
3. Add dashboard Vitest setup.
4. Add tests for the extracted model.
5. Update `TmuxPageClient.tsx` to import the extracted functions.
6. Run:

   ```bash
   pnpm test:ci
   pnpm typecheck
   ```

This is the foundation for every later UI and backend improvement.

## Progress Log

### 2026-05-19

Completed the first safety-rail slice:

- Created `apps/dashboard/src/lib/tmuxRoster.ts`.
- Moved tmux roster parsing, pane derivation, grouping, and filtering out of `TmuxPageClient.tsx`.
- Added dashboard Vitest configuration and package `test` script.
- Added `apps/dashboard/src/lib/tmuxRoster.test.ts` with coverage for:
  - target parsing.
  - malformed targets.
  - metadata fallback.
  - unmanaged panes.
  - grouping sessions/windows/panes.
  - sorting panes and windows.
  - selected pane choice.
  - text filtering.
- Expanded `tests/smoke/dashboard.spec.ts` with mocked tmux host/session fixtures.
- Added smoke coverage for:
  - non-empty `/tmux` roster.
  - session expand behavior.
  - window and pane rendering.
  - pane selection and URL update.
  - roster filtering.
  - mobile viewport roster usability.
- Added explicit dashboard `eslint` and `vitest` dev dependencies so filtered package commands use the intended tool versions.

Verification passed:

```bash
pnpm --filter @agent-command/dashboard test
pnpm --filter @agent-command/dashboard lint
pnpm --filter @agent-command/dashboard typecheck
pnpm test:ci
pnpm test:smoke:dashboard
```

Continued Phase 2 decomposition:

- Created `apps/dashboard/src/hooks/useTmuxRosterData.ts`.
- Moved tmux host loading, selected-host fallback, URL parameter management, session loading, websocket roster invalidation, filtering, cluster derivation, selected session/window tracking, and accordion expansion sync out of `TmuxPageClient.tsx`.
- Created `apps/dashboard/src/components/tmux/TmuxHostPicker.tsx`.
- Created `apps/dashboard/src/components/tmux/TmuxRoster.tsx`.
- Created `apps/dashboard/src/components/tmux/TmuxClusterRow.tsx`.
- Created `apps/dashboard/src/components/tmux/TmuxWindowRow.tsx`.
- Created `apps/dashboard/src/components/tmux/TmuxPaneRow.tsx`.
- Rewired `TmuxPageClient.tsx` to use the hook and new tmux components while preserving the existing layout and behavior.

Verification passed after the Phase 2 split:

```bash
pnpm --filter @agent-command/dashboard test
pnpm --filter @agent-command/dashboard lint
pnpm --filter @agent-command/dashboard typecheck
pnpm test:smoke:dashboard
pnpm test:ci
```

Completed the first workbench layout slice:

- Created `apps/dashboard/src/components/tmux/TmuxWorkbenchHeader.tsx`.
- Moved selected-session identity, host, status, idle toggle, send, MCP, and terminate controls into the workbench header component.
- Changed `/tmux` to a dense desktop operator layout with:
  - host picker at the top.
  - sticky compact roster in a left rail.
  - selected-session workbench in the main column.
  - mobile stack behavior preserved for the current implementation slice.
- Kept the roster component reusable by adding an optional `className` prop.

Verification passed after the workbench layout slice:

```bash
pnpm --filter @agent-command/dashboard test
pnpm --filter @agent-command/dashboard lint
pnpm --filter @agent-command/dashboard typecheck
pnpm test:smoke:dashboard
pnpm test:ci
```

Completed the first mobile shell slice:

- Created `apps/dashboard/src/components/tmux/TmuxDesktopShell.tsx`.
- Created `apps/dashboard/src/components/tmux/TmuxMobileShell.tsx`.
- Created `apps/dashboard/src/components/tmux/TmuxActionSheet.tsx`.
- Changed `TmuxPageClient.tsx` into a thinner coordinator that chooses the desktop or mobile shell based on viewport width.
- Made mobile `/tmux` default to `Roster` mode instead of showing the selected workbench above the roster.
- Added mobile mode controls:
  - `Roster`.
  - `Terminal`.
  - `Actions`.
- Made mobile pane selection switch into `Terminal` mode.
- Added a mobile actions bottom sheet with idle/wake, send-to, MCP, full-page, and terminate actions.
- Added pane-row context-menu support so a long-press/right-click path can open selected-pane actions.
- Added `SessionWorkbench` props that let the mobile terminal mode reuse the existing terminal, virtual keyboard, touch scrolling, selection, and context-menu behavior without rendering desktop details underneath.
- Expanded mobile Playwright smoke coverage to prove:
  - roster mode is the default mobile mode.
  - terminal/actions modes are disabled until a pane is selected.
  - selecting a pane updates the URL and switches to terminal context.
  - actions mode opens a pane actions dialog.

Verification passed after the mobile shell slice:

```bash
pnpm --filter @agent-command/dashboard test
pnpm --filter @agent-command/dashboard lint
pnpm --filter @agent-command/dashboard typecheck
pnpm test:smoke:dashboard
pnpm test:ci
```

Completed the roster filter slice:

- Added typed roster filters in `apps/dashboard/src/lib/tmuxRoster.ts`:
  - `all`.
  - `waiting`.
  - `errors`.
  - `active`.
  - `dirty`.
  - `untracked`.
- Added unit coverage for the roster filters, including git dirty/untracked metadata.
- Wired the active roster filter into `useTmuxRosterData`.
- Added URL-backed filter chips to `TmuxRoster` for desktop and mobile.
- Expanded Playwright smoke coverage for filter chip visibility and waiting-filter behavior.
- Fixed a real URL-state race in `useTmuxRosterData`: rapid filter/search changes now compose through a pending query-string ref instead of reusing stale `useSearchParams` snapshots.

Verification passed after the roster filter slice:

```bash
pnpm --filter @agent-command/dashboard test
pnpm --filter @agent-command/dashboard lint
pnpm --filter @agent-command/dashboard typecheck
pnpm test:smoke:dashboard
pnpm test:ci
```

Completed the first terminal hardening slice:

- Added `services/control-plane/src/services/terminalPolicy.ts`.
- Added explicit policy helpers for:
  - terminal attach permission.
  - terminal control/input permission.
  - host terminal capability.
- Updated `services/control-plane/src/routes/terminal.ts` to:
  - deny terminal attach for non-operator users.
  - check host `capabilities.terminal` before sending `terminal.attach`.
  - keep explicit input/control role checks in the message handler.
  - return clear WebSocket close reasons for missing role or missing terminal capability.
- Added `services/control-plane/tests/terminalPolicy.test.ts`.
- Added explicit control-plane `vitest` dev dependency so filtered package tests run without relying on turbo cache.

Verification passed after the terminal hardening slice:

```bash
pnpm --filter @agent-command/control-plane typecheck
pnpm --filter @agent-command/control-plane test
pnpm test:ci
```

Completed the tmux key bar slice:

- Added `apps/dashboard/src/lib/tmuxKeys.ts` as the pure source of tmux mobile shortcut payloads.
- Added `apps/dashboard/src/lib/tmuxKeys.test.ts` to cover prefix, previous/next window, copy mode, zoom, splits, and pane navigation sequences.
- Added `apps/dashboard/src/components/tmux/TmuxKeyBar.tsx`.
- Wired `TmuxKeyBar` into `TerminalView` for connected mobile tmux panes, above the existing generic virtual keyboard.
- Reused the existing terminal input path so tmux keys obey the same read-only and WebSocket behavior as other virtual terminal inputs.

Verification passed after the tmux key bar slice:

```bash
pnpm --filter @agent-command/dashboard test
pnpm --filter @agent-command/dashboard lint
pnpm --filter @agent-command/dashboard typecheck
```

Completed the optimized tmux roster endpoint slice:

- Added `db.getTmuxRosterSessions(hostId?)` to return active, unarchived `tmux_pane` sessions without joining latest snapshots.
- Added `services/control-plane/src/routes/tmux.ts`.
- Registered `GET /v1/tmux/roster`.
- Added `apps/dashboard/src/lib/api.ts#getTmuxRoster`.
- Switched `useTmuxRosterData` from paginating `/v1/sessions` to the new tmux roster endpoint.
- Updated dashboard smoke fixtures to serve `/v1/tmux/roster`.
- Updated docs:
  - `docs/api.md`.
  - `docs/tmux-manager.md`.
  - `docs/websockets.md` for terminal role/capability behavior.

Verification passed after the optimized roster endpoint slice:

```bash
pnpm --filter @agent-command/control-plane typecheck
pnpm --filter @agent-command/dashboard typecheck
pnpm --filter @agent-command/dashboard lint
pnpm test:smoke:dashboard
pnpm test:ci
```

Known tooling gap:

- `pnpm --filter @agent-command/control-plane lint` currently fails before checking source because the package lint script invokes ESLint 6 without a local config. Typecheck and tests pass for the touched control-plane code.

Completed the compact roster row slice:

- Tightened tmux session rows to a stable compact height.
- Removed inline instructional copy from expanded rows.
- Reduced window and pane row padding while preserving 44px mobile-friendly minimum targets.
- Kept exceptional badges visible while moving secondary details into shorter single-line metadata.

Verification passed after compact roster row polish:

```bash
pnpm --filter @agent-command/dashboard lint
pnpm --filter @agent-command/dashboard typecheck
pnpm test:smoke:dashboard
```

Completed the first tmux identity contract slice:

- Added `TmuxPaneIdentitySchema` and `TmuxPaneIdentity` to `packages/ac-schema/src/session.ts`.
- Added schema tests for valid and invalid tmux pane identity.
- Added `apps/dashboard/src/lib/tmuxRoster.ts` derivation of shared `TmuxPaneIdentity` for each pane view.
- Expanded dashboard roster tests to assert identity derivation from session fields and `metadata.tmux`.
- Added explicit schema package `vitest` dev dependency so filtered package tests run directly.
- Updated `docs/data-model.md` with the shared identity fields.

Verification passed after the tmux identity contract slice:

```bash
pnpm --filter @agent-command/schema test
pnpm --filter @agent-command/schema build
pnpm --filter @agent-command/dashboard test
pnpm --filter @agent-command/dashboard typecheck
pnpm test:ci
```

Completed the control-plane lint and terminal WebSocket test slice:

- Fixed control-plane and schema package lint scripts so they run from the repo root with the shared ESLint configuration.
- Added `ws` and `@types/ws` as control-plane dev dependencies for real WebSocket route tests.
- Added `services/control-plane/tests/terminalRoute.test.ts`.
- Covered terminal WebSocket behavior for:
  - viewer rejection before `terminal.attach`.
  - host without terminal capability rejection before `terminal.attach`.
  - operator attach command.
  - `resize`, `input`, `control`, and `detach` forwarding to agentd.

Verification passed:

```bash
pnpm --filter @agent-command/control-plane test
pnpm --filter @agent-command/control-plane typecheck
pnpm --filter @agent-command/control-plane lint
pnpm --filter @agent-command/schema lint
```

Completed the command router and multi-viewer terminal policy slice:

- Added `services/control-plane/src/services/commandRouter.ts`.
- Moved pending command result correlation and timeout handling out of `routes/sessions.ts`.
- Updated session command dispatch, fork, copy-to, cross-host capture/send, and bulk terminate flows to dispatch through the command router.
- Updated agent command result handling to import from the command router service.
- Added `services/control-plane/tests/commandRouter.test.ts`.
- Changed terminal WebSocket behavior to allow multiple browser viewers for the same session instead of evicting the existing viewer.
- Added terminal route coverage for multi-viewer attach behavior.
- Updated docs:
  - `docs/websockets.md`.
  - `docs/tmux-manager.md`.

Verification passed:

```bash
pnpm --filter @agent-command/control-plane test
pnpm --filter @agent-command/control-plane typecheck
pnpm --filter @agent-command/control-plane lint
```

Completed a production verification pass:

- Ran full workspace lint, typecheck, tests, and dashboard smoke.
- Ran the Go agent test suite from `agents/agentd`.
- Ran production workspace build.
- Built release Docker images:
  - `agent-commander-dashboard`.
  - `agent-commander-control-plane`.
- Cleaned legacy `ENV key value` warnings from `deploy/Dockerfile.dashboard.base`.

Verification passed:

```bash
pnpm lint
pnpm typecheck
pnpm test:ci
pnpm test:smoke:dashboard
pnpm build
(cd agents/agentd && go test ./...)
docker build -f deploy/Dockerfile.dashboard.base -t agent-commander-dashboard .
docker build -f deploy/Dockerfile.control-plane.base -t agent-commander-control-plane .
```

Completed the first protocol drift fixture slice:

- Added shared protocol fixtures under `tests/fixtures/protocol` for:
  - `agent.hello` with host capabilities.
  - `sessions.upsert` for a tmux pane.
  - `terminal.attach`.
  - `terminal.input`.
  - `terminal.output`.
  - `commands.dispatch`.
  - `commands.result`.
- Added `packages/ac-schema/tests/protocol-fixtures.test.ts` to validate fixtures against TypeScript/Zod schemas.
- Added `agents/agentd/internal/ws/protocol_fixtures_test.go` to validate the same fixtures against Go agent protocol expectations.

Verification passed:

```bash
pnpm --filter @agent-command/schema test
(cd agents/agentd && go test ./...)
```

Completed the dashboard API/domain type consolidation slice:

- Added `apps/dashboard/src/lib/groupTypes.ts` as the single dashboard-local definition for nested group trees.
- Replaced repeated `GroupWithChildren` definitions across dashboard group/sidebar/bulk-action components and stores.
- Replaced dashboard-local `CaptureMode`, `SessionLinkType`, `SessionLinkWithSession`, `ToolEvent`, and `ToolStat` definitions with schema-backed imports/re-exports from `@agent-command/schema`.
- Replaced the orchestrator store's local `SessionWithSnapshot` definition with the shared schema type.
- Updated the shared `SessionWithSnapshot` contract and control-plane `/v1/sessions` route to include `latest_snapshot.capture_hash`, matching DB selection and dashboard behavior.

Verification passed:

```bash
pnpm --filter @agent-command/schema build
pnpm --filter @agent-command/schema lint
pnpm --filter @agent-command/schema test
pnpm --filter @agent-command/dashboard typecheck
pnpm --filter @agent-command/dashboard lint
pnpm --filter @agent-command/dashboard test
pnpm --filter @agent-command/control-plane typecheck
```

Final current-tree verification passed:

```bash
pnpm lint
pnpm typecheck
pnpm test:ci
pnpm test:smoke:dashboard
pnpm build
(cd agents/agentd && go test ./...)
docker build -f deploy/Dockerfile.dashboard.base -t agent-commander-dashboard .
docker build -f deploy/Dockerfile.control-plane.base -t agent-commander-control-plane .
```

Completion audit:

- Phase 0: baseline and planning captured in this document, `BACKLOG.md`, and the study/UX pass documents under `tasks/`.
- Phase 1: tmux roster derivation extracted to `apps/dashboard/src/lib/tmuxRoster.ts` with unit coverage and expanded Playwright tmux fixtures.
- Phase 2: `/tmux` split into hook and component modules under `apps/dashboard/src/hooks/useTmuxRosterData.ts` and `apps/dashboard/src/components/tmux/`.
- Phase 3: desktop `/tmux` now uses persistent roster plus selected workbench layout.
- Phase 4: mobile `/tmux` now uses roster/terminal/actions modes with action sheet and tmux key bar.
- Phase 5: terminal interaction path now has explicit mobile key controls and multi-viewer/read-only policy support.
- Phase 6: terminal route enforces operator/capability checks; tmux roster route and command router service are in place.
- Phase 7: tmux identity and protocol fixtures are shared through schema/tests, with Go drift coverage.
- Phase 8: docs, release-parity checks, smoke tests, build, Go tests, and Docker image builds pass against the current tree.

Environment note:

- Browser QA in this environment is covered by Playwright desktop and mobile viewport smoke tests. Physical mobile Safari/Android device-lab QA was not available locally; the plan's "mobile Safari if available" item is therefore recorded as unavailable rather than a failing gate.

Completed the mobile Actions terminal-control gap found during completion audit:

- Added mobile Actions sheet controls for:
  - Attach.
  - Detach.
  - Take Control.
  - Focus.
  - Copy selection.
  - Copy last 50.
  - Copy all.
  - Paste.
- Wired `TmuxActionSheet` to the active `TerminalView` through a session-scoped browser custom event so terminal internals stay encapsulated.
- Reused existing `TerminalView` attach, detach, control, focus, copy, and paste behavior rather than duplicating terminal state in the tmux page shell.
- Expanded the mobile Playwright smoke test to assert that the Actions sheet exposes the terminal controls and destructive terminate action.

Final verification after the Actions-mode fix passed:

```bash
pnpm --filter @agent-command/dashboard typecheck
pnpm --filter @agent-command/dashboard lint
pnpm --filter @agent-command/dashboard test
pnpm test:smoke:dashboard
pnpm lint
pnpm typecheck
pnpm test:ci
pnpm build
(cd agents/agentd && go test ./...)
docker build -f deploy/Dockerfile.dashboard.base -t agent-commander-dashboard .
docker build -f deploy/Dockerfile.control-plane.base -t agent-commander-control-plane .
```
