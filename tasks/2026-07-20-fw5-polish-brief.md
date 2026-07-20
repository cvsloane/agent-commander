# FW5-POLISH — Motion, a11y, perf probes, final visual pass (Wave 5)

Lane: FW5-POLISH · Machine: homelinux · Worktree: `~/dev/wt/ac-fw5-polish` · Branch: `refactor/fw5-polish` (off `refactor/frontend-command-center`; local, do NOT push)
Plan: Workstream E (polish) + F (probes) · Acceptance: checklist Wave 5. This is a TIMEBOXED polish lane — anything beyond this brief goes to BACKLOG.md, not the diff.

## Work items

1. **Loading/empty/transition polish.** Skeleton states for roster and fleet-card loads (no layout shift); consistent empty states (roster with no sessions, attention queue empty, hosts empty) with a single reusable pattern; smooth roster↔terminal mode transitions on mobile (CSS transitions; no new animation deps); connection-banner and toast stacking sanity.
2. **A11y pass.** Roster tree: proper roles/aria-expanded; icon-only buttons: aria-labels; new sheets/dialogs: verified focus trap + Esc + return focus; window strip + key bar keyboard operability on desktop; `focus-visible` states consistent; prefers-reduced-motion respected for anything you animate.
3. **Safe-area/keyboard audit.** Verify bottom nav, key bar, composer, and search sheet against iOS safe-area insets and the keyboard-aware viewport var on the 390×844 viewport; fix any overlap you find.
4. **Perf probes (Workstream F leftover).** Wire `web-vitals` reporting and a terminal frame-timing probe (WS output frame → xterm paint, sampled) into the existing metrics/telemetry path — measurement only, no dashboards. Delete the dead JSON terminal-output client branch (`components/terminal` — binary is always negotiated).
5. **Dark/light harmony check.** Sweep the new Wave-3/4 surfaces in both themes for token misuse (hardcoded colors) and fix.
6. **Tests.** Existing suites green; add a11y smoke assertions (roles/labels) where cheap; no behavior changes to data flows.

## Ownership firewall

You may edit: `apps/dashboard/src/**` (visual/a11y/motion/probe edits only — NO data-flow or feature behavior changes), `apps/dashboard/package.json` ONLY if `web-vitals` isn't already present (list it in handoff), related tests. You may NOT edit: `packages/**`, `services/**`, `agents/**`, `tests/smoke/**` (FW5-QA owns the journey suite), `deploy/**`, program task docs.

## Gates

`pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:smoke:dashboard && pnpm build` — run smoke from a real TTY (tmux window) — this repo's smoke hangs under non-TTY harnesses. Commit per work item, prefix `polish:`. ≤3 attempts per failure then hold.

## Done

Handoff `tasks/frontend-ux-handoffs/fw5-polish.md`, committed, then print exactly:
`FW5-POLISH FROZEN <full-sha>`
