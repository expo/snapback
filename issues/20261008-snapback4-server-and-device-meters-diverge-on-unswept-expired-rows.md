# Snapback 4 server and device meters diverge on unswept expired rows

**Status:** Open
**Impact:** 3
**Urgency:** 2
**Ease:** 3
**Confidence:** 5
**Systems:** Snapback 4, expiry, meter, device interpreter, server-against-device oracle
**Class:** underspecified point (needs a ruling, like the heap ruling); not security-relevant
**Date:** 2026-10-08
**Related:** LLP 3000.035 §5.1 (found by the widened generator, lane GW, `run-devices`/`run-lean --seed 0 --cases 20000`)

Not security-relevant: the device never returns an expired row; it does less
work than the server, never more disclosure.

The widened generator declares `expire at .until` on `items` and seeds rows
whose deadline falls before, at and after each operation's clock, with and
without sweeps. On reads the device publishes without the server, the server
and both device stores agree on data, `complete`, cursors and `nextExpiry`,
but not on the meter: the server's scan examines an expired row that has not
been swept and charges it (the expire card: "unswept rows still cost examined
work"); the device's `/sync` snapshot never delivered that row (or the device
holds it from before its deadline and skips it differently), so it examines
fewer rows. At a low allowance the same difference becomes a cut on the server
where the device completes (`examined-complete`, `examined-data`,
`steps-data`), or a different cut position.

Minimal case (`cases/found/device-sqlite--metered-examined--data`):

```quarry
table items:
  bucket: int
  ...
  until: time ?
  read <- allow
  expire at .until
  sync public

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where .bucket = bucket last 1 by .label, .score
```

One row, `until` one millisecond before the read: data `[]` on both; server
`examined: 1`, device `examined: 0`.

