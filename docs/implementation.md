# Implementation Notes (Advanced)

This document describes internal behavior for contributors and operators who want deeper context.

## Architecture summary

- Control plane (Fastify) exposes REST + WebSocket endpoints.
- Dashboard (Next.js) authenticates users and issues short lived JWTs.
- agentd (Go) discovers tmux panes, captures snapshots, streams console output, and executes commands.
- PostgreSQL stores sessions, events, approvals, and analytics.

## Authentication

- NextAuth handles dashboard login (GitHub OAuth or access code).
- The dashboard mints a control plane JWT via `/api/control-plane-token`.
- REST and UI WebSocket calls use the JWT in the Authorization header or query parameter.

## Agent reliability

agentd sends sequenced messages and persists its outbound queue to disk. On reconnect it resends unacked messages and resumes from the last acked sequence.

## Terminal streaming

The control plane exposes `/v1/ui/terminal/:sessionId`.
- agentd prefers PTY mode for full terminal semantics.
- FIFO mode is a fallback if PTY attach fails.
- Only one viewer has control; others are read only.

## Approvals

Approvals flow from provider hooks -> agentd -> control plane -> UI.
Decisions are sent back to agentd via `approvals.decision`.

## Commands

The dashboard dispatches commands to agentd:
- send input or keys
- interrupt or kill
- spawn, fork, copy
- capture pane

Command results are stored as events.

## Summary service

If `OPENAI_API_KEY` is set, the control plane can generate short summaries for orchestrator items and cache them by snapshot hash.
