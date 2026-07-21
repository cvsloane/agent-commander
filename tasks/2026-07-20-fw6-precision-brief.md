# FW6-PRECISION — Reading, copying, and navigating output on mobile (Wave 6, batch 2)

Lane: FW6-PRECISION · Machine: homelinux · Worktree: `~/dev/wt/ac-fw6-precision` · Branch: `refactor/fw6-precision` (off `refactor/frontend-command-center`; local, do NOT push)
Context: `tasks/2026-07-20-mobile-tmux-ux-plan.md` (OWNER-LOCKED header + prior-art mechanisms 5-8). Batch 1 shipped the full-bleed canvas, key rail, attach-everywhere, and letterbox grid — build on them.

## Work items

1. **Scroll-freeze reading mode.** Touch swipe-up while output streams freezes the viewport for reading (live frames keep buffering); a "N new lines" pill (extends the existing Live button) shows accumulation; tap = jump to tail. No timers, no yank mid-read.
2. **Own touch-selection overlay.** Replace reliance on xterm's weak touch selection (upstream issues #5377/#3727): double-tap selects a word, drag handles extend by cell, copy-on-select toast with Copy action. Coexists with cursor-drag mode (long-press = cursor mode per batch 1; double-tap = selection).
3. **Exact-range copy in the history pager.** Line numbers in `ScrollbackPager`, tap-line-to-anchor + tap-again-to-extend selection, "Copy selected lines". Keep existing filter + Copy matches.
4. **Thumbnail pane switcher + swipe navigation.** Bottom-sheet grid of recent/waiting panes using existing `latest_snapshot` capture text (mini monospace previews) with status badges; horizontal swipe on the terminal surface = next/prev window of the attached session (respect the letterbox pan gesture — swipe only when not panning).
5. **Spatial pane navigation.** Replace the fake linear prev/next mapping in the Actions sheet's directional pane nav with true spatial selection using topology `window_layout` geometry (fall back to linear when layout unknown).
6. **Triage chain.** Waiting/approval badges on COLLAPSED cluster rows in the roster; tapping a badge or selecting the Waiting filter auto-expands to the first matching pane.
7. **Command marks (scoped honestly).** For SHELL panes: OSC 133 marks via tmux `allow-passthrough` + a shell-integration snippet applied to OUR spawned shells only (spawn templates), rendered as xterm decorations with prev/next-mark buttons in the rail's expanded preset; sticky current-command header while its output scrolls. For AGENT panes (Claude/codex TUIs — no OSC 133 upstream): heuristic agent-turn boundaries (prompt-pattern detection on snapshot/stream) marked the same way, clearly labeled approximate. If the passthrough path proves unreliable in tests, ship the heuristic half and record the rest in the handoff.
8. **Settings-sync fail-soft (carried from batch 1):** a failed `PUT /v1/settings` must never blank the app — catch, toast once, continue with local state.
9. **Tests.** Unit: selection overlay geometry, spatial nav mapping, freeze-pill state, fail-soft. Playwright (412×915 profile): freeze + jump-to-tail, pager line-copy, thumbnail switcher open/switch. All suites green.

## Ownership firewall

You may edit: `apps/dashboard/src/components/(terminal|tmux|mobile|session)/**`, `src/hooks/**`, `src/lib/**` (additive), `src/stores/**` (additive), spawn-template config surface for shell integration (`agents/agentd/internal/**` ONLY if the shell-integration snippet must be injected at spawn — keep it minimal and flag it; prefer CP/dashboard-side), related tests + journey additions for YOUR features only. You may NOT edit: `packages/**`, `services/**` (except a single additive settings route change if fail-soft needs it — flag it), `deploy/**`, batch-1 rail/letterbox core logic (extend, don't rewrite), `tests/journeys/**` files owned by FW6-VERIFY (add NEW spec files for your features instead).

## Gates

`pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:smoke:dashboard && pnpm test:journeys && pnpm build` — Playwright from a tmux TTY; if `agents/` touched, Go gates too. Commit per work item, prefix `feat(mobile-precision):`. ≤3 attempts per failure then hold.

## Done

Handoff `tasks/frontend-ux-handoffs/fw6-precision.md`, committed, then print exactly:
`FW6-PRECISION FROZEN <full-sha>`
