# Android Tmux Parity — Status

- State: executing
- Approval: approved at 2026-07-23T00:19:00-04:00
- Baseline source/production: `da607024218325a264951d9f9a7f5a5ba5891e24`
- Baseline APK: v0.1.2/code3, SHA-256 `9d78cd03457a4d26749530859fe495f1241472a2288523673a456238146b045c`
- Owner-confirmed baseline: physical Samsung terminal renders and remote tmux scrolling works

## Current Truth

Read-only discovery is complete. The existing backend can support the planned native tmux workbench without a new transport or renderer. The first implementation slice must correct Android's conflation of authoritative pane state and controller ownership, add `viewer_state` reconciliation, and activate local read-only history before broader parity work.

The plan and checklist are approved. W1 and W2 are ready to launch in isolated non-colliding lanes; no implementation has been integrated or released yet.

## Workstreams

| Workstream | State | Owner | Next gate |
|---|---|---|---|
| W0 baseline/contract | accepted | AI Lead | Complete |
| W1 interaction authority/scroll | accepted | Android Builder + fresh Reviewer | Complete |
| W2 topology/API/domain | accepted after correction | Android Builder + fresh Reviewer | Complete |
| W3 workbench UI | correction running | Android Builder | Claude reachability and UI-stream lifecycle re-review |
| W4 window/pane lifecycle | backend prerequisite accepted; Android UI waits | Backend Builder + fresh Reviewer | W3 accepted |
| W5 release | pending | AI Lead + critical Reviewer | W1-W4 accepted |

W1 owns the Android activity/terminal interaction seam in isolated worktree `android-tmux-parity-w1`. W2 owns Android data/domain/preferences in isolated worktree `android-tmux-parity-w2`; their declared paths do not overlap.

Integrated source `ec5a271` passes the full Android test/lint/release gate. Fresh review passed W1 and passed W2 after `af01e43` made live topology authoritative for add/remove/live-only membership while preserving durable attach metadata. W3 is cleared to launch.

W3 is running in isolated worktree `android-tmux-parity-w3` from accepted base `0168aee`; W4 remains gated behind its reviewed UI/navigation seam.

Read-only W4 contract review found one real backend gap: bulk terminate archived a pane before `kill_session` completed. A non-colliding backend lane is correcting that path with existing `dispatchAndWait`; Android W4 UI still waits for W3.

Backend correction `8c6accd` now dispatches kills concurrently with explicit 12-second waits, preserves input-order results, and archives once after all outcomes; fresh critical review passed. W3 candidate `14e2677` passed 35+35 tests/lint/release assembly but review found Claude provider visibility and UI-stream lifecycle/pending-state defects; bounded correction is running.
