---
lane: W5-GO-CONTRACTS
branch: refactor/wave5-go-contracts
frozen_sha: 0b47af1c9d9172c02ae14250d76d4cb8a92d3633
attempt: 1
gate:
  commands:
    - go build ./...
    - go vet ./...
    - go test ./...
  results:
    - command: go build ./...
      status: passed
      detail: All agentd packages built successfully from agents/agentd.
    - command: go vet ./...
      status: passed
      detail: Vet completed without findings across all agentd packages.
    - command: go test ./...
      status: passed
      detail: All agentd tests passed, including the complete production-type protocol fixture matrix.
assumptions:
  - Protocol additions remain wire-compatible because message names and payload shapes are unchanged; typed metadata fields are additive and arbitrary metadata is preserved losslessly.
  - GitHub tag releases are the source for install-agentd.sh, with GoReleaser publishing Linux amd64 and arm64 archives plus checksums.
  - The implementation commit is frozen separately from this handoff-only commit.
uncertainties:
  - actionlint and shellcheck were unavailable in the required PATH; workflow YAML parsed successfully, bash -n passed, and the GoReleaser v2 configuration and snapshot build both passed.
  - pnpm was unavailable in the required PATH, so the existing TypeScript fixture test was inspected but not run or expanded; it still names only the original seven shared fixtures, while Go now validates all 52 fixture files.
blockers: []
---

# Wave 5 GO-CONTRACTS handoff

## Summary

- Added production Go contracts for all 35 agent/control-plane wire message types and all 14 dispatched command payloads, including hierarchy-aware session identity and the Wave 4 terminal dimensions, resume, lag, and audit fields.
- Replaced agentd's ad hoc protocol maps and anonymous decode structs with the production contract types while preserving optional, null, and empty-string wire states.
- Expanded the shared fixture directory to 52 JSON messages and added semantic decode/encode round-trip coverage that rejects unregistered message types, missing command variants, and dropped fields.
- Made the agentd binary version build-stamped from one variable, added Go build/vet/test CI, and added GoReleaser v2 Linux amd64/arm64 archives with checksums.
- Added an atomic checksum-verifying systemd installer, corrected the service documentation URL, and documented the release changes in CHANGELOG.md.
- Additional verification passed for JSON fixture syntax, YAML parsing, bash syntax, ldflags version stamping, GoReleaser configuration validation, and a two-architecture GoReleaser snapshot build.

The `frozen_sha` is the final implementation commit; the following handoff-only commit adds this file.

W5-GO-CONTRACTS FROZEN 0b47af1c9d9172c02ae14250d76d4cb8a92d3633
