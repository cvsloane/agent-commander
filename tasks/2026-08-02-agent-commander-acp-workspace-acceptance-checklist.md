# Agent Commander ACP Workspace — Acceptance Checklist

- Status: approved at 2026-08-03T00:42:24Z
- Human Owner: Chris Sloane
- Project Plan: `tasks/2026-08-02-agent-commander-acp-workspace-plan.md`
- Current production baseline: `b99a33cd202af2de69ac555d68a7e4a12fef0d9b`

Every mandatory item must pass. A Builder may propose a stronger criterion but cannot weaken or self-grade this checklist.

## Information Architecture and Product Job

- [ ] **IA-1 — Dedicated area:** `/acp` is a top-level Agent Commander area on desktop with an intentional mobile navigation path; the ACP card wall is removed from Hosts.
- [ ] **IA-2 — Clear job:** The page header and above-fold content answer what needs attention, what is running, whether dispatch is ready, which routing policies are configured, which routes were last resolved, and whether releases are aligned.
- [ ] **IA-3 — Clear actions:** New task is the primary action and New program is secondary. Both are visible without scrolling at desktop and reachable on mobile.
- [ ] **IA-4 — Product boundaries:** Automation remains long-lived agent scheduling, Attention remains global human intervention, Hosts remains machine administration, and ACP owns repo development orchestration.

## Work and Evidence

- [ ] **WORK-1 — Honest states:** queued and running are active; awaiting input, judgment, blocked, and needs review are attention; completed, no-op, failed, and canceled are history. The 29 existing `needs-review` records are never labeled active.
- [ ] **WORK-2 — Human-readable rows:** Program and task rows prioritize objective, repo, normalized state, updated time, next action, and program/lane relationship rather than opaque IDs.
- [ ] **WORK-3 — Useful detail:** A selected item shows available lane, machine, model, effort, attempt, timestamps, checkpoints, cost/tokens, verdict, blockers, verification, changed files, worktree/ref, and receipt/log links without claiming absent fields.
- [ ] **WORK-4 — Scale:** Search/filter and bounded initial rows keep the 150-plus historical records usable. Empty data and filter-zero states are distinct.
- [ ] **WORK-5 — Program flow:** A program detail shows setup gate, lanes/dependencies, budget, next action, approval state, attempts, and terminal result from ACP's durable record.

## Actions and Safety

- [ ] **ACT-1 — New task:** An operator can submit repo, objective, and risk. ACP—not the browser—selects exact model, effort, machine, and Reviewer.
- [ ] **ACT-2 — New program:** An operator can start a durable program, answer one setup question at a time, inspect the frozen plan summary, and explicitly approve or cancel it.
- [ ] **ACT-3 — Judgment:** Supported answer, approve, and deny actions are typed, attributable to the authenticated operator, and update the authoritative ACP record.
- [ ] **ACT-4 — No arbitrary execution:** Browser, dashboard API, control plane, and agentd accept only fixed ACP action schemas. No shell string, executable path, arbitrary argv, state-root path, or unrestricted file payload is accepted.
- [ ] **ACT-5 — Authorization:** Every ACP read requires operator access and every mutation requires the existing authorized operator/admin boundary; permission-denied state is explicit.
- [ ] **ACT-5a — Sole approver mapping:** Program approval maps only the exact server-configured `ACP_APPROVER_USER_ID` to the sole fail-closed ACP CLI approver `chris`; absent/mismatched UUIDs and other identities are refused, and no credential or broader Agent Commander role changes.
- [ ] **ACT-6 — Action truth:** A queued command is not presented as completed work. Submission, accepted queue write, running, review, terminal, and failed states remain distinct.
- [ ] **ACT-7 — Existing runtime:** Actions invoke existing ACP entrypoints and durable records; no new scheduler, queue, database, or mirrored execution state is created.

## Routing, Capacity, and Releases

