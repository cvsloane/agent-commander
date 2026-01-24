# Alerts and Notifications

Agent Commander supports multiple alert channels with per event and per provider filters.

## Channels

- Browser notifications
- Audio alerts
- In app toasts
- Clawdbot push notifications (Telegram, Slack, Discord, WhatsApp, etc.)

Each channel can be enabled independently and configured to trigger only when the app is unfocused.

## Alert events

Events are grouped by intent, not by raw event names:
- `approvals` - new approval requests
- `waiting_input` - sessions waiting for user input
- `waiting_approval` - sessions waiting for approval
- `error` - session errors
- `snapshot_action` - snapshot captures that include explicit action markers
- `usage_thresholds` - provider usage crosses thresholds
- `approval_decisions` - approvals are granted or denied

## Provider filters

You can filter alerts per provider:
- claude_code
- codex
- gemini_cli
- opencode
- cursor
- aider
- continue
- shell
- unknown

## Usage thresholds

Thresholds are per provider and default to 50, 75, 90, 100 percent. Use the settings panel to customize.

## Clawdbot

Clawdbot is a lightweight relay that sends notifications to chat tools. Configure in Settings:
- Base URL
- Token
- Channel
- Recipient (optional)

Use the test button or call `POST /v1/notifications/test` to validate.
