# Sessions perf traces

This Playwright spec records traces to help diagnose the /sessions CPU/memory spike.

## Requirements
- `PLAYWRIGHT_BASE_URL` (optional, defaults to app baseURL in config)
- `PLAYWRIGHT_ACCESS_CODE` for credentials login (required unless you pass a storage state)
- Optional: `PLAYWRIGHT_SESSION_NAME` to click a specific session card by name

## Run
```
PLAYWRIGHT_BASE_URL="https://agentcommander.example" \
PLAYWRIGHT_ACCESS_CODE="<access-code>" \
pnpm exec playwright test scripts/perf/sessions-spike.spec.ts
```

Additional scenarios:
```
PLAYWRIGHT_BASE_URL="https://agentcommander.example" \
PLAYWRIGHT_ACCESS_CODE="<access-code>" \
pnpm exec playwright test scripts/perf/sessions-debug.spec.ts
```

Artifacts:
- traces: `artifacts/sessions-trace-*.zip`
- perf logs: `artifacts/sessions-perf-*.json`

Traces will be saved to `artifacts/sessions-perf-*.zip`.

You can also pass `PLAYWRIGHT_STORAGE_STATE` to reuse an authenticated session:
```
PLAYWRIGHT_STORAGE_STATE=playwright.storage.json \
pnpm exec playwright test scripts/perf/sessions-spike.spec.ts
```
