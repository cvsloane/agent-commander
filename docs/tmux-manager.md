# Tmux Manager

`/tmux` is the primary working surface for live tmux panes in Agent Commander.

It is built for the normal workflow of keeping several tmux windows open across one or more machines and jumping directly into the pane you want, without forcing every action through the broader sessions or orchestrator views.

## What it shows

- Hosts with tmux capability and current online state
- Tmux sessions grouped into windows
- Panes nested under each window
- Repo, branch, provider, cwd, and activity context for each pane
- An inline workbench for the selected pane

## Why it exists

The original sessions and orchestrator pages are useful operator views, but they mix together several concepts:

- tmux panes
- background jobs
- approvals and attention queues
- automation and governance

`/tmux` strips that down to the workflow most operators actually live in: pick a host, pick a tmux window, and work directly in the pane.

## Core workflow

1. Open `/tmux`.
2. Select a host from the roster.
3. Choose the tmux session/window you want.
4. Open the target pane in the inline workbench.
5. Use the embedded terminal controls, send input, idle/wake, or terminate actions without leaving the page.

## Relationship to other pages

- `/tmux` is the primary tmux workflow.
- `/sessions` is the broader inventory view across tmux panes, jobs, and services.
- `/sessions/[id]` is the standalone session detail route.
- `/orchestrator` stays focused on waiting-for-input, approvals, and errors.
- `/automation` stays focused on orchestrators, workers, wakeups, runs, and governance.

## Design constraints

- The tmux manager reuses the existing session and terminal runtime.
- It does not introduce a second tmux backend model.
- It does not replace `/sessions`; it simplifies the common workflow.
- It shows unmanaged panes automatically when they are already present in the session registry.

## Current scope

The tmux manager is intentionally read/write for pane work, not a full tmux administration surface. It does not yet add tmux-native rename/split/move controls beyond the session actions Agent Commander already supports.
