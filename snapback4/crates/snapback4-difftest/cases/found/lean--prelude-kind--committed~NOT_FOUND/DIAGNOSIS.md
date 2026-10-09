# lean--prelude-kind--committed~NOT_FOUND

Oracle: the engine (SQLite, default ceilings) against the Lean model (`snapback4/lean`, LLP 3000.035 §5.2). Found by `run-lean --seed 0 --cases 20000` (lane GW, the widened
generator, LLP 3000.035 §5.1); seed 18123, shrunk in 197 attempts.
Replay (after `cd snapback4/lean && lake build`): `cargo run --release -p snapback4-difftest -- replay 'crates/snapback4-difftest/cases/found/lean--prelude-kind--committed~NOT_FOUND'`

```quarry
mutation prep0(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  upsert items[k2] { owner: viewer, bucket, score: 0, label: '𐀀', flag: true, maybe: n, tag: 'tag' }
  return 2

table items:
  owner: principal
  bucket: int
  score: int
  label: text <=64
  flag: bool
  maybe: int ?
  tag: id
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer
  sync to .owner

query run(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return false
```

Rows: `[["items", {"bucket": 0, "flag": true, "id": "r1", "label": "😀", "maybe": null, "owner": "bob", "score": 1, "tag": "tag1"}]]`
Viewer `bob`, clock 352668, arguments `{"a": 0, "b": 0, "bucket": 0, "c": null, "k2": "r1", "key": "r0", "n": null}`; prelude steps: [{"args": {"a": -9007199254740991, "b": 1, "bucket": 0, "c": null, "k2": "r1", "key": "r0", "n": null}, "at": 352668, "viewer": "alice"}].

First differing field `prelude-kind`. Left (server / engine), then right (model):

```json
{"events": 2, "metered": {"examined": 0, "heap_bytes": 1538, "index_entries": 2, "output_bytes": 9, "rows_written": 1, "rule_probes": 0, "steps": 16}, "receipt_only": false, "replayed": false, "result": {"Int": 2}, "seq": 2, "state": "sent", "tables": ["items"]}
{"code": "NOT_FOUND", "kind": "refused"}
```

**Diagnosis: open question OPEN R2 (security-relevant; the unnamed update rule judges only the next image), reached through the widened shapes; ticket `issues/20261008-quarry-difftest-widened-shapes-under-open-r2-and-w4.md`.** An `upsert` (or `update`) under `update <- .owner = viewer` sets `owner: viewer` on another principal's row. The engine judges the next image only and admits it (a takeover); the model judges both images and refuses (`NOT_FOUND` on an unreadable target, `E_RULE` on a readable one). The difference then surfaces in a later statement, a prelude step or the observe reread, under this signature. The R2 fix (in progress in another lane) should retire it; replay after it lands.
