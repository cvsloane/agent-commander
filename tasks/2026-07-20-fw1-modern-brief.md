# FW1-MODERN — Frontend-stack modernization (Wave 1)

Lane: FW1-MODERN · Machine: homelinux · Worktree: `~/dev/wt/ac-fw1-modern` · Branch: `refactor/fw1-modern` (off `refactor/frontend-command-center`; local, do NOT push)
Program: `tasks/2026-07-20-frontend-tmux-ux-master-plan.md` · Acceptance: `tasks/frontend-ux-acceptance-checklist.md` (Wave 1 / FW1-MODERN section is your contract)

## Mission

Move the TypeScript stack to the modern baseline the rest of the program builds on. **Mechanical only** — zero intended behavior change. Every later lane rebases on your work; correctness and a green production build matter more than speed.

## Exact targets (current → target)

| Dep | Current | Target |
|---|---|---|
| typescript (root + all workspaces) | ^5.9.3 | 7.x (native compiler) |
| eslint | ^9.39.5 | ^10 |
| eslint-plugin-react-hooks | pinned 7.0.1 (pnpm override) | latest 7.x/8.x, override removed |
| react / react-dom (dashboard) | ^18.3.1 | ^19 |
| @types/react (dashboard) | ^18.3.31 | ^19 |
| @types/node (all) | ^20.19.43 | latest LTS-matching major |
| tailwind-merge (dashboard) | ^2.6.1 | ^3 |
| lucide-react (dashboard) | ^0.460.0 | ^1.x |

Explicitly NOT in scope: zod (stays ^3.25.76 — moves in Wave 2), next (16.2.10 stays), next-auth (stays; document any React-19 peer warnings rather than resolving them with dep changes), @react-three/fiber / drei / three (visualizer — untouched), vitest/playwright majors (only touch if a target above forces a compatible bump; document it).

## Ownership firewall

You may edit: `package.json` files + `pnpm-lock.yaml`, `tsconfig*.json`, eslint configs, `turbo.json` (script/tooling adjustments only), and TS/TSX source anywhere **outside `agents/**`** for mechanical migration fixes. You may NOT: change runtime behavior or UI, add/remove features, touch `agents/**`, `migrations/**`, `deploy/**`, or anything visualizer-specific (`components/botspace/**`, `components/visualizer/**`, `app/(visualizer)/**` — if a mechanical fix is unavoidably required there to compile, keep it minimal and list it in the handoff).

## Phases (commit per phase, message prefix `chore(modern):`)

1. **TS 7**: bump typescript across workspaces; adjust tsconfigs/turbo scripts for the native compiler; `pnpm typecheck` green. Record `tsc --version` in the handoff.
2. **ESLint 10 + hooks unpin**: bump eslint, unpin eslint-plugin-react-hooks (remove the pnpm override); fix `apps/dashboard/src/components/SessionList.tsx` so the new react-hooks compiler diagnostic passes **by fixing the component, not disabling the rule**; fix the 3 exhaustive-deps warnings in `components/launch/MobileLaunchSheet.tsx` properly; `pnpm lint` green with zero suppressions added.
3. **React 19**: react/react-dom/@types bumps; apply mechanical API migrations (types, ref changes, removed APIs); `pnpm test:ci` + `pnpm test:smoke:dashboard` green.
4. **tailwind-merge 3 + lucide 1.x**: API/import renames; visual behavior identical.
5. **Full gate**: `pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:smoke:dashboard && pnpm build`. The production build is mandatory — this wave deploys.

## Rules

- If TS 7 hits a hard blocker (compiler bug, unsupported config), make ≤3 distinct attempts; then set `state: held` in your handoff with exact evidence — the approved fallback (TS 5 stays this program) is the AI Lead/owner's call, not yours. Same protocol for React 19.
- No `eslint-disable`, `@ts-expect-error`, or `any`-casts to make gates pass unless the exact same suppression already existed; net-new suppressions must be listed in the handoff with justification.
- Keep each phase's diff reviewable; don't reformat unrelated code.

## Done

All acceptance items checked, full gate green, handoff written to `tasks/frontend-ux-handoffs/fw1-modern.md` (schema in that directory's README) and committed on your branch, then print exactly:

`FW1-MODERN FROZEN <full-sha>`
