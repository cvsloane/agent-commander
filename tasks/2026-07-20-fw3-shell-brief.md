# FW3-SHELL — Command Center landing + navigation + attention unification + launch rail (Wave 3)

Lane: FW3-SHELL · Machine: homelinux · Worktree: `~/dev/wt/ac-fw3-shell` · Branch: `refactor/fw3-shell` (off `refactor/frontend-command-center`; local, do NOT push)
Plan: `tasks/2026-07-20-frontend-tmux-ux-master-plan.md` (Workstream A) · Evidence: `tasks/2026-07-20-frontend-ux-study-findings.md` §§0-1 (read first) · Acceptance: `tasks/frontend-ux-acceptance-checklist.md` Wave 3.

## Mission

Make the first paint of the app the fleet. Kill the v0.2.0 landing, unify the duplicated navigation and attention surfaces, and give launch a persistent home. This is the wave the owner SEES — mobile-first quality matters. Load the `frontend-product-design` skill approach you normally use; keep the existing design tokens.

## Work items

1. **Command Center landing.** `/` becomes the Command Center: promote the current `/tmux` experience (`TmuxPageClient`) to the root route, framed with an attention summary strip (count + top item, tapping opens the attention surface) and the launch rail (item 4). Delete the legacy hero-card page; relocate its quick stats/usage into `/settings` (usage section) — do not lose data surfaces, move them. `/tmux` becomes a redirect to `/`. Signin `callbackUrl` and PWA `manifest.json` `start_url` point at `/`. Push deep links that used `/orchestrator` keep working (item 3 owns where they land).
2. **Navigation unification.** Bottom tabs become: Command Center (`/`), Attention, Sessions, More. Remove the header hamburger — the drawer opens ONLY from More; the header slims to logo + connection state + attention bell + theme/account. One breakpoint contract: a single `useIsMobile` source with named constants (nav/mobile detection 768; the Command Center's internal desktop/mobile shell switch may keep 1024 but must consume the same hook with an explicit parameter, no ad-hoc `md:`-vs-JS divergence for the shell). Consistent ≥44px tap targets on all nav.
3. **One attention surface.** Merge `OrchestratorModal` (header-bell bottom sheet) and `OrchestratorPageClient` (full page) into ONE component tree fed by `useAttentionQueue`: rendered as a sheet on desktop (bell) and a full page on mobile (tab + bell both route there). Delete the duplicated implementation. `/orchestrator` stays as the route for the page presentation (deep links unchanged). The Fleet tab content stays as-is inside it (Wave 4 reworks fleet internals).
4. **Launch rail.** A persistent launch entry visible on Command Center and Sessions: New (opens `MobileLaunchSheet` — now the single launch surface on ALL form factors), Recent (recent-launch store), Open existing (tmux open flow). Delete `components/SpawnSessionDialog.tsx` (legacy, unreferenced). Centralize provider/template definitions: one module exporting `LAUNCH_PROVIDERS` + `SESSION_TEMPLATES`, consumed by `MobileLaunchSheet` and `session-generator` (make `RepoPicker` recent-first while you're in there; keep its tree browse as secondary).
5. **Tests.** Update/extend Playwright smoke + unit tests for: `/` renders Command Center on mobile+desktop viewports, `/tmux` redirects, bell and tab reach the same attention surface, launch rail opens the sheet, deleted surfaces gone. All existing suites green.

## Ownership firewall

You may edit: `apps/dashboard/src/app/**` (route files, layout.tsx, manifest/signin bits), `src/components/layout/**`, `src/components/orchestrator/**`, `src/components/launch/**`, `src/components/session-generator/**`, `src/components/SpawnSessionDialog.tsx` (delete), `src/components/notifications/**`, `src/stores/ui.ts` + `src/stores/orchestrator.ts` (modal/nav state), `src/hooks/useIsMobile.ts`, `public/manifest.json`, related tests. You may NOT edit: `src/components/tmux/**` (FW3-TMUX-UI owns it — consume `TmuxPageClient` as-is via import/move of the ROUTE file only), `src/components/terminal/**`, `src/components/session/**`, terminal hooks, `packages/**`, `services/**`, `agents/**`, `deploy/**`. If promoting `TmuxPageClient` to `/` requires a prop change inside it, propose it in your handoff instead of editing the file.

## Gates

`pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:smoke:dashboard && pnpm build`. Commit per work item, prefix `feat(shell):`. ≤3 attempts per failure then hold.

## Done

Handoff `tasks/frontend-ux-handoffs/fw3-shell.md`, committed, then print exactly:
`FW3-SHELL FROZEN <full-sha>`
