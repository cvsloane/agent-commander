# W1 Pre-dispatch Brief Review

Reviewer route: homelinux · `claude-opus-5` · high · read-only tools  
Reviewed base: `b99a33cd202af2de69ac555d68a7e4a12fef0d9b` content archive  
Initial verdict: `BLOCKS_DISPATCH`  
Disposition: brief corrected; rereview required before dispatch

## Findings and accepted corrections

1. **Single ACP source host.** ACP stores are machine-local. Host failover would create a second queue on a different activated version. Queue/program reads and mutations are now pinned to heavisidelinux and fail closed when it is unavailable or activation integrity fails.
2. **Release facts.** The capability registry exposes activated version/path and measurement time, not source `master` or `origin/master`. Fleet acceptance now compares only authoritative machine activation facts.
3. **Reserved program answers.** ACP interprets `cancel` as a destructive transition and `retry` as a judgment control answer. Generic answering now rejects reserved tokens and directs the operator to a dedicated action.
4. **Exact cancellation path.** The prior conditional/copy-only hedge was removed. Cancellation now explicitly uses ACP `program --program-id ... --answers ...` with a server-owned `cancel` answer and confirmation.
5. **Approval inputs.** The brief now requires both answers and approval documents, enumerates server-derived fields, and names the frozen snapshot source at the setup task's latest awaiting-input history entry.
6. **Attention file ownership.** The exact merge, hook, and store files are granted. Type changes must be additive so unchanged consumers and existing tests remain type-correct without test edits.
7. **Terminal truth.** ACP does not currently expose an authoritative Agent Commander session identity. The workspace must show no terminal link unless one is genuinely present; `origin.session` is not sufficient.
8. **Record-count provenance.** Counts are explicitly heavisidelinux point-in-time facts, and premise 3 must be rechecked before use.

The reviewer found the 20-file/~2,000-line proportionality ceiling reasonable because the brief has an explicit held-state escape.

## Gate state

The Builder remains blocked until homelinux Opus rereviews the corrected brief and returns `NO_FINDINGS`.

## Rereview 1

Verdict: `BLOCKS_DISPATCH`

The first corrected pass found eight additional factual issues. The brief was corrected directly:

1. Approval uses the real `--approval` flag, not nonexistent `--approval-file`.
2. Approval answers contain `answers: {}` and no top-level answer; the statement lives only in the snapshot-bound approval file.
3. Every existing Attention presentation/link file needed for ATTN-1/2 is named explicitly; existing decision logic remains untouched.
4. Route UI now separates activated router policy from last recorded resolved route and does not present the external W2 reviewer as ACP-selected.
5. Server flags precede `--`; positional user text follows it and leading-option text is rejected.
6. ACP source authority now resolves from the server-owned `ACP_SOURCE_HOST_ID` UUID rather than agent-reported name.
7. Fleet activation is read per host from each machine's own registry, with unreachable facts reported as unknown.
8. Attention types retain required session fields; ACP supplies `sessionId: null` and widens only the source union.

The brief also names extension of the existing queue parser for bounded history ingestion. A final rereview is required before dispatch.
