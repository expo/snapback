# device-sqlite--examined-complete--data

Oracle: server (engine on SQLite) against the sqlite device store, phase `examined`, ceiling 0. Found by `run-devices --seed 0 --cases 20000` (lane GW, the widened
generator, LLP 3000.035 §5.1); seed 7999, shrunk in 299 attempts.
Replay: `cargo run --release -p snapback4-difftest -- replay 'crates/snapback4-difftest/cases/found/device-sqlite--examined-complete--data'`

```quarry
mutation prep0(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  update items[key] { score: 0, until: now + 0 }
  return 0

table items:
  owner: principal
  bucket: int
  score: int
  label: text <=64
  until: time ?
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer
  expire at .until
  sync to .owner

query run(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where .bucket = bucket and .owner = viewer last 1 by .label, .score after c
```

Rows: `[["items", {"bucket": 1, "id": "r3", "label": "é", "owner": "bob", "score": 0, "until": null}]]`
Viewer `bob`, clock 305535, arguments `{"a": 0, "b": 0, "bucket": 1, "c": null, "k2": "r1", "key": "r0", "n": 0}`; prelude steps: [{"args": {"a": -9007199254740990, "b": 1, "bucket": 1, "c": null, "k2": "r2", "key": "r3", "n": null}, "at": 305535}].

First differing field `examined-complete`. Left (server / engine), then right (device):

```json
{"complete": false, "cut": "meter", "data": [], "metered": {"examined": 1, "heap_bytes": 7, "index_entries": 0, "output_bytes": 12, "rows_written": 0, "rule_probes": 0, "steps": 5}, "next": null, "nextExpiry": null, "tables": ["items"], "unknown": false}
{"complete": true, "cut": null, "data": [], "metered": {"examined": 0, "heap_bytes": 7, "index_entries": 0, "output_bytes": 12, "rows_written": 0, "rule_probes": 0, "steps": 5}, "next": null, "nextExpiry": null, "tables": ["items"], "unknown": false}
```

**Diagnosis: underspecified point (server against device meters on expired rows); ticket `issues/20261008-snapback4-server-and-device-meters-diverge-on-unswept-expired-rows.md`.** The case declares `expire at .until` and holds a row that is expired at the read (seeded past its deadline, or given `until: now + 0` by the prelude) but not yet swept. The server's scan examines the unswept expired row and charges it (the expire card: "unswept rows still cost examined work"); the device's `/sync` snapshot never delivered it (or it expired after acquisition), so the device examines fewer rows. Data agree; every difference is a meter field or, at a low allowance, a cut on the server where the device completes. LLP 3000.009 §11.1 claims the whole outcome record, meters included, agrees; the documents do not say whether `examined` counts physical unswept rows on the device's side. Not security-relevant: the device never returns the expired row and never discloses more.
