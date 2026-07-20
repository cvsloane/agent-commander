---
lane: W6-CLEANUP
branch: refactor/wave6-cleanup
frozen_sha: 706235973ac9ad14181c7e47a97cb67afc5b6b5b
attempt: 1
gate:
  commands:
    - pnpm --filter @agent-command/dashboard test
    - pnpm lint
    - pnpm typecheck
    - CHOKIDAR_USEPOLLING=1 WATCHPACK_POLLING=true pnpm build
    - CHOKIDAR_USEPOLLING=1 WATCHPACK_POLLING=true PLAYWRIGHT_BASE_URL=http://127.0.0.1:3210 PLAYWRIGHT_ACCESS_CODE=playwright-access pnpm test:smoke:dashboard
  results:
    - command: pnpm --filter @agent-command/dashboard test
      status: passed
      detail: 12 test files and 66 tests passed.
    - command: pnpm lint
      status: passed
      detail: All four workspace packages passed with zero errors; dashboard retained three pre-existing exhaustive-deps warnings in MobileLaunchSheet.tsx.
    - command: pnpm typecheck
      status: passed
      detail: All four workspace packages passed, including generated Next.js route types.
    - command: CHOKIDAR_USEPOLLING=1 WATCHPACK_POLLING=true pnpm build
      status: passed
      detail: Schema, CLI, control plane, and dashboard production builds passed; Next.js emitted the static /visualizer route.
    - command: production dashboard start plus pnpm test:smoke:dashboard
      status: passed
      detail: The production Next.js server on 127.0.0.1:3210 passed all 10 Chromium smoke tests in 7.8 seconds.
assumptions:
  - The permanent /workshop redirects are the supported compatibility surface after deleting the unreachable workshop route group.
  - The visualizer state store is the canonical owner of draw controls formerly exposed through workshopVibe.
  - Major dependency migrations require dedicated compatibility work and are outside this patch/minor cleanup lane.
  - The implementation commit is frozen separately from this handoff-only commit.
uncertainties:
  - pnpm audit retains one moderate transitive uuid@8.3.2 advisory through next-auth@4.24.14; the patched uuid line begins at 11.1.1 and requires a major dependency change.
  - eslint-plugin-react-hooks is compatibility-pinned at 7.0.1 because 7.1.1 enables a new compiler diagnostic in the existing SessionList implementation; that migration needs a separately scoped UI cleanup.
  - actionlint was unavailable; the changed workflow YAML passed Prettier parsing, the release-note extraction command was exercised against 0.3.0, and the workflow diff was reviewed directly.
  - The host fs.inotify.max_user_instances limit is 128. Polling allowed the build, but next dev still exhausted the shared host quota, so the authorized production-server smoke fallback was used.
blockers: []
---

# Wave 6 CLEANUP handoff

## Summary

- Deleted the unreachable `(workshop)` route group and its seven legacy stylesheets, removed the `workshopVibe` compatibility store, and moved its remaining caller to the canonical visualizer state store. The permanent `/workshop` redirects to `/visualizer` remain intact.
- Removed dead sidebar badge and deprecated approval-count branches, plus no-op visualizer theme lifecycle code.
- Kept visualizer CSS inside the visualizer route layout and converted all three themes to Next.js client-only dynamic imports. The production artifacts show a visualizer-only CSS chunk, and the Three/R3F implementation remains split into lazy chunks.
- Completed the patch/minor dependency sweep. The audit moved from 15 advisories to one moderate transitive advisory, and `pnpm outdated --recursive` now reports only major-version migrations plus the deprecated `@types/bcryptjs` stub.
- Corrected deployment and single-replica operations guidance; expanded configuration coverage; added control-channel, PWA/Web Push, and per-viewer terminal guides; and linked the new guides from the documentation index.
- Added the 0.3.0 changelog entry, made workspace test coverage explicit in CI, preserved Go build/vet/test coverage, and taught releases to extract the matching changelog section for GoReleaser notes.
- Verified all public assets are still referenced, so no asset deletion was warranted.

## Cleanup assessment

| Track                | Result                                                                                                          | Confidence |
| -------------------- | --------------------------------------------------------------------------------------------------------------- | ---------- |
| Deduplication        | Removed the workshop state wrapper; `DrawPalette` now consumes `visualizerState` directly.                      | High       |
| Shared contracts     | Reused the canonical visualizer store shape without introducing a duplicate type.                               | High       |
| Unused code          | Removed the unreachable route/CSS, dead sidebar branches, and no-op effects; retained referenced public assets. | High       |
| Dependency cycles    | No new dependency direction or cross-layer import was introduced.                                               | High       |
| Safer typing         | The surviving draw caller uses the existing typed Zustand store without casts or suppression.                   | High       |
| Error handling       | No error boundary, retry, or async failure path was changed in this cleanup.                                    | N/A        |
| Legacy paths         | Deleted implementation code while preserving both permanent workshop redirect patterns.                         | High       |
| Generated/AI residue | Removed explanatory no-op lifecycle code that had no runtime behavior.                                          | High       |

## Deferred dependency work

The remaining latest-version differences are major migrations: Deepgram SDK 4 to 5, React Three Drei 9 to 10, React Three Fiber 8 to 9, Node types 20 to 26, React/React DOM and their types 18 to 19, Commander 14 to 15, ESLint 9 to 10, jose 5 to 6, pino-pretty 10 to 13, tailwind-merge 2 to 3, TypeScript 5 to 7, ulid 2 to 3, Zod 3 to 4, and lucide-react 0.x to 1.x. The deprecated `@types/bcryptjs` package and the React Hooks compatibility pin should also be handled in dedicated migrations.

## Operations follow-up

The shared development host currently allows only 128 inotify instances. An operator should raise the host limit with:

```bash
sudo sysctl fs.inotify.max_user_instances=1024
```

No other tmux sessions were stopped. The final build used `CHOKIDAR_USEPOLLING=1 WATCHPACK_POLLING=true`; because the Playwright `next dev` webServer still hit the quota, the smoke suite ran against the successful production build via `next start`.

The `frozen_sha` is the final implementation commit; the following handoff-only commit adds this file.

W6-CLEANUP FROZEN 706235973ac9ad14181c7e47a97cb67afc5b6b5b
