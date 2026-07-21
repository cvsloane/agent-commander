# Orchestration handoff — AI Lead transfer to heavisidelinux (2026-07-21)

You are taking over as AI Lead / orchestrator for the agent-command Frontend Command Center program (Autonomous Development Loop per SloaneVault "Integrator-Supervisor Harness"). The previous AI Lead ran from homelinux; orchestration moves here due to model quota. The Human Owner (Chris, S25 Ultra / Brave Android, single user) will give updated instructions directly in this session.

## Current state (all verified live)

- **Production**: main @ `b835f78` deployed on Coolify (apps-vps, compose resource `dcgs4ccgkco44w4gkkg0kks8`, verify via container env SOURCE_COMMIT; containers `dashboard-dcgs4…`/`control-plane-dcgs4…`). Health ok, agents:2. Public: https://agents.heavisidetechnology.com
- **agentd**: FW6-TOUCH binary live on BOTH hosts (user systemd service, `~/.local/bin/agentd`; backups `agentd.bak-fw6t`). After ANY binary swap: `pgrep -a agentd` must show EXACTLY ONE process per host (an orphan with the same token causes a ~3s register/kick loop that still looks "online").
- **Branch**: `refactor/frontend-command-center` = merged to main through PR #95; branch and main are content-identical right now. PRs land via checks-pass → `gh pr merge --merge --admin`.
- **Program**: 0.4.x Frontend/Mobile UX COMPLETE through Wave 6 + 5 device-finding punch-list rounds (attach loop, settings GRANT, FW6-FOCUS, FW6-SCROLL, FW6-TOUCH). Receipts: `tasks/frontend-ux-log.md` (append-only ledger), `tasks/frontend-ux-status.md`, final report `tasks/frontend-ux-final-report.md`, briefs+handoffs in `tasks/`.

## Open items

1. **Owner device acceptance pending** for findings 4+5: swipe-scroll feel (codex transcript + copy-mode), tap-without-keyboard, Keyboard/Cursor rail keys. Owner may report tuning feedback — treat as tuning passes, not redesigns.
2. **Device checklist** (`docs/device-checklist.md`) — remaining items the owner hasn't confirmed (PWA/push incl. Brave "Use Google services for push messaging", cold-open restore, pinch font, letterbox, approval overlay, push deep link).
3. **BACKLOG.md** — journey-suite stabilization pass (2 flakes fixed at root already; launch-sheet fill timeout remains), Dependabot #39 (uuid <11.1.1, unused code path, next dep pass), batch-2 review LOWs.
4. **Next program queued (owner-selected): Hermes deep integration** — do not start without owner instruction.

## Protocol (unchanged, owner-locked)

- Builders are codex lanes (`codex --yolo`, gpt-5.6-sol xhigh) in tmux windows of THIS `agent-command` session, one worktree per lane (`~/dev/wt/ac-<lane>`, branch off `refactor/frontend-command-center`, never pushed). Brief in `tasks/`, completion token `<LANE> FROZEN <sha>` printed in the pane; handoff file `tasks/frontend-ux-handoffs/<lane>.md`.
- AI Lead: verify freeze (firewall audit vs brief, diff review — the review chain catches real defects every round; last two lanes each shipped one), integrate with `--no-ff`, re-run the FULL gate from a tmux TTY split pane (`pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:smoke:dashboard && pnpm test:journeys && pnpm build` + Go build/vet/test in agents/agentd), then PR → admin-merge → deploy watch (SOURCE_COMMIT) → agentd rollout if agentd changed → owner phone test as acceptance.
- Autonomy: merges + deploys are autonomous-with-receipt (owner directive). Append every round to `tasks/frontend-ux-log.md` and push.
- Watchers: 5-minute digest loop per lane (commits, Working/idle, context/quota) + instant FROZEN/HELD token detection. Owner standing directive: check every 5 minutes.

## Hard-won safety rules (do not relearn these)

- **NEVER `tmux kill-session` on this machine's main tmux server** (historic server crash). Kill only windows/panes you created; lanes run their gates in PRIVATE `tmux -L` sockets or dedicated `new-session -A -s <lane>-builder` sessions — clean those up by name.
- Before `send-keys` to any pane: check `pane_current_command` (node = a live codex TUI). A mis-staged multi-line draft is cleared with a single Ctrl-C.
- send-keys prompt text and Enter as separate calls (~2s apart), then verify "Working".
- Playwright MUST run from a real tmux TTY (session shells swallow child output). Clear `apps/dashboard/.next` after route restructures. Kill port squatters (3210/3211) before journeys.
- Two journey tests were flaky under parallel load and are FIXED at root; if a new red appears once, re-run it isolated (×5) before burning a gate attempt — but never wave through a red without that evidence.
- DB (agent_console on db-vps 100.82.152.103): superuser only via `docker exec -u postgres postgres_db psql -h /var/run/postgresql`; migrations run as superuser MUST include GRANTs to `agent_console`.
- Coolify env rows are `encrypt()`-serialized — never write them as plain encrypted strings.

## Machine notes for this host

- Repo: `~/dev/agent-command` (synced to origin/refactor/frontend-command-center at handoff). Go at `~/.local/go/bin/go`. codex CLI available; weekly quota was ~21% at handoff — split heavy lanes toward homelinux (ssh homelinux) if it runs low.
- homelinux remains reachable via ssh for lane fan-out and has an identical layout; its tmux session `agent-command` window 0 was the previous orchestration home (windows there may be killed freely).

Await the owner's updated instructions before launching any new work.
