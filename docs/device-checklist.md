# Mobile Device Checklist

Use this guided pass at the end of a mobile Command Center wave. It takes about
10 minutes on a Samsung Galaxy S25 Ultra with Brave and exercises the real PWA,
terminal, desktop-sharing, approval, and push paths.

## Before you start

- Have the production HTTPS dashboard URL and a test operator account ready.
- Keep a desktop browser attached to a tmux session that is safe to resize and
  run test commands in.
- Have one session that can raise an approval and one action that can produce a
  test Web Push notification.
- In Agent Commander Settings, choose the Expanded terminal rail for the test
  host and confirm its tmux prefix (`C-b` unless that host uses another prefix).

Record the app/version, device OS, Brave version, host, tmux target, and test
time. Mark each numbered check Pass or Fail and capture a screenshot for any
failure.

## 1. Refresh the PWA and push permission (1 minute)

1. In Brave, open Settings and enable **Use Google services for push messaging**.
2. Open the HTTPS dashboard in Brave and reload it. Use Brave's **Install app**
   or **Add to Home screen** action if the PWA is not installed; if it is
   installed, fully close it after the reload and reopen it from the launcher.
3. In Agent Commander Settings, enable Web Push and allow notifications.

Pass when the installed app opens without browser chrome and Settings reports
Web Push enabled. If permission was previously denied, reset it in Android's app
notification settings before retrying.

## 2. Cold-open restore (1 minute)

1. In the installed PWA, select the prepared host and tmux pane and wait for
   **Connected**.
2. Swipe the PWA away from Android recents so no app window remains.
3. Reopen it from the launcher without following a saved deep link.

Pass when the same pane becomes visible and connected with zero taps. The URL,
when inspected in Brave, should use `/?host_id=...&session_id=...&mode=terminal&attach=1`.

## 3. Rail while typing and sticky Ctrl (1 minute)

1. Tap the terminal to raise the Android keyboard and confirm there is only one
   terminal key rail above it.
2. Type `sleep 30` and press Enter.
3. Tap rail **Ctrl** once, then type `c` on the Android keyboard.
4. Confirm the command stops, the prompt returns, and Ctrl is no longer active.
5. Tap **Esc**, arrows, **Tab**, and **Prefix** as appropriate for the safe test
   session; each tap should act once without dismissing the keyboard.

Pass when sticky Ctrl is one-shot and the rail remains responsive throughout
native-keyboard input.

## 4. Pinch font (30 seconds)

Pinch out and in on the terminal. Pass when the text changes size smoothly,
stays within 11–18 px, remains usable, and the last size persists after leaving
and returning to the pane.

## 5. Desktop-attached letterbox (1 minute)

1. Keep the desktop client attached to the same tmux session and note its rows
   and columns with `tmux display-message -p '#{window_width}x#{window_height}'`.
2. Return to the phone pane. Confirm the terminal keeps that shared desktop grid;
   pan horizontally if the grid is wider than the phone.
3. Open and close the Android keyboard.

Pass when the grid does not resize during the keyboard transition and the
desktop layout does not jump. Detach the desktop client and confirm the phone
refits after topology updates.

## 6. Scrollback freeze and pager copy (2 minutes)

1. Produce enough numbered output to fill several screens, then continue
   producing output while you swipe upward in the phone terminal.
2. Pass the live-buffer check when your reading position stays fixed instead of
   snapping to the bottom. Tap **Live** to resume following.
3. Open **History** from the Expanded rail or pane controls. Tap one captured
   line to anchor a range, tap another to extend it, then tap **Copy selected
   lines**.
4. Paste into a temporary text field and verify the first and last copied lines
   exactly match the selected range. Also tap **Load older** once when available.

## 7. Approval overlay (1 minute)

Raise a safe approval for the attached session. Pass when the attention card is
visible above the terminal rail, **Approve** succeeds without leaving the
terminal, and the resolved overlay clears. Repeat while read-only if convenient:
Approve/Deny should remain available even though terminal typing is blocked.

## 8. Push notification and deep link (1 minute)

Put the PWA in the background, trigger the prepared test notification, and tap
it. Pass when Android shows the notification and the tap focuses an existing
Agent Commander window or opens the same-origin target. If nothing arrives,
recheck **Use Google services for push messaging**, Android notification
permission, the Web Push setting, and the configured public app URL.

## Result

Record one result line:

```text
PASS|FAIL — <date/time> — S25 Ultra <Android version> — Brave <version> — <host>/<tmux target> — notes: <none or issue links>
```
