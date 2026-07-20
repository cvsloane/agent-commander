# W4-TERM-CLIENT — Terminal Transport + xterm Modernization (CP + dashboard ends)

Read master plan workstream D + findings §3 items 3,6,7. Worktree `/home/cvsloane/dev/wt/ac-w4-tc`, branch `refactor/wave4-term-client`. Ownership: `services/control-plane/src/routes/terminal.ts` (+ its tests), `packages/ac-schema` additive (browser terminal protocol), `apps/dashboard` terminal stack ONLY (`src/hooks/useTerminalConnection.ts`, `useXtermTerminal.ts`, `src/components/terminal/**`, `TerminalView.tsx`, `TmuxMobileShell.tsx` terminal-mount region, related tests/package.json deps). A sibling lane owns the rest of the dashboard — do not touch tmux roster/nav/automation/orchestrator files. No push; handoff `tasks/massive-refactor-handoffs/w4-term-client.md`; token `W4-TERM-CLIENT FROZEN <sha>`.

Agentd already landed (read `tasks/massive-refactor-handoffs/w4-agentd-term.md`): per-viewer PTY, attach cols/rows, resume_token, terminal.lag — consume these.
1. CP terminal route: enable permessage-deflate; support binary WS frames browser-side with feature negotiation (client sends `{type:'hello', binary:true}`; fallback to current JSON+base64); forward cols/rows on attach + resume_token re-attach; role-check resize; surface terminal.lag to client.
2. Dashboard: migrate `xterm@5.3` → `@xterm/xterm` + `@xterm/addon-fit` + `@xterm/addon-webgl` (canvas/DOM fallback); binary frame path (ArrayBuffer → xterm.write Uint8Array, no base64 char loop); use resume_token on auto-reconnect.
3. Keep terminal mounted across mobile mode switches (CSS-hide instead of unmount in TmuxMobileShell terminal region; verify scrollback survives roster round-trips).
4. Keyboard-aware layout: drive terminal container height from visualViewport via CSS var; key bar pinned above OS keyboard; terminal protocol types (incl. idle_timeout, lag) defined once in ac-schema and consumed by both ends.
5. Tests: CP route (binary negotiation, resume, role-check) + dashboard protocol unit tests; run smoke.

Gate (bare exit codes): `pnpm --filter @agent-command/control-plane test && pnpm --filter @agent-command/dashboard test && pnpm typecheck && pnpm test:smoke:dashboard`
