# Android Terminal Daily Driver — Status

- Plan status/version: approved `1719c8c` scope, approval recorded 2026-07-22T12:04:25-04:00
- Current phase: W2 distinguishable Android upgrade; W1 visual repair held at its verification wall
- Overall state: running
- Last updated: 2026-07-22T23:11:17-04:00
- Current accepted baseline: PR #110 merge `b5f01331019e105b8aea1a1c9a72c93c1b74c32a` is live, with the remaining web renderer artefact rejected and held separately
- Current candidate: Production serves corrected APK bytes whose DEX has a null media type for the ticket POST, but every published build was indistinguishable as `v0.1.0 (1)`. The Samsung re-test at 23:05–23:06 ET sent the old empty-JSON request ten times, proving the device still ran old behavior. A `v0.1.1 (2)` build with an in-app version marker and versioned download filename is in progress.
- Budget used/remaining: setup complete; 7-day project ceiling remains
- Next Human Owner checkpoint: corrected APK install and Samsung pane attach/render/input verdict

## Lane Status

| Lane | Current role | State | Deliverable/ref | Last proof | Blocked on | Next action |
|---|---|---|---|---|---|---|
| W1 — Shared terminal repair | AI Lead/integrator plus Human Owner | deployed | PR #107 merge `12889bf`; Coolify `z4ig8vlvpgvcncvzhiahnl2d`; identical agentd on both hosts | Full CI, fresh review, exact-source containers, one process per host, and public health `ok` with two agents | Live laptop interaction | Chris verifies connect/focus/switch responsiveness on the real laptop path |
| W2 — Android vertical slice | Android Builder plus fresh Reviewer | correcting release identity | Production `v0.1.0 (1)` source `4bc94e9`; versioned update lane from `069feaf` | Live logs prove the installed client still sends old JSON content type; distributed corrected DEX and its only caller are clean; all old/new artifacts shared version identity | Build/review/sign/deploy `v0.1.1 (2)` | Publish a visibly distinguishable update without transport or retry changes |
| W3 — Integration and rollout | AI Lead plus fresh Reviewer | deployed | PR #110 merge `b5f0133`; Coolify release `mym0vn6whe76tovzighnre8e`; secret-rotation redeploy `ddodmvrvv715n7in7cqd5sb9` | Exact-source containers, health `ok` with two agents, deployed NextAuth secret matches Bitwarden, authenticated APK status/headers/bytes/hash pass | Physical Samsung use | Preserve the Android-only release; keep the unproven web renderer change out |

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
| W2 build/review | pass | Corrected Android foundation through `f464360` is integrated; Gradle test/lint/release and final fresh review pass | AI Lead | Preserve through CI; complete Samsung/live-endpoint gates after rollout |
| W3 PR #108 rollout | pass | PR #108 merged as `a1b4f41`; Coolify `kcq6gn6w98c3c20m1ujtqm4d` finished at that exact source; the source-aligned replacement APK is prepared locally but not yet deployed | AI Lead | Follow-up PR/deploy and authenticated production hash check |
| W2 Android pane attach | fail | At 03:05:55–03:06:11 UTC requests `req-v` through `req-14` all returned `400 FST_ERR_CTP_EMPTY_JSON_BODY`; roster requests immediately before were 200 and independent bodyless ticket probes were 201 | AI Lead + Android Builder | Deploy a strictly higher, visible APK version and verify installed identity before retrying |
| W3 PR #110 rollout | pass | Full CI and review passed; merge `b5f0133` is live in both containers; health is `ok` with two agents; authenticated APK headers, length, and SHA-256 match | AI Lead | Samsung real-path check |
| Credential rotation | pass | Exposed NextAuth signing value was replaced in production and preview configuration, stored as Bitwarden `Agent Command / AGENT_COMMAND_NEXTAUTH_SECRET`, redeployed, and compared against the running dashboard without printing it | AI Lead | Existing web sessions reauthenticate once |
| W1 exact painted screenshot | held | Authenticated production SloaneVault terminal screenshots show unselectable left-edge line fragments; three direct test-trigger attempts could not select the populated one of two mounted xterm instances, so no renderer patch was retained | Visual diagnosis lane | Human chooses another direct active-instance pass, renderer-level proof, or manual-only verification |

## Current Risks and Escalations

- Same-model review is necessary because Fable quota is exhausted; fresh contexts/worktrees and mechanical proof are required.
- Sol/xhigh overengineering risk is controlled by the plan's Kill/Keep/Improve section and test-delta ceiling.

## Immediate Next Sequence

1. Build and review `v0.1.1 (2)` with an in-app version marker.
2. Sign with the existing certificate and publish it under a versioned download filename.
3. Verify production bytes, headers, signature, and version identity.
4. Chris confirms `v0.1.1 (2)` in the app, then opens `heavisidelinux` → `SloaneVault`.
