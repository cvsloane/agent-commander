---
lane: FW6-FLOW
branch: refactor/fw6-flow
base_sha: d34b3c2658440ba082c2906727cd82e1126c00b4
implementation_sha: 3f8a9fc0707d8115ba9200a5b575b3db4b7a95fb
state: frozen
gates:
  setup: pass
  lint: pass
  typecheck: pass
  test: pass
  build: pass
  go_build: pass
  go_vet: pass
  go_test: pass
  smoke: pass
  journeys: pass
blockers: []
---

# FW6-FLOW handoff

## Outcome

FW6-FLOW delivers the owner-locked attach-everywhere and stable-grid behavior for
Wave 6. Tmux roster, recent, quick-switch, window-tab, and previous/next
navigation now land on the live terminal. A cold open restores the last valid
attachment with no tap, and a missing session falls back to the roster. Window
changes dispatch to tmux and retarget the viewer to the selected window's active
pane, including cross-host changes while the previous pane remains warm.

The phone can request a fixed letterboxed grid when another client shares the
tmux session. Agentd pins its grouped viewer window to manual dimensions for the
attachment and restores `window-size latest` on detach. Solo viewport changes
settle for at least 250 ms and must cross a minimum cell delta before resize is
sent; visual-viewport scrolling no longer drives tmux resizes.

## Delivered work

- Navigation uses one attached-terminal URL contract: `host_id`, `session_id`,
  `mode=terminal`, and `attach=1`. This covers roster selection, recents,
  quick-switch, window tabs, keyboard window-tab activation, and previous/next
  window actions.
- The UI store persists the last successfully attached host/session pair. Boot
  restore runs only when the URL has no explicit selection, waits for roster
  truth, and clears stale persistence when the session no longer exists.
- The additive terminal attach contract supports `letterbox`. Tmux topology now
  exposes `attached_clients`, allowing the dashboard to select letterbox mode
  when a non-viewer client shares the underlying session.
- Agentd creates grouped viewer PTYs with fixed manual grid dimensions for a
  letterbox attachment and releases that policy on detach. The integration test
  exercises pin and release through the repository's private tmux test socket.
- The dashboard renders a fixed-grid letterbox, scales the font to the available
  width, permits vertical pan for overflow, and gates actual resize dispatch on
  settled geometry instead of keyboard animation or viewport scrolling.
- Recently viewed panes keep a configurable warm cache. The default was raised
  from 5 to 30 minutes, serialized buffer content paints provisionally on
  revisit, and resume tokens remain the live source of truth. Resume/restart
  notifications distinguish continuity from truncated history, and detached or
  idle terminals expose a one-tap Resume action.
- The additive `commands.result` UI topic is authenticated and relayed by the
  control plane. Window actions reconcile optimistic state on the real result;
  failures roll back and show the returned error.
- WebGL context loss disposes the failed renderer, retries once after 500 ms,
  and reports a performance-channel permanent-fallback metric if recovery fails.
- While attached, the mobile launch sheet opens in a prefilled “window here”
  mode using the current host, tmux session target, and working directory.
- Playwright journey coverage uses the owner-locked 412×915 mobile viewport.
  It proves cold-open-to-live and window-tab viewer retargeting against the live
  mocked WebSocket path, plus the existing desktop journey matrix.

## Protocol and integration notes

- All schema and wire changes are additive: terminal attach `letterbox`, tmux
  topology `attached_clients`, and UI `commands.result`.
- `tests/fixtures/protocol/terminal-attach-letterbox.json` covers the attach
  option. `tests/fixtures/protocol/ui-commands-result.json` covers the CP-enriched
  UI message. The Go agent-origin fixture matrix intentionally skips `ui-*`
  fixtures because those envelopes are produced by the control plane, not
  agentd.
- No production state, deployment files, secrets, or default tmux server were
  touched.

## FW6-CANVAS shared-file overlap

- `TmuxWindowStrip.tsx`: FW6-FLOW owns only result reconciliation and the
  select-window/viewer-retarget handlers, including keyboard activation. CANVAS
  remains authoritative for strip presentation and density.
- `TmuxMobileShell.tsx`: FW6-FLOW adds quick-switch source wiring and passes the
  current-session “window here” launch context. CANVAS remains authoritative for
  composition, chrome, and visual presentation.

These two files should be reconciled by the AI Lead by preserving CANVAS markup
and styles while retaining the FLOW handler props, callbacks, and launch context.

## Verification

- `pnpm install` — pass.
- `pnpm exec playwright install chromium` — pass.
- `pnpm lint` — pass, 5/5 Turbo tasks.
- `pnpm typecheck` — pass, 5/5 Turbo tasks; Next route types generated.
- `pnpm test` — pass, 458 tests total: CLI 44, schema 50, dashboard 165, and
  control plane 199.
- `pnpm build` — pass, 4/4 Turbo tasks; Next.js 16.2.10 production build.
- `~/.local/go/bin/go build ./...` in `agents/agentd` — pass.
- `~/.local/go/bin/go vet ./...` in `agents/agentd` — pass.
- `~/.local/go/bin/go test ./...` in `agents/agentd` — pass.
- `pnpm test:smoke:dashboard` from private tmux TTY — 20/20 pass.
- `pnpm test:journeys --project mobile-412x915 --grep "cold open|window tab"`
  from private tmux TTY — 2/2 pass.
- `pnpm test:journeys` from private tmux TTY — 16 pass, 2 expected desktop skips
  for mobile-only owner journeys.
- `git diff --check origin/refactor/frontend-command-center...HEAD` — pass.
- Ownership scan — no rail/key components, `globals.css`, `deploy/**`, or other
  forbidden surfaces changed.

Playwright ran only in the dedicated private tmux server
`-L ac-test-fw6-flow-pw-20260720`; the default tmux server was never queried or
mutated. The private server is removed after the final remote-SHA check.

The passing unit suite still prints existing non-failing test-mock diagnostics
for control-plane notification DB mocks and unavailable Zustand persistence.
No suppression or fallback was added.

## Work-item commits

- `f653d8e` — `feat(mobile-flow): attach every tmux navigation`
- `d6123e8` — `feat(mobile-flow): restore last tmux attachment`
- `d3e8332` — `feat(agentd): stabilize shared tmux grids`
- `a45b48e` — `feat(mobile-flow): warm terminal reattach`
- `6c28c97` — `feat(mobile-flow): reconcile tmux command results`
- `0f28c86` — `feat(mobile-flow): recover terminal WebGL`
- `6dae3df` — `feat(mobile-flow): launch tmux windows in place`
- `d85f845` — `feat(mobile-flow): verify live mobile journeys`
- `f64c36e` — `feat(agentd): isolate agent protocol fixtures`
- `dbb0e10` — `feat(mobile-flow): preserve editor focus on attach`
- `3f8a9fc` — `feat(mobile-flow): align journeys with automatic attach`

The final handoff commit and exact frozen SHA are identified by the completion
token returned to the AI Lead.
