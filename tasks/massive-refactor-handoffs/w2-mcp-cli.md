---
lane: W2-MCP-CLI
branch: refactor/wave2-mcp-cli
frozen_sha: ee52e6864a082aae81eeecc6bb68a739baf5680e
attempt: 1
gate:
  commands:
    - pnpm install
    - pnpm --filter @agent-command/cli build
    - pnpm --filter @agent-command/cli test
    - pnpm typecheck
    - pnpm lint
    - pnpm test
  results:
    - command: pnpm install
      status: passed
      detail: All five workspace projects installed from the updated lockfile with no downloads required on the final run.
    - command: pnpm --filter @agent-command/cli build
      status: passed
      detail: TypeScript compiled successfully and dist/bin.js was marked executable.
    - command: pnpm --filter @agent-command/cli test
      status: passed
      detail: Three files and 44 tests passed, including every CLI command, all eleven MCP tools, real in-memory MCP registration/calls, auth-scope regressions, recursive remote tree termination, and structured error paths.
    - command: pnpm typecheck
      status: passed
      detail: All five Turbo tasks passed across CLI, schema, dashboard, and control plane.
    - command: pnpm lint
      status: passed
      detail: All five Turbo tasks passed. The dashboard retained four pre-existing React hook warnings and there were no errors.
    - command: pnpm test
      status: passed
      detail: All five Turbo tasks passed (CLI 44, schema 23, dashboard 43, control plane 91).
assumptions:
  - The W2-CP-ORCH lane lands the reviewed /v1/orchestrator routes and session JWT token_use=orchestrator_session contract before this package is used for cross-host session-scoped operations.
  - AC_CONTROL_PLANE_AUTH_MODE=session is the safe pane-resident default whenever AC_SESSION_ID is present; administrative global reads and remote termination require an explicit operator mode and credential.
  - The caller-owned children returned by /v1/orchestrator/children are the correct safe roster for a session-scoped orchestrator; only operator mode may use the global tmux roster.
uncertainties:
  - Cross-host control-plane behavior was verified against the sibling lane's exact route implementations and mocked HTTP contracts, not a deployed mixed-branch control plane.
  - MCP registration and invocation were exercised over the SDK's in-memory transport; the production adapter itself uses the SDK stdio transport but was not attached to a live Claude Code process.
  - Agentd local request/response types and control-plane response envelopes are package-local because shared ac-schema exports are not available on this lane's base. Future contract consolidation should export those schemas centrally.
  - Session-scoped work-item repo/agent selectors intentionally fail closed until the orchestrator endpoint adds server-side filters or pagination; operator mode supports the existing global filters.
  - Session-scoped remote kill is intentionally unavailable because the current bulk termination endpoint is operator-only. A caller-owned child-kill endpoint would remove that limitation.
blockers: []
---

# Wave 2 MCP-CLI handoff

## Summary

- Added the installable `ac` binary as `@agent-command/cli`, with local-first agentd operations for spawn, session trees, input, cascade kill, wait, and structured reports.
- Added cross-host/control-plane adapters for scoped worker spawn/list/input/wait, automation-run reports, work claims/completion with evidence, memory search/write, and safe caller-child rosters.
- Added explicit session-versus-operator credential routing. Session JWTs are recognized by claim and cannot fall through to legacy global endpoints; unsupported selectors fail closed with structured errors.
- Added operator-only administrative fallbacks, host-filtered global reads, recursive incident-edge graph traversal for child-first remote tree termination, and exact route-level 404 feature detection.
- Added the `ac mcp` stdio server with all eleven required tools over the same operation layer as the CLI.
- Added environment/config-file precedence, JSON output and errors, strict argument validation, package documentation, Claude Code `mcpServers` setup, and workspace lockfile wiring.
- Added mocked HTTP tests for every CLI command and MCP tool, plus real MCP registration/invocation coverage and security/correctness regressions from a fresh adversarial review.

The `frozen_sha` is the final implementation commit; the following handoff-only commit adds this file.
