# PWA and Web Push

The dashboard includes a web app manifest, install icons, an offline fallback,
and a service worker. The worker is registered automatically on HTTPS origins
and on `localhost`/`127.0.0.1` during development.

## Enable server push

1. Apply database migrations, including `036_push_subscriptions.sql`:

   ```bash
   pnpm db:migrate
   ```

2. Generate one VAPID key pair:

   ```bash
   pnpm --filter @agent-command/control-plane exec web-push generate-vapid-keys
   ```

3. Set these variables on the control-plane service:

   ```dotenv
   VAPID_PUBLIC_KEY=<public-key>
   VAPID_PRIVATE_KEY=<private-key>
   VAPID_SUBJECT=mailto:admin@example.com
   APP_BASE_URL=https://app.example.com
   ```

   All three VAPID values are required. `APP_BASE_URL` is the public dashboard
   origin used to build same-origin notification deep links.

4. Restart the control plane and dashboard, sign in, then enable Web Push from
   dashboard settings. Browser permission is granted per device and per origin.

## Install the PWA

Open the HTTPS dashboard in a supported browser and use its install/add-to-home
screen action. The installed app and a normal browser tab share the same
server-side subscription record for that browser profile.

## What is delivered

Web Push covers actionable attention such as approvals, waiting input, blocked
or failed automation runs, governance decisions, and host-offline events. A
notification click focuses an existing dashboard window when possible and
otherwise opens its same-origin deep link.

## Troubleshooting

- "Not configured" means one or more VAPID variables are missing on the control plane.
- Permission denied must be reversed in browser/site settings before retrying.
- Service workers require HTTPS outside local development.
- A stale or expired browser endpoint is pruned after the push service returns `404` or `410`.
- Confirm `APP_BASE_URL` matches the public dashboard origin if notification links open the wrong host.
