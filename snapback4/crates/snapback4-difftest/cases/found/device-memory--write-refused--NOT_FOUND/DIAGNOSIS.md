# device-memory--write-refused--NOT_FOUND

Oracle: server (engine on SQLite) against the memory device store, phase `write`, ceiling 0. Found by `run-devices --seed 0 --cases 20000` (lane GW, the widened
generator, LLP 3000.035 §5.1); seed 10442, shrunk in 188 attempts.
Replay: `cargo run --release -p snapback4-difftest -- replay 'crates/snapback4-difftest/cases/found/device-memory--write-refused--NOT_FOUND'`

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
  sync to .owner

mutation run(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  insert items { id: key, owner: viewer, bucket, score: 0, label: '𐀀', flag: true, maybe: n, tag: 'tag1' }
  delete items[key]
  delete items[key]
  return 0

query observe(key: id, k2: id):
  return [items[key], items[k2]]
```

Rows: `[["items", {"bucket": 1, "flag": true, "id": "r1", "label": "a", "maybe": -9007199254740991, "owner": "alice", "score": 0, "tag": "tag1"}]]`
Viewer `bob`, clock 46901, arguments `{"a": 0, "b": 0, "bucket": 0, "c": null, "k2": "r1", "key": "r0", "n": 0}`.

First differing field `write-refused`. Left (server / engine), then right (device):

```json
{"events": 0, "metered": {"examined": 0, "heap_bytes": 1473, "index_entries": 0, "output_bytes": 0, "rows_written": 0, "rule_probes": 0, "steps": 12}, "receipt_only": false, "replayed": false, "state": "failed", "tables": [], "why": {"code": "E_RULE", "family": "auth", "guide": "rules", "message": "items's insert rule does not admit this viewer, or a sequence insert requires read authority independent of its ordinal, or a unique key or cap group contains a row you cannot read, or authorization cannot be established within its physical work allowance; to write into another principal's row use `upsert` under an `update` rule, or let a `maintain` keep the count"}}
{"denied": {"code": "NOT_FOUND", "family": "rule", "guide": "programs", "message": "the program refused with NOT_FOUND", "rule": "NOT_FOUND", "site": "run:6"}}
```

**Diagnosis: device defect (contract), ticket `issues/20261008-snapback4-device-refusal-after-an-unproved-prediction-differs-from-the-server.md`.** The device predicted the block's first write without proving it (an insert over an id or a secondary unique value held by a row the device does not hold, which the server refuses `E_RULE`), carried on over its own predicted state, and reached a definite refusal in a later statement. A definite admission refusal is final for the client (`local.ts`): the write is never sent, so the client reports this code where the server would have reported `E_RULE`. Both refuse and nothing commits; only the reported code differs. Not security-relevant.

**Resolved (2026-10-12, lane EX, LLP 3000.007 §20.5):** a refusal after an unproved insert is no longer final on the device: the write queues without a row (`E_PREDICT`) and the server's `E_RULE` is the one reported. The case is kept as a regression and replays as `unsupported: prediction-declined` (`tests/devices.rs::retained_device_findings_still_reproduce`).
