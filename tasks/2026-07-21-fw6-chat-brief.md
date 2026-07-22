# FW6-CHAT — Local chat-transcript overlay for claude panes (device finding 6c)

Lane: FW6-CHAT · Machine: heavisidelinux · Worktree: `~/dev/wt/ac-fw6-chat` · Branch: `refactor/fw6-chat` (off `refactor/frontend-command-center`; local, do NOT push)
Owner device finding (S25 Ultra, production): claude panes on app-scroll are "still glitchy with the weird characters along the side, and the poor scrolling — no improvement." Owner locked: local transcript overlay for claude panes, sourced from claude-code's OWN on-disk chat history. Do not re-litigate.

## Root cause & verified facts (AI Lead, empirical — do not re-derive)

1. Wheel delivery to claude WORKS (probe on a live claude TUI: SGR `\x1b[<64;x;yM` events scroll the transcript ~2 lines/event, pane stays byte-clean even at 40 rapid events). The remaining "weird characters along the side" are VIEWER-side xterm tearing while claude's full-screen redraws stream to the phone; the sluggishness is round-trip physics. Input tuning cannot fix either — the fix is local rendering, same as the accepted codex overlay.
2. claude-code writes complete session history to `~/.claude/projects/<cwd-slug>/<claude-session-uuid>.jsonl` (verified for the owner's live pane). Claude hook events carry `transcript_path` (and `session_id`) and agentd ALREADY receives + parses them (`extractAssistantText`, `resolveHookSessionID` in `agents/agentd/cmd/agentd/main.go` ~:3859/:4133) — it just doesn't retain the path.
3. Existing per-pane classification (FW6-ALT) stays; this lane adds a third mode ahead of app-scroll for panes with a resolvable transcript.

## Design (owner-locked)

### 1. agentd: retain transcript paths + new `capture_transcript` command

- On every claude hook event that resolves to a session, retain the latest `transcript_path` in an in-memory session→path map (evict with session cleanup).
- New agent command `capture_transcript` (schema additive, mirrors `capture_pane` dispatch): request `{page_size?: int (default 200, max 500), before_entry?: int}` → response `{ok, result: {entries: [...], first_entry: int, total_entries: int, source: 'hook'|'derived'}}`. Entries are the RAW parsed JSONL objects (pass-through; size-cap each entry's content fields at 16KB, drop binary/base64 blobs). Paging is newest-first by entry index from file end (`before_entry` = fetch the page ending just before that index).
- Path resolution: hook-retained path first; fallback DERIVE: pane current path → claude project slug dir (`/` and special chars → `-`, verified example in this brief's provenance) → newest-mtime `.jsonl`. If neither resolves or the file is unreadable → `ok:false, error.code='no_transcript'`.
- Security bound: only accept resolved paths under `~/.claude/projects/` (reject anything else, including hook-supplied paths outside it — hook data is app-controlled input).
- Go tests: path retention, derive fallback (temp dirs), paging math, oversize-entry capping, out-of-bounds rejection. Private sockets where tmux is involved.

### 2. Control plane: `POST /v1/sessions/:id/transcript`

- Operator role, session lookup + tmux-host gating identical to the scrollback route, dispatch `capture_transcript`, audit-log `session.transcript`. Additive schema for request/response + fixtures + schema tests. Old agentd returns an unknown-command error → surface as `ok:false` (dashboard falls back; NO termination — tolerance landed in FW2).

### 3. Dashboard: transcript mode in the overlay

- Extend FW6-ALT classification to three modes: `history` (unchanged) → else try transcript: the overlay (same component/UX — bottom-anchored, virtualized, native scroll, load-older paging, Live pill + bottom-overscroll dismiss) fetches `/v1/sessions/:id/transcript`; on success mode=`chat`, on `no_transcript`/error mode=`app-scroll` (existing wheel routing stays as the fallback — do NOT remove it).
- Formatter (pure, exported, unit-tested): JSONL entries → display lines. Locked rendering: user messages prefixed `❯ `, assistant text plain, tool uses as one dim line `⏺ <tool>` (+ first 80 chars of primary input), skip thinking/system/meta/progress entries entirely. Wrap long lines to the overlay width (soft wrap is fine — virtualization may use measured or estimated row heights; keep it simple and deterministic).
- Load-older = previous entry page via `before_entry`, prepend with the existing compensation (overflow-anchor already disabled). Reopen refetches newest page. Read-only viewers may read transcripts (read-only-safe).
- Classification caching per historySessionId as today; transcript attempt happens on overlay open, not at attach-prime (prime stays capture-based and cheap).

### 4. Rollout note (AI Lead handles, not this lane)

Deploy order is safe by construction: dashboard/CP first (old agentd → graceful app-scroll fallback), agentd binaries rolled after. Lane must NOT touch deploy files.

## Work items

1. Schema: `capture_transcript` command + response + fixtures (TS + Go parity) + CP schema tests.
2. agentd: path retention map + command implementation + derive fallback + bounds/caps + Go tests.
3. CP route + audit + tests.
4. Dashboard: mode extension, transcript fetch path in the overlay, formatter + unit tests, fallback wiring.
5. Journeys (extend fw6-focus mock): claude-like pane with a mocked transcript response → drag-down opens the overlay showing formatted chat lines, zero navigate frames, zero input frames; transcript-error pane falls back to app-scroll navigate frames (existing test stays green); load-older transcript paging prepends stably; codex/shell overlay journeys unchanged.

## Ownership firewall

You may edit: `packages/ac-schema/**` (additive), `agents/agentd/**`, `services/control-plane/**`, `apps/dashboard/src/(components/(terminal)|hooks)/**`, `apps/dashboard/src/components/TerminalView.tsx`, `tests/fixtures/**`, `tests/journeys/**`, related tests. You may NOT edit: `deploy/**`, `agents/hook-proxy/**`, launch/orchestrator surfaces, descriptor-key contract, letterbox, mobileFocus, Keyboard/Cursor rail, ScrollbackPager dialog, the FW6-ALT app-scroll wheel path (it remains the fallback).

## Gates

Full chain: `pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:smoke:dashboard && pnpm test:journeys && pnpm build` + `(cd agents/agentd && go build ./... && go vet ./... && go test ./...)`. Playwright from a real tmux TTY. `pnpm install --frozen-lockfile` first. Commit per work item, prefix `feat(chat):`. ≤3 attempts per failure then hold; re-run any new red isolated (×5) before counting an attempt.

## Done

Handoff `tasks/frontend-ux-handoffs/fw6-chat.md` (same frontmatter as fw6-alt.md, include Go gate), committed, then print exactly:
`FW6-CHAT FROZEN <full-sha>`
