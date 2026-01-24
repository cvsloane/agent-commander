# Sessions

Sessions are the core unit in Agent Commander. A session usually maps to a tmux pane, but can also represent jobs or services.

![Sessions](images/sessions-view.png)

## Session types

- `tmux_pane` - a live tmux pane.
- `job` - a provider job (e.g., codex exec).
- `service` - a long running background task.

## Session providers

Supported providers include:
- claude_code
- codex
- gemini_cli
- opencode
- cursor
- aider
- continue
- shell
- unknown

## Status lifecycle

Common statuses:
- STARTING
- RUNNING
- IDLE
- WAITING_FOR_INPUT
- WAITING_FOR_APPROVAL
- ERROR
- DONE

The orchestrator uses WAITING_FOR_INPUT, WAITING_FOR_APPROVAL, and ERROR to build the attention queue.

## Discovery and adoption

agentd polls tmux and registers panes. If a pane is found without a session ID, it is considered orphaned and can be adopted from the dashboard.

## Grouping

Groups are folders for sessions. The control plane can auto group by tmux session name when the tmux metadata includes `session_name`.

- Create groups manually from the UI or API.
- Drag and drop sessions into groups.
- Groups can be nested.

## Links

Sessions can be linked to indicate relationships:
- `complement` - two sessions are part of the same workstream.
- `review` - one session reviews another.

Links show up on the session detail page and help with cross session navigation.

## Snapshots and events

- agentd captures snapshots of pane output at intervals.
- Snapshots enable fast preview and summarize context.
- Events persist command dispatches, approvals, errors, and tool events.

## Session actions

From the dashboard or API you can:
- Rename sessions.
- Kill sessions.
- Spawn new sessions from templates.
- Fork a session into a new tmux window.
- Copy pane output into another session.
- Archive or unarchive sessions.
- Mark a session as idle or wake it.
