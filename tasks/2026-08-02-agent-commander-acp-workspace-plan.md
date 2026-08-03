# Agent Commander ACP Workspace — Project Plan

## Approval

- Human Owner: Chris Sloane
- Status: approved
- Approved at: 2026-08-03T00:42:24Z
- Approved scope/version: v1 full ACP workspace in Agent Commander
- Approval provenance: direct Human Owner selections `1` and `use the orchestrate skill - or ACP itself, preferably - to implement this plan`
- Pre-launch fact correction: the full approved program-approval flow requires the existing fail-closed ACP CLI approver allowlist to contain only `chris`; this non-secret mapping is an in-scope runtime precondition, not a credential or broader role grant.

The Human Owner selected the full workspace proposal, including one final pull request and production deployment, then explicitly directed implementation through ACP. This plan is the formal launch projection of that approved direction.

## Outcome

Agent Commander has a first-class `/acp` development-control workspace that Chris can use as the primary operator surface for repo-scoped development. From one coherent area he can understand what needs attention, inspect programs and tasks, see the exact Builder and Reviewer routes, verify capacity and release integrity, start a bounded task or durable program, answer or approve an ACP judgment, and follow the resulting Builder, verification, review, and receipt timeline.

Agent Commander remains the presentation and authenticated command layer. ACP and its durable files remain the execution source of truth; this project does not create a second scheduler, queue, database, or arbitrary shell interface.

## Completion Definition

- A top-level ACP navigation item opens a dedicated `/acp` route on desktop and an intentional mobile route; the large ACP panel is removed from Hosts.
- The workspace provides Overview, Work, Capacity and Routing, and Fleet and Releases views with the approved information and interaction hierarchy.
- Programs and tasks show human-readable objective, repo, normalized state, lane, machine, Builder model and effort, Reviewer model and effort, attempt, updated time, next action, and inspectable evidence when the source record provides it.
- New task, new program, setup answer, explicit approval or denial, and supported judgment actions use fixed typed Agent Commander commands that invoke existing ACP entrypoints; no request can carry an arbitrary executable or filesystem path. Program approval remains fail-closed unless the authenticated operator maps to the sole configured ACP CLI approver `chris`.
- ACP items requiring Human Owner input appear in the existing Attention experience and link back to the relevant ACP detail.
- Builder routing displays `gpt-5.6-luna` at max on heavisidelinux; Reviewer routing displays `claude-opus-5` at high on homelinux. Exhausted team/shared OpenAI remains visible and nonblocking while healthy non-shared capacity exists.
- Release presentation compares each machine's expected or intentionally pinned ref with its activated ref and measurement freshness; it never treats merely known activation as proof of alignment.
- A fresh homelinux Opus 5 review passes the frozen integrated candidate, the authenticated production page scores at least 85/100 with no frontend hard fail, and desktop, tablet, and mobile screenshots show no overlap or clipped controls.
- One real closeout development task is submitted from the production ACP workspace and observed through its real terminal receipt without tmux being the operator control surface.
- GitHub `origin/main`, the deployed Agent Commander containers, and both installed agentd binaries identify the accepted production candidate. A rollback ref and binary digest are retained.

## Non-Goals

- A kanban board, second queue, new scheduler, new database, migration, or mirrored ACP source of truth.
- Replacing Agent Commander's Automation page, global Attention page, terminal, session runtime, or host-administration responsibilities.
- Arbitrary remote command execution, generic file browsing, configurable shell snippets, or broad agentd command passthrough.
- Automatic quota or effort actuation beyond the already approved ACP router behavior.
- Remote Builder execution on homelinux or a new native remote-review transport. The accepted disposable-copy, login-shell Opus route remains the review mechanism.
- New tests, fixtures, smoke harnesses, canaries, retry layers, defensive abstractions, design systems, charts, or generalized framework work.
- Reworking unrelated stale ACP records. The workspace must classify and filter them honestly, not silently mutate them.
- More than one application pull request or more than one production deployment for the workspace candidate.

## Roles and Models

