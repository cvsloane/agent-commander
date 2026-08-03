# W1 Builder Brief — Full Agent Commander ACP Workspace

Lane: W1 · Risk: critical · Backend: ACP `coding-dispatch` · Builder: `gpt-5.6-luna` at max on heavisidelinux · Base: `b99a33cd202af2de69ac555d68a7e4a12fef0d9b`

## Outcome

Replace the current Hosts-page ACP status card wall with one coherent, production-ready `/acp` workspace that reads and operates the existing ACP control plane through typed Agent Commander contracts.

This is one vertical candidate: schema, agentd adapter, control-plane routes, dashboard workspace, global Attention linkage, navigation, and removal of the old Hosts mount. Do not deliver a backend-only or UI-only milestone.

End with exactly one terminal token:

- `READY_ACP_WORKSPACE <sha>` when the complete candidate and handoff are committed.
- `BLOCKED_ACP_WORKSPACE <reason>` when an acceptance-bearing dependency is unavailable.
- `HELD_ACP_WORKSPACE <reason>` when the attempt, scope, or authority ceiling is reached.

## Authoritative Inputs

- Project Plan: `/home/cvsloane/dev/agent-command/tasks/2026-08-02-agent-commander-acp-workspace-plan.md`
- Acceptance Checklist: `/home/cvsloane/dev/agent-command/tasks/2026-08-02-agent-commander-acp-workspace-acceptance-checklist.md`
- Repo instructions: `/home/cvsloane/dev/agent-command/AGENTS.md`
- Repo lessons: `/home/cvsloane/dev/agent-command/tasks/lessons.md`
- Current production source: `origin/main` `b99a33cd202af2de69ac555d68a7e4a12fef0d9b`
- ACP source of truth on the host: `~/.hermes/coding/`, `~/.local/state/open-agents/quota-latest.json`, `~/.local/state/open-agents/capability-registry.json`, and the activated `~/.local/share/open-agents/current/scripts/hermes-coding-dispatch.py` entrypoint.

The plan and checklist are authority; this brief narrows implementation. The accepted Opus pre-dispatch review corrections recorded in `tasks/2026-08-02-agent-commander-acp-workspace-handoffs/w1-brief-review.md` are also authoritative. If these inputs conflict, stop and report the exact conflict rather than choosing a weaker condition.

## Verified Premises

1. The current ACP component is mounted from `apps/dashboard/src/app/(dashboard)/hosts/page.tsx` and its three equal columns are defined in `ACPStatusPanel.tsx`.
2. The current schema exposes only quota pools, activation rows, and task ID/repo/status/requested time. It has no program, objective, lane, route, attempt, verdict, blocker, cost, or detail contract.
3. The authoritative ACP store on heavisidelinux currently contains 0 queued, 0 running, 1 awaiting-input, 29 needs-review, 57 completed, and 59 failed task records, plus durable program records. These counts are a point-in-time premise, not UI constants. `needs-review` is attention, not active work.
4. Agent Commander already has operator authorization, host command routing, React Query, global Attention, terminal links, tables/tabs/sheets, responsive navigation, and partial/error-state patterns. Reuse them.
5. ACP already provides `enqueue`, `program`, `list`, `show`, and `tail` operations through `hermes-coding-dispatch.py`. Program commands accept structured answer and approval files and fail closed on a CLI approver allowlist.
6. `CODING_DISPATCH_ALLOWED_CLI_APPROVERS` is currently unset. The AI Lead—not this Builder—will configure the sole non-secret value `chris` before production approval proof.
7. The scoped ACP worker resolves `gpt-5.6-luna` at max. Fresh quota shows 69% non-shared OpenAI and 95% homelinux Claude remaining. Team/shared OpenAI is exhausted and nonblocking.
8. Both machines pass gateway, dispatch-worker, and release capability checks.
9. Agent Commander local main contains user-owned `030b409` and project-control commits not present in this base. The AI Lead owns integration. Do not reproduce, amend, or overwrite them.

Recheck premises 1, 2, 3, 4, and the actual ACP record shapes before editing. For premise 3, report the actual per-directory counts from the selected source host before relying on them. If a premise is false, report it; do not preserve a false brief by inventing compatibility data.

