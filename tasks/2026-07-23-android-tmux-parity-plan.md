# Android Tmux Parity — Project Plan

## Approval

- Human Owner: Chris Sloane
- Status: approved
- Approved at: 2026-07-23T00:19:00-04:00
- Drafted at: 2026-07-23T00:08:51-04:00
- Approved scope/version: v1 native Android capability parity for the existing-session tmux workbench

Read-only source and contract discovery completed before approval. Autonomous execution begins under the lanes and receipts below.

## Outcome

The signed Agent Command APK is a dependable native Android tmux workbench for Chris's daily use. It reaches the existing multi-host Agent Command service over public HTTPS/WSS, makes every existing tmux host/session/window/pane easy to find and control, and provides the practical terminal, history, keyboard, navigation, pane/window management, Claude reading, and recovery capabilities currently available in the web tmux workbench.

Parity means the same useful capability expressed appropriately for a phone, not a pixel copy of desktop UI.

## Completion Definition

- Every mandatory item in `tasks/2026-07-23-android-tmux-parity-acceptance-checklist.md` has source-backed mechanical evidence and a fresh independent review verdict.
- The APK separates authoritative pane state from controller ownership, so a delayed/lost focus acknowledgement, a read-only attachment, or a resume cannot leave a rendered terminal silently inert.
- The APK provides grouped multi-host topology, transactional same-session pane/window switching, cross-session attachment, local and remote scrolling, paged history/search/copy, a useful terminal key rail, text and tmux zoom, and reliable reconnect/resume.
- Existing tmux window/pane lifecycle operations are available natively with acknowledged completion and clear failure handling.
- Claude panes have a clean transcript/history reading surface and direct prompt entry without reimplementing the general launch workflow.
- A versioned, signed APK is available from the authenticated production web/PWA, retains the established signing identity, and passes artifact and live public-path verification.
- Chris performs one final physical Samsung acceptance after all planned functionality is complete and confirms the APK is ready for daily use.

## Non-Goals

- Rebuilding the general Claude/Codex session launcher. Android links to the existing authenticated web launch flow; this preserves the prior product decision.
- Native parity for non-tmux dashboard areas: analytics, orchestrator/fleet views, MCP management, session graphs, automation, or general event consoles.
- Literal copies of desktop-only presentation: two-up terminals, desktop letterboxing, DOM persistence, or laptop maximization controls.
- Notifications or the deprecated waiting-for-input popup.
- Direct SSH/Tailscale transport, a second terminal renderer, a Compose rewrite, foreground service, protocol v2, restart synthesized as kill-plus-launch, or Play Store publication.
- Enterprise hardening, broad device matrices, new smoke harnesses, load/soak testing, speculative retry layers, or abstractions that do not close a checklist item.

## Roles and Models

| Role | Assignment | Primary model/system | Approved fallback | Machine/worktree | Ownership |
|---|---|---|---|---|---|
| Human Owner | Chris Sloane | Human judgment | No substitute | Samsung device and production UX | This plan's approval, true scope changes, and one final subjective daily-use verdict |
| AI Lead | Primary Codex orchestrator in this project thread | `gpt-5.6-sol`, xhigh | Same model on homelinux, then HOLD | heavisidelinux integration checkout | Plan, routing, shared contracts, integration, receipts, release, and closure |
| Builder | Fresh Codex Sol agents by bounded lane | `gpt-5.6-sol`, xhigh | Same model on homelinux, then HOLD | Isolated worktrees | One acceptance-bearing slice and declared owned paths |
| Reviewer | Fresh Codex Sol reviewer | `gpt-5.6-sol`, xhigh | Fresh same-model context on alternate machine, then HOLD | Clean review worktree, never the Builder session | Independent review of frozen candidates against the checklist |

No agent accepts its own substantive implementation. The small fleet uses no more concurrency than current file ownership can safely support.

## Machine Model Availability