| Role | Assignment | Primary model/system | Approved fallback | Machine/worktree | Ownership |
|---|---|---|---|---|---|
| Human Owner | Chris Sloane | Human judgment | No substitute | Agent Commander production | Product intent, plan changes, waivers, residual-risk acceptance |
| AI Lead | Current Codex project session | `gpt-5` | HOLD and escalate | heavisidelinux main and clean integration worktree | Plan, brief, supervision, ground truth, integration, release, closeout |
| Builder | ACP standard Builder lane | `gpt-5.6-luna` at max | HOLD and escalate | heavisidelinux ACP-isolated Agent Commander worktree | One complete bounded vertical slice; cannot accept its own work |
| Reviewer | Fresh read-only Reviewer | `claude-opus-5` at high | HOLD and escalate | homelinux disposable content-verified review copy | Independent backend, security, and frontend acceptance review |
| Product Navigator | Fresh UX evaluation within the Opus review | `claude-opus-5` at high | HOLD and escalate | homelinux disposable review copy plus production screenshots | Product fit, hierarchy, interaction states, responsive ergonomics |
| Ops/Deploy | AI Lead after review | `gpt-5` | HOLD and escalate | heavisidelinux, GitHub, Coolify, both agentd hosts | One traceable PR, ordered deployment, real-path verification, rollback receipt |

No agent reviews its own implementation. The Builder receives the accepted feature and data contract, not authority to weaken the checklist. The Opus review is fresh context and receives the plan, checklist, frozen candidate, build receipts, source-state samples, and screenshots rather than the Builder conversation.

## Machine Model Availability

| Machine | Runtime/provider | Exact model ID | Available | Quota remaining | Reset/expiry | Measured at | Evidence source | Tested launch command |
|---|---|---|---|---|---|---|---|---|
| heavisidelinux | Current Codex API session | `gpt-5` | yes | Session-managed; current AI Lead session active | Session-managed | 2026-08-03T00:42:24Z | Active Codex project session on heavisidelinux | Current Codex project session in `/home/cvsloane/dev/open-agents` |
| heavisidelinux | ACP scoped router through CLIProxyAPI/OpenAI | `gpt-5.6-luna` | yes | 69% remaining in measured non-shared primary; team/shared is 0% remaining and nonblocking | 2026-08-08T03:32:44Z | 2026-08-03T00:29:58Z | `quota-latest.json`; scoped worker router resolved rank 1 with no skips; all three harness capabilities pass | `OPEN_AGENTS_SCOPED_ENV=1` dispatch worker invoking `hermes-coding-dispatch.py run-queued` with resolved model `gpt-5.6-luna`, provider `openai`, effort `max` |
| homelinux | Claude Code 2.1.220 subscription | `claude-opus-5` | yes | 95% remaining in measured all-models pool | 2026-08-09T22:59:59Z | 2026-08-03T00:29:58Z | Authoritative fleet quota snapshot; login-shell binary `/home/cvsloane/.local/bin/claude`; all three harness capabilities pass | `ssh homelinux 'bash -lc "/home/cvsloane/.local/bin/claude --model claude-opus-5 --effort high --allowedTools Read,Grep,Glob -p REVIEW_PROMPT"'` without `--bare` |

The team/shared OpenAI pool is measured and displayed but never independently blocks a Builder. A Builder launches only when the scoped ACP router resolves Luna and at least one routable non-shared OpenAI pool remains above the reserve floor.

## Role Routing and Failover

| Role/lane | Primary machine | Runtime/provider | Exact model ID | Reasoning effort | Minimum reserve | Fallback 1 | Fallback 2 | Handoff trigger | Independence constraint |
|---|---|---|---|---|---|---|---|---|---|
| AI Lead | heavisidelinux | Current Codex API session | `gpt-5` | system-managed | Session remains available | HOLD and escalate | HOLD and escalate | Context loss, unavailable runtime, or plan change | Does not independently accept substantive code it authors |
| Builder default | heavisidelinux | ACP scoped router through CLIProxyAPI/OpenAI | `gpt-5.6-luna` | max | 15% remaining in one routable non-shared pool | HOLD and escalate | HOLD and escalate | Scoped route does not resolve Luna, capability mismatch, no progress for 45 minutes, or two failed attempts | Fresh ACP task and isolated worktree; cannot review itself |
| Reviewer - standard | homelinux | Claude Code 2.1.220 subscription | `claude-opus-5` | high | 20% remaining in all-models pool | HOLD and escalate | HOLD and escalate | Login-shell route unavailable, capability mismatch, transfer mismatch, quota at reserve, or verdict unparseable | Fresh independent context on a different provider and machine; no write capability |
| Reviewer - critical | homelinux | Claude Code 2.1.220 subscription | `claude-opus-5` | high | 20% remaining in all-models pool | HOLD and escalate | HOLD and escalate | Authentication, command mutation, production, or release criterion lacks exact evidence | Fresh independent read-only disposable copy; never the Builder; AI Lead separately executes proof |
| Product Navigator | homelinux | Claude Code 2.1.220 subscription | `claude-opus-5` | high | 20% remaining in all-models pool | HOLD and escalate | HOLD and escalate | Frozen candidate or production screenshots unavailable | Fresh from Builder; evaluates experience but does not implement it |
| Ops/Deploy lane | heavisidelinux | Current Codex API session | `gpt-5` | system-managed | Session remains available | HOLD and escalate | HOLD and escalate | Review not passing, branch checks red, rollback unresolved, or production health fails | Not the Builder; deploys only the frozen reviewed candidate |

