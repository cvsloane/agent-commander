---
lane: FW6-FOCUS
frozen_sha: a62bef52cb4d4f54b91cf37d640174f2d6ee2880
attempt: 2
state: frozen
gates:
  lint: pass
  typecheck: pass
  test_ci: pass
  smoke: pass
  journeys: pass
  build: pass
  go: pass
proof:
  - "pnpm install → completed successfully before repository inspection or changes"
  - "CHOKIDAR_USEPOLLING=1 WATCHPACK_POLLING=true pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:smoke:dashboard && pnpm test:journeys && pnpm build → exact mandatory gate passed in order on attempt 2 from the private ac-fw6-focus-pw tmux TTY"
  - "pnpm lint → all Turbo lint tasks passed"
  - "pnpm typecheck → schema, CLI, control plane, and dashboard passed"
  - "pnpm test:ci → dashboard 58 files/212 tests, control plane 49 files/200 tests, and all schema/CLI suites passed"
  - "pnpm test:smoke:dashboard → 21/21 Chromium scenarios passed"
  - "pnpm test:journeys → 28 passed and 10 expected viewport/opt-in skips across mobile and desktop"
  - "pnpm build → 4/4 Turbo build tasks passed; Next.js 16.2.10 production build completed"
  - "~/.local/go/bin/go build ./... && ~/.local/go/bin/go vet ./... && ~/.local/go/bin/go test ./... from agents/agentd → all packages passed"
  - "private-socket Go integration coverage → viewer window/pane selection, idempotent zoom, and detach unzoom passed without using the default tmux server"
  - "FW6 Focus journeys → same-session window strip emitted terminal.navigate with no new terminal WebSocket; automatic/toggled zoom round-tripped through topology truth"
assumptions:
  - "A successful channel zoom-on request owns Focus cleanup even when the shared tmux window was already zoomed, matching the locked always-unzoom-on-detach/switch-away rule."
uncertainties:
  - "A physical Galaxy S25 Ultra was unavailable; the owner-device dimensions and mobile Focus behavior were exercised in the 412x915 Playwright project."
blockers: []
---

# FW6-FOCUS frozen handoff

## Outcome

FW6-FOCUS removes the reconnect penalty from navigation inside one tmux session and gives mobile viewers a predictable single-pane Focus mode. Same-session window and pane changes now retarget the live grouped viewer while preserving the terminal descriptor, WebSocket, xterm instance, and buffer. Cross-session changes retain the existing detach/reattach boundary.

## Delivered work

- Added the channel-scoped `terminal.navigate` protocol with `select_window`, `select_pane`, and state-setting `zoom` operations. Agentd executes every operation against the channel's grouped viewer session, never the origin session's active selection.
- Added additive schema registration, fixture coverage, authenticated control-plane relay, and terminal-idle accounting for navigation messages.
- Extended the persistent terminal-host contract with a stable host/tmux-session identity. A successfully emitted same-session navigation preserves the attachment descriptor key and terminal instance while the URL and selected session update optimistically. Window tabs, keyboard activation, previous/next, quick switch, pane switcher, and spatial navigation use this path; cross-session or disconnected targets fall back to reattach.
- Preserved the letterbox hotfix while moving its manual window-size pin from the old viewer window to the newly selected viewer window.
- Added the persisted `autoFocusPane` setting, default on. The mobile attached status row exposes an accessible maximize toggle; multi-pane mobile targets auto-focus, target changes reassert Focus, and topology's `zoomed` flag is the displayed source of truth. Desktop receives no automatic zoom behavior.
- Mobile back, detach, toggle-off, and component departure request unzoom. Development Strict Mode cleanup is deferred one tick so its synthetic remount cannot generate a false unzoom/rezoom cycle.
- Agentd records successful channel zoom ownership, unzooms before selecting a different viewer window/pane, and clears owned zoom during explicit detach, control-plane disconnect, stale-channel supersede, TTL sweep, and manager close. The shared desktop window therefore cannot remain accidentally zoomed after the phone viewer disappears.
- Added unit and browser coverage for emitted navigation frames, stable terminal identity, the Focus state machine, private-socket zoom cleanup, no-new-WebSocket window switching, and topology-backed Focus round trips.

## Decisions within the locked design

- Same-session identity is `host_id + tmux session name`; pane/session IDs remain the reattach identity unless navigation was actually emitted through the connected attachment.
- Focus preference and Focus state are intentionally separate. `autoFocusPane` controls mobile intent, while the button's pressed state comes only from live topology.
- Zoom is treated as channel-owned after a successful `zoom: true` request, including an idempotent request against an already zoomed window. This makes the locked switch-away and detach cleanup deterministic.
- Navigation serializes under the terminal manager lock so cleanup cannot race a select or zoom operation. Tmux's window-shared zoom behavior is documented at the bridge boundary.
- The journey topology simulator now applies zoom and window mutations before rebroadcasting snapshots, matching the real server closely enough to prove the UI consumes returned truth rather than local optimism.

## Verification notes

- The first complete gate reached the journey suite and exposed a harness-only race: a delayed Focus topology snapshot discarded an optimistically mocked new window. The mock now preserves new/rename/kill mutations in every subsequent topology broadcast; the isolated failing journey passed, followed by the fully green attempt-2 chain.
- Playwright ran from the private `tmux -L ac-fw6-focus-pw` TTY. Go's real tmux tests use the repository's private `-L` socket helper. The default tmux server was not queried or changed.
- No production state, deployment files, secrets, paid operations, commits to remote, or pushes were performed.

## Work-item commits

- `b29aab0` — `feat(focus): add viewer-scoped terminal navigation`
- `8c24286` — `feat(focus): relay channel navigation messages`
- `6fb43c2` — `feat(focus): switch tmux panes without reconnecting`
- `ea696c3` — `feat(focus): auto-focus mobile tmux panes`
- `b1f5fc6` — `feat(focus): unzoom viewer panes on channel cleanup`
- `574de23` — `feat(focus): cover instant switching and zoom journeys`
- `a62bef5` — `feat(focus): preserve journey topology mutations`

The `frozen_sha` is the final implementation/test commit; the following handoff-only commit adds this file.

FW6-FOCUS FROZEN a62bef52cb4d4f54b91cf37d640174f2d6ee2880
