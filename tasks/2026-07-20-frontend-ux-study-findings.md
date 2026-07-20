# Frontend UX Study Findings - 2026-07-20

Evidence base for `tasks/2026-07-20-frontend-tmux-ux-master-plan.md`. Studied at main `70fa53e` (0.3.0 fully merged and deployed; production containers built from `SOURCE_COMMIT=70fa53e`, deployed 2026-07-20T04:05Z).

## 0. Why the mobile app "looks exactly the same" after 0.3.0

- Post-signin landing is hardcoded to `/` (`apps/dashboard/src/app/signin/page.tsx:72,97` — `callbackUrl: '/'`), and `/` still renders the v0.2.0 desktop card grid with a literal "New in v0.2.0" hero (`app/(dashboard)/page.tsx:132`), with **no mobile layout branch**.
- Everything new in 0.3.0 (tmux mobile shell, `/orchestrator` page, fleet roster, bottom tabs) is additive and sits **behind** bottom-tab taps; first paint on a phone is the old dashboard with a bottom bar bolted on.
- Compounding sameness: two entries to the same drawer (header hamburger + bottom-nav "More", both toggling `ui.mobileMenuOpen`), and two orchestrator surfaces (header bell → `OrchestratorModal` bottom sheet; bottom tab → `OrchestratorPageClient` full page) rendering the same `useAttentionQueue()` data.

## 1. Information architecture today

Routes (all under `app/(dashboard)` unless noted): `/` legacy landing; `/tmux` (TmuxPageClient → `TmuxMobileShell`/`TmuxDesktopShell` at `useIsMobile(1024)`); `/orchestrator` (Fleet + Attention tabs, `max-w-5xl`); `/sessions` (666-line `SessionsPageClient`, ~10-button toolbar, not phone-redesigned); `/sessions/[id]`; `/automation`; `/memory`; `/hosts`; `/settings`; `/groups/[id]` (redirect); `(visualizer)/visualizer` (separate design language, off by default); `/signin`.

Navigation: desktop `GlobalSidebar` rail; the same sidebar as mobile overlay drawer; `MobileBottomNav` (`md:hidden`) with tabs tmux / Orchestrator / Sessions / More. Breakpoints are inconsistent: CSS `md:` (768) vs JS `useIsMobile()` (768) vs tmux's `useIsMobile(1024)`.

State: Zustand stores — `orchestrator.ts` (1406 lines, attention/fleet brain), `settings.ts` (681), `session.ts`, `usage.ts`, `notifications.ts`, `groups.ts`, `connection.ts`, `ui.ts`, `theme.ts`, plus 4 visualizer-only stores. Data: `lib/api.ts` (1074 lines) + react-query + shared UI WebSocket (`lib/ws.ts` via `useWebSocket`) + a **separate** terminal WebSocket (`hooks/useTerminalConnection.ts`, 430 lines).

Design system: 10 shadcn-style primitives in `components/ui` (no dialog/sheet/dropdown/command primitives — hand-rolled per feature); Tailwind v4 + HSL tokens; old pages use `container mx-auto` while new ones use bespoke widths; tap-target sizing inconsistent between old and new surfaces.

## 2. Terminal/tmux client — capability matrix vs native tmux

Architecture: per-viewer PTY (0.3.0 default) — agentd creates a **grouped tmux session** `ac-view-<channel>` and runs a real `attach-session` under a PTY (`agents/agentd/internal/tmux/viewer_pty.go:156-186`), read-only viewers via `attach -r`. So the xterm renders a genuine tmux client: status bar, all panes of the current window, and every prefix command works as opaque bytes.

| Capability | Status | Evidence |
|---|---|---|
| Attach/view live output (whole window) | Supported | `viewer_pty.go:178-186`; one `TerminalView` at a time |
| Status bar / window list | Supported via tmux bytes only | no React window strip; roster is separate |
| Switch windows | Mobile key bar (prefix-p/n); desktop hardware kbd only | `lib/tmuxKeys.ts:12-13`; `TerminalSurface.tsx:97-99` gates key bar to mobile |
| Create/kill/rename windows | Missing as UI actions | not in `tmuxKeys.ts:10-22` nor `TmuxActionSheet.tsx` |
| Split panes / select panes / zoom | Mobile buttons; desktop hardware kbd | `tmuxKeys.ts:14-21` |
| Resize individual panes | Missing (client resize only resizes whole tmux client) | `useXtermTerminal.ts:20-33` |
| Scrollback | Partial: 4000-line local cap, resume replay is `capture-pane` of visible screen only | `useXtermTerminal.ts:56`; `terminal.go:316` |
| Scrollback search | Missing (`@xterm/addon-search` not installed) | `package.json` |
| Copy mode / selection / paste | Supported, richer on mobile (SelectionPopup, long-press menu, iOS fallbacks) | `TerminalSurface.tsx:76-95`, `useTerminalClipboard.ts` |
| Input incl. special keys | Supported (VirtualKeyboard, CSI-u Shift-Enter) | `VirtualKeyboard.tsx:43-53`, `useXtermTerminal.ts:99-112` |
| Multiple terminals at once | Missing (single mount; no grid/split) | `SessionWorkbench.tsx:180-195` |
| Persistent terminal | Within `/tmux` mode switches only; unmounts on route change | `TmuxMobileShell.tsx:19-31,300-324`; `TerminalView.tsx:118-127` |
| Rendering | WebGL + DOM fallback; keyboard-aware viewport | `useXtermTerminal.ts:88-95`; `useTerminalConnection.ts:338-358` |
| Reconnect | Resume tokens + backoff + visibility/online triggers; 10-min server idle timeout | `lib/reconnect.ts:29-90`; `terminal.ts:143-155` |
| Read-only observer / take control | Supported + audited | `TerminalToolbar.tsx:67-96`; `terminal.go:323-326` |