## Workstreams and Ownership

| Workstream | Builder | Deliverable | Owned paths/systems | Ground truth | Dependencies |
|---|---|---|---|---|---|
| W0 — Product and launch gate | AI Lead | Approved plan, acceptance checklist, UI brief, exact route and capability evidence | Project control files only | Human Owner direction, authenticated production audit, repo and ACP state | None; complete before Builder launch |
| W1 — Full ACP workspace vertical slice | One ACP Luna Builder | Typed ACP read/actions adapter plus dedicated responsive workspace and Attention linkage | `packages/ac-schema/src/**`; bounded `agents/agentd/**`; bounded `services/control-plane/src/**`; `apps/dashboard/src/app/(dashboard)/acp/**`; current Hosts ACP mount/component; sidebar/mobile nav; directly required ACP API/hooks/components only | Existing ACP files and CLI entrypoints, current Agent Commander patterns, checklist, live task/program records | W0 accepted; one worktree and one frozen candidate |
| W2 — Independent acceptance | Homelinux Opus Reviewer and Product Navigator | One structured verdict covering typed command safety, state semantics, product fit, accessibility, responsive layout, and scope | Read-only disposable copy; no code writes | Frozen W1 SHA and diff, build receipts, live state samples, desktop/tablet/mobile screenshots | W1 frozen and mechanically built |
| W3 — Integration and release | AI Lead and Ops/Deploy | Landed candidate, one protected PR, one ordered production rollout, one real ACP workflow, final report | Clean integration worktree, GitHub, Coolify `agent-console`, both agentd services, authenticated production route | Opus verdict, required branch checks, exact deployment identity, production browser and endpoint observations | W2 PASS; no unresolved non-waivable finding |

Maximum Builder parallelism is one. The backend and UI are one vertical candidate so Agent Commander does not require an intermediate default-branch merge, duplicate CI run, or partially deployed contract.

### Ownership Firewall

- The Builder may edit only the W1 paths named in its brief. It may not edit tests, fixtures, package manifests, lockfiles, migrations, deployment files, project control files, unrelated Automation or terminal behavior, or Open Agents source.
- The AI Lead owns project control files, shared integration, branch publication, PR disposition, deployment, rollback, and final evidence.
- The current local `030b409` project-status commit and the Human Owner correction in `tasks/lessons.md` are preserved through integration even though the ACP Builder bases from `origin/main` `b99a33c`.
- Existing ACP and Agent Commander data contracts are reused. A new module is allowed only when a directly named W1 caller cannot safely fit the existing route/component seam.

### Dashboard Brief

- Dashboard type: operational.
- User: Chris Sloane, single operator, primarily desktop and phone.
- Monitoring question: what development work needs attention now, what is running, and are the exact Builder, Reviewer, capacity, and release paths safe?
- Primary actions: New task and New program.
- Above the fold: dispatch readiness, needs-human count, active work, exact Luna and Opus routes, and release integrity summary.
- Progressive disclosure: raw quota pools, full attempts, logs, receipts, paths, and terminal details.
- Refresh: current state on page load, bounded polling using existing query conventions, and explicit refresh. No new monitor.
- Required states: loading, empty, zero-result, partial source, error, permission denied, disabled action with reason, submission progress, accepted, and held.
- Viewports: 390x844, 768x1024, and at least 1366x768.
- Design system: existing Agent Commander tokens, tables, tabs, sheets, badges, buttons, EmptyState, focus behavior, and app shell.

### Anti-Overengineering Controls

- No tests or test edits. No new smoke harness, canary, retry/backoff, fallback route, generic command bus, new state store, new scheduler, or database mirror.
- No decorative charts. Capacity and work are operational tables and compact status summaries.
- No grid of equally weighted raw cards. Dense sources begin with actionable summaries and reveal details through tabs, rows, and sheets.
- No model picker for ACP work. The operator selects only repo, objective, and risk; ACP owns exact routing.
- No automatic cleanup or mutation of the 29 existing `needs-review` records. They are classified as attention, not active work.
- No `Ready` label may imply an empty backlog. Dispatch readiness and human-attention state are separate concepts.