## Product Contract

### Navigation and page structure

- Add top-level desktop navigation labeled `ACP` with a fitting existing Lucide icon.
- Mobile primary navigation becomes Command Center, Attention, ACP, More. Sessions remains reachable through More/the full navigation; do not delete the Sessions route.
- Add `/acp` as a force-dynamic route with one client workspace using existing Agent Commander page width, spacing, typography, tokens, and controls.
- Remove the large ACP panel from Hosts. Hosts keeps enrollment, connectivity, capabilities, directories, ports, and other machine administration.
- Use four page tabs or equivalent stable sections: Overview, Work, Capacity and Routing, Fleet and Releases.

### Above the fold

Show these as compact operational summaries, not a row of decorative cards:

- Dispatch readiness and exact blocking reasons.
- Needs-human count, active count, and most urgent items.
- Builder route: `gpt-5.6-luna`, max, heavisidelinux, provider and reserve/freshness.
- Reviewer route: `claude-opus-5`, high, homelinux, provider and reserve/freshness.
- Release-integrity summary across heavisidelinux and homelinux.
- Primary `New task` and secondary `New program` actions.

`Ready to dispatch` means the execution route is available. It must not imply there is no backlog or nothing needs attention.

### Work model

Return bounded operator-safe summaries for task and program records. Normalize source states into:

- active: queue, queued, claimed, starting, running;
- attention: awaiting-input, judgment, blocked, needs-review and underscore variants;
- history: completed, complete, no-op and underscore variants, failed, error, canceled and cancelled variants.

Rows prioritize objective/goal, repo, normalized state, updated/requested time, next action, and program/lane relationship. Opaque IDs remain copyable secondary metadata.

Provide search, state/type/repo filters, bounded initial rows, and distinct empty versus zero-result states. Do not load an unbounded full log or render one card per record.

Detail must expose fields only when the authoritative record provides them: Builder/Reviewer machine, provider, model, effort, attempts/checkpoints, duration, cost/tokens, verification, verdict/reason/blockers, changed files, worktree/ref, program gates/lanes/dependencies/budget/next action, receipt and safe log tail. Missing fields say unavailable; never infer success.

### Capacity and routing

- Lead with the exact configured Builder and Reviewer routes and whether each route is selectable now.
- Group raw quota pools underneath in a compact table showing provider, pool, used/remaining, reset, confidence/freshness, role/effect, and shared/nonblocking status.
- The `codex-account-` team/shared pool remains visible but never independently blocks while a fresh routable non-shared OpenAI pool is below its ceiling.
- Do not add a model picker. The user selects risk; ACP selects the exact route.

### Fleet and releases

- Show each machine's activated release version/path and measurement time from `capability-registry.json`.
- Report aligned, different, or unknown by comparing those machine activation facts. Show an intentional pin only if a source record explicitly states one; do not infer a pin from divergence.
- Show gateway, dispatch-worker, and release capability results and measurement time for both machines when present.
- Merely known activation is not alignment.

### Actions

Use a fixed discriminated action contract across dashboard, control plane, agentd, and ACP invocation. Required actions:

1. `enqueue_task`: repo alias, objective, risk lane (`cheap`, `standard`, `critical`). The server derives source/requested-by identity.
2. `start_program`: repo alias and goal. The server derives request identity and writes the structured temporary answers document.
3. `answer_program`: full program ID and one non-empty answer for an ordinary awaiting-input prompt. The trusted server checks the current gate and rejects reserved control answers: trimmed case-insensitive `cancel`, plus `retry` at a judgment/needs-review gate. The response directs the operator to the dedicated action instead; generic answer handling must never silently cancel or retry a program.
4. `approve_program`: full program ID and explicit approve statement. Invoke ACP `program --program-id <id> --answers <answers-file> --approval-file <approval-file>`. The answers file contains `schema_version: 1`, a server-generated `request_id`, `requested_by`, and the approval answer. The approval file contains `schema_version`, `program_id`, repo, goal, `decision: "approved"`, statement, server-derived `approved_by=chris`, timezone-qualified current time, and `approval_snapshot`. Derive the exact `combined_sha256` snapshot from the program's setup task at `awaiting_input_history[-1].approval_snapshot.combined_sha256`; do not accept any authority or snapshot field from browser input. Let ACP re-verify the frozen plan/manifest against the worktree.
5. `cancel_program`: full program ID and an explicit confirmation. Invoke the supported ACP cancellation path using `program --program-id <id> --answers <answers-file>`, where the server-owned structured answer is exactly `cancel`. This is the only action allowed to send the cancellation token. Do not invent a state mutation or downgrade cancellation to copy-only behavior.

