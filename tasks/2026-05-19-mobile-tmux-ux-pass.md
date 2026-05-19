# Mobile Tmux UI/UX Pass - 2026-05-19

## Goal

Design the next `/tmux` experience around managing and interacting with tmux windows and panes from a mobile device without making desktop worse.

The core mobile outcome: from a phone, the operator can quickly find a tmux session, inspect its windows and panes, open the right pane, interact with the terminal, send key commands, copy/paste, switch panes, and recover from connection/control states without fighting scroll, cramped controls, or accidental destructive actions.

## Existing Mobile Assets

- The dashboard already has mobile navigation via `MobileHeader` and `GlobalSidebar`.
- `TerminalView` already has mobile-specific behavior:
  - smaller xterm font on mobile
  - touch scroll handling with momentum
  - virtual keyboard row
  - copy/paste controls
  - long-press terminal context menu
  - selection popup
  - visual viewport resize handling
- Button variants already include mobile-friendly 44px touch targets.
- The current `/tmux` page is responsive by stacking, but not yet product-designed for mobile tmux management.

## Current UX Problems

### Page Structure

- `/tmux` stacks the selected workbench above the roster.
- On a phone, this makes switching sessions too expensive because the roster sits below a large terminal/workbench area.
- The workbench uses a large fixed-height card (`66vh`), which leaves limited space for search, host context, and quick switching.
- The host picker, page header, selected session actions, workbench, details, analytics, events, and roster all compete in one vertical scroll.

### Roster Density

- Closed tmux session rows are still multi-line and visually tall.
- Expanded windows and panes are readable but not optimized for thumb scanning.
- There is no persistent mobile "jump back to roster" control when focused in the terminal.
- Search is present but not central enough for many open sessions.

### Terminal Interaction

- Mobile terminal support is strong for raw interaction, but it is embedded inside a broader desktop-style workbench.
- Terminal attach is manual. That is safer, but it adds friction when switching often.
- The virtual key row is generic. It lacks tmux/operator-specific shortcuts such as prefix, split, next/previous window, pane navigation, and scroll/copy modes.
- Copy/paste affordances exist, but the intended mobile workflow is not surfaced as a coherent command bar.
- Always scrolling terminal output to bottom can fight review of scrollback during active output.

### Actions And Safety

- Selected-session actions (`Idle`, `Send to`, `MCP`, `Terminate`, `Full page`) are desktop button rows.
- On mobile, destructive and advanced actions should move behind an actions sheet with clear confirmation.
- Control state matters on touch devices. Read-only, take-control, detached, offline host, and terminal unavailable states need stronger mobile affordances.

## Target Mobile Information Architecture

Use three primary modes on `/tmux` mobile:

1. **Roster**
   - Default entry mode.
   - Dense list of tmux sessions grouped by host.
   - Search/filter pinned at top.
   - One compact row per tmux session by default.
   - Expand a session to show windows; expand/select a window to show panes.

2. **Terminal**
   - Focused selected pane interaction.
   - Header shows host, tmux session/window/pane, status, and a back-to-roster button.
   - Terminal uses most of the viewport.
   - Command/key row is pinned at bottom above or integrated with the virtual keyboard.

3. **Actions**
   - Bottom sheet for selected pane/window/session actions.
   - Includes copy/send-to/idle/wake/MCP/open full page/terminate.
   - Destructive controls require confirmation.

This can be implemented as segmented controls or icon tabs at the top/bottom:

- `List`
- `Term`
- `Actions`

The mode switch should be reachable with one thumb and should not require opening the global nav.

## Recommended Mobile Layout

### Header

Use a compact tmux-specific header under the global dashboard header:

- Left: back/list icon or current mode.
- Center: selected host/session path, truncated.
- Right: refresh and actions icons.

Avoid long explanatory text on mobile. Use tooltips on desktop; concise accessible labels for icons.

### Roster Mode

Layout:

- Sticky search/filter row.
- Optional horizontal host selector as compact chips.
- Filter chips:
  - All
  - Waiting
  - Errors
  - Active
  - Dirty
  - Untracked
- Session rows at fixed height, ideally 48-56px.

Closed session row should show:

- Status dot or symbol.
- tmux session name.
- Window/pane counts.
- Last activity.
- Branch or cwd tail, one line max.
- Badges only when exceptional: waiting, error, untracked, offline.

Expanded session should show:

- Windows as 44px minimum rows.
- Panes as compact rows with provider icon, pane index, title/cwd tail, status.
- Tapping a pane switches to Terminal mode.
- Long press on a pane opens Actions mode for that pane.

### Terminal Mode

Layout:

- Fixed-height mobile terminal region using dynamic viewport units where possible.
- Compact selected-pane header:
  - host
  - tmux target
  - status/control state
  - roster button
  - actions button
- Terminal body.
- Pinned key/action rail:
  - Esc
  - Tab
  - Enter
  - arrows
  - Ctrl-C
  - paste
  - copy
  - optional tmux prefix

Interaction rules:

- Do not hide the roster forever; one tap returns to Roster mode.
- Preserve scrollback position if the user has scrolled away from bottom.
- Make attach/control explicit until safety is fully resolved.
- When read-only, show a clear `Read-only` chip and a primary `Take Control` action.
- When detached/offline, show a clear reconnect state without covering scrollback.

