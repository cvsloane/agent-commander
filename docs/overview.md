# Overview

Agent Commander is a mission control system for AI agent sessions running across one or many machines. It discovers tmux panes, keeps a live session registry, streams console output to the browser, and lets you interact with those terminals directly from the dashboard.

![Dashboard Overview](images/dashboard-overview.png)

What makes it different:
- It is tmux native. Sessions are real tmux panes, not fake terminals.
- Streaming is live and interactive. You can watch output and send input.
- Multi-host is first class. One dashboard can control many machines.
- Approvals and attention queues are built in, not bolted on.
- The visualizer gives a high level, ambient view of activity.

## Core concepts

- Host: a machine running agentd.
- Session: a tmux pane or job with a stable ID and metadata.
- Group: a logical folder for sessions, often mapped to tmux session names.
- Link: a relationship between two sessions (complement or review).
- Approval: a permission request that requires a human decision.
- Snapshot: a rolling capture of terminal output for quick scanning.
- Event: a persisted timeline entry (commands, approvals, errors, tool events).

## Typical workflow

1. Install agentd on a host and connect it to the control plane.
2. Existing tmux panes appear automatically as sessions.
3. Spawn new sessions from the dashboard or adopt orphan panes.
4. Open the console stream to watch output or take control.
5. Handle approval requests in the approvals queue or orchestrator.
6. Use the visualizer and alerts to monitor many sessions at once.

## Feature map

- Session discovery and grouping (tmux-aware)
- Spawn, rename, kill, and fork sessions
- Live console streaming with read-only and control modes
- Orchestrator attention queue (waiting input, approvals, errors)
- Approval decisions with hooks and keystroke fallback
- Provider usage analytics and thresholds
- Alerts via browser, audio, in-app toasts, and Clawdbot
- Voice transcription (optional)
- MCP enablement per session and per project
