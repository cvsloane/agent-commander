---
lane: FW6-ALT
frozen_sha: f1112d6db56b703c3c5b8b966da7fad31e2aea40
attempt: 2
state: frozen
gates:
  lint: pass
  typecheck: pass
  test_ci: pass
  smoke: pass
  journeys: pass
  build: pass
proof:
  - "pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:smoke:dashboard && pnpm test:journeys && pnpm build → exact mandatory gate passed in order on attempt 2 from tmux session agent-command:0.0"
  - "pnpm lint → all 5 Turbo tasks passed with zero errors; three existing hook warnings remain"
  - "pnpm typecheck → all 5 Turbo tasks passed"
  - "pnpm test:ci → all 5 Turbo tasks passed, including dashboard 243/243, control-plane 200/200, schema 53/53, and CLI 44/44"
  - "pnpm test:smoke:dashboard → 21/21 Chromium scenarios passed"
  - "pnpm test:journeys → 37 passed and 19 expected project skips across mobile and desktop"
  - "pnpm build → 4/4 Turbo build tasks passed; Next.js 16.2.10 production build completed"
  - "FW6 Focus focused journey → 10/10 passed at mobile-412x915, covering dense history, thin app-scroll, in-place mode re-resolution, paging, overscroll, History dialog, Keyboard, Cursor, and Focus"
  - "New red isolation → mobile/desktop history paging and mobile precision selection passed five repeats each: 15 passed, 5 expected desktop precision skips"
  - "Frontend product audit → real Playwright interaction at 412x915 and 1280x720; score 98/100 with no hard failures"
assumptions:
  - "Whitespace-only capture rows are empty for the locked 40-non-empty-line heuristic."
  - "A failed or still-pending probe remains unclassified and therefore follows the locked history/loading safe path."
uncertainties:
  - "A physical Galaxy S25 Ultra was unavailable; touch dispatch, momentum, overlay closure, and reclassification were exercised in the mobile-412x915 Chromium project."
blockers: []
---

# FW6-ALT frozen handoff

## Outcome

FW6-ALT adds hybrid attached-tmux touch scrolling without changing protocol or agentd. Dense captures keep the local history overlay. Thin alternate-screen captures route touch and momentum deltas through the existing `navigate {op:'scroll'}` transport, so claude-code scrolls its own transcript instead of showing a black one-line overlay.

## Delivered work

- Added an exported pure classifier with the locked threshold of 40 non-empty newest-page lines, including whitespace-only line handling.
- Added a `historySessionId`-keyed mode cache in `TerminalView`, primed when an attachment becomes connected and invalidated/re-probed on in-place pane or window changes.
- Reuses the overlay's own newest-page fetch to refresh classification on every open, avoiding a separate classification request at open time.
- Preserves unclassified behavior as history: the overlay opens in its existing loading state, then a thin result reports `app-scroll`, caches the mode, and closes without rendering thin content.
- Restored the deleted animation-frame navigate coalescer from `92d98d3`, including one-to-one line emission, zero cancellation, carry, and the ±120-per-message clamp.
- Split attached touch dispatch into history/unclassified overlay, writable app-scroll navigate, and read-only app-scroll no-op paths.
- Kept non-tmux local/SGR scrolling, pinch, horizontal swipe and panning, selection, context menu, Keyboard, Cursor, History dialog, paging, prepend compensation, Live return, and overscroll dismissal unchanged.
- Extended the journey mock with a one-line claude-code window and proved dense codex, thin claude, and codex→claude→codex in-place re-resolution without a terminal reconnect.

## Verification notes

- Full-gate attempt 1 stopped at journeys because existing request-count assertions did not account for the new attachment prime and a virtualized history selector had not explicitly bottom-anchored before selecting newest rows.
- Both direct journey expectations were corrected and isolated for five repeats before the full chain was retried. Attempt 2 passed the exact required chain from the tmux-backed TTY.
- The browser matrix exercised the existing loading, history, paging, permission, Keyboard, Cursor, and desktop/mobile states. No new visible control or layout was introduced; frontend audit score is 98/100 with no clipping, focus, responsive, or interaction-state hard failure.
- The ownership firewall was preserved: no agentd, schema, package, service, deploy, host descriptor, letterbox, mobile Focus, rail-key, or production-state changes were made.

## Work-item commits

- `35473d9` — `feat(alt): classify pane scroll mode`
- `5eda478` — `feat(alt): route thin panes to app scroll`
- `0ce40c7` — `feat(alt): close thin history overlays`
- `f7caf43` — `feat(alt): cover hybrid scroll dispatch`
- `f1112d6` — `feat(alt): prove hybrid scroll journeys`

The `frozen_sha` is the final implementation/test commit; the following handoff-only commit adds this file.

FW6-ALT FROZEN f1112d6db56b703c3c5b8b966da7fad31e2aea40