### Actions Mode

Use a bottom sheet rather than inline button rows.

Primary actions:

- Attach / Detach terminal.
- Take Control when read-only.
- Copy selection.
- Copy last 50 lines.
- Copy all visible/scrollback available in browser buffer.
- Paste.
- Send to another session.
- Idle / Wake.
- Open MCP.
- Open full session page.
- Terminate.

Destructive actions:

- `Terminate` should be visually separated and require confirmation with the selected pane/session name.

## Tmux-Specific Mobile Key Design

The existing virtual keyboard is generic. Add a tmux/operator profile:

- Prefix (`Ctrl-b` by default; eventually configurable).
- Next window.
- Previous window.
- Pane left/right/up/down.
- Split horizontal.
- Split vertical.
- Zoom pane.
- Copy mode.
- Escape.
- Ctrl-C.

Implementation option:

- Keep the current `VirtualKeyboard`.
- Add a `profile="terminal" | "tmux"` prop or a separate `TmuxKeyBar` above it.
- Use settings to allow customizing visible keys.

This matters because mobile terminal use is mostly about sending keys that phone keyboards make awkward.

## Gesture Model

Recommended gestures:

- Tap row: select/open.
- Tap chevron: expand/collapse.
- Long press pane row: actions sheet.
- Horizontal swipe in roster: avoid for now unless there is a strong need; it conflicts with browser and terminal gestures.
- Terminal touch scroll: keep existing custom handling.
- Terminal long press: context menu, already present.

Avoid hidden gestures as the only path to important actions.

## Visual Design Direction

The UI should feel like a dense operations tool, not a landing page or card wall.

- Use rows, sheets, segmented controls, icon buttons, and compact chips.
- Avoid nested cards in mobile tmux.
- Avoid large explanatory copy after the first pass.
- Keep rows stable height to prevent layout shift during updates.
- Use 44px minimum touch targets for controls.
- Use strong selected-state treatment so the active pane is obvious.
- Reserve bright/destructive color for waiting/error/terminate states, not decoration.

## Technical Refactor Needed For Mobile

Do not start by restyling the current monolith. First split the tmux feature:

- `apps/dashboard/src/lib/tmuxRoster.ts`
  - pure parsing/grouping/filtering
  - unit tested
- `apps/dashboard/src/hooks/useTmuxRosterData.ts`
  - hosts, selected host, sessions, websocket invalidation, URL state adapter
- `apps/dashboard/src/components/tmux/TmuxMobileShell.tsx`
- `apps/dashboard/src/components/tmux/TmuxDesktopShell.tsx`
- `apps/dashboard/src/components/tmux/TmuxRoster.tsx`
- `apps/dashboard/src/components/tmux/TmuxSessionRow.tsx`
- `apps/dashboard/src/components/tmux/TmuxWindowRow.tsx`
- `apps/dashboard/src/components/tmux/TmuxPaneRow.tsx`
- `apps/dashboard/src/components/tmux/TmuxActionSheet.tsx`
- `apps/dashboard/src/components/tmux/TmuxTerminalHeader.tsx`
- `apps/dashboard/src/components/tmux/TmuxKeyBar.tsx`

Keep `SessionWorkbench` reusable for desktop, but mobile should not inherit all desktop details/analytics/events by default. Those can move behind Actions or Details.

## Test Requirements

Add dashboard unit tests for:

- target parsing
- metadata fallback
- session/window/pane grouping
- selected pane/window/session behavior
- compact roster filters
- unmanaged panes
- sorting by activity

Expand Playwright smoke for `/tmux`:

- mocked mobile viewport
- mocked tmux-capable host
- multiple tmux sessions
- multiple windows/panes
- roster default shows compact rows
- expand/collapse works
- tapping pane switches to terminal mode
- actions sheet opens from selected pane
- filter narrows rows
- terminal header remains usable on mobile

Add manual QA checklist:

- iPhone-width portrait
- Android-width portrait
- landscape phone
- mobile Safari if available
- Chrome mobile emulation
- terminal with active output
- terminal while virtual keyboard visible
- copy/paste and long press
- offline host state
- read-only/take-control state

## Recommended Build Order

1. Extract/test tmux roster model.
2. Add Playwright fixtures for non-empty tmux data.
3. Create mobile shell with `Roster`, `Terminal`, `Actions` modes.
4. Move selected pane action buttons into `TmuxActionSheet` for mobile.
5. Add compact roster rows and sticky search.
6. Add `TmuxKeyBar`.
7. Improve terminal scrollback behavior so active output does not force bottom when the user is reviewing history.
8. Add backend role/capability checks for terminal control.

## Acceptance Criteria

- On a phone viewport, the first `/tmux` screen shows a usable roster without scrolling past the workbench.
- Closed tmux sessions are one compact row each.
- A pane can be opened and interacted with in no more than two taps after search/filter.
- The operator can return to the roster from the terminal in one tap.
- Copy, paste, Ctrl-C, Esc, Tab, arrows, and Enter are usable without the native keyboard being the only option.
- Destructive actions are not adjacent to routine terminal controls.
- Tests cover the mobile roster and pane-selection flow with mocked data.
