# Snapback 4 acquisition/retained-history fixture cleanup can fail ENOTEMPTY and leave the suite waiting

Status: Open. Scope: test fixture lifecycle, inherited at `4fd338de5`.
Found during lane BP round 0's required single `scripts/test.sh` run on Linux.

The client test `process: a genuinely empty partition at sequence zero is
acquired durably` failed in its after hook, at
`snapback4/packages/snapback4/test/acquisition.test.mjs:64`, with:

```text
Error: ENOTEMPTY, Directory not empty: /tmp/sb4-acquisition-AsgmXW
code: ENOTEMPTY; syscall: rm
```

The fixture registers recursive directory removal before its asynchronous
client-close/server-stop hook. The observed failure was filesystem cleanup,
not a reported acquisition assertion. Its native device and dev server were
still alive and idle over ten minutes later; all other client processes had
finished. This exposes a live-store deletion race and leaves the suite waiting
for that acquisition shard even though its case has already reported failure.

BP changed no runtime or test source. To finish the same required suite run,
it recorded the owned process tree/start times and sent SIGTERM only to the
stalled fixture's native child, then its test worker and dev server. The
original ENOTEMPTY remained the one reported client-test failure. No ceiling
or timeout was changed, no full-suite retry substituted for it.

The full suite ended `== 1 failure(s) in 2129 s` (`client tests`): 4,560 client
passes, this one failure, ten declared skips; final models 79/79. The exact
case passed alone afterward in 1.267 seconds, without forced cleanup. That
isolated pass does not replace the full-suite failure.

Follow-up: stop/reap clients, device children and server before deleting the
fixture directory; make cleanup finish even if an earlier cleanup action
throws. Verify the empty-partition case, failure cleanup, and the existing
acquisition shards. Do not hide the race by increasing a timeout or swallowing
arbitrary filesystem errors.

Evidence and final suite/isolated-case outcomes:
[BP failure accounting](../snapback4/reports/20260929-bp-foreground-first/FAILURES.md),
[full report](../snapback4/reports/20260929-bp-foreground-first/REPORT.md).
Process identities and intervention times are retained in the report's
validation evidence. Fixing this inherited fixture is outside BP's explicit
stop-after-non-reproduction scope.


## WD recurrence in retained-history — 2026-10-03

The Apartment mini canonical suite on Node 24.18.0 reproduced this fixture
lifecycle failure in `packages/snapback4/test/retained-history.test.mjs`.

The full suite reported `ENOTEMPTY` in `MQ authoritative bound wasm: retained
history and independent held coverage`, at the `rmSync(directory, ...)`
after-hook on line 196. All 68 cases ran (67 passed, one teardown failure),
but a server from the failed case remained alive and kept the Node test child
alive. Native Node buffered this file's output until the child exited, leaving
the suite apparently stalled for more than sixteen minutes. Its per-test
372-second guard did not bound this remaining process lifetime.

The fixture registers directory removal before client/server cleanup (line
202). The failed directory retained `.snapback4/`; the server was still waiting
for HTTP requests. This ordering permits a writer/removal race and a failed
hook can leave later cleanup unfinished. The exact filesystem interleaving was
not instrumented, so that mechanism remains a code-reading lead.

WD sampled only its own Node child/server, then sent TERM to the owned server.
That did not release the Node child; TERM to that child let the full suite run
its remaining stages. The full run must retain its failed/intervened status.
The unchanged retained-history file separately passed 68/68 with WD's candidate
CLI in 56.248 s; an isolated first-case baseline control also passed. These
controls do not erase the suite failure or prove the rare interleaving repaired.

This case starts `snapback4 dev` and uses the client/device API; it does not
invoke witness preparation. WD does not edit this test or the client runtime.
This is distinct from the existing R5 transient-empty-answer ticket.

Follow-up: ensure client/server cleanup runs even when an earlier cleanup step
fails, stop/reap writers before removing their fixture directory, and regress
the leftover-handle/file-process exit behavior under contention. Preserve all
retained-history assertions and case counts.

Evidence: [WD report](../snapback4/reports/20261003-wd-witness-cleanup-deadline/REPORT.md),
[intervention and diagnosis](../snapback4/reports/20261003-wd-witness-cleanup-deadline/retained-suite-stall.json).
The report's external evidence index retains the complete suite output,
pre-intervention log, native stack samples and isolated controls.

The complete WD command ended `== 1 failure(s) in 2724 s`: 6,039 ordinary
client passes, one failure, five existing skips, zero cancellations; the final
79 models passed. All 68 retained-history cases were attempted.
