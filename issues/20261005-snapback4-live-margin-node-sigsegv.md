# Snapback 4: Node exits with SIGSEGV after the live-margin browser test passes

Status: Open
Date: 2026-10-05
Scope: Node 24.13.1 / Vite 8.3.0 browser fixture process teardown on eb1000

PW round 1's loaded repetition 4 of
`packages/snapback4/test/live-margin-browser.test.mjs` printed `ok` for
`React/IndexedDB live margin and two-device offline settlement`, including its
zero-loading/zero-partial diagnostic counts (both recorded as zero) and
teardown hooks. The native Node test
runner then reported that its isolated test subprocess died with `SIGSEGV`.
The file invocation exited 1. This is not a Playwright execution-context
exception, an unexpected-navigation guard failure, or a file-runner watchdog.
The keeper acknowledged cleanup and its owned group was reaped normally.

The test and 24 CPU hogs were confined to the CPU set recorded in PW's
`round1/idle-sample-phase1.json` (each selected core and SMT sibling measured
at most 0.7% busy before launch). Eight file invocations shared that set.
All browser assertions passed, and the zero-loading/zero-partial diagnostic
counts were zero; the file is nevertheless a **failure**, not a
pass. The planned 30 repetitions retain it and continue with previously
unrun invocation numbers, without retrying this failed invocation.

No native backtrace was captured: this host routes core dumps to Apport, and
no unambiguously owned dump was available in the worktree. Attribution to
Node, Vite/Rolldown, another native binding, or this fixture is unresolved.
This ticket does not assert a pre-existing failure or exonerate the change.

Next: capture a backtrace from a specifically owned live-margin test process,
then isolate its shutdown lifecycle with and without the fixture changes.
Do not add whole-test retries or count a passed subtest as a passed file.

Evidence: [PW round-1 report](../snapback4/reports/20261005-pw-per-row-navigation/REPORT.md#round-1--navigation-failures-and-the-live-qualifier-2026-10-05),
`round1/logs.tar.gz` member `runs/04-live-margin-browser.test.mjs.log`, and
its native receipt in `round1/receipts.jsonl.gz`.
