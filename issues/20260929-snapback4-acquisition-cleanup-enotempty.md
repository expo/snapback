# Snapback 4 acquisition fixture cleanup can fail ENOTEMPTY and leave the suite waiting

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
