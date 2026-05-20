# Mobile Tmux Agent Launch Improvement Plan - 2026-05-19

## Objective

Make Agent Commander good at the phone workflow:

1. Open the dashboard on a phone.
2. Choose a machine, such as `heavisidelinux` or `homelinux`.
3. Open an existing tmux pane or launch a new tmux window/session.
4. Start a coding agent such as Codex or Claude Code in the right repo.
5. Optionally send an initial prompt.
6. Land directly in a usable mobile terminal.

This is a second improvement pass after the tmux command center refactor. The intent is not to add another broad feature pile. The intent is to delete accidental complexity, simplify the launch path, and create a first-class mobile operator workflow.

## Inputs Reviewed

- Current branch: `refactor/tmux-command-center`.
- Tmux command center implementation under:
  - `apps/dashboard/src/app/(dashboard)/tmux/TmuxPageClient.tsx`
  - `apps/dashboard/src/components/tmux/`
  - `apps/dashboard/src/hooks/useTmuxRosterData.ts`
  - `apps/dashboard/src/components/TerminalView.tsx`
- Existing spawn/session generator flow:
  - `apps/dashboard/src/components/session-generator/SessionGenerator.tsx`
  - `apps/dashboard/src/components/session-generator/RepoPicker.tsx`
  - `apps/dashboard/src/components/session-generator/SessionConfigStep.tsx`
  - `apps/dashboard/src/components/SpawnSessionDialog.tsx`
  - `apps/dashboard/src/components/layout/QuickSpawn.tsx`
- Existing backend primitives:
  - `services/control-plane/src/routes/sessions.ts`
  - `services/control-plane/src/services/sessionSpawn.ts`
  - `services/control-plane/src/routes/tmux.ts`
  - `services/control-plane/src/routes/terminal.ts`
  - `services/control-plane/src/services/commandRouter.ts`
  - `services/control-plane/src/routes/hosts.ts`
  - `services/control-plane/src/routes/projects.ts`
- Agent-side primitives:
  - `agents/agentd/internal/tmux/tmux.go`
  - `agents/agentd/internal/ws/client.go`
  - `agents/agentd/internal/proc/proc.go`
- Shared contracts:
  - `packages/ac-schema/src/command.ts`
  - `packages/ac-schema/src/host.ts`
  - `packages/ac-schema/src/settings.ts`
- Parallel agent study:
  - Backend/API explorer completed a control-plane review.
  - Dashboard explorer completed a read-only dashboard review.
  - Local source inspection covered agentd, schema, docs, settings, recent sessions, and spawn flows.

## Stated Requirements

Named owners:

- Operator: launch or open coding work from a phone in a few taps.
- Dashboard: provide the mobile quick-launch surface and terminal landing path.
- Control plane: expose a workflow-shaped launch API, enforce policy, and return an openable session state.
- Agentd: create tmux windows, start providers, send optional initial input, and report pane identity.

Suspect inherited requirements:

- A phone launch should not use the current desktop `SessionGenerator` as-is.
- The operator should not need to know host UUIDs.
- The operator should not need to wait, refresh, and hunt for a newly spawned pane.
- A launch flow should not require separate client calls for host discovery, repo discovery, spawn, polling, and terminal attachment.
- Generic command dispatch should not bypass capability and provider policy.

## Implementation Progress

### 2026-05-19 Backend Foundation

Completed:

- Added shared launch contracts in `packages/ac-schema/src/launch.ts`.
- Added `GET /v1/launch/targets` for mobile-friendly host, provider, project, and tmux recents.
- Added `POST /v1/launch` to wrap the existing spawn service, wait briefly for an openable tmux pane, return a direct `/tmux?...&mode=terminal&attach=1` URL, and optionally send an initial prompt after readiness.
- Added dashboard API client helpers for launch targets and launch requests.
- Blocked privileged command types from generic session command dispatch.
- Folded host-level directory command result handling into the shared `CommandRouter`.
- Added schema and control-plane tests for the new contracts, policy checks, readiness wait, and host-level command routing.
- Added docs in `docs/mobile-launch.md` and updated `docs/api.md`.
- Added the first `/tmux` mobile launch sheet with machine chips, recent projects, manual path entry, Codex/Claude selection, optional prompt, tracked-pane reopen, and launch-to-terminal navigation.
- Added `pnpm verify:launch`.

Still pending:

- Full `TerminalView` hook/component split.
- Deeper visual polish pass after live-device testing.

## Current Useful Primitives

Keep and reuse:

