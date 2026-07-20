---
lane: W4-TERM-CLIENT
branch: refactor/wave4-term-client
frozen_sha: dd7f56ea4e6e79e79724cf4b2cb1444cb2efd370
attempt: 1
gate:
  commands:
    - pnpm --filter @agent-command/control-plane test
    - pnpm --filter @agent-command/dashboard test
    - pnpm typecheck
    - pnpm test:smoke:dashboard
  results:
    - command: pnpm --filter @agent-command/control-plane test
      status: passed
      detail: 40 test files and 141 tests passed, including binary negotiation, bounded pre-auth buffering, resume, resize authorization, lag forwarding, and durable terminal audit ingestion.
    - command: pnpm --filter @agent-command/dashboard test
      status: passed
      detail: 11 test files and 61 tests passed, including binary/legacy protocol decoding, reconnect URL construction, viewport sizing, hidden-fit protection, and persistent mobile terminal structure.
    - command: pnpm typecheck
      status: passed
      detail: All five schema build/typecheck, CLI, control-plane, and dashboard tasks passed.
    - command: pnpm test:smoke:dashboard
      status: passed
      detail: All 7 Chromium dashboard smoke scenarios passed.
assumptions:
  - Browser binary output remains opt-in through the additive hello frame; clients that do not negotiate continue receiving the legacy JSON/base64 payload.
  - Resume tokens remain valid according to frozen agentd's approximately 30-second detached-viewer TTL.
  - The Fastify WebSocket server is shared across routes, so compression is globally negotiated with a 1 KiB threshold, no context takeover, and bounded concurrency to avoid work on small voice/control frames.
uncertainties:
  - A reconnect within one control-plane process retires the stale browser channel before resume. Resume after a full control-plane restart can still be rejected by frozen agentd if it retains the old attached channel; superseding that channel requires a later agentd change and cross-process integration test.
  - Mobile preservation is covered by structural rendering and stable session-key tests, plus the dashboard smoke suite, but there is not yet a stateful browser rerender assertion that writes xterm scrollback, switches roster to terminal, and proves the same xterm instance survives.
  - Durable agentd lifecycle audits are attributed to the authenticated host. User-attributed terminal attach/input/control auditing remains Workstream E/Wave 5 scope.
blockers: []
---

# Wave 4 TERM-CLIENT handoff

## Summary

- Added a single additive browser terminal protocol in `@agent-command/schema`, including bounded dimensions, binary negotiation, idle timeout, lag, resume metadata, and the frozen agentd audit event.
- Enabled bounded permessage-deflate and negotiated binary browser frames in the control plane while preserving the JSON/base64 fallback. Initial dimensions and resume tokens now flow to agentd, resize is role-checked, early frames are safely bounded and ordered, and lag/status metadata reaches the browser.
- Made frozen agentd terminal lifecycle audits durable in the control plane. Existing foreign-host sessions fail closed, while audits for already-deleted sessions are recorded against the authenticated host and acknowledged so they cannot poison the durable queue.
- Migrated the dashboard from legacy xterm packages to `@xterm/xterm`, fit, web-links, and WebGL addons. WebGL context loss or initialization failure falls back to the core renderer.
- Removed the browser base64 character loop from the negotiated path: binary frames are written to xterm as `Uint8Array`; reconnects reuse the agent-issued token and include current fitted dimensions.
- Kept the selected terminal mounted while mobile roster/actions modes CSS-hide its region, guarded xterm fitting while hidden, and remount only when the selected session changes.
- Added visualViewport-driven terminal height, resize observation when hidden content becomes visible, and a sticky mobile key-bar/virtual-keyboard region above the OS keyboard.
- Added focused schema, control-plane, and dashboard tests, then passed the exact lane gate. Scoped schema/control-plane/dashboard lint also passed with only three pre-existing MobileLaunchSheet hook warnings outside this lane.
- Completed an independent adversarial review. Its correctness findings were fixed and re-tested; no blocking warnings remain.

The `frozen_sha` is the final implementation commit; the following handoff-only commit adds this file.
