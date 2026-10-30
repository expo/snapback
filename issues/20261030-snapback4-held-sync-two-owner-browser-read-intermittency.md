# Snapback 4: held-sync two-owner browser roster read intermittently returns E_QUERY_RETRY

Status: Open
Date: 2026-10-30
Scope: the existing progressive web two-owner witness; product versus fixture cause remains unisolated
Source: Lane E round 10 prescribed verification, startup repetition 2

`web-start.test.mjs`'s “progressive writes: same-turn navigation before WASM,
replay and two document owners” case failed at line 800. Both mutation owners
had sent receipts, the non-idempotent audit read returned 3, and the final
snapshot had empty pending writes and captures with local status ready,
executable and acquired. While the witness deliberately held sync after apply
but before cursor completion, the dependent roster query returned
`E_QUERY_RETRY` instead of one row. No assertion or timeout was changed.

The same signature appears in the Lane E round-7 journal record. The distinct
[round-1 evaluation-watermark bug](closed/20261030-snapback4-journal-coverage-uses-sync-cursor-not-evaluation-watermark.md)
is still fixed and its focused regression remains passing; this report does
not establish that the cause is the same.

Evidence:

- [Failed uninstrumented repetition](../snapback4/reports/20261030-lane-e10/startup-2.log): 209/210 pass; web-start 27/28 pass; no cancellations.
- [First full sweep](../snapback4/reports/20261030-lane-e10/sweep.log): 759 passed, two existing skips; all 28 browser cases passed.
- [Third repetition](../snapback4/reports/20261030-lane-e10/startup-3.log): 210/210 passed, including all 28 browser cases.
- [Focused diagnostic log](../snapback4/reports/20261030-lane-e10/browser-diagnostic.log) and [summary](../snapback4/reports/20261030-lane-e10/browser-diagnostic-summary.log): the isolated instrumented case passed, both query evaluations reported watermark 4, and neither owner recorded a rejected query cut or custody wait in the retained trace. Instrumentation can change scheduling; this pass does not explain or repair the failure.
- [Input manifest](../snapback4/reports/20261030-lane-e10/inputs-before.json): source, tests, generated JavaScript, WASM and prebuilt CLI remained unchanged through the first three runs.

Reproduce from `snapback4/` with Node 24.19.0 on PATH:

```sh
node scripts/run-client-tests.mjs 1 files packages/snapback4/test/web-start.test.mjs
```

The diagnostic copy and runner are retained under the same report directory;
`node reports/20261030-lane-e10/run-browser-diagnostic.mjs` selects only this
case through the prescribed runner. It logs rejected cuts, custody decisions
and device replies without modifying shipped source or widening timeouts.

Next: capture the failing run's evaluation watermark, receipt cut, publication
revision and custody decision together. Determine whether the held-sync fixture
parks a necessary owner operation or whether a device/server publication path
loses liveness. Preserve the assertion and the 30-second public read bound.
This remains open; passing reruns are not a resolution.

Final round-10 verification: the [fourth uninstrumented browser run](../snapback4/reports/20261030-lane-e10/web-start-4.log) passed all 28 cases. Runs 1, 3 and 4 passed; run 2 failed. The final input comparison found no source/test/dist/WASM/CLI changes across the runs. This ticket remains open.

Lane E round 11 verification (2026-10-30): all five serial, uninstrumented `web-start.test.mjs` runs passed all 28 cases, including the held-sync two-owner witness, with unchanged assertions and timeouts. Logs: [run 1](../snapback4/reports/20261030-lane-e11/sweep.log), [run 2](../snapback4/reports/20261030-lane-e11/startup-2.log), [run 3](../snapback4/reports/20261030-lane-e11/startup-3.log), [run 4](../snapback4/reports/20261030-lane-e11/web-start-4.log), [run 5](../snapback4/reports/20261030-lane-e11/web-start-5.log). E11 repairs identity-wait store binding and late receipt retention in the adjacent settlement path, but does not establish the cause of the historical browser failure. The [final input comparison](../snapback4/reports/20261030-lane-e11/inputs-final.json) finds no changes to source/test/dist/WASM/CLI inputs across verification. See [REPORT-E11.md](../REPORT-E11.md). This ticket remains open.
