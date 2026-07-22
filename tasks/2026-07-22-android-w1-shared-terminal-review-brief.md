# W1 Reviewer Brief — Shared Terminal Candidate

## Outcome

Independently decide whether the frozen shared-terminal candidate is safe to integrate and deploy for `WEB-1` through `WEB-5` in `tasks/2026-07-22-android-terminal-daily-driver-acceptance-checklist.md`.

This is a fresh-context review, not a second implementation pass. Review the actual production-to-candidate code and the Builder's evidence. Do not edit code, broaden scope, or create another harness.

## Frozen Inputs

- Production baseline: `7b30df046208f1a2ba14b8e34b0095afe9888750`
- Candidate implementation/proof: `d83e2cb7f203bae7e5a67fd5450efdca574cc943`
- Builder handoff commit: `c49423364214b3dcd82e1d65a4e7082338cefea6`
- Builder handoff: `tasks/2026-07-22-android-terminal-daily-driver-handoffs/w1-shared-terminal.md`
- Review worktree: `/home/cvsloane/dev/wt/ac-android-w1-review`
- Review branch: `review/android-w1-shared-terminal`
- Machine: Homelinux through its login shell
- Runtime/model: OpenAI Codex CLI 0.145.0, exact model `gpt-5.6-sol`, reasoning `xhigh`

## Review Focus

Review `7b30df046208f1a2ba14b8e34b0095afe9888750..d83e2cb7f203bae7e5a67fd5450efdca574cc943`, ignoring control-document noise except where it changes acceptance.

Prioritize:

1. The desktop viewport cause and breakpoint guard: production delayed-topology cold-open reproduced `rows=1`; candidate produced 13 and locks a floor of 11.
2. Transactional pane/window focus: input stays fenced until authoritative tmux acknowledgement; rejection, reconnect, and partial failure reconcile or roll back.
3. Protocol compatibility across dashboard, schema, control plane, and agentd. No legacy client/server path may be silently broken.
4. Scrollback/live-output behavior and font zoom remain separate from tmux pane focus.
5. Existing launch-new-session path remains preserved.
6. Authorization, secret hygiene, terminal input routing, and any destructive tmux control regression.

## Anti-Overengineering Rules

- Findings first, severity ordered, with file/line evidence.
- Do not propose architecture work unless it blocks a mandatory acceptance item.
- Do not add or modify tests, code, fixtures, dependencies, plans, or runtime state.
- Do not run a full repository matrix, stress test, soak, or repetition loop.
- Use the existing Builder receipts unless a claim is doubtful. At most rerun the new delayed-topology journey and one directly disputed existing test command.
- A preference, cleanup opportunity, or future hardening idea is not a blocker.

## Decision Contract

PASS only if there are no unresolved critical/high findings and the evidence supports integration for a production laptop check. Otherwise BLOCK with the smallest exact correction required.

Write `tasks/2026-07-22-android-terminal-daily-driver-handoffs/w1-shared-terminal-review.md` using the canonical Reviewer handoff schema, commit that handoff only, and end with exactly:

`W1 REVIEW PASS <candidate-sha>`

or

`W1 REVIEW BLOCK <exact finding>`

