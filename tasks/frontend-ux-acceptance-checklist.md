# Frontend Command Center UX — Acceptance Checklist

Program: `tasks/2026-07-20-frontend-tmux-ux-master-plan.md`. Maintained per wave (process fix from the 0.3.0 program, whose checklist only ever covered Wave 1). Ground truth = commands executed at the frozen SHA + committed evidence, never Builder summaries.

Non-waivable across all waves: full gate green (`pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:smoke:dashboard && pnpm build`, plus `go build ./... && go vet ./... && go test ./...` in agents/agentd when `agents/` changed); no ownership-firewall breaches; no edits to the per-viewer PTY transport mode; visualizer + R3F/Drei untouched.

## Wave 1

### FW1-MODERN
- [ ] TypeScript 7 across all workspaces; `pnpm typecheck` green using the TS 7 toolchain (evidence: `tsc --version` output in handoff).
- [ ] ESLint 10 + `eslint-plugin-react-hooks` unpinned to latest; the pnpm override removed; `pnpm lint` green including `SessionList` (the 7.1.1 compiler diagnostic resolved by fixing the component, not by disabling the rule).
- [ ] React 19 + react-dom 19 + @types/react 19; no runtime behavior change intended; smoke suite green.
- [ ] tailwind-merge 3 and lucide-react 1.x migrated (import/API renames only).
- [ ] The 3 `MobileLaunchSheet` exhaustive-deps warnings fixed (not suppressed).
- [ ] `pnpm build` (production) succeeds; no new build warnings attributable to the migration left undocumented.
- [ ] Zod untouched (stays 3.x — moves in FW2); `agents/**` untouched; no feature/behavior edits (mechanical only); visualizer deps untouched.
- [ ] Handoff `tasks/frontend-ux-handoffs/fw1-modern.md` with proof refs; token `FW1-MODERN FROZEN <sha>`.

### FW1-TMUX-GO
- [ ] `list-panes` collection extended with pane_active, window_active, window_zoomed, window_layout, pane_width, pane_height, window bell/activity flags; values reach `sessions.upsert` `metadata.tmux`.
- [ ] `tmux.topology` event implemented per the shapes frozen in the brief; debounced; emitted on tmux hook triggers with polling retained as reconciliation; feature-detects hook support and degrades to poll-only.
- [ ] Executor handles `new_window`, `kill_window`, `rename_window`, `split_pane`, `select_window`, `select_pane`, `resize_pane`, `zoom_pane` with `commands.result` acks; unit tests per op against a private-socket tmux server.
- [ ] Stale attached-channel supersede: a valid new `terminal.attach` after a control-plane restart supersedes the old channel instead of being rejected; integration test simulating CP reconnect passes (closes the W4-TERM-CLIENT deferred item).
- [ ] `capture_pane` range mode verified/extended for stable scrollback paging; test proves two consecutive pages are contiguous and non-overlapping.
- [ ] New protocol fixtures committed exactly matching the brief's shapes; Go round-trip fixture test green; shapes unchanged after freeze (any change requires AI Lead sign-off).
- [ ] All tmux spawned by tests uses a private `-L` socket; no operations against the host's live tmux server (heavisidelinux kill-session crash hazard).
- [ ] Handoff `tasks/frontend-ux-handoffs/fw1-tmux-go.md`; token `FW1-TMUX-GO FROZEN <sha>`; branch pushed to origin.

### Wave 1 integration (AI Lead)
- [ ] Both lanes reviewed against firewalls + briefs; integrated on `refactor/frontend-command-center`; full gate green post-integration.
- [ ] Wave PR to main opened; owner merge + production deploy; owner on-device PWA pass recorded in the log.

## Wave 2 (to be detailed at wave launch)
- [ ] FW2-CONTRACTS: Zod 4 across ac-schema/CP/dashboard; TS schemas for the frozen Wave-1 fixtures; topology UI topic; scrollback endpoint; window/pane command routes; fleet aggregate endpoint; TS+Go fixture round-trips green.
- [ ] FW2-TERM: output-frame hot path fixed (no store writes/reconnect transitions per frame; scroll anchoring); app-level persistent terminal host with reattach; `@xterm/addon-search` + 10k scrollback; xterm-survives-navigation stateful test.

## Wave 3 (outline)
- [ ] Command Center landing live (signin callback + PWA start_url); old `/` redirects; nav/breakpoint unification; single attention surface; launch rail; `SpawnSessionDialog` deleted.
- [ ] Window strip + window/pane management UI + desktop key bar + 2-up desktop multi-terminal + scrollback pager.

## Wave 4 (outline)
- [ ] Unified fleet model consuming the aggregate endpoint (4-concurrent cap removed); terminal attention overlay; prompt composer; health badges + saved filters.
- [ ] `/sessions`, `/memory`, `/hosts`, settings migrated to the design system; god components decomposed; command palette.

## Wave 5 (outline)
- [ ] Playwright journey suite green at 390×844 + 1280×720 for the seven journeys named in the plan; perf probes recorded; CHANGELOG 0.4.0; docs refreshed; acceptance checklist fully reconciled.
