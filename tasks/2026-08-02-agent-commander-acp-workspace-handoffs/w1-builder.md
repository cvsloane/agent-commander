# W1 Builder Handoff — ACP Workspace

## Candidate identity

- Task: `cd_20260803_013947_agent_command_w1_builder_brief_full_agent_comm_e7cf752b`
- Lane: W1 ACP Workspace
- Builder branch: `hermes/cd_20260803_013947_agent_command_w1_builder_brief_full_agent_comm_e7cf752b`
- Exact ACP-selected worktree base: `3dccd71f92eb529b9286060f1ed5c2f2965a996c`
- Candidate implementation head: `a8c4307` (`feat(acp): complete workspace vertical slice`)
- Production baseline: `b99a33cd202af2de69ac555d68a7e4a12fef0d9b`
- Base ancestry confirmation: `git merge-base 3dccd71f92eb529b9286060f1ed5c2f2965a996c b99a33cd202af2de69ac555d68a7e4a12fef0d9b` returned `b99a33cd202af2de69ac555d68a7e4a12fef0d9b`.
- Candidate tree: one complete source candidate; this handoff is the follow-on receipt commit and does not alter production behavior.

## Diff summary

Candidate `a8c4307` changes 18 scoped paths: 3,251 insertions and 397 deletions. It adds the typed ACP action/status contract, the agentd ACP source/action adapter, the operator-scoped control-plane `/v1/acp` family, the force-dynamic `/acp` workspace, navigation, and ACP Attention linkage; removes the obsolete Hosts ACP component and mount; and keeps the existing host-scoped status endpoint compatible.

### Changed paths

- `agents/agentd/cmd/agentd/main.go`
- `agents/agentd/internal/acp/acp.go`
- `apps/dashboard/src/app/(dashboard)/acp/ACPPageClient.tsx`
- `apps/dashboard/src/app/(dashboard)/acp/page.tsx`
- `apps/dashboard/src/app/(dashboard)/hosts/ACPStatusPanel.tsx` (deleted)
- `apps/dashboard/src/app/(dashboard)/hosts/page.tsx`
- `apps/dashboard/src/components/layout/MobileBottomNav.tsx`
- `apps/dashboard/src/components/layout/SidebarNav.tsx`
- `apps/dashboard/src/components/orchestrator/OrchestratorItem.tsx`
- `apps/dashboard/src/hooks/useAttentionQueue.ts`
- `apps/dashboard/src/lib/api.ts`
- `apps/dashboard/src/lib/attentionMerge.ts`
- `apps/dashboard/src/stores/orchestrator.ts`
- `packages/ac-schema/src/apiResponses.ts`
- `packages/ac-schema/src/command.ts`
- `services/control-plane/src/config.ts`
- `services/control-plane/src/index.ts`
- `services/control-plane/src/routes/acp.ts`

## Checklist coverage

- **IA-1–IA-4:** Added top-level desktop/mobile ACP navigation, dedicated `/acp`, four stable tabs, primary New task/secondary New program actions, and removed the Hosts ACP wall.
- **WORK-1–WORK-5:** Added bounded task/program ingestion, normalized active/attention/history states, per-record tolerant parsing with skipped counts, search/type/state/repo filters, distinct empty/zero-result states, detail evidence, program gates/lanes/dependencies/budget, and explicit unavailable fields.
- **ACT-1–ACT-7 and ACT-5a:** Added the strict discriminated action contract for enqueue, start, answer, approve, and cancel; server-derived identity; fresh approval digest verification; explicit cancellation; reserved-answer rejection; existing ACP command invocation; and sole `chris` approval mapping.
- **ROUTE-1–ROUTE-4:** Added configured Builder and adversary/reviewer policy summaries separately from recorded resolutions, provider/reserve/freshness display, quota pool role/effect/freshness, and nonblocking shared OpenAI treatment. Synthetic USD estimates are telemetry only and are not a readiness/action stop.
- **REL-1–REL-2:** Added per-machine activated version/path/time, truthful aligned/different/unknown comparison, intentional-pin passthrough only when sourced, and gateway/dispatch-worker/release capability rows.
- **ATTN-1–ATTN-2:** Added ACP items to the existing Attention merge/store/refresh path, using source timestamps and neutral `ACP_ATTENTION`, with links to `/acp` detail.
- **ATTN-3:** Preserved the existing terminal-link rule; ACP records expose no terminal link without an authoritative Agent Commander session identity.
- **UI-1, UI-3, UI-4:** Added compact summaries, tables/tabs/sheets, loading/empty/zero-result/partial/error/permission/disabled/submitting/accepted/held copy, semantic controls, labels, focus styles, and non-color status text. Browser screenshots and UI-5 scoring remain downstream proof.
- **INT-1 and INT-8:** Candidate is frozen in the ACP-selected worktree with bounded paths and no new scheduler/database/test harness/arbitrary command bus.
- **INT-2–INT-7 and INT-9:** Not claimed by this worker; integrated builds, independent review, deployment, production identity, real workflow, and rollback evidence belong to the AI Lead/harness.

