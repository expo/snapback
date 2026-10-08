# device-sqlite--write-predicted-refused--admitted

Oracle: server (engine on SQLite) against the sqlite device store, phase `write`, ceiling 0.
Seed 38185; shrunk in 87 attempts.
Replay: `cargo run --release -p snapback4-difftest -- replay crates/snapback4-difftest/cases/found/device-sqlite--write-predicted-refused--admitted`

Shrunk outcome (server, then device):

```json
{"metered": {"examined": 0, "heap_bytes": 1468, "index_entries": 0, "output_bytes": 0, "rows_written": 0, "rule_probes": 0, "steps": 12}}
{"ok": {"args": {"a": 0, "b": 0, "bucket": 0, "c": null, "key": "r0", "n": null}, "id": "w1", "new_ids": [], "now": 83301, "observed_seq": null, "op": "run", "predictable": true, "predicted": ["items/r0"], "sent_seq": null, "seq": 1, "viewer": "bob"}}
```

**Diagnosis: device defect or underspecified point (prediction
eligibility).** The device predicts an insert whose caller-supplied id belongs
to a row outside its partition (`sync to .owner`; the conflicting row is
another owner's). The server refuses `E_RULE` (a unique key holds a row the
viewer cannot read). Convergence holds: after `settle` and a sync round the
device withdraws the row and agrees with the server (LLP 3000 §6 invariant 4).
An `upsert` proves its insert arm's absence on a device
(`engine/write.rs::insert_attempt` → `prove_upsert_insert`); a plain `insert`
does not, while an update or delete of an unheld target queues with
`E_PREDICT` (`write_target.rs::write_miss`). Ticket:
`issues/20261008-snapback4-device-predicts-insert-over-an-unheld-id.md`.
