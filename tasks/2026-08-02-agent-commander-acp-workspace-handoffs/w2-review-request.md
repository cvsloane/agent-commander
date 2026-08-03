# W2 Independent Candidate Review Request

You are the fresh, independent acceptance Reviewer and Product Navigator for the Agent Commander ACP Workspace. Review the exact integrated candidate read-only. Do not edit, implement, run tests, install packages, or propose a second architecture.

## Read completely

- `REVIEW_INPUTS/candidate.diff` — production code diff from approved pre-Builder base `3dccd71` to integrated head `0c2bba1`
- `REVIEW_INPUTS/w1-builder.md`
- `REVIEW_INPUTS/w2-build-receipt.md`
- `REVIEW_INPUTS/project-plan.md`
- `REVIEW_INPUTS/acceptance-checklist.md`
- `AGENTS.md`
- `tasks/lessons.md`
- affected source files in this exact `0c2bba1` tree
- exact heavisidelinux activated ACP sources under `REVIEW_INPUTS/heavisidelinux-activated/` when checking CLI/state/router contracts (`hermes-coding-dispatch.py`, `hermes_model_router.py`, `hermes_capability_registry.py`, `model-router.json`, and `coding-dispatch-map.md`); do not substitute homelinux `current`

## Review job

Try to falsify this candidate against the plan and checklist, focusing on:

1. End-to-end typed action flow across schema, dashboard, control plane, agentd, and the activated ACP CLI. Verify argv ordering, `--`, program answer/approval/cancel file shapes, displayed-digest concurrency check, sole approver mapping, traversal/text bounds, mode-0600 temporary files, cleanup, timeout/output bounds, and absence of generic command execution.
2. Single source of truth and authority. `/v1/acp` must use only server-owned `ACP_SOURCE_HOST_ID`, require online `acp_status`, never trust a browser/name, and never fail over state to homelinux.
3. Read adapter truth. Verify bounded/per-record tolerant task/program parsing, honest active/attention/history normalization, safe detail/log fields, alias-only map exposure, router-policy versus recorded-route separation, real non-shared capacity gating, shared/team nonblocking behavior, and per-machine release/capability facts.
4. Attention integration. Verify existing timestamps, neutral `ACP_ATTENTION`, no first-load notification/audio storm, no second global store or decision logic, correct `/acp` detail links, and truthful lack of terminal link without an authoritative session identity.
5. Product/front-end source. Verify dedicated top-level placement, Hosts removal, Overview/Work/Capacity/Fleet hierarchy, New task/program priority, bounded/filterable history, usable detail/action flow, honest unavailable/partial/permission/accepted states, semantic controls, and likely 390/768/1400 behavior. Authenticated screenshots and final 85/100 visual score are post-deploy gates; absence of screenshots in this source pass is not itself a blocker, but clear source-level responsive/accessibility defects are.
6. Scope and proportionality. The production candidate is 18 paths and about 3,251 insertions/397 deletions, including a 1,806-line Go adapter and 757-line client. The brief's ~2,000-line ceiling was a preference with a held escape, not code golf. Fail material duplication, hand-rolled ACP transitions, needless framework work, or unreadable compression; do not fail size alone when the code is necessary and cohesive.
7. Mechanical evidence. Go/schema/control-plane/dashboard builds passed. The first control-plane build exposed a real type error and the one-file correction passed on rerun. No tests were requested or run; do not request new tests or a suite run.

For each finding give severity (`BLOCKING`, `MANDATORY BEFORE DEPLOY`, or `ADVISORY`), exact file/line evidence, violated checklist ID, and the smallest direct correction. Distinguish source defects from post-deploy proof still pending.

Verdict rules:

- `PASS`: no code correction is required before PR/deploy; downstream runtime/browser/real-workflow gates may remain.
- `PASS_WITH_FINDINGS`: safe to proceed, with only advisory findings.
- `FAIL`: at least one code correction is mandatory before PR/deploy.
- `BLOCKED`: the delivered sources are insufficient to complete the read-only review.

Limit the response to 2,000 words. End with exactly one line:

`CANDIDATE_VERDICT: PASS`

or `CANDIDATE_VERDICT: PASS_WITH_FINDINGS`, `CANDIDATE_VERDICT: FAIL`, or `CANDIDATE_VERDICT: BLOCKED`.
