# Agent Command for Android

This module is the native Android tmux workbench for Agent Command. It uses the public Agent Command HTTPS/WSS control-plane contract and a single Termux-derived terminal emulator/renderer.

The native workbench includes:

- A searchable multi-host tmux roster organized by host, session, window, and pane, with managed and live-only target state.
- Transactional pane/window switching, verified viewer ownership, explicit read-only and Take Control states, reconnect/resume, and persisted last-target preferences.
- Terminal input, paste, physical/Samsung keyboard support, fixed and expanded key rails, local and remote scrolling, text zoom, and verified tmux pane zoom.
- Paged tmux history with search, selection, copy actions, and return-to-live behavior.
- A paged Claude transcript reader with direct prompt entry for the verified writable pane.
- Acknowledged window create/rename/close and pane split/select/focus/unfocus/terminate actions with destructive confirmations and topology reconciliation.
- An authenticated browser handoff to the existing web launch workflow.

## Non-goals

The app does not open direct SSH/Tailscale connections, start general Claude/Codex sessions natively, duplicate non-tmux dashboard areas, package another terminal renderer, provide notifications, or publish through the Play Store. General session launch remains web-owned.

## Build

Requirements: JDK 17 or newer and Android SDK 35.

```bash
export ANDROID_HOME=/path/to/android-sdk
./gradlew test lint assembleDebug
```

The installable development artifact is `app/build/outputs/apk/debug/app-debug.apk`. Android's debug signing configuration signs this artifact; production distribution must supply the repository's approved release-signing configuration outside Git.

The production signing material is stored in the Bitwarden `Agent Command` project as `ANDROID_RELEASE_KEYSTORE_BASE64`, `ANDROID_RELEASE_KEYSTORE_PASSWORD`, and `ANDROID_RELEASE_KEY_ALIAS`. Decode the keystore outside the repository, build `assembleRelease`, and use Android SDK `zipalign` plus `apksigner` to publish `android-distribution/agent-command-android.apk`. Never add the keystore or password to Git.

The app accepts a public `https://` Agent Command endpoint and an access code. It performs the existing NextAuth CSRF/credentials flow, requests a short-lived control-plane bearer token, and exchanges that token for one-time WebSocket tickets. The access code is encrypted with an Android Keystore AES-GCM key; control-plane tokens, cookies, and WebSocket tickets remain memory-only.

## Terminal source and licensing

This application is GPL-3.0-only; see `LICENSE`. It links the `terminal-view` and transitive `terminal-emulator` libraries from [Termux app 0.118.3](https://github.com/termux/termux-app/releases/tag/v0.118.3), which are also GPLv3. The complete corresponding application source and reproducible build instructions are this directory plus the pinned upstream Termux source at that tag. No Termux PTY/JNI runtime or alternate renderer is packaged.
