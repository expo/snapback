# LLP 0184 Phase 2 P1 tools shipped without automated test coverage

**Status:** Closed

LLP 0184 Phase 2's P1 slice ("read and diagnose" — `data.scan`,
`config.status`/`config.plan`/`config.verify`, `jobs.list`/`jobs.show`, and
MCP tools for the already-shipped `asset.list`/`asset.inspect`/`asset.retry`)
landed without retained regression coverage.

## Resolution (2026-08-06)

`src/cli.rs` now has clap parse coverage for `snapback data scan`, all three
non-secret config verbs, and `snapback jobs list|show`, alongside the existing
Phase 2 P2 parse matrix. `packages/snapback-cli/mcp-control.test.mjs` now calls
all nine P1 MCP tools against its real temporary Snapback server: scan/status/
plan/list calls prove success paths, while deliberately unknown config, job,
and asset identities prove the ordinary structured-refusal paths.

The retained live acceptance therefore covers the projections the original
landing report had exercised only by hand.
