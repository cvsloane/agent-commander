# Releases

## v0.2.0

`v0.2.0` is the release where Agent Commander became more than a tmux dashboard.

### Highlights

- **tmux-first manager**: `/tmux` is now the primary pane-and-window workflow, with an inline workbench for real terminal control.
- **Autonomous orchestration**: `/automation` adds orchestrators, workers, wakeups, governance approvals, work items, concurrency controls, and runtime reuse.
- **Scoped memory**: `/memory` adds repo and global memory for every session, with `working`, `episodic`, `semantic`, and `procedural` tiers.
- **Trajectory-backed learning**: successful runs can distill into reusable procedural knowledge instead of leaving everything as raw session history.
- **Hermes integration**: external wake APIs, signed webhook wakes, and deterministic watchdog/governance summaries connect Agent Commander into the broader Heaviside operating stack.
- **Runtime hardening**: provider capability reporting, websocket auth buffering, and CORS fixes improve day-to-day reliability in production.

### Architectural direction

This release intentionally borrows concepts from two adjacent systems while keeping Agent Commander’s own execution model:

- **Paperclip-inspired**: wake queues, claim/coalescing discipline, governance approvals, budgets, worker/orchestrator hierarchy, and external automation hooks.
- **Ruflo-inspired**: scoped memory, procedural knowledge, and trajectory-based learning.

Agent Commander keeps its own core advantage: everything still runs through normal sessions on top of `agentd`, so autonomous work remains visible and interruptible in the same live terminals operators already use.

### Product surfaces added or expanded

- `/tmux`
- `/automation`
- `/memory`
- Hermes integration endpoints and summaries
- Public site and docs refreshed to reflect the new product shape

## v0.1.0

Initial public release of Agent Commander as a tmux-native mission control dashboard with live streaming, approvals, sessions, analytics, and multi-host control.
