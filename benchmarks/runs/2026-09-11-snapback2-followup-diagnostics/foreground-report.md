# Foreground send diagnostics

**Durable admission is earlier than mutation-promise completion.** The legacy JSON field `admission.ms` measures the latter. Durable admission below is the successful `ledger.enqueue` **end**, matched by the ID of the **begin** carrying `op: messages.send`, relative to `client.mutation` begin. Unrelated acknowledgement enqueues are excluded.

All positive first sender rows are **queued previews**, not committed rows. “Owner observed” means a separate headless **same-account Alice** query returned the message; it is not recipient-device delivery. The actual polling loop sleeps **250 ms plus query/evaluation work**. Its `control` string saying 50 ms is stale. Preview timing is the Node loop-start observation bucket; owner timing is recorded after the query. Those clocks start slightly before the browser mutation event, so cross-column differences are not precise phase durations.

## Earlier diagnostics

| Run | Durable admission, ms | Mutation result, ms | First queued preview, ms | Owner observed, ms |
| --- | ---: | ---: | ---: | ---: |
| current-during-trace01, long | uncaptured | 96,094.9 | 93,647.2 | 93,867.4 |
| current-during-trace02, 25 s | absent through 25,271.6 | not observed | not observed | not observed |
| fixed-during-trace01 | 430.7 | 1,741.0 | 857.3 | 1,417.1 |

The first long run's event buffer hit **40,000 events**, ending 20,245.0 ms after mutation begin. Its later result and preview are retained, but the exact durable enqueue time cannot be reconstructed. Do not call 96,094.9 ms its admission latency.

The uncapped 25-second diagnostic gives the concrete delay chain:

- `client.mutation` begins at 0 ms (event 1135).
- `inbox.admit` begins at 0.4 ms and ends at 4,096.2 ms (event 1138).
- The pre-enqueue `client.drainNow` begins at 4,096.6 ms (event 6069).
- At 25,271.6 ms capture it is still pending, with no `messages.send` enqueue. The old source awaits that drain before enqueueing when older intents exist.

These nested and overlapping waits cannot be summed from trace-wide duration counters.

## Three alternating controls

Each current run had a nominal 15-second window. Its mutation remains pending with no matching send enqueue; the exact capture age is shown. These are censored observations, not completed 15-second results.

| Current run / capture age | Fixed run | Fixed durable admission, ms | Fixed result, ms | Fixed queued preview, ms | Fixed owner observed, ms |
| --- | --- | ---: | ---: | ---: | ---: |
| current-during-control02 / 15,065.1 ms | fixed-during-trace02 | 147.6 | 559.5 | 532.7 | 582.8 |
| current-during-trace03 / 15,171.1 ms | fixed-during-trace03 | 398.3 | 1,688.6 | 827.6 | 1,437.8 |
| current-during-trace04 / 15,126.7 ms | fixed-during-trace04 | 322.6 | 1,656.8 | 588.4 | 1,435.5 |

The order was current/fixed/current/fixed/current/fixed. Every current pre-send snapshot held 301 messages; fixed trace02 held 251 and fixed trace03/04 held 301. They share the owner snapshot and interaction condition, but not an identical acquired prefix. No completed old latency, distribution or speedup ratio is inferred from the censored runs.

## After acquisition

Both pre-send physical snapshots contain all 10,008 original messages and match the owner.

| Run | Durable admission, ms | Mutation result, ms | Queued preview, ms | Owner observed, ms |
| --- | ---: | ---: | ---: | ---: |
| current-after-trace01 | 205.0 | 2,768.0 | 311.4 | 528.7 |
| fixed-after-trace01 | 198.3 | 1,840.0 | 306.5 | 518.9 |

These controls demonstrate why promise completion must remain separate from durable admission and first visibility.

## Scope and evidence

All runs are instrumented diagnostics with method/IDB wrappers, UI polling, and physical snapshots before/after the send. They are **not a clean qualification cohort**. Host load and exact inputs are retained; all use Node 24.13.1 and the same owner/compiler. Runtime identities are current `7134ae9946e3…` and fixed `cf0904e09a6e…`; this fixed source precedes the pending-acknowledgement projection.

`foreground-report.json` contains all 11 normalized records, exact enqueue event IDs, complete runtime/owner/compiler/snapshot hashes, SHA-256 hashes of every raw result and trace, and source-content hashes bridged through the matching CPU-profile source maps. It contains no raw event array. Current retained harness hashes are labeled as analysis-time evidence, not asserted as the original capped-run harness. Reproduce with `python3 runs/followup-diagnostics-20260911/foreground-analyze.py`. Raw traces remain ignored; no production sources were changed.
