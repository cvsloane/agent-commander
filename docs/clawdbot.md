# OpenClaw Integration

OpenClaw delivers notifications to external channels like Telegram, Discord, Slack, WhatsApp, Signal, and iMessage.

Note: the underlying config keys and some internal code paths still use the legacy `clawdbot` name for backwards compatibility.

## Configuration

Set these values in Settings:
- Base URL
- Token
- Channel
- Recipient (optional)

You can also configure per event and per provider filters from the Alerts section.

## Test notifications

Use the dashboard test button or the API endpoint:
`POST /v1/notifications/test`

## Security

Treat tokens as secrets. Store them in a secret manager and rotate on exposure.
