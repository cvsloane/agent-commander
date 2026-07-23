# Android Terminal Daily Driver — Status

- Plan status/version: approved `1719c8c` scope, approval recorded 2026-07-22T12:04:25-04:00
- Current phase: W2 Samsung attach re-test; W1 visual repair held at its verification wall
- Overall state: running
- Last updated: 2026-07-22T20:19:48-04:00
- Current accepted baseline: PR #110 merge `b5f01331019e105b8aea1a1c9a72c93c1b74c32a` is live, with the remaining web renderer artefact rejected and held separately
- Current candidate: Production serves the signed Android repair from source `4bc94e9` and artifact commit `06e540a`; authenticated download returns 2,233,182 bytes with SHA-256 `356c1ab5153596cac8acc08261fef4da60b5b14acf7c1eab8736a3669c9f845c`. Both containers run merge `b5f0133`, health is `ok` with two agents, and the rotated NextAuth secret matches Bitwarden. Samsung attach/render/input remains the irreducible gate.
- Budget used/remaining: setup complete; 7-day project ceiling remains
- Next Human Owner checkpoint: corrected APK install and Samsung pane attach/render/input verdict

## Lane Status

| Lane | Current role | State | Deliverable/ref | Last proof | Blocked on | Next action |
|---|---|---|---|---|---|---|
| W1 — Shared terminal repair | AI Lead/integrator plus Human Owner | deployed | PR #107 merge `12889bf`; Coolify `z4ig8vlvpgvcncvzhiahnl2d`; identical agentd on both hosts | Full CI, fresh review, exact-source containers, one process per host, and public health `ok` with two agents | Live laptop interaction | Chris verifies connect/focus/switch responsiveness on the real laptop path |
| W2 — Android vertical slice | Android Builder plus fresh Reviewer | deployed | Source `4bc94e9`; signed artifact `06e540a`; production merge `b5f0133` | Exact request regression, Android test/lint/release build, production bodyless ticket 201, fresh review PASS, v2/v3 signer continuity, DEX request inspection, authenticated production artifact identity | Samsung pane-attach re-test | Chris updates the installed APK and exercises one real pane |
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
| W2 Android pane attach | waiting | Corrected signed APK is live and the authenticated production download matches SHA-256 `356c1ab5...`; server-side bodyless ticket probe returns 201 | Human Owner | Install/update APK, select `heavisidelinux` → `SloaneVault`, and confirm render/input |
| W3 PR #110 rollout | pass | Full CI and review passed; merge `b5f0133` is live in both containers; health is `ok` with two agents; authenticated APK headers, length, and SHA-256 match | AI Lead | Samsung real-path check |
| Credential rotation | pass | Exposed NextAuth signing value was replaced in production and preview configuration, stored as Bitwarden `Agent Command / AGENT_COMMAND_NEXTAUTH_SECRET`, redeployed, and compared against the running dashboard without printing it | AI Lead | Existing web sessions reauthenticate once |
| W1 exact painted screenshot | held | Authenticated production SloaneVault terminal screenshots show unselectable left-edge line fragments; three direct test-trigger attempts could not select the populated one of two mounted xterm instances, so no renderer patch was retained | Visual diagnosis lane | Human chooses another direct active-instance pass, renderer-level proof, or manual-only verification |

## Current Risks and Escalations

- Same-model review is necessary because Fable quota is exhausted; fresh contexts/worktrees and mechanical proof are required.
- Sol/xhigh overengineering risk is controlled by the plan's Kill/Keep/Improve section and test-delta ceiling.

## Immediate Next Sequence

1. Chris signs back into the production web app once after the NextAuth rotation.
2. Download and install the current APK from Settings.
3. Open `heavisidelinux` → `SloaneVault`; verify the pane renders and typed input reaches tmux.
4. Report the Android result separately from the still-held web line artefact.