- `POST /v1/sessions/spawn` already creates a DB session, validates host/provider support, dispatches `spawn_session`, and supports `tmux.target_session` plus `tmux.window_name`.
- `SpawnSessionPayloadSchema` already supports provider, working directory, flags, memory files, group, and tmux target/window.
- `RepoPicker` and `DirectoryTree` already browse allowed host directories.
- `Projects` are already touched on spawn and can provide recents.
- `RecentSessions` already deep-links tmux panes to `/tmux?host_id=...&session_id=...`.
- `/v1/tmux/roster` already provides fast active tmux-pane data.
- `TerminalView` already supports mobile attach, detach, control, copy, paste, virtual keys, and tmux key bar.

## Elon Algorithm Audit

### 1. Make Requirements Less Dumb

The real requirement is not "make session generation work on mobile." It is:

> Start or resume coding work from a phone with minimum thinking, minimum typing, and a direct terminal landing.

That means the primary object is a launch target, not a session form.

Launch target should combine:

- host alias/name
- online status
- terminal support
- spawn support
- supported providers
- default roots
- recent projects
- recent tmux sessions
- sensible default tmux target

### 2. Delete

Delete or stop expanding:

- Do not put the full three-step `SessionGenerator` inside mobile `/tmux`.
- Do not make the mobile operator choose every spawn option by default.
- Do not expose `gemini_cli`, `opencode`, `aider`, and `shell` as equally prominent on the phone workflow if the stated goal is Codex/Claude.
- Do not keep generic command dispatch open for privileged command types such as `spawn_session` and `list_directory`.
- Do not keep two pending-command systems: `CommandRouter` and route-local host command tracking in `hosts.ts`.
- Do not require the client to poll several endpoints after spawn when the server can wait briefly for the pane to become openable.
- Do not make host UUIDs part of the primary phone workflow.

### 3. Simplify

Simplify into one mobile launch model:

```ts
type LaunchTarget = {
  host_id: string;
  alias: string;
  display_name: string;
  online: boolean;
  supports_terminal: boolean;
  supports_spawn: boolean;
  providers: {
    claude_code: boolean;
    codex: boolean;
  };
  roots: string[];
  recent_projects: Array<{
    id?: string;
    path: string;
    display_name?: string;
    last_used_at?: string;
  }>;
  recent_tmux: Array<{
    session_id: string;
    title?: string | null;
    tmux_target?: string | null;
    cwd?: string | null;
    provider: string;
    status: string;
  }>;
};
```

Simplify the phone UI to:

1. Machine.
2. Repo/recent path.
3. Agent.
4. Optional prompt.
5. Launch.

Everything else becomes "More options."

### 4. Accelerate

Shorten launch feedback loop:

- Add one endpoint that returns launch targets in one call.
- Add one endpoint that launches and waits briefly for `tmux_pane_id`.
- Return a navigation target directly:

```json
{
  "session_id": "...",
  "cmd_id": "...",
  "status": "ready",
  "href": "/tmux?host_id=...&session_id=...",
  "terminal": {
    "openable": true
  }
}
```

Target metric:

- Phone launch from cold dashboard to terminal attach-ready in under 10 seconds for online hosts.
- Operator input required: 3 taps for recent project, 4-5 taps for new path.

### 5. Automate Last

Automate only after the launch path is simpler:

- Remember last machine/project/provider combinations.
- Suggest provider based on repo or last choice.
- Auto-open terminal after launch reaches `ready`.
- Auto-send initial prompt only after session is open and the operator opted in.
- Add Playwright mobile smoke for the launch flow.

## Backend Findings From Parallel Agent

### Kill

1. Restrict generic command dispatch for privileged commands.

Files:

- `services/control-plane/src/routes/sessions.ts`
- `services/control-plane/src/services/sessionSpawn.ts`

Problem:

- `/v1/sessions/spawn` checks host spawn/provider capabilities.
- Generic session command dispatch can still accept schema-valid commands and send them directly.

Recommendation:

- Route all privileged commands through one policy gate.
- Block `spawn_session`, `list_directory`, `kill_session`, and future launch commands from generic dispatch unless explicitly authorized and capability-checked.

### Simplify

2. Expand host capability update API or stop pretending it manages capabilities.

Files:

- `services/control-plane/src/routes/hosts.ts`
- `services/control-plane/src/services/terminalPolicy.ts`
- `services/control-plane/src/services/sessionSpawn.ts`

Problem:

- Runtime checks depend on `terminal`, `spawn`, and `providers`.
- PATCH only updates `list_directory*`.

