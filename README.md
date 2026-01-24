# Agent Commander

A centralized "mission control" dashboard for managing AI agent sessions (Claude Code, Codex) running in tmux across multiple machines on Tailscale.

## Architecture

```
                                    +------------------+
                                    |    Dashboard     |
                                    |   (Next.js)      |
                                    +--------+---------+
                                             |
                                    REST + WS (UI Stream)
                                             |
+------------------+              +----------+---------+              +------------------+
|   Dev Machine    |   Agent WS  |   Control Plane    |   Postgres   |    DB VPS        |
|   (agentd)       +------------>|   (Fastify)        +------------->|                  |
+--------+---------+              +--------------------+              +------------------+
         |
    tmux panes
    Claude hooks
    Codex exec
```

Detailed implementation notes live in `docs/implementation.md`.

## Project Structure

```
agent-commander/
  apps/
    dashboard/                    # Next.js 14 frontend
  services/
    control-plane/                # Node/TS Fastify WebSocket + REST
  agents/
    agentd/                       # Go daemon for tmux management
    hook-proxy/                   # Python script for Claude hooks
  packages/
    ac-schema/                    # Shared Zod schemas + TS types
  deploy/
    docker-compose.yml
    systemd/agentd.service
  migrations/
    001_init.sql
    002_events_indexes.sql
```

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Go 1.22+
- PostgreSQL 15+
- tmux

### Setup

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Setup database:**
   ```bash
   # Create database
   createdb agent_commander

   # Run migrations
   psql -d agent_commander -f migrations/001_init.sql
   psql -d agent_commander -f migrations/002_events_indexes.sql
   psql -d agent_commander -f migrations/003_host_seq.sql
   ```

3. **Configure environment:**
   ```bash
   # Control plane
   cp services/control-plane/.env.example services/control-plane/.env
   # Edit with your DATABASE_URL and JWT_SECRET (shared with dashboard CONTROL_PLANE_JWT_SECRET)

   # Dashboard
   cp apps/dashboard/.env.example apps/dashboard/.env
   # Edit with your NextAuth config and CONTROL_PLANE_JWT_SECRET
   ```

4. **Start development:**
   ```bash
   pnpm dev
   ```

### Building agentd

```bash
cd agents/agentd
go build -o agentd ./cmd/agentd
```

### Installing agentd

```bash
# Copy binary
sudo cp agents/agentd/agentd /usr/local/bin/

# Copy config
sudo mkdir -p /etc/agentd
sudo cp agents/agentd/config.example.yaml /etc/agentd/config.yaml
# Edit /etc/agentd/config.yaml with your settings

# Install systemd service
sudo cp deploy/systemd/agentd.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now agentd
```

### Registering a Host Token

Use the control plane API (admin role) to create a host and token:

```bash
curl -X POST http://localhost:8080/v1/hosts \\
  -H "Authorization: Bearer <control-plane-token>" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"devbox","tailscale_name":"devbox.tailnet-xyz.ts.net","tailscale_ip":"10.0.0.10"}'
```

Then place the returned token in `/etc/agentd/config.yaml` (or set `AGENTD_CONTROL_PLANE_TOKEN` to inject it via env/secrets).

### Setting up Claude Hooks

```bash
# Install hook proxy
sudo cp agents/hook-proxy/ac-claude-hook /usr/local/bin/
sudo chmod +x /usr/local/bin/ac-claude-hook

# Add hooks to Claude settings
# Copy content from agents/hook-proxy/claude-settings.example.json
# to ~/.claude/settings.json
```

The hook proxy now auto-detects Claude vs Codex based on the parent process,
but you can still override with `AC_PROVIDER=codex` or `AC_PROVIDER=claude`.

### Provider Usage (Quota/Remaining)

To surface provider-reported remaining quota on the dashboard, configure
usage commands in `/etc/agentd/config.yaml` (see `agents/agentd/config.example.yaml`):

```
providers:
  claude:
    usage_command: "claude /usage"
    usage_interval_ms: 300000
  codex:
    usage_command: "codex /status"
    usage_interval_ms: 300000
```

If your CLI returns JSON, set `usage_parse_json: true`. The output is stored
and displayed even if parsing fails.

Gemini CLI requires interactive auth, so instead of a headless usage command
you can have agentd send `/stats session` into authenticated Gemini panes:

```
providers:
  gemini:
    stats_command: "/stats session"
    stats_interval_ms: 300000
    stats_idle_ms: 15000
```

## Deployment

### Using Docker Compose (Coolify/Traefik)

```bash
cp deploy/.env.example deploy/.env
# Edit deploy/.env with your settings

docker compose --project-directory . -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

This compose file expects a reverse proxy (Coolify/Traefik) and an external Docker network named
`coolify`. If you're not using Coolify, run `pnpm dev` locally or adapt the compose file to your
proxy.

### Coolify (API-only)

Use a **Docker Compose** resource in Coolify and point it at `deploy/docker-compose.yml`. This
avoids the UI-only limits around custom Dockerfile paths and domain configuration.

Set `DOMAIN` and secrets in Coolify environment variables (or upload a `.env`) before deploy.

### On Tailscale

All services communicate over Tailscale. Expose the dashboard using:

```bash
tailscale serve --https=443 http://localhost:3000
```

## Features

- **Session Management**: View and control all Claude Code and Codex sessions
- **Real-time Updates**: WebSocket-based live updates for session status
- **Approval Queue**: Review and approve/deny permission requests
- **Console Streaming**: Live console output from tmux panes
- **Git Integration**: Automatic branch/repo detection per session
- **Multi-host Support**: Manage sessions across multiple machines
- **Auth/RBAC**: NextAuth GitHub login with role-based API access

## Session Status States

- `STARTING` - Session is initializing
- `RUNNING` - Agent is actively working
- `IDLE` - Agent is waiting at prompt
- `WAITING_FOR_INPUT` - Agent needs user input
- `WAITING_FOR_APPROVAL` - Permission request pending
- `ERROR` - An error occurred
- `DONE` - Session completed

## License

MIT
