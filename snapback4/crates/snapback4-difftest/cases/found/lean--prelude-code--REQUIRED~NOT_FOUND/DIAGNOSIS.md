# lean--prelude-code--REQUIRED~NOT_FOUND

Oracle: the engine (SQLite, default ceilings) against the Lean model (`snapback4/lean`, LLP 3000.035 §5.2). Found by `run-lean --seed 0 --cases 20000` (lane GW, the widened
generator, LLP 3000.035 §5.1); seed 3269, shrunk in 193 attempts.
Replay (after `cd snapback4/lean && lake build`): `cargo run --release -p snapback4-difftest -- replay 'crates/snapback4-difftest/cases/found/lean--prelude-code--REQUIRED~NOT_FOUND'`

```quarry
mutation prep0(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  upsert items[k2] { owner: viewer, bucket, score: 0, label: '𐀀', flag: true, maybe: n, tag: 'tag' }
  require false else REQUIRED
  return 0

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
  return false

query observe(key: id, k2: id):
  return [items[key], items[k2]]
```

Rows: `[["items", {"bucket": 1, "flag": false, "id": "r0", "label": "𐀀", "maybe": null, "owner": "bob", "score": -1, "tag": "tag0"}]]`
Viewer `alice`, clock 350400, arguments `{"a": 0, "b": 0, "bucket": 0, "c": null, "k2": "r0", "key": "missing", "n": null}`; prelude steps: [{"args": {"a": 9007199254740991, "b": 1, "bucket": 0, "c": null, "k2": "r0", "key": "r1", "n": null}, "at": 350400}].

First differing field `prelude-code`. Left (server / engine), then right (model):

```json
{"events": 0, "metered": {"examined": 0, "heap_bytes": 1538, "index_entries": 2, "output_bytes": 0, "rows_written": 1, "rule_probes": 0, "steps": 16}, "receipt_only": false, "replayed": false, "state": "failed", "tables": [], "why": {"code": "REQUIRED", "family": "rule", "guide": "programs", "message": "the program refused with REQUIRED", "rule": "REQUIRED", "site": "schema.q:3:3"}}
{"code": "NOT_FOUND", "kind": "refused"}
```

**Diagnosis: open question OPEN R2 (security-relevant; the unnamed update rule judges only the next image), reached through the widened shapes; ticket `issues/20261008-quarry-difftest-widened-shapes-under-open-r2-and-w4.md`.** An `upsert` (or `update`) under `update <- .owner = viewer` sets `owner: viewer` on another principal's row. The engine judges the next image only and admits it (a takeover); the model judges both images and refuses (`NOT_FOUND` on an unreadable target, `E_RULE` on a readable one). The difference then surfaces in a later statement, a prelude step or the observe reread, under this signature. The R2 fix (in progress in another lane) should retire it; replay after it lands.

**Resolved (2026-10-08).** The R2 security fix (`b2036dd821`, landed with
`cda33a8e27`): an unnamed `update <- R` now judges old and next, as the model
does. This case now replays as a pass and is kept as a regression
(`tests/lean.rs`, `RESOLVED`).
