# device-memory--write-predicted-refused--admitted

Oracle: server (engine on SQLite) against the memory device store, phase `write`, ceiling 0.
Seed 38185; shrunk in 87 attempts.
Replay: `cargo run --release -p snapback4-difftest -- replay crates/snapback4-difftest/cases/found/device-memory--write-predicted-refused--admitted`

Shrunk outcome (server, then device):

```json
{"metered": {"examined": 0, "heap_bytes": 1468, "index_entries": 0, "output_bytes": 0, "rows_written": 0, "rule_probes": 0, "steps": 12}}
{"ok": {"args": {"a": 0, "b": 0, "bucket": 0, "c": null, "key": "r0", "n": null}, "id": "w1", "new_ids": [], "now": 83301, "observed_seq": null, "op": "run", "predictable": true, "predicted": ["items/r0"], "sent_seq": null, "seq": 1, "viewer": "bob"}}
```

**Diagnosis: ruled behaviour, retained as a regression case.** The device
predicts an insert whose caller-supplied id belongs to a row outside its
partition (`sync to .owner`; the conflicting row is another owner's). The
server refuses `E_RULE` (a unique key holds a row the viewer cannot read).
Settling the refusal withdraws the pending row, and after a sync round the
device agrees with the server (LLP 3000 §6 invariant 4).

Charlie ruled on 2026-10-08 to keep predicting supplied-id inserts and to
document that such a prediction can end in this typed refusal (guide
`prediction`, Refusals; `contract.ts` `Write`). The oracle classifies exactly
this shape as the named outcome `predicted-then-refused-unheld-id`
(`device_writes.rs::refused_over_unheld_id`, and only when convergence
passes): never a pass, never a disagreement. This case now replays as
`named: predicted-then-refused-unheld-id` (exit 0); a disagreement here means
the exception's condition or the device's behaviour changed. Ticket:
`issues/closed/20261008-snapback4-device-predicts-insert-over-an-unheld-id.md`.