Recommendation:

- Add controlled updates for `terminal`, `spawn`, and `providers`, or make capabilities agent-reported only and remove the misleading partial API.

3. Unify pending command result handling.

Files:

- `services/control-plane/src/services/commandRouter.ts`
- `services/control-plane/src/routes/hosts.ts`

Problem:

- Session commands use `CommandRouter`.
- Host-level commands use a route-local pending map and synthetic session id.

Recommendation:

- Extend `CommandRouter` to support `scope: "session" | "host"`.
- Move host directory listing through it.

### Accelerate

4. Spawn should optionally wait until the pane is openable.

Files:

- `services/control-plane/src/services/sessionSpawn.ts`
- `services/control-plane/src/routes/sessions.ts`

Problem:

- `waitForSessionReady` exists but `/v1/sessions/spawn` returns immediately.

Recommendation:

- Add `wait=true` to existing spawn or make the new launch endpoint wait up to 10-15 seconds for `tmux_pane_id`.
- Return `ready | starting | failed | offline`.

5. Add host aliases and launch targets.

Files:

- `services/control-plane/src/routes/hosts.ts`
- `services/control-plane/src/db/index.ts`

Problem:

- Mobile workflow should say `heavisidelinux` or `homelinux`, not host UUID.

Recommendation:

- Derive alias from `name` or `tailscale_name`.
- Expose compact launch target records.

### Automate

6. Add workflow-shaped launch endpoints.

Recommended endpoints:

- `GET /v1/launch/targets`
- `POST /v1/launch`
- `GET /v1/launch/recent`
- `POST /v1/tmux/open`

The backend explorer also recommended a short-lived terminal token endpoint:

- `POST /v1/sessions/:id/open-terminal-token`

This is valuable, but it can be second-wave after launch works.

## Dashboard Findings

### Kill

1. Delete the unused legacy spawn dialog.

Files:

- `apps/dashboard/src/components/SpawnSessionDialog.tsx`
- `apps/dashboard/src/components/session-generator/SessionGenerator.tsx`

Why:

- `SpawnSessionDialog` duplicates host/provider/path/group/tmux spawn behavior.
- It has a separate provider list and older path-autocomplete flow.
- The dashboard explorer found it unreferenced.

Recommendation:

- Remove `SpawnSessionDialog`.
- Keep `SessionGenerator` as the legacy/full launch surface until the mobile launch sheet replaces the common path.
- If manual-path spawning is still needed, add it to `RepoPicker`, `SessionGenerator`, or the new launch sheet.

2. Remove mobile-visible advanced controls from the main Sessions toolbar.

Files:

- `apps/dashboard/src/app/(dashboard)/sessions/SessionsPageClient.tsx`

Why:

- Mobile sessions page currently competes for attention with select, drag, search, shortcuts, import, filters, and new session controls.
- The core phone jobs are "open running thing" and "launch agent."

Recommendation:

- Keep `New Session`, workflow/status filter, and search visible.
- Move select, drag, import, shortcuts, archive, and all-sessions controls into an overflow/action sheet on mobile.

3. Do not reuse full `SessionGenerator` for the phone launch path.

Files:

- `apps/dashboard/src/components/session-generator/SessionGenerator.tsx`
- `apps/dashboard/src/components/session-generator/RepoPicker.tsx`
- `apps/dashboard/src/components/session-generator/SessionConfigStep.tsx`

Why:

- It is a desktop modal with repo browsing, template configuration, group creation, linking, flags, and spawn progress.
- The phone workflow needs recent-first quick launch, not full project setup.

Replacement:

- Build `MobileLaunchSheet` or `/launch` route with a narrow workflow.

4. De-emphasize non-Codex/Claude providers in mobile quick launch.

Why:

- The user-stated mobile job is Codex/Claude coding agents.
- Extra providers belong under "More."

### Simplify

5. Centralize launch provider/template definitions.

Files:

- `apps/dashboard/src/components/session-generator/SessionConfigStep.tsx`
- `apps/dashboard/src/components/session-generator/templates.ts`
- `apps/dashboard/src/components/settings/SettingsPanel.tsx`

Why:

- Provider names and launch options are repeated across generator/settings/legacy dialog.
- Drift is likely as Codex/Claude become primary mobile launch paths.

Recommendation:

- Export one `LAUNCH_PROVIDERS` source and one `SESSION_TEMPLATES` source.
- Consume them in settings, generator, and mobile launch UI.

