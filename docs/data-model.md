# Data Model

This is a high level view of the core entities.

## Host

Represents a machine running agentd.
Fields include id, name, last_seen_at, capabilities, and agent_version.

## Session

Represents a tmux pane or job.
Key fields:
- id, host_id, user_id, repo_id
- provider, kind
- status, title
- tmux_pane_id
- cwd, repo_root, git_branch
- group_id

## Repo

Canonical repo identity used for repo-scoped memory and automation targeting.
Key fields:
- id, canonical_key
- git_remote_normalized, repo_root_hash
- display_name
- last_host_id, last_repo_root

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

## Memory

Scoped user memory stored in `memory_entries` with:
- `scope_type` (`global`, `repo`, `working`)
- `tier` (`working`, `episodic`, `semantic`)
- optional `repo_id` and `session_id`

`memory_trajectories` stores summarized run outcomes that can later be distilled into semantic memory.

## Automation

Autonomous orchestration is represented by:
- `automation_agents`
- `automation_wakeups`
- `automation_runs`
- `governance_approvals`
- `work_items`

Automation runs link back to normal sessions through `session_id`.
