# W3-PWA — Installable PWA, Push Subscribe, Unified Attention Queue

Read master plan workstream B + findings §3 (mobile gap analysis). Worktree `/home/cvsloane/dev/wt/ac-w3-pwa`, branch `refactor/wave3-pwa`. Ownership: `apps/dashboard/**` only (backend routes/messages are landing in sibling lane W3-PUSH-BACKEND — feature-detect 404s; read its brief `tasks/2026-07-19-wave3-push-backend-brief.md` for the contract). No push; handoff `tasks/massive-refactor-handoffs/w3-pwa.md`; token `W3-PWA FROZEN <sha>`.

1. PWA baseline: `public/manifest.json` (name Agent Commander, standalone, theme/bg colors matching the dark UI), full icon set (generate simple mark programmatically — a terminal-glyph rounded square is fine; 192/512 + maskable + apple-touch), `export const viewport` with viewport-fit=cover + themeColor in `src/app/layout.tsx`, apple-mobile-web-app meta.
2. Service worker (hand-rolled, `public/sw.js`, registered client-side): app-shell + static asset cache, offline fallback page, `push` event → showNotification with deep link, `notificationclick` → focus/open URL. No workbox dependency.
3. Push subscribe flow: settings section + first-run prompt on mobile — Notification.requestPermission → pushManager.subscribe (VAPID public key from a CP endpoint) → POST subscription; unsubscribe; graceful when backend routes 404.
4. Safe areas + dvh: `env(safe-area-inset-*)` on sheets/key bars/bottom controls (TmuxActionSheet, TmuxKeyBar, mobile shells), replace remaining `100vh`/`calc(100vh-*)` with dvh equivalents (LayoutShell.tsx:116 and friends).
5. Unified attention queue: upgrade `/orchestrator` mobile-first — one list merging session approvals, waiting-input detections (consume server `attention.changed`/attention_reason when available, fall back to client DetectionEngine), governance approvals, failed/blocked runs; one-tap approve/deny/open-terminal; convert OrchestratorModal to a bottom sheet on mobile (OrchestratorModal.tsx:222).
6. Tests: vitest for subscribe-flow state machine + attention merge logic; keep 43 existing green; run smoke.

Gate: `pnpm --filter @agent-command/dashboard test && pnpm --filter @agent-command/dashboard typecheck && pnpm --filter @agent-command/dashboard lint && pnpm test:smoke:dashboard` (bare, exit codes).
