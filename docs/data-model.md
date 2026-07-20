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
- tmux_pane_id, tmux_target
- tmux_session_name, tmux_window_index, tmux_pane_index
- cwd, repo_root, git_branch
- group_id

Tmux pane identity is standardized in the shared schema as `TmuxPaneIdentity`.
agentd sends the typed identity in `metadata.tmux`; control-plane ingest promotes
the stable coordinates into SQL columns and `/v1/tmux/roster` groups them in SQL.
The dashboard reads promoted server identity first and only reconstructs legacy
targets as a version-skew fallback:

- pane_id
- target
- session_name
- window_name
- window_index
- pane_index

## Repo

Canonical repo identity used for repo-scoped memory and automation targeting.
Key fields:
- id, canonical_key
- git_remote_normalized, repo_root_hash
- display_name
- last_host_id, last_repo_root

Project shortcuts carry a nullable `repo_id` foreign key to this canonical record.

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

## Identity and references

- `user_settings.user_id` is the table's sole primary identity. Migration 038
  retains subject-to-UUID recovery rows separately until each legacy user next
  authenticates and atomically claims their settings.
- `summaries.session_id` is nullable and uses `ON DELETE SET NULL`.
- `projects.repo_id` uses `ON DELETE SET NULL`.
- The unused `service` session kind is removed only when migration 038 verifies no rows use it.
  Read contracts still tolerate historical service rows, while new upserts reject the kind.

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
