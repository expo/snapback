# Snapback 4: R5 retained history can publish a transient empty answer

Status: Open
Date: 2026-09-29
Scope: `packages/snapback4/test/retained-history.test.mjs` (`R5 history wasm` and `R5 history process`), LLP 3000.028 §2.1 (former member: the server loses authority, the device keeps history)

The 0.4.9 publication dry run on the black M5 (attempt 3, release commit d84ab45599, full suite at client
concurrency 6 under load near 40) failed `R5 history wasm: retained history and independent held coverage` at
`assert.ok(!deliveries.includes(0))`. After the viewer left room `left`, the watch published an empty answer at
least once before it published the device's retained 25 rows.

The same test passed 12 of 12 isolated runs on the M5 afterwards (wasm and process, load about 38), in the
first 0.4.9 dry run (7fdaaf6119), and in every eb1000 landing suite. It is therefore a rare interleaving, but the
invariant is a user-visible one: a former member's retained history must never flash empty.

Find the interleaving (a server answer from after the revocation published before the retained substitution),
reproduce it deterministically with a held read or response, and fix the ordering, not the assertion.


## Lane SL contention reproduction — 2026-09-29

The complete suite on Linux reproduced the same invariant failure under **16
busy workers on CPUs 80–95**, with publication concurrency (16 Rust processes,
five client-file slots). The inherited affinity guard prevented descendant
mask changes. The test took 278.897513 ms and failed at
`retained-history.test.mjs:838:46`, exactly `assert.ok(!deliveries.includes(0))`.
This is an assertion failure, not a hang-budget expiry.

Evidence: [whole-run log](../snapback4/reports/20260929-sl-suite-under-load/qualified-moderate.log)
and its [complete failure extract](../snapback4/reports/20260929-sl-suite-under-load/qualified-moderate.summary.json).
Starting commit: `38abb89b8e0b206644b9e2619c6f2d159a981d23`;
tested source-diff SHA-256: `64e5c41182080bd576b09bed5e34822e4aecce1f95a15ff0fba88ab2d8eddc62`.
SL changes test fixtures and guide text; the runtime and this test are unchanged.
The other 5,196 passing client cases and ten inherited skips are not evidence
that this user-visible interleaving is repaired. No timeout or assertion was
weakened to conceal it.

A code-reading lead, **not a proved trace**: `local-query.ts::routeLocal`
reobserves after a server reply when its initial device answer was composed or
retained. An initially ordinary unknown-coverage fallback can receive the
server's post-leave empty answer while the device has not yet acquired the
leave tombstone. Capture the query, change-feed and device-apply ordering in a
held-response reproducer before choosing a product correction. The broader
routing/publication fences must remain intact.


### Captured ordering under 48 busy workers

SL's [focused trace](../snapback4/reports/20260929-sl-suite-under-load/control-retained-heavy.log)
repeats the original wasm R5 assertions 100 times, without changing the runtime.
It records **85 passes and 15 failures** in 40.571 seconds. The copy is outside
the suite inventory; it does not replace or reduce any full-suite cases.
[Generator](../snapback4/reports/20260929-sl-suite-under-load/prepare-retained-control.py)
and source hashes make the instrumentation reproducible. It adds timeline
observations and one JSON-decoding wrapper, so its failure frequency is a
control observation, not an estimate of production incidence.

The first failure proves the following order (milliseconds from case start):

| Time | Event |
|---|---|
| 211.072 | Watch publishes the server's 26 rows at sequence 4. |
| 219.215 | Leave mutation commits. |
| 220.821 | Device query still returns 25 current rows, `unknown=true`, `retained=false`; watermark is 4. |
| 221.049 | Fallback `/q/history` begins. |
| 227.306 | Server returns zero rows at sequence 5. |
| 227.675 | Watch publishes zero rows, fresh and complete. |
| 228.545 | Device applies the leave event; its watermark then becomes 5. |
| 233.154 | Device query returns 25 rows, `unknown=false`, `retained=true`. |

[All 15 failure windows](../snapback4/reports/20260929-sl-suite-under-load/retained-failure-windows.json)
are retained. This confirms a server/device publication-order race rather than
a wall-clock guard failure. A fix must preserve the current/retained routing
law and publication fences; hiding the empty observation or delaying this test's
leave is not a correction. The issue remains **Open**. Passing whole-suite
repetitions do not establish that this reproduced defect is resolved.

### Final-source heavy recurrence — 2026-09-30

