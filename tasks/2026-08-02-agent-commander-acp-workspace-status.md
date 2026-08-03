# Agent Commander ACP Workspace — Status

- Plan status/version: approved v1 full workspace
- Current phase: W1 ACP continuation
- Overall state: running
- Last updated: 2026-08-03T02:33:00Z
- Current accepted source and production baseline: `b99a33cd202af2de69ac555d68a7e4a12fef0d9b`
- Preserved local baseline: `030b4095cf8d9473f7de0a4521cf0b97cf1fe9b9` plus approved control-file changes
- Current candidate: same-task ACP continuation in the existing partial worktree; not reviewable until committed and verified
- Budget used/remaining: 0%; Luna non-shared pool 69% remaining; homelinux Claude all-models 95% remaining; team/shared OpenAI exhausted and nonblocking
- Next Human Owner checkpoint: only if plan scope, forbidden authority, waiver, or residual-risk decision changes

## Lane Status

| Lane | Current role | State | Deliverable/ref | Last proof | Blocked on | Next action |
|---|---|---|---|---|---|---|
| W0 product and launch gate | AI Lead | complete | Approved plan and checklist | Canonical validator PASS with control-file check | none | Preserve as frozen authority |
| W1 full ACP workspace | Luna Builder | running (resume 1) | Complete the partial vertical slice in the original ACP worktree | Human Owner authorized option 1; failed/queued/worktree hashes recorded; same task reclaimed at 2026-08-03T02:33:00Z with Luna/max/OpenAI rank 1 | Commit, Go verification, and Builder handoff | Monitor the actual worktree and task ledger |
| W2 independent acceptance | Opus Reviewer and Product Navigator | pending | Structured frozen-candidate verdict | Homelinux Claude 2.1.220; 95% quota remaining | W1 frozen | Review disposable copy with read-only tools |
| W3 integration and release | AI Lead and Ops/Deploy | pending | PR, deployment, screenshots, real task proof | Production baseline `b99a33c` known | W2 PASS | Integrate once, deploy once, verify real path |

## Open Gates

| Gate | State | Ground truth | Owner | Next trigger |
|---|---|---|---|---|
| Project Plan validation | pass | Canonical validator with control-file check | AI Lead | Revalidate at material plan or routing change |
| Both-host harness capability | pass | Activated capability registry checks on 2026-08-03 | AI Lead | Recheck immediately before Builder and Reviewer |
| Builder route | pass | Scoped worker router resolved `gpt-5.6-luna` at max, rank 1, no skips | AI Lead | Recheck at dispatch |
| Reviewer route | pass | Claude 2.1.220 login binary, Opus route previously proven, current pool 95% remaining | AI Lead | Recheck before transfer |
| W1 brief contract | pass with corrections | Every Opus finding adopted; final CLI facts checked on the authoritative heavisidelinux activated release; no fourth pre-build review | AI Lead | Freeze the Builder prompt at enqueue |
| W1 Builder completion | running | Same task/worktree resumed with `CODING_DISPATCH_TASK_TIMEOUT_SECONDS=7200`; prior timeout and hashes preserved in ACP audit | AI Lead | Builder terminal result |
| Frontend acceptance | pending | Approved checklist and authenticated browser audit | Opus Reviewer and AI Lead | W1 frozen |
| Production release | pending | Protected branch, Coolify, both agentd services | Ops/Deploy | W2 PASS and required checks green |

## Current Risks and Escalations

- Agent Commander local `main` is one project-status commit ahead of `origin/main` and carries the newly recorded ACP frontend lesson. Integration must preserve both.
- The local ACP store has 29 historical `needs-review` items and one awaiting-input program judgment. The workspace must classify these honestly without treating them as running or cleaning them automatically.
- The homelinux-local quota snapshot is older than the authoritative fleet snapshot. Reviewer admission uses the fresh authoritative snapshot and rechecks before review.
- ACP's fail-closed CLI approver allowlist is currently unset. The approved full program flow requires the AI Lead to configure only `chris` in the canonical non-secret runtime environment before program-approval proof; broader access remains forbidden.
- The control plane does not yet have `ACP_SOURCE_HOST_ID`; the AI Lead will map it to the authenticated heavisidelinux UUID during the one approved final deployment. Until then the new endpoint must fail closed.
- The one-record timeout recovery was explicitly authorized and completed with before/after record hashes plus an unchanged worktree-content hash. No generic recovery behavior was added to ACP.

## Immediate Next Sequence

1. Monitor the resumed task and actual worktree without intervention.
2. Require Luna's committed handoff token and the configured Go-only verifier.
3. Inspect the exact frozen diff and scope before integration.
4. Do not review or integrate an uncommitted/failed partial tree.
