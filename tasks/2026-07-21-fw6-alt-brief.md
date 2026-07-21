# FW6-ALT — Hybrid scroll routing for alt-screen panes (device finding 6b)

Lane: FW6-ALT · Machine: heavisidelinux · Worktree: `~/dev/wt/ac-fw6-alt` · Branch: `refactor/fw6-alt` (off `refactor/frontend-command-center`; local, do NOT push)
Owner device finding (S25 Ultra, production): drag-down on a **claude-code pane** shows the history overlay as a black screen. Owner interview locked the hybrid design below — do not re-litigate.

## Root cause (verified by AI Lead — production data, do not re-derive)

- The owner's pane (session `268855f4…`, tmux pane `%3`, heavisidelinux) runs claude-code on the tmux **alternate screen** (`alternate_on=1`, `mouse_any_flag=1`, `history_size=1`). Alt-screen apps write nothing to tmux history; the production capture `-S -500 -E -1` returns exactly ONE line (the pre-launch shell prompt). The overlay bottom-anchors that lone line on a black surface → "black screen, nothing."
- The overlay is correct for history-rich panes (shells; codex writes the normal screen — verified 500 dense lines from the same capture on a live codex pane). Alt-screen TUIs structurally cannot be served by capture-pane: their transcript lives inside the app. Native tmux cannot scroll them either; desktop trackpads scroll them because xterm wheel → SGR reports → tmux passes through → the app scrolls itself.
- The deployed agentd `terminal.navigate {op:'scroll'}` op (FW6-TOUCH, still live, wheelResidue fix included) already implements per-pane truth per message: in-mode → copy-mode scroll; alt+mouse → SGR to the app; alt no-mouse → arrows; normal → copy-mode entry. It is the correct transport for alt-screen panes and needs NO changes.

## Design (owner-locked)

### 1. Pane scroll-mode classification (dashboard-only, no protocol change)

- Classification comes from the scrollback fetch itself: count NON-EMPTY lines in the newest-page capture. `>= 40` non-empty lines (named constant, ~one 412x915 screen at 14px) → mode `history` (local overlay, today's behavior). Fewer → mode `app-scroll`.
- Prime the classification with one fetch when an attachment becomes ready, and re-resolve whenever `historySessionId` changes (window/pane switches) and on every overlay open (reuse/cached with the overlay's own newest-page fetch — do not double-fetch). Cache keyed by `historySessionId`.
- Classification is a heuristic with a safe failure mode: misrouted panes hit agentd's per-message pane-state dispatch, which does the right thing for whatever is actually in the pane. Do not add protocol/topology fields.

### 2. Touch dispatch (`useTerminalTouchScroll`)

- Attached-tmux path splits by resolved mode:
  - `history` → open the local overlay on downward drag (exactly today's behavior, including `shouldOpenHistoryOnGesture`).
  - `app-scroll` → route vertical drag + momentum line deltas to `navigate {op:'scroll'}` via the controller: 1:1 pixel→line mapping, frame-coalesced, ±120 clamp per message. Resurrect the deleted coalescer machinery from git history (`git show 92d98d3:apps/dashboard/src/hooks/useTerminalTouchScroll.ts` — `reduceTerminalScrollCoalescer`, `scheduleNavigateFlush`, `enqueueNavigateScroll`) rather than re-inventing it; restore its unit tests alongside.
  - Unclassified (probe not yet resolved) → treat as `history` (overlay opens with its spinner; the fetch resolves the mode; if it lands `app-scroll`, the overlay auto-closes and the mode is cached so the NEXT gesture scrolls the app).
- Read-only viewers: `history` mode works as today; `app-scroll` mode sends nothing (agentd rejects read-only navigate anyway — do not generate doomed messages).
- Non-tmux paths (local scrollLines, SGR fallback), pinch, horizontal swipe, selection, context menu, Keyboard/Cursor rail: untouched.

### 3. Overlay (`TerminalHistoryOverlay`)

- When its fetch classifies the pane `app-scroll` (thin history), it closes itself and reports the classification to the host instead of rendering the thin content. No black flash beyond the loading state.
- Everything else (paging, prepend compensation, Live pill, overscroll dismiss, bottom anchoring) unchanged.

### 4. No agentd, schema, or control-plane changes. No binary rollout.

## Work items

1. Classification helper (pure, exported: non-empty-line count + threshold) + cache/priming wiring in `TerminalView`/attachment lifecycle; re-resolve on `historySessionId` change and overlay open.
2. Touch dispatch mode split + resurrected coalescer/navigate emission + read-only gating.
3. Overlay thin-history auto-close + classification callback.
4. Unit tests: classification threshold (incl. blank-line handling), dispatch matrix (history/app-scroll/unclassified × writable/read-only), coalescer math (restored tests).
5. Journeys (extend fw6-focus mock): a claude-like session whose scrollback returns 1 line — drag-down emits `navigate {op:'scroll'}` frames and does NOT leave an overlay open; codex-like session keeps today's overlay journey green with ZERO navigate frames; classification re-resolves after an in-place window switch between the two; existing overlay/dialog/keyboard/cursor journeys stay green.

## Ownership firewall

You may edit: `apps/dashboard/src/hooks/useTerminalTouchScroll*.ts`, `apps/dashboard/src/components/TerminalView.tsx`, `apps/dashboard/src/components/terminal/**`, related unit tests, `tests/journeys/**`. You may NOT edit: `agents/agentd/**`, `packages/**`, `services/**`, `deploy/**`, `terminalHostStore.ts` descriptor contract, letterbox, `mobileFocus.ts`, Keyboard/Cursor rail keys, ScrollbackPager dialog behavior.

## Gates

Full chain: `pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:smoke:dashboard && pnpm test:journeys && pnpm build`. Playwright from a real tmux TTY. `pnpm install --frozen-lockfile` first if `node_modules` is absent. Commit per work item, prefix `feat(alt):`. ≤3 attempts per failure then hold; re-run a new red isolated (×5) before counting an attempt.

## Done

Handoff `tasks/frontend-ux-handoffs/fw6-alt.md` (same frontmatter as fw6-hist.md), committed, then print exactly:
`FW6-ALT FROZEN <full-sha>`
