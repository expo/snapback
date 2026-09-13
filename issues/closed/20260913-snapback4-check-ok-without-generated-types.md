# Snapback 4: `check` reports ok when generated types were not written; `data` is silent on unknown tables

Status: Closed
Priority: P2
Date: 2026-09-13
Systems: CLI `check`, `types`, `data`
Author: Grok 4.6 (comprehensive review of origin/main `f9bf18f0e`)

## Problem and reproduction

`check` does `let _ = project.write_generated(&bound)` and discards I/O errors. Probe: `snapback/generated/api.ts` as a directory; `check` printed `check: ok` and exited 0. `snapback4 types` on the same tree failed with `cannot write generated types: Is a directory`. `dev` watch uses the same `let _ =`. Apps then typecheck against a missing or stale `api.ts` after a green check.

`Store::rows` returns `Ok(vec![])` when the name is not in the catalog. Probe: `snapback4 data nosuchtable` printed nothing and exited 0. A typo looks like an empty table. The verb also materializes every row before `--limit`.

## Implementation locations

- [snapback4/crates/snapback4/src/verbs.rs](../../snapback4/crates/snapback4/src/verbs.rs) (`check` ~96, `data` ~308)
- [snapback4/crates/snapback4/src/serve.rs](../../snapback4/crates/snapback4/src/serve.rs) (watch `write_generated`)
- [snapback4/crates/snapback4-core/src/store.rs](../../snapback4/crates/snapback4-core/src/store.rs) (`rows`)

## Suggestion

Surface the generated-write error and exit 2, same as `types`. If the table is not in the catalog, print `no table {name}; tables: …` and exit 1. Scan with LIMIT in SQL instead of loading the table.

## Resolution — 2026-09-13

`check` now reports a generated-type write error and exits 2 before printing
success. The dev watcher writes the generated projection before adopting the
new schema and keeps serving the prior generation when the write fails.
`data` parses `--limit` strictly, uses a bounded SQL query with one lookahead
row, and rejects an unknown catalog table instead of treating it as empty.

The CLI regression makes `snapback/generated/api.ts` a directory and verifies
that `check` exits 2, reports the write failure, and never prints `check: ok`.
It also verifies malformed `--limit` exits 2 and `data nosuchtable` exits 1
with `no table nosuchtable; tables: items`. The combined focused host run
passes all 18 reported tests.
