---
lane: FW6-VERIFY
branch: refactor/fw6-verify
base_sha: 3f2ddf51b49ca12e38e0bbd052058929fc0d237f
partial_sha: 2d89cd1acb68748beb57e5d3b5f8bfd282bd8e62
state: held
gates:
  setup: pass
  window_here_journey: pass
  prefix_journey: fail
  lint: not_run
  typecheck: not_run
  test_ci: not_run
  smoke: not_run
  journeys: not_run
  build: not_run
blockers:
  - 'The overlay-transparent touch tap reaches the rail and emits 0x02, but the configured heavisidelinux C-a prefix does not reach the persistent mobile terminal.'
---

# FW6-VERIFY Resume 2 held handoff

## Outcome

The lane fetched origin, rebased onto the requested `3f2ddf5` integration, and
force-pushed the rewritten branch. The new pane-sheet **New window here**
journey is committed at `2d89cd1` and passes in the 412x915 Chromium project:

- Opens the public pane actions sheet.
- Selects **New window here**.
- Verifies the `heavisidelinux`, `agents`, and
  `/home/cvsloane/dev/agent-command` prefill.
- Launches through the public action and records the expected `/v1/launch`
  body with `tmux.target_session: agents`.

The proof ran from the `fw6-r2-journeys` tmux TTY and passed in 3.6 seconds.

## Wall report

The `3f2ddf5` harness correction is effective. The retained Prefix trace shows
that Playwright resolves the visible Prefix button, completes the touch tap,
and the terminal WebSocket recorder receives one input byte. The received byte
is the default prefix `0x02` (C-b), while the host-specific expected byte is
`0x01` (C-a):

`Expected recorded terminal input to contain 0x01; received 0x02.`

The trace is local at
`test-results/command-center.journey-Com-1c77d-he-selected-host-prefix-key-mobile-412x915/trace.zip`.
Its poll record contains `Received string: "\u0002"`, proving this is no longer
an overlay or pointer-up activation failure.

Three direct journey runs were made:

1. An incomplete expanded-preset fixture exposed that the preset name alone
   does not materialize its key config during persisted-state hydration.
2. A complete custom rail plus persisted `tmuxPrefixByHost[heavisidelinux] =
C-a` tapped successfully but emitted `0x02`.
3. The public Settings UI selected the expanded rail, filled the visible
   heavisidelinux prefix control with `C-a`, and verified that field value;
   after navigating to the terminal, the configured Prefix key was not
   retained.

The failed Prefix experiment was removed rather than committed. Direct store
injection or changing the expected byte would conceal the shipped propagation
failure. The likely implementation path crosses the persistent terminal
descriptor/settings integration outside this lane's dashboard ownership, and
the brief's three-run ceiling requires a hold.

## Options for the AI Lead

1. Return per-host prefix propagation through the persistent mobile terminal
   to the terminal/settings owner, using the `0x01` journey as acceptance.
2. Expand this lane's firewall to the settings store/sync and persistent
   terminal descriptor path so it can diagnose and fix the direct behavior.
3. Move the Prefix acceptance journey to the owning lane and resume FW6-VERIFY
   for the remaining carried items after that commit integrates.

## Pushed partial scope

The branch also retains the earlier green journey coverage for cold-open
restore, window retargeting, attached-client letterbox stability, and one-shot
sticky Control. No failing test was pushed.

## Unstarted work

- A9 canonical launch/open hrefs.
- A10 performance gating.
- A11 focus-only window-strip arrow navigation.
- Wave 6 docs truth pass and docs-site screenshot.
- CHANGELOG 0.4.1.
- Owner device checklist.
- Full mandatory gate sequence.

The corrected overlay lesson is recorded in `tasks/lessons.md`. No production
state, deployment files, secrets, or default tmux sessions were changed.
