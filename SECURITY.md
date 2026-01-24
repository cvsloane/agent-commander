# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Agent Commander:

1. **Do not** open a public GitHub issue.
2. Use GitHub's private vulnerability reporting feature **or** email security@agentcommander.example.
3. Include details:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if known)

## Response Timeline

- We aim to acknowledge reports within 48 hours
- Initial assessment within 7 days
- Remediation timeline shared after triage

## Deployment Security Best Practices

- Always set strong `JWT_SECRET` and `NEXTAUTH_SECRET` values
- Use HTTPS in production
- Restrict dashboard access to trusted networks when possible
- Store secrets in environment variables or a secret manager
- Rotate credentials if exposure is suspected

## Supported Versions

| Version | Supported |
| --- | --- |
| Latest | ✅ |
