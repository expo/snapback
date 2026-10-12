# device-sqlite--metered-examined--data

Oracle: server (engine on SQLite) against the sqlite device store, phase `read`, ceiling 0. Found by `run-devices --seed 0 --cases 20000` (lane GW, the widened
generator, LLP 3000.035 §5.1); seed 12742, shrunk in 166 attempts.
Replay: `cargo run --release -p snapback4-difftest -- replay 'crates/snapback4-difftest/cases/found/device-sqlite--metered-examined--data'`

```quarry
table items:
  bucket: int
  score: int
  label: text <=64
  until: time ?
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  expire at .until
  sync public

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where .bucket = bucket first 1 by .label, .score
```

Rows: `[["items", {"bucket": 0, "id": "r5", "label": "", "score": 0, "until": 335968}]]`
Viewer `bob`, clock 335969, arguments `{"a": 0, "b": 0, "bucket": 0, "c": null, "key": "missing", "n": null}`.

First differing field `metered-examined`. Left (server / engine), then right (device):

```json
{"complete": true, "cut": null, "data": {"Array": []}, "metered": {"examined": 1, "heap_bytes": 7, "index_entries": 0, "output_bytes": 12, "rows_written": 0, "rule_probes": 0, "steps": 3}, "seq": 1, "tables": ["items"]}
{"complete": true, "cut": null, "data": {"Array": []}, "metered": {"examined": 0, "heap_bytes": 7, "index_entries": 0, "output_bytes": 12, "rows_written": 0, "rule_probes": 0, "steps": 3}, "retained": false, "seq": 0, "tables": ["items"], "unknown": false}
```

**Diagnosis: underspecified point (server against device meters on expired rows); ticket `issues/20261008-snapback4-server-and-device-meters-diverge-on-unswept-expired-rows.md`.** The case declares `expire at .until` and holds a row that is expired at the read (seeded past its deadline, or given `until: now + 0` by the prelude) but not yet swept. The server's scan examines the unswept expired row and charges it (the expire card: "unswept rows still cost examined work"); the device's `/sync` snapshot never delivered it (or it expired after acquisition), so the device examines fewer rows. Data agree; every difference is a meter field or, at a low allowance, a cut on the server where the device completes. LLP 3000.009 §11.1 claims the whole outcome record, meters included, agrees; the documents do not say whether `examined` counts physical unswept rows on the device's side. Not security-relevant: the device never returns the expired row and never discloses more.

**Resolved (2026-10-12, lane EX, ruling: LLP 3000.007 §20.24.6):** the public meter charges only rows live at the read's clock; stepping over unswept expired rows is store work on every store and the device. The case is kept as a regression and replays as `pass` (`tests/devices.rs::retained_device_findings_still_reproduce`).
