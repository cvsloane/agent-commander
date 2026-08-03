# W2 Independent Candidate Review

- Reviewer: homelinux Claude Opus 5, high effort, read-only tools
- Candidate reviewed: `3dccd71..0c2bba1`
- Activated contract source: heavisidelinux open-agents release `817a8ee7afdaaf9557202d65f2834eef78658d8f`
- Initial verdict: `FAIL`

## Mandatory findings and direct corrections

1. Program `interview` and `awaiting_approval` states fell into history. Added their normalized forms to ACP attention classification.
2. Program answer/cancel controls did not recognize those real statuses. Extended the existing status predicate.
3. New-program argv omitted the required `<repo>:` separator. The adapter now emits `request.Repo + ":"` before the goal.
4. Human Owner authority was inferred from display/email names. Added server-owned `ACP_APPROVER_USER_ID`; only an exact authenticated user UUID match maps to the CLI approver id `chris`.

The affected Go, control-plane, and dashboard production builds passed after these corrections. No tests were added or run.

Advisory findings about scan efficiency, partial quota tolerance, JSON receipts, an unused legacy client helper, and approval-panel polish are outside this delivery unless they block the real post-deploy path.

## Targeted rereview

- Reviewer: same homelinux Claude Opus 5, high effort, read-only tools
- Scope: the exact four-file mandatory correction diff only
- Result: all four mandatory findings closed; no new deployment-blocking defect
- Final source verdict: `PASS`

Deployment note: configure `ACP_APPROVER_USER_ID` as the lowercase authenticated Human Owner UUID. An absent or mismatched value fails closed.
