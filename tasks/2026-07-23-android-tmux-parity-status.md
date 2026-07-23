# Android Tmux Parity — Status

- State: technical release complete; awaiting owner device verdict
- Approval: approved at 2026-07-23T00:19:00-04:00
- Accepted source: `824406dd76b0601ef47e7d592089ae0d7e9a0cc4`
- Production merge: `b41a595ff890cdb753dfd22f30c13429688933e5`
- Pull request: `#115`
- Production APK: v0.2.1/code5, SHA-256 `1a0b09f5a2e8cce8588d6dd27577b07c690c0d9be8cf2fa4d3addf3876b65491`

## Current Truth

The replacement release is deployed and technically accepted. The late findings from PR `#114` were verified and corrected, including nil-bridge resize/detach safety, correlated re-subscription snapshots, Android reconnect ownership, and immutable deep tmux history. A later PR `#115` review found a stale WebSocket-callback race; generation-based connection ownership and a real synchronous callback-ordering regression closed it before release.

The exact reviewed and signed APK is available from the authenticated production Settings page. Both hosts run identical agentd `0.2.1-824406d`; the production application release was verified from merge `b41a595f`, reports healthy, and sees both agents. A later documentation-only closure merge does not change the accepted application source or APK bytes. No phone Tailnet or SSH session is required.

## Workstreams

| Workstream | State | Result |
|---|---|---|
| W0 baseline/contract | accepted | Existing public transport and Termux renderer retained |
| W1 interaction authority/scroll | accepted | Viewer/control truth, input fencing, scrolling, and physical keys |
| W2 topology/API/domain | accepted | Authoritative multi-host live topology and persistence |
| W3 workbench UI | accepted | Native roster, history/copy, zoom, Claude view, key rail, and web handoff |
| W4 window/pane lifecycle | accepted | Acknowledged mutations, confirmations, and reconciliation |
| W5 release | accepted | Replacement source, agentd, signed APK, production deploy, and authenticated download verified |

## Final Gate

- Technical gates: passed
- Production verification: passed
- Owner physical-device verdict: pending
