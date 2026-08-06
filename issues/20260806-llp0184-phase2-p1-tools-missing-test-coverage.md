# LLP 0184 Phase 2 P1 tools shipped without automated test coverage

**Status:** Open

LLP 0184 Phase 2's P1 slice ("read and diagnose" — `data.scan`,
`config.status`/`config.plan`/`config.verify`, `jobs.list`/`jobs.show`, and
MCP tools for the already-shipped `asset.list`/`asset.inspect`/`asset.retry`)
landed on `main` (`711e4d763`, folded into the combined Phase 2 P1+P2 push).
The implementing agent's own commit made zero changes to
`packages/snapback-cli/mcp-control.test.mjs` despite the commit message and
final report claiming the new tools were "manually exercised end-to-end
against a live local server" — that exercise, if it happened, left no
regression coverage behind.

By contrast, Phase 2's P2 slice (`config.unset`, `cron.tick`/`cron.runOne`,
`jobs.drain`, `connection.disconnect`, the `host.restart` credential gate)
landed alongside it with real coverage: 4 new `cargo test` CLI-parse tests
plus `mcp-control.test.mjs`'s existing acceptance suite exercises the P2 MCP
tools live, including a negative admin-credential test for `host.restart`.

**Why:** the coordinating session verified the P1 tools work by hand
(started a local `demos/todo-v2` server, confirmed `config status`,
`jobs list`, and the MCP tool registrations were real and correctly wired),
but did not itself write regression tests before landing, given the scope
of the concurrent Phase 2 merge-conflict resolution already in flight.

**How to apply:** add `cargo test` CLI-parse coverage for `snapback data
scan`/`config status`/`config plan`/`config verify`/`jobs list`/`jobs show`
(mirroring the P2 pattern already in `src/cli.rs`'s `cli::tests` module —
see `config_unset_cli_parses_entry_and_target`, `jobs_drain_cli_parses_*`),
and extend `packages/snapback-cli/mcp-control.test.mjs`'s live acceptance
suite to exercise `snapback_data_scan`, `snapback_config_status/plan/verify`,
`snapback_jobs_list/show`, and `snapback_asset_list/inspect/retry` the same
way it already exercises the P2 tools.
