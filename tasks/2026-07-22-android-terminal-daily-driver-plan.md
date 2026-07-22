# Android Terminal Daily Driver — Project Plan

## Approval

- Human Owner: Chris Sloane
- Status: draft
- Approved at: pending explicit approval
- Approved scope/version: v1 — shared terminal repair plus Android connect-and-control MVP

No autonomous execution begins while status is `draft`.

## Outcome

Agent Command has a meaningful terminal on the existing live web app and a signed Android APK that Chris can use on his Samsung phone to connect to and control existing tmux sessions across Agent Command hosts without requiring Tailnet on the phone. The Android terminal provides basic Termius-level rendering, input, scrollback, copy/paste, text zoom, tmux pane focus, and ordinary background/resume behavior while preserving the existing multi-host/window/pane model.

## Completion Definition

- The production web app can attach to an existing tmux pane at a usable grid size, render and accept input, scroll, and switch panes/windows without routing input to the wrong pane.
- A signed APK installs on Chris's Samsung device, authenticates without embedding credentials, loads the existing Agent Command host/session topology, and controls an existing SloaneVault tmux/Claude pane over the public Agent Command HTTPS/WSS path.
- The Android app satisfies every mandatory item in `tasks/2026-07-22-android-terminal-daily-driver-acceptance-checklist.md` on the real deployed path.
- Chris confirms the APK is basically useful for daily terminal work; later polish remains iterative backlog work.

## Non-Goals

- Rebuilding native launch-new-session functionality; the existing web launch flow remains authoritative.
- Full dashboard parity, native notifications, Play Store publication, tablet/desktop Android optimization, or multi-user product hardening.
- A second direct-SSH terminal implementation. Termius/direct SSH is a diagnostic comparator and may become a fallback only after a named wall report and plan revision.
- Protocol v2, replay infrastructure, output sequencing, FCM, foreground services, or generalized plugin architecture unless a reproduced acceptance failure proves one is required.
- Stress matrices, 100-cycle tests, soak tests, new test harnesses, or speculative abstractions that do not directly prove an acceptance item.

## Roles and Models

| Role | Assignment | Primary model/system | Approved fallback | Machine/worktree | Ownership |
|---|---|---|---|---|---|
| Human Owner | Chris Sloane | Human judgment | No substitute | Samsung device and production UX | Scope changes and final subjective usefulness only |
| AI Lead | Codex Sol lead | `gpt-5.6-sol`, xhigh | Same model on homelinux, then HOLD | heavisidelinux integration checkout | Coordination, shared contract, integration, receipts, rollout |
| Builder | One active Codex Sol builder | `gpt-5.6-sol`, xhigh | Same model on homelinux, then HOLD | Isolated worktree per lane | One acceptance-bearing vertical slice at a time |
| Reviewer | Fresh Codex Sol reviewer | `gpt-5.6-sol`, xhigh | Fresh same-model context on alternate machine, then HOLD | Clean review worktree, never builder session | Independent checklist review of frozen changes |

Role assignments may change between stages, but no agent reviews its own deliverable. Only one Builder is active at a time; Reviewer work begins after a candidate is frozen.

## Machine Model Availability

| Machine | Runtime/provider | Exact model ID | Available | Quota remaining | Reset/expiry | Measured at | Evidence source | Tested launch command |
|---|---|---|---|---|---|---|---|---|
| heavisidelinux | OpenAI Codex CLI 0.144.6 | `gpt-5.6-sol` | yes | Ample, operator-reported | Subscription window; exact reset not exposed | 2026-07-22T12:00:06-04:00 | Chris operator report plus local CLI version check | Approval-time launch probe pending; command recorded below |
| homelinux | OpenAI Codex CLI 0.106.0 | `gpt-5.6-sol` | yes | Ample, operator-reported shared subscription | Subscription window; exact reset not exposed | 2026-07-22T12:00:06-04:00 | Chris operator report plus remote CLI version check | Approval-time launch probe pending; command recorded below |

