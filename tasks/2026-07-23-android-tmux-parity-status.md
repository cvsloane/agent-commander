# Android Tmux Parity — Status

- State: release correction in progress after late automated review
- Approval: approved at 2026-07-23T00:19:00-04:00
- Accepted source: `24dd76e685b96fdb007370999f415f47cda2db75`
- Production merge: `b0280a766f10ed5ce266619dfbe8f5e41792cfcc`
- Pull request: `#114`
- Production APK: v0.2.0/code4, SHA-256 `cb4bafe6fb3fe887768ce7cf0a18bfc91bd6a268b70116fdd3bcbad8a4859735`

## Current Truth

The first production candidate is deployed, but a CodeRabbit review completed after PR `#114` merged and raised concrete agentd concurrency, Android reconnect/history, and re-subscription concerns. W5 is held while fresh correction lanes verify and directly fix the valid findings. The owner test has not started.

The exact reviewed and signed APK is available from the authenticated production Settings page. Both hosts run agentd `0.2.0-24dd76e`; the production dashboard and control plane run merge `b0280a7`, report healthy, and see both agents. No phone Tailnet or SSH session is required.

Do not treat the current APK as the final handoff until the correction source is integrated, re-reviewed, rebuilt, re-signed, and re-verified in production.

## Workstreams

| Workstream | State | Result |
|---|---|---|
| W0 baseline/contract | accepted | Existing public transport and Termux renderer retained |
| W1 interaction authority/scroll | accepted | Viewer/control truth, input fencing, scrolling, and physical keys |
| W2 topology/API/domain | accepted | Authoritative multi-host live topology and persistence |
| W3 workbench UI | accepted | Native roster, history/copy, zoom, Claude view, key rail, and web handoff |
| W4 window/pane lifecycle | accepted | Acknowledged mutations, confirmations, and reconciliation |
| W5 release | correcting | Late automated review findings are being validated before a replacement release |

## Final Gate

- Technical gates: held for correction
- Production verification: superseded after the replacement deploy
- Owner physical-device verdict: pending