| Machine | Runtime/provider | Exact model ID | Available | Quota remaining | Reset/expiry | Measured at | Evidence source | Tested launch command |
|---|---|---|---|---|---|---|---|---|
| heavisidelinux | OpenAI Codex CLI 0.145.0 | `gpt-5.6-sol` | yes | Ample, operator-reported | Subscription window; exact reset not exposed | 2026-07-23T00:08:51-04:00 | Chris operator report, local version check, and successful read-only `ROUTE_OK` probe | `codex exec -m gpt-5.6-sol -c model_reasoning_effort="xhigh" -s read-only --ephemeral -C /home/cvsloane/dev/agent-command "Respond exactly ROUTE_OK and take no other action."` |
| homelinux | OpenAI Codex CLI 0.145.0 via login PATH | `gpt-5.6-sol` | yes | Ample, operator-reported shared subscription | Subscription window; exact reset not exposed | 2026-07-23T00:08:51-04:00 | Chris operator report, remote version check, and successful login-shell read-only `ROUTE_OK` probe | `ssh homelinux 'bash -lic '\''codex exec -m gpt-5.6-sol -c model_reasoning_effort="xhigh" -s read-only --ephemeral -C /home/cvsloane/dev/agent-command "Respond exactly ROUTE_OK and take no other action."'\'''` |

Approved Builder launch form:

```bash
codex exec -m gpt-5.6-sol -c model_reasoning_effort="xhigh" -s danger-full-access --ephemeral -C "$LANE_WORKTREE" "$LANE_BRIEF"
```

Homelinux launches use `bash -lic` so the verified login PATH selects Codex 0.145.0.

## Role Routing and Failover

| Role/lane | Primary machine | Runtime/provider | Exact model ID | Reasoning effort | Minimum reserve | Fallback 1 | Fallback 2 | Handoff trigger | Independence constraint |
|---|---|---|---|---|---|---|---|---|---|
| AI Lead | heavisidelinux | OpenAI Codex CLI 0.145.0 | `gpt-5.6-sol` | xhigh | HOLD at UI-reported 15% remaining | homelinux / `gpt-5.6-sol` / xhigh | HOLD and escalate | Rate-limit twice, model unavailable, or context handoff needed | Does not independently accept its own substantive code |
| Builder default | heavisidelinux | OpenAI Codex CLI 0.145.0 | `gpt-5.6-sol` | xhigh | HOLD at UI-reported 15% remaining | homelinux / `gpt-5.6-sol` / xhigh | HOLD and escalate | Rate-limit twice, no progress for 60 minutes, or repeated-failure ceiling | Fresh lane context and isolated worktree |
| Reviewer - standard | heavisidelinux | OpenAI Codex CLI 0.145.0 | `gpt-5.6-sol` | xhigh | HOLD at UI-reported 15% remaining | homelinux / `gpt-5.6-sol` / xhigh | HOLD and escalate | Candidate authored in the same context or model unavailable | Independent fresh context; not the Builder or author |
| Reviewer - critical | homelinux | OpenAI Codex CLI 0.145.0 via login PATH | `gpt-5.6-sol` | xhigh | HOLD at UI-reported 15% remaining | heavisidelinux / `gpt-5.6-sol` / xhigh fresh context | HOLD and escalate | Auth, signing, command mutation, or final release lacks fresh review | Clean worktree and context; receives frozen evidence, not Builder conversation |

Fable is unavailable because its quota is exhausted. Same-model review is accepted for this internal personal app; fresh context, isolated worktrees, real protocol receipts, and independent artifact checks provide the separation.

## Workstreams and Ownership

