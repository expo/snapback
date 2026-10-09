# lean--prelude-code--E_RULE~NOT_FOUND

Oracle: the engine (SQLite, default ceilings) against the Lean model (`snapback4/lean`, LLP 3000.035 §5.2). Found by `run-lean --seed 0 --cases 20000` (lane GW, the widened
generator, LLP 3000.035 §5.1); seed 1749, shrunk in 219 attempts.
Replay (after `cd snapback4/lean && lake build`): `cargo run --release -p snapback4-difftest -- replay 'crates/snapback4-difftest/cases/found/lean--prelude-code--E_RULE~NOT_FOUND'`

```quarry
mutation prep0(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  upsert items[key] { owner: viewer, bucket, score: b, label: '𐀀', flag: true, maybe: n, tag: 'tag0' }
  return false

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
  return 0

query observe(key: id, k2: id):
  return [items[key], items[k2]]
```

Rows: `[["items", {"bucket": 0, "flag": true, "id": "r0", "label": "😀", "maybe": -9007199254740991, "owner": "alice", "score": -9007199254740990, "tag": "tag0"}]]`
Viewer `bob`, clock 393115, arguments `{"a": 0, "b": 0, "bucket": 0, "c": null, "k2": "r0", "key": "r0", "n": null}`; prelude steps: [{"args": {"a": -1, "b": -1, "bucket": 0, "c": null, "k2": "r1", "key": "r3", "n": -1}, "at": 393115}].

First differing field `prelude-code`. Left (server / engine), then right (model):

```json
{"events": 0, "metered": {"examined": 0, "heap_bytes": 1393, "index_entries": 0, "output_bytes": 0, "rows_written": 0, "rule_probes": 0, "steps": 12}, "receipt_only": false, "replayed": false, "state": "failed", "tables": [], "why": {"code": "E_RULE", "family": "auth", "guide": "rules", "message": "items's insert rule does not admit this viewer, or a sequence insert requires read authority independent of its ordinal, or a unique key or cap group contains a row you cannot read, or authorization cannot be established within its physical work allowance; to write into another principal's row use `upsert` under an `update` rule, or let a `maintain` keep the count"}}
{"code": "NOT_FOUND", "kind": "refused"}
```

**Diagnosis: open question OPEN W4, ticket `issues/20261008-quarry-difftest-widened-shapes-under-open-r2-and-w4.md`.** An absent `upsert`'s insert arm puts a unique `tag` held by a row the viewer cannot read. The engine refuses `E_RULE` ("a unique key ... contains a row you cannot read"), the model `NOT_FOUND` (its W4 choice). The documents are silent on a hidden clash on the upsert's insert path; a plain insert's hidden clash is `E_RULE` on both sides (W1).
