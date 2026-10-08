# device-sqlite--steps-metered-heap-bytes--loading

Oracle: server (engine on SQLite) against the sqlite device store, phase `steps`, ceiling 7.
Seed 23; shrunk in 79 attempts.
Replay: `cargo run --release -p snapback4-difftest -- replay crates/snapback4-difftest/cases/found/device-sqlite--steps-metered-heap-bytes--loading`

Shrunk outcome (server, then device):

```json
{"complete": false, "cut": "meter", "loading": true, "metered": {"examined": 1, "heap_bytes": 11257, "index_entries": 0, "output_bytes": 6, "rows_written": 0, "rule_probes": 0, "steps": 8}}
{"complete": false, "cut": "meter", "loading": true, "metered": {"examined": 1, "heap_bytes": 2391, "index_entries": 0, "output_bytes": 6, "rows_written": 0, "rule_probes": 0, "steps": 8}}
```

Both cut on the same step; the heap charged up to that step differs (the server has paid the SQLite column scratch, the device has not).

**Mechanism A: the device interpreter's per-candidate reservation.** In
`crates/snapback4-core/src/engine/authorized_point.rs::scan_authorized`, a
trusted read takes the store's `scan_metered` fast path only when
`!self.device || table.rules.read.is_uniformly_readable()`. On a device, a table
whose read rule is not uniformly readable (here `.owner = viewer`) takes the
per-candidate path instead: each candidate is fetched inside
`Runner::reserved_scratch` (`engine/authorized_scan.rs`), which charges
`disclosed::decode_reservation(table) + rule_scratch` (a schema-sized worst-case
decoder allowance: 4,096 + 4 × the maximum index key + 256 + 16 × name length +
the column's maximum size per column, about 18–20 KB for the generated table)
and releases it afterwards (`Meter::release_row_heap`). The server charges the
same read through `Store::scan_metered`. The final `metered.heap_bytes`
agrees at the default ceilings (the reservation is released), but the
transient peak decides cuts, and it is not in the public meter. This happens
on **both** device stores, because the path is chosen by the interpreter, not
by the store.

**Diagnosis: engine defect, already ruled.** This is the device half of
`issues/20261007-snapback4-heap-accounting-differs-between-sqlite-and-postgres.md`
(Charlie's 2026-10-08 ruling: charge `heap_bytes` from the encoded size of held
values and rows, identically on every store and on the device; guard real
memory separately with its own code). The fix must cover both mechanisms. The
signature is a known disagreement, never normalized into a pass; replay exits 1
while it reproduces.
