# FW3-TMUX-UI — Correction round R2 (Wave 3)

Lane: FW3-TMUX-UI (attempt 2) · Same worktree/branch/firewall. Your `6526629` is integrated; the independent reviewer returned SHIP-WITH-NOTES with two warnings + two gating nitpicks assigned here. First: `git fetch origin && git rebase origin/refactor/frontend-command-center` (the AI Lead landed canonical-link fixes on top of your work). Fix only these four items.

1. **W1 — Topology staleness TTL** (`src/stores/tmuxTopology.ts` ~208-229): once a host emits one `tmux.topology`, roster fallback is disabled forever — `receivedAt` is stored but never read, so a host that emits once then goes silent freezes its window/pane structure permanently. Fix: in `setRoster`, when the live snapshot is older than a TTL (suggest 30s — topology coalesces at 500ms and polls reconcile, so anything older is dead), rebuild from roster (and clear the stale `liveByHost` entry). Test: emit → advance past TTL → roster update restores fallback structure.
2. **W2 — Duplicate roster fetch + store thrash** (`src/hooks/useTmuxTopology.ts` ~38-52): `useTmuxHostTopology` runs its own `getTmuxRoster` query per mount (up to 4 with 2-up terminals) and its differently-identical arrays fight the page-level feed in `setRoster`, rebuilding derived state repeatedly. Fix: pass `seedSessions` from the page-level roster into `TmuxWindowStrip`/`TmuxPaneControls` (they have access via the workbench), or make the hook skip its own query when the store already has a roster feed for that host. Zero duplicate HTTP requests on the Command Center path; test asserting no rebuild churn when the same roster identity flows twice.
3. **N1 — Last-window confirm gating** (`windowActions.ts` ~48-54, `TmuxWindowStrip.tsx` ~148-150): only show "This ends the whole tmux session" when the window count is authoritative (`source === 'topology'`); in roster-fallback mode use a softer confirm ("Close this window?") since untracked windows may exist.
4. **N4 — Percent-split version gating** (`paneActions.ts` ~9-15): stop falling back to `agent_version` as a tmux version proxy; unknown tmux version ⇒ plain split (no `-l N%`).

Gates as before (full TS chain). Commit prefix `fix(tmux-ui):`. Update your handoff (attempt: 2, new frozen_sha, R2 section), then print exactly:

`FW3-TMUX-UI-R2 FROZEN <full-sha>`
