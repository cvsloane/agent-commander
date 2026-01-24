# Contributing to Agent Commander

Thanks for your interest in contributing! This guide covers reporting issues, suggesting features, and submitting code changes.

## Reporting Bugs

Before opening an issue, please check existing issues. Include:
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Node.js, Go, browser)
- Logs or screenshots (redact secrets)

## Feature Requests

Describe the use case and proposed solution. Examples and mockups help.

## Development Setup

```bash
git clone https://github.com/cvsloane/agent-commander.git
cd agent-commander
pnpm install
pnpm dev
```

Run checks:

```bash
pnpm lint
pnpm typecheck
pnpm build
```

Agent daemon tests:

```bash
cd agents/agentd
go test ./...
```

## Pull Requests

1. Fork the repo
2. Create a feature branch
3. Make changes and add tests/docs as needed
4. Run checks
5. Open a PR with a clear summary

## License

By contributing, you agree your contributions will be licensed under the MIT License.
