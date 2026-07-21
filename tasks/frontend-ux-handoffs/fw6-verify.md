---
lane: FW6-VERIFY
branch: refactor/fw6-verify
base_sha: 427c07a387de52e977d717e7d82a9688aca2a02d
scope_sha: f01db7c323b5905981030a09fd2b823ac55c2c7d
state: frozen
gates:
  setup: pass
  lint: pass
  typecheck: pass
  test_ci: pass
  smoke: pass
  journeys: pass
  build: pass
blockers: []
---

# FW6-VERIFY frozen handoff

## Outcome

Wave 6 batch-2 verification is complete and frozen. The branch is rebased on
the requested `427c07a` integration and every work item is committed and pushed:

- Cross-viewport journeys cover cold-open restore, live window retargeting, and
  focus-before-activation window keyboard navigation.
- Mobile journeys cover desktop-attached letterboxing through a keyboard
  transition, one-shot sticky Ctrl, the exact `0x01` byte for a host configured
  with `C-a`, and **New window here** with attached-context prefill.
- A9 makes launch and tmux-open responses emit canonical `/` Command Center URLs.
- A10 makes terminal frame timing and Web Vitals collection opt-in before their
  sampler/import paths do work.
- A11 makes Arrow/Home/End navigation focus-only; Enter and Space activate.
- The Wave 6 docs truth pass, Brave push requirement, current 412x915 Command
  Center screenshot, 0.4.1 changelog, and owner-run S25 Ultra checklist are in
  the docs site.

The upstream pointer-up, test-overlay, pane-sheet action, and persistent
`hostId` fixes are proven on the public paths. The correction chain is retained
in `tasks/lessons.md` so future touch-byte tests cover all three boundaries.

## Pushed commits

- `b7c37b2` — restored mobile terminal journeys: cold open, window retargeting,
  letterbox stability, and sticky Ctrl.
- `5e7864f` — mobile pane-actions **New window here** journey.
- `9db9565` — exact per-host Prefix byte journey (`C-a` -> `0x01`).
- `96ae3af` — A9 canonical launch/open response hrefs and route tests.
- `9264240` — A10 opt-in performance wrappers and focused tests.
- `d2e2676` — A11 focus-only window navigation and cross-viewport journey.
- `c55f577` — integrated Wave 6 mobile terminal docs truth pass.
- `be51dab` — visually inspected 412x915 docs-site screenshot.
- `01d4977` — accurate 0.4.1 Wave 6 changelog.
- `f01db7c` — guided Galaxy S25 Ultra/Brave device checklist and docs indexes.

Earlier held handoff commits remain in history as an honest record of the two
upstream blockers and their diagnosis. They contain no failing tests or product
workarounds.

## Verification

The mandatory gate ran after the last product/docs commit:

- `pnpm lint` — pass. One existing non-failing exhaustive-deps warning remains
  in `useXtermTerminal.ts`.
- `pnpm typecheck` — pass.
- `pnpm test:ci` — pass: dashboard 57 files/201 tests, control plane 49
  files/199 tests, schema 8 files/50 tests, and CLI 3 files/44 tests.
- `pnpm test:smoke:dashboard` from tmux with Next polling — 21/21 passed.
- `pnpm test:journeys` from tmux with Next polling — 27 passed, 9 declared
  viewport-specific skips.
- `pnpm build` with Next polling — pass for all four workspaces; the dashboard
  production build compiled and generated all routes.

Focused real-browser receipts also passed for the 412x915 screenshot, Prefix
byte, New-window-here, and A11 mobile/desktop navigation paths.

## Artifacts

- Mobile guide: `docs/command-center.md`
- Device checklist: `docs/device-checklist.md`
- Screenshot: `docs-site/images/command-center-mobile.png` (412x915 PNG,
  SHA-256 `43c33feaf8aca49dbf4af3352a808dccf3e3c7fd227b3befd7a211a54fdd3b6f`)
- Release notes: `CHANGELOG.md` (`0.4.1`, dated 2026-07-20)

No production state, deployment files, secrets, or user tmux sessions were
changed. The branch and origin were identical at `scope_sha` before this final
handoff commit.