Perf hazards: every `output` frame runs `markConnected()` → reconnect-state transition + `setStatus` + `setErrorMessage(null)` + forced `scrollToBottom()` (`useTerminalConnection.ts:159-163`) — hot-path churn that also fights user scroll; roster "all hosts" fans out per-host fetches and rebuilds clusters on any session change with only a 750ms debounce (`useTmuxRosterData.ts:263-269`); xterm selection mirrored into React state re-renders during drag (`TerminalView.tsx:28-36`); stacked document-level touch listeners (SelectionPopup + ContextMenu + touch-scroll RAF loop).

## 3. Backend capability inventory and gaps

Everything native "works" only as opaque bytes in one PTY; the protocol has **no structured representation** of topology, activity, or copy state.

Exists and consumed: per-viewer PTY attach/input/resize/control/detach + readonly/lag/idle frames; resume tokens; `GET /v1/tmux/roster` (DB-derived, poll-fed); `POST /v1/tmux/open`; commands send_input/send_keys/interrupt; console.subscribe pipe-pane text path; fork/copy-to/bulk/spawn; orphan/adopt; orchestrator/fleet endpoints; UI stream topics.

Exists but **unused/dead**: `rename_session` (schema `enums.ts:48` + executor `main.go:1942`, zero producers — session PATCH is DB-only); `spawn_job`; `capture_pane` as a command (rich modes in `tmux.go:187`, only used server-side in cross-host copy `sessions.ts:530`); legacy FIFO/shared-PTY bridges; JSON output frame branch (client always negotiates binary).

Gaps (with owning layer):
1. **No topology events** — panes polled (`main.go:4621` → `syncPanes`), one `sessions.upsert` per pane; no push on window/pane add/close/rename/move/split. Fix: agentd event source (tmux hooks) + schema event + CP relay.
2. **No active-pane/active-window/layout/zoom/flags** — `ListPanes` format (`tmux.go:50`) omits `pane_active`, `window_active`, `window_layout`, `window_zoomed_flag`, sizes. Fix: format extension + schema fields.
3. **No pane-scoped multi-stream** — attach keyed to session's single `tmux_pane_id` (`terminal.ts:287,321`); cannot stream two panes as separate surfaces.
4. **No scrollback paging endpoint** — agentd `CapturePaneRange` (visible/last_n/range/full) is ready; no CP endpoint, no UI pager.
5. **No structured copy-mode/buffers** — no list-buffers/show-buffer, no search.
6. **No status-line/window flags** (bell/activity/silence/marked) beyond derived `SessionStatus`.
7. **Window/pane management not exposed as commands** — agentd already has `NewWindow`/`SplitPane`/`KillPane`/`ResizePane`/select ops (`tmux.go`), but no `CommandPayload` types for them. **Lowest-effort, highest-value gap.**
8. **tmux control mode (`-CC`)** absent everywhere; previously rejected in `webtmux_fix.md:373`. It is the canonical real-time source underpinning gaps 1–6, but replacing the transport again is high-risk.

## 4. Prior art, leftovers, deferred debt

Essentially all of the 2026-05-19 tmux-command-center + mobile-launch programs and 2026-02-14 fixes shipped (roster model, mobile shell, key bar, action sheet, launch sheet, per-viewer terminals, PWA/push, fleet cards, bottom nav). Outstanding:
- Persistent launch/open **rail** (nav tabs shipped instead) — prior item #34.
- Legacy `SpawnSessionDialog.tsx` never deleted; `SessionGenerator`/`RepoPicker` never made mobile-first; `LAUNCH_PROVIDERS`/`SESSION_TEMPLATES` never centralized.
- Host capability write API never reconciled (`routes/hosts.ts` has no terminal/spawn/providers writes).
- Saved roster filters + tuned health badges (BACKLOG ideas, open).
- W4-FLEET-UI: no CP fleet aggregate endpoint — dashboard caps at 4 concurrent per-orchestrator bundles.
- W4-TERM-CLIENT: resume after full CP restart can be rejected by agentd (stale attached-channel supersede needs an agentd change); no stateful rerender test proving xterm survives roster→terminal switches.
- W3-PWA: push never exercised end-to-end on real iOS hardware; second dedicated WS for `attention.changed`; 60s polling of failed/blocked run sets.
- W6-CLEANUP deferred: `eslint-plugin-react-hooks` pinned 7.0.1 (7.1.1 trips `SessionList`); 3 `exhaustive-deps` warnings in `MobileLaunchSheet`; major dep migrations all deferred (React 18→19, Zod 3→4, tailwind-merge 2→3, lucide 0.x→1.x, ESLint 9→10, TS 5→7…); `uuid@8.3.2` advisory via next-auth.
- Acceptance checklist only ever covered Wave 1 (process gap to fix this program).

## 5. UI debt hot list

Largest offenders: `stores/orchestrator.ts` 1406, `SettingsPanel.tsx` 1125, `lib/api.ts` 1074, `OrchestratorItem.tsx` 952, `SessionsPageClient.tsx` 666, `SessionList.tsx` 643, `ConsoleView.tsx` 635, `MobileLaunchSheet.tsx` 574 (visualizer/botspace files excluded — isolated). Duplications: attention queue rendered twice; fleet represented twice (`TmuxOrchestratorRow`+`lib/fleetRoster.ts` vs `OrchestratorFleetCard`+`useOrchestratorFleet`); session header actions implemented three times (tmux workbench header, session detail page, action sheet); terminal input emitted from three places; mobile/desktop tmux shells re-declare ~30 overlapping props.
