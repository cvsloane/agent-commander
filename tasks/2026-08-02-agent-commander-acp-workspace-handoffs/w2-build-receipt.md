# W2 Integrated Build Receipt

- Integrated production-code head: `0c2bba1`
- Frozen ACP implementation commit: `a8c43074e502f0122307ffaa693e36c7effcab5f`
- Builder handoff commit in ACP worktree: `eaa8e94b0238e44184ecde2b00df03f8eeab3a99`
- Local integration commits: `4dd7c2b` implementation, `ac03f5a` handoff, `0c2bba1` direct compile fix
- Production baseline: `b99a33cd202af2de69ac555d68a7e4a12fef0d9b`
- Production diff base for review: `3dccd71f92eb529b9286060f1ed5c2f2965a996c` (all approved pre-Builder control commits already present)

## Commands and results

1. ACP harness: `go -C agents/agentd build ./...` — exit 0, passed.
2. `pnpm --filter @agent-command/schema build` — exit 0, passed.
3. `pnpm --filter @agent-command/dashboard build` — exit 0, passed; Next.js reported dynamic route `ƒ /acp`.
4. First `pnpm --filter @agent-command/control-plane build` — exit 2 on strict undefined/tuple inference in `routes/acp.ts` fleet fallback aggregation.
5. Direct scoped correction in `services/control-plane/src/routes/acp.ts`: typed fallback helpers and identity-set comparison; no new behavior or abstraction outside that caller.
6. Second `pnpm --filter @agent-command/control-plane build` — exit 0, passed.
7. `git diff --check` on the ACP base-to-head candidate and integrated correction — passed.

No test command, suite, install, migration, service, deployment, credential operation, live ACP action, or production mutation was run.

Node emitted the existing environment warning that the repo wants Node >=22 while this checkout currently uses Node 20.19.5. All three production builds nevertheless completed; treat the version warning as environment evidence, not a passing proof of the later production image.
