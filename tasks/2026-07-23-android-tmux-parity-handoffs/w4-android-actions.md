---
lane: W4-ANDROID-ACTIONS
branch: feat/android-tmux-parity-w4-ui
base: 8076f235cdec5a0ed3e6ae3613c619bb9d445539
implementation_sha: 3f3c823d1d604361745a88f58c15ea2ec541f089
review_correction_sha: 1dd1bae3334524ea9e7ce896f0f7d3f4cd6f980d
final_review_correction_sha: b3123b12c2fd3275438fc40357cc19ec0d802966
ordering_review_correction_sha: 6a95740a8344414f867a7697ddf1f5e9e98e64ab
status: frozen after final ordering review correction
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
- Rename and close register exact topology expectations. New and split require a correlated successful command result and retain its exact `pane_id`, but do not open it immediately. Android correlates the exact persisted host/pane identity on `sessions.changed` whether that signal arrives before or after `commands.result`, performs one canonical roster refresh, validates the durable session/host/pane/target, adopts an unmanaged pane through `POST /v1/tmux/open` only when needed, and then transactionally focuses it. The pane, title, and preferences change only after exact viewer focus succeeds; REST acceptance remains pending and no pane/index is fabricated.
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

New before review:

- `TmuxLifecycleActionsTest` (4): action-to-transport routing, exact command JSON, topology versus exact-result completion policy, explicit viewer focus, dedicated terminate transport, confirmation copy, and conservative percent capability.
- `SpatialPaneNavigationTest` (2): tmux leaf parsing, real spatial direction, incomplete-layout fallback, and no wrap.

Changed before review:

- `AgentCommandContractTest` (+1, suite total 13): single-item bulk terminate request and successful/failed completion response.
- `TmuxCommandTrackerTest` (+1, suite total 6): successful exact results retain the created pane identity.

Focused RED receipts were unresolved lifecycle action symbols, unresolved spatial parser/selector symbols, unresolved bulk terminate request/parser symbols, and unresolved `Succeeded.resultJson`. Each slice passed after its corresponding minimal implementation.

Fresh-context review correction:

- `TmuxLifecycleActionsTest` (+1): a created pane is adoptable only when canonical open succeeds and returns the exact current-host pane/session/target.
- `AgentCommandContractTest` (+1, suite total 14): canonical created-pane adoption sends only `host_id` plus the exact returned `pane_id`; it cannot silently fall back to target or alias.
- RED receipt: the focused correction test failed on unresolved `CreatedPaneAnchor`; it passed after the exact durable-open anchor was implemented.
- Both viewer-resolution timeout exits now use the same failure helper. The helper clears pending lifecycle viewer state, rejects the focus candidate, releases the mutation lock, and surfaces the failure. The same helper owns direct focus dispatch/resolution failures, preventing a timeout-specific stale-lock path. No instrumentation-only harness was added for private activity state.

Final persistence-race correction:

- Android now subscribes to the existing `sessions` UI-stream topic and parses only a bounded 128-item `sessions.changed` tmux-pane identity signal. Unrelated session changes have no Android roster side effect.
- Created-pane state proves the path starts in `WaitForPersistence`, ignores unrelated changes, accepts only the exact host/pane event and persisted session ID, triggers one roster refresh, conditionally opens an unmanaged pane, and stays pending until correlated focus completes.
- A 10-second persistence timeout fails the lifecycle operation and releases both the adoption state and lifecycle mutation lock. There is no polling, retry, backoff, fallback target, or second implementation.
- `UiStreamContractTest` (+1, suite total 3): bounded exact signal parsing and the `sessions` subscription.
- `TmuxLifecycleActionsTest` (+2, suite total 7): no immediate open, event-driven exact durable adoption, and timeout lock release.
- RED receipts: unresolved `SessionsChangedEvent`/bounded signal symbols, then a missing `sessions` topic; unresolved `CreatedPaneAdoptionState`/actions. Each slice passed after its minimal implementation.

Final event-ordering correction:

