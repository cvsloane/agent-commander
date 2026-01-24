# Clawdbot Integration

Clawdbot delivers notifications to external channels like Telegram, Discord, Slack, WhatsApp, Signal, and iMessage.

## Configuration
Set these values in Settings:
- Base URL
- Token
- Channel
- Recipient (optional)

## Test Notifications
Use the dashboard test button or the API endpoint:
`POST /v1/notifications/test`

## Security
Treat tokens as secrets. Store them in a secret manager and rotate on exposure.
