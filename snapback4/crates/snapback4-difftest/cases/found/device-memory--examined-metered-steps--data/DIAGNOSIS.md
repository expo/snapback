# device-memory--examined-metered-steps--data

Oracle: server (engine on SQLite) against the memory device store, phase `examined`, ceiling 8. Found by `run-devices --seed 0 --cases 20000` (lane GW, the widened
generator, LLP 3000.035 §5.1); seed 5689, shrunk in 389 attempts.
Replay: `cargo run --release -p snapback4-difftest -- replay 'crates/snapback4-difftest/cases/found/device-memory--examined-metered-steps--data'`

```quarry
table items:
  bucket: int
  score: int
  label: text <=64
  tag: id
  until: time ?
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  expire at .until
  sync public

table tags:
  owner: principal
  rank: int
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer
  sync to .owner

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  total = 0
  for row in items where .bucket = bucket last 5 by .label, .score:
    t = tags[row.tag]
    if t != null:
      total = total + t.rank
  return total
```

Rows: `[["items", {"bucket": 0, "id": "r1", "label": "", "score": 9007199254740990, "tag": "tag1", "until": null}], ["items", {"bucket": 0, "id": "r2", "label": "é", "score": 1, "tag": "tag2", "until": null}], ["items", {"bucket": 0, "id": "r3", "label": "", "score": 0, "tag": "tag3", "until": null}], ["items", {"bucket": 0, "id": "r5", "label": "a", "score": 9007199254740991, "tag": "tag5", "until": null}], ["items", {"bucket": 0, "id": "r6", "label": "", "score": -9007199254740990, "tag": "tag6", "until": 397352}], ["items", {"bucket": 0, "id": "r7", "label": "", "score": 9007199254740991, "tag": "tag7", "until": 397354}], ["items", {"bucket": 0, "id": "r8", "label": "", "score": 1, "tag": "tag8", "until": 397389}], ["items", {"bucket": 0, "id": "r9", "label": "", "score": -9007199254740990, "tag": "tag9", "until": 397352}], ["items", {"bucket": 0, "id": "r10", "label": "𐀀", "score": 1, "tag": "tag10", "until": null}], ["items", {"bucket": 0, "id": "r11", "label": "a", "score": -9007199254740990, "tag": "tag11", "until": 397352}]]`
Viewer `alice`, clock 397389, arguments `{"a": 0, "b": 0, "bucket": 0, "c": null, "key": "r0", "n": null}`; seeded at 397352.

First differing field `examined-metered-steps`. Left (server / engine), then right (device):

```json
{"complete": false, "cut": "meter", "data": 0, "metered": {"examined": 12, "heap_bytes": 1809, "index_entries": 0, "output_bytes": 9, "rows_written": 0, "rule_probes": 0, "steps": 30}, "next": null, "nextExpiry": null, "tables": ["items", "tags"], "unknown": false}
{"complete": false, "cut": "meter", "data": 0, "metered": {"examined": 12, "heap_bytes": 3049, "index_entries": 0, "output_bytes": 9, "rows_written": 0, "rule_probes": 0, "steps": 46}, "next": null, "nextExpiry": null, "tables": ["items", "tags"], "unknown": false}
```

**Diagnosis: underspecified point (server against device meters on expired rows); ticket `issues/20261008-snapback4-server-and-device-meters-diverge-on-unswept-expired-rows.md`.** The case declares `expire at .until` and holds a row that is expired at the read (seeded past its deadline, or given `until: now + 0` by the prelude) but not yet swept. The server's scan examines the unswept expired row and charges it (the expire card: "unswept rows still cost examined work"); the device's `/sync` snapshot never delivered it (or it expired after acquisition), so the device examines fewer rows. Data agree; every difference is a meter field or, at a low allowance, a cut on the server where the device completes. LLP 3000.009 §11.1 claims the whole outcome record, meters included, agrees; the documents do not say whether `examined` counts physical unswept rows on the device's side. Not security-relevant: the device never returns the expired row and never discloses more.

**Resolved (2026-10-12, lane EX, ruling: LLP 3000.007 §20.24.6):** the public meter charges only rows live at the read's clock; stepping over unswept expired rows is store work on every store and the device. The case is kept as a regression and replays as `pass` (`tests/devices.rs::retained_device_findings_still_reproduce`).
