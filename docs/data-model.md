# Data Model

This is a high level view of the core entities.

## Host

Represents a machine running agentd.
Fields include id, name, last_seen_at, capabilities, and agent_version.

## Session

Represents a tmux pane or job.
Key fields:
- id, host_id
- provider, kind
- status, title
- tmux_pane_id
- cwd, repo_root, git_branch
- group_id

## Group

Folders for organizing sessions. Groups can be nested and ordered.

## Link

A relationship between two sessions (complement or review).

## Approval

A permission request. Stores the decision, decision mode, timestamps, and payload.

## Event

Timeline entry for commands, approvals, hooks, and errors.

## Snapshot

Rolling capture of terminal output for a session.

## Tool event

Structured tool usage timeline entry, used for live UI updates.

## Usage metrics

Token counts, tool call counts, and approval metrics per session and provider.