| Workstream | Builder | Deliverable | Owned paths/systems | Ground truth | Dependencies |
|---|---|---|---|---|---|
| W0 — Baseline and contract freeze | AI Lead plus read-only scouts | Capability matrix, current physical-scroll result, contract map, and bounded lane briefs | Project control files only | `origin/main` `da60702`, production v0.1.2, source/API inventory, Chris's confirmed Samsung scroll | Approved plan before any Builder launch |
| W1 — Interaction authority and scroll model | One Android Builder | Explicit viewer/control state, correlated focus timeout plus `viewer_state` reconciliation, local normal-buffer history, remote app-scroll routing, visible Take Control, and resume reconciliation | Existing Android terminal state/socket/view files and focused tests only | Existing web navigation implementation and agentd protocol behavior | Approved W0 contract; no shared contract change |
| W2 — Topology, API, and command domain | One parallel Android Builder | Grouped roster model, search/filter data, scrollback/transcript clients, UI-stream command-result correlation, persisted preferences, and pure domain tests | New or existing Android data/domain files; no `MainActivity.kt` or terminal renderer changes | Existing global roster, scrollback, transcript, UI-stream, and command APIs | Approved W0 contract; can run parallel with W1 |
| W3 — Native tmux workbench UI | One Android Builder after W1/W2 integration | Phone-native host/session/window/pane navigator, fixed/expanded key rail, history/search/copy, Claude transcript/prompt surface, status/error UI, and persisted last target/font/rail settings | Android activity/composable UI files; consumes accepted W1/W2 interfaces | Accepted W1/W2 candidates and checklist UI outcomes | W1 and W2 accepted and integrated |
| W4 — Window and pane lifecycle | One Android Builder | Acknowledged select/new/rename/close window; split/focus/directional-select/unfocus/kill pane; confirmation and rollback behavior; open existing target and web-launch handoff | Android tmux action UI/domain plus directly required shared additive contract only if proven | Existing command API, `/v1/ui/stream` result events, topology truth | W2 command correlation and W3 navigation shell |
| W5 — Integration and production release | AI Lead plus fresh critical Reviewer | Integrated candidate, narrow regression gates, signed versioned APK, authenticated PWA distribution, production receipt, clean workspace, and final report | Integration branch, GitHub, Coolify, Bitwarden-backed signing, production artifact | Frozen commits, independent reviews, real public endpoint, Android artifact tools | W1-W4 accepted |

W1 and W2 are the only planned parallel Builder wave because their paths can remain disjoint. W3 and W4 are serialized around the Android UI seam. Shared schema/backend changes stay AI Lead-owned and are allowed only when an existing contract cannot satisfy a checklist item.

### Capability Scope

Included native outcomes:

- Safe authentication and public HTTPS/WSS use without phone Tailnet.
- Grouped live host → tmux session → window → pane navigation, search, useful status, snapshots/previews where available, last-target restore, and unmanaged-target open.
- Attach, render, resize, Samsung/physical keyboard input, paste, explicit detach/reattach, read-only state, and always-visible Take Control.
- Transactional pane/window switching, input fencing until authoritative state converges, same-session connection reuse, and cross-host/session reattachment.
- Local normal-buffer scrollback, remote tmux/application scrolling, paged older history, search, exact selection/copy, live-terminal copy, and return-to-live behavior.
- Fixed and expanded practical key rails: Esc, Ctrl, Tab, Shift-Tab, arrows, Page Up/Down, Home/End, Enter, keyboard toggle, paste, and configured tmux prefix.
- Independent text zoom and verified tmux pane zoom/focus.
- Window create/rename/select/close and pane horizontal/vertical split, directional selection, focus/unfocus, and kill/archive behavior with acknowledged outcomes.
- Reconnect/resume, connection/control/lag/switch status, precise errors, and persisted font/rail/last-target preferences.
- Clean Claude transcript/history reading and direct prompt sending for the selected pane.
- Browser handoff to the existing general launch workflow.

Excluded presentation details are listed in Non-Goals.

## Anti-Overengineering Controls

### Kill

- A second transport or renderer, direct SSH fallback, native launch form, Compose rewrite, notification system, generalized plugin system, protocol rewrite, or restart-by-composition.
- New backend endpoints while the existing roster, terminal, scrollback, transcript, UI-stream, and command contracts can satisfy the item.
- New smoke harnesses, broad device matrices, soaks, speculative fallback/retry layers, or abstractions created because a direct fix hit a wall.
- Custom macro-editor parity in the APK; useful fixed/expanded keys and the existing per-host tmux prefix satisfy phone terminal control.

