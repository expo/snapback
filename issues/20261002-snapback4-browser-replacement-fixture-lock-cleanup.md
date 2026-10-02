# Snapback 4 browser replacement fixture races SQLite and leaks its server on failure

Status: Open
Date: 2026-10-02
Scope: Test fixture in `snapback4/packages/snapback4/test/web-admission-review.test.mjs`

FDL round 2's one full suite failed `a hide during the startup probe waits for
its observed-replacement decision`: `replacementFor` line 321 threw
`ERR_SQLITE_ERROR`, errcode 5, `database is locked`. The parent web-admission
review is counted as a second failed test, in the single `client tests` category.

The fixture starts a live replacement server, then opens its database directly
with Node SQLite and copies three identity tables from the original database.
That write races the server's managed writer, with no busy wait or coordination.
On failure, `finally` closes only the SQLite handle. The helper never returns the
replacement to the caller, so the caller cannot close its server. The browser
and page listener close, but the remaining server keeps the test process alive
and delays the suite's failure report indefinitely.

The entire test file is byte-identical to baseline `00a96f16b7`. Executing that
baseline helper against a deliberately held SQLite writer lock reproduces both
`SQLITE_BUSY` and the missing `replacement.close()` call. This is a controlled
fixture counterexample, not a second full-suite run or a production regression
claim. FDL round 2 changes doctor formatting and UDP test initialization only.

Evidence: [round-2 report](../snapback4/reports/20261002-fdl-fd-limit/REPORT.md#round-2--doctor-remediation-and-udp-probes-2026-10-02),
[full suite](../snapback4/reports/20261002-fdl-fd-limit/round2/full-suite.log),
[baseline helper counterexample](../snapback4/reports/20261002-fdl-fd-limit/round2/baseline-lock-repro.log),
[stall diagnosis and cleanup](../snapback4/reports/20261002-fdl-fd-limit/round2/full-suite-stall.log).
After confirming ancestry, executable and cwd, only the leftover test-owned
server received SIGTERM; the test runner then emitted its existing failure and
continued to the client models. No failed suite test was retried or omitted.

Follow-up: coordinate or boundedly retry the fixture's database copy, and close
the replacement on every setup failure before returning it. Verify that an
injected writer lock reports failure without leaving a child server or hanging
the test process. Keep the browser's admission assertions intact.

## X27R recurrence, 2026-10-02

The one required full suite on `sb4/xcode27-reconcile` at `d7c8c35a59`
reproduced the same observed-replacement failure at line 321:
`ERR_SQLITE_ERROR`, errcode 5, `database is locked`. The client stage reports
`5796` tests, `5789` passes, `2` failures (child and parent), `5` skips and
`0` cancellations; `-- FAIL: client tests (1177 s)`.

The leaked server PID 62758 was a child of this suite's
`web-admission-review.test.mjs` process 62516. Before SIGTERM, X27R checked
its ancestry, exact executable in the X27R worktree, and cwd in its owned
`sb4-witness-app-QidyMB` temporary fixture. Only that leaked child received
SIGTERM; the existing failure was preserved and the suite continued to its
serial client models. No failed test was omitted or retried. The fixture and
client sources are unchanged by X27R.

Evidence on the Apartment mini: `~/x27r-evidence/full-suite.log`,
`client-process-tree.log` and `client-leak-cleanup.json`. The complete
`~/x27r.final.md` includes their hashes and the suite's final summary.