## Autonomy Lanes

| Action class | Lane | Preconditions | Receipt/evidence | Human checkpoint |
|---|---|---|---|---|
| Code changes | autonomous-with-receipt | Approved plan, passing capability gate, bounded ACP brief, isolated worktree | Frozen SHA, exact diff, ACP receipt | None |
| Push/merge/release | autonomous-with-receipt | Opus PASS, integrated builds, protected-branch requirements green | Branch, PR, merge, and source SHA | None; included in approved full plan |
| Staging deploy | forbidden | Agent Commander deploys directly to production | Production remains on last-known-good | Plan revision required to add staging |
| Production deploy | autonomous-with-receipt | Reviewed merged candidate, rollback identity retained, control-plane before agentd when schema changes | Coolify deployment, container SHAs, agentd binary digests, health and authenticated route | None; one final deployment was explicitly approved |
| Database mutation | forbidden | No database change is required by the approved architecture | Schema remains unchanged | Plan revision required |
| External/provider action | autonomous-with-receipt | Only approved ACP model calls, GitHub PR actions, Coolify deploy, and authenticated Agent Commander reads | Attempt records and provider/deployment IDs | None |
| Spending | forbidden | Existing subscriptions and infrastructure must suffice | Quota receipts; no incremental paid service | Plan revision before incremental spend |
| Delete/retire/cut over | autonomous-with-receipt | Limited to removing the superseded Hosts-page ACP mount and disposable review copies; source remains recoverable in Git | Diff and cleanup receipt | None |
| Credential/access change | autonomous-with-receipt | Limited to adding `chris` as the sole non-secret `CODING_DISPATCH_ALLOWED_CLI_APPROVERS` value required by the approved program flow; no credential, dashboard role, or host trust change | Before/after key presence without secret output, program approval receipt, rollback removal command | None; broader access or any credential mutation remains forbidden |

## Acceptance and Review

- Acceptance Checklist: `tasks/2026-08-02-agent-commander-acp-workspace-acceptance-checklist.md`
- Frozen deliverable: one exact Agent Commander commit in the ACP worktree, accompanied by changed paths, base SHA, ACP attempt identity, and build receipts.
- Mechanical checks, once on the frozen candidate: `go -C agents/agentd build ./...`; schema build; control-plane build; dashboard production build; `git diff --check`.
- No new tests and no local suite runs. The repository's existing protected-branch workflow may run once on the final PR because it is an unavoidable merge gate, not a new proof project.
- Independent Reviewer: fresh `claude-opus-5` at high on homelinux, read-only disposable content-verified copy, different provider and machine from the Luna Builder.
- Product review: the same frozen review includes the frontend audit; after deployment the AI Lead captures authenticated 390x844, 768x1024, and 1400x900 production screenshots and re-scores. A final score below 85 or any hard fail returns the exact finding to one bounded correction pass.
- Real-path proof: one real development task submitted from `/acp`, route identity observed, terminal state and receipt inspected, and the global Attention linkage exercised if the task creates a judgment or held state.
- Program-approval precondition: before the production action proof, the AI Lead writes only `CODING_DISPATCH_ALLOWED_CLI_APPROVERS=chris` into the canonical Hermes runtime environment, restarts no service unless the existing invocation path requires it, and proves a non-allowlisted identity is still refused.
- Human-reserved checks: any change to the approved product scope, acceptance waiver, incremental spend, credential change, database mutation, or acceptance of a known non-waivable finding.
- Non-waivable: no arbitrary command/path payload; operator authorization on every write; shared/team exhaustion does not block healthy non-shared routing; review stays Opus on homelinux; activation alignment is truthful; `needs-review` is not active; no text overlap or clipped primary action; no second ACP source of truth; no test expansion.

## Budgets and Stop Conditions

| Scope | Wall-clock ceiling | Token/cost ceiling | No-progress ceiling | Repeated-failure ceiling |
|---|---:|---:|---:|---:|
| Overall project | 12 hours | Existing subscriptions only; 30% maximum additional Luna pool use and 20% maximum additional homelinux Claude pool use | 90 minutes without new evidence | 2 |
| AI Lead | 12 hours | Current session; no incremental provider spend | 60 minutes | 2 |
| W1 — ACP Builder | 5 hours | ACP task cap $12 equivalent; HOLD at 15% remaining non-shared OpenAI reserve | 45 minutes | 2 |
| W2 — Opus review | 2 hours | At most two bounded Opus review calls; HOLD at 20% remaining | 45 minutes | 2 |
| W3 — integration/release | 5 hours | Existing GitHub and Coolify resources only | 60 minutes | 2 |

