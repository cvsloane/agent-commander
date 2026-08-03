# Agent Commander ACP Workspace — Status

- Plan status/version: approved v1 full workspace
- Current phase: W3 integration and release
- Overall state: running
- Last updated: 2026-08-03T03:51:22Z
- Current accepted source and production baseline: `b99a33cd202af2de69ac555d68a7e4a12fef0d9b`
- Preserved local baseline: `030b4095cf8d9473f7de0a4521cf0b97cf1fe9b9` plus approved control-file changes
- Current accepted candidate: `0f500bc88f72a2c8688cc00905c129e13071682b`; Luna implementation `a8c43074`; Opus mandatory-findings rereview `PASS`
- Capacity policy: subscription/proxy routes only; no synthetic USD execution cap; shared/team exhaustion remains nonblocking
- Next Human Owner checkpoint: only if plan scope, forbidden authority, waiver, or residual-risk decision changes

## Lane Status

| Lane | Current role | State | Deliverable/ref | Last proof | Blocked on | Next action |
|---|---|---|---|---|---|---|
| W0 product and launch gate | AI Lead | complete | Approved plan and checklist | Canonical validator PASS with control-file check | none | Preserve as frozen authority |
| W1 full ACP workspace | Luna Builder | complete | Frozen vertical slice | Task `cd_20260803_013947_agent_command_w1_builder_brief_full_agent_comm_e7cf752b`; commit `a8c43074`; Go build PASS | none | Preserve attempt and handoff receipts |
| W2 independent acceptance | Opus Reviewer and Product Navigator | complete | Structured candidate verdict | Initial four mandatory findings directly fixed; targeted homelinux Opus rereview `PASS` | none | Preserve review receipt |
| W3 integration and release | AI Lead and Ops/Deploy | in progress | PR, deployment, screenshots, real task proof | Integrated candidate `0f500bc`; all production builds and diff check PASS | Runtime UUID/config and protected integration | Publish once, deploy once, verify real path |

## Open Gates

| Gate | State | Ground truth | Owner | Next trigger |
|---|---|---|---|---|
| Project Plan validation | pass | Canonical validator with control-file check | AI Lead | Revalidate at material plan or routing change |
| Both-host harness capability | pass | Activated capability registry checks on 2026-08-03 | AI Lead | Recheck immediately before Builder and Reviewer |
| Builder route | pass | Scoped worker router resolved `gpt-5.6-luna` at max, rank 1, no skips | AI Lead | Recheck at dispatch |
| Reviewer route | pass | Claude 2.1.220 login binary, Opus route previously proven, current pool 95% remaining | AI Lead | Recheck before transfer |
| W1 brief contract | pass with corrections | Every Opus finding adopted; final CLI facts checked on the authoritative heavisidelinux activated release; no fourth pre-build review | AI Lead | Freeze the Builder prompt at enqueue |
| W1 Builder completion | pass | Luna committed `a8c43074`; ACP Go verifier passed; handoff commit `eaa8e94` | AI Lead | Closed |
| Independent source acceptance | pass | Homelinux Opus 5 rereview closed all mandatory findings with `PASS` | Opus Reviewer | Closed |
| Frontend runtime acceptance | pending | Authenticated production screenshots and real actions | AI Lead | Production deployment |
| Production release | eligible | Accepted candidate `0f500bc`; required local builds green | Ops/Deploy | Protected integration and runtime configuration |

## Current Risks and Escalations

- Agent Commander local `main` contains the accepted ACP candidate and project receipts ahead of `origin/main`; protected integration must preserve the exact accepted tree.
- The local ACP store has 29 historical `needs-review` items and one awaiting-input program judgment. The workspace must classify these honestly without treating them as running or cleaning them automatically.
- The homelinux-local quota snapshot is older than the authoritative fleet snapshot. Reviewer admission uses the fresh authoritative snapshot and rechecks before review.
- ACP's fail-closed CLI approver allowlist is currently unset. The approved full program flow requires the AI Lead to configure only `chris` in the canonical non-secret runtime environment before program-approval proof; broader access remains forbidden.
- The control plane does not yet have `ACP_SOURCE_HOST_ID`; the AI Lead will map it to the authenticated heavisidelinux UUID during the one approved final deployment. Until then the new endpoint must fail closed.
- The one-record timeout recovery was explicitly authorized and completed with before/after record hashes. No generic recovery behavior was added to ACP.
- Human Owner corrected the budget model: these subscription/proxy routes are not billed APIs, so synthetic USD totals are telemetry and not execution limits. Real quota/reserve remains enforced.
- Runtime must set lowercase `ACP_APPROVER_USER_ID` to the authenticated Human Owner UUID; absent/mismatch fails closed.

## Immediate Next Sequence

1. Resolve the authenticated heavisidelinux host UUID and Human Owner UUID without exposing tokens.
2. Publish the exact accepted candidate through the protected repository path.
3. Configure the two non-secret runtime identities, deploy control plane/dashboard before both agentd hosts, then exercise authenticated UI and one real ACP task.