Approved launch form:

```bash
codex -m gpt-5.6-sol -c model_reasoning_effort="xhigh" -a never -s danger-full-access -C <lane-worktree> "<lane brief>"
```

The exact worktree and brief are substituted per lane. Before launch, replace each pending probe entry with the tested command and receipt, refresh the timestamp/quota evidence, and rerun the plan validator.

## Role Routing And Failover

| Role/lane | Primary machine | Runtime/provider | Exact model ID | Reasoning effort | Minimum reserve | Fallback 1 | Fallback 2 | Handoff trigger | Independence constraint |
|---|---|---|---|---|---|---|---|---|---|
| AI Lead | heavisidelinux | OpenAI Codex CLI 0.144.6 | `gpt-5.6-sol` | xhigh | HOLD at UI-reported 15% remaining | homelinux / `gpt-5.6-sol` / xhigh | HOLD and escalate | Rate-limit twice, model unavailable, or context handoff needed | Does not independently accept its own substantive code |
| Builder default | heavisidelinux | OpenAI Codex CLI 0.144.6 | `gpt-5.6-sol` | xhigh | HOLD at UI-reported 15% remaining | homelinux / `gpt-5.6-sol` / xhigh | HOLD and escalate | Rate-limit twice, no progress for 60 minutes, or repeated-failure ceiling | Fresh lane context and isolated worktree |
| Reviewer - standard | heavisidelinux | OpenAI Codex CLI 0.144.6 | `gpt-5.6-sol` | xhigh | HOLD at UI-reported 15% remaining | homelinux / `gpt-5.6-sol` / xhigh | HOLD and escalate | Model unavailable or candidate authored in the same context | Independent fresh context; not the builder or author |
| Reviewer - critical | homelinux | OpenAI Codex CLI 0.106.0 | `gpt-5.6-sol` | xhigh | HOLD at UI-reported 15% remaining | heavisidelinux / `gpt-5.6-sol` / xhigh fresh context | HOLD and escalate | Auth/credential candidate cannot receive a fresh-context review | Independent fresh context and clean worktree; receives checklist and frozen evidence, not builder conversation |

Fable is unavailable because its quota is exhausted. Same-model review is accepted for this internal project, with context/worktree independence and mechanical proof compensating for the lack of provider diversity.

## Workstreams and Ownership

| Workstream | Builder | Deliverable | Owned paths/systems | Ground truth | Dependencies |
|---|---|---|---|---|---|
| W1 — Shared terminal repair | One Codex Sol builder | Production web terminal with usable viewport, rendering, input, scroll, and acknowledged pane/window switching | Existing dashboard terminal/tmux components, shared terminal schema, control-plane terminal route, agentd terminal/viewer code, directly related existing tests | Reproduced live attach; production logs; existing unit/Go/Playwright path; Chris's laptop path | Approved plan and clean baseline `d3416a9` |
| W2 — Android vertical slice | One Codex Sol builder after W1 | GPL Android module with authentication, roster, one native terminal renderer, and existing-session connect/control workflow | `apps/android/**`; minimal shared protocol fixtures; only W1-approved server/auth seams | APK build; emulator/compiler checks; real public control-plane connection; Samsung device | Frozen W1 terminal contract and reviewer pass |
| W3 — Integration and daily-use rollout | AI Lead plus fresh reviewer | Merged/deployed web repair, agentd rollout if required, Bitwarden-backed credentials, signed APK, receipts, and final acceptance result | Integration worktree, Coolify production app, installed agentd binary, Bitwarden Agent Command project, Android signing artifacts outside Git | Production version identity, service health/logs, clean Git state, APK signature/install, real web and phone workflows | W1 and W2 accepted |

The topology is paired and sequential. Maximum useful parallelism is the AI Lead plus one Builder; review replaces the Builder rather than adding another simultaneous implementation lane.

## Anti-Overengineering Controls

### Kill