LLP 3000.009 §11.1 asks for the whole outcome record, meters included, to
agree between server and device; the heap ruling (LLP 3000.007 §20.24.5) made
`heap_bytes` one logical ledger. The documents do not say whether a read's
`examined` (and the steps and heap that follow it) counts physical unswept
expired rows. **The question:** either the server stops charging expired rows
it skips (so the meter is a function of live rows, as the device's is), the
device charges the rows the server would still hold (impossible: it does not
know them), or the contract names this as a permitted difference and the
oracle gets a named exception for expiring tables.

Counts in seeds 0–19,999 (identical on both device stores; 772 per store of
3,663 + 16,337 cases):

- `device-memory--continuation-metered-examined--data`: 2
- `device-memory--examined-complete--data`: 28
- `device-memory--examined-data--data`: 197
- `device-memory--examined-metered-examined--data`: 123
- `device-memory--examined-metered-heap-bytes--data`: 27
- `device-memory--examined-metered-steps--data`: 1
- `device-memory--heap-bytes-metered-examined--data`: 74
- `device-memory--heap-bytes-metered-examined--loading`: 87
- `device-memory--metered-examined--data`: 74
- `device-memory--output-bytes-metered-examined--data`: 74
- `device-memory--steps-data--data`: 8
- `device-memory--steps-metered-examined--data`: 74
- `device-memory--steps-metered-examined--loading`: 2
- `device-memory--steps-metered-heap-bytes--loading`: 1
- `device-sqlite--continuation-metered-examined--data`: 2
- `device-sqlite--examined-complete--data`: 28
- `device-sqlite--examined-data--data`: 197
- `device-sqlite--examined-metered-examined--data`: 123
- `device-sqlite--examined-metered-heap-bytes--data`: 27
- `device-sqlite--examined-metered-steps--data`: 1
- `device-sqlite--heap-bytes-metered-examined--data`: 74
- `device-sqlite--heap-bytes-metered-examined--loading`: 87
- `device-sqlite--metered-examined--data`: 74
- `device-sqlite--output-bytes-metered-examined--data`: 74
- `device-sqlite--steps-data--data`: 8
- `device-sqlite--steps-metered-examined--data`: 74
- `device-sqlite--steps-metered-examined--loading`: 2
- `device-sqlite--steps-metered-heap-bytes--loading`: 1

Every retained case: `snapback4/crates/snapback4-difftest/cases/found/<signature>/DIAGNOSIS.md`.

## Scheduled-run signatures

**Failure signature:** `device-memory--continuation-metered-examined--data`  
**Failure signature:** `device-memory--examined-complete--data`  
**Failure signature:** `device-memory--examined-data--data`  
**Failure signature:** `device-memory--examined-metered-examined--data`  
**Failure signature:** `device-memory--examined-metered-heap-bytes--data`  
**Failure signature:** `device-memory--examined-metered-steps--data`  
**Failure signature:** `device-memory--heap-bytes-metered-examined--data`  
**Failure signature:** `device-memory--heap-bytes-metered-examined--loading`  
**Failure signature:** `device-memory--metered-examined--data`  
**Failure signature:** `device-memory--output-bytes-metered-examined--data`  
**Failure signature:** `device-memory--steps-data--data`  
**Failure signature:** `device-memory--steps-metered-examined--data`  
**Failure signature:** `device-memory--steps-metered-examined--loading`  
**Failure signature:** `device-memory--steps-metered-heap-bytes--loading`  
**Failure signature:** `device-sqlite--continuation-metered-examined--data`  
**Failure signature:** `device-sqlite--examined-complete--data`  
**Failure signature:** `device-sqlite--examined-data--data`  
**Failure signature:** `device-sqlite--examined-metered-examined--data`  
**Failure signature:** `device-sqlite--examined-metered-heap-bytes--data`  
**Failure signature:** `device-sqlite--examined-metered-steps--data`  
**Failure signature:** `device-sqlite--heap-bytes-metered-examined--data`  
**Failure signature:** `device-sqlite--heap-bytes-metered-examined--loading`  
**Failure signature:** `device-sqlite--metered-examined--data`  
**Failure signature:** `device-sqlite--output-bytes-metered-examined--data`  
**Failure signature:** `device-sqlite--steps-data--data`  
**Failure signature:** `device-sqlite--steps-metered-examined--data`  
**Failure signature:** `device-sqlite--steps-metered-examined--loading`  
**Failure signature:** `device-sqlite--steps-metered-heap-bytes--loading`  

Recurrences:

- 2026-10-09: run `20261009T011321Z-eb3eb4e7`, seed `7999`, commit `74f3a1dd3240287cd7f5405ed55588e0c93db8e5`.

- 2026-10-09: run `20261009T011321Z-eb3eb4e7`, seed `8649`, commit `74f3a1dd3240287cd7f5405ed55588e0c93db8e5`.

- 2026-10-09: run `20261009T011321Z-eb3eb4e7`, seed `7220`, commit `74f3a1dd3240287cd7f5405ed55588e0c93db8e5`.

- 2026-10-09: run `20261009T011321Z-eb3eb4e7`, seed `5689`, commit `74f3a1dd3240287cd7f5405ed55588e0c93db8e5`.

- 2026-10-09: run `20261009T011321Z-eb3eb4e7`, seed `5306`, commit `74f3a1dd3240287cd7f5405ed55588e0c93db8e5`.

- 2026-10-10: run `20261010T000005Z-fe12e802`, seed `20791`, commit `e92ba8687bc6e363cf5f76436f53d8b3bacdd284`.

- 2026-10-10: run `20261010T000005Z-fe12e802`, seed `22179`, commit `e92ba8687bc6e363cf5f76436f53d8b3bacdd284`.

- 2026-10-10: run `20261010T000005Z-fe12e802`, seed `19175`, commit `e92ba8687bc6e363cf5f76436f53d8b3bacdd284`.

- 2026-10-10: run `20261010T000005Z-fe12e802`, seed `17047`, commit `e92ba8687bc6e363cf5f76436f53d8b3bacdd284`.

- 2026-10-10: run `20261010T000005Z-fe12e802`, seed `15964`, commit `e92ba8687bc6e363cf5f76436f53d8b3bacdd284`.

- 2026-10-10: run `20261010T000005Z-fe12e802`, seed `13950`, commit `e92ba8687bc6e363cf5f76436f53d8b3bacdd284`.
