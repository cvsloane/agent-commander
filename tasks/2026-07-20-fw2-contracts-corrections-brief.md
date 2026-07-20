# FW2-CONTRACTS — Correction round R2 (Wave 2)

Lane: FW2-CONTRACTS (attempt 2) · Same worktree/branch/firewall as R1. Your frozen `40bbd14` passed my gate re-run and is integrated; the independent reviewer returned SHIP-WITH-NOTES with two warnings + two hardening nitpicks assigned to this lane. Fix only these four items.

1. **W1 — Fleet aggregate efficiency** (`services/control-plane/src/routes/orchestrator.ts` ~161-189): `GET /v1/orchestrator/fleet` currently does `db.getSessions({include_archived:false})` with no LIMIT and fetches snapshots for every session, then fans out 3–5 queries per orchestrator. Rework: identify orchestrator sessions first, compute the direct-children id set, fetch sessions/snapshots only for that union, and bound the per-orchestrator fan-out (batch where straightforward). Keep the response shape identical (tests must stay green; extend them for the scoping behavior).
2. **W2 — Role check**: require `operator` on `GET /v1/orchestrator/fleet` (it aggregates budget/cost + capture snapshots). Test.
3. **N2 — Lock the terminate invariant**: add an agent-WS test that a KNOWN envelope type with an invalid payload (e.g. `sessions.upsert` with garbage payload) still terminates the socket — so a future refactor can never turn the tolerance path into drop-everything.
4. **N3 — Defensive ordering** (`services/control-plane/src/services/pubsub.ts` ~553-556): in `publishTmuxTopology`, place the trusted `host_id: hostId` AFTER the payload spread so a future schema field can never be overridden by agent data.

Gates as before (full TS chain). Commit prefix `fix(cp):`. Update your handoff (attempt: 2, new frozen_sha, brief R2 section), then print exactly:

`FW2-CONTRACTS-R2 FROZEN <full-sha>`
