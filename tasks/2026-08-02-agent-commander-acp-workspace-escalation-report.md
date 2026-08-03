# Agent Commander ACP Workspace — Escalation Report

Status: active — W1 held at 2026-08-03T02:09:59Z.

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
