# Snapback 4 browser replacement fixture races SQLite and leaks its server on failure

Status: Resolved
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

Evidence: [round-2 report](../../snapback4/reports/20261002-fdl-fd-limit/REPORT.md#round-2--doctor-remediation-and-udp-probes-2026-10-02),
[full suite](../../snapback4/reports/20261002-fdl-fd-limit/round2/full-suite.log),
[baseline helper counterexample](../../snapback4/reports/20261002-fdl-fd-limit/round2/baseline-lock-repro.log),
[stall diagnosis and cleanup](../../snapback4/reports/20261002-fdl-fd-limit/round2/full-suite-stall.log).
After confirming ancestry, executable and cwd, only the leftover test-owned
server received SIGTERM; the test runner then emitted its existing failure and
continued to the client models. No failed suite test was retried or omitted.

Follow-up: coordinate or boundedly retry the fixture's database copy, and close
the replacement on every setup failure before returning it. Verify that an
injected writer lock reports failure without leaving a child server or hanging
the test process. Keep the browser's admission assertions intact.


Resolution (QF round 0, 2026-10-02): moved setup into the shared
`replacement-server.mjs` fixture. It acquires an immediate transaction, copies
all three identity tables atomically, and retries only BUSY/LOCKED within five
seconds. Server ownership spans database opening/copy and both original probe
assertions; every failure closes and reaps the replacement before rejection.
The browser admission assertions are unchanged.

The injected-lock regression starts a real replacement and holds its writer
past a short test-selected copy deadline. Its nested node:test process reports
`TEST_REPLACEMENT_COPY`, exits with failure, and leaves neither its child server
nor its temporary project. A released-lock case proves successful retry; a
failed probe proves cleanup after the copy.

Landed on its own, ahead of lane QF, so the 0.4.12 publication could be re-cut:
the first 0.4.12 Linux qualification and its first Darwin dry run both hit this
flake under host load, and the dry run hung on the leaked replacement server.
This landing carries the fixture fix, its regressions and the worker fixture's
startup-race fix, taken unchanged from lane QF (both of QF's round-0 reviews
confirmed them). The suite-level progress watchdog and process containment land
later with lane QF, whose report, `snapback4/reports/20261002-qf-qualification-flakes/`,
records the qualification evidence.

QF Round 5 merges this independent landing with the suite-level progress
watchdog and process containment. The replacement regression now imports
`runFile` from that shared runner; all independently landed fixture assertions
remain. The ticket stays closed. Qualification and limits:
[QF report](../../snapback4/reports/20261002-qf-qualification-flakes/REPORT.md).
