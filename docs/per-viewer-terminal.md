# Per-viewer Terminal

agentd isolates each browser viewer in a grouped tmux session while keeping all
viewers attached to the same source pane. This preserves independent terminal
sizes and reconnect state without allowing concurrent writers.

## Configuration

Per-viewer PTY mode is enabled by default. Keep it explicit in
`/etc/agentd/config.yaml`:

```yaml
terminal:
  per_viewer_pty: true
```

Set it to `false` only when compatibility requires the legacy shared PTY bridge,
then restart agentd.

## Control model

- The first viewer attached to a pane receives control.
- Additional viewers attach read-only and continue receiving output.
- A read-only viewer can select **Take Control**. The previous controller is
  immediately changed to read-only.
- Read-only input is rejected by both the dashboard and agentd.
- Attach, detach, and control-transfer actions are emitted as terminal audit events.

The dashboard requires an operator-capable identity to send input, resize, or
take control. A viewer-capable identity can observe a terminal without gaining
write access.

## Reconnects

Each attach returns a resume token. The dashboard includes it on reconnect so
agentd can restore a retained viewer bridge and scrollback after network,
visibility, or browser lifecycle interruptions. Deliberate detach and terminal
idle timeout clear the token. agentd sweeps viewer bridges that remain detached.

## Troubleshooting

- If a terminal says **Read-only**, another viewer currently controls that pane.
- If **Take Control** fails, check agentd logs and confirm the host reports terminal capability.
- Unexpected disconnects should reconnect automatically; a deliberate **Detach** does not.
- Use `terminal.per_viewer_pty: false` only to diagnose grouped-session compatibility, not as the normal multi-viewer setting.