6. Make `SessionGenerator` mobile-first if it remains a supported surface.

Files:

- `apps/dashboard/src/components/session-generator/SessionGenerator.tsx`
- `apps/dashboard/src/components/session-generator/SessionConfigStep.tsx`

Why:

- Fixed centered modal, fixed 400px panels, and 3-column template grid are desktop assumptions.

Recommendation:

- Use a full-screen mobile sheet with sticky footer.
- Put repo/recent first, template second, and keep spawn button reachable.
- Use single-column template buttons on mobile.

7. Reuse `RepoPicker` data primitives, not its current tree-first UI.

Files:

- `apps/dashboard/src/components/session-generator/RepoPicker.tsx`
- `apps/dashboard/src/components/session-generator/DirectoryTree.tsx`
- `apps/dashboard/src/lib/api.ts`

Plan:

- Extract a `useLaunchTargets` hook.
- Extract a `useHostDirectoryBrowser` hook if needed.
- Mobile UI should show:
  - recent projects first
  - configured dev roots second
  - manual path last

8. Make repo picking recent/project-first, not tree-first.

Files:

- `apps/dashboard/src/components/session-generator/RepoPicker.tsx`
- `apps/dashboard/src/components/session-generator/DirectoryTree.tsx`
- `apps/dashboard/src/stores/settings.ts`

Why:

- `repoLastUsed` already exists, but the picker still starts with host/folder/tree.
- Phone users should not browse directory trees for common repos.

Recommendation:

- Show recent repos on the selected host above the tree.
- Default mobile sort to `last_used`.
- Filter launch hosts to those that can both list directories and spawn tmux-backed sessions.

9. Turn recent sessions/projects into quick-launch shortcuts.

Files:

- `apps/dashboard/src/components/layout/RecentSessions.tsx`
- `apps/dashboard/src/stores/ui.ts`
- `services/control-plane/src/routes/projects.ts`

Plan:

- Add a mobile `/tmux` action: "Launch here."
- Add recent project cards in launch flow.
- Store recent launch combos separately from recent visited sessions:

```ts
type RecentLaunch = {
  hostId: string;
  path: string;
  provider: "codex" | "claude_code";
  tmuxTarget?: string;
  title?: string;
  usedAt: string;
};
```

10. Pull launch defaults out of the giant settings page.

Files:

- `apps/dashboard/src/components/settings/SettingsPanel.tsx`
- `apps/dashboard/src/components/settings/SettingsQuickPanel.tsx`

Why:

- Dev folders, default provider, and default template directly affect mobile launch speed.
- They are buried under alerts/visualizer settings and absent from quick settings.

Recommendation:

- Add a compact "Launch defaults" quick settings section.
- Wire `SessionGenerator`'s existing `onOpenSettings` path through callers.

11. Make launch target selection thumb-first.

Plan:

- Machine chips at top.
- Two primary provider buttons: Codex and Claude.
- Recent repos as one-tap rows.
- Optional prompt textarea collapsed by default.
- Launch button sticky at bottom.

### Accelerate

12. Add a persistent mobile launch/open rail outside `/tmux`.

Files:

- `apps/dashboard/src/app/(dashboard)/layout.tsx`
- `apps/dashboard/src/components/layout/GlobalSidebar.tsx`
- `apps/dashboard/src/components/layout/QuickSpawn.tsx`
- `apps/dashboard/src/components/layout/RecentSessions.tsx`

Why:

- Mobile launch/reopen currently sits behind the hamburger drawer.
- The repeated workflow should be one tap to launch or reopen recent tmux/Codex/Claude.

Recommendation:

- Add a bottom mobile rail with `New`, `Recent`, and `tmux`.
- Reuse `QuickSpawn` and `RecentSessions` link construction.

13. Land directly in terminal mode.

Current:

- Spawns navigate to `/sessions/:id` or group.

Plan:

- For mobile launch, navigate to:

```text
/tmux?host_id=<host>&session_id=<session>&mode=terminal&attach=1
```

- Add optional `mode` parsing to `TmuxMobileShell`.
- Add safe auto-attach only when query contains `attach=1` and the session was just launched by the operator.

### Automate

14. Add a "Use last launch" path.

Plan:

- On `/tmux` mobile header, add a plus button.
- First tap opens launch sheet.
- If a last launch exists, show "Repeat: Codex in agent-command on heavisidelinux."

## Agentd Findings

### Keep

1. Existing tmux command primitives.

Files:

- `agents/agentd/internal/tmux/tmux.go`