- [ ] **ROUTE-1 — Builder route:** The workspace reads the activated router's Builder policy (currently led by `gpt-5.6-luna` at max) and separately shows the latest authoritative resolved Builder model, machine, provider, reserve/freshness, and selected/held reason when recorded.
- [ ] **ROUTE-2 — Reviewer route:** The workspace reads the activated router's adversary/reviewer policy (currently led by `claude-opus-5`) and separately shows the latest authoritative `program_reviewer_runtime_route` and selection reason when recorded; it does not mislabel the project's external homelinux review lane as an ACP resolution.
- [ ] **ROUTE-3 — Shared plan:** Team/shared OpenAI is visibly measured and labeled nonblocking/overflow. Its exhaustion does not mark dispatch blocked while a fresh non-shared route is healthy.
- [ ] **ROUTE-4 — Pool clarity:** Raw pools are grouped under route summaries and show provider, pool, used/remaining, reset, confidence/freshness, and operational effect without one card per pool above the fold.
- [ ] **REL-1 — Activation integrity:** Each machine shows activated version/path and measured time from the capability registry, with aligned, different, or unknown state computed by comparing the machine activation facts. Intentional pinning appears only when an authoritative source explicitly records it.
- [ ] **REL-2 — Capability truth:** Gateway, dispatch-worker, and release capability status for both machines is visible with freshness. Known identity alone is not labeled aligned.

## Attention and Terminal Integration

- [ ] **ATTN-1 — Global attention:** ACP awaiting-input, judgment, blocked, and review-required items appear in the existing Attention experience without duplicating decision logic.
- [ ] **ATTN-2 — Context link:** Attention items open the matching ACP detail and preserve the action needed.
- [ ] **ATTN-3 — Terminal link:** A running task with an Agent Commander session can open its existing terminal; the workspace does not create a second terminal implementation.

## Frontend Quality

- [ ] **UI-1 — Coherent surface:** The workspace uses compact page structure, tables, tabs, and detail sheets rather than disconnected equal-weight cards.
- [ ] **UI-2 — Responsive:** Authenticated 390x844, 768x1024, and 1400x900 screenshots show no horizontal overflow, text collision, clipped action, obscured content, or unusable table.
- [ ] **UI-3 — States:** Loading, empty, zero-result, partial source, error, permission denied, disabled-with-reason, submitting, accepted, and held states use stable dimensions and actionable copy.
- [ ] **UI-4 — Accessibility:** Semantic links/buttons, labels, keyboard operation, visible focus, accessible names and state, WCAG-AA contrast, and non-color status cues are present.
- [ ] **UI-5 — Audit:** The final frontend score is at least 85/100 with no hard fail, based on authenticated browser inspection rather than code inference.

## Integration, Proof, and Scope

- [x] **INT-1 — Frozen candidate:** ACP produces one frozen Agent Commander candidate with exact base/head, changed paths, real worktree diff, and Luna Max attempt identity.
- [x] **INT-2 — Mechanical build:** Go agentd, schema, control plane, dashboard production build, and diff check pass once on the frozen candidate. No new tests or local suite runs are added.
- [x] **INT-3 — Independent review:** Fresh homelinux Opus 5 returns PASS for the exact frozen candidate; all mandatory findings are resolved inside the attempt ceiling.
- [ ] **INT-4 — One integration:** One protected application PR merges the reviewed content, required repository checks pass, and landed-tree comparison proves the reviewed paths are present.
- [ ] **INT-5 — Ordered deployment:** When the wire schema changes, dashboard/control-plane deploy before agentd. Both agentd hosts then run the exact accepted binary, with rollback copies retained.
- [ ] **INT-6 — Production identity:** `origin/main`, both production containers, and both agentd binaries identify the accepted candidate; public health and authenticated ACP routes pass.
- [ ] **INT-7 — Real workflow:** One real closeout development task is submitted from production `/acp`, routed through Luna, independently reviewed by Opus when review is owed, and observed through its terminal receipt.
- [ ] **INT-8 — No expansion:** No migration, new database, scheduler, queue, test/harness, retry system, arbitrary command bus, new design system, or unrelated Automation/terminal refactor lands.
- [ ] **INT-9 — Recovery:** Prior source, deployment, and agentd identities are recorded immediately before rollout, and the rollback path remains executable.

## Review Rule

The AI Lead may resolve factual disputes from repository/runtime ground truth and return mechanical findings to the Builder. Only the Human Owner may change product intent, waive a non-waivable criterion, authorize forbidden authority, or accept known residual risk.