Every action:

- requires the existing authenticated operator/admin boundary;
- validates IDs as IDs, never paths;
- uses argv arrays and the activated ACP entrypoint, never `sh -c` or browser-supplied executable text;
- uses a bounded timeout and output size;
- creates structured temporary input files with mode 0600 inside an owned temporary directory, then removes them on success or error;
- returns accepted/queued truth separately from eventual work completion;
- preserves ACP's own fail-closed validation and records the actual error.

Do not add a generic ACP command endpoint.

### Attention and terminal integration

- Extend the existing Attention aggregation with ACP attention items. Reuse its refresh/action infrastructure and link to `/acp` detail; do not create a second global attention store or decision implementation.
- Awaiting input, judgment, blocked, and needs-review items qualify. Ordinary queued/running items do not.
- When an authoritative Agent Commander session link exists, expose the existing terminal link. Current ACP records do not provide that identity: in that case truthfully expose no terminal link. Do not infer one from ACP's `origin.session`, pane identity, or add a terminal client.

## Data and Security Boundaries

- Agent Commander is a transport/presentation layer; ACP files remain authoritative.
- Reads may sanitize ACP JSON files directly or invoke existing read-only ACP commands. Choose the smaller implementation that preserves source semantics and bounded output.
- Mutations must invoke existing ACP commands. Do not reimplement queue/program state transitions in Go or TypeScript.
- Use a dedicated operator-scoped `/v1/acp` route family so the dashboard does not choose a host. Queue/program reads and every mutation are pinned to heavisidelinux, the sole authoritative ACP source host. If heavisidelinux is offline, not ACP-capable, or its activated release does not match its registry measurement, return unavailable with the exact reason. Never fail over ACP state reads or mutations to homelinux; its machine-local store is not a second queue. Fleet capability and activation facts may still be read independently from both machines.
- Keep the existing host-scoped endpoint compatible if removing it would widen the change; the new page must not depend on a browser-selected host.
- Redact prompt bodies, answers, logs, environment values, and filesystem roots from control-plane logs beyond the operator-safe fields already required by the UI.
- Reject traversal (`..`, `/`, backslash, NUL), unknown action variants, extra strict-schema fields, non-allowlisted repo aliases, empty/oversized text, and non-operator requests.
- No credentials are created, read into the UI, logged, or changed.

## Required States and Responsive Behavior

- Default, hover, focus, active, disabled-with-reason, loading, empty, zero-result, partial, error, success/accepted, selected/expanded, and permission denied.
- Use semantic controls, labels, keyboard operation, visible focus, accessible names/state, WCAG-AA contrast, and text/icon status cues rather than color alone.
- Desktop target 1400x900, tablet 768x1024, mobile 390x844.
- No text overlap, horizontal page overflow, clipped primary actions, inaccessible tabs, or quota-first endless mobile wall.
- Work table may use deliberate horizontal scroll on desktop/tablet and priority rows/detail drilldown on mobile. Do not squeeze every column into 390px.

## Allowed Paths

