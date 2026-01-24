# Agent Commander Implementation Notes

Date: January 16, 2026

This document describes the implemented changes, operational flow, and how the system now meets the PRD/spec. It also serves as a reference for the API/auth/WS behavior and agentd runtime behavior.

---

## 1) Architecture Overview (as implemented)

- **Control Plane** (Fastify): REST + WebSocket endpoints. Authenticated via JWT (shared secret with dashboard). Provides session registry, approvals, event storage, command dispatch, and real-time UI streaming.
- **Dashboard** (Next.js 14): NextAuth GitHub login + short-lived control-plane JWT issuance for WS/REST calls. Pages for sessions, approvals, hosts.
- **agentd** (Go): tmux poller, snapshot capture, console streaming (pipe-pane + tail), command execution, Claude hook receiver, Codex `exec --json` job runner. WS reliability via persisted outbound queue and ack/seq handling.
- **Shared schema** (`packages/ac-schema`): Zod schemas for all message types and DB/API types.
- **Postgres**: Core tables plus host ack tracking.

---

## 2) Authentication & Authorization

### 2.1 Dashboard login
- GitHub OAuth via NextAuth.
- Optional allowlist for login (ALLOWED_EMAILS).
- Role assignment via ADMIN_EMAILS (admin) or operator fallback.

### 2.2 Control Plane auth model
- REST endpoints require `Authorization: Bearer <control-plane-jwt>`.
- UI WS requires `?token=<control-plane-jwt>` query param.
- Token is minted by the dashboard via `/api/control-plane-token` and is **short-lived** (5 minutes).
- **Shared secret:** `CONTROL_PLANE_JWT_SECRET` (dashboard) == `JWT_SECRET` (control plane).

### 2.3 Role enforcement
- `admin`: host creation/token creation.
- `operator`: commands, approvals.
- `viewer`: read-only.

---

## 3) WebSocket Reliability (agentd → control plane)

### 3.1 Sequences and acks
- Every agentd message includes `seq`.
- Control plane acks via `agent.ack`.
- Control plane persists host `last_acked_seq`.
- agentd persists outbound queue + last acked seq in `/var/lib/agentd`.

### 3.2 Resend strategy
- On reconnect, agentd resends **all unacked messages in order**, then sends `agent.hello` with `resume.last_acked_seq`.

---

## 4) Approvals Round‑Trip (Claude Hooks)

### 4.1 Approval ID
- agentd generates a **stable approval_id** on PermissionRequest and includes it in the `approval.requested` event payload.
- Control plane uses that approval_id when creating the DB row.
- The same ID is returned to agentd on decision, allowing the hook waiter to be fulfilled.

### 4.2 Hook decision payload
- agentd returns Claude-compatible JSON including optional `updatedInput`.
- If the hook is blocked, the decision is returned to Claude.
- In `both` mode, agentd also sends keystrokes to tmux as fallback.

---

## 5) Command Handling (agentd)

Implemented commands:
- `send_input`
- `send_keys`
- `interrupt`
- `kill_session`
- `console.subscribe` / `console.unsubscribe`
- `adopt_pane`
- `rename_session`
- `spawn_session` (worktree + tmux window)
- `spawn_job` (Codex job runner)

Command results emit `commands.result`, which are persisted to `events` as `command.completed` (when session_id is present).

---

## 6) Console Streaming

- Streaming starts when dashboard sends `console.subscribe` with a `subscription_id`.
- agentd creates/opens `/var/lib/agentd/console/<pane_id>.log` and starts `tmux pipe-pane` to append output.
- agentd tails the file and sends `console.chunk` messages.
- On unsubscribe, agentd stops the tail **and stops pipe-pane** if no subscribers remain.

---

## 7) Session Discovery & Metadata

- agentd polls tmux for panes, keeps a session registry, and emits `sessions.upsert` with stable IDs.
- `@ac_session_id` is used when a session is adopted/spawned, to preserve ID across restarts.
- Git metadata resolution now uses a **TTL cache** to reduce git command load.

---

## 8) Codex Job Runner

- `spawn_job` runs `codex exec --json <prompt>` in the specified cwd.
- Each JSON line is forwarded as `events.append` with `event_type: "codex.event"`.
- Job session state updates to `RUNNING`, `DONE`, or `ERROR` based on event types and process exit.

---

## 9) Control Plane WS & UI Filters

- `sessions.changed` now includes full session rows (including host_id).
- UI WS supports filtering on:
  - sessions: `host_id`, `status`, `provider`, `needs_attention`, `q`
  - events: `session_id`
  - console: `subscription_id` or `session_id`
  - approvals: `status` (pending/decided)

---

## 10) Database / Migrations

### 10.1 New migration
- `003_host_seq.sql`: adds `hosts.last_acked_seq` for WS reliability.

### 10.2 Schema alignment
- Added optional `approval_id` in approval requested payload to correlate hook decisions.

---

