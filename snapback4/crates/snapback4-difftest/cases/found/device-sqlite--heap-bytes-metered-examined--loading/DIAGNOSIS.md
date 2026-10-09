# device-sqlite--heap-bytes-metered-examined--loading

Oracle: server (engine on SQLite) against the sqlite device store, phase `heap_bytes`, ceiling 24453. Found by `run-devices --seed 0 --cases 20000` (lane GW, the widened
generator, LLP 3000.035 §5.1); seed 9250, shrunk in 254 attempts.
Replay: `cargo run --release -p snapback4-difftest -- replay 'crates/snapback4-difftest/cases/found/device-sqlite--heap-bytes-metered-examined--loading'`

```quarry
table items:
  owner: principal
  bucket: int
  score: int
  label: text <=64
  tag: id
  until: time ?
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer
  expire at .until
  sync to .owner

table tags:
  owner: principal
  rank: int
  name: text <=64
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer
  sync to .owner

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where .bucket = bucket and .owner = viewer last 5 by .label, .score after c { id, score, t: tags[.tag] }
```

Rows: `[["items", {"bucket": 1, "id": "r2", "label": "a", "owner": "bob", "score": 0, "tag": "tag2", "until": null}], ["items", {"bucket": 1, "id": "r5", "label": "😀", "owner": "bob", "score": 0, "tag": "tag5", "until": 400853}], ["items", {"bucket": 1, "id": "r6", "label": "", "owner": "bob", "score": -9007199254740990, "tag": "tag6", "until": null}], ["items", {"bucket": 1, "id": "r7", "label": "a", "owner": "bob", "score": -9007199254740990, "tag": "tag7", "until": null}], ["tags", {"id": "tag6", "name": "é", "owner": "bob", "rank": 8}]]`
Viewer `bob`, clock 400854, arguments `{"a": 0, "b": 0, "bucket": 1, "c": null, "key": "r0", "n": null}`.

First differing field `heap_bytes-metered-examined`. Left (server / engine), then right (device):

```json
{"complete": false, "cut": "meter", "loading": true, "metered": {"examined": 6, "heap_bytes": 24747, "index_entries": 0, "output_bytes": 6, "rows_written": 0, "rule_probes": 0, "steps": 36}, "nextExpiry": null, "tables": ["items", "tags"], "unknown": false}
{"complete": false, "cut": "meter", "loading": true, "metered": {"examined": 5, "heap_bytes": 24747, "index_entries": 0, "output_bytes": 6, "rows_written": 0, "rule_probes": 0, "steps": 36}, "nextExpiry": null, "tables": ["items", "tags"], "unknown": false}
```

**Diagnosis: underspecified point (server against device meters on expired rows); ticket `issues/20261008-snapback4-server-and-device-meters-diverge-on-unswept-expired-rows.md`.** The case declares `expire at .until` and holds a row that is expired at the read (seeded past its deadline, or given `until: now + 0` by the prelude) but not yet swept. The server's scan examines the unswept expired row and charges it (the expire card: "unswept rows still cost examined work"); the device's `/sync` snapshot never delivered it (or it expired after acquisition), so the device examines fewer rows. Data agree; every difference is a meter field or, at a low allowance, a cut on the server where the device completes. LLP 3000.009 §11.1 claims the whole outcome record, meters included, agrees; the documents do not say whether `examined` counts physical unswept rows on the device's side. Not security-relevant: the device never returns the expired row and never discloses more.
