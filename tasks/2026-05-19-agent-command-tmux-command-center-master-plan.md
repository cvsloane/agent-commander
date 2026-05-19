# Agent Commander Tmux Command Center Master Plan - 2026-05-19

## Purpose

Turn Agent Commander into a reliable browser-based command center for managing many open tmux sessions, windows, and panes from desktop and mobile.

The ideal product outcome:

- Find any active tmux session quickly.
- Inspect windows and panes without leaving the browser.
- Open and control the right pane.
- Switch between panes without fighting page scroll.
- Use a phone for real terminal work, including copy, paste, Ctrl-C, Esc, Tab, arrows, and tmux-specific commands.
- Avoid accidental destructive actions.
- Trust the terminal control path from a security and capability standpoint.

## Current Codebase Status

- Monorepo with:
  - Next.js dashboard in `apps/dashboard`.
  - Fastify control plane in `services/control-plane`.
  - Go `agentd` in `apps/agentd`.
  - shared TypeScript/Zod schemas in `packages/ac-schema`.
- `/tmux` is already present and is the correct product direction.
- The current implementation is functional but still shaped like accumulated dashboard features rather than a dedicated tmux operator surface.
- The biggest risk is not that the codebase is broken. The biggest risk is continuing to add UI and terminal features on top of a monolithic `/tmux` page without enough tests.

## Product Diagnosis

The product should be organized around tmux operation, not around generic session cards.

Desktop should become a dense two-pane operator surface:

- persistent compact roster.
- selected-session workbench.
- independently scrollable roster.
- selected terminal/workbench stays visible while browsing sessions.

Mobile should not be desktop stacked vertically. It should become a mode-based workflow:

- `Roster`
- `Terminal`
- `Actions`

The common mobile task should be: find a pane, open it, interact, switch, and act.

## Key Findings

### Frontend

- `apps/dashboard/src/app/(dashboard)/tmux/TmuxPageClient.tsx` has been carrying too many responsibilities:
  - tmux target parsing.
  - pane/session derivation.
  - host selection.
  - URL state.
  - websocket invalidation.
  - roster rendering.
  - selected-session actions.
  - workbench rendering.
- Roster behavior needed unit tests before further UI work.
- The current roster is readable but too tall for managing many sessions.
- Search exists, but the information architecture does not yet make session switching fast enough.

### Backend

- The control plane uses Fastify REST plus WebSockets.
- Process-local maps hold agent connections, UI clients, terminal channels, and pending command waits.
- REST auth is global, while WebSocket routes perform their own auth.
- Terminal WebSocket authenticates users but needs stronger operator-role and host-capability checks before forwarding input/control.
- Browser terminal behavior and `agentd` terminal-manager behavior are not fully reconciled:
  - browser route currently tends toward single active viewer eviction.
  - `agentd` supports controller/read-only style multi-channel behavior.

### Domain Model

- A tmux pane is currently represented as a `Session` with fields such as `tmux_pane_id`, `tmux_target`, and `metadata.tmux`.
- There is no first-class shared tmux session/window/pane identity model.
- Dashboard grouping relies on parsing `tmux_target` strings and falling back to loose metadata.
- The shared schema package should eventually own tmux identity contracts.

### Verification Gaps

- `pnpm test:ci` and `go test ./...` pass.
- Tmux-specific dashboard coverage was thin before this work:
  - no dashboard unit test script.
  - no unit tests around tmux grouping/filtering.
  - Playwright smoke coverage did not exercise realistic tmux rosters.
  - Go tmux coverage remains an area for later hardening.

## UI/UX Direction

### Desktop

Desktop `/tmux` should look and feel like a dense operations tool.

Recommended structure:

- Top: compact host picker.
- Left rail: sticky tmux roster with search and filters.
- Main area: selected-session workbench and terminal.
- Rows: compact, stable-height, one default row per tmux session.
- Expansion: explicit session/window/pane expansion.
- Badges: only exceptional status should stand out, such as waiting, error, offline, unmanaged, dirty, or untracked.

Avoid:

- card-wall layouts.
- nested cards.
- tall explanatory copy.
- oversized buttons in dense roster rows.

### Mobile

