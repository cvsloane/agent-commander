---
lane: FW1-MODERN
frozen_sha: 76d3c5e2bc5e03c4f3a2f534f053ae6a9bc8f000
attempt: 1
state: frozen
gates:
  lint: pass
  typecheck: pass
  test_ci: pass
  smoke: pass
  build: pass
  go: n/a
proof:
  - "pnpm install → completed first in the fresh worktree before repository changes"
  - "pnpm exec tsc --version → Version 7.0.2"
  - "pnpm lint → 5/5 Turbo tasks passed with zero lint warnings"
  - "pnpm typecheck → 5/5 Turbo tasks passed on the TypeScript 7.0.2 toolchain"
  - "pnpm test:ci → 72 test files and 323 tests passed across all four workspaces"
  - "pnpm test:smoke:dashboard → 10/10 Chromium scenarios passed across desktop, mobile, and tablet flows"
  - "pnpm build → 4/4 Turbo build tasks passed; Next.js 16.2.10 production build completed"
  - "CHOKIDAR_USEPOLLING=1 WATCHPACK_POLLING=true bash -c 'pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:smoke:dashboard && pnpm build' → complete mandatory gate passed in order"
  - "frontend-product-design audit_frontend.sh → lint, typecheck, and test passed; browser smoke supplied equivalent UI-preservation verification"
  - "git diff --name-only refactor/frontend-command-center...76d3c5e2bc5e03c4f3a2f534f053ae6a9bc8f000 -- protected paths → empty"
  - "git diff refactor/frontend-command-center...76d3c5e2bc5e03c4f3a2f534f053ae6a9bc8f000 suppression scan → no net-new eslint-disable, @ts-expect-error, @ts-ignore, or any cast"
assumptions:
  - "Node 24 is the latest LTS-matching major, so existing @types/node declarations were upgraded to 24.13.3."
uncertainties:
  - "Protected @react-three/fiber 8 and Drei 9 packages still declare React 18 peer ranges; they were intentionally left unchanged. Typecheck, smoke, and the production /visualizer route build all pass under React 19."
blockers: []
---

# FW1-MODERN handoff

## What changed

- TypeScript is 7.0.2 in the root and every existing workspace declaration. Existing Node type declarations are on the Node 24 LTS line. Next route type generation uses an `@typescript/native-preview` package alias to the stable TypeScript 7 package because Next 16.2.10 otherwise expects the removed JavaScript compiler entrypoint. Explicit workspace typechecking continues to run `tsc` 7.0.2.
- ESLint is 10.7.0. The legacy eslintrc was replaced by flat configs, `eslint-plugin-react-hooks` is 7.1.1 with the pinning override removed, and legacy React/import/a11y plugins are adapted with the official `@eslint/compat` wrapper.
- A small lint-only compatibility package gives `typescript-eslint` 8.64.0 its supported TypeScript 5.9 parser runtime while all application and workspace compilation remains on TypeScript 7. This isolates the current parser limitation instead of weakening lint coverage.
- `SessionList` now keys its memo from `data`, and `MobileLaunchSheet` memoizes `data?.targets`; these resolve the compiler diagnostic and all three exhaustive-deps warnings without suppressions or behavior changes.
- ESLint 10 mechanical fixes outside the dashboard add an error cause, remove unused final parameter increments and redundant initializers, and delete one obsolete `no-console` suppression. No unrelated runtime or feature work was included.
- React and React DOM are 19.2.7 with React 19 type packages. A dashboard-level React JSX type bridge exposes the existing R3F 8 `ThreeElements` under React 19's module-scoped JSX namespace; no visualizer source or dependency was touched.
- `tailwind-merge` is 3.6.0 and `lucide-react` is 1.25.0. Existing imports and call sites remained source-compatible, so no UI code or styling changed.

## Decisions and compatibility notes

- `next` remains 16.2.10, Zod remains 3.25.76 in every declaring workspace, and `next-auth`, R3F, Drei, Three, Vitest, and Playwright declarations are unchanged.
- `pnpm install` reports declared-peer warnings because `typescript-eslint` has not declared TypeScript 7 support, the legacy React/import/a11y plugins have not declared ESLint 10 support, and the protected R3F/Drei generation declares React 18. The isolated parser runtime plus `@eslint/compat` make lint operational; React typecheck, browser smoke, and production build prove the protected visualizer dependency set was not changed to silence its warning. No `next-auth` React 19 warning was emitted.
- Next prints that some framework TypeScript features require the standard compiler package when it detects the native compiler. This is documented rather than hidden: route type generation succeeds, the explicit TypeScript 7 workspace gate succeeds, and the production build succeeds.
- Test output retains non-failing control-plane mock diagnostics and dashboard smoke fixture-validation fallbacks for omitted `capture_hash`/`groups` fields, plus the harness's `NO_COLOR`/`FORCE_COLOR` notice. All tests pass; schema and test-fixture changes were outside this mechanical lane.
- The ownership firewall audit found no changes under `agents/**`, `migrations/**`, `deploy/**`, `components/botspace/**`, `components/visualizer/**`, or `app/(visualizer)/**`.

## Frontend preservation audit

This lane intentionally changes no visual design. The scope-limited regression score is 93/100 with no hard fails: product fit 15/15, information architecture 15/15, visual design 15/15, dashboard/data clarity 15/15, interaction states 8/10, accessibility 11/15, responsive behavior 10/10, and performance polish 4/5. The deductions reflect that the mechanical lane did not add exhaustive state, accessibility, or performance benchmarks. Existing browser coverage verified sign-in, key operator pages, tmux interactions, launch and steering actions, and desktop/mobile/tablet layouts; with no route, DOM, or styling edits, screenshots of changed routes were not applicable.

## Phase commits

- `9d6e9d0` — `chore(modern): upgrade to TypeScript 7`
- `65cc1b4` — `chore(modern): upgrade to ESLint 10`
- `20ee1f6` — `chore(modern): upgrade to React 19`
- `76d3c5e` — `chore(modern): upgrade UI utilities`

FW1-MODERN FROZEN 76d3c5e2bc5e03c4f3a2f534f053ae6a9bc8f000
