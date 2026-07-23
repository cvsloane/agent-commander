---
lane: W2-DOMAIN
branch: feat/android-tmux-parity-w2
frozen_sha: af01e43deea788d5b1980dbc5b17b4122569a42d
acceptance:
  - NAV-1
  - NAV-2
  - NAV-3
  - NAV-4
  - READ-2
  - READ-4
  - PANE-2
  - APP-1
gate:
  command: ANDROID_HOME=/home/cvsloane/android-sdk ./gradlew test lint assembleRelease
  status: passed
  results:
    - "26/26 debug unit tests passed"
    - "26/26 release unit tests passed"
    - "Android lint passed"
    - "Unsigned release assembly passed"
    - "app-release-unsigned.apk: 2,273,554 bytes; SHA-256 1a094992060493b14600aac1eca21b302a2982c3021477ba188c37d4806194de"
blockers: []
---

# W2 Android domain/API handoff

## Outcome

- `AgentCommandApi.loadTopology()` now reads the canonical global `/v1/tmux/roster` exactly once after the host-presence read; it no longer issues one roster request per host.
- The roster parser retains host presence/capability fields and useful pane status, activity, attention, cwd/repo/branch, tmux-process, unmanaged, and available snapshot metadata.
- `TmuxRoster` deterministically models host → tmux session → window → pane, supports stable multi-term search and host/provider/status/online filters, and validates a restored target against all stable coordinates.
- A topology event now authoritatively replaces session/window/pane membership for its host while preserving other hosts. Matching pane IDs retain durable roster metadata; live-only panes remain represented and searchable by live title, command, and path, but are explicitly non-attachable until a durable session ID is available.
- Typed REST clients/models cover existing-target open/adoption, bounded visible/last/range/full scrollback, paged transcript capture, prompt input, and generic tmux command dispatch.
- `UiStreamSocket` uses the existing zero-byte/bodyless one-time-ticket exchange, subscribes to only `commands.result` and `tmux.topology`, and parses their complete W2 contract fields. It adds no retry or fallback path.
- `TmuxCommandTracker` treats the REST `{cmd_id}` as pending. It completes only from a host/session-correlated command result or a caller-declared authoritative topology expectation, retains exact agent errors, and handles a result that beats REST registration.
- `AppPreferenceStore` keeps font size, fixed/expanded rail mode, sorted per-host prefixes, and the last validated target in a separate app-private non-secret preference file. Access codes remain exclusively in the existing Keystore-backed `SecureStore`.
- Added the W1-requested additive `TerminalSocket.viewerState(): String?`, which sends a UUID-correlated `{type:"navigate", op:"viewer_state", request_id}` message.

## Focused regression coverage

- `AgentCommandContractTest` (12): HTTPS/ticket compatibility, credential redaction, global roster metadata parsing, open/scrollback/transcript/command contracts, bounded remote scroll, viewer-state request.
- `UiStreamContractTest` (2): command-result/topology parsing and ticket-only subscription.
- `TmuxRosterTest` (5): deterministic hierarchy, search/filter/snapshot preservation, restored-target validation, authoritative live membership reconciliation, live-only pane representation, and live-field search.
- `HistoryPagingTest` (2): contiguous older scrollback ordering/filter/copy and transcript ordering/cursors.
- `TmuxCommandTrackerTest` (4): pending acceptance, exact failure, early-result race, topology truth.
- `AppPreferencesTest` (1): process-recreation round trip, deterministic prefixes, clear behavior, and absence of credential fields.

## Checklist mapping

- **NAV-1 / NAV-4:** Global multi-host roster consumption, deterministic hierarchy/search/filter helpers, host presence, pane status/activity/snapshot context, and authoritative per-host live topology reconciliation are source-backed. Phone presentation remains W3-owned.
- **NAV-2:** Typed live topology and command-result truth plus the additive viewer-state request are ready for W1/W3 switching integration. Live-only panes cannot fabricate attach coordinates; transactional UI wiring remains outside W2.
- **NAV-3:** Typed canonical tmux-open client plus persisted target and exact roster validation are complete; W3 owns when to save/restore and the explicit roster affordance.
- **READ-2:** Bounded range requests and pure backward-paging/order/search/contiguous-copy/copy-last/copy-all helpers are complete; W3 owns selection presentation and return-to-live UX.
- **READ-4:** Typed bounded transcript pages, older cursors, ordered/filterable history, and `TmuxCommand.sendInput` are complete; W3 must gate prompt sending on the verified writable pane.
- **PANE-2:** Dispatch acceptance is explicitly incomplete and the tracker requires correlated command-result or topology truth before success. W4 supplies the expectation appropriate to each mutation and handles rollback presentation.
- **APP-1:** App-private non-secret persistence covers every required field; exact target validation is separate from load so stale targets cannot be treated as live.
- **SEC-1 / REG-1 / REG-2:** No raw service credential was added to preferences or reports; Android unit/lint/release gates pass; no renderer, SSH transport, backend, schema, native-launch, retry, or fallback change was made.

## Changed paths

- `apps/android/app/src/main/java/com/heaviside/agentcommand/data/AgentCommandApi.kt`
- `apps/android/app/src/main/java/com/heaviside/agentcommand/data/Models.kt`
- `apps/android/app/src/main/java/com/heaviside/agentcommand/data/TmuxApiModels.kt`
- `apps/android/app/src/main/java/com/heaviside/agentcommand/data/UiStreamModels.kt`
- `apps/android/app/src/main/java/com/heaviside/agentcommand/data/UiStreamSocket.kt`
- `apps/android/app/src/main/java/com/heaviside/agentcommand/domain/AppPreferences.kt`
- `apps/android/app/src/main/java/com/heaviside/agentcommand/domain/HistoryPaging.kt`
- `apps/android/app/src/main/java/com/heaviside/agentcommand/domain/TmuxCommandTracker.kt`
- `apps/android/app/src/main/java/com/heaviside/agentcommand/domain/TmuxRoster.kt`
- `apps/android/app/src/main/java/com/heaviside/agentcommand/security/AppPreferenceStore.kt`
- `apps/android/app/src/test/java/com/heaviside/agentcommand/data/AgentCommandContractTest.kt`
- `apps/android/app/src/test/java/com/heaviside/agentcommand/data/UiStreamContractTest.kt`
- `apps/android/app/src/test/java/com/heaviside/agentcommand/domain/AppPreferencesTest.kt`
- `apps/android/app/src/test/java/com/heaviside/agentcommand/domain/HistoryPagingTest.kt`
- `apps/android/app/src/test/java/com/heaviside/agentcommand/domain/TmuxCommandTrackerTest.kt`
- `apps/android/app/src/test/java/com/heaviside/agentcommand/domain/TmuxRosterTest.kt`

`MainActivity.kt`, `terminal/**`, backend/schema, and production were untouched.

## Assumptions and deferred integration

- W3/W4 keep the UI stream connected before command dispatch, register the returned acceptance immediately, and retain pending UI until the tracker emits a terminal state.
- W4 selects the topology expectation matching each mutation. Commands without a topology expectation require `commands.result`.
- The documented roster currently omits snapshots; the Android parser preserves `latest_snapshot` when supplied. Live topology joins durable pane metadata only by matching pane ID, removes roster members omitted by the authoritative event for that host, and leaves live-only panes with optional metadata and `attachable = false`.
- Live public-path, integrated W1/W3/W4, signed-artifact, and physical Samsung acceptance remain later workstreams.

No true wall was encountered.