Mobile `/tmux` should use three modes.

`Roster` mode:

- default entry mode.
- sticky search/filter row.
- compact host selector.
- one row per tmux session by default.
- expand session to windows, expand/select window to panes.
- tap pane to open terminal mode.
- long-press pane to open actions.

`Terminal` mode:

- focused selected-pane interaction.
- compact header with host, tmux target, status, roster button, and actions button.
- terminal consumes most of the viewport.
- key/action rail pinned near the bottom.
- explicit attach/control until terminal-control policy is hardened.

`Actions` mode:

- bottom sheet for pane/window/session actions.
- copy, paste, send-to, idle/wake, MCP, full page, and terminate.
- destructive controls require confirmation with the selected pane/session name.

### Mobile Key Bar

Add tmux/operator-specific keys rather than relying only on the generic virtual keyboard:

- Prefix, usually `Ctrl-b`.
- Next window.
- Previous window.
- Pane left/right/up/down.
- Split horizontal.
- Split vertical.
- Zoom pane.
- Copy mode.
- Escape.
- Ctrl-C.
- Tab.
- Enter.
- Paste.

Implementation can be a `TmuxKeyBar` layered above or integrated with the existing virtual keyboard.

## Implementation Plan

### Phase 0: Baseline And Branch

Tasks:

1. Work on `refactor/tmux-command-center`.
2. Preserve planning artifacts:
   - `BACKLOG.md`
   - this master plan.
3. Run baseline verification:
   - `pnpm lint`
   - `pnpm typecheck`
   - `pnpm test:ci`
   - `go test ./...`
   - `pnpm test:smoke:dashboard`

Exit criteria:

- Baseline state is known.
- Any existing failures are recorded before refactor work starts.
- Planning files are not lost.

### Phase 1: Safety Rails

Tasks:

1. Extract pure tmux roster derivation into `apps/dashboard/src/lib/tmuxRoster.ts`.
2. Move parsing, pane derivation, grouping, sorting, filtering, and selected-pane selection into pure functions.
3. Add dashboard Vitest support.
4. Add unit coverage for:
   - target parsing.
   - malformed targets.
   - metadata fallback.
   - unmanaged panes.
   - grouping sessions/windows/panes.
   - sorting panes and windows.
   - selected pane choice.
   - text filtering.
5. Expand Playwright fixtures with realistic tmux data.
6. Add smoke coverage for:
   - non-empty `/tmux` roster.
   - session expansion.
   - window and pane rendering.
   - pane selection and URL update.
   - roster filtering.
   - mobile viewport usability.

Exit criteria:

- Current tmux grouping behavior is covered by unit tests.
- `/tmux` has realistic mocked smoke coverage.
- UI refactors can proceed without relying on visual inspection alone.

### Phase 2: Feature Decomposition

Create and use:

- `apps/dashboard/src/hooks/useTmuxRosterData.ts`
- `apps/dashboard/src/components/tmux/TmuxHostPicker.tsx`
- `apps/dashboard/src/components/tmux/TmuxRoster.tsx`
- `apps/dashboard/src/components/tmux/TmuxClusterRow.tsx`
- `apps/dashboard/src/components/tmux/TmuxWindowRow.tsx`
- `apps/dashboard/src/components/tmux/TmuxPaneRow.tsx`
- `apps/dashboard/src/components/tmux/TmuxWorkbenchHeader.tsx`

Later mobile-specific additions:

- `TmuxDesktopShell`
- `TmuxMobileShell`
- `TmuxActionSheet`
- `TmuxTerminalHeader`
- `TmuxKeyBar`

Exit criteria:

- `TmuxPageClient.tsx` is no longer the center of all tmux logic.
- Roster data, rendering, and selected-session controls have clear boundaries.
- Existing tests still pass.

### Phase 3: Desktop UX Upgrade

Tasks:

1. Replace stacked layout with two-pane layout.
2. Make roster independently scrollable.
3. Keep selected workbench visible while navigating roster.
4. Use compact default session rows.
5. Add sticky search.
6. Add filter chips:
   - All
   - Waiting
   - Errors
   - Active
   - Dirty
   - Untracked
