# device-memory--examined-metered-heap-bytes--data

Oracle: server (engine on SQLite) against the memory device store, phase `examined`, ceiling 2. Found by `run-devices --seed 0 --cases 20000` (lane GW, the widened
generator, LLP 3000.035 §5.1); seed 5008, shrunk in 211 attempts.
Replay: `cargo run --release -p snapback4-difftest -- replay 'crates/snapback4-difftest/cases/found/device-memory--examined-metered-heap-bytes--data'`

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
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer
  sync to .owner

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where .bucket = bucket and .owner = viewer last 5 by .label, .score after c { id, t: tags[.tag] }
```

Rows: `[["items", {"bucket": 1, "id": "r0", "label": "", "owner": "bob", "score": -1, "tag": "tag0", "until": 371334}], ["items", {"bucket": 1, "id": "r8", "label": "é", "owner": "bob", "score": 0, "tag": "tag8", "until": null}], ["items", {"bucket": 1, "id": "r9", "label": "", "owner": "bob", "score": 9007199254740990, "tag": "tag9", "until": null}], ["items", {"bucket": 1, "id": "r11", "label": "é", "owner": "bob", "score": 0, "tag": "tag11", "until": null}]]`
Viewer `bob`, clock 371336, arguments `{"a": 0, "b": 0, "bucket": 1, "c": null, "key": "missing", "n": null}`.

First differing field `examined-metered-heap_bytes`. Left (server / engine), then right (device):

```json
{"complete": false, "cut": "meter", "data": [], "metered": {"examined": 4, "heap_bytes": 1384, "index_entries": 0, "output_bytes": 12, "rows_written": 0, "rule_probes": 0, "steps": 16}, "next": "WzMsIml0ZW1zIiwiJGludGVudDpieUJ1Y2tldE93bmVyTGFiZWxTY29yZTo4ZmEwNjEwZTUxNTU3MWY4IiwiRGVzYyIsW3sibmFtZSI6ImxhYmVsIiwia2luZCI6eyJUZXh0Ijp7Im1heCI6NjR9fX0seyJuYW1lIjoic2NvcmUiLCJraW5kIjoiSW50In0seyJuYW1lIjoiaWQiLCJraW5kIjoiSWQifV0sW3siU3RyaW5nIjoiw6kifSx7IkludCI6MH0seyJJZCI6InI4In1dLHsiZ2VuZXJhdGlvbiI6MSwicHJlZml4IjpbeyJJbnQiOjF9LHsiSWQiOiJib2IifV19XQ", "nextExpiry": null, "tables": ["items", "tags"], "unknown": false}
{"complete": false, "cut": "meter", "data": [], "metered": {"examined": 4, "heap_bytes": 2187, "index_entries": 0, "output_bytes": 12, "rows_written": 0, "rule_probes": 0, "steps": 16}, "next": "WzMsIml0ZW1zIiwiJGludGVudDpieUJ1Y2tldE93bmVyTGFiZWxTY29yZTo4ZmEwNjEwZTUxNTU3MWY4IiwiRGVzYyIsW3sibmFtZSI6ImxhYmVsIiwia2luZCI6eyJUZXh0Ijp7Im1heCI6NjR9fX0seyJuYW1lIjoic2NvcmUiLCJraW5kIjoiSW50In0seyJuYW1lIjoiaWQiLCJraW5kIjoiSWQifV0sW3siU3RyaW5nIjoiw6kifSx7IkludCI6MH0seyJJZCI6InI4In1dLHsiZ2VuZXJhdGlvbiI6MSwicHJlZml4IjpbeyJJbnQiOjF9LHsiSWQiOiJib2IifV19XQ", "nextExpiry": null, "tables": ["items", "tags"], "unknown": false}
```

**Diagnosis: underspecified point (server against device meters on expired rows); ticket `issues/20261008-snapback4-server-and-device-meters-diverge-on-unswept-expired-rows.md`.** The case declares `expire at .until` and holds a row that is expired at the read (seeded past its deadline, or given `until: now + 0` by the prelude) but not yet swept. The server's scan examines the unswept expired row and charges it (the expire card: "unswept rows still cost examined work"); the device's `/sync` snapshot never delivered it (or it expired after acquisition), so the device examines fewer rows. Data agree; every difference is a meter field or, at a low allowance, a cut on the server where the device completes. LLP 3000.009 §11.1 claims the whole outcome record, meters included, agrees; the documents do not say whether `examined` counts physical unswept rows on the device's side. Not security-relevant: the device never returns the expired row and never discloses more.
