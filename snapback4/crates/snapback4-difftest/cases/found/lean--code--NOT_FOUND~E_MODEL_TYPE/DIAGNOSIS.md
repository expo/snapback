# lean--code--NOT_FOUND~E_MODEL_TYPE

Oracle: the engine (SQLite, default ceilings) against the Lean model (`snapback4/lean`, LLP 3000.035 §5.2). Found by `run-lean --seed 0 --cases 20000` (lane GW, the widened
generator, LLP 3000.035 §5.1); seed 10006, shrunk in 74 attempts.
Replay (after `cd snapback4/lean && lake build`): `cargo run --release -p snapback4-difftest -- replay 'crates/snapback4-difftest/cases/found/lean--code--NOT_FOUND~E_MODEL_TYPE'`

```quarry
table items:
  score: int
  read <- deny
  insert <- deny
  update <- deny
  delete <- deny
  online only

mutation run(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  v0 = (items[k2].score ?? 0)
  delete items[key]
  return false

query observe(key: id, k2: id):
  return [items[key], items[k2]]
```

Rows: `[]`
Viewer `bob`, clock 74788, arguments `{"a": 0, "b": 0, "bucket": 0, "c": null, "k2": "r1", "key": "missing", "n": null}`.

First differing field `code`. Left (server / engine), then right (model):

```json
{"events": 0, "metered": {"examined": 1, "heap_bytes": 32, "index_entries": 0, "output_bytes": 0, "rows_written": 0, "rule_probes": 0, "steps": 16}, "receipt_only": false, "replayed": false, "state": "failed", "tables": [], "why": {"code": "NOT_FOUND", "family": "rule", "guide": "programs", "message": "the program refused with NOT_FOUND", "rule": "NOT_FOUND", "site": "run:5"}}
{"code": "E_MODEL_TYPE", "kind": "refused"}
```

**Diagnosis: Lean model defect, OPEN E4; ticket `issues/20261008-quarry-lean-model-field-of-null-base.md`.** The block reads `(items[k].score ?? 0)` on a key with no visible row. The documents say field access propagates a null base (`why E_FIELD`, `why E_QUARRY_UNSUPPORTED`: "`row.body` is null when `row` is null"); the engine does, and evaluates 0. The model's `.field` arm refuses `E_MODEL_TYPE`, a refusal no checked program should reach. The model must be fixed (not done in lane GW, whose brief forbade changing model semantics); until then this signature is classified, and the engine's side is not in question.
