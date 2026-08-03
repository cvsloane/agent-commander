# W1 Brief Adversary Request

You are the fresh, independent pre-dispatch Reviewer for the Agent Commander ACP Workspace. Review the Builder brief before any Builder launches. Do not implement, edit, run tests, install packages, or propose a second architecture.

Read completely:

- `REVIEW_INPUTS/w1-brief.md`
- `REVIEW_INPUTS/project-plan.md`
- `REVIEW_INPUTS/acceptance-checklist.md`
- `AGENTS.md`
- `tasks/lessons.md`

Inspect the candidate base tree and the activated ACP sources at `/home/cvsloane/.local/share/open-agents/current` as needed with Read, Grep, and Glob only.

Try to falsify the brief in this order:

1. Factual premises: current mount, schema, routes, Attention structure, CLI verbs, program answer/approval/cancel semantics, auth boundaries, and available component patterns.
2. Self-contradiction: prove the allowed paths and forbidden actions still permit every mandatory checklist item, especially global Attention linkage, secure program approval, mobile navigation, detail data, source/master/origin/activation reporting, and one complete vertical candidate.
3. Stale/moving state: confirm base `b99a33cd202af2de69ac555d68a7e4a12fef0d9b` contains the named seams and that the brief does not depend on local-only project-plan commits.
4. Placement and source truth: confirm Agent Commander can reach the activated ACP entrypoint without introducing arbitrary command execution or reimplementing ACP state transitions.
5. Acceptance: identify criteria that are impossible, ambiguous, non-finite, or require a source the system does not have. Pay special attention to live route selection, program approval snapshots, cancellation/denial, intentional release pins, and terminal session linkage.
6. Proportionality: reject requirements or abstractions that exceed the full workspace goal, and reject a file/line ceiling that would force code golf or omission.
7. Security: find traversal, argument injection, auth/identity confusion, secret/log exposure, unsafe temp-file, TOCTOU, and confused-deputy risks in the prescribed contract.

Do not request new tests or a suite run; this project's accepted proof is builds, frozen diff review, authenticated browser inspection, and one real workflow.

For each finding provide severity (`BLOCKS DISPATCH` or `FIX BEFORE DISPATCH`), the exact brief section, verified repository/ACP evidence, and the smallest brief correction. If nothing dispatch-blocking remains, say `NO FINDINGS`.

Limit the response to 1,200 words and end with exactly one line:

`BRIEF_VERDICT: BLOCKS_DISPATCH`

or

`BRIEF_VERDICT: FIX_BEFORE_DISPATCH`

or

`BRIEF_VERDICT: NO_FINDINGS`

