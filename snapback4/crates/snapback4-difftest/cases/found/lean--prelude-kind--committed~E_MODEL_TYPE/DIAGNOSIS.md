# lean--prelude-kind--committed~E_MODEL_TYPE

Oracle: the engine (SQLite, default ceilings) against the Lean model (`snapback4/lean`, LLP 3000.035 §5.2). Found by `run-lean --seed 0 --cases 20000` (lane GW, the widened
generator, LLP 3000.035 §5.1); seed 12509, shrunk in 174 attempts.
Replay (after `cd snapback4/lean && lake build`): `cargo run --release -p snapback4-difftest -- replay 'crates/snapback4-difftest/cases/found/lean--prelude-kind--committed~E_MODEL_TYPE'`

```quarry
mutation prep0(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  v1 = (items[key].score ?? 0)
  return b

table items:
  score: int
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  online only

query run(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return false
```

Rows: `[]`
Viewer `alice`, clock 302550, arguments `{"a": 0, "b": 0, "bucket": 0, "c": null, "k2": "r0", "key": "missing", "n": 0}`; prelude steps: [{"args": {"a": -1, "b": -1, "bucket": 0, "c": null, "k2": "r0", "key": "missing", "n": null}, "at": 302550}].

First differing field `prelude-kind`. Left (server / engine), then right (model):

```json
{"events": 0, "metered": {"examined": 1, "heap_bytes": 16, "index_entries": 0, "output_bytes": 10, "rows_written": 0, "rule_probes": 0, "steps": 14}, "receipt_only": false, "replayed": false, "result": {"Int": -1}, "seq": 1, "state": "sent", "tables": []}
{"code": "E_MODEL_TYPE", "kind": "refused"}
```

**Diagnosis: Lean model defect, OPEN E4; ticket `issues/20261008-quarry-lean-model-field-of-null-base.md`.** The block reads `(items[k].score ?? 0)` on a key with no visible row. The documents say field access propagates a null base (`why E_FIELD`, `why E_QUARRY_UNSUPPORTED`: "`row.body` is null when `row` is null"); the engine does, and evaluates 0. The model's `.field` arm refuses `E_MODEL_TYPE`, a refusal no checked program should reach. The model must be fixed (not done in lane GW, whose brief forbade changing model semantics); until then this signature is classified, and the engine's side is not in question.

**Resolved (2026-10-08).** The model was fixed: `Eval.lean`'s `.field` arm
now gives null for a null base (`why E_FIELD`; OPEN E4 confirmed by that
document; example `field-of-null`). This case now replays as a pass and is
kept as a regression (`tests/lean.rs`, `RESOLVED`). In seeds 0–19,999 the
fix uncovered no new engine or model defect: the cases it had masked added to
OPEN C2 and W4 (one new W4 signature, `lean--code--E_RULE~NOT_FOUND`).
