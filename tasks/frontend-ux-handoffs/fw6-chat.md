---
lane: FW6-CHAT
frozen_sha: 6226466b87c62c4c94fc0aeab5ab0fe32da1828d
attempt: 1
state: frozen
gates:
  lint: pass
  typecheck: pass
  test_ci: pass
  smoke: pass
  journeys: pass
  build: pass
  go: pass
proof:
  - "pnpm install --frozen-lockfile → completed before repository inspection or implementation"
  - "pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:smoke:dashboard && pnpm test:journeys && pnpm build → exact mandatory gate passed in order on attempt 1 from a tmux-backed TTY"
  - "pnpm lint → all 5 Turbo tasks passed with zero errors; three existing hook warnings remain"
  - "pnpm typecheck → all 5 Turbo tasks passed"
  - "pnpm test:ci → all 5 Turbo tasks passed, including the new schema, transcript-route, formatter, and touch-mode coverage"
  - "pnpm test:smoke:dashboard → 21/21 Chromium scenarios passed"
  - "pnpm test:journeys → 40 passed and 22 expected project skips across mobile and desktop"
  - "pnpm build → 4/4 Turbo build tasks passed; Next.js 16.2.10 production build completed"
  - "go build ./... && go vet ./... && go test ./... → passed from agents/agentd with /home/cvsloane/.local/go/bin/go"
  - "FW6 Focus focused journey → 13/13 passed at mobile-412x915, covering chat rendering, stable transcript prepend, no_transcript app-scroll fallback, hybrid mode switching, History, Cursor, and Focus behavior"
  - "New-red isolation → both corrected app-scroll journey assertions passed five repeats each: 10/10"
  - "Frontend product audit → real Playwright interaction at 412x915 plus desktop smoke/journeys; score 98/100 with no hard failures"
assumptions:
  - "Claude JSONL variants outside the locked user, assistant, and tool display shapes are intentionally skipped rather than surfaced as raw metadata."
  - "A retained hook path is authoritative only after canonical containment and regular-file checks under ~/.claude/projects; otherwise the safe derived path is attempted."
uncertainties:
  - "A physical Galaxy S25 Ultra was unavailable; touch dispatch, transcript paging, wrapping, fallback, and overlay closure were exercised in the mobile-412x915 Chromium project."
blockers: []
---

# FW6-CHAT frozen handoff

## Outcome

FW6-CHAT replaces claude-code's slow, tearing remote redraw path with a local, bottom-anchored transcript overlay whenever a safe Claude JSONL transcript is available. Codex history behavior remains unchanged, and claude panes without a transcript retain the existing app-scroll wheel fallback.

## Delivered work

- Added the additive `capture_transcript` protocol contract, typed success/failure response, TS/Go fixture parity, and control-plane schema coverage.
- Retained the newest Claude hook transcript path per session in agentd and evicted it with session cleanup.
- Implemented safe hook-path validation and CWD-derived fallback beneath `~/.claude/projects`, including symlink containment, regular-file checks, newest-mtime selection, chronological paging, bounds, 16 KB content caps, and binary/base64 removal.
- Added the operator-only `POST /v1/sessions/:id/transcript` route with session/tmux-host gating, command dispatch, `session.transcript` audit logging, and graceful old-agent unknown-command fallback.
- Extended attached-pane classification to `history`, `chat`, and `app-scroll` without adding transcript work to the cheap attach prime.
- Reused the existing virtualized overlay for chat, including newest-page refetch, stable older-page prepend, bottom anchoring, Live return, bottom-overscroll dismissal, and read-only access.
- Added the pure transcript formatter with locked user, assistant, and dim tool rendering; metadata/thinking/progress suppression; primary-input truncation; and deterministic width wrapping.
- Extended the journey mock and browser coverage for formatted chat, zero navigate/input frames in chat mode, stable paging, Start-of-chat state, transcript-error fallback, and unchanged codex/shell behavior.

## Verification notes

- The exact required frontend and Go chains passed on the first full attempt from the requested tmux TTY.
- Two existing app-scroll journey expectations were updated for the locked classify-first/cache-second gesture behavior. Each correction passed five isolated repeats before the full chain ran.
- The frontend audit exercised transcript success, loading/paging, fallback/error, read-only, focus, and responsive wrapping states in real Chromium journeys. It scored 98/100 with no hard failure.
- The ownership firewall was preserved: no deploy, hook-proxy, launch/orchestrator, descriptor-key, letterbox, mobile Focus, rail-key, ScrollbackPager, or production-state changes were made.

## Work-item commits

- `00c1840` — `feat(chat): add transcript protocol contracts`
- `f0647d0` — `feat(chat): capture local Claude transcripts`
- `22d72a1` — `feat(chat): expose session transcript route`
- `9048485` — `feat(chat): render Claude transcript overlay`
- `6226466` — `feat(chat): prove transcript overlay journeys`

The `frozen_sha` is the final implementation/test commit; the following handoff-only commit adds this file.

FW6-CHAT FROZEN 6226466b87c62c4c94fc0aeab5ab0fe32da1828d
