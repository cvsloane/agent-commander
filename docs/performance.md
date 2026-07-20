# Frontend Performance Contract

These invariants are the regression bar for Command Center changes. They describe
the production data path and its existing tests; they are not synthetic page-load
scores or a substitute for profiling a changed interaction.

## Terminal hot path

- A steady-state terminal `output` frame writes directly to xterm. It performs
  **zero React state, connection-status, or shared-store writes per frame**.
  Connection state may change only on a real status or error transition.
- New output follows the viewport only when the viewport is already live. If an
  operator has scrolled back or is selecting text, output must not call
  `scrollToBottom`; returning to live output is an explicit **Live** action.
- Selection text and its anchor remain in refs while the pointer moves. React
  state may commit once when a selection completes or clears, not on each drag
  update.
- Raw xterm data, Shift+Enter, paste, virtual keys, and composed prompts use the
  single `sendInput` transport and its read-only guard.
- The persistent host retains at most one background terminal. A terminal hidden
  by navigation suspends its WebSocket after five minutes instead of growing a
  pool of live connections.

Named proofs:

- `components/terminal/terminalFrameRouter.test.ts` routes 250 consecutive
  output frames with 250 xterm writes and zero status/store writes.
- `hooks/useTerminalScrollAnchor.test.ts` proves history is not yanked to the
  bottom and only the explicit live action scrolls and focuses.
- `components/terminal/terminalHostStore.test.ts` proves instance/buffer
  persistence, replacement of a changed descriptor, and permission continuity.

Any terminal change that adds work per output frame must include a focused
measurement and justify why the zero-write bar can no longer be met. Do not hide
frame-rate regressions behind throttled React updates.

## Fleet reconciliation

- Fleet cards, the roster tree, session health, and tmux topology project from
  one canonical Zustand store. A feature must not add a second fleet/session
  cache to achieve a different presentation.
- `sessions.changed`, graph, task, and topology events apply targeted updates
  immediately. The aggregate fleet and roster requests reconcile every 30
  seconds as a safety net, not as the primary live-update path.
- Aggregate ingestion keeps the record with the fresher `updated_at`, so an old
  response cannot overwrite a newer targeted event.
- Each aggregate reconciliation rebuilds the canonical session map from the
  exact union of current aggregate and roster IDs. Removed or archived sessions
  must be released while roster-only sessions remain available.
- Live topology is authoritative for 30 seconds. A one-second expiry check drops
  a silent feed after that TTL and immediately rebuilds from the retained roster
  snapshot without another network request.
- Semantically identical roster input remains reference-stable and must not
  trigger a duplicate feed or subscription render loop.

Named proof: `stores/fleet.test.ts` covers shared card/roster projections,
targeted event application, fresher-update preservation, exact cache pruning,
session deletion, and topology expiry back to roster state.

When changing reconciliation, run the focused terminal/fleet tests as well as
the normal dashboard suite. A new polling loop, parallel store, or broad cache
invalidation fails this contract unless the architecture decision is documented
and the old path is removed.
