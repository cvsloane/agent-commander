# Agent Commander ACP Workspace — Status

- Plan status/version: approved v1 full workspace
- Current phase: W1 brief and dispatch
- Overall state: running
- Last updated: 2026-08-03T00:42:24Z
- Current accepted source and production baseline: `b99a33cd202af2de69ac555d68a7e4a12fef0d9b`
- Preserved local baseline: `030b4095cf8d9473f7de0a4521cf0b97cf1fe9b9` plus approved control-file changes
- Current candidate: none
- Budget used/remaining: 0%; Luna non-shared pool 69% remaining; homelinux Claude all-models 95% remaining; team/shared OpenAI exhausted and nonblocking
- Next Human Owner checkpoint: only if plan scope, forbidden authority, waiver, or residual-risk decision changes

## Lane Status

| Lane | Current role | State | Deliverable/ref | Last proof | Blocked on | Next action |
|---|---|---|---|---|---|---|
| W0 product and launch gate | AI Lead | complete | Approved plan and checklist | Canonical validator PASS with control-file check | none | Preserve as frozen authority |
| W1 full ACP workspace | Luna Builder | ready for brief review | One Agent Commander vertical candidate | Both-host capability PASS; scoped Builder resolves Luna rank 1 | Adversarial brief verdict | Freeze brief, review it, then dispatch through ACP |
| W2 independent acceptance | Opus Reviewer and Product Navigator | pending | Structured frozen-candidate verdict | Homelinux Claude 2.1.220; 95% quota remaining | W1 frozen | Review disposable copy with read-only tools |
| W3 integration and release | AI Lead and Ops/Deploy | pending | PR, deployment, screenshots, real task proof | Production baseline `b99a33c` known | W2 PASS | Integrate once, deploy once, verify real path |

## Open Gates

| Gate | State | Ground truth | Owner | Next trigger |
|---|---|---|---|---|
| Project Plan validation | pass | Canonical validator with control-file check | AI Lead | Revalidate at material plan or routing change |
| Both-host harness capability | pass | Activated capability registry checks on 2026-08-03 | AI Lead | Recheck immediately before Builder and Reviewer |
| Builder route | pass | Scoped worker router resolved `gpt-5.6-luna` at max, rank 1, no skips | AI Lead | Recheck at dispatch |
| Reviewer route | pass | Claude 2.1.220 login binary, Opus route previously proven, current pool 95% remaining | AI Lead | Recheck before transfer |
| Frontend acceptance | pending | Approved checklist and authenticated browser audit | Opus Reviewer and AI Lead | W1 frozen |
| Production release | pending | Protected branch, Coolify, both agentd services | Ops/Deploy | W2 PASS and required checks green |

## Current Risks and Escalations

- Agent Commander local `main` is one project-status commit ahead of `origin/main` and carries the newly recorded ACP frontend lesson. Integration must preserve both.
- The local ACP store has 29 historical `needs-review` items and one awaiting-input program judgment. The workspace must classify these honestly without treating them as running or cleaning them automatically.
- The homelinux-local quota snapshot is older than the authoritative fleet snapshot. Reviewer admission uses the fresh authoritative snapshot and rechecks before review.

## Immediate Next Sequence

1. Commit the approved control state locally so Agent Commander is clean without losing `030b409`.
2. Write and adversarially review one bounded W1 brief.
3. Recheck capability and quota at dispatch.
4. Dispatch W1 through ACP with Luna Max and monitor the real worktree.
