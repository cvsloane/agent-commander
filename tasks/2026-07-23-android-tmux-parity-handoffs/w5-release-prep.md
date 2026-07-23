---
lane: W5-RELEASE-PREP
branch: feat/android-tmux-parity-w5-release
base: 5d5866f2724e6eb56c89b7f2f065e5eefc8be97e
implementation_sha: 5533e50339255ec8c4c39f8327fae64265f35441
status: frozen unsigned release candidate
acceptance:
  - REL-1
  - REL-2
  - SEC-1
  - REG-1
  - REG-2
blockers: []
---

# W5 Android release-prep handoff

## Outcome

- Advanced the Android application identity from `v0.1.2 (3)` to `v0.2.0 (4)`.
- Replaced the Android README's foundation/MVP description with the accepted native tmux workbench capabilities: multi-host topology, authoritative navigation/control, terminal keys and scrolling, history/copy, Claude transcript/prompt, window/pane lifecycle actions, persistence, and web launch handoff.
- Preserved and made explicit the approved non-goals: no direct SSH/Tailscale, native general-session launcher, non-tmux dashboard parity, alternate renderer, notifications, or Play Store release.
- Preserved the existing Bitwarden-backed signing instructions and secret names without accessing or exposing any secret.
- Removed the dashboard's duplicated `0.1.2 (3)` display and versioned download filename. The install card continues to read artifact size and modification time from the deployed APK, the download uses the stable artifact filename, and the GPL source link uses deployed `SOURCE_COMMIT` with `main` as the source-tree fallback. Future APK versions require no dashboard source edit.

## Changed paths

- `apps/android/app/build.gradle.kts`
- `apps/android/README.md`
- `apps/dashboard/src/app/(dashboard)/settings/page.tsx`
- `apps/dashboard/src/app/api/downloads/android-apk/route.ts`

No Android feature code, tests, backend, shared contract, signing material, tracked APK, deployment configuration, or production state changed.

## Android gate

Run exactly once from `apps/android`:

```bash
ANDROID_HOME=/home/cvsloane/android-sdk ./gradlew test lint assembleRelease
```

Result:

- `BUILD SUCCESSFUL`
- 52/52 debug unit tests passed.
- 52/52 release unit tests passed.
- Android lint passed with zero errors and 34 warnings.
- Unsigned release assembly passed.
- 84 actionable tasks executed.

## Unsigned artifact receipt

Artifact:

`apps/android/app/build/outputs/apk/release/app-release-unsigned.apk`

- Size: 2,341,022 bytes
- SHA-256: `8399fa3a198bce716fa28851d83e3eb1705976d74eb923f70d4d135d027a3b19`
- Package: `com.heaviside.agentcommand`
- Version name: `0.2.0`
- Version code: `4`
- Minimum SDK: `26`
- Target SDK: `35`

Both Android SDK tools agreed:

```text
aapt:       name='com.heaviside.agentcommand' versionCode='4' versionName='0.2.0'
apkanalyzer application-id: com.heaviside.agentcommand
apkanalyzer version-name:   0.2.0
apkanalyzer version-code:   4
```

There was no release identity mismatch.

## Dashboard validation

- `pnpm install --frozen-lockfile` restored the lockfile-defined local workspace dependencies with zero downloads and no tracked change.
- Dashboard lint passed with zero errors and one pre-existing `useXtermTerminal.ts` hook warning.
- The first standalone dashboard typecheck correctly reported the missing built `@agent-command/schema` workspace output. After running the existing Docker/build prerequisite `pnpm --filter @agent-command/schema build`, `pnpm --filter @agent-command/dashboard typecheck` passed.
- `git diff --check` passed before the implementation commit.

## Deferred release boundary

This lane did not decode the keystore, zip-align, sign, verify a signature, replace `android-distribution/agent-command-android.apk`, push, open a PR, deploy, or inspect the authenticated production download. Those REL-1/REL-2 completion steps remain AI Lead and critical Reviewer work against this frozen source.
