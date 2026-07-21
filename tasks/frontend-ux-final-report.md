# Frontend Command Center UX Program — Final Report

Program: `tasks/2026-07-20-frontend-tmux-ux-master-plan.md` · Started 2026-07-20 ~13:30Z · Completed 2026-07-20 ~23:05Z (~10h wall clock) · AI Lead: Claude (Fable 5) · Builders: codex gpt-5.6-sol (xhigh), 10 lanes + 5 correction rounds across homelinux + heavisidelinux.

## Accepted outcome

All five waves shipped to production individually (PRs #86–#90, each CI-green, independently reviewed, deploy-verified by `SOURCE_COMMIT`). Final state: main `6e928a4`, tagged **v0.4.0**, live at agents.heavisidetechnology.com with both hosts connected on the new agentd (topology events active).

The app now: opens into the Command Center (fleet-first landing, old dashboard deleted); provides native-grade tmux interaction (live topology window strip, window/pane management, splits/zoom, scrollback paging + search, desktop 2-up terminals, mobile quick-switch, persistent cross-route terminal); layers agent superpowers on top (attention overlay with inline approve/deny, prompt composer with read-only gating, unified fleet on one aggregate endpoint, health badges, ⌘K palette); and is operable end-to-end (Add Host enrollment flow, launch rail, unified attention surface, modernized TS7/React19/Zod4 stack, 14-journey Playwright suite).

## Deliverable references

Frozen lanes (handoffs in `tasks/frontend-ux-handoffs/`): FW1-MODERN 76d3c5e · FW1-TMUX-GO 7a8e6ee (R2) · FW2-CONTRACTS 38c1a12 (R2) · FW2-TERM 9b34dfb · FW3-SHELL 5bba177 · FW3-TMUX-UI c2bcfbe (R2) · FW4-FLEET f0d7b89 (R2) · FW4-SURFACES 295c9c0 (R2) · FW5-POLISH 9ceed37 · FW5-QA 75d1839. Acceptance: `tasks/frontend-ux-acceptance-checklist.md` (reconciled with evidence per box). Board/log/metrics: `tasks/frontend-ux-status.md`, `frontend-ux-log.md`, `frontend-ux-metrics.jsonl`.

## Defects caught internally (never reached production)

1. **Critical (Wave 1, reviewer HOLD):** agentd's topology emission would have crash-looped the agent socket against the deployed CP — shipped default-off, CP tolerance added in Wave 2, then fleet-wide rollout.
2. tmux hook pollution on agentd crash; stale terminal-viewer leak (Wave 1 R2).
3. Fleet endpoint unbounded scan + N+1 and missing role check (Wave 2 R2).
4. Topology staleness freeze + duplicate roster fetches on the hot path (Wave 3 R2); optimistic-confirm and version-gating refinements.
5. Aggregate reconcile clobbering fresher WS state; read-only bypass via composer/Respond; Ctrl+K readline collision; one-time-token heap lingering (Wave 4 R2s).
6. **AI Lead's own brief error:** ordered deletion of a "dead" JSON terminal fallback that a pre-hello race can still exercise — caught by the Wave-5 reviewer, fallback restored, full migration backlogged.
7. Deploy-layer seams (Docker workspace copy, deleted eslintrc) and 16 CodeRabbit findings triaged (real ones fixed, rest resolved with justification).

## Autonomy actions & human interventions

- Owner directives honored mid-program: full autonomy for merges/deploys; both-machine lane distribution; tmux window/pane hygiene + reuse (with a caught-before-damage mis-key into a live owner codex pane, now a written rule); homelinux host enrollment + agentd rollouts (owner-executed `!` commands where the permission layer blocked credential/daemon actions — no workarounds attempted).
- Liveness saves: two staged-but-unsubmitted codex prompts caught by watchers; codex safety-dialog kept on assigned model; environment diagnoses (stale `.next` cache, non-TTY Playwright hangs) resolved with written lessons.

## Remaining for owner

1. **On-device pass** (install, push, terminal typing on your Galaxy S25 Ultra in Brave — see the Wave-6 addendum and docs/device-checklist.md) — the only unchecked acceptance item that needs you; everything else was verified in Chromium at mobile/desktop viewports.
2. BACKLOG.md carries four scoped follow-ups: complete binary-only terminal migration, probe short-circuit polish, window-strip arrow auto-activation review, docs-site screenshot.
3. GitHub release notes for v0.4.0 generate from the CHANGELOG if the release workflow is run.

## Recovery

Every wave is an independent merge commit on main (`d565b00`→`effab04`→`f3df15d`→`fa0ba72`→`6e928a4`); rollback = redeploy any prior SHA. agentd backups: `~/.local/bin/agentd.bak-fw2` (heavisidelinux). Pre-program DB backup unchanged (no migrations were needed — 038 remains the head).

## Addendum — Wave 6 (mobile tmux UX, 2026-07-20/21)

The program was reopened by owner directive as Wave 6, run in two batches (4 lanes: FW6-CANVAS, FW6-FLOW, FW6-PRECISION, FW6-VERIFY across both machines) with per-batch adversarial reviews. Delivered on top of v0.4.0: full-bleed mobile terminal (≥40 rows @14px, assertion-tested at S25-Ultra metrics), the single configurable key rail docked in the keyboard inset with sticky-Ctrl and per-host prefixes, touch cursor-drag, attach-everywhere with zero-tap cold-open restore, desktop-shared letterbox grid pinning (agentd `window-size manual` with crash-sweep release), scroll-freeze reading, custom touch selection with exact-range copy, thumbnail pane switcher, spatial pane navigation, command marks (pane-scoped OSC-133 passthrough + labeled agent-turn heuristics), and a 27-journey suite with byte-level input assertions. Nine integration-seam defects were caught internally by gates and reviews before merge — including two in the AI Lead's own fixes, a harness-level dev-overlay tap interception masquerading as a product bug, and a HIGH where the command-marks feature would have shipped inert due to a wrong tmux option scope. Ships as v0.4.1 (PR #91). Final acceptance: owner's on-device checklist (`docs/device-checklist.md`) post-deploy. Next program: Hermes deep integration (owner-selected).
