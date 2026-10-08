# device-memory--steps-metered-heap-bytes--loading

Oracle: server (engine on SQLite) against the memory device store, phase `steps`, ceiling 6.
Seed 50025; shrunk in 68 attempts.
Replay: `cargo run --release -p snapback4-difftest -- replay crates/snapback4-difftest/cases/found/device-memory--steps-metered-heap-bytes--loading`

Shrunk outcome (server, then device):

```json
{"complete": false, "cut": "meter", "loading": true, "metered": {"examined": 1, "heap_bytes": 10962, "index_entries": 0, "output_bytes": 6, "rows_written": 0, "rule_probes": 0, "steps": 7}}
{"complete": false, "cut": "meter", "loading": true, "metered": {"examined": 1, "heap_bytes": 2616, "index_entries": 0, "output_bytes": 6, "rows_written": 0, "rule_probes": 0, "steps": 7}}
```

Both cut on the same step; the heap charged up to that step differs (the server has paid the SQLite column scratch, the device has not).

**Mechanism B: the memory store prices a scan differently from SQLite.**
`crates/snapback4-device/src/memory.rs::scan_metered` charges the
`word_heap` sizes of the range, the key and each stored row. The SQLite store
(`crates/snapback4-core/src/store.rs::scan_metered`, used by the server and by
the native device) also charges a once-per-read column scratch of
`2 × page_size` (`meter.once(HeapSite::SqliteColumns, …)`, 8,192 bytes at the
default page size) and, per row, two payload copies plus allocation headers.
Those are physical SQLite-scratch estimates. A memory device therefore
completes reads that SQLite cuts, and cuts at different charges.

**Diagnosis: engine defect, already ruled.** This is the device half of
`issues/20261007-snapback4-heap-accounting-differs-between-sqlite-and-postgres.md`
(Charlie's 2026-10-08 ruling: charge `heap_bytes` from the encoded size of held
values and rows, identically on every store and on the device; guard real
memory separately with its own code). The fix must cover both mechanisms. The
signature is a known disagreement, never normalized into a pass; replay exits 1
while it reproduces.
