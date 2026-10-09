# lean--code--E_CONSTRAINT~E_MODEL_TYPE

Oracle: the engine (SQLite, default ceilings) against the Lean model (`snapback4/lean`, LLP 3000.035 §5.2). Found by `run-lean --seed 0 --cases 20000` (lane GW, the widened
generator, LLP 3000.035 §5.1); seed 841, shrunk in 127 attempts.
Replay (after `cd snapback4/lean && lake build`): `cargo run --release -p snapback4-difftest -- replay 'crates/snapback4-difftest/cases/found/lean--code--E_CONSTRAINT~E_MODEL_TYPE'`

```quarry
table items:
  owner: principal
  bucket: int
  score: int
  label: text <=64
  flag: bool
  maybe: int ?
  tag: id
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  online only

mutation run(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  upsert items[key] { owner: viewer, bucket, score: 0, label: '𐀀', flag: true, maybe: n, tag: 'tag' }
  insert items { id: key, owner: viewer, bucket, score: (items[k2].score ?? 0), label: '𐀀', flag: true, maybe: n, tag: 'tag' }
  return 0

query observe(key: id, k2: id):
  return [items[key], items[k2]]
```

Rows: `[]`
Viewer `alice`, clock 61448, arguments `{"a": 0, "b": 0, "bucket": 0, "c": null, "k2": "missing2", "key": "r0", "n": null}`.

First differing field `code`. Left (server / engine), then right (model):

```json
{"events": 0, "metered": {"examined": 1, "heap_bytes": 2882, "index_entries": 1, "output_bytes": 0, "rows_written": 1, "rule_probes": 0, "steps": 34}, "receipt_only": false, "replayed": false, "state": "failed", "tables": [], "why": {"code": "E_CONSTRAINT", "family": "constraint", "guide": "indexes", "message": "items already has a row with id r0"}}
{"code": "E_MODEL_TYPE", "kind": "refused"}
```

**Diagnosis: Lean model defect, OPEN E4; ticket `issues/20261008-quarry-lean-model-field-of-null-base.md`.** The block reads `(items[k].score ?? 0)` on a key with no visible row. The documents say field access propagates a null base (`why E_FIELD`, `why E_QUARRY_UNSUPPORTED`: "`row.body` is null when `row` is null"); the engine does, and evaluates 0. The model's `.field` arm refuses `E_MODEL_TYPE`, a refusal no checked program should reach. The model must be fixed (not done in lane GW, whose brief forbade changing model semantics); until then this signature is classified, and the engine's side is not in question.
