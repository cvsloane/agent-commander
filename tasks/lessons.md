# Lessons

- Date: 2026-02-04
  Correction: User clarified they deploy directly to production (no staging) for this project.
  Rule: Do not suggest staging for agent-command; proceed with production deploy when asked.

- Date: 2026-02-07
  Correction: User flagged that edits should use the `apply_patch` tool (not running an apply_patch script via `exec_command`).
  Rule: When modifying files, use the `functions.apply_patch` tool for patches instead of invoking `apply_patch` through shell commands.

- Date: 2026-02-14
  Correction: User asked to store this kind of refactor/implementation note under `tasks/` instead of the repo root.
  Rule: Put internal implementation notes in `tasks/` using an ISO date prefix in the filename.

- Date: 2026-03-27
  Correction: User asked to continue implementation without stopping for input unless actually blocked.
  Rule: After plan approval or an explicit "continue" instruction, keep executing through UI, docs, and verification instead of pausing at an intermediate backend-only milestone.

- Date: 2026-03-28
  Correction: User clarified that "live and in production" also means the GitHub default branch should match the deployed production state, not just a build branch or manual server sync.
  Rule: Before claiming agent-command is fully live/in production, verify three things explicitly: deployed runtime is updated, changes are pushed, and `origin/main` includes the production commit when the user expects full production alignment.

- Date: 2026-03-28
  Correction: User clarified that `Clawdbot` is now named `OpenClaw`.
  Rule: Use `OpenClaw` in all user-facing copy, docs, release notes, and UI labels for agent-command unless referring to a legacy internal config key or code symbol.

- Date: 2026-03-28
  Correction: User clarified the tmux manager should behave like a condensed accordion list of tmux sessions, not a broad card wall that leaves windows/panes visually expanded by default.
  Rule: On the `/tmux` page, default the roster to one compact row per tmux session with explicit expand/collapse behavior that reveals windows and panes only for the open session.

- Date: 2026-07-19
  Correction: AI Lead directed Next build/Playwright smoke verification to use polling when concurrent agent sessions exhaust the host's 128 inotify-instance limit, without stopping other tmux sessions.
  Rule: On this host, run the Next build and dashboard smoke gate with `CHOKIDAR_USEPOLLING=1 WATCHPACK_POLLING=true`; track raising `fs.inotify.max_user_instances` to 1024 as the durable ops fix.

- Date: 2026-07-20
  Correction: Independent review found that the fleet aggregate over-fetched all sessions, exposed snapshot and budget data below operator role, and lacked regression locks for known-invalid agent envelopes and trusted topology host identity.
  Rule: Scope aggregate queries to their actual entity graph, page or concurrency-bound every fan-out, require operator role for snapshot/cost aggregates, test both tolerant and terminating protocol paths, and spread trusted server identity fields after untrusted agent payloads.

- Date: 2026-07-20
  Correction: The Command Center moved from `/tmux` to `/`, but tmux roster navigation still targeted the legacy redirect.
  Rule: Treat `/` as the canonical Command Center route for new tmux navigation while preserving query parameters so incoming `/tmux` redirects remain compatible without adding an avoidable remount to in-app selections.

- Date: 2026-07-20
  Correction: Captured touch pointers on the mobile terminal rail did not synthesize clicks in real Chromium, the Next dev-tools portal intercepted harness taps even after the pointer-up fix, and the persistent terminal descriptor dropped `hostId`, forcing per-host prefixes back to `C-b`.
  Rule: Activate captured touch taps on `pointerup`, make `nextjs-portal` pointer-transparent in Playwright harnesses, thread host-scoped identity through every persistent slot/descriptor/portal boundary, and assert the exact terminal WebSocket byte; click-only coverage and action-completed traces are insufficient.

- Date: 2026-07-20
  Correction: Wave 3 review found that live topology never expired, child roster consumers duplicated fetches and rebuilds, and destructive/version-gated actions trusted non-authoritative signals.
  Rule: Expire optional live feeds back to polling, share page-level query results with child consumers, and gate destructive copy or protocol flags only on authoritative source metadata.

- Date: 2026-07-20
  Correction: Wave 4 review found that Ctrl+K collided with an editable terminal target, one-time host tokens lingered in mutation state, and enrollment config hard-coded a TLS WebSocket scheme.
  Rule: Exempt Ctrl-based global shortcuts inside editable targets, reset mutation state when secret-bearing UI closes, and derive dependent connection schemes from the configured transport with HTTP and HTTPS coverage.
  Correction: Wave 4 review also found that a late fleet reconcile could overwrite fresher WebSocket state, canonical session entries were not bounded by current aggregate/roster membership, and new prompt/Respond paths bypassed terminal read-only permissions.
  Rule: Merge asynchronous snapshots monotonically by authoritative freshness, prune canonical maps during reconciliation, and propagate terminal control state to every PTY-input-equivalent affordance while keeping non-PTY governance actions independently available.

- Date: 2026-07-22
  Correction: The Claude pane UI updated its selected pane and accepted input before tmux had confirmed the pane and zoom state, which made pane switching unreliable across delays, failures, and reconnects.
  Rule: Treat pane selection and focus as a verified transaction: keep input fenced and UI state provisional until tmux acknowledges the target state, reconcile actual viewer state after timeouts or reconnects, roll back partial failures, and test delayed, rejected, and resumed paths.

- Date: 2026-07-22
  Correction: The initial Android acceptance proposal imposed enterprise-style repetition and soak gates on a single-user personal app whose immediate goal is basic Termius-level functionality.
  Rule: For single-user internal utilities, define completion around the smallest real daily-use workflow that works on the owner's device; treat stress testing, polish, and broader product hardening as iterative follow-up unless the risk or user explicitly requires them.
