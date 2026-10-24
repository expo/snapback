# Snapback 4 commit-path experiment no longer compiles against closed raw store access

**Status:** Open
**Opened:** 2026-10-24
**Area:** `snapback4/experiments/postgres-commit-path` (SQLite arms)

`a8751ce5ad` ("snapback4: close raw store access and share inspection
policy") made `AnyStore::conn` private. The experiment's SQLite arms still
call it (`src/sqlite.rs` ~23/30/102/183, `src/sqlite_optimistic.rs`
~28/29/88/161/164), so `cargo check --bins` in the experiment fails with
E0624/E0599. Postgres-only measurement code (M-suite, G3b, M1) is
unaffected in source but cannot build while the crate fails.

Fix: give the experiment a narrow test/experiment accessor (feature-gated)
or move the SQLite arms onto the public inspection policy.
