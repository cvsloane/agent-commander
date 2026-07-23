# W1 — Interaction Authority and Scroll

- Status: frozen for integration
- Implementation commit: `5c98f3c246fb1ad0420e4fe9e6d97b17217363e8`
- Branch: `feat/android-tmux-parity-w1`
- Builder: W1 Android Builder
- Reviewer verdict: pending fresh-context review after W1+W2 integration

## Owned Changes

- `apps/android/app/src/main/java/com/heaviside/agentcommand/MainActivity.kt`
- `apps/android/app/src/main/java/com/heaviside/agentcommand/terminal/RemoteTerminalView.kt`
- `apps/android/app/src/main/java/com/heaviside/agentcommand/terminal/TerminalScrollRouting.kt`
- `apps/android/app/src/main/java/com/heaviside/agentcommand/terminal/ViewerAuthority.kt`
- `apps/android/app/src/test/java/com/heaviside/agentcommand/terminal/TerminalScrollRoutingTest.kt`
- `apps/android/app/src/test/java/com/heaviside/agentcommand/terminal/ViewerAuthorityTest.kt`

No data model, API implementation, backend, shared contract, auth, release, or production file was changed.

## Acceptance Mapping

- **TERM-1:** `ViewerAuthority` represents connection state, desired/authoritative pane plus zoom, and controller ownership independently. Focus is correlated for writable and read-only attachments. A five-second lost-focus timeout issues a separately correlated `viewer_state`; only exact pane and zoom convergence enables input. Mismatch, protocol failure, send failure, or second timeout remains visible and non-writable.
- **TERM-2:** Existing public WSS socket, Termux emulator/renderer, resize, Samsung IME input connection, physical keyboard handling, paste, and one-shot control-key path remain in place. All outbound terminal input is now gated by verified viewer convergence plus controller ownership.
- **TERM-3:** Read-only attachments still perform authoritative focus, keep local normal-buffer history usable, block input and remote application scroll, and expose a permanently visible `Take Control` button outside the horizontally scrolling toolbar.
- **TERM-4:** Background disconnect retains the existing resume token path; every fresh or resumed attachment repeats the correlated pane/zoom authority check. Explicit return to the roster removes reconnect callbacks and remains detached.
- **READ-1:** Normal-buffer gestures move the Termux `topRow` through its existing 5,000-row transcript regardless of control. Alternate-screen or mouse-tracked application gestures use the existing bounded `TerminalSocket.scroll` path only when the viewer is verified writable.
- **ZOOM-1 (interaction):** Font pinch/A−/A+ remains local to the renderer. Tmux pane zoom remains a distinct correlated pane-focus transaction and requires exact pane plus zoom acknowledgement or reconciled viewer truth.

## Test Delta and Receipts

New focused pure regressions:

- `ViewerAuthorityTest`: lost focus acknowledgement → correlated viewer-state convergence; read-only convergence remains non-writable until control; mismatched pane/zoom remains non-writable with authoritative state surfaced.
- `TerminalScrollRoutingTest`: normal history routes locally; alternate/mouse-tracked application scroll routes remotely only with control.

Red/green receipts:

- `ANDROID_HOME=/home/cvsloane/android-sdk ./gradlew testDebugUnitTest --tests com.heaviside.agentcommand.terminal.ViewerAuthorityTest`
  - RED: unresolved `ViewerAuthority`, `ViewerTarget`, and `ViewerResolution`.
  - GREEN: `BUILD SUCCESSFUL` (2 tests after the second vertical slice).
- `ANDROID_HOME=/home/cvsloane/android-sdk ./gradlew testDebugUnitTest --tests com.heaviside.agentcommand.terminal.TerminalScrollRoutingTest`
  - RED: unresolved routing seam, then missing mouse-tracking argument.
  - GREEN: `BUILD SUCCESSFUL`.
- `ANDROID_HOME=/home/cvsloane/android-sdk ./gradlew compileDebugKotlin`
  - Expected integration dependency only: unresolved `TerminalSocket.viewerState()` plus two inferred-type cascades.
  - No Termux view/API or other W1 compile error was reported.
- `git diff --check`
  - PASS before freeze.

## Declared Integration Dependency

W1 does not own `data/AgentCommandApi.kt`. W2 owns and has implemented the agreed additive method:

```kotlin
fun TerminalSocket.viewerState(): String?
```

It sends `{type:"navigate", op:"viewer_state", request_id}` with a generated correlation ID. The AI Lead directed W1 to freeze without cherry-picking W2. Therefore the full Android unit, lint, and release assembly gates are intentionally deferred to the first integrated W1+W2 commit and must run once there.

## Deferred / Physical Boundary

- Fresh-context Reviewer verdict is pending the frozen integrated diff.
- Samsung device proof for IME, touch direction/feel, resume, and zoom remains part of the final project device acceptance.
- No retry, fallback, endpoint, renderer, transport, Compose, harness, or production change was added.
