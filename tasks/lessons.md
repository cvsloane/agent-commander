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

- Date: 2026-07-22
  Correction: Termius over direct SSH worked well, but the live Agent Command terminal was also unusable on a laptop; an SSH-only mobile MVP would bypass the broken shared path and lose the existing multi-host/pane architecture.
  Rule: Treat the control-plane/agentd terminal path as a required shared product capability before placing another client on it. Preserve multi-host and pane orchestration, prefer a non-Tailnet client path, and use direct SSH as a diagnostic comparator or explicitly approved fallback rather than silently replacing the intended architecture.

- Date: 2026-07-22
  Correction: The owner granted this internal Agent Command project full execution authority, including pushes, merges, production rollouts, migrations, and credential changes, provided every live credential is stored in Bitwarden.
  Rule: Do not insert extra approval pauses for in-scope Agent Command implementation or rollout during this approved program. Record receipts for consequential actions, keep raw secrets out of the repo and responses, and store or reference live credentials through Bitwarden Secrets Manager.

- Date: 2026-07-22
  Correction: Fable quota was exhausted; `gpt-5.6-sol` at `xhigh` was the strongest available model with ample quota, but the owner warned that it tends to overengineer and overtest.
  Rule: Route this program entirely through `gpt-5.6-sol`/`xhigh` with fresh-context review independence, while actively constraining every brief to the smallest acceptance-bearing vertical slice. Require an explicit kill/non-goal list, forbid speculative parallel implementations and new harnesses, and cap testing at one regression seam, affected existing suites, and the real-path proof the change actually owes.

- Date: 2026-07-22
  Correction: The Android MVP only needs to connect to and control existing multi-host tmux sessions; launching new Claude/Codex sessions already exists in the web app and should not be rebuilt natively.
  Rule: Keep native MVP ownership to authentication, roster/navigation, terminal rendering/input, pane/window control, zoom, scrollback, copy/paste, and ordinary resume. Preserve the web launch flow and reject native launch, notifications, or dashboard parity as scope expansion until the daily-use terminal path works.

- Date: 2026-07-22
  Correction: A non-login SSH probe on homelinux resolved the stale `/usr/local/bin/codex` and falsely suggested `gpt-5.6-sol` was unavailable; the normal login environment used the current `~/.local/bin/codex` successfully.
  Rule: Before declaring a remote model or runtime unavailable, verify the login-shell PATH and all installed binaries. Dispatch homelinux Codex lanes through `bash -lic` or the verified absolute binary so stripped SSH environments cannot select stale tooling.

- Date: 2026-07-22
  Correction: The repaired production terminal connected and accepted input, but the laptop Command Center still allocated too little space to the actual tmux workbench for meaningful use or scrollback review.
  Rule: On desktop, treat the active tmux terminal as the primary work surface: cap and independently scroll navigation/roster regions, give the terminal the remaining viewport with a substantial minimum height, and verify its rendered pixel/grid dimensions at a common laptop viewport rather than accepting any merely nonzero terminal size.

- Date: 2026-07-22
  Correction: Scrollback text copied correctly but WebGL-rendered boundary artifacts made the visible terminal hard to read, while ordinary waiting-for-input state repeatedly interrupted work with a "Needs attention" overlay.
  Rule: Verify terminal text at both the buffer and renderer layers; prefer the reliable DOM renderer until the upstream WebGL fixes are adopted and proven. Keep passive waiting-for-input state in the roster/status surfaces, and reserve terminal overlays for explicit approvals or actionable failures.

- Date: 2026-07-22
  Correction: Moving from WebGL to DOM reduced scrollback corruption, but one visual character still appeared at the left edge where 160-column text wrapped because the xterm screen overflowed its measured box by 7 px.
  Rule: Keep padding and status decoration off xterm's measured parent: the fit addon measures the parent width but subtracts padding from the generated `.xterm` child. Assert that `.xterm-screen` never extends past `.xterm` in the shared-grid journey so clipped wrap boundaries cannot return.

- Date: 2026-07-22
  Correction: The remaining artifact was actually two characters and changed as scrollback moved; the separate 7 px containment defect was real, but a fixed boundary defect could not explain changing, unselectable glyphs.
  Rule: Do not equate a nearby deterministic layout defect with the remaining dynamic display defect. First identify the actual painted surface; changing display fragments with correct copied text narrows the fault to presentation, but does not by itself prove xterm renderer corruption.

