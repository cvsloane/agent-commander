# Android Tmux Parity — Final Report

Status: pending replacement release after late automated review.

## Accepted Release

- Reviewed source: `24dd76e685b96fdb007370999f415f47cda2db75`
- Production merge: `b0280a766f10ed5ce266619dfbe8f5e41792cfcc`
- Pull request: `#114`
- Deployment: Coolify `cyicgtbhwz9q1f5n0oozdmwi`
- Public service: `https://agents.heavisidetechnology.com`

The release keeps one Termux-derived native renderer and the existing public Agent Command HTTPS/WSS transport. It adds no SSH client, phone Tailnet requirement, alternate terminal engine, notification system, or second session-launch implementation.

## Functional Outcome

The Android app now covers the useful existing-session tmux workflow:

- grouped host → session → window → pane discovery across heavisidelinux and homelinux;
- authoritative pane/window switching, controller ownership, read-only viewing, and Take Control;
- terminal text, paste, control keys, Samsung/physical navigation keys, resize, and independent font/tmux zoom;
- Termux live scrollback plus paged tmux history, search, selection/copy, and return-to-live;
- Claude transcript/history and prompt send for the verified writable pane;
- acknowledged window and pane create/select/rename/split/focus/unfocus/close/terminate actions;
- last-target/preferences persistence, background/resume reconciliation, and authenticated browser handoff for general session launch.

## Review Receipt

A fresh read-only critical review ran on homelinux with Codex CLI 0.145.0, `gpt-5.6-sol`, xhigh, against exact commit `24dd76e`.

Final verdict:

> PASS — commit 24dd76e685b96fdb007370999f415f47cda2db75 is accepted as frozen release candidate.

The first correction wave closed physical-key delivery, correlated UI-stream readiness and command timeouts, live-only action fencing, and full-stack pane/controller authority during focus changes. A later CodeRabbit review completed after the production merge and raised additional findings; this report is not final until their valid subset is corrected and freshly re-reviewed.

## Verification Receipt

- Android: 57/57 debug and 57/57 release tests; lint zero errors; release assembly passed.
- Shared schema: 62 tests and typecheck passed.
- Control plane: 214 tests and typecheck passed.
- Dashboard: typecheck and production Docker build passed.
- Agentd: affected tmux/agentd/ws tests, `go vet ./...`, `go build ./...`, and production binary build passed.
- GitHub CI: dependency review, Go build/vet/test, Node lint/typecheck/build/tests/dashboard Playwright smoke, and both Docker builds passed.
- PR comments/reviews: CodeRabbit completed after merge; valid findings require a replacement candidate.

## APK Receipt

- File: `android-distribution/agent-command-android.apk`
- Package: `com.heaviside.agentcommand`
- Version: `0.2.0` (`versionCode 4`)
- Minimum/target SDK: 26/35
- Size: 2,360,357 bytes
- SHA-256: `cb4bafe6fb3fe887768ce7cf0a18bfc91bd6a268b70116fdd3bcbad8a4859735`
- Signature: APK v2 and v3 verified
- Signer certificate SHA-256: `bedae11defc83f614284fd026d41699da87c519d73aece7c554ed74413f6ad1f`
- Alignment: verified
- Native libraries: none
- Platform permission: INTERNET only, plus the AndroidX app-local signature permission

Signing material came from the Agent Command Bitwarden Secrets Manager project and was removed from temporary storage after use. No secret value was printed or committed.

## Production Receipt

- Dashboard and control-plane containers run `SOURCE_COMMIT=b0280a766f10ed5ce266619dfbe8f5e41792cfcc`.
- Public `/health` reports `ok` with both agents connected.
- heavisidelinux and homelinux run the identical reviewed agentd binary, version `0.2.0-24dd76e`, SHA-256 `2e48f5f1b4c2651795ea7ee932b21659ac170f6da49bd0e2e0dffb8221a16547`, active with zero restarts.
- The authenticated production endpoint returned HTTP 200, the exact APK SHA/length above, `application/vnd.android.package-archive`, stable attachment filename, and `private, no-store`.
- The downloaded production bytes independently passed package/version, zipalign, signer-certificate, and v2/v3 checks.

## Remaining Gate

The replacement candidate must close the late-review findings before the technical checklist can be finalized. `HUMAN-1` remains intentionally open.
