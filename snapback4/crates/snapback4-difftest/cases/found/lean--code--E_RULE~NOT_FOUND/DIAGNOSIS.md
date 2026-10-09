# lean--code--E_RULE~NOT_FOUND

Oracle: the engine (SQLite, default ceilings) against the Lean model (`snapback4/lean`, LLP 3000.035 §5.2). Found by `run-lean --seed 0 --cases 20000` (lane GW, the widened
generator, LLP 3000.035 §5.1); seed 3200, shrunk in 142 attempts.
Replay (after `cd snapback4/lean && lake build`): `cargo run --release -p snapback4-difftest -- replay 'crates/snapback4-difftest/cases/found/lean--code--E_RULE~NOT_FOUND'`

```quarry
table items:
  owner: principal
  bucket: int
  score: int
  label: text <=64
  flag: bool
  maybe: int ?
  tag: id
  unique byTag: tag
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer
  online only

mutation run(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  upsert items[key] { owner: viewer, bucket, score: 0, label: '𐀀', flag: true, maybe: n, tag: 'tag0' }
  return 0

query observe(key: id, k2: id):
  return [items[key], items[k2]]
```

Rows: `[["items", {"bucket": 0, "flag": true, "id": "r0", "label": "a", "maybe": null, "owner": "bob", "score": -9007199254740991, "tag": "tag0"}]]`
Viewer `alice`, clock 10496, arguments `{"a": 0, "b": 0, "bucket": 0, "c": null, "k2": "r0", "key": "missing", "n": null}`.

First differing field `code`. Left (server / engine), then right (model):

```json
{"events": 0, "metered": {"examined": 0, "heap_bytes": 1424, "index_entries": 0, "output_bytes": 0, "rows_written": 0, "rule_probes": 0, "steps": 12}, "receipt_only": false, "replayed": false, "state": "failed", "tables": [], "why": {"code": "E_RULE", "family": "auth", "guide": "rules", "message": "items's insert rule does not admit this viewer, or a sequence insert requires read authority independent of its ordinal, or a unique key or cap group contains a row you cannot read, or authorization cannot be established within its physical work allowance; to write into another principal's row use `upsert` under an `update` rule, or let a `maintain` keep the count"}}
{"code": "NOT_FOUND", "kind": "refused"}
```

**Diagnosis: open question OPEN W4, ticket `issues/20261008-quarry-difftest-widened-shapes-under-open-r2-and-w4.md`.** An absent `upsert` (in `run` or a prelude step) whose insert arm puts a unique `tag` held by a row the viewer cannot read. The engine refuses `E_RULE` ("a unique key ... contains a row you cannot read"), the model `NOT_FOUND` (its W4 choice). The documents are silent on a hidden clash on the upsert's insert path; a plain insert's hidden clash is `E_RULE` on both sides (W1).
