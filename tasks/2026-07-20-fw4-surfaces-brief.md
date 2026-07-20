# FW4-SURFACES — Design-system primitives, surface migration, decomposition, command palette (Wave 4)

Lane: FW4-SURFACES · Machine: homelinux · Worktree: `~/dev/wt/ac-fw4-surfaces` · Branch: `refactor/fw4-surfaces` (off `refactor/frontend-command-center`; local, do NOT push)
Plan: Workstream E · Evidence: findings doc §§1,4,5 · Acceptance: checklist Wave 4. Load your frontend-product-design approach; the existing HSL-token system is the source of truth.

## Work items

1. **Complete `components/ui` primitives.** Add shadcn-style `dialog`, `sheet`, `dropdown-menu`, and `command` primitives on Radix (Radix deps that are already in the tree; if a new Radix package is genuinely required, it is the ONLY allowed dependency addition — list it in the handoff). Migrate the hand-rolled modals/sheets in YOUR owned surfaces (below) onto them. Do not touch other lanes' modals.
2. **Surface migration.** Restyle `/sessions`, `/memory`, `/hosts`, `/automation` to the design system: one container/spacing convention, ≥44px tap targets, mobile-fit toolbars (Sessions' ~10-button toolbar collapses into a mobile overflow sheet keeping Select/Search/New visible). Preserve all functionality — this is composition/presentation, not feature change.
3. **Decomposition.** `SettingsPanel.tsx` (1125) → per-domain panels (alerts, session defaults, launch, workspace, notifications, usage) under `components/settings/`, one route shell; `SessionsPageClient.tsx` (666) → filter/selection/dnd hooks + presentational list components; `SessionList.tsx` (643) → row + list + virtualization concerns split. Behavior-identical; existing tests keep passing (add targeted tests for extracted hooks).
4. **Command palette.** `components/ui/command`-based ⌘K/Ctrl-K palette (desktop; long-press search affordance opens it on mobile via the existing search entry): jump to session (fuzzy by title/host), jump to host, launch (opens launch sheet), toggle theme, go to route. One minimal mount allowed in `components/layout/LayoutShell.tsx` (single line, like the terminal host) + a keyboard listener. Palette actions route through existing stores/APIs — no new data paths.
5. **A11y pass on your surfaces**: focus traps in new sheet/dialog usages, aria labels on icon buttons, focus-visible states.
6. **Tests.** Palette open/navigate test, settings panels render test, sessions toolbar overflow test at 390×844, all suites green.

## Ownership firewall

You may edit: `src/app/(dashboard)/(sessions|memory|hosts|automation|settings)/**` (page/shell files), `src/components/ui/**`, `src/components/settings/**`, `src/components/SessionList.tsx`, `src/components/search/**`, `src/components/groups/**`, `src/components/import/**`, `src/components/analytics/**`, related tests; single-line palette mount + listener in `components/layout/LayoutShell.tsx`. You may NOT edit: `src/components/(orchestrator|tmux|terminal|session|launch|automation)/**` except `automation` PAGE shell (`app/(dashboard)/automation/**` yes; `components/automation/**` no — FW4-FLEET owns it), `src/app/(dashboard)/page.tsx` / orchestrator routes, `packages/**`, `services/**`, `agents/**`.

## Gates

`pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:smoke:dashboard && pnpm build`. Commit per work item, prefix `feat(surfaces):`. ≤3 attempts per failure then hold.

## Done

Handoff `tasks/frontend-ux-handoffs/fw4-surfaces.md`, committed, then print exactly:
`FW4-SURFACES FROZEN <full-sha>`