- Date: 2026-07-22
  Correction: Backporting an upstream xterm DOM stale-row fix passed repeated `textContent` restoration checks, but the owner still saw the same changing two-character visual artifact in production.
  Rule: DOM text equality is not an acceptance signal for an unselectable visual defect. A regression loop for this class of bug must reproduce and inspect the actual painted surface on the real path (or remain explicitly unproven) before a fix is shipped.

- Date: 2026-07-22
  Correction: The live Focus control became clickable before the terminal viewer had attached, so a valid user click sent no tmux request and was mislabeled as an unconfirmed pane focus; successful focus also waited on topology polling, while channel-scoped acknowledgements unnecessarily entered the durable agent queue.
  Rule: Gate viewer controls on authoritative attachment state, preserve the real protocol rejection, adopt verified acknowledgement state immediately while topology catches up, and keep browser-channel lifecycle/navigation messages off the durable replay lane.

- Date: 2026-07-22
  Correction: Marking pane-focus acknowledgements non-durable removed their own disk write but still left them behind the durable sender mutex, so background queue fsync could delay or abandon an otherwise successful tmux focus transaction.
  Rule: Browser-channel request/response acknowledgements need an unsequenced live write path that can bypass durable persistence while the WebSocket write itself remains serialized. Prove this with the durable lane held, then measure the exact production acknowledgement rather than inferring success from tmux state alone.

- Date: 2026-07-22
  Correction: The AI Lead collapsed back into single-threaded implementation even though the approved program had an independent Android file lane and the user explicitly wanted orchestration.
  Rule: Keep the AI Lead on shared integration, production, and acceptance. Dispatch independent acceptance-bearing lanes—especially isolated native modules—in parallel, and serialize only genuine shared-file or shared-contract dependencies.

- Date: 2026-07-22
  Correction: The owner still saw terminal line artefacts after prior DOM and painted-surface checks, and the first new production screenshot opened a generic roster/default pane instead of the exact reported SloaneVault terminal.
  Rule: For a visual terminal defect, capture the exact production host/session/pane at current and scrolled positions and inspect the resulting pixels before accepting a fix. Generic or mocked terminal screenshots, copied text, and DOM equality do not substitute for the reported painted path.

- Date: 2026-07-22
  Correction: A corrected Android APK was published with the same `versionCode` and `versionName` as the bad installed build, so neither Samsung nor the operator could reliably prove that the replacement bytes were running; the old request behavior remained live.
  Rule: Every published replacement APK must strictly increase `versionCode`, use a distinct user-visible `versionName`, expose that version in the app, and verify the installed identity before counting a device retest.

- Date: 2026-07-22
  Correction: The native Android client could authenticate, attach, focus, and render a real tmux pane, but its swipe gesture only moved the Termux emulator's empty local alternate-screen transcript and never invoked the existing remote tmux scroll operation; Samsung input behavior was therefore not yet a proven daily-use path.
  Rule: Native-terminal acceptance must separately prove rendering, remote tmux scrollback, and committed Samsung keyboard input on the physical device. For existing tmux panes, bind swipe rows to the canonical `terminal.navigate` scroll protocol rather than treating a renderer-local transcript as server history.

- Date: 2026-07-23
  Correction: Physical Samsung scrolling passed after v0.1.2, but that single repaired gesture does not make the APK equivalent to Agent Command's existing tmux workbench.
  Rule: Treat Android completion as capability parity for the existing-session tmux workflow: authoritative multi-host navigation, separate viewer/control state, local and remote history, practical keys, pane/window lifecycle, Claude reading, and reconnect. Preserve general agent launch as a web-owned workflow and reserve one final owner device test until all planned native capability slices are complete.

- Date: 2026-07-23
  Correction: Awaiting each bulk termination serially with the router's 30-second default could outlive the dashboard's 15-second and Android's 30-second request deadlines, making correlated completion truth unobservable.
  Rule: Fit server-side acknowledgement waits inside the shortest supported client deadline. Dispatch independent bulk commands concurrently with an explicit bounded timeout, then reduce settled outcomes in request order and apply one final state mutation without retries.
