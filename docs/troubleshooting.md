# Troubleshooting

## No sessions appear

- Ensure tmux is running for the same user as agentd.
- If you use a custom tmux socket, set `tmux.socket`.
- Confirm agentd can reach the control plane WebSocket.

## Sessions show but console is blank

- Confirm `security.allow_console_stream` is true in agentd config.
- Check that the host is online.
- Verify the session has a `tmux_pane_id`.

## Approvals never arrive

- Ensure provider hooks are installed and pointing at agentd.
- Check agentd logs for hook errors.

## Control plane JWT errors

- `JWT_SECRET` must match dashboard `CONTROL_PLANE_JWT_SECRET`.
- The dashboard token is short lived. Refresh `/api/control-plane-token`.

## Search errors

- Run `migrations/006_search.sql` to create search indexes.

## Voice transcription not available

- Set `DEEPGRAM_API_KEY` in the control plane env.
