# Provider Hooks

Agent Commander integrates with provider hooks to capture approval requests and context.

## Claude Code hook proxy

The hook proxy listens on localhost and forwards hook payloads to agentd.

Install:
```bash
sudo cp agents/hook-proxy/ac-claude-hook /usr/local/bin/
sudo chmod +x /usr/local/bin/ac-claude-hook
```

Configure Claude settings (example):
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "/usr/local/bin/ac-claude-hook" }
        ]
      }
    ]
  }
}
```

## Codex hook proxy

Install:
```bash
sudo cp agents/hook-proxy/ac-codex-hook /usr/local/bin/
sudo chmod +x /usr/local/bin/ac-codex-hook
```

## Configuration

Environment variables:
- `AC_AGENTD_URL` - base URL for agentd hooks (default `http://127.0.0.1:7777/v1/hooks`).
- `AC_TMUX_BIN` - tmux binary path.
- `AC_TMUX_SOCKET` - tmux socket if using `tmux -L`.

Agentd config includes provider specific options for permission strategies and usage polling.
