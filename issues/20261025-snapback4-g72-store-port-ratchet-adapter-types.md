# Snapback 4 G7.2 adapter types trip the zero-production-access store-port ratchet

**Status:** Open
**Opened:** 2026-10-25
**Area:** `snapback4/crates/snapback4/tests/store_port_ratchet.rs`; `engine/program_batch.rs`; `engine/program_pipeline.rs`
**Related:** LLP 3000.009.001.000 §3.2; `issues/20261024-snapback4-g6-followups.md` item 5's Integration 25 resolution

The LEV rebase onto fetched main `20a45b73cb` passes the requested core and
binary scopes, but an additional port-census check reports production access:

```text
{"crates/snapback4-core/src/engine/program_batch.rs": 1,
 "crates/snapback4-core/src/engine/program_pipeline.rs": 4}
```

Reproduce from `snapback4/` with:

```sh
cargo test --locked -p snapback4 -j 24 --test store_port_ratchet
```

The integration target reports 7 passed / 1 failed. A focused baseline snapshot
uses the exact main scanner, token helper, allowlists and the two reported
source files from `20a45b73cb`; compiling that scanner with `rustc --test`
and running its exact `store_port_ratchet` test produces the identical five
sites (0 passed / 1 failed). LEV introduces none of those adapter paths.
Raw lane logs and the focused baseline fixture are under `/tmp/lrb.hXRhtj/`.

Review G7.2's internal adapter paths, including `writer_slot::Suspended`,
`writer_slot::Hook`, `group_commit::Head` and the grouped read-grant import.
The scanner's exact neutral-type handling from Integration 25 predates these
spellings. Resolve the lexical classifications with negative controls, or move
any actual database access below the port. Keep the production allowance empty;
do not normalize the failure by raising its counts or excluding the whole
pipeline module. The existing G6 item 5 describes different, already-resolved
sites in `command.rs` and `revision_cache.rs`.
