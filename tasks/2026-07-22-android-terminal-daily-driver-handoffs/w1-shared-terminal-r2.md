---
handoff_type: builder
work_unit: "W1-R2 — Authoritative pane convergence"
state: ready_for_review
builder: "OpenAI Codex gpt-5.6-sol/xhigh"
deliverable_ref: "795281803f583c895d6f5a8a5acfbec521662250"
proof_refs:
  - "RED focused store proof: expected pending input fence, received error/unfenced state on the reviewed behavior"
  - "RED desktop resume proof: selected pane %4, input routed to attachment pane %1 on the reviewed behavior"
  - "focused terminalHostStore unit: 1 file, 11 tests passed"
  - "desktop resumed-viewer journey grep: 1 passed"
  - "dashboard typecheck: passed"
assumptions:
  - "The existing pending navigation state remains the shared terminal and prompt input fence; a retained message records why convergence is still unresolved."
  - "Resume preserves the original attachment session and xterm host while viewer reconciliation targets the current selected descriptor."
uncertainties:
  - "The AI Lead still owns the broader integrated desktop journey and production acceptance gates above this brief's proof ceiling."
blocked_on: []
attempt: 2
completion_token: "W1-R2 READY 795281803f583c895d6f5a8a5acfbec521662250"
created_at: "2026-07-22T12:49:18-04:00"
---

# W1-R2 Shared Terminal Builder Handoff

## Root cause and direct fix

The persistent host intentionally keeps the original attachment descriptor so a same-tmux-session A→B focus does not replace the WebSocket or xterm instance. Resume reconciliation incorrectly treated that attachment pane A as the selected target, so a viewer already resumed on B was focused back to A while the UI continued to identify B.

Resume reconciliation now reads the current selected descriptor from the terminal host store while leaving the attachment descriptor and connection identity unchanged. The host's existing pending navigation state fences both the terminal surface and prompt composer until `viewer_state` or `focus_pane` verifies the selected pane and zoom state. Failed, timed-out, or mismatched focus results retain that fence unless their authoritative pane and zoom safely converge with either the requested target or the still-selected UI descriptor.

The strengthened desktop journey exercises attach A, acknowledged in-attachment focus to B, disconnect, resume with authoritative B, and real keyboard input. It proves the reconnect remains attached through session A, emits no restore to pane A, and records the input on pane B. The same journey observes both terminal and prompt input disabled during reconciliation.

## Verification

```text
pnpm --filter @agent-command/dashboard exec vitest run src/components/terminal/terminalHostStore.test.ts
# RED before store fix: 1 failed, 10 passed; expected navigation.status pending, received error
# GREEN: 1 file passed, 11 tests passed

CHOKIDAR_USEPOLLING=1 WATCHPACK_POLLING=true pnpm exec playwright test -c playwright.journeys.config.ts tests/journeys/command-center.journey.spec.ts --project=desktop-1280x720 --grep "resumed viewer"
# RED before resume fix: expected input pane %4, received %1
# GREEN: 1 passed

pnpm --filter @agent-command/dashboard typecheck
# passed
```

The worktree required the existing locked dependencies and generated schema output before the journey server could start, so setup used `pnpm install --offline --frozen-lockfile` and `pnpm --filter @agent-command/schema build`. No manifest, lockfile, schema source, control-plane, agentd, protocol, Android, dependency, deployment, migration, renderer, transport, layout, or production state changed.
