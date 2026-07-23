---
lane: W4-ANDROID-ACTIONS
branch: feat/android-tmux-parity-w4-ui
base: 8076f235cdec5a0ed3e6ae3613c619bb9d445539
implementation_sha: 3f3c823d1d604361745a88f58c15ea2ec541f089
status: frozen for fresh-context review
acceptance:
  - WIN-1
  - WIN-2
  - PANE-1
  - PANE-2
blockers: []
---

# W4 Android window and pane lifecycle handoff

## Outcome

- Added one phone-native `Window & pane actions` dialog for the current W1-authoritative viewer pane. It names the live host/session/window/pane, active/activity/bell state, tracked versus live-only authority, and explicit zoom state.
- Window controls select a requested window through correlated W1 viewer focus of its active or first pane. A no-pane fallback uses `select_window` with an exact active-window topology expectation. New, rename, and close use the existing generic command API and W2 tracker.
- Pane controls provide horizontal/vertical split, spatial left/up/down/right selection, explicit focus/zoom and unfocus/unzoom, and confirmed tracked-pane terminate/archive. Select, directional navigation, focus, and unfocus all use `{op:"focus_pane", pane_id, zoom}` through W1 authority and viewer-state reconciliation. Android never calls the raw toggle-style REST `zoom_pane`.
- Rename and close register exact topology expectations. New and split require a correlated successful command result, retain `resultJson`, read the returned `pane_id`, and focus that exact pane without fabricating an index. REST acceptance is displayed only as pending.
- Every close is confirmed. The stronger “ends the whole tmux session” copy appears only when a live topology session proves exactly one window. Pane termination separately confirms that it kills the pane and archives its tracked session.
- Destructive close and terminate controls are disabled for a live-only authoritative pane. Capability/offline gating also prevents unsupported mutations.
- Ported compact tmux layout parsing and directional selection: half-plane filtering, perpendicular-overlap preference, nearest primary center/gap, and deterministic tie-breaking. Incomplete layouts use pane-index previous/next with no wrap.
- Added the Android single-item `POST /v1/sessions/bulk` terminate client. Only the reviewed bulk response (`success_count:1`, `error_count:0`, no matching error) is completion truth.
- Mutation buttons remain disabled from dispatch through command/terminate completion and authoritative roster reconciliation. Exact result, failure code/message, reconciliation failure, and success are surfaced in the dialog.
- Canonical roster reloads retain the latest per-host live topology snapshots so command completion reconciliation does not erase live-only membership.

## Contract decisions

- The current host contract does not guarantee a tmux version. Android preserves optional `capabilities.tmux_version`, `capabilities.tmuxVersion`, or top-level `tmux_version` and includes `percent:50` only when that value proves tmux 3.1 or newer. Otherwise the split omits percent, matching the web policy.
- The existing agent `zoom_pane` command toggles state and cannot satisfy explicit unfocus safely. W4 therefore uses only W1 correlated explicit viewer focus with `zoom=true|false`; no backend/schema change was made.

## Focused regression delta

New:

- `TmuxLifecycleActionsTest` (4): action-to-transport routing, exact command JSON, topology versus exact-result completion policy, explicit viewer focus, dedicated terminate transport, confirmation copy, and conservative percent capability.
- `SpatialPaneNavigationTest` (2): tmux leaf parsing, real spatial direction, incomplete-layout fallback, and no wrap.

Changed:

- `AgentCommandContractTest` (+1, suite total 13): single-item bulk terminate request and successful/failed completion response.
- `TmuxCommandTrackerTest` (+1, suite total 6): successful exact results retain the created pane identity.

Focused RED receipts were unresolved lifecycle action symbols, unresolved spatial parser/selector symbols, unresolved bulk terminate request/parser symbols, and unresolved `Succeeded.resultJson`. Each slice passed after its corresponding minimal implementation.

Focused preservation command:

```bash
ANDROID_HOME=/home/cvsloane/android-sdk ./gradlew testDebugUnitTest \
  --tests com.heaviside.agentcommand.domain.TmuxLifecycleActionsTest \
  --tests com.heaviside.agentcommand.domain.SpatialPaneNavigationTest \
  --tests com.heaviside.agentcommand.data.AgentCommandContractTest \
  --tests com.heaviside.agentcommand.domain.TmuxCommandTrackerTest \
  --tests com.heaviside.agentcommand.terminal.ViewerAuthorityTest
```

Result: `BUILD SUCCESSFUL`.

## Frozen Android gate

```bash
ANDROID_HOME=/home/cvsloane/android-sdk ./gradlew test lint assembleRelease
```

Result:

- `BUILD SUCCESSFUL`
- 45/45 debug unit tests passed.
- 45/45 release unit tests passed.
- Android lint passed with zero errors and 34 warnings.
- Unsigned release assembly passed.
- `app-release-unsigned.apk`: 2,332,978 bytes.
- SHA-256: `31849c3a156e98c2dc3bdf715f8cda2554eea845e880830b5e1e837c1238166b`.
- `git diff --check`: passed before freeze.

## Changed paths

- `apps/android/app/src/main/java/com/heaviside/agentcommand/MainActivity.kt`
- `apps/android/app/src/main/java/com/heaviside/agentcommand/data/AgentCommandApi.kt`
- `apps/android/app/src/main/java/com/heaviside/agentcommand/data/Models.kt`
- `apps/android/app/src/main/java/com/heaviside/agentcommand/data/TmuxApiModels.kt`
- `apps/android/app/src/main/java/com/heaviside/agentcommand/domain/SpatialPaneNavigation.kt`
- `apps/android/app/src/main/java/com/heaviside/agentcommand/domain/TmuxCommandTracker.kt`
- `apps/android/app/src/main/java/com/heaviside/agentcommand/domain/TmuxLifecycleActions.kt`
- `apps/android/app/src/test/java/com/heaviside/agentcommand/data/AgentCommandContractTest.kt`
- `apps/android/app/src/test/java/com/heaviside/agentcommand/domain/SpatialPaneNavigationTest.kt`
- `apps/android/app/src/test/java/com/heaviside/agentcommand/domain/TmuxCommandTrackerTest.kt`
- `apps/android/app/src/test/java/com/heaviside/agentcommand/domain/TmuxLifecycleActionsTest.kt`

No backend, shared schema, renderer, transport, native launch, retry, harness, signing, deployment, or production file changed.

## Acceptance mapping

- **WIN-1:** The authoritative action dialog exposes active/activity/bell window state and acknowledged selection through the existing correlated viewer focus path, with exact fallback topology truth only when no pane exists.
- **WIN-2:** New/rename/close are available, every close is confirmed, the live single-window case warns that the whole tmux session ends, exact completion is shown, and the roster reconciles after success or failure.
- **PANE-1:** Both split directions, spatial direction controls, explicit focus/unfocus, and confirmed tracked-pane terminate/archive are present. Live-only destructive controls are disabled.
- **PANE-2:** Generic REST acceptance remains pending in `TmuxCommandTracker`; exact agent errors are retained; new/split use returned pane IDs; dedicated terminate trusts only the reviewed completion response; duplicate mutation is disabled until reconciliation finishes.
- **REG-1 / REG-2:** Focused and full Android gates pass. No adjacent platform, release, renderer, backend, or schema scope was added.

Fresh-context review, integration, signed artifact, live public-path proof, and final Samsung interaction proof remain AI Lead/W5-owned. No true wall was encountered.
