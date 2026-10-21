# snapback4: hot-release named-worker test reads worker status before it is written

**Opened:** 2026-10-21 · **Area:** `snapback4/packages/snapback4/test/release-activation.test.mjs` · **Kind:** flaky test (load-sensitive)

`hot release replaces, adds and retires named workers without restarting serve`
(`release-activation.test.mjs` ~795) fails under full-suite load with
`TypeError: Cannot read properties of undefined (reading 'pid')` at ~804:
it waits for the worker's log line (`ROLL_ALPHA_V1`) and then immediately reads
`_meta` key `worker:status:alpha`, which the host may not have committed yet.

Evidence: failed in two consecutive full runs on expo-build-450b
(`scripts/test.sh` at `805fb4599a` and `078b33ec45`); passes when run alone
(`node --test --test-name-pattern "hot release replaces…"`, 1.4 s).

Fix direction: wait for the status row (`waitFor(() => statuses()['worker:status:alpha'])`)
rather than the log line before reading `.pid`; the same pattern may apply to
the later status reads in the test.

## Resolution (2026-10-21)

The test now waits for the committed `worker:status:*` rows (alpha's pid; after the replacement deploy, a new alpha pid and beta's row) together with the log lines before reading `.pid`. Test-only; host behavior unchanged. Passes 3/3 alone and 43/43 for the whole file.
