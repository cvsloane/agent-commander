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
| W1 interaction authority/scroll | ready | Android Builder | Approved brief |
| W2 topology/API/domain | ready | Android Builder | Approved brief |
| W3 workbench UI | pending | Android Builder | W1/W2 accepted |
| W4 window/pane lifecycle | pending | Android Builder | W2/W3 accepted |
| W5 release | pending | AI Lead + critical Reviewer | W1-W4 accepted |
