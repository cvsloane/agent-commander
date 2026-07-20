---
lane: W4-FLEET-UI
branch: refactor/wave4-fleet-ui
frozen_sha: 0e01e6d8c85098d707fb57fd9ee5291ef378e74b
attempt: 1
gate:
  commands:
    - pnpm --filter @agent-command/dashboard test
    - pnpm --filter @agent-command/dashboard typecheck
    - pnpm --filter @agent-command/dashboard lint
    - pnpm test:smoke:dashboard
    - /home/cvsloane/dev/open-agents/skills/frontend-product-design/scripts/audit_frontend.sh
  results:
    - command: pnpm --filter @agent-command/dashboard test
      status: passed
      detail: 9 files and 59 tests passed, including fleet-family filtering, cross-host grouping, and attention ownership regressions.
    - command: pnpm --filter @agent-command/dashboard typecheck
      status: passed
      detail: Next route generation and tsc --noEmit completed successfully.
    - command: pnpm --filter @agent-command/dashboard lint
      status: passed
      detail: ESLint exited 0 with only the four pre-existing React hook warnings in sibling-owned TerminalView and unchanged MobileLaunchSheet.
    - command: pnpm test:smoke:dashboard
      status: passed
      detail: All 10 Chromium scenarios passed, including mobile bottom navigation/orchestrator steering, strict mutation contracts, cross-host waiting-first roster, drawer focus restoration, and tablet automation sheets.
    - command: /home/cvsloane/dev/open-agents/skills/frontend-product-design/scripts/audit_frontend.sh
      status: passed
      detail: Workspace lint, typecheck, and tests passed; dashboard 59, control-plane 132, schema 30, and CLI 44 tests. Expected mocked notification stderr remained non-fatal in the passing control-plane suite.
assumptions:
  - Cross-host roster aggregation stays dashboard-only: every currently online tmux-capable host is queried in parallel, successful rosters survive partial failure, and hosts.changed refreshes membership.
  - Structured reports belong to automation agents whose active or last runtime session is the orchestrator or a direct child in its graph; latest reports are fetched per matched agent.
  - Budget bars are estimates over the loaded run window. At the 100-run boundary the UI labels spend as a lower bound and states that enforcement remains server-authoritative.
  - Four concurrent orchestrator detail bundles is a safe dashboard-side cap until the control plane exposes a fleet aggregate endpoint.
uncertainties:
  - There is no single backend fleet/report aggregate, so cards still make bounded graph, task, and matched-report requests.
  - Responsive behavior and keyboard focus were exercised in local Chromium at 390x844, 768x1024, and 1280x720; physical iOS/Android devices were not exercised.
  - Failure states are explicit for partial host, repo, host-reference, graph/task/report, run-timeline, prompt, decision, and automation-action failures, but external deployed failure injection was not performed.
blockers: []
---

# Wave 4 FLEET-UI handoff

## Summary

- Rebuilt `/orchestrator` around a default Fleet tab with one mobile-first command card per orchestrator-role session. Cards combine graph rollups, direct child sessions, in-process agent tasks, the latest matched structured report, binary/plan/governance decisions, a terminal-independent prompt composer, and a one-tap host-aware terminal deep link. The prior attention queue remains available as the secondary tab, with child/run attention assigned to its owning orchestrator.
- Added a pure fleet roster model to `/tmux`. Orchestrator edges override tmux window layout, filters retain an entire matching orchestrator family, ordinary tmux clusters continue filtering pane-by-pane, same-named sessions remain host-scoped, and All machines fetches every online host with waiting-first ordering and partial-failure disclosure.
- Added a global safe-area-aware mobile bottom bar for tmux, Orchestrator, Sessions, and More. More opens the existing navigation as a Radix modal drawer with focus trapping, Escape dismissal, and focus return.
- Decomposed the former 1,401-line automation page into a controller, overview, tabs, agent cards, action sheets, and shared presentation utilities. Tabs and selected runs are URL-addressable; missing recent runs still expose their linked event timeline; sheets retain the full scheduling/concurrency/budget forms; cards add wake, nudge, pause/resume, host-aware terminal links, and disclosed budget progress.
- Tightened browser smoke fixtures to return 404 for unknown control-plane requests and added contract/body assertions for prompts, approvals, and nudges. The responsive browser audit captured and reviewed mobile orchestrator, tablet automation-sheet, and desktop all-machines states.
- Fresh-eyes adversarial review completed three passes. All initial and follow-up warning findings were remediated; the final pass reported no critical or warning issues.

## Frontend quality audit

- Product completeness: 15/15
- Information architecture: 14/15
- Visual hierarchy: 14/15
- Data clarity: 14/15
- Interaction quality: 9/10
- Accessibility: 14/15
- Responsive behavior: 10/10
- Performance discipline: 4/5
- Total: **94/100**, with no hard failures.

No control-plane route was required, no sibling terminal-stack files were changed, and nothing was pushed.

The `frozen_sha` is the final implementation commit; the following handoff-only commit adds this file.