Progress means: a validated plan, brief verdict, ACP worktree diff, frozen commit, completed build, Reviewer verdict, integrated tree proof, green required branch check, deployment identity, authenticated screenshot, or real ACP task receipt.

Repeated-failure ceiling: two attempts at the same failure without new evidence or a materially changed direct strategy.

If the same failure repeats twice without new evidence or a materially different direct fix, HOLD the affected lane and write the Escalation Report. Do not add a retry, fallback, second implementation, harness, or test to work around it. A source-contract or security failure holds the whole program; an isolated visual finding may receive one bounded correction while the frozen backend remains unchanged.

## Human Checkpoints

| Trigger | Required decision | Urgency | Safe state while waiting |
|---|---|---|---|
| Scope, authority, or acceptance must change | Approve revised Project Plan | Before changed work | Last accepted source and production remain active |
| Incremental spend, database mutation, or credential/access change becomes necessary | Approve or reject expansion | Before mutation | Lane HELD with exact wall report |
| Opus finds a non-waivable defect that cannot be directly corrected inside two attempts | Revise scope or stop | Blocking | Candidate remains unmerged and production unchanged |
| Known residual risk would require a waiver | Accept or reject explicit waiver | Before merge or deploy | Reviewed candidate held |

The Human Owner already approved ordinary code changes, commits, the one protected-branch integration, the one final production deployment, and ACP model usage inside this plan. These actions produce receipts and do not create extra checkpoints.

## State and Control Files

- Current status: `tasks/2026-08-02-agent-commander-acp-workspace-status.md`
- Append-only log: `tasks/2026-08-02-agent-commander-acp-workspace-log.md`
- Metrics: `tasks/2026-08-02-agent-commander-acp-workspace-metrics.jsonl`
- Handoffs: `tasks/2026-08-02-agent-commander-acp-workspace-handoffs/`
- Final Report: `tasks/2026-08-02-agent-commander-acp-workspace-final-report.md`
- Escalation Report: `tasks/2026-08-02-agent-commander-acp-workspace-escalation-report.md`

The status file is current operational truth. The log and metrics are append-only. Handoffs freeze candidate and review evidence. SloaneVault stores the durable architecture link after closeout, not a second live status.

## Recovery

- Last-known-good GitHub and production baseline: Agent Commander `b99a33cd202af2de69ac555d68a7e4a12fef0d9b`.
- Preserved local baseline: `030b4095cf8d9473f7de0a4521cf0b97cf1fe9b9` plus the uncommitted ACP frontend lesson and these approved control files.
- Last-known-good agentd binary SHA-256: `c8b935b35b54461a7dd8795742825d68e1f5e37fe653ebd017a124701464aa0e` on both hosts.
- Production resource: Coolify `agent-console` (`dcgs4ccgkco44w4gkkg0kks8`). Record the active deployment and container identities again immediately before rollout.
- Dashboard/control-plane rollback redeploys `b99a33c`. Agentd rollback restores the checksum-named binary backups made immediately before replacement and restarts one host at a time.
- If only the new ACP UI fails, the reviewed source can remove `/acp` and restore the old Hosts mount from Git without changing ACP state. No ACP queue or program file is mutated during rollback.
- The non-secret CLI approver mapping rolls back by removing only `CODING_DISPATCH_ALLOWED_CLI_APPROVERS=chris` from the canonical Hermes runtime environment; existing credentials and Agent Commander roles remain unchanged.
- Recovery evidence: failed checklist ID, frozen candidate SHA, prior deployment and binary identities, relevant logs, authenticated route result, and exact rollback outcome.

## Launch Checklist

- [x] Human Owner approved this Project Plan through the selected full-workspace option and explicit implementation direction.
- [x] Acceptance Checklist exists and is approved.
- [x] Role/model assignments and approved fallbacks are recorded.
- [x] Both host capability checks pass and the scoped Builder route resolves Luna Max.
- [x] Machine-specific quota and reset evidence is current within 12 hours.
- [x] Workstream ownership and collision boundaries are explicit.
- [x] Autonomy lanes cover every consequential action class.
- [x] Ground truth and Reviewer independence are defined.
- [x] Budgets and progress-sensitive stop conditions are set.
- [x] Status, log, handoff, metrics, final-report, and escalation paths exist.
- [x] Recovery names the exact current source, production, and binary baselines.
