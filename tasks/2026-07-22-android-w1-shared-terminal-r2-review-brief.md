# W1-R2 Reviewer Brief — Authoritative Pane Convergence

## Outcome

Independently decide whether the R2 correction closes the single HIGH `WEB-4` blocker without regressing the accepted shared-terminal behavior.

This is a narrow fresh-context review, not a second implementation pass. Review the exact correction and its proof. Do not edit code, broaden scope, or create another harness.

## Frozen Inputs

- Reviewed base and finding: `e0188e0`, with `tasks/2026-07-22-android-terminal-daily-driver-handoffs/w1-shared-terminal-review.md`
- R2 implementation/proof: `795281803f583c895d6f5a8a5acfbec521662250`
- R2 Builder handoff commit: `94e157f`
- R2 Builder handoff: `tasks/2026-07-22-android-terminal-daily-driver-handoffs/w1-shared-terminal-r2.md`
- Review worktree: `/home/cvsloane/dev/wt/ac-android-w1-r2-review`
- Review branch: `review/android-w1-shared-terminal-r2`
- Machine: Homelinux through its login shell
- Runtime/model: OpenAI Codex CLI 0.145.0, exact model `gpt-5.6-sol`, reasoning `xhigh`

## Required Decision

Review only `e0188e0..795281803f583c895d6f5a8a5acfbec521662250`, prioritizing:

1. After acknowledged A→B focus and reconnect, reconciliation uses selected pane B while preserving the original attachment/WebSocket/xterm host.
2. Terminal and prompt input stay fenced until selected UI descriptor and authoritative tmux pane/zoom converge.
3. Rejected, timed-out, or mismatched focus cannot clear the fence when authoritative state is unknown or divergent.
4. The strengthened existing journey actually proves input is routed to B, with no restore to A and no new attachment identity.
5. The change does not alter backend/protocol/layout/renderer/transport behavior or weaken ordinary successful focus.

Treat the original review's `WEB-1`, `WEB-2`, `WEB-3`, `WEB-5`, security, and compatibility conclusions as frozen unless this R2 diff directly regresses one of them.

## Anti-Overengineering Rules

- Findings first, severity ordered, with file/line evidence.
- Do not add or modify code, tests, fixtures, dependencies, plans, or runtime state.
- Do not re-review the original 60-file production-to-candidate diff.
- Use the Builder's receipts unless a specific claim is doubtful. At most rerun the focused store test and the single resumed-viewer journey.
- A preference, cleanup opportunity, or future hardening idea is not a blocker.

## Decision Contract

PASS only if the prior HIGH finding is closed and R2 introduces no new critical/high finding. Otherwise BLOCK with the smallest exact correction required.

Write `tasks/2026-07-22-android-terminal-daily-driver-handoffs/w1-shared-terminal-r2-review.md` using the canonical Reviewer handoff schema, commit that handoff only, and end with exactly:

`W1-R2 REVIEW PASS 795281803f583c895d6f5a8a5acfbec521662250`

or

`W1-R2 REVIEW BLOCK <exact finding>`
