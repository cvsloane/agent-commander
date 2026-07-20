# FW2-TERM — Terminal client performance, persistence, and search (Wave 2)

Lane: FW2-TERM · Machine: homelinux · Worktree: `~/dev/wt/ac-fw2-term` · Branch: `refactor/fw2-term` (off `refactor/frontend-command-center`; local, do NOT push)
Program plan: `tasks/2026-07-20-frontend-tmux-ux-master-plan.md` · Acceptance: `tasks/frontend-ux-acceptance-checklist.md` (Wave 2)
Evidence for every problem named here: `tasks/2026-07-20-frontend-ux-study-findings.md` §2 (read it first).

## Mission

Make the in-app terminal feel native: no jank under heavy output, alive across navigation, searchable. No transport/protocol changes — the WS protocol and server side are untouched.

## Work items

1. **Output hot path.** Today every `output` frame runs `markConnected()` → reconnect-state transition + `setStatus` + `setErrorMessage(null)` + forced `scrollToBottom()` (`useTerminalConnection.ts` ~159-163). Fix: state transitions happen only on actual status *changes* (refs/guards, not per-frame store writes); frame handling writes to xterm only.
2. **Scroll anchoring.** Autoscroll only when the viewport is at the bottom; when the user has scrolled up, do NOT yank them down on new output — show a small "jump to live" affordance instead. Works with touch momentum scrolling on mobile.
3. **Selection out of the render path.** `selectionText`/`hasSelection` React state currently re-renders `TerminalView` on every selection change during drag (`TerminalView.tsx` ~28-36). Move to refs + imperative positioning for `SelectionPopup`/`TerminalContextMenu`; a render may happen when a selection is *completed*, not continuously during drag.
4. **One input path.** `useTerminalConnection.sendInput`, `useXtermTerminal` raw key frames, and `useTerminalClipboard` paste all emit `input` frames independently. Consolidate behind a single `sendInput` API (read-only guard included) used by all three plus `VirtualKeyboard`.
5. **Persistent app-level terminal host.** The terminal currently dies on route navigation (`TerminalView.tsx` ~118-127 dispose). Build a `PersistentTerminalHost` mounted once at the dashboard-layout level that owns the live xterm + WS for the current session; route surfaces (tmux workbench, session detail) portal/adopt it instead of remounting. Policy (locked): at most 1 live background terminal; auto-detach after 5 minutes hidden; on return, resume via the existing resume-token flow. The existing in-page `PersistentTerminalRegion` behavior on /tmux must keep working.
6. **Search + deeper scrollback.** Add `@xterm/addon-search` (the ONLY allowed dependency change). Search UI: desktop inline bar in the terminal toolbar (Ctrl/Cmd-F when terminal focused), mobile a bottom-sheet with next/prev + match count. Raise xterm scrollback 4000 → 10000 (`useXtermTerminal.ts` ~56).
7. **Tests.** (a) Stateful test proving the SAME xterm instance (same object identity / buffer content) survives roster→terminal→roster mode flips AND navigating away from /tmux and back within the background window — closes the missing W4-TERM-CLIENT test; (b) unit test asserting zero store/status writes across N consecutive output frames in steady state; (c) scroll-anchor behavior test; existing suites stay green.

## Ownership firewall

You may edit: `apps/dashboard/src/components/terminal/**`, `components/TerminalView.tsx`, `components/mobile/**`, `components/session/SessionWorkbench.tsx`, `components/tmux/**` (only what terminal hosting requires), `hooks/useTerminal*`, `hooks/useXtermTerminal.ts`, `lib/viewport.ts`, `lib/reconnect.ts` (terminal-scoped only), and `apps/dashboard/package.json` + lockfile for `@xterm/addon-search` only. **Shared-file exception:** you may add a single minimal `<PersistentTerminalHost />` mount in `components/layout/LayoutShell.tsx` — nothing else in that file. You may NOT touch: `packages/**`, `services/**` (FW2-CONTRACTS owns them), `agents/**`, `deploy/**`, stores other than a new terminal-host store if needed, WS protocol files (`components/terminal/protocol.ts` message shapes stay identical).

## Gates

`pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:smoke:dashboard && pnpm build` — all green. Commit per work item, prefix `perf(terminal):` / `feat(terminal):`. ≤3 attempts on the same failure, then `state: held` with evidence.

## Done

Handoff `tasks/frontend-ux-handoffs/fw2-term.md`, committed on your branch, then print exactly:

`FW2-TERM FROZEN <full-sha>`
