# Snapback 4: pinned branch-expiry tests accept live clock corrections

Opened and resolved 2026-09-27, lane FX. Baseline: `54099bc882`.
Affected: `packages/snapback4/test/retained-history.test.mjs`.
Lane GS reported `MQ local branch wasm` failing its exact clock assertion,
and `MQ local branch watch wasm` timing out after 60,000 ms.

## Cause and resolution

The fixture pins the wall source one millisecond before a permit expires,
holds a device reply, advances the real server by two hours, then moves the
fixture to the permit's deadline. A live probe or a late `/changes` body
can still sample the advanced server clock. That correctly moves the issued
device clock about an hour beyond the fixture's asserted instant. In a watch,
the resulting assertion exception is caught by the observation and leaves
the test awaiting a publication that will never arrive.

The fixture now disables sampling on its transport clock and its client fork
only after explicitly calibrating the manual boundary. Issued time, monotonic
floors, expiry, routing, publication and real device execution are unchanged.
A real probe and a stream-end sample are deliberately delivered after the
server advance and before releasing the held answer on every run. Exact
clock values, exactly two local evaluations, withheld expired branches,
server fallback, fresh/complete recovery and real pagination assertions remain.

Removing response headers alone was insufficient: an already delivered
`/changes` body can sample later. That intermediate attempt failed 1/20 runs;
it is not the final fix. The final fixture owns the sampling boundary itself.

## Proof

- Forced live sampling without the fixture fix: **5/5** one-shot runs fail
  the exact clock assertion (`retained-old-*.log`).
- The same order with a watch: **5/5** time out at the unchanged 60,000 ms
  limit (`retained-old-watch-*.log`).
- Final pinned fixture: **20/20** loaded runs, five at a time, each running
  all ten branch/branch-watch/permit/permit-watch/page cases across wasm and
  process devices (200 cases, `retained-pinned-*.log`). Eight CPU workers
  share cores 0–7 with the test processes.

From `snapback4/`, pinned tools on PATH, after building:

```sh
python3 reports/20260927-fx-flakes/controls.py
python3 reports/20260927-fx-flakes/repeat.py retained-old target/lane-fx-evidence/retained-live-clock-final.control.mjs '^MQ local branch wasm:' 5
python3 reports/20260927-fx-flakes/repeat.py retained-old-watch target/lane-fx-evidence/retained-live-clock-final.control.mjs '^MQ local branch watch wasm:' 5
python3 reports/20260927-fx-flakes/repeat.py retained-pinned packages/snapback4/test/retained-history.test.mjs '^MQ local (branch|permit|page)' 20
```

No product-clock change or raised timeout. Controls intentionally fail.
Logs/JSON: `snapback4/target/lane-fx-evidence/`; full-suite result and durable
qualification: [lane report](../../snapback4/reports/20260927-fx-flakes/REPORT.md).
