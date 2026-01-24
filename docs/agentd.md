# agentd

`agentd` runs on each host. It discovers tmux panes, captures snapshots, streams terminal output, and executes commands sent from the control plane.

## Install
```bash
cd agents/agentd
go build -o agentd ./cmd/agentd
sudo cp agentd /usr/local/bin/
```

## Configure
Copy and edit the example config:

```bash
sudo mkdir -p /etc/agentd
sudo cp agents/agentd/config.example.yaml /etc/agentd/config.yaml
```

### Required fields

- `host.id` - UUID for the host.
- `host.name` - a friendly name displayed in the UI.
- `control_plane.ws_url` - WebSocket endpoint (example: `wss://agentcommander.example/v1/agent/connect`).
- `control_plane.token` - host token created by the control plane.

### tmux integration

- `tmux.bin` - path to tmux.
- `tmux.socket` - optional tmux socket if you use `tmux -L`.
- `tmux.poll_interval_ms` - session discovery interval.
- `tmux.snapshot_lines` - how many lines to capture for snapshots.
- `tmux.option_session_id` - tmux option for stable session IDs.

When tmux metadata includes a session name, agentd can auto group sessions in the UI.

### Spawn settings

- `spawn.tmux_session_name` - default tmux session for spawned panes.
- `spawn.default_shell` - shell used for new panes.
- `spawn.worktrees_root` - optional worktree root for multi session templates.

### Security flags

- `security.allow_send_input`
- `security.allow_kill`
- `security.allow_spawn`
- `security.allow_console_stream`

Disable these if you want read only mode on a host.

### Providers

agentd can handle provider specific hooks and usage parsing.
See [Provider Hooks](hooks.md) for setup details.

### Storage

- `storage.state_dir` - local state + outbound queue.
- `storage.outbound_queue_max` - max queued messages before backpressure.

## Run (systemd)

```bash
sudo cp deploy/systemd/agentd.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now agentd
```

## Troubleshooting

- No sessions: verify tmux access with the same user running agentd.
- Custom tmux socket: set `tmux.socket` correctly.
- Permissions: ensure `storage.state_dir` is writable by the service user.
