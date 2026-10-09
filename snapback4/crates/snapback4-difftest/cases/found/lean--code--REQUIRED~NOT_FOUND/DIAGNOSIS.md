# lean--code--REQUIRED~NOT_FOUND

Oracle: the engine (SQLite, default ceilings) against the Lean model (`snapback4/lean`, LLP 3000.035 §5.2). Found by `run-lean --seed 0 --cases 20000` (lane GW, the widened
generator, LLP 3000.035 §5.1); seed 19570, shrunk in 162 attempts.
Replay (after `cd snapback4/lean && lake build`): `cargo run --release -p snapback4-difftest -- replay 'crates/snapback4-difftest/cases/found/lean--code--REQUIRED~NOT_FOUND'`

```quarry
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

mutation run(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  upsert items[key] { owner: viewer, bucket, score: 0, label: '𐀀', flag: true, maybe: n, tag: 'tag' }
  require false else REQUIRED
  return false

query observe(key: id, k2: id):
  return [items[key], items[k2]]
```

Rows: `[["items", {"bucket": 0, "flag": true, "id": "r0", "label": "😀", "maybe": null, "owner": "alice", "score": -1, "tag": "tag0"}]]`
Viewer `bob`, clock 61649, arguments `{"a": 0, "b": 0, "bucket": 0, "c": null, "k2": "missing2", "key": "r0", "n": null}`.

First differing field `code`. Left (server / engine), then right (model):

```json
{"events": 0, "metered": {"examined": 0, "heap_bytes": 1538, "index_entries": 2, "output_bytes": 0, "rows_written": 1, "rule_probes": 0, "steps": 16}, "receipt_only": false, "replayed": false, "state": "failed", "tables": [], "why": {"code": "REQUIRED", "family": "rule", "guide": "programs", "message": "the program refused with REQUIRED", "rule": "REQUIRED", "site": "schema.q:17:3"}}
{"code": "NOT_FOUND", "kind": "refused"}
```

**Diagnosis: open question OPEN R2 (security-relevant; the unnamed update rule judges only the next image), reached through the widened shapes; ticket `issues/20261008-quarry-difftest-widened-shapes-under-open-r2-and-w4.md`.** An `upsert` (or `update`) under `update <- .owner = viewer` sets `owner: viewer` on another principal's row. The engine judges the next image only and admits it (a takeover); the model judges both images and refuses (`NOT_FOUND` on an unreadable target, `E_RULE` on a readable one). The difference then surfaces in a later statement, a prelude step or the observe reread, under this signature. The R2 fix (in progress in another lane) should retire it; replay after it lands.
