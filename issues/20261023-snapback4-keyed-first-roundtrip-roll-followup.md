# Snapback 4 keyed-first SQLite round-trip ratchet is one over after ROLL integration

Status: Open
Owner: Integration 23 / ROLL metrology follow-up
Discovered: 2026-10-23

DX8 imported finished ROLL commit cd20d7ebc9 through merge a2249ef8a6. The affected SQLite measurement is reproducibly `keyed_first=88` warm and cold against the ratcheted maximum87. Other measured classes retain their accepted maxima. No budget was raised. This failure is separate from the predecessor/source-reservation baseline tickets.

Evidence: `~/sb4-loop/dx8-roundtrip-sqlite.log`; command from `snapback4/`: `timeout 600s env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo test -p snapback4 --bin snapback4 serve::tests::round_trip_tests::round_trips_sqlite -- --exact --nocapture`.

Investigate the new extraction write observer metadata-existence query in `store::Tx::put_indexed` / `store/extractions.rs::observe_write`, which runs even for schemas without extraction declarations. This is a source-based hypothesis, not a traced SQL attribution or an independently reproduced baseline. Preserve ROLL captured-lifetime behavior and LLP3000.009.001.000.001 §5's ratchet; remove dependent work instead of changing87 to88 without an author decision.

DX8 leaves rollback-view selection and release bridges to Integration23. Its same-type rename change is isolated in backfills.rs.

Fresh integrated main46c6cdd056 (DX8 source a3f7c4becf) still reproduces: full
server unit target544 passed,1 failed (this ratchet),9 ignored. Evidence:
`~/sb4-loop/dx8-integrated-server-tests.log`. `git blame` assigns the extra
write-observer call and its existence preflight to ROLL commit b7ca76be3d1,
“Register guarded rollback views and declarative child extraction”; that commit
is not an ancestor of finished DX7. This establishes source provenance, not
a traced attribution of the measured SQL dependency.