### Keep

- The Termux-derived emulator/renderer, established signing identity, Android Keystore credential storage, public HTTPS/WSS transport, grouped-viewer semantics, existing REST/WS contracts, and authenticated PWA distribution.
- The web launch workflow and deprecated-attention-popup decision.

### Improve

- Port proven web state-machine behavior instead of inventing Android-specific semantics.
- Split monolithic UI only where a new feature needs an owned component or pure domain seam.
- Add only the focused regression that catches the changed behavior, run affected existing gates once per frozen candidate, and exercise the real public path at release.

Every Builder brief names checklist items, owned paths, a deletion/non-goal list, expected test delta, stop token, and frozen handoff format.

## Autonomy Lanes

| Action class | Lane | Preconditions | Receipt/evidence | Human checkpoint |
|---|---|---|---|---|
| Code changes | autonomous-with-receipt | Approved plan, bounded brief, and isolated ownership | Frozen commit, diff, test receipt | None |
| Push/merge/release | autonomous-with-receipt | Independent review pass and integrated gates | Remote SHA, PR/merge/release identity | None |
| Staging deploy | forbidden | Agent Command has no staging requirement for this personal app | Last accepted local candidate remains safe | None |
| Production deploy | autonomous-with-receipt | Accepted release candidate and rollback ref | Coolify deployment/container commit, health, endpoint, and artifact receipt | None |
| Database mutation | autonomous-with-receipt | Proven checklist dependency, reviewed reversible migration | Migration SHA, backup/version proof | None |
| External/provider action | autonomous-with-receipt | Limited to existing GitHub, Coolify, Bitwarden, Android, and Agent Command providers | Provider action ID or deterministic state receipt | None |
| Spending | forbidden | Existing subscriptions/infrastructure must suffice | No incremental charge | Plan revision before new spend |
| Delete/retire/cut over | autonomous-with-receipt | Exact in-scope target and verified recovery path | Exact target plus recovery receipt | None |
| Credential/access change | autonomous-with-receipt | Secret stored in Bitwarden and never exposed in Git/chat/logs | Bitwarden project/key names and deployment reference only | None |

## Acceptance and Review

- Acceptance Checklist: `tasks/2026-07-23-android-tmux-parity-acceptance-checklist.md`
- Frozen deliverable: exact commit SHA, short handoff, checklist mapping, changed paths, and command receipts.
- Independent Reviewer: each W1-W4 candidate receives a fresh-context Reviewer who is not its Builder before integration. W5 receives a critical release review from the alternate machine.
- Mechanical proof uses existing Android unit/lint/release tasks, directly affected schema/control-plane/agentd tests when those areas change, signed-APK inspection, and authenticated production endpoint checks.
- New tests are limited to acceptance-linked pure/state/contract seams. No instrumentation harness is added merely to avoid the physical-device boundary.
- The only owner test after launch is the final Samsung path: install/update, sign in, navigate across hosts/sessions/windows/panes, type, use keys, scroll/history/search/copy, zoom, mutate one disposable window/pane, background/resume, and confirm daily-use readiness.
- Non-waivable: no embedded/raw secrets; no input before authoritative pane convergence; read-only history remains usable; destructive pane/window actions require confirmation; command acceptance is not treated as command completion; one renderer/transport; web launch remains usable.

Testing ratchet:

1. Name the exact acceptance item and risk lane.
2. Add the smallest regression at the existing real seam.
3. Run affected existing suites once on the frozen candidate.
4. Run the integrated Android gate and real public-path checks at release.
5. Stop; broader testing requires an acceptance-linked reason in status.

## Budgets and Stop Conditions