## Source-shape assumptions and missing-source behavior

- Agentd resolves the activated release from the local capability registry `harness_instances[].freshness.activated_path`, then reads only the activated entrypoint, router/model policy files, and coding-dispatch map. The map alias column is the repo allowlist source; filesystem path columns are never returned.
- Quota input expects `generated_at` and pool rows with provider, pool ID, confidence, numeric-or-null `used_percent`, and string-or-null `resets_at`; optional measurement, pool-kind, source-plan, and routing flags are preserved only as operator-safe fields. Fresh measured capacity above the Builder 15% or Reviewer 20% reserve floor is selectable; stale/unmeasurable/disabled capacity is held.
- Work ingestion scans the bounded ACP state directories and `programs`, deduplicates by record identity, normalizes underscore/space variants, and parses each JSON record independently. Invalid/non-object/structurally invalid records are skipped and surfaced through `partial` plus `skipped_count`; an unavailable section remains available as an explicit error state rather than blanking the workspace.
- Program approval reads the latest `awaiting_input_history[-1].approval_snapshot.combined_sha256`; the displayed digest is only a concurrency token. Missing approval history, missing program/setup records, malformed registry/router/map/quota sources, and missing detail fields return explicit unavailable/unknown behavior.
- Fleet facts are read per machine through that machine's own ACP-capable agent; unreachable or incapable registry sources become `unknown`, never `different` and never a failover authority.

## Action security boundary

- Every read/write is behind the existing authenticated operator boundary. `/v1/acp` resolves only the server-owned `ACP_SOURCE_HOST_ID` UUID, requires that exact host to be online and advertise `acp_status`, and never trusts a browser-selected host or fails over ACP state.
- Browser and control-plane inputs are strict discriminated actions. IDs reject traversal, separators, NUL, and oversized values; repo aliases must match the activated allowlist; action text is bounded, non-empty, and cannot begin with `-`. There is no generic ACP command endpoint, executable/path field, arbitrary argv, state-root path, or unrestricted file payload.
- Agentd invokes the activated ACP entrypoint with argv arrays only, emits flags before `--`, places repo/objective/goal text after `--`, uses bounded command/output limits, creates a private temporary directory and mode-0600 structured files, and removes them on success or error.
- Approval requires a non-service authenticated identity mapped to `chris`, a fresh server-side digest match, and a second agent-side digest match. The approval file contains only the frozen-plan fields required by the contract. Generic `cancel` and judgment/needs-review `retry` answers are rejected; cancellation is the only server-owned path that sends `cancel`.
- Mutations invoke existing ACP `enqueue`/`program` commands and preserve ACP fail-closed validation. No credential, environment file, database, production state, or live ACP record was changed.

## Commands actually run

- Read repository `AGENTS.md`, `CLAUDE.md`, the frozen W1 brief, plan, checklist, review, lessons, and affected source files.
- Inspected scoped paths and references with `find`, `grep`, `git status`, `git diff`, `git log`, `git rev-parse`, and `git merge-base`.
- `git diff --check` — passed before freeze.
- `git add` of the explicit W1 paths plus `git diff --cached --check` — passed.
- `git commit -m "feat(acp): complete workspace vertical slice"` — committed as `a8c4307`.
- No tests, package-manager commands, installs, Go build, services, live ACP commands, credentials, deployments, pushes, merges, or production mutations were run.

## Known uncertainties and handoff gates

- The exact activated-host CLI/source records were not live-read or mutated in this worker; the adapter follows the frozen brief’s verified release/file contract. The AI Lead/harness must run the configured `go -C agents/agentd build ./...` and the one-time schema, control-plane, and dashboard production builds.
- No browser screenshots, authenticated responsive audit, frontend score, independent Opus review, configured `ACP_SOURCE_HOST_ID` runtime proof, `CODING_DISPATCH_ALLOWED_CLI_APPROVERS=chris` runtime proof, or real ACP workflow receipt is claimed here.
- The source candidate intentionally does not gate dispatch on synthetic USD estimates. Real activated route reachability and subscription quota/reserve are the capacity guards; the runtime mapping and production proof remain downstream prerequisites.

## Scope and safety confirmation

This worker touched only the frozen W1 production paths and this handoff path. No tests or fixtures were added/changed, no installs or locks were changed, no services were started/restarted, no live ACP records were answered/approved/cancelled/requeued, no credentials were read/created/changed, and no production state was mutated.
