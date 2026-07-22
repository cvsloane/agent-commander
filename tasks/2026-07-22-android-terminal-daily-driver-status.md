# Android Terminal Daily Driver — Status

- Plan status/version: approved `1719c8c` scope, approval recorded 2026-07-22T12:04:25-04:00
- Current phase: parallel W1 focus/transport repair and W2 Android foundation
- Overall state: running
- Last updated: 2026-07-22T18:16:26-04:00
- Current accepted baseline: production functionality through `997e522d71eef5dadd85a20139377f8848fb9a45`, with the remaining renderer artifact rejected
- Current candidate: production through `bf8887b`; an uncommitted W1 follow-up removes terminal lifecycle traffic from the durable sender lane, enables agent WebSocket compression, and makes same-host connected attachment the UI focus gate
- Budget used/remaining: setup complete; 7-day project ceiling remains
- Next Human Owner checkpoint: production laptop terminal-use verdict

## Lane Status

| Lane | Current role | State | Deliverable/ref | Last proof | Blocked on | Next action |
|---|---|---|---|---|---|---|
| W1 — Shared terminal repair | AI Lead/integrator plus fresh Reviewer | running | Direct fix for slow focus acknowledgement and false post-attach focus unavailability | Red/green focused Go, schema, control-plane, and dashboard proofs pass; final rerun/review pending | Nothing | Finish narrow verification, review, integrate, deploy, and prove on production |
| W2 — Android vertical slice | Isolated Android Builder | dispatching | First buildable native Android foundation under `apps/android/**` | Approved acceptance/non-goals and existing public contract are frozen for the lane | Nothing | Build the smallest acceptance-bearing native slice in parallel; report exact integration seams |
| W3 — Integration and rollout | AI Lead | running | Current W1 production plus W2 integration preparation | Production through `bf8887b`; prior deployment/rollback receipts retained | W1 candidate review and W2 handoff | Own shared contracts, APK-from-PWA seam, merge, rollout, and real-path acceptance |

## Open Gates

| Gate | State | Ground truth | Owner | Next trigger |
|---|---|---|---|---|
| Plan validation | pass | Canonical validator | AI Lead | Refresh at wave boundary |
| W1 reproduction | pass | Production commit `7b30df0`: delayed topology cold-open negotiated exactly one row | W1 Builder | Freeze regression proof |
| W1 review | pass | Fresh Reviewer `d64392e`: prior HIGH WEB-4 blocker closed, no new critical/high finding | AI Lead | Live laptop check |
| W1 rollout | pass | PR #104 merge `0a0ac02`; full CI green; Coolify exact-source dashboard/control-plane containers; public health `ok` with two agents; agentd unchanged | AI Lead | Live laptop check |
| W1-R4 focused verification | pass | DOM renderer locked into the existing scrollback journey; passive waiting-input overlays absent; approvals and errors retained; fresh re-review pass | AI Lead | Live laptop check |
| W1-R5 focused verification | pass | Existing letterbox journey failed at 7 px horizontal overflow, passes after moving padding into `.xterm`; scrollback, desktop cold-open, typecheck, and fresh review pass | AI Lead | PR and CI |
| W1-R6 focused verification | pass | Stable xterm 6.0 DOM renderer carries upstream PR #5998's missing-row clear-and-continue fix; existing journey changes and restores wrapped rows exactly across three cycles at mobile and desktop viewports; build, Docker build, CI, and fresh review pass | AI Lead | Live laptop check |
| W1-R7 focused verification | pass | Real production overlay reproduced hard word fragments; red/green formatter proof, exact-width boundary case, affected journey, build/typecheck, fresh review, CI, and repeat production painted-surface probe pass with zero split boundaries or clipping | AI Lead | Live laptop check |
| W1 live laptop | waiting | W1-R7 is live on the actual Claude transcript overlay; automated painted-surface proof passes, human verdict pending | Human Owner | Hard refresh, then repeat Claude chat scrollback check |
| W2 launch | running | Android-owned files are isolated from the active W1/shared-contract diff | Android Builder | First buildable APK/foundation handoff |

## Current Risks and Escalations

- Same-model review is necessary because Fable quota is exhausted; fresh contexts/worktrees and mechanical proof are required.
- Sol/xhigh overengineering risk is controlled by the plan's Kill/Keep/Improve section and test-delta ceiling.

## Immediate Next Sequence

1. AI Lead finishes, reviews, deploys, and proves the direct W1 focus/transport repair on the production path.
2. Android Builder advances the first buildable native slice concurrently in an isolated worktree without modifying shared contracts.
3. AI Lead integrates the Android handoff and authenticated web/PWA APK delivery after each lane has an accepted candidate.
