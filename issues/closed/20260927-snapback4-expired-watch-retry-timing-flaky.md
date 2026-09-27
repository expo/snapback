# Snapback 4: expired-watch retry assertions depend on host scheduling

Opened and resolved 2026-09-27, lane FX. Baseline: `54099bc882`.
Affected: `packages/snapback4/test/expired-server-watch.test.mjs`.
Reported by lane KG: `recover, keep=undefined` times out waiting for paced
retries; `close client, keep=false` reports a first gap of 5.158 ms.

## Cause and resolution

A sync commit between a query's dispatch and reply invalidates that reply.
The authority fence correctly reruns the query immediately. The old test
counts that request as an expiry retry and applies the 25 ms delay assertion
to it. Under a forced sync, its first gap is 10.211 ms in the recorded control.
This is a test classification error, not insufficient product backoff.

The old arrival-count wait also requires the host to deliver timer callbacks
on time. Holding the scheduled callback reproduces its paced-retry timeout.
This is a controlled scheduling counterexample; the historical KG log alone
does not establish the precise host schedule behind that timeout.

The test now intercepts timers only in the observed query's async context.
It forces the sync race, checks delays 25/50/100/200/400/800/1000/1000 ms,
checks one timer and one request at a time, checks no request starts while
the timer is held, then explicitly releases the callback. It still checks
that no expired reply publishes, recovery is complete/fresh, and closure
stops requests, including when a pending callback fires after closure.
The existing 1,100 ms teardown check and all wait budgets are unchanged.
Omitted `keep` is included alongside false/true. No product code changed.

## Proof

- Old arrival-gap assertions: **5/5 fail** with a commit forced before the
  first watch reply (`expired-old-*.log`).
- Old paced-retry wait: **5/5 fail**, `timed out: paced expired-response retries`,
  when the host's scheduled retry callback is held (`expired-old-timeout-*.log`).
- Fixed seven scenarios: **20/20** busy-host runs, five Node processes at a
  time with eight CPU workers sharing cores 0–7 (`expired-final-*.log`).
- Full-suite result: the lane report and single dated JOURNAL entry.

From `snapback4/`, pinned Node on PATH, after building:

```sh
python3 reports/20260927-fx-flakes/controls.py
python3 reports/20260927-fx-flakes/repeat.py expired-old target/lane-fx-evidence/expired-arrivals.control.mjs 'recover, keep=false' 5
python3 reports/20260927-fx-flakes/repeat.py expired-old-timeout target/lane-fx-evidence/expired-starved-timer.control.mjs 'recover, keep=false' 5
python3 reports/20260927-fx-flakes/repeat.py expired-final packages/snapback4/test/expired-server-watch.test.mjs 'expired server replies' 20
```

Controls intentionally fail. Their source generation never changes product
files. Logs and per-run JSON remain in `snapback4/target/lane-fx-evidence/`;
[the report](../../snapback4/reports/20260927-fx-flakes/REPORT.md) carries a
durable summary and qualifications.
