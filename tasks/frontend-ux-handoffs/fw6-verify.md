---
lane: FW6-VERIFY
branch: refactor/fw6-verify
base_sha: 133bb1e3f21764629bd764bb4092448d58225bc5
partial_sha: 36561897343302013a7e6692e944bfe25fc8ac97
state: held
gates:
  setup: pass
  focused_journeys: pass
  lint: not_run
  typecheck: not_run
  test_ci: not_run
  smoke: not_run
  journeys: not_run
  build: not_run
blockers:
  - "A connected mobile Prefix rail tap emits no terminal WebSocket input frame; the direct fix is outside this lane's ownership firewall."
---

# FW6-VERIFY held handoff

## Outcome

FW6-VERIFY is held at the first blocked direct-path defect. The pushed partial
work adds green journey coverage for four batch-1 behaviors:

- Cold-open restore reaches the saved live pane with zero post-sign-in taps on
  both 412x915 and 1280x720 profiles.
- Window-strip selection retargets the live viewer on both profiles.
- A topology reporting one attached client opens the mobile terminal with a
  fixed 160x50 letterbox and emits no resize while three keyboard-transition
  viewport sizes are applied.
- The mobile rail's one-shot sticky Control converts the next physical `c` to
  one `0x03` input byte and disarms.

Focused Playwright proof ran from the `fw6-partial-proof` tmux TTY: 6 passed and
2 expected desktop skips. The pushed commit is `3656189`.

## Wall report

The per-host-prefix journey used a persisted `C-a` host setting and a visible
Prefix rail key. After the terminal reported Connected and the actual pointer
tap landed on the button, the journey recorder received no `input` WebSocket
message (neither `0x01` nor the default prefix byte). The final failure was:

`Expected recorded terminal input to contain 0x01; received an empty string.`

The trace shows the click completed on the live rail after the server sent the
terminal `attached` event. Earlier attempts corrected two fixture-level issues:
the settings PUT route and a Next dev-tools button overlapping an unrealistic
one-key rail. The remaining failure is in the rail-to-terminal input path.

The direct implementation surfaces are
`apps/dashboard/src/components/mobile/TerminalKeyRail.tsx` and/or
`apps/dashboard/src/components/TerminalView.tsx`. This lane may not edit either:
its dashboard ownership is limited to A10 performance components/hooks and A11
`TmuxWindowStrip.tsx`. Building a synthetic dispatch or alternate test path
would conceal the shipped journey failure, so work stopped here.

Static inspection also indicates the attached mobile shell hides its only
`Launch agent` trigger while `windowHere` is populated, then drops the
`windowHere` context after returning to roster. The required “＋ window here”
journey was therefore not added before the hold.

## Options for the AI Lead

1. Assign the prefix rail input defect and attached “window here” trigger back
   to the batch-1 owner, then resume FW6-VERIFY after integration.
2. Expand this lane's firewall to those exact batch-1 component paths and
   resume the direct fixes here.
3. Accept `3656189` as partial journey coverage and move the two missing
   journeys to the owning lane.

## Unstarted work

- Remaining journey assertions: per-host Prefix and “＋ window here”.
- A9 canonical launch/open hrefs.
- A10 performance gating.
- A11 focus-only window-strip arrow navigation.
- Wave 6 docs truth pass and docs-site screenshot.
- CHANGELOG 0.4.1.
- Owner device checklist.
- Full mandatory gate sequence.

No production state, deployment files, secrets, or default tmux sessions were
changed. Playwright used dedicated tmux TTY sessions, which were removed after
each run.