| Scope | Wall-clock ceiling | Token/cost ceiling | No-progress ceiling | Repeated-failure ceiling |
|---|---:|---:|---:|---:|
| Overall project | 7 calendar days | Existing subscriptions only; no incremental paid service | 1 business day without an accepted slice | 3 |
| AI Lead | 7 calendar days | Preserve 15% UI-reported model quota | 90 minutes without new evidence, integration, or routing | 3 |
| W1 — interaction | 1 working day | Existing subscription quota | 60 minutes | 3 |
| W2 — domain/contracts | 1 working day | Existing subscription quota | 60 minutes | 3 |
| W3 — workbench UI | 2 working days | Existing subscription quota | 60 minutes | 3 |
| W4 — lifecycle actions | 1 working day | Existing subscription quota | 60 minutes | 3 |
| W5 — release | 1 working day | Existing infrastructure/subscriptions | 60 minutes | 3 |

Progress means: a reproduced symptom, falsified hypothesis, accepted frozen commit, reviewer verdict, integrated gate, or real-path receipt.

Repeated-failure ceiling: three attempts at the same failure without new evidence or a materially changed direct strategy.

At a lane stop, mark it `HELD`, freeze the last-known-good ref, and write the escalation report. Do not add a fallback path, defensive abstraction, new harness, or second implementation because a direct fix failed. Independent non-colliding lanes may continue.

## Human Checkpoints

| Trigger | Required decision | Urgency | Safe state while waiting |
|---|---|---|---|
| This Project Plan is presented | Explicit approve or revise | Before Builder launch | Production remains on v0.1.2 / `da60702`; no code mutation |
| A true scope expansion requires paid service, direct SSH, renderer replacement, or native general launch | Revise this plan | Before expansion | Last accepted candidate remains held |
| Physical Android action cannot be performed remotely | Chris performs the minimum device action | Final acceptance only | Signed reviewed APK remains available |
| Final daily-use check | Chris states whether the complete APK is ready | At completion | Technically accepted production candidate remains deployed |

Ordinary implementation choices, factual bug corrections, pushes, merges, signing, credential updates, and production rollout inside the approved scope are autonomous and require receipts, not intermediate approval.

## State and Control Files

- Current status: `tasks/2026-07-23-android-tmux-parity-status.md`
- Append-only log: `tasks/2026-07-23-android-tmux-parity-log.md`
- Metrics: `tasks/2026-07-23-android-tmux-parity-metrics.jsonl`
- Handoffs: `tasks/2026-07-23-android-tmux-parity-handoffs/`
- Final Report: `tasks/2026-07-23-android-tmux-parity-final-report.md`
- Escalation Report: `tasks/2026-07-23-android-tmux-parity-escalation-report.md`

The status file is current operational truth. The log and metrics are append-only. Handoffs freeze per-lane evidence. SloaneVault receives durable decisions and the final project link, not duplicated live status.

## Recovery

- Last-known-good source and production baseline: `da607024218325a264951d9f9a7f5a5ba5891e24`.
- Last-known-good APK: v0.1.2/code3, SHA-256 `9d78cd03457a4d26749530859fe495f1241472a2288523673a456238146b045c`, signer fingerprint `bedae11defc83f614284fd026d41699da87c519d73aece7c554ed74413f6ad1f`.
- Before final rollout, record current Coolify deployment/container identities and retain the prior signed APK.
- Rollback deploys the recorded source/image and republishes the prior APK without changing its signer. If agentd changes, retain and record an explicit prior binary before rollout.
- Credential changes use the Bitwarden `Agent Command` project; rollback references key names only and revokes superseded material when appropriate.
- Recovery evidence includes the failed checklist item, frozen source/artifact identities, exact service logs, and current contract/database version.

## Launch Checklist

- [x] Human Owner approved this Project Plan.
- [x] Acceptance Checklist exists and is approved.
- [x] Role/model assignments and fallbacks are explicit.
- [x] Both machine/model launch paths were tested within 12 hours.
- [x] Workstream ownership and collision boundaries are explicit.
- [x] Autonomy lanes cover every consequential action class.
- [x] Reviewer independence and ground truth are defined.
- [x] Budgets and progress-sensitive stops are set.
- [x] Status, log, handoff, and metrics paths exist.
- [x] Recovery path names the exact current source and APK.