## 11) Environment Variables

### Control Plane (`services/control-plane/.env`)
- `DATABASE_URL`
- `JWT_SECRET` (must equal dashboard `CONTROL_PLANE_JWT_SECRET`)
- `HOST` (default 0.0.0.0)
- `PORT` (default 8080)

### Dashboard (`apps/dashboard/.env`)
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`
- `NEXT_PUBLIC_CONTROL_PLANE_URL`
- `NEXT_PUBLIC_CONTROL_PLANE_WS_URL`
- `CONTROL_PLANE_JWT_SECRET` (must match control plane JWT_SECRET)
- Optional: `ADMIN_EMAILS`, `ALLOWED_EMAILS`

---

## 12) Operational Flow Summary

1) User logs into dashboard via GitHub OAuth.
2) Dashboard issues short‑lived control‑plane JWT.
3) REST + UI WS use that token for auth.
4) agentd connects with host token; control plane validates.
5) agentd sends sessions/snapshots/events; control plane persists + streams to UI.
6) Approvals are created from `approval.requested` events and decisions are sent back to agentd.

---

## 13) Files Changed (high level)

- `packages/ac-schema`: payload/host/session schema adjustments
- `migrations/003_host_seq.sql`: host ack seq
- `services/control-plane`: auth, RBAC, host creation, token hashing, ws filters, ack persistence
- `agents/agentd`: command coverage, ws queue/resend, hook approval fix, codex runner
- `apps/dashboard`: NextAuth + JWT token, WS subscription model, filters, console cleanup
- `deploy` and `.env.example`: env consistency + JWT secret alignment

---

## 14) Known Operational Requirements

- `codex` must be installed at `providers.codex.exec_path` on agent host.
- `tmux` is required on agent host.
- `git` required for worktree spawn and metadata.
- For host registration, admin role required.

---

## 15) Troubleshooting: No Sessions / tmux not discovered

If the host is online but no sessions appear:

- Validate tmux access as the **same user** running agentd:
  ```bash
  sudo -u <user> tmux list-panes -a
  ```
- If tmux uses a custom socket (`tmux -L <name>`), set:
  `tmux.socket: "/tmp/tmux-<uid>/<name>"` in `/etc/agentd/config.yaml`.
- If systemd hardening uses `PrivateTmp=true`, **disable it** or tmux sockets
  in `/tmp/tmux-<uid>` will be invisible to the service.
- Ensure `tmux.bin` points to the real tmux path (`which tmux`).
- Ensure `storage.state_dir` is writable by the service user (systemd `StateDirectory=agentd`
  ensures `/var/lib/agentd` is created with correct ownership).
- If sessions still don't appear, check the agent logs for `agent.ack` errors; malformed timestamps
  will be rejected by the control-plane. Agentd now emits UTC timestamps to avoid this.


---

## 16) Local Steps Executed in This Repo

- Created local env files:
  - `services/control-plane/.env`
  - `apps/dashboard/.env`
- Ran typecheck: `pnpm -w typecheck` (success)
- Built all packages: `pnpm -w build` (success)
- Attempted DB migrations: `pnpm -w db:migrate` (failed: local Postgres not running)

If you want migrations to succeed, start Postgres locally or update `DATABASE_URL` to a reachable server.

---

## 17) Coolify API-Only Deployment (no UI)

To avoid Coolify UI limitations (custom Dockerfile paths + domain config), the repo now supports a
**Docker Compose** deployment that encodes both in `deploy/docker-compose.yml`.

### 17.1 Compose file behavior
- Builds both services using the repo Dockerfiles:
  - `deploy/Dockerfile.control-plane.base`
  - `deploy/Dockerfile.dashboard.base`
- Routes traffic via Coolify/Traefik labels:
  - `https://$DOMAIN/v1/*` → control-plane
  - `https://$DOMAIN/*` → dashboard
  - `/health` is routed to the control-plane for external health checks.
- Requires an external Docker network named `coolify` (standard in Coolify).

### 17.2 Required env values
- `DOMAIN` (public hostname)
- `DATABASE_URL`
- `JWT_SECRET` (shared with dashboard `CONTROL_PLANE_JWT_SECRET`)
- `NEXTAUTH_URL` (typically `https://$DOMAIN`)
- `NEXTAUTH_SECRET`
- Optional: `ACCESS_SECRET`, `ADMIN_EMAILS`, `ALLOWED_EMAILS`, GitHub OAuth values

`NEXT_PUBLIC_CONTROL_PLANE_URL` and `NEXT_PUBLIC_CONTROL_PLANE_WS_URL` are **optional**. If unset,
the dashboard auto-resolves API + WS endpoints at runtime from the browser origin.

### 17.3 Coolify API usage
Create a **Docker Compose** resource via the Coolify API/CLI and point it at
`deploy/docker-compose.yml`. Then attach the environment variables from
`deploy/.env.example` (or upload a `.env` file) and deploy.
