# Architecture

Agent Commander consists of:
- **Dashboard** (Next.js)
- **Control Plane** (Fastify)
- **agentd** (Go)
- **PostgreSQL** (persistence)

```
Dashboard (Next.js)  <---- REST + WS ---->  Control Plane (Fastify)  <---->  Postgres
        ^                                         ^
        |                                         |
        |                                         |
        +---- WebSocket (agent) ---- agentd (tmux + hooks)
```
