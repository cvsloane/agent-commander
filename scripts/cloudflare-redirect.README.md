# Cloudflare redirect (www -> apex)

Use Cloudflare Redirect Rules to send `www.agentcommander.co/*` to `https://agentcommander.co/$1`.

Steps:
1. Cloudflare dashboard → Rules → Redirect Rules.
2. Create a rule:
   - If incoming requests match: `Hostname equals www.agentcommander.co`
   - Then: Static redirect → `https://agentcommander.co/$1`
   - Status code: 301

Alternatively, you can redirect at your web server if you prefer.
