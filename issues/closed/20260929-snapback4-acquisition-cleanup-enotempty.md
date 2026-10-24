# Snapback 4 acquisition/retained-history fixture cleanup can fail ENOTEMPTY and leave the suite waiting

Status: Resolved (DX9, 2026-10-24). Scope: test fixture lifecycle, inherited at `4fd338de5`.
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
[BP failure accounting](../../snapback4/reports/20260929-bp-foreground-first/FAILURES.md),
[full report](../../snapback4/reports/20260929-bp-foreground-first/REPORT.md).
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

Evidence: [WD report](../../snapback4/reports/20261003-wd-witness-cleanup-deadline/REPORT.md),
[intervention and diagnosis](../../snapback4/reports/20261003-wd-witness-cleanup-deadline/retained-suite-stall.json).
The report's external evidence index retains the complete suite output,
pre-intervention log, native stack samples and isolated controls.

The complete WD command ended `== 1 failure(s) in 2724 s`: 6,039 ordinary
client passes, one failure, five existing skips, zero cancellations; the final
79 models passed. All 68 retained-history cases were attempted.

## Recurrence in social-starter — 0.4.39 Mac publication dry run 2 (2026-10-24)

The same fixture-lifecycle defect hit `packages/snapback4/test/social-starter.test.mjs`. It is the
one red in the 0.4.39 Mac dry run 2 at `d4441c83b6`: 429/429 files, one failed file.

- **What failed.** Test 9 ("social starter runs through the public client: feed, likes, receipts,
  typing, media and retained history") reported `failureType: hookFailed`. The `rmSync(dir,
  {recursive: true, force: true})` after-hook in `starter()` (line 29) failed with
  `ENOTEMPTY ... .social-test-7EM1yk`.
- **Cause.** The still-running `snapback4 dev` server's worker created
  `.snapback4/worker-ledger-*.sqlite` during the rm walk, and the file was left behind.
  `starter(t)` registers the removal before the test registers its server-kill after-hook.
  node:test runs `t.after` hooks in registration order (FIFO) and skips the remaining hooks once
  one throws; this was checked with Node 24. So the dev server was never stopped, and the file
  took 931,910 ms on the Mac (about 48 s on Linux) before it ended.
- **Not reproducible alone.** Run alone through the suite's runner on the same tree, the file
  passed 6/6 (31–34 s, 17/17 tests each, no leftover dirs).
- **Outcome.** Dry run 3 passed it, and 0.4.39 was published from dry run 3.

The fix direction above applies unchanged to this fixture: stop and reap the server before
removing its directory, and make cleanup continue after a failing step. `t.after` order is
registration order, so register removal last or combine both into one hook. Evidence:
`snapback4/reports/20261023-publication-0.4.39/kit/isolated/dr2/`, `kit/iso-social.log`, and
`attempt-2-publication-dry-run.log.gz`.

## DX9 repair — 2026-10-24

The social-starter and acquisition fixtures now register one teardown hook via
`test/helpers/teardown.mjs`. It drains resource callbacks in reverse acquisition
order, attempts every callback after failures, and reports an AggregateError.
The server stop/reap therefore precedes scratch removal; removal cannot skip
the kill. Acquisition also handles startup failure before a child exists.
The retained-history fixture already has a combined client/kill/reap/remove
hook. The DX9 workstream report records the client-wide hook-order audit and
scoped verification, including an injected cleanup failure regression. Mac
runs are skipped by the workstream brief.

Resolution evidence: acquisition/social/teardown initial 65/65 pass; the seven
additional audited files pass 163/163; injected close and removal failures
still execute kill/reap. Subscription-pressure closes page drivers before
browser teardown and passes 2/2. Final scoped evidence is in the DX9 report.
