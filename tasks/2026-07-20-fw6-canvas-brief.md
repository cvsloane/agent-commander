# FW6-CANVAS — Mobile terminal canvas, density, and the key rail (Wave 6, batch 1)

Lane: FW6-CANVAS · Machine: homelinux · Worktree: `~/dev/wt/ac-fw6-canvas` · Branch: `refactor/fw6-canvas` (off `refactor/frontend-command-center`; local, do NOT push)
Context: `tasks/2026-07-20-mobile-tmux-ux-plan.md` (read the OWNER-LOCKED header + root causes). Target device: Samsung S25 Ultra, Brave/Android (~412×915), thumb-only. Single user. Playwright device metrics: use 412×915 Android for new tests.

## Mission

The mobile terminal is small, hard to read, and loses every control when the OS keyboard opens. Fix the canvas and the input rail. Success = **≥40 terminal rows keyboard-closed at 14px, ≥20 keyboard-open, and Esc/Ctrl/arrows usable WHILE typing**.

## Work items

1. **Full-bleed attached mode.** On mobile, when a terminal is attached: collapse app header, shell header, mode toggle, card header, and terminal toolbar into ONE slim status row (session title · window name · connection/read-only pill · overflow menu opening the Actions sheet). Window strip compresses to ~28px with auto-scroll-to-active-tab. Remove the fixed-height card (`TmuxPageClient.tsx` `h-[calc(100dvh-15rem)] min-h-[420px]`) — the terminal fills the viewport with NO page scroll. Bottom nav hides in attached mode (back via the status row / swipe to roster). Roster/Actions modes keep current chrome.
2. **Readable type.** Mobile default font 11px → **14px** (`useXtermTerminal.ts` ~:61); settings slider 11–18px (settings store + panel); pinch-to-zoom on the terminal surface adjusting font size live (two-finger — currently two-finger touches are dead in `useTerminalTouchScroll.ts` ~:70,:94).
3. **THE RAIL (replaces both key strips).** One component replacing `TmuxKeyBar` + `VirtualKeyboard` (`TerminalSurface.tsx` ~:129-146):
   - **Default keys: Esc · sticky-Ctrl · ↑ ↓ ← →** (owner-locked ultra-minimal). Sticky-Ctrl: tap = one-shot chord (next OS-keyboard letter is Ctrl-modified), hold = chained combos, double-tap = lock; while active, the arrow cluster swaps to Home/End/PgUp/PgDn (Blink pattern).
   - **Config engine (Termux pattern):** rail contents defined by a JSON config in the settings store — each key = keysym | chord | macro string, with an optional swipe-up popup layer per key. Ship a built-in "expanded" preset (adds Tab · prefix · History · `y↵` approve macro · `/compact` macro) selectable in settings. Long-press on arrows = the nav layer if Ctrl-swap isn't active.
   - **Always visible:** dock the rail in the keyboard inset via the VirtualKeyboard API (`navigator.virtualKeyboard.overlaysContent = true` + `env(keyboard-inset-height)` — Chromium/Brave supports it); fall back to visualViewport positioning. **Delete the CSS that hides key controls when the keyboard opens** (`globals.css` ~:129 `[data-terminal-key-controls] { display:none }`) — that rule is the #1 root cause.
   - Haptic tick (`navigator.vibrate(8)`) on rail keys; never obstruct the OS keyboard's voice-typing key; ~44px targets; no horizontal scroll for the default set.
4. **Cursor by touch (Termius pattern).** Long-press on the terminal enters cursor mode: drag synthesizes arrow-key sequences proportional to cell delta with 2–3 acceleration tiers; release exits. Pure key synthesis (safe in readline/vim/TUIs). Coexists with the existing long-press context menu via a movement threshold (drag = cursor mode, still = menu).
5. **Per-host tmux prefix.** Kill hard-coded `\x02` (`lib/tmuxKeys.ts` ~:8): per-host prefix setting (default C-b) consumed by rail/prefix macros.
6. **Paste on Brave/Android.** Verify `navigator.clipboard.readText()` works (it should on Chromium/Android with permission); make the paste flow prompt-and-work; remove/replace the misleading iOS "tap and hold to paste" hint (`VirtualKeyboard.tsx` ~:124) where inapplicable.
7. **Tests.** Unit: rail config engine (keysym/chord/macro/popup), sticky-Ctrl state machine, prefix setting. Playwright at **412×915 Android metrics**: full-bleed row budget assertion (≥40 rows at 14px), rail visible with keyboard-open simulation, pinch handler smoke. Existing suites green.

## Ownership firewall

You may edit: `apps/dashboard/src/components/(terminal|tmux|mobile|session)/**`, `src/hooks/**` (terminal/keyboard/touch), `src/lib/(tmuxKeys|viewport).ts`, `src/stores/settings.ts` (additive), `src/app/globals.css`, mobile-shell/page-client files for the full-bleed composition (`TmuxMobileShell.tsx`, `TmuxPageClient.tsx`, `SessionWorkbench.tsx`), related tests. You may NOT edit: `packages/**`, `services/**`, `agents/**`, `src/components/layout/**` except hiding bottom-nav in attached mode (minimal, flagged in handoff), terminal WS protocol shapes, `useTerminalConnection.ts` resize logic (FW6-FLOW owns grid policy — coordinate via AI Lead if you must touch it).

## Gates

`pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:smoke:dashboard && pnpm build` — run Playwright from a tmux TTY. Commit per work item, prefix `feat(mobile):`. ≤3 attempts per failure then hold.

## Done

Handoff `tasks/frontend-ux-handoffs/fw6-canvas.md`, committed, then print exactly:
`FW6-CANVAS FROZEN <full-sha>`
