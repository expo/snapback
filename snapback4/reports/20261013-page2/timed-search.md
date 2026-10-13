# PAGE2 timed-search coverage addendum

Commit: `476c7e4fca` (`Exercise timed nonuniform search discovery`)
Runtime dependency: `829bc19b2a`

Coverage:
- Native generated dimension composes `not before`, an online non-uniform words search, a future physical word head, and two readable live siblings sharing the same word. Seeds 0..399 reach it (first seed 8).
- `timed-search-future-absence` removes future rows and compares exact outcome records page by page, including data, refusal envelope, meter, completion, and continuation. The online plan returns both live siblings in one page and withholds a cursor in both worlds.
- Lean explicitly excludes these cases with `index-computed-or-words`; no false model case was added.
- Simulator covers the online non-uniform path and the synced compact-membership search path. The membership case returns `b-live`, then `c-live` through a real continuation despite an earlier future same-word head.
- Device-store coverage runs both paired paths over Memory and SQLite physical stores.

Verification (all Cargo commands used `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0`):
- `cargo test -p snapback4-difftest --test smoke`: 16/16.
- `cargo test -p snapback4-sim --test timed_search`: 2/2.
- `cargo test -p snapback4-device --test timed_search`: 2/2 (Memory and SQLite).
- `node scripts/check-inventories.mjs`: reached guide-manifest and failed only fresh-tree prerequisites already named by the script (missing generated demo/Contract artifacts and missing TypeScript/Ajv packages); no inventory mismatch from the added test files.

Earlier report correction:
- `/tmp/PAGE2-planner-report.md` now correctly names `cargo test -p snapback4-lang --test branch_merge` (57/57), SHA256 `1ba0e5901e6c61dc1fec35c30ed65c0bcb15d185889069902884f217f291f04e`.