Useful operations already exist:

- list panes
- capture pane
- send input
- chunked send input
- pane metadata

### Improve

2. Make launch result explicit.

Problem:

- Control-plane creates a `STARTING` session and sends `spawn_session`.
- Mobile wants to know when the target pane is real and attachable.

Plan:

- Ensure agentd command result for `spawn_session` includes:
  - `session_id`
  - `tmux_pane_id`
  - `tmux_target`
  - `host_id`
  - `provider`
  - `cwd`
  - `started_command`

3. Add an optional initial prompt primitive.

Options:

- Include `initial_input` in `SpawnSessionPayloadSchema`.
- Or keep spawn pure and have control-plane call `send_input` after `waitForSessionReady`.

Recommendation:

- Keep spawn pure.
- Implement initial prompt in launch workflow as:
  1. spawn
  2. wait for pane
  3. send input with `enter=true`

This keeps agentd simpler and uses existing `send_input`.

4. Add "open existing tmux target" primitive if adoption is not enough.

Existing:

- Sessions can represent discovered tmux panes.
- `adopt_pane` exists as command payload.

Need:

- API should open by host alias plus tmux target, then return session id.
- If pane is already tracked, return existing session.
- If untracked but visible to agentd, adopt it.

## Schema And Test Findings

### Simplify

1. Promote launch contracts to schema.

Add to `packages/ac-schema/src/launch.ts`:

- `LaunchTargetSchema`
- `LaunchRequestSchema`
- `LaunchResponseSchema`
- `RecentLaunchSchema`

Export from `packages/ac-schema/src/index.ts`.

2. Reuse provider enum but narrow mobile UI choices.

Schema can keep all providers. Mobile launch UI should default to Codex/Claude.

### Accelerate

3. Add focused verification command.

Add script:

```bash
pnpm verify:launch
```

Should run:

- schema tests for launch contracts
- control-plane launch route tests
- dashboard mobile launch smoke test
- agentd spawn/open fixture test if protocol changes

### Automate

4. Add protocol fixtures for launch-related command results.

Add fixtures:

- `spawn-session-result-ready.json`
- `spawn-session-result-error.json`
- `send-input-initial-prompt.json`

Validate in TS and Go.

## Recommended Product Flow

### Mobile `/tmux` Header

Add a plus button in mobile tmux header:

- Label for screen readers: `Launch agent`.
- Opens `MobileLaunchSheet`.

### Launch Sheet

Default view:

1. Machine chips:
   - `heavisidelinux`
   - `homelinux`
   - any other online host
2. Recent projects:
   - `agent-command`
   - other recently touched projects
3. Provider segmented control:
   - Codex
   - Claude
4. Optional prompt:
   - collapsed by default
5. Sticky action:
   - `Launch Codex`
   - `Launch Claude`

Advanced section:

- custom path
- tmux session name
- window name
- flags
- group/link options

### Open Existing

From roster:

- Tap pane -> terminal.
- Long press pane -> actions.

From launch sheet:

- "Open existing" tab lists recent tracked tmux panes grouped by machine.
- Selecting one navigates to `/tmux?...&mode=terminal`.

### Launch New

Sequence:

1. `GET /v1/launch/targets`
2. User picks machine/repo/provider.
3. `POST /v1/launch`
4. Backend spawns and waits briefly.
5. Response returns `/tmux?host_id=...&session_id=...&mode=terminal&attach=1`.
6. Dashboard navigates.
7. Terminal attaches if safe auto-attach conditions are met.

## Implementation Plan

### Phase 1: Policy And Backend Foundation

Tasks:

1. [x] Add `packages/ac-schema/src/launch.ts`.
2. [x] Add `GET /v1/launch/targets`.
3. [x] Add `POST /v1/launch`.
4. [x] Add route tests for:
   - viewer forbidden for launch
   - offline host
   - provider unsupported
   - spawn support disabled
   - wait returns ready when session gets `tmux_pane_id`
   - optional initial prompt sends `send_input` after ready
5. [x] Restrict generic command dispatch for privileged commands.
6. [x] Extend `CommandRouter` to support host-scoped commands.
7. [x] Move host directory pending-result handling out of `hosts.ts`.

Exit criteria:

- Mobile can get all launch target data in one call.
- Launch can return an openable tmux session or a clear non-ready status.
- Generic command dispatch no longer bypasses spawn/provider capability policy.

### Phase 2: Mobile Launch UI

Tasks:

