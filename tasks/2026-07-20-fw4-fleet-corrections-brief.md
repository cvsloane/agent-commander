# FW4-FLEET — Correction round R2 (Wave 4)

Lane: FW4-FLEET (attempt 2) · Same worktree/branch/firewall. Your `9081a13` is integrated; reviewer returned SHIP-WITH-NOTES with these items assigned here. Fix only these three.

1. **Aggregate freshness guard** (`src/stores/fleet.ts` ~245-253): `ingestAggregate` unconditionally overwrites `sessionsById[id]`, so a 30s reconcile fetch that was in flight when a `sessions.changed` update landed reverts fresher state on the Command Center hot path. Merge per-session preferring the newer `updated_at` (keep the existing record when it is newer). Test: targeted update then older aggregate → fresher state survives.
2. **Prune `sessionsById` on reconcile** (same file): entries are never removed except explicit deletes; archived sessions keep their `latest_snapshot` in the map forever (slow heap growth on long-open dashboards). On `ingestAggregate`, intersect `sessionsById` with (aggregate ids ∪ current roster ids). Test.
3. **Read-only gating for PTY-input paths** (AI Lead ruling): the prompt composer and the attention overlay's "Respond" action are terminal-input-equivalent and must respect the terminal's read-only state — when the viewer is read-only, disable them with a short "Read-only — take control to type" hint. Approve/deny stay enabled (governance actions, same as the attention queue). Wire the existing readOnly state from the terminal connection into `TmuxTerminalWorkspace`/`PromptComposer`/`TerminalAttentionOverlay`. Tests for both gated paths.

Gates as before (full TS chain). Commit prefix `fix(fleet):`. Update handoff (attempt: 2, new frozen_sha, R2 section), then print exactly:

`FW4-FLEET-R2 FROZEN <full-sha>`