`qualified-heavy-6` reproduces the same line-838 empty-delivery assertion under
48 busy workers, in 412.423534 ms. The client stage completes with 5,196 passes,
one failure, ten inherited skips and no cancellations. Its
[raw log](../snapback4/reports/20260929-sl-suite-under-load/qualified-heavy-6.log)
retains the failure; all 79 subsequent models and all 4,342 Rust checks pass.
The exact whole-suite footer is `== 1 failure(s) in 3515 s`.
The tested source-diff digest is
`db2b0c384593d0253670408199a1f22244019f5911456ce8c9b27fa195b99f1f`.
The SDK query runtime and the R5 assertion remain unchanged. This failed
attempt is excluded from the requested three heavy passes; the preceding
whole heavy pass did not repair this defect.


### Process-host recurrence — 2026-09-30

Heavy attempt 10 also fails the process-host variant at the same unchanged
line-838 `assert.ok(!deliveries.includes(0))` assertion, after 548.741058 ms.
The client stage reports 5,196 passes, one failure, zero cancellations and ten
inherited skips; its four 300-seed oracle cases pass. Rust passes in 1524 seconds.
All 79 models subsequently pass; the exact whole footer is
`== 1 failure(s) in 3512 s`. All 48 load workers survive and the source remains
`8a1ed4c2a7dd66718ef4fd72c1e2c135b3afa628d63eb1916b9deb53665838f5`.

This extends the observed empty-flash invariant failure to both device hosts.
The subsequent process trace also proves the server/device publication order.
Neither the R5 assertion nor the SDK query runtime is changed. The existing
final-source heavy pass remains valid evidence for its run, not a fix for this
product defect. [Raw whole-run log](../snapback4/reports/20260929-sl-suite-under-load/qualified-heavy-10.log).


The [process trace control](../snapback4/reports/20260929-sl-suite-under-load/control-retained-process-heavy.log)
repeats the original R5 assertions 100 times under 48 busy workers: **82 pass,
18 fail**, in 52.616 seconds, with no cancellation or asynchronous error.
All 18 failures are the same empty-delivery assertion. As with the wasm control,
instrumentation affects timing; this is not a production incidence estimate.
The first failure records:

| Time from case start (ms) | Event |
|---|---|
| 385.003 | Leave mutation commits. |
| 393.510 | Device query returns 25 rows, unknown and not yet retained. |
| 394.047 | Device watermark is still 4. |
| 398.091 | Server returns zero rows at sequence 5. |
| 398.756 | Watch publishes zero rows, fresh and complete. |
| 410.882 | Device applies the leave event. |
| 411.281 | Device watermark reaches 5. |
| 412.945 | Device query returns 25 retained rows. |
| 413.022 | Watch publishes those 25 rows, incomplete. |

[All 18 failure windows](../snapback4/reports/20260929-sl-suite-under-load/retained-process-failure-windows.json)
and the full timelines remain available. Run the existing
[generator](../snapback4/reports/20260929-sl-suite-under-load/prepare-retained-control.py)
with `process` to produce this diagnostic copy outside the suite inventory.
The SDK query runtime, R5 assertions, timeouts and full-suite counts remain
unchanged. This ticket stays **Open**.

### Lane FX round 1 recurrence — 2026-10-04

After merging main at `cee23d5619`, FX's ninth complete retained-history
repetition failed the same `!deliveries.includes(0)` assertion in `R5 history
wasm` (232.371 ms), on CPUs 64–67 with one busy worker. The native file result
was 67 passes and one failure, exit 1. FX only changes this file's startup URL
parser to require the complete port and line terminator; the R5 assertions,
client and runtime are unchanged.

A 30-run control using the byte-identical merged-baseline test, filtered to
both R5 cases on CPUs 92–95 with one busy worker, also failed once: iteration
12, `R5 history process`, the same assertion after 230.831 ms. The other 29
control invocations passed. This corroborates the inherited product race;
it is not an infrastructure result or evidence against the observation fixes.
The assertions remain intact and this issue stays open. Raw logs and native
statuses are retained with the [FX Round 1 report](../snapback4/reports/20261004-fx-test-races/REPORT.md#round-1--merged-audit-and-complete-observations)
(`linux-retained-history-09.log.gz`, `retained-baseline-12.log.gz` in its evidence
archive). The complete 30-run file series finished with 23 passes and seven failures
(iterations 9, 14, 15, 21, 24, 25 and 30), all at the same R5 wasm assertion.
`retained-failures.json` and the per-run CSV enumerate each recurrence. Later
passing repetitions do not erase these failures.

FX's subsequent full suite passed (exit 0, zero failed stages in 2,072 s),
including this file. That passing snapshot does not repair the reproduced
interleaving or close this ticket.
