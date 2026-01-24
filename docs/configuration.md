# Configuration

Agent Commander uses environment variables for the control plane and dashboard.

## Control Plane
See `services/control-plane/.env.example` for required values.

Key variables:
- `DATABASE_URL`
- `JWT_SECRET` (shared with dashboard)

## Dashboard
See `apps/dashboard/.env.example` for required values.

Key variables:
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `CONTROL_PLANE_JWT_SECRET`

## Docker Deployments
See `deploy/.env.example` for deployment-specific configuration.