- The same pure created-pane coordinator now retains only the 128 most recent deduplicated `(sessionId, hostId, paneId)` persistence identities while no adoption is active. `begin` consumes an exact early host/pane match and returns the existing `RefreshRoster` action; it does not introduce another adoption path.
- Success, failure, timeout, and explicit lifecycle teardown clear both pending state and retained signals. Unrelated signals never trigger refresh or adoption.
- `TmuxLifecycleActionsTest` (+2, suite total 9): event-before-begin proceeds through exact adoption, retention evicts the oldest identity at 128, and teardown clears retained identity. Existing event-after-begin and timeout regressions remain green.
- RED receipts: event-before-begin returned `WaitForPersistence` instead of `RefreshRoster`; teardown-clear coverage then failed on the missing `clear` transition. Both passed after the bounded correlation state was added.

Focused preservation command:

```bash
ANDROID_HOME=/home/cvsloane/android-sdk ./gradlew testDebugUnitTest \
  --tests com.heaviside.agentcommand.domain.TmuxLifecycleActionsTest \
  --tests com.heaviside.agentcommand.domain.SpatialPaneNavigationTest \
  --tests com.heaviside.agentcommand.data.AgentCommandContractTest \
  --tests com.heaviside.agentcommand.data.UiStreamContractTest \
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
- 52/52 debug unit tests passed.
- 52/52 release unit tests passed.
- Android lint passed with zero errors and 34 warnings.
- Unsigned release assembly passed.
- `app-release-unsigned.apk`: 2,340,634 bytes.
- SHA-256: `727c522c567bdb35d376fc80a64cd8dad34d719da8e49e091ac482534281190a`.
- `git diff --check`: passed before freeze.

## Changed paths

- `apps/android/app/src/main/java/com/heaviside/agentcommand/MainActivity.kt`
- `apps/android/app/src/main/java/com/heaviside/agentcommand/data/AgentCommandApi.kt`
- `apps/android/app/src/main/java/com/heaviside/agentcommand/data/Models.kt`
- `apps/android/app/src/main/java/com/heaviside/agentcommand/data/TmuxApiModels.kt`
- `apps/android/app/src/main/java/com/heaviside/agentcommand/data/UiStreamModels.kt`
- `apps/android/app/src/main/java/com/heaviside/agentcommand/data/UiStreamSocket.kt`
- `apps/android/app/src/main/java/com/heaviside/agentcommand/domain/SpatialPaneNavigation.kt`
- `apps/android/app/src/main/java/com/heaviside/agentcommand/domain/TmuxCommandTracker.kt`
- `apps/android/app/src/main/java/com/heaviside/agentcommand/domain/TmuxLifecycleActions.kt`
- `apps/android/app/src/test/java/com/heaviside/agentcommand/data/AgentCommandContractTest.kt`
- `apps/android/app/src/test/java/com/heaviside/agentcommand/data/UiStreamContractTest.kt`
- `apps/android/app/src/test/java/com/heaviside/agentcommand/domain/SpatialPaneNavigationTest.kt`
- `apps/android/app/src/test/java/com/heaviside/agentcommand/domain/TmuxCommandTrackerTest.kt`
- `apps/android/app/src/test/java/com/heaviside/agentcommand/domain/TmuxLifecycleActionsTest.kt`

No backend, shared schema, renderer, transport, native launch, retry, harness, signing, deployment, or production file changed.

## Acceptance mapping

- **WIN-1:** The authoritative action dialog exposes active/activity/bell window state and acknowledged selection through the existing correlated viewer focus path, with exact fallback topology truth only when no pane exists.
- **WIN-2:** New/rename/close are available, every close is confirmed, the live single-window case warns that the whole tmux session ends, exact completion is shown, and the roster reconciles after success or failure.
- **PANE-1:** Both split directions, spatial direction controls, explicit focus/unfocus, and confirmed tracked-pane terminate/archive are present. Live-only destructive controls are disabled.
- **PANE-2:** Generic REST acceptance remains pending in `TmuxCommandTracker`; exact agent errors are retained; new/split correlate exact persisted identity in either event order before a single canonical refresh and conditional adoption; dedicated terminate trusts only the reviewed completion response; duplicate mutation is disabled until reconciliation finishes, including persistence and viewer-resolution timeout/failure exits.
- **REG-1 / REG-2:** Focused and full Android gates pass. No adjacent platform, release, renderer, backend, or schema scope was added.

Integration, signed artifact, live public-path proof, and final Samsung interaction proof remain AI Lead/W5-owned. No true wall was encountered.
