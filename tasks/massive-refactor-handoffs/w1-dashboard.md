---
lane: W1-DASHBOARD
branch: refactor/wave1-dashboard
frozen_sha: 33c625bfa62aaf0c829ae4fbcd47acb4f8d3a1bc
attempt: 1
gate_results:
  dashboard_test: "pass — 4 files, 43 tests"
  dashboard_typecheck: "pass"
  dashboard_lint: "pass"
  dashboard_smoke: "pass — 7 Playwright tests, including 390x844 mobile tmux coverage"
assumptions:
  - "A repeated ui.subscribe message is a benign, schema-valid keepalive for the current server; its topics array may be empty."
  - "Current terminal close codes 4006 (host disconnected) and 4007 (attach dispatch failed) are transient; 4001-4005 and 4008-4009 are permanent."
  - "The hardened server may add protocol ping/pong and hosts.changed messages; browser pong handling and the existing permissive message dispatch remain compatible."
uncertainties:
  - "No live control-plane/agentd disconnect was induced in this worktree; retry timing and viewport behavior were verified through pure tests and local browser state transitions."
blockers: []
---

# Wave 1 Dashboard Handoff

## Summary

- Replaced the event stream's five-attempt ceiling with infinite, capped 30-second full-jitter exponential reconnects.
- Added immediate event-stream recovery on visible, online, and pageshow signals, including cold-offline/token-fetch recovery.
- Added a 25-second `ui.subscribe` keepalive that validates against the current control-plane schema and remains compatible with server-side ping/pong hardening.
- Added a global Zustand event-connection store and a fixed, no-layout-shift `reconnecting…` / `offline` status pill in the layout shell.
- Added terminal auto-reconnect for known transient WebSocket/control-plane close codes, with immediate visible/online recovery and no retries for authentication, permission, missing-session/pane, unsupported-host, idle-timeout, or deliberate-detach conditions.
- Preserved the mounted xterm instance and scrollback across transient reconnects; each new terminal WebSocket re-attaches through the existing terminal route.
- Added a per-terminal `Reconnecting...` toolbar state with accessible live status text.
- Consolidated event and terminal URL resolution in `src/lib/wsUrl.ts`, preserving proxy base paths, rejecting stale mismatched hosts, and rewriting internal service hostnames to the browser origin.
- Added pure Vitest coverage for unlimited retries, jitter/cap behavior, recovery signals, reset-on-success, terminal close classification, and shared URL resolution.

## Verification

The exact lane gate passed:

```text
pnpm --filter @agent-command/dashboard test       # 4 files, 43 tests passed
pnpm --filter @agent-command/dashboard typecheck  # passed
pnpm --filter @agent-command/dashboard lint       # passed
```

Additional verification:

```text
pnpm test:smoke:dashboard  # 7 Playwright tests passed
```

Browser inspection covered 390x844 and 1366x768. At 390px, the main region remained exactly `{x:0,y:57,width:390,height:787}` before and after the offline status appeared, and document width remained 390px (no horizontal overflow or layout shift). Frontend quality audit: 96/100, no hard fails.
