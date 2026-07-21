# FW6-VERIFY — Journey coverage, carried items, docs, device checklist (Wave 6, batch 2)

Lane: FW6-VERIFY · Machine: heavisidelinux · Worktree: `~/dev/wt/ac-fw6-verify` · Branch: `refactor/fw6-verify` (off `origin/refactor/frontend-command-center`; PUSH to origin regularly)
Context: `tasks/2026-07-20-mobile-tmux-ux-plan.md`. This is the LIGHT lane — tests, docs, small carried fixes. Playwright from a tmux TTY.

## Work items

1. **Journey coverage for batch-1 features** (extend `tests/journeys/command-center.journey.spec.ts` — you own it this batch): cold-open restore lands live with zero taps; window-strip tab re-targets the viewer; letterbox activates when the origin session reports an attached client (fixed grid, no resize dispatch during a simulated keyboard transition); rail sticky-Ctrl one-shot sends a control byte; per-host prefix honored in the prefix key; "＋ window here" prefilled launch. Both viewport profiles where meaningful.
2. **Carried small items:**
   - A9: launch/open backend responses emit canonical `/` hrefs instead of legacy `/tmux` (`services/control-plane/src/routes/launch.ts` ~:80, `tmux.ts` ~:37) — redirect stays for compat; tests updated.
   - A10: terminal frame-timing probe short-circuits on `isEnabled()` before any per-frame work; `web-vitals` dynamic import gated on the perf flag.
   - A11: window-strip arrow-key navigation moves focus only; Enter/Space activates (replaces live select-per-keypress); tests.
3. **Docs truth pass for Wave 6:** mobile terminal docs (full-bleed mode, the rail + config engine + sticky-Ctrl + cursor-drag, letterbox behavior and the desktop-attached rule, attach-everywhere + cold-open restore, warm switching); Brave/Android note including the "Use Google services for push messaging" requirement for web push; update anything describing the two old key strips.
4. **Docs-site screenshot** (carried): commit a current Command Center mobile screenshot asset into docs-site.
5. **CHANGELOG 0.4.1** entry covering Wave 6 (accurate to what shipped — check the integrated tree, not briefs).
6. **Owner device checklist:** `docs/device-checklist.md` — a ~10-minute guided S25 Ultra/Brave pass (install/refresh PWA, cold-open restore, rail while typing incl. sticky-Ctrl, pinch font, letterbox with desktop attached, scrollback freeze + pager copy, approve from overlay, push notification incl. the Brave setting) — written so the owner can run it unaided at the wave end.

## Ownership firewall

You may edit: `tests/journeys/**`, `tests/smoke/**` (only if a batch-1 behavior needs an assertion fix — flag it), `services/control-plane/src/routes/(launch|tmux).ts` + their tests (A9 only), `apps/dashboard/src/(components/performance|hooks)/**` (A10 only), `apps/dashboard/src/components/tmux/TmuxWindowStrip.tsx` (A11 only), `docs/**`, `docs-site/**`, `CHANGELOG.md`, related fixtures if A9 changes response shapes (additive). You may NOT edit: anything else in `apps/dashboard/src`, `packages/**`, `agents/**`, `deploy/**`, FW6-PRECISION's new spec files.

## Gates

`pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:smoke:dashboard && pnpm test:journeys && pnpm build`. Commit per work item, prefix `test(journeys):` / `fix(carried):` / `docs:`. ≤3 attempts per failure then hold. If codex quota runs out, freeze what's pushed with an honest partial handoff (`state: held`).

## Done

Handoff `tasks/frontend-ux-handoffs/fw6-verify.md`, committed and pushed, then print exactly:
`FW6-VERIFY FROZEN <full-sha>`
