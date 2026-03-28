# Agent Commander Tranche 4: Memory Delivery, Safer Autonomy, and Hermes Integration

## Scope
- Fix host/provider capability truth so automation preflight is reliable after reconnects.
- Deliver memory through both prompt bootstrap and Claude-targeted file exports.
- Distill repeated successful trajectories into conservative procedural memory.
- Add catch-up, backlog, and external scheduler controls to automation wake policy.
- Persist structured worker reports and stable run artifact references.
- Add Hermes-facing wake/summary APIs plus repo-managed Hermes jobs in `open-agents`.

## Operating Decisions
- Hermes is the outer scheduler, watchdog, and routing layer for Heaviside production.
- Agent Commander remains the source of truth for sessions, automation, approvals, and memory.
- Native Agent Commander scheduling stays available, but Hermes-managed agents run in `external` scheduler mode.
- Claude Code gets file-backed memory export; other providers stay prompt-only in this tranche.
- Stable run logs reuse existing Agent Commander session artifacts instead of creating a second log store.

## Implementation Order
1. Extend schema and database state for slugs, worker reports, log refs, and external wakes.
2. Add provider-aware memory file export support to `spawn_session` and `agentd`.
3. Upgrade automation scheduling with scheduler mode, catch-up policy, and backlog caps.
4. Add service-auth and webhook wake APIs plus deterministic Hermes summary endpoints.
5. Update dashboard surfaces for the new automation/runtime/reporting controls.
6. Add Hermes manifest, client scripts, prompts, and skills in `open-agents`.
7. Build and typecheck both repos.

## Verification Targets
- Manual and autonomous Claude sessions receive prompt bootstrap plus memory file exports.
- External-mode agents do not get native scheduled wakes.
- Catch-up policy respects missed-run caps and queue depth limits.
- Repeated successful trajectories can produce reviewable procedural memories.
- Worker reports and run log refs exist for success, failure, block, and coalesce paths.
- Hermes can wake agents by slug and poll stable status/governance summaries without UI scraping.