1. [x] Add `apps/dashboard/src/hooks/useLaunchTargets.ts`.
2. [x] Add `apps/dashboard/src/components/launch/MobileLaunchSheet.tsx`.
3. [x] Add mobile plus button to `TmuxMobileShell`.
4. [x] Add recent project rows and host chips.
5. [x] Add Codex/Claude segmented provider control.
6. [x] Add optional prompt textarea.
7. [x] Add sticky Launch button.
8. [x] On success, navigate to `/tmux?host_id=...&session_id=...&mode=terminal&attach=1`.

Exit criteria:

- Phone user can launch Codex or Claude into a repo in 3-5 taps.
- Launch sheet is usable without browsing a directory tree.
- Advanced fields are available but not primary.

### Phase 3: Open Existing Tmux

Tasks:

1. [x] Add `POST /v1/tmux/open`.
2. Request shape:

```ts
{
  host_id?: string;
  host_alias?: string;
  tmux_target?: string;
  pane_id?: string;
}
```

3. [x] Behavior:
   - If matching session exists, return it.
   - If visible but untracked, adopt it.
   - If not found, return 404 with useful message.
4. [x] Add "Open existing" tab in mobile launch sheet for tracked panes.
5. [x] Add manual target/pane id open from the mobile launch sheet.

Exit criteria:

- User can open an existing tmux pane on either machine without finding its DB session first.

### Phase 4: Terminal Landing

Tasks:

1. [x] Add `mode=terminal` query support.
2. [x] Add `attach=1` safe auto-attach support.
3. [x] Replace browser `CustomEvent` terminal action bridge with explicit terminal controller/provider.
4. [x] Split `TerminalView` into:
   - [x] connection hook
   - [x] xterm hook
   - [x] clipboard hook
   - [x] touch-scroll hook
   - [x] toolbar component
   - [x] surface component

Exit criteria:

- New launch lands directly in mobile terminal mode.
- Terminal actions are typed and explicit.
- `TerminalView` is no longer the main complexity sink.

### Phase 5: Recents And Defaults

Tasks:

1. [x] Add server-side `RecentLaunch` store.
2. [x] Save successful launch combos locally as a first pass.
3. [x] Add repeat-last-launch affordance.
4. Add settings:
   - [x] default mobile launch provider
   - [x] default mobile launch machine
   - [x] default tmux target/session name
5. [x] Use server-side recent projects and recent launches before local-only recents.

Exit criteria:

- Common launches become one or two taps.
- Defaults are predictable across devices when settings sync is enabled.

### Phase 6: Verification And Docs

Tasks:

1. [x] Add Playwright mobile smoke:
   - open `/tmux`
   - open launch sheet
   - select host/project/provider
   - launch
   - assert navigation to terminal mode
2. [x] Add control-plane launch tests.
3. [x] Add schema tests.
4. Add protocol fixtures if command result shape changes.
5. [x] Update:
   - `docs/api.md`
   - `docs/tmux-manager.md`
   - `docs/mobile-launch.md` or equivalent
6. [x] Add `pnpm verify:launch`.

Exit criteria:

- Launch workflow has a fast local verification path.
- Docs describe actual mobile launch behavior.

## Highest-Leverage Next Action

Start with Phase 1:

1. Add launch schemas.
2. Add `GET /v1/launch/targets`.
3. Add `POST /v1/launch` that wraps existing `spawnSessionOnHost`, waits briefly for readiness, and optionally sends initial prompt.

Do not start by polishing the mobile UI. The UI becomes much simpler once the backend returns a workflow-shaped launch response.

## Open Questions

- Should host aliases be manually editable, or derived from `name`/`tailscale_name` only?
- Should quick launch default tmux session name be the repo name, `agents`, or a user setting?
- Should initial prompt be sent automatically after spawn, or should terminal open first and show a "Send prompt" confirmation?
- Should mobile auto-attach be limited to newly launched sessions only?
- Should "open existing" adopt unmanaged panes automatically or ask first?

## Risks

- Auto-sending prompts can put text into the wrong pane if readiness detection is weak.
- Auto-attach can surprise the operator if it steals control from another browser.
- Host alias conflicts need deterministic resolution.
- One-click launch increases blast radius of provider/capability policy bugs.

## Validation Commands

Initial expected verification:

```bash
pnpm verify:launch
```

After Docker-impacting changes:

```bash
pnpm build
docker build -f deploy/Dockerfile.dashboard.base -t agent-commander-dashboard .
docker build -f deploy/Dockerfile.control-plane.base -t agent-commander-control-plane .
```
