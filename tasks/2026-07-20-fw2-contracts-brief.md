# FW2-CONTRACTS — Zod 4 + control-plane side of the tmux contracts (Wave 2)

Lane: FW2-CONTRACTS · Machine: homelinux · Worktree: `~/dev/wt/ac-fw2-contracts` · Branch: `refactor/fw2-contracts` (off `refactor/frontend-command-center`; local, do NOT push)
Program plan: `tasks/2026-07-20-frontend-tmux-ux-master-plan.md` · Acceptance: `tasks/frontend-ux-acceptance-checklist.md` (Wave 2)

## Mission

Two jobs that share the same files, so they are one lane: (a) migrate the TypeScript stack Zod 3→4; (b) land the control-plane half of the Wave-1 agentd contracts — schema registration, tolerance, endpoints — so the new agentd capabilities become reachable and a future agentd rollout is safe. The 9 fixture files under `tests/fixtures/protocol/` (tmux-topology + 8 commands) are a FROZEN contract: your TS schemas must round-trip them byte-exactly; you may not change them.

## Work items

1. **Zod 3→4** in `packages/ac-schema`, `services/control-plane`, `packages/ac-cli`, `apps/dashboard` (bump `zod` only — no other dep changes). Mechanical API migration at all call sites. Behavior-identical validation; where Zod 4 tightened/changed semantics (e.g. error shapes, `.passthrough`/`.strict` behaviors, coercion), preserve current runtime behavior and note each such site in the handoff.
2. **Register `tmux.topology`**: schemas in `packages/ac-schema` matching `tests/fixtures/protocol/tmux-topology.json` exactly (no `seq` — it is intentionally unsequenced; make seq optional for this variant or model it as a separate envelope class consistent with how the CP validates). Handler in `services/control-plane/src/ws/agent.ts` + relay to a new UI stream topic `tmux.topology` (subscription model identical to existing topics). Store nothing durable; latest-state fan-out only.
3. **Unknown-envelope tolerance**: in `ws/agent.ts`, when an agent frame parses as JSON with a string `type` not in the union, log a warning (rate-limited) and DROP it instead of `socket.terminate()`. Keep terminate for malformed frames (invalid JSON / missing type / oversized). Tests for both paths. This is the forward-compat fix that unblocks the agentd binary rollout.
4. **8 window/pane command types**: add to `CommandTypeSchema` + `CommandPayloadSchema` in ac-schema matching the fixture payloads exactly (`new_window`, `kill_window`, `rename_window`, `split_pane`, `select_window`, `select_pane`, `resize_pane`, `zoom_pane`; optionality per the FW1-TMUX-GO brief). Wire through the existing `POST /v1/sessions/:id/commands` dispatch with existing authz (operator role + host tmux/terminal capability via commandRouter/terminalPolicy); ensure they are NOT in the privileged-blocked list. Extend the TS fixture round-trip test to consume all 9 frozen fixture files — this is the cross-language contract check that was Go-only in Wave 1.
5. **Scrollback endpoint**: `POST /v1/sessions/:id/scrollback` accepting `{mode: 'visible'|'last_n'|'range'|'full', last_n_lines?, start_line?, end_line?, strip_ansi?}` → dispatches the existing `capture_pane` command and returns the result. Sensible caps (e.g. ≤5000 lines/request). Schema + tests.
6. **Fleet aggregate endpoint**: `GET /v1/orchestrator/fleet` returning, in one response, every orchestrator session with its children rollup, work-item counts, latest report summary, and budget/usage fields the dashboard fleet cards need (read `apps/dashboard/src/hooks/useOrchestratorFleet.ts` for the exact per-card data it fetches today). Endpoint + tests only — dashboard consumption is Wave 4.
7. **`rename_session` end-to-end**: `PATCH /v1/sessions/:id` with a title change also dispatches the (already-supported) `rename_session` command to the owning agent when connected, so tmux and DB stay in sync. Guarded, non-fatal if agent offline.

## Ownership firewall

You may edit: `packages/ac-schema/**`, `services/control-plane/**`, `packages/ac-cli/**`, TS protocol-fixture test files, `migrations/` from 039 ONLY if genuinely needed (claim the number in your handoff; expected: none), and **mechanical Zod-API call-site edits** in `apps/dashboard` (list every dashboard file you touch in the handoff). You may NOT touch: `apps/dashboard/src/components/terminal/**`, `components/TerminalView.tsx`, `components/mobile/**`, `components/session/**`, `components/tmux/**`, `hooks/useTerminal*`, `hooks/useXtermTerminal.ts` (FW2-TERM owns these), `agents/**`, `deploy/**`, `tests/fixtures/protocol/*.json` (frozen).

## Gates

`pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:smoke:dashboard && pnpm build` — all green. TS fixture round-trips green against the frozen files. Commit per work item, prefix `feat(cp):` / `chore(schema):`. ≤3 attempts on the same failure, then `state: held` with evidence.

## Done

Handoff `tasks/frontend-ux-handoffs/fw2-contracts.md` (schema per that directory's README), committed on your branch, then print exactly:

`FW2-CONTRACTS FROZEN <full-sha>`
