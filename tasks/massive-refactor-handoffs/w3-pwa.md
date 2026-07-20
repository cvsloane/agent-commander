---
lane: W3-PWA
branch: refactor/wave3-pwa
frozen_sha: 1bcc70cc27e47ddd383422b9f5ac9501e67f443c
attempt: 1
gate:
  commands:
    - pnpm --filter @agent-command/dashboard test
    - pnpm --filter @agent-command/dashboard typecheck
    - pnpm --filter @agent-command/dashboard lint
    - pnpm test:smoke:dashboard
  results:
    - command: pnpm --filter @agent-command/dashboard test
      status: passed
      detail: 8 files and 54 tests passed; the Wave 1 baseline was 4 files and 43 tests.
    - command: pnpm --filter @agent-command/dashboard typecheck
      status: passed
      detail: Next route generation and tsc --noEmit completed successfully.
    - command: pnpm --filter @agent-command/dashboard lint
      status: passed
      detail: ESLint exited 0 with only four pre-existing React hook warnings in TerminalView and MobileLaunchSheet.
    - command: pnpm test:smoke:dashboard
      status: passed
      detail: All 7 Playwright dashboard smoke tests passed.
assumptions:
  - The sibling W3-PUSH-BACKEND routes and additive attention protocol land before Web Push is expected to work; the dashboard feature-detects missing routes and keeps legacy live topics isolated from the additive attention topic.
  - A second lightweight UI WebSocket dedicated to the additive attention topic is acceptable; this is required because older servers silently reject an entire subscription envelope containing an unknown topic.
  - Fetching the complete failed and blocked run sets every 60 seconds is acceptable until the automation-runs API gains a cursor; WebSocket transitions remain immediate.
uncertainties:
  - End-to-end notification delivery was not exercised against deployed VAPID credentials and an external browser push service.
  - Installability, the active service worker, and responsive queue layout were verified locally in Chromium; iOS home-screen installation was not exercised on physical hardware.
blockers: []
---

# Wave 3 PWA handoff

## Summary

- Added a standalone Agent Commander manifest, generated 192/512 regular and maskable icons plus an Apple touch icon, safe viewport metadata, a public offline fallback, and a hand-written service worker for public shell/static caching, push display, and same-origin deep-link focus/open behavior. Authenticated HTML and arbitrary same-origin images are never cached.
- Added user-gesture-only mobile first-run push prompting and a settings card with subscribe, unsubscribe, retry, unsupported, denied, unavailable, and disabled-VAPID states. Local subscriptions are reconciled against the authenticated user's server list, rolled back on every failed save, and removed before logout to prevent cross-account notification disclosure.
- Replaced remaining dashboard `vh` sizing with `dvh` and added safe-area padding to the dashboard shell, header/sidebar, mobile sheets, tmux controls, full-screen workbench, floating notifications, and bottom action surfaces.
- Rebuilt `/orchestrator` and its modal as one mobile-first priority queue merging every pending session approval, server/client waiting-input signals, governance approvals, and failed/blocked automation runs. It supports one-tap decisions, terminal/automation deep links, polling-stable in-memory dismissal, idling only for session-derived items, partial-data states, and an accessible mobile bottom sheet.
- Consumes structured `attention.changed` metadata (`attention_reason`, `question`, `confidence`, `capture_hash`) with DetectionEngine fallback. The additive topic uses an isolated named WebSocket so an older server can reject it without disabling established sessions/snapshots/approvals/run subscriptions.
- Added 11 Vitest regressions over the 43-test baseline for push state/ownership/rollback/VAPID behavior, attention merging and multi-approval retention, structured attention/dismissal behavior, and public PWA auth routing.
- A full fresh-eyes adversarial review found two critical and six warning-level issues on its first pass; all were remediated. The final review reported no issues above nitpick.

## Sibling backend contract

The dashboard consumes these user-authenticated W3-PUSH-BACKEND routes:

```text
GET    /v1/push/vapid-public-key -> { enabled: boolean, public_key: string | null }
GET    /v1/push/subscriptions    -> { subscriptions: [{ id, endpoint, device_label, created_at, last_seen_at }] }
POST   /v1/push/subscriptions    <- { endpoint, p256dh, auth, device_label }
DELETE /v1/push/subscriptions    <- { endpoint }
```

It accepts additive `attention.changed` messages shaped as:

```text
{ session_id, attention_reason: string | null, question?, confidence?, capture_hash? }
```

The `frozen_sha` is the final implementation commit; the following handoff-only commit adds this file.
