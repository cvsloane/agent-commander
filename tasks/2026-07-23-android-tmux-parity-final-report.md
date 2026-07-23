# Android Tmux Parity — Final Report

Status: technically complete; awaiting `HUMAN-1`.

## Accepted Release

- Reviewed source: `824406dd76b0601ef47e7d592089ae0d7e9a0cc4`
- Production merge: `b41a595ff890cdb753dfd22f30c13429688933e5`
- Pull request: `#115`
- Deployment: Coolify `f10cgejtgwwtlckkz23cfi5d`
- Public service: `https://agents.heavisidetechnology.com`

The release keeps one Termux-derived native renderer and the existing public Agent Command HTTPS/WSS transport. It adds no SSH client, phone Tailnet requirement, alternate terminal engine, notification system, or second session-launch implementation.

## Functional Outcome

The Android app now covers the useful existing-session tmux workflow:

- grouped host → session → window → pane discovery across heavisidelinux and homelinux;
- authoritative pane/window switching, controller ownership, read-only viewing, and Take Control;
- terminal text, paste, control keys, Samsung/physical navigation keys, resize, and independent font/tmux zoom;
- Termux live scrollback plus immutable, bounded tmux-history pages, search, selection/copy, and return-to-live;
- Claude transcript/history and prompt send for the verified writable pane;
- acknowledged window and pane create/select/rename/split/focus/unfocus/close/terminate actions;
- last-target/preferences persistence, background/resume reconciliation, and authenticated browser handoff for general session launch.

## Review Receipt

A fresh read-only critical review accepted the replacement source and artifact after the late-review corrections. A second narrow fresh-eyes review found the pre-assignment WebSocket callback race, rejected the intermediate candidate, and then accepted exact commit `824406d` after generation-based connection ownership and a real ordering regression were added.

Final verdict:

> PASS — commit 824406dd76b0601ef47e7d592089ae0d7e9a0cc4 is accepted.

The correction release closes failed viewer-bridge resize/detach panics, repeated UI-subscription snapshots, Android reconnect ownership, stale socket callbacks, and moving-coordinate history corruption. Deep history is captured once in agentd, retained within explicit bounds, and served as immutable contiguous pages without increasing the one-MiB agent frame limit.

## Verification Receipt

- Android: 63/63 debug and 63/63 release tests; lint zero errors; release assembly passed.
- Shared schema: 64 tests and typecheck passed.
- Control plane: 216 tests and typecheck passed.
- Dashboard: typecheck and production Docker build passed.
- Agentd: affected tmux/agentd/ws tests, `go vet ./...`, `go build ./...`, and production binary build passed.
- GitHub CI: dependency review, Go build/vet/test, Node lint/typecheck/build/tests/dashboard Playwright smoke, and Docker build passed.
- PR comments/reviews: all actionable findings closed or explicitly disposed before merge; no unresolved review threads remained.

## APK Receipt

- File: `android-distribution/agent-command-android.apk`
- Package: `com.heaviside.agentcommand`
- Version: `0.2.1` (`versionCode 5`)
- Minimum/target SDK: 26/35
- Size: 2,372,645 bytes
- SHA-256: `1a0b09f5a2e8cce8588d6dd27577b07c690c0d9be8cf2fa4d3addf3876b65491`
- Signature: APK v2 and v3 verified
- Signer certificate SHA-256: `bedae11defc83f614284fd026d41699da87c519d73aece7c554ed74413f6ad1f`
- Alignment: verified
- Native libraries: none
- Platform permission: INTERNET only, plus the AndroidX app-local signature permission

Signing material came from the Agent Command Bitwarden Secrets Manager project and was removed from temporary storage after use. No secret value was printed or committed.

## Production Receipt

- The release deployment's dashboard and control-plane containers were verified at `SOURCE_COMMIT=b41a595ff890cdb753dfd22f30c13429688933e5`; a later documentation-only closure merge does not change the accepted application source or APK bytes.
- Public `/health` reports `ok` with both agents connected.
- heavisidelinux and homelinux run the identical reviewed agentd binary, version `0.2.1-824406d`, SHA-256 `38cbba59dc95526b57766f3a607e6e28f15167e692f0d8264c4bb88b8b738715`, active with zero restarts and explicit pre-release backups.
- The authenticated production endpoint returned HTTP 200, the exact APK SHA/length above, `application/vnd.android.package-archive`, stable attachment filename, and `private, no-store`.
- The downloaded production bytes independently passed package/version, zipalign, signer-certificate, and v2/v3 checks.
- A real authenticated SloaneVault request created a 674-line immutable snapshot, returned its newest 50 lines, and then returned the prior 50 lines from the same token with an exact contiguous boundary.

## Remaining Gate

All technical and production criteria pass. `HUMAN-1` remains intentionally open for Chris's one final Samsung daily-use verdict.
