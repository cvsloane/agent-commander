# Android Tmux Parity — Acceptance Checklist

- Status: approved at 2026-07-23T00:19:00-04:00
- Technical result: passed at replacement source `824406dd76b0601ef47e7d592089ae0d7e9a0cc4`
- Production result: merge `b41a595ff890cdb753dfd22f30c13429688933e5`, Coolify `f10cgejtgwwtlckkz23cfi5d`
- Human Owner: Chris Sloane
- Project Plan: `tasks/2026-07-23-android-tmux-parity-plan.md`

Every mandatory item must pass. Native UI may differ from the web UI when it preserves the same useful phone outcome.

## Authority and Terminal

- [x] **TERM-1 — Explicit state:** The app separately represents connection, authoritative viewer target, and controller ownership; a delayed/lost focus result recovers through correlated `viewer_state` or reports authoritative failure.
- [x] **TERM-2 — Attach/render/input:** A selected pane attaches over public WSS, renders intelligibly, resizes, and receives Samsung/physical keyboard text, Enter, Backspace, paste, and control keys exactly once.
- [x] **TERM-3 — Read-only/control:** A read-only viewer can navigate and read history, cannot accidentally send terminal input, and has an always-visible Take Control action.
- [x] **TERM-4 — Detach/resume:** Explicit detach stays detached; background/network reconnect resumes or freshly reattaches, reconciles pane/zoom truth, and never silently routes input to another pane.
- [x] **TERM-5 — Status/errors:** Connecting, reconnecting, read-only, switching, interactive, detached, and failed states are visible; exact focus/command failures remain actionable.

## Navigation and Topology

- [x] **NAV-1 — Grouped topology:** One useful phone navigator shows online hosts and the tmux session → window → pane hierarchy with identity, status/activity, search/filter, and available snapshot context.
- [x] **NAV-2 — Reliable switching:** Same-tmux-session pane/window changes reuse the viewer and commit only after authoritative acknowledgement; cross-session/host changes safely reattach.
- [x] **NAV-3 — Restore/open:** The app persists and validates the last target, supports explicit return to the roster, and can open an existing managed or unmanaged tmux target through the canonical API.
- [x] **NAV-4 — Multi-host:** Existing panes on heavisidelinux and homelinux can be reached without separate SSH sessions or phone Tailnet.

## Interaction, Keys, and Reading

- [x] **READ-1 — Correct scrolling:** Normal-buffer/local history scrolls through the Termux transcript even read-only; writable alternate-screen, mouse-aware, and application scrolling uses the canonical bounded remote navigation path.
- [x] **READ-2 — Older history:** Server tmux history pages backward without reordering, can be searched/filtered, supports exact contiguous selection/copy and copy-last/all, and returns to live output clearly.
- [x] **READ-3 — Live copy/paste:** Live terminal text can be selected/copied where the renderer supports it; paste has a clear manual path if Android clipboard permission is unavailable.
- [x] **READ-4 — Claude view:** Claude-backed panes offer a clean paged transcript/history view and a direct prompt-send path for the currently verified writable pane.
- [x] **KEY-1 — Practical rail:** A stable rail exposes Esc, Ctrl, Tab, Shift-Tab, arrows, Page Up/Down, Home/End, Enter, keyboard toggle, paste, and configured tmux prefix; Ctrl supports a predictable one-shot workflow.
- [x] **ZOOM-1 — Independent zoom:** Pinch/A± changes readable font size and persists it; tmux pane focus/zoom is a separate verified action with reliable unzoom.

## Window and Pane Lifecycle

- [x] **WIN-1 — Window navigation:** Window strip/list shows active state and useful activity/bell state where supplied, and supports acknowledged tap/gesture switching.
- [x] **WIN-2 — Window mutation:** New, rename, and close window operations report actual command completion, confirm closing the last window, and reconcile topology after success/failure.
- [x] **PANE-1 — Pane mutation:** Horizontal/vertical split, directional adjacent selection, focus/unfocus, and kill/archive are available with confirmations where destructive.
- [x] **PANE-2 — Command truth:** REST command acceptance is never presented as success; the UI waits for correlated result/topology truth and rolls back or reports exact failure.

## Persistence, Distribution, and Regression

- [x] **APP-1 — Preferences:** Font size, key-rail mode, per-host tmux prefix, and last validated target persist across ordinary app restarts without storing raw service credentials.
- [x] **APP-2 — Web launch handoff:** General new Claude/Codex session launch remains web-owned and is reachable through an authenticated browser handoff.
- [x] **REL-1 — Signed update:** A versioned release APK passes unit/lint/release assembly, zipalign, package/version inspection, and v2/v3 signature verification with the established certificate.
- [x] **REL-2 — Authenticated distribution:** Production PWA/settings serves the exact reviewed APK only to an authenticated user with APK MIME, attachment, private/no-store, length, version, and SHA-256 evidence.
- [x] **SEC-1 — Secret hygiene:** No raw credential, ticket, signing key, password, or access code appears in Git, task artifacts, committed logs, or user-facing reports.
- [x] **REG-1 — Existing paths:** Affected existing Android and shared-contract/backend tests pass; web launch and web tmux behavior remain unchanged.
- [x] **REG-2 — One stack:** The APK contains one Termux-derived renderer and one public Agent Command transport; no SSH fallback, alternate terminal stack, or speculative protocol was added.

## Final Human Criterion

- [ ] **HUMAN-1 — Daily use:** After all technical criteria pass, Chris installs the final APK on the Samsung and confirms the complete native tmux workflow is ready for daily use.

## Review Rule

A fresh-context Reviewer records evidence per item. The AI Lead may correct defects but cannot reinterpret a failed item as passing. The one final device verdict is the only planned owner test after project launch.
