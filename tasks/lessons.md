# Lessons

- Date: 2026-02-04
  Correction: User clarified they deploy directly to production (no staging) for this project.
  Rule: Do not suggest staging for agent-command; proceed with production deploy when asked.

- Date: 2026-02-07
  Correction: User flagged that edits should use the `apply_patch` tool (not running an apply_patch script via `exec_command`).
  Rule: When modifying files, use the `functions.apply_patch` tool for patches instead of invoking `apply_patch` through shell commands.

- Date: 2026-02-14
  Correction: User asked to store this kind of refactor/implementation note under `tasks/` instead of the repo root.
  Rule: Put internal implementation notes in `tasks/` using an ISO date prefix in the filename.
