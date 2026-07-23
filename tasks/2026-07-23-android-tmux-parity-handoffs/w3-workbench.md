---
lane: W3-WORKBENCH
branch: feat/android-tmux-parity-w3
base: 0168aee
implementation_sha: 8741a15bbd9d3f8fc207499305088c427f3cb4f1
status: frozen
review: pending fresh-context review
---

# W3 Android native workbench handoff

## Outcome

- Replaced the flat pane list with one compact raw-View host → tmux session → window → pane navigator shared by the roster and a full-screen in-terminal dialog. It includes search, an online-host filter, attachability, host/session/window/pane status, activity/bell/zoom indicators, path/command context, and available snapshots.
- Live `tmux.topology` events update the accepted W2 `TmuxRoster` in both navigator surfaces. Live-only nodes stay visible and searchable but disabled until durable attach coordinates exist.
- Added transactional target selection through `WorkbenchNavigation`. Same-host/same-tmux-session selection keeps the existing `TerminalSocket`, leaves the active pane/title unchanged, fences input, and adopts the candidate only after the existing W1 authority state receives the exact pane+zoom acknowledgement. Cross-session/host selection clears resume identity and creates a fresh attachment.
- Validates the persisted last target against all stable W2 roster coordinates before cold restore. Stale target identity is cleared. Exact acknowledged targets are persisted.
- Added fixed/expanded terminal key rails with Esc, one-shot Ctrl, Tab, Shift-Tab, arrows, Page Up/Down, Home/End, Enter, keyboard toggle, paste, and per-host configured tmux prefix. Font size, rail mode, prefix, and last validated target use `AppPreferenceStore`.
- Added selectable server-history UI with ranged backward paging, stable ordering, local search, copy-visible, copy-last-50, copy-all, and an explicit return-to-live action. No controller check blocks history.
- Added a paged/searchable Claude transcript UI and exact prompt+Enter dispatch. Prompt dispatch is allowed only when that pane is the verified writable current pane and the command-result stream is connected; REST acceptance remains pending until the correlated result, and exact agent failures are shown.
- Added canonical existing-target open/adoption and browser handoff to the authenticated web workbench. No native general launch form was added.
- Terminal status now distinguishes connecting/resuming/reconnecting, switching, reconciliation, read-only, interactive, detached, and exact failure states. `Take Control` remains fixed outside scrolling rails.

## Acceptance mapping

- **NAV-1 / NAV-4:** `RosterNavigatorView` presents the global multi-host hierarchy and W2 search/status/snapshot/live context. Host reachability continues through the single public Agent Command transport.
- **NAV-2:** `WorkbenchNavigation` chooses viewer reuse only for the same host and tmux session. Candidate state is provisional until exact W1 `ViewerResolution.Converged`; cross-session/host uses `showTerminal(..., freshAttachment = true)`.
- **NAV-3:** Cold restore uses `LastTargetPreference.resolve`; explicit roster return is fixed in the terminal header; the Open action uses `AgentCommandApi.openTmuxTarget` for managed or unmanaged existing targets.
- **READ-2:** `ScrollbackReaderState` and the history screen cover older ranged paging, deterministic order/search, selectable contiguous text, and visible/last-50/all copy with clear return-to-live.
- **READ-3:** Live visible copy remains on the Termux renderer. The fixed rail exposes paste and an explicit keyboard-paste message when Android clipboard content is unavailable.
- **READ-4:** Claude panes expose paged, locally searchable formatted transcript history and command-result-correlated exact prompt+Enter sending through the verified current writable pane only.
- **KEY-1:** `TerminalKeyEncoder` plus fixed/expanded rails cover every required key and per-host prefix; W1 one-shot Ctrl remains the input modifier.
- **ZOOM-1:** A−/A+, pinch, and persisted font size remain independent of the existing acknowledged pane zoom/unzoom transaction.
- **APP-1:** W2 `AppPreferenceStore` now drives font, rail mode, host prefix, and validated target in the Activity; credentials remain only in `SecureStore`.
- **APP-2:** Web launch opens the signed-in endpoint root, where the existing mobile launch flow remains owned.
- **TERM-5 (W3 status portion):** Connecting, resuming/reconnecting, switching, reconciling, read-only, interactive, detached, and failed labels are explicit; prompt/focus failures retain actionable messages.
- **TERM-1/2/3/4 and READ-1 preservation:** W1 `ViewerAuthority`, one socket/renderer, input gating, always-visible control, local/remote scroll routing, resume, auth, and Samsung IME paths were retained.

