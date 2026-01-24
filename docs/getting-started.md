# Getting Started

This guide gets a local development stack running.

## Prerequisites
- Node.js 20+
- pnpm 9+
- Go 1.22+ (for agentd)
- PostgreSQL 15+
- tmux

## 1) Install dependencies
```bash
pnpm install
```

## 2) Configure environment
Copy the example env files and edit values:

```bash
cp services/control-plane/.env.example services/control-plane/.env
cp apps/dashboard/.env.example apps/dashboard/.env
```

At minimum, set:
- `DATABASE_URL`
- `JWT_SECRET` (control plane)
- `CONTROL_PLANE_JWT_SECRET` (dashboard, must match `JWT_SECRET`)
- `NEXTAUTH_URL` and `NEXTAUTH_SECRET`

## 3) Initialize the database
```bash
pnpm db:migrate
```

## 4) Start the stack
Option A: run everything with Turbo
```bash
pnpm dev
```

Option B: run services individually
```bash
pnpm --filter @agent-command/control-plane dev
pnpm --filter @agent-command/dashboard dev
```

Visit `http://localhost:3000`.

## 5) Register a host (agentd)
Host creation is an admin action. The control plane expects a short lived JWT
minted by the dashboard. After signing into the dashboard, request a token from
`/api/control-plane-token` and use it as the `Authorization: Bearer` value.
Create a host + token (admin role required):

```bash
curl -X POST http://localhost:8080/v1/hosts \
  -H "Authorization: Bearer <control-plane-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"name":"devbox"}'
```

The response includes a host token (starts with `ac_agent_...`).

## 6) Install and run agentd
See [agentd](agentd.md) for full setup. The short version:

```bash
cd agents/agentd
go build -o agentd ./cmd/agentd
sudo cp agentd /usr/local/bin/

sudo mkdir -p /etc/agentd
sudo cp agents/agentd/config.example.yaml /etc/agentd/config.yaml
# edit /etc/agentd/config.yaml with your host id + token

sudo systemctl enable --now agentd
```

Once agentd connects, the host and tmux sessions appear in the dashboard.
