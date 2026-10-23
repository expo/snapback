# Unified Postgres prefetch changes the logical heap charge of `add`

Status: Open
Date: 2026-10-23
Scope: Snapback 4, S10e-1 overlap
Related: LLP 3000.009.001.000 §3.4

The common `Engine` over Postgres charges different logical `heap_bytes` with
prefetch enabled and disabled. The existing C1 regression must remain exact;
S10e-1 does not normalize the meters, change its bound or mark it unsupported.

First observed by the migrated
`prefetch_complete_fixture_queries_mutations_and_hidden_rows` fixture in
`experiments/postgres/tests/conformance/prefetch.rs`, using private PostgreSQL
16. With `fixture(32, 3)`, run the fixture's reads, then `add` as alice in room
r000, title `alice-false`, amount 2, fail false, supplied id `new-alice-false`.
The complete mutation outcomes match except logical heap: prefetch on 1,969 B,
off 1,979 B. Both commit sequence 2, write two rows, disclose two events and
charge examined=1, index_entries=3, rule_probes=3, steps=27, output_bytes=153.

A reduced fixture is retained as `unified_add_prefetch_meter_overlap_regression`.
Run against an owned private cluster with:

```
cargo test --manifest-path experiments/postgres/Cargo.toml \
  --test conformance unified_add_prefetch_meter_overlap_regression \
  -- --include-ignored --nocapture
```

The divergence is at the physical prefetch/materialization to logical Runner
accounting boundary. The exact causal site is still under investigation; this
record does not claim a root-cause fix. Preserve the original fixture and the
reduced witness. Close only when complete outcomes and each meter agree on
SQLite, unified Postgres and both prefetch settings, including cuts on either
side of the changed charge. S10e-2 executor deletion remains gated on disposition.