## Focused pure test delta

New:

- `WorkbenchNavigationTest` (3): provisional same-session selection/exact adoption, cross-session/host fresh-attachment decision, and valid-versus-stale last-target preference resolution.
- `TerminalKeyEncoderTest` (2): practical control sequences, application cursor mode, and configured tmux prefixes.

Changed:

- `HistoryPagingTest` (+1, suite total 3): initial/older ranges, stable local search order, and older-history exhaustion.

Red/green receipts:

- `WorkbenchNavigationTest`: RED on unresolved `WorkbenchNavigation`/actions; GREEN after the transaction seam.
- `TerminalKeyEncoderTest`: RED on unresolved encoder/key types; GREEN after exact sequence encoding.
- `HistoryPagingTest`: RED on unresolved `ScrollbackReaderState`; GREEN after ranged reader state.
- Last-target validation was added as the third `WorkbenchNavigationTest`: RED on unresolved `LastTargetPreference`; GREEN after exact roster validation and stale clearing.

Focused preservation command:

```bash
ANDROID_HOME=/home/cvsloane/android-sdk ./gradlew testDebugUnitTest \
  --tests com.heaviside.agentcommand.domain.WorkbenchNavigationTest \
  --tests com.heaviside.agentcommand.terminal.TerminalKeyEncoderTest \
  --tests com.heaviside.agentcommand.domain.HistoryPagingTest \
  --tests com.heaviside.agentcommand.domain.AppPreferencesTest \
  --tests com.heaviside.agentcommand.terminal.ViewerAuthorityTest \
  --tests com.heaviside.agentcommand.terminal.TerminalScrollRoutingTest
```

Result: `BUILD SUCCESSFUL`.

## Frozen Android gate

Run once on the frozen implementation:

```bash
ANDROID_HOME=/home/cvsloane/android-sdk ./gradlew test lint assembleRelease
```

Result:

- `BUILD SUCCESSFUL`
- 35/35 debug unit tests passed.
- 35/35 release unit tests passed.
- Android lint passed with zero errors and 34 warnings. Warnings are non-blocking dependency/manifest/accessibility/localization items plus the programmatic-only `RosterNavigatorView` XML-constructor warning.
- Unsigned release assembly passed.
- `app-release-unsigned.apk`: 2,309,930 bytes.
- SHA-256: `f2973953ed750c1ddc6113cfac757a38ef318ec78b657340fd1fd72bc19a08d4`.
- `git diff --check`: passed before freeze.

## Changed paths

- `apps/android/app/src/main/java/com/heaviside/agentcommand/MainActivity.kt`
- `apps/android/app/src/main/java/com/heaviside/agentcommand/domain/ClaudeTranscriptFormatter.kt`
- `apps/android/app/src/main/java/com/heaviside/agentcommand/domain/HistoryPaging.kt`
- `apps/android/app/src/main/java/com/heaviside/agentcommand/domain/WorkbenchNavigation.kt`
- `apps/android/app/src/main/java/com/heaviside/agentcommand/terminal/RemoteTerminalView.kt`
- `apps/android/app/src/main/java/com/heaviside/agentcommand/terminal/TerminalKeyEncoder.kt`
- `apps/android/app/src/main/java/com/heaviside/agentcommand/ui/RosterNavigatorView.kt`
- `apps/android/app/src/test/java/com/heaviside/agentcommand/domain/HistoryPagingTest.kt`
- `apps/android/app/src/test/java/com/heaviside/agentcommand/domain/WorkbenchNavigationTest.kt`
- `apps/android/app/src/test/java/com/heaviside/agentcommand/terminal/TerminalKeyEncoderTest.kt`

## Deferred boundaries

- W4 still owns window/pane create, rename, close, split, directional focus, and kill/archive mutations.
- No backend/schema, renderer, transport, Compose, notification, native general-launch, retry layer, instrumentation harness, signing, distribution, or production file changed.
- Final interaction/visual proof remains the planned Samsung acceptance after W4/W5 integration.
