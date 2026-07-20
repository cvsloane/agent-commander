# Handoffs

One file per lane per freeze: `fw<N>-<lane>.md`. YAML front matter + Markdown body, parseable by the AI Lead:

```yaml
---
lane: FW1-MODERN
frozen_sha: <full sha>
attempt: 1
state: frozen | held | escalated
gates:
  lint: pass|fail
  typecheck: pass|fail
  test_ci: pass|fail
  smoke: pass|fail
  build: pass|fail
  go: pass|fail|n/a
proof:
  - <command> → <result summary or committed evidence path>
assumptions: []
uncertainties: []
blockers: []
---
```

Body: what changed (by area), decisions taken within the brief's latitude, anything deferred with justification. End with the exact completion token on its own line. heavisidelinux lanes commit the handoff on their lane branch and push; homelinux lanes commit on their local lane branch.
