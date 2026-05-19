# Agent Commander Codebase Study - 2026-05-19

## Goal

Assess the current codebase against the product goal: manage many open tmux sessions from a web browser, with `/tmux` as the primary working surface.

## Current State

- Monorepo with Next.js dashboard, Fastify control plane, Go `agentd`, and shared TypeScript/Zod schemas in `packages/ac-schema`.
- `/tmux` is the right product direction and is already wired as a first-class dashboard route.
- The implementation is functional but still shaped like an accumulated feature surface rather than a dedicated dense tmux command center.
- The codebase is not badly broken, but the next major improvement should start with safety rails and decomposition before UI expansion.

## High-Confidence Findings

### Product / UX

- `/tmux` is mostly one large client component: `apps/dashboard/src/app/(dashboard)/tmux/TmuxPageClient.tsx`.
- The roster is an accordion, but closed rows are still too tall for managing many sessions.
- The roster sits below a large workbench, which makes many-session navigation scroll-heavy.
- The best target layout is a persistent dense roster plus a selected-session workbench, not a terminal-first page with the roster underneath.

### Frontend Architecture

- `TmuxPageClient.tsx` mixes parsing, grouping, URL state, websocket invalidation, actions, selected-session loading, host selection, dialogs, and rendering.
- Pure tmux derivation functions are embedded in the component and have no dashboard unit tests:
  - `parseTargetIndexes`
  - `getPaneData`
  - `buildTmuxClusters`
  - `matchesTmuxFilter`
- `getAllSessions({ host_id })` paginates every session for a host and filters tmux panes client-side.
- `sessions.changed` invalidates and refetches the whole host tmux session list after a debounce.

### Backend / Control Plane

- The control plane is Fastify REST plus WebSockets, with process-local maps for agent connections, UI clients, terminal channels, and pending command waits.
- REST auth is global, but WebSocket routes do their own auth.
- Terminal WebSocket authenticates the user but does not appear to enforce operator role before forwarding input/control.
- Terminal route evicts existing viewers per session, while `agentd` terminal manager supports multiple channels with controller/read-only behavior. That is a product mismatch.
- Control-plane command dispatch, pending result tracking, auth, capability checks, and audit behavior should be pulled into a dedicated command routing service.

### Domain Contracts

- `Session` is the canonical object for panes, jobs, services, groups, forks, archives, metadata, and UI display.
- There is no first-class tmux session/window/pane model. A pane is represented by a `Session` with `tmux_pane_id`, `tmux_target`, and `metadata.tmux`.
- `tmux_target` is a free string and `metadata.tmux` is loosely coupled to it, so dashboard grouping relies on ad hoc parsing and fallback behavior.
- TypeScript schemas are the closest source of truth, but Go `agentd` manually redefines protocol shapes.
- Event typing is loose; known event enums exist, but persisted event payloads are mostly string/record shapes.

### Verification

- `pnpm test:ci` passes.
- `go test ./...` passes.
- Current tests are thin for the tmux browser workflow:
  - no dashboard unit test script
  - no unit tests around tmux grouping/filtering
  - Playwright smoke only checks empty/basic page rendering
  - little Go coverage for `internal/tmux`
- CI is stronger than release workflow; release skips some CI parity gates.

## Recommended Refactor Sequence

### Phase 1: Safety Rails

1. Extract tmux roster derivation into a pure module.
2. Add dashboard Vitest coverage for target parsing, metadata fallback, sorting, filtering, unmanaged panes, and selected pane choice.
3. Expand Playwright tmux smoke with mocked hosts and pane sessions.
4. Add dashboard `test` script so `turbo test` includes dashboard logic.

### Phase 2: Product Layout

1. Split `/tmux` into components:
   - `useTmuxRosterData`
   - `TmuxHostPicker`
   - `TmuxRoster`
   - `TmuxClusterRow`
   - `TmuxWindowSection`
   - `TmuxPaneRow`
   - `TmuxWorkbenchHeader`
2. Convert the default page to a dense two-pane operator layout:
   - left/sticky roster, compact fixed-height rows
   - right selected workbench
   - mobile keeps stacked accordion behavior
3. Preserve the lesson: default roster should show one compact row per tmux session, with explicit expand/collapse for windows and panes.

### Phase 3: Backend Fit

1. Add a tmux-specific list path or query that returns only active tmux pane roster data and can omit snapshots.
2. Add command routing service for authorization, host capability checks, result correlation, and audit.
3. Fix terminal WebSocket role/capability checks.
4. Reconcile terminal multi-viewer policy between browser route and `agentd` terminal manager.

### Phase 4: Contract Hardening

1. Promote tmux identity to a shared schema.
2. Add contract fixtures for agent/control-plane/dashboard tmux messages.
3. Reduce local dashboard type duplication where schema package already exports types.
4. Consider JSON-schema-generated or fixture-validated Go protocol types.

## Immediate Next Slice

Start with Phase 1. It is the cleanest foundation: extract the pure tmux roster model from `TmuxPageClient.tsx`, test it, then refactor the UI with confidence.

## Verification Performed

```bash
pnpm test:ci
go test ./...
```

Both passed on 2026-05-19.

## Dirty State

At the start of this study, the only dirty file was untracked `BACKLOG.md`. This study adds this task note under `tasks/`.
