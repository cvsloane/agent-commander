# Getting Started

## Prerequisites
- Node.js 20+
- pnpm 9+
- Go 1.22+ (for agentd)
- PostgreSQL 15+
- tmux

## Install
```bash
pnpm install
```

## Configure
Copy the example env files and update values:

```bash
cp services/control-plane/.env.example services/control-plane/.env
cp apps/dashboard/.env.example apps/dashboard/.env
```

## Run
```bash
pnpm dev
```

## Build
```bash
pnpm build
```