- `packages/ac-schema/src/command.ts` and directly required existing ACP schema export file.
- `agents/agentd/cmd/agentd/main.go` and at most one directly required new `agents/agentd/internal/acp/**` file if keeping the logic in `main.go` would materially harm readability.
- `services/control-plane/src/routes/hosts.ts`, one new dedicated ACP route file, and the existing route-registration file directly required to mount it.
- `apps/dashboard/src/lib/api.ts`.
- `apps/dashboard/src/app/(dashboard)/acp/**`.
- `apps/dashboard/src/app/(dashboard)/hosts/page.tsx` and `apps/dashboard/src/app/(dashboard)/hosts/ACPStatusPanel.tsx` for removal of the old mount/component.
- `apps/dashboard/src/components/acp/**` and at most one `apps/dashboard/src/hooks/useACP*.ts` file.
- `apps/dashboard/src/components/layout/SidebarNav.tsx` and `MobileBottomNav.tsx`.
- `apps/dashboard/src/lib/attentionMerge.ts`, `apps/dashboard/src/hooks/useAttentionQueue.ts`, and `apps/dashboard/src/stores/orchestrator.ts`, plus the existing Attention renderer only where required to ingest, display, link, or act on ACP attention items. Make Attention type changes additive: widen the source union and keep existing session fields optional for ACP items so unchanged consumers and forbidden test files remain type-correct.
- `tasks/2026-08-02-agent-commander-acp-workspace-handoffs/w1-builder.md` only.

## Forbidden Paths and Actions

- Every test, fixture, snapshot, Playwright, CI, package manifest, lockfile, migration, deployment, secret, credential, environment, generated build artifact, unrelated documentation, project-control file, Automation behavior, terminal implementation, Android source, and Open Agents source.
- Do not install packages, run package-manager install, add a dependency, create a test, edit a test, run a test, run a repository suite, deploy, restart a service, push, merge, alter branch protection, or mutate production.
- Do not clean, cancel, requeue, answer, approve, or otherwise mutate an existing live ACP record while developing. Action proof before deployment is contract/build inspection only; the AI Lead owns the real post-deploy workflow.
- Do not use `git stash`; it is shared across worktrees.

⛔ **Forbidden unless this brief explicitly grants it, naming the target:**
- **Destructive database actions** — `db reset`, `db push`, `drop`, `truncate`, `delete` without a `where`, seed re-runs, any `--linked` / `--db-url` / remote-targeting flag. Migration *proof* means inspection plus a disposable local container, never a shared or production database.
- **Deploys, releases, cron/schedule registration, service restarts.**
- **Credential actions** — rotation, creation, deletion, or writing a secret into a file, a commit, or a log.
- **Third-party sends and public posts** — email to any non-internal address, SMS, social publishing, ad-platform writes.
- **Merges and pushes to a default branch.**
- **Anything outside the brief's declared owned paths.**

Hitting one of these is a **wall**, not a judgement call: stop and write the wall report. Do not construct an alternate path around it — no hand-rolled runner, no fixture, no parallel harness. A blocked gate honestly reported is a complete outcome.

## Anti-Overengineering Ceiling

- One vertical implementation, one source of truth, one action contract, one page, four stable sections, one detail interaction.
- Prefer at most 20 production files and roughly 2,000 readable added lines. This is a judgment ceiling, not a code-golf target. If the accepted feature cannot fit, return `HELD_ACP_WORKSPACE` with the exact decomposition rather than compressing JSX, adding wrappers, or omitting behavior.
- No charts, drag/drop, saved views, bulk actions, custom virtualizer, generalized adapter framework, generic command bus, or configuration system.
- Generalize only an existing repeated Agent Commander pattern. Do not add a helper for a single caller merely to shorten the diff.

## Verification and Handoff

Builder verification is limited to:

```bash
git diff --check
go -C agents/agentd build ./...
```

The ACP harness runs only the configured Go build. The AI Lead will apply the frozen candidate to the normal checkout and run schema, control-plane, and dashboard production builds once because the isolated worktree deliberately has no Node install. Do not install or symlink `node_modules` around that boundary.

Write `tasks/2026-08-02-agent-commander-acp-workspace-handoffs/w1-builder.md` using the canonical Builder handoff schema. Include:

- exact base and head;
- changed paths and diff summary;
- checklist IDs addressed;
- commands actually run and results;
- source-shape assumptions and missing-source behavior;
- action security boundary;
- known uncertainties;
- confirmation that no tests, installs, services, live ACP records, credentials, or production state were touched.

Commit the complete candidate and handoff. Do not push. End with exactly one required terminal token.