7. Move secondary row information behind details/actions.
8. Keep `SessionWorkbench` usable for selected desktop work.

Exit criteria:

- Desktop can show many sessions without becoming a card wall.
- A selected terminal stays visible while browsing roster selection.
- Closed rows are compact and scannable.

### Phase 4: Mobile UX Upgrade

Tasks:

1. Add mobile mode state:
   - roster.
   - terminal.
   - actions.
2. Make roster the mobile default.
3. Add compact mobile tmux header.
4. Add roster/search sheet or mode.
5. Add actions sheet.
6. Add tmux key bar.
7. Keep attach/control explicit until terminal policy is resolved.
8. Add mobile smoke tests for:
   - mode switching.
   - pane selection opens terminal mode.
   - actions sheet opens for selected pane.
   - key bar is reachable without overlapping terminal.

Exit criteria:

- A phone can manage and interact with tmux panes without long vertical page scrolling.
- Terminal, roster, and actions are always reachable with one clear control.
- Destructive actions are isolated and confirmed.

### Phase 5: Backend Roster And Control Hardening

Tasks:

1. Add a tmux-specific roster endpoint or query that can return only active tmux pane data and omit snapshots.
2. Add or extract a command-routing service for:
   - authorization.
   - host capability checks.
   - timeout handling.
   - result correlation.
   - audit trail.
3. Enforce operator role on terminal control input.
4. Enforce host terminal capability checks before terminal attach/control.
5. Reconcile browser multi-viewer behavior with `agentd` controller/read-only behavior.

Exit criteria:

- `/tmux` no longer depends on fetching broad session data unnecessarily.
- Terminal control rules are deliberate and testable.
- Read-only and take-control behavior is a product decision, not an incidental implementation detail.

### Phase 6: Contract Hardening

Tasks:

1. Promote tmux identity into shared schema:
   - host id.
   - tmux session name/id.
   - window index/name.
   - pane index/id.
   - target string.
2. Add contract fixtures for:
   - tmux session upserts.
   - terminal messages.
   - command dispatch/results.
   - host capabilities.
3. Reduce dashboard local type duplication where `@agent-command/schema` already exports the contract.
4. Consider fixture-validating Go protocol types against shared examples.

Exit criteria:

- Dashboard, control plane, and agent agree on tmux identity.
- Drift is caught by tests before runtime.

## Current Progress

Completed:

- Extracted tmux roster derivation into `apps/dashboard/src/lib/tmuxRoster.ts`.
- Added dashboard Vitest setup and `test` script.
- Added `apps/dashboard/src/lib/tmuxRoster.test.ts` with 10 passing tests.
- Expanded dashboard Playwright smoke coverage with realistic tmux host/session/window/pane fixtures.
- Added mobile viewport smoke coverage for `/tmux`.
- Created `apps/dashboard/src/hooks/useTmuxRosterData.ts`.
- Created tmux components:
  - `TmuxHostPicker`.
  - `TmuxRoster`.
  - `TmuxClusterRow`.
  - `TmuxWindowRow`.
  - `TmuxPaneRow`.
  - `TmuxWorkbenchHeader`.
- Started desktop dense layout:
  - host picker at the top.
  - sticky compact roster left rail.
  - selected workbench main column.
  - current mobile stack retained until the dedicated mobile shell is built.
- Updated `BACKLOG.md` with next implementation items.

Verification passed after the latest slice:

```bash
pnpm --filter @agent-command/dashboard test
pnpm --filter @agent-command/dashboard lint
pnpm --filter @agent-command/dashboard typecheck
pnpm test:smoke:dashboard
pnpm test:ci
```

Previously verified:

```bash
pnpm test:ci
go test ./...
```

## Next Recommended Slice

Build the mobile-specific shell next.

Concrete sequence:

1. Create `TmuxMobileShell`.
2. Add mobile mode state: roster, terminal, actions.
3. Keep desktop using the current two-pane layout.
4. Move selected-session mobile controls into a compact header.
5. Add a simple `TmuxActionSheet` with non-destructive actions first.
6. Add Playwright mobile coverage for selecting a pane and switching modes.

This is the next highest-leverage step because it directly addresses the requirement to manage and interact with tmux windows and panes from a mobile device.

