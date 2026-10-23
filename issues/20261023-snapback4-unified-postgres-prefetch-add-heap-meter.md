# Common Engine heap metering observes spare capacity in supplied IDs

Status: Open
Date: 2026-10-23
Scope: Snapback 4, S10e-1 overlap
Related: LLP 3000.009.001.000 §3.4

The common `Engine` charges different logical `heap_bytes` for the same
caller-supplied ID depending on its retained Rust String capacity. The
prefetch-on/off harness first exposed this through its clone-versus-move pair. The existing C1 regression must remain exact;
S10e-1 does not normalize the meters, change its bound or mark it unsupported.

First observed by the migrated
`prefetch_complete_fixture_queries_mutations_and_hidden_rows` fixture in
`experiments/postgres/tests/conformance/prefetch.rs`, using private PostgreSQL
16. With `fixture(32, 3)`, run the fixture's reads, then `add` as alice in room
r000, title `alice-false`, amount 2, fail false, supplied id `new-alice-false`.
The complete mutation outcomes match except logical heap: prefetch on 1,969 B,
off 1,979 B. Both commit sequence 2, write two rows, disclose two events and
charge examined=1, index_entries=3, rule_probes=3, steps=27, output_bytes=153.

A reduced fixture is retained as `unified_add_spare_capacity_meter_overlap_regression`.
Run against an owned private cluster with:

```
cargo test --manifest-path experiments/postgres/Cargo.toml \
  --test conformance unified_add_spare_capacity_meter_overlap_regression \
  -- --include-ignored --nocapture
```

The reduced case uses `fixture(1, 1)`, title `new`, and a supplied ID built with
`format!("new-{viewer}-{fail}")`, where viewer is alice and fail is false.
Its ID is 15 bytes with capacity 20. The existing comparison helper clones the
context for the first executor and moves it into the second; `String::clone`
reduces that capacity to 15. Even with **prefetch enabled on both engines**,
the outcomes match except heap: 1,929 versus 1,939 B. Supplied-ID allocation
capacity reaches logical retained-image charging twice. A literal ID, with
capacity equal to its length, does not reproduce this. The old evaluator clones
the context for `mutate_once`, which hides this asymmetry; common Engine moves
the context into its member. This is not a prefetch result or call-count bug.

S10e-1 initially left the original fixture and the reduced exact assertion red.
Fix round 1 uses the lead's explicit fallback: both fixtures carry
`#[ignore = "issues/20261023-snapback4-unified-postgres-prefetch-add-heap-meter.md"]`.
The private runner excludes those two names from its `--include-ignored`
cluster sweep; the reproduction command above still runs the exact assertion.
It does not clone both inputs, strip the meter or expand a bound to manufacture parity.
Close only when logical metering has an explicit allocation-independent contract
for equal public inputs and the original/reduced probes agree, including cuts
on either side of the changed charge. S10e-2 deletion remains gated on disposition.

The charge is `Value::retained_heap` in `snapback4-core/src/value.rs`: both
String and Id use `capacity()`. `Runner::expression_heap` forwards that price
into retained row/environment charging on SQLite, common Postgres and the old
evaluator. It also recursively prices map keys and retained containers.
Replacing the shared String charge with `len()` is not a local C1 repair:
SQLite's `spare_capacity_strings_price_tight_copies_and_full_retention` pins
256 bytes for a String/Id of length 0, 3 or 100, and
`owned_nested_lists_price_recursive_copies_and_retained_capacity` pins a
128-byte String allocation. The changed charge would alter those existing
SQLite assertions and potentially cut positions across the interpreter.
The fix round preserves all meter code and baselines, pending a scoped meter
decision under LLP 3000.007 §20.24.5. Both RT0 tables remain unchanged.