- Native session launch, notifications, dashboard parity, Play Store work, direct SSH transport, protocol v2, generalized renderer interfaces beyond the one required adapter, load/soak suites, and speculative resilience layers.
- Any new abstraction, service, endpoint, fixture family, or test matrix that cannot cite a failing acceptance item.
- Parallel renderer or transport implementations. Termux-derived native rendering is the chosen path; change it only through a wall report.

### Keep

- Existing Agent Command authentication, roster, shared schema, public HTTPS/WSS transport, control-plane/agentd broker, tmux grouped-viewer semantics, launch flow, and current test suites.
- One native terminal engine, one authenticated connection path, one pane transaction state machine, and one real-device proof.

### Improve

- Fix the smallest reproduced web/viewer defect before touching adjacent UX.
- Reuse existing protocol fixtures in Android rather than inventing a second contract.
- Add only the regression test that would have caught the escaped defect, run affected existing suites, then exercise the real path.

Each lane brief must list its acceptance item, deletion/non-goal list, maximum intended file surface, expected test delta, and stop token. If the Builder proposes adjacent improvements, it records them as deferred rather than implementing them.

## Autonomy Lanes

| Action class | Lane | Preconditions | Receipt/evidence | Human checkpoint |
|---|---|---|---|---|
| Code changes | autonomous-with-receipt | Approved lane brief and ownership boundary | Frozen commit, diff, test receipt | None |
| Push/merge/release | autonomous-with-receipt | Independent review pass and integrated gates | Remote SHA, PR/merge/release identity | None |
| Staging deploy | forbidden | Agent Command deploys directly to production | Not applicable | None |
| Production deploy | autonomous-with-receipt | Accepted candidate, rollback ref, production verification plan | Coolify deployment/container commit and health receipt | None |
| Database mutation | autonomous-with-receipt | Migration is necessary for an acceptance item, reviewed, backed up/reversible | Migration SHA, command, schema/version proof | None |
| External/provider action | autonomous-with-receipt | Limited to Coolify, GitHub, Bitwarden, Android tooling, and existing project providers | Provider action ID or deterministic state receipt | None |
| Spending | forbidden | No new paid service is needed for this MVP | Not applicable | Revise plan if a paid dependency becomes necessary |
| Delete/retire/cut over | autonomous-with-receipt | In-scope, target resolved, recovery path verified | Exact target and recovery receipt | None |
| Credential/access change | autonomous-with-receipt | Secret stored in dedicated Bitwarden project; no raw value in Git/chat | Bitwarden project/key names and deployment reference only | None |

## Acceptance and Review

- Acceptance Checklist: `tasks/2026-07-22-android-terminal-daily-driver-acceptance-checklist.md`
- Frozen deliverable format: exact commit SHA plus concise builder handoff and command receipts.
- Mechanical checks: one regression seam for each escaped bug, affected existing TypeScript/Go suites, Android compile/lint/unit checks, and the existing real browser journey where applicable.
- Independent Reviewer: fresh `gpt-5.6-sol`/xhigh context in a clean worktree; it is not the Builder and receives only this plan, the checklist, the frozen diff, declared assumptions, and proof receipts.
- Human-reserved checks: Chris's final subjective confirmation that terminal behavior is basically useful; device pairing actions if physical access is required.
- Non-waivable checks: no raw credentials in Git/logs/chat; no pane-selection UI that accepts input before authoritative focus; production web terminal meaningful on a laptop; APK uses the public Agent Command path without requiring Tailnet; existing web launch flow still works.

Testing ratchet per change:

1. Classify the changed risk lane.
2. Add at most the narrow regression proof at the real seam.
3. Run affected existing suites.
4. Run one real-path verification.
5. Stop. Broader matrices require an acceptance-linked reason recorded in status.

## Budgets and Stop Conditions

