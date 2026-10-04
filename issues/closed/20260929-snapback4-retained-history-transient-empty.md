# Snapback 4: R5 retained history can publish a transient empty answer

Status: Closed
Resolved: 2026-10-04
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

Evidence: [whole-run log](../../snapback4/reports/20260929-sl-suite-under-load/qualified-moderate.log)
and its [complete failure extract](../../snapback4/reports/20260929-sl-suite-under-load/qualified-moderate.summary.json).
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

SL's [focused trace](../../snapback4/reports/20260929-sl-suite-under-load/control-retained-heavy.log)
repeats the original wasm R5 assertions 100 times, without changing the runtime.
It records **85 passes and 15 failures** in 40.571 seconds. The copy is outside
the suite inventory; it does not replace or reduce any full-suite cases.
[Generator](../../snapback4/reports/20260929-sl-suite-under-load/prepare-retained-control.py)
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

[All 15 failure windows](../../snapback4/reports/20260929-sl-suite-under-load/retained-failure-windows.json)
are retained. This confirms a server/device publication-order race rather than
a wall-clock guard failure. A fix must preserve the current/retained routing
law and publication fences; hiding the empty observation or delaying this test's
leave is not a correction. The issue remains **Open**. Passing whole-suite
repetitions do not establish that this reproduced defect is resolved.

### Final-source heavy recurrence — 2026-09-30

`qualified-heavy-6` reproduces the same line-838 empty-delivery assertion under
48 busy workers, in 412.423534 ms. The client stage completes with 5,196 passes,
one failure, ten inherited skips and no cancellations. Its
[raw log](../../snapback4/reports/20260929-sl-suite-under-load/qualified-heavy-6.log)
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
product defect. [Raw whole-run log](../../snapback4/reports/20260929-sl-suite-under-load/qualified-heavy-10.log).


The [process trace control](../../snapback4/reports/20260929-sl-suite-under-load/control-retained-process-heavy.log)
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

[All 18 failure windows](../../snapback4/reports/20260929-sl-suite-under-load/retained-process-failure-windows.json)
and the full timelines remain available. Run the existing
[generator](../../snapback4/reports/20260929-sl-suite-under-load/prepare-retained-control.py)
with `process` to produce this diagnostic copy outside the suite inventory.
The SDK query runtime, R5 assertions, timeouts and full-suite counts remain
unchanged. This ticket stays **Open**.


## Resolution — Lane RH, 2026-10-04

The captured order is reproduced without load on both real device hosts by
holding the leave page before device application. The unchanged router failed
all ten repetitions per host, publishing `[26,26,26,0]`. The fixed router never
publishes that empty page while the device's retained routing is pending.

Whole-server fallbacks that can read synced delivered history compare the
server cut against applied device state. Ahead replies are provisional:
empty/structured replies preserve permitted local history, positive pages
remain useful with incomplete/stale metadata, and sync reroutes once applied.
Already-known retained compositions preserve their existing current-row refresh
and deadlines. Refusals and publication fences still win; no new waiting loop
or retention allowance was introduced. LLP 3000.028 §3.2 records the rule.

Deterministic held, stalled, and empty-catch-up cases cover wasm and process;
the original `assert.ok(!deliveries.includes(0))` is unchanged. Qualification,
latency comparisons, wasm budget, stress results and initial diagnostic failures
are recorded in the [RH report](../../snapback4/reports/20261004-rh-retained-history-order/REPORT.md).

## Round 1 resolution — 2026-10-04

Astra rejected the initial resolution because another process owner could
advance the store between evaluation and transport capture, and non-blank
ordinary search bypassed the guard. The router now binds its shortcut to the
watermark read in the evaluation transaction, including a second observation
that changes a composition's route. A still-retained sibling cannot validate
emptying another history field while that field's leave is pending.

Search uses its opening transaction cut or the authorized server membership
opening to prove current routing unchanged. Otherwise matching device history
remains provisional on the same meter, with no extra server request or cursor
advance. One-shots, new watches, page roots, plain cursors and combined-cursor
withdrawal are covered. The rebuilt round-0 SDK and devices fail all **50**
causal controls; both hosts pass the deterministic regressions after the fix.
Same-owner and ordinary latency controls remain. The original R5 assertion
has not been weakened. Final stress, full-suite, latency and budget evidence
is in the [Round 1 report](../../snapback4/reports/20261004-rh-retained-history-order/REPORT.md#round-1--evaluation-cuts-and-ordinary-search).

Round 1 qualification completed: **30/30** four-CPU hog runs (**3,870 passes**),
**395/395** focused routing/query cases, and the full suite with zero failures.
The measured wasm is **639,810 B gzip** under the **639,940 B** ratchet, including
the preserved **130 B macOS allowance**. Nothing was pushed.
