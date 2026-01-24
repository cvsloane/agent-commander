# Deployment

## Docker Compose
```bash
cp deploy/.env.example deploy/.env
# Edit deploy/.env

docker compose --project-directory . -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

## Tailscale
For tailnet-only deployments, restrict access to tailnet IP ranges and consider `ACCESS_SECRET` for dashboard login.
