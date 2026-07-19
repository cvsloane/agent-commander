# Wave 1 Lane DASHBOARD Brief — Phone-Proof Connection Resilience

You are the DASHBOARD Builder lane of the agent-command massive refactor (Wave 1). Read first:
- `tasks/2026-07-19-massive-refactor-master-plan.md`
- `tasks/2026-07-19-subsystem-study-findings.md` §3 items 1,2 and §5 item 1

## Ground rules
- Work ONLY in your worktree `/home/cvsloane/dev/wt/ac-w1-dash` on branch `refactor/wave1-dashboard`. Commit early/often. Do NOT push; the AI Lead integrates.
- Ownership: `apps/dashboard/**` only. If you believe ac-schema needs an export, note it in the handoff instead of editing.
- The control plane is being hardened in a sibling lane; your changes must work against BOTH the current server (no server ping, no hosts.changed message) and the hardened one. Feature-detect, never assume.

## Tasks
1. `src/lib/ws.ts`: remove the 5-attempt permanent give-up (~lines 24,103-117). Infinite reconnect, capped (~30s) full-jitter exponential backoff. Immediate reconnect on `visibilitychange`→visible, `online`, `pageshow`. Add an application-level keepalive (~25s) that is schema-valid against the CURRENT server (inspect `services/control-plane/src/ws/ui.ts` — a benign re-subscribe is acceptable) so proxies (Cloudflare ~100s idle) don't kill the socket.
2. `src/hooks/useTerminalConnection.ts` (~200-212): auto-reconnect with jittered backoff on unexpected close. Inspect `services/control-plane/src/routes/terminal.ts` close codes 4001-4009 and only retry transient ones (never auth/permission/idle_timeout/deliberate detach). Preserve the xterm buffer across reconnects (no terminal reset); re-attach on reconnect; also reconnect on visibility/online.
3. Global connection-state store + unobtrusive banner (layout shell): "reconnecting…"/"offline" for the event WS; per-terminal reconnecting indicator. Mobile-friendly, no layout shift.
4. Extract the duplicated WS-URL resolution (~60 lines shared by `src/lib/ws.ts:185-252` and `src/hooks/useTerminalConnection.ts:39-111`) into one helper used by both.
5. Tests: extract the reconnect/backoff state machine as a pure testable unit. Vitest: never gives up; backoff caps; visibility/online triggers immediate retry; terminal close-code classification. Enable `.test.tsx`/jsdom in the vitest config only if needed — keep the change minimal.

## Gate
```bash
cd /home/cvsloane/dev/wt/ac-w1-dash
pnpm --filter @agent-command/dashboard test
pnpm --filter @agent-command/dashboard typecheck
pnpm --filter @agent-command/dashboard lint
```

## Handoff
Write `tasks/massive-refactor-handoffs/w1-dashboard.md` in your worktree (YAML frontmatter: lane, branch, frozen_sha, attempt, gate results, assumptions, uncertainties, blockers; then summary), commit it. End your final message with: `W1-DASHBOARD FROZEN <sha>`.
