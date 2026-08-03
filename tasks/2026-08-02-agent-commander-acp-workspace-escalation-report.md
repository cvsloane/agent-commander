# Agent Commander ACP Workspace — Escalation Report

Status: resolved again — Human Owner ruled at 2026-08-03T03:03:42Z that synthetic USD guards do not apply to subscription/proxy ACP routes.

## Exact wall

ACP failed the sole Builder task with the exact error:

> Claude worker timed out after 1800 seconds

The timeout fired before Luna could commit, run the configured Go verifier, write the Builder handoff, or complete the frontend. ACP moved the record to `failed/` and reported `changed_files: none`; the actual isolated worktree is the evidence and contains 12 modified/untracked production paths. The `/acp` route is only an 18-line page stub, so this is not a candidate that can be reviewed or integrated.

## What ran

- Task: `cd_20260803_013947_agent_command_w1_builder_brief_full_agent_comm_e7cf752b`
- Route: `gpt-5.6-luna` · max · OpenAI · rank 1 · no skips
- Base: `3dccd71f92eb529b9286060f1ed5c2f2965a996c`
- Worktree: `/home/cvsloane/.hermes/coding/worktrees/cd_20260803_013947_agent_command_w1_builder_brief_full_agent_comm_e7cf752b`
- Elapsed: 30 minutes
- Verification: not reached
- Tests: none added, changed, or run
- Production/service/credential state: untouched

## Why authority is required

ACP exposes no public resume command for a generic timed-out task. The existing resume code can continue an existing worktree, but using it here requires a controlled edit of this one failed dispatch record and move back to `queue/`. That is a new state-mutation authority, so the AI Lead has not done it implicitly.

## Options

1. **Resume this worktree through ACP (recommended).** Authorize one controlled failed-record recovery, preserving the same task ID/worktree and recording before/after hashes. Run the continuation with `CODING_DISPATCH_TASK_TIMEOUT_SECONDS=7200`, Luna Max, and the same Go-only verifier. This preserves the useful 30-minute partial slice and avoids a second implementation, but uses ACP's internal resume mechanism because the CLI lacks the command.
2. **Restart clean through the public enqueue command.** Leave the partial worktree untouched and enqueue a new Luna task from the current main with a 7,200-second timeout. This stays on public ACP commands but repeats model spend and discards the partial implementation from the candidate.
3. **Hold/stop W1.** Preserve the failed record and worktree for later inspection; Agent Commander and production remain unchanged.

No other lane may proceed until W1 produces a committed, verified handoff.

## Resolution receipt

- Failed record SHA-256: `d2601fdc4dbc4b73c9e32d9f1312f73addd6eab92df75e2bd831a49d620c67c3`
- Worktree-content SHA-256 before recovery: `3a054cf7a163ba9bdde3a950babff2a29d25921509b5588ad83198e0b02c35c2`
- Queued recovery record SHA-256: `04959aa1d2aa4a0f29464988e99d2bf873bc0b979c796bcebebd22344a98e35f`
- ACP audit event: `timeout_recovery_authorized`
- Recovery: same task ID, branch, and worktree; `resume_count=1`; 7,200-second timeout; same Go-only verifier.
- No new lane, implementation, test, production mutation, or credential change.

## Second wall: approved Luna budget exhausted

The resumed worker ended with:

> Reached maximum budget ($12)

Evidence: `budget_exhausted`, 141 turns, `$12.110118` equivalent, 686,279 input tokens, 66,060 output tokens. The same worktree now includes a substantive 750-line `/acp` workspace plus the backend, routing, navigation, and Attention integration. It remains uncommitted and unverified; ACP did not reach its harness or Reviewer.

- Failed record SHA-256: `8350191c7463f0f24ccbf8d33415c1294a6588e8f85f41f6ea0bcd8f5bfdb65c`
- Current worktree-content SHA-256: `effd1361493286bc1b5e77ce697569eda7808f1212f531a3188657d5b8a0ec3b`
- Base remains `3dccd71f92eb529b9286060f1ed5c2f2965a996c`; no commit exists.
- No tests, deployment, services, credentials, or production state were touched.

### Options

1. **One final concise ACP continuation with an additional `$8` equivalent cap (recommended).** Preserve the same task/worktree, replace the repeated full prompt with a completion-only prompt that references the frozen brief, and limit Luna to cleanup, missing contract work, `git diff --check`, handoff, and commit. The ACP harness still owns the Go build; no tests are added or run. This uses more non-shared Luna quota but is expected to finish the nearly complete candidate without a second implementation.
2. **Authorize the AI Lead to finish the remainder locally.** This avoids additional Luna quota but moves completion outside the requested ACP Builder lane; final homelinux Opus review would still be mandatory.
3. **Hold/stop W1.** Preserve the failed record and worktree for later; Agent Commander and production remain unchanged.

## Second resolution receipt

The Human Owner directed: “forget model budgets we are not using billed apis.” ACP therefore records synthetic cost as telemetry but runs this subscription/proxy continuation with `CODING_DISPATCH_MAX_BUDGET_USD=0`. Route reachability and measured subscription quota/reserve remain enforced.

- Prior budget-failed record SHA-256: `8350191c7463f0f24ccbf8d33415c1294a6588e8f85f41f6ea0bcd8f5bfdb65c`
- Preserved worktree-content SHA-256: `effd1361493286bc1b5e77ce697569eda7808f1212f531a3188657d5b8a0ec3b`
- Concise queued record SHA-256: `e39fe2c75ec1b3b3c592b62c8e6aad0163ca5fd720306df0e95dd93cf72dfe97`
- ACP audit event: `synthetic_budget_guard_disabled`
- Capacity policy: real subscription quota and route availability; team/shared pool remains nonblocking.