| Scope | Wall-clock ceiling | Token/cost ceiling | No-progress ceiling | Repeated-failure ceiling |
|---|---:|---:|---:|---:|
| Overall project | 7 calendar days | Existing subscriptions only; no incremental paid API/service spend | 1 business day without an accepted slice | 3 |
| AI Lead | 7 calendar days | Preserve 15% reported model quota | 90 minutes without new evidence, integration, or routing | 3 |
| W1 — Shared terminal repair | 1 working day | Existing subscription quota | 60 minutes | 3 |
| W2 — Android vertical slice | 3 working days | Existing subscription quota | 60 minutes | 3 |
| W3 — Integration and rollout | 2 working days | Existing infrastructure and subscriptions | 60 minutes | 3 |

- Progress means: a reproduced symptom, falsified hypothesis, smaller failing case, accepted frozen commit, reviewer verdict, successful integrated gate, or real-path receipt.
- Repeated-failure ceiling: three attempts reproducing the same failure without new evidence or a materially changed strategy.
- On a lane stop: write `HELD`, freeze the last-known-good ref, and produce the escalation report instead of adding a fallback, retry layer, second implementation, or new harness.
- On a global stop: leave production on the last verified commit and keep credentials/recovery artifacts intact.
- Other lanes may continue only when they do not depend on the failed shared terminal contract or touch the same files/system.

## Human Checkpoints

| Trigger | Required decision | Urgency | Safe state while waiting |
|---|---|---|---|
| Project Plan presented | Explicit approve or revise | Before launch | No Builders or production mutation |
| Physical Samsung pairing/install cannot be completed remotely | Chris performs the minimum device action | When W2 reaches device proof | Signed APK and instructions held locally |
| Final basic-use check | Chris states whether it is basically useful | At completion | Accepted technical candidate remains installed; enhancements stay deferred |
| Scope would require paid service, direct SSH fallback, or replacing the selected renderer | Revise this Project Plan | Before expansion | Current accepted web/app path remains unchanged |

Factual defects and ordinary product decisions inside this approved scope are autonomous. No intermediate green milestone requires owner approval.

## State and Control Files

- Current status: `tasks/2026-07-22-android-terminal-daily-driver-status.md`
- Append-only log: `tasks/2026-07-22-android-terminal-daily-driver-log.md`
- Metrics: `tasks/2026-07-22-android-terminal-daily-driver-metrics.jsonl`
- Handoffs: `tasks/2026-07-22-android-terminal-daily-driver-handoffs/`
- Final Report: `tasks/2026-07-22-android-terminal-daily-driver-final-report.md`
- Escalation Report: `tasks/2026-07-22-android-terminal-daily-driver-escalation-report.md`

The status file is current operational truth. The log and metrics ledger are append-only history. SloaneVault receives only durable decisions and final links, not duplicated live status.

## Recovery

- Last-known-good production baseline: `origin/main` at `7b30df046208f1a2ba14b8e34b0095afe9888750`; deployed dashboard/control-plane containers identify that commit.
- Current reviewed local candidate baseline: `d3416a9d1934ddf49b5e97fd0e61c707a1c466d5` on `refactor/frontend-command-center`.
- Before rollout, record the current Coolify container/image identity and copy the installed agentd binary to an explicit timestamped backup outside the repository if agentd changes.
- Rollback: redeploy the recorded production image/commit, restore the recorded agentd binary and service state, revoke any newly issued device credential, and verify web launch plus terminal health.
- Evidence needed before recovery: exact failing acceptance item, deployed version identity, relevant logs, current database migration version, and credential key names without values.

## Launch Checklist

- [ ] Human Owner approved this Project Plan.
- [ ] Acceptance Checklist exists and is approved.
- [ ] Role/model assignments and approved fallbacks are recorded.
- [ ] Workstream ownership and collision boundaries are explicit.
- [ ] Autonomy lanes cover every consequential action class.
- [ ] Ground truth and Reviewer independence are defined.
- [ ] Budgets and progress-sensitive stop conditions are set.
- [ ] Status, log, handoff, and metrics paths exist.
- [ ] Recovery path is credible.

