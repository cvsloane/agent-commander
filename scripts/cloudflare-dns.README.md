# Cloudflare DNS helper

This script upserts A/AAAA records for Agent Commander subdomains.

## Docs-only (recommended)

```bash
CF_API_TOKEN=... \
CF_ZONE_ID=... \
CF_BASE_DOMAIN=agentcommander.co \
CF_TARGET_IP=203.0.113.10 \
CF_SUBDOMAINS=www,docs \
node scripts/cloudflare-dns.mjs
```

## Full stack

```bash
CF_API_TOKEN=... \
CF_ZONE_ID=... \
CF_BASE_DOMAIN=agentcommander.co \
CF_TARGET_IP=203.0.113.10 \
CF_SUBDOMAINS=app,api,docs,www \
node scripts/cloudflare-dns.mjs
```

Optional:
- `CF_TARGET_IPV6` - AAAA record
- `CF_PROXIED=true|false` (default true)
- `CF_INCLUDE_APEX=true|false` (default true)
