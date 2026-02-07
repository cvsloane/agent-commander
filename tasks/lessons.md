# Lessons

- Date: 2026-02-04
  Correction: User clarified they deploy directly to production (no staging) for this project.
  Rule: Do not suggest staging for agent-command; proceed with production deploy when asked.

- Date: 2026-02-07
  Correction: User flagged that edits should use the `apply_patch` tool (not running an apply_patch script via `exec_command`).
  Rule: When modifying files, use the `functions.apply_patch` tool for patches instead of invoking `apply_patch` through shell commands.
