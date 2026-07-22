# Android Terminal Daily Driver — Acceptance Checklist

- Status: approved 2026-07-22T12:04:25-04:00
- Human Owner: Chris Sloane
- Project Plan: `tasks/2026-07-22-android-terminal-daily-driver-plan.md`

This checklist defines basic daily usefulness for a single-user internal app. It intentionally excludes enterprise repetition, soak, broad compatibility, and feature-parity gates.

## Mandatory Shared-Terminal Criteria

- [ ] **WEB-1 — Usable viewport:** On the production laptop path, attaching to a normal tmux session yields a meaningfully sized terminal rather than the observed one-row/nine-row failure.
- [ ] **WEB-2 — Meaningful terminal:** The production web terminal renders current pane content, accepts keyboard input, and displays resulting output.
- [ ] **WEB-3 — Scroll:** Live output and history/scrollback can be read without corrupting the active terminal.
- [ ] **WEB-4 — Transactional navigation:** Window/pane selection does not commit or accept input until tmux confirms the target; rejection/reconnect reconciles authoritative state.
- [ ] **WEB-5 — Launch preserved:** The existing web launch-new-session workflow still completes through its existing path.

## Mandatory Android Criteria

- [ ] **AND-1 — Installable artifact:** A signed APK builds reproducibly, verifies with Android signing tools, and installs on Chris's Samsung device.
- [ ] **AND-2 — Safe authentication:** The app authenticates without embedded or repository-stored credentials. Device secrets use Android Keystore; server-side values live in the Bitwarden `Agent Command` project.
- [ ] **AND-3 — No phone Tailnet requirement:** The app reaches Agent Command through its public HTTPS/WSS endpoint under ordinary mobile/laptop network conditions.
- [ ] **AND-4 — Existing topology:** The app lists available Agent Command hosts and existing tmux sessions/windows/panes using the shared backend model.
- [ ] **AND-5 — Attach and render:** Selecting an existing pane opens a native Termux-derived terminal and renders the current tmux/Claude view intelligibly.
- [ ] **AND-6 — Input:** Samsung Keyboard input, Enter, Backspace, common control keys, and ordinary paste reach the selected pane without duplication or routing to a different pane.
- [ ] **AND-7 — Scrollback and copy:** Touch scrolling behaves at a basic Termius level; the user can read prior output and copy terminal text.
- [ ] **AND-8 — Zoom:** Pinch or explicit controls change readable terminal text size, and tmux pane focus/zoom is available as a separate action.
- [ ] **AND-9 — Multi-host/pane control:** The user can move among existing hosts/sessions/windows/panes without attaching manually through separate SSH sessions.
- [ ] **AND-10 — Ordinary resume:** After normal background/foreground use or a transient network interruption, the app reconnects to a useful authoritative terminal state without requiring a restart.
- [ ] **AND-11 — Web distribution:** While authenticated in the production web/PWA, the user can download the current signed APK with Android APK MIME/download headers and begin installation on the Samsung device; the page clearly reports when no APK is published.

## Security and Regression Criteria

- [ ] **SEC-1 — Secret hygiene:** No raw credential, signing secret, private key, access code, JWT, or WebSocket ticket appears in Git, task artifacts, logs committed to Git, or user-facing reports.
- [ ] **SEC-2 — Authorization:** Native terminal attach/input/control requires the same operator authority expected by the existing Agent Command terminal path.
- [ ] **REG-1 — Existing gates:** Affected existing TypeScript/Go tests, typecheck/lint, and the narrow applicable browser journey pass.
- [ ] **REG-2 — No parallel implementation:** The accepted APK contains one terminal renderer and one primary public control-plane transport; no speculative SSH fallback or second terminal stack was added.

## Human Completion Criterion

- [ ] **HUMAN-1 — Basically useful:** Chris can use the installed APK for a real existing SloaneVault/Claude tmux interaction and confirms it is basically useful. Enhancements may remain in backlog.

## Review Rule

Every mandatory item must pass. A fresh-context Reviewer records evidence per item. The AI Lead may correct factual findings but may not reinterpret a failed item as passing. Scope additions belong in backlog unless required to pass an item above.
