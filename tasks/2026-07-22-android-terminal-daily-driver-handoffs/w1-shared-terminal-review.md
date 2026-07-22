---
handoff_type: review
work_unit: "W1 — Shared terminal repair"
state: complete
reviewer: "OpenAI Codex gpt-5.6-sol/xhigh"
reviewed_deliverable_ref: "d83e2cb7f203bae7e5a67fd5450efdca574cc943"
acceptance_checklist_ref: "tasks/2026-07-22-android-terminal-daily-driver-acceptance-checklist.md"
ground_truth_refs:
  - "production baseline 7b30df046208f1a2ba14b8e34b0095afe9888750"
  - "candidate d83e2cb7f203bae7e5a67fd5450efdca574cc943"
  - "builder handoff c49423364214b3dcd82e1d65a4e7082338cefea6:tasks/2026-07-22-android-terminal-daily-driver-handoffs/w1-shared-terminal.md"
  - "frozen diff 7b30df046208f1a2ba14b8e34b0095afe9888750..d83e2cb7f203bae7e5a67fd5450efdca574cc943"
verdict: discrepancies
criteria:
  - id: "WEB-1"
    result: pass
    evidence_ref: "apps/dashboard/src/components/TerminalView.tsx:94-95,510-517; tests/journeys/command-center.journey.spec.ts:59-88; Builder receipt: desktop journey 14 passed, 5 skipped"
    finding: "The mobile viewport rule is breakpoint-gated, and the delayed-topology desktop journey locks a minimum of 11 negotiated rows; the Builder observed 13 on the candidate."
  - id: "WEB-2"
    result: pass
    evidence_ref: "apps/dashboard/src/hooks/useTerminalConnection.ts:241-258,542-550; tests/journeys/command-center.journey.spec.ts:476-496; Builder desktop-journey receipt"
    finding: "The existing output and authorized input path remains present, and the journey receipt covers connected keyboard input."
  - id: "WEB-3"
    result: pass
    evidence_ref: "apps/dashboard/src/components/TerminalView.tsx:122-157,381-410; tests/journeys/command-center.journey.spec.ts:444-473; Builder desktop-journey receipt"
    finding: "Live xterm output remains active while history is a separate overlay/pager, and the existing journey proves deterministic older-page loading."
  - id: "WEB-4"
    result: fail
    evidence_ref: "apps/dashboard/src/components/terminal/PersistentTerminalHost.tsx:108-115,180-191; apps/dashboard/src/components/terminal/terminalHostStore.ts:146-159,246-270; apps/dashboard/src/hooks/useTerminalConnection.ts:296-321,542-551"
    finding: "HIGH: after an acknowledged in-attachment switch, the selected descriptor can be pane B while the preserved attachment descriptor remains pane A. Resume reconciliation receives pane A, focuses tmux back to A when the resumed viewer is on B, and then re-enables input while the UI still identifies B. Failed or timed-out focus results can likewise carry a different authoritative pane, but the store ignores that state and unblocks input after recording only an error."
  - id: "WEB-5"
    result: pass
    evidence_ref: "tests/journeys/command-center.journey.spec.ts:499-520; Builder desktop-journey receipt"
    finding: "The existing launch rail still completes through the established launch request and selection path."
  - id: "SEC-1"
    result: pass
    evidence_ref: "Targeted review of added diff lines for credential/private-key/token assignments: no secret material found"
    finding: "No raw credential or signing material was introduced in the frozen candidate."
  - id: "SEC-2"
    result: pass
    evidence_ref: "services/control-plane/src/routes/terminal.ts:335-365,419-470"
    finding: "Attach remains operator-gated and every input, resize, navigation, and control frame remains guarded by terminal-control authorization."
  - id: "REG-1"
    result: pass
    evidence_ref: "Builder receipt: desktop journey 14 passed/5 skipped, focused dashboard terminal units 20 passed, dashboard typecheck passed; candidate includes focused schema, control-plane, and Go protocol tests"
    finding: "The recorded narrow gates pass; their reconnect coverage does not exercise the WEB-4 discrepancy above."
  - id: "REG-2"
    result: pass
    evidence_ref: "Frozen diff path review and package-manifest review"
    finding: "The candidate retains the existing xterm/shared WebSocket stack and adds no alternate renderer, transport, dependency, or Android implementation."
confidence: high
created_at: "2026-07-22T12:32:08-04:00"
---

# W1 Shared Terminal Reviewer Handoff

## Findings

### High — reconnect or failed focus can re-enable input on a pane different from the UI selection

The persistent host deliberately keeps the original `attachmentDescriptor` when an acknowledged same-tmux-session focus changes the selected `descriptor`. `PersistentTerminalHost` therefore continues to pass the original attachment pane into `useTerminalConnection` while separately presenting the newly selected session.

On a resumed connection, `useTerminalConnection` compares authoritative viewer state with that original pane and calls `focusPane(originalPane, ...)` when they differ. A normal sequence of attach A, acknowledged switch to B, disconnect, and successful resume on B consequently moves tmux back to A without moving the selected UI descriptor back from B. Reconciliation then clears its input fence.

The same unsafe terminal state is reachable after a partial focus failure or timeout: failure results preserve any authoritative `pane_id`, `window_index`, and `zoomed` values, but `focusWithinAttachment` records only an error and ignores those values. Input blocking checks only pending/reconciling state, so it ends once the error is stored even if tmux reports a pane different from the UI.

This violates WEB-4's non-waivable input-routing requirement and blocks integration.

## Smallest required correction

Reconcile resume and failed/uncertain focus against the current selected descriptor, not the original attachment descriptor. Keep terminal and prompt input fenced whenever the authoritative pane is unknown or differs from the selected pane; release the fence only after the UI selection and verified tmux pane/zoom state converge, either by restoring the selected pane or by adopting the authoritative pane in the UI.

## Review notes

- Legacy `select_window`, `select_pane`, `zoom`, and `scroll` protocol variants remain additive and accepted by schema, control plane, and agentd.
- Terminal font sizing remains a local xterm setting and does not emit pane-focus navigation.
- No test command was rerun: the Builder receipts were sufficient for WEB-1, WEB-2, WEB-3, and WEB-5, while the WEB-4 discrepancy is directly established by the frozen source paths above and is not covered by the existing resumed-viewer journey.
- No code, test, fixture, dependency, plan, or runtime state was modified during review.
