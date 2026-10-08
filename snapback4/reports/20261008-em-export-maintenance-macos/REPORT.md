# EM round 8 — macOS post-driver retention evidence

2026-10-08, eb1000 / `expose-builder-pixel`, lane-em, starting at
`affcd4919ba42bc54ba96a741a2faf54b9b39059`. Both round-7 READY reviews were
read. Work stayed in this checkout on eb1000; no macOS host was accessed,
and nothing was pushed or published. The llp-orient context remains LLP 3000's
contention policy and LLP 3000.030 §15.

## Finding and limits

The supplied failure is **a post-driver wait with delivered work and live
custody**, not a retained reproduction of the earlier lost-wakeup state.
The wakeup reached an observer, and a scan claimed the work. The archive cannot
establish why that work/custody then took so long: the bounded collector omitted
the two retention group journals and stderr logs, and the current proof's worker
journal and background log. I fixed that evidence-selection defect and added
capture at the original failing assertion. Product code and wait bounds are
unchanged. The macOS incident's cause remains open in a
[separate ticket](../../../issues/20261008-snapback4-macos-post-driver-retention-wait.md).

The operator reports wakeup **21/21**, background run 1 **95/95**, and run 2
**93/95** on macOS against `affcd4919b`. The supplied archive's logs corroborate
those counts. The other run-2 failure, observer count `0 !== 1` in the held-lock
28-export case, is the unchecked whole-table `ps` listing assigned to FL round
10 (checked 128 MiB listing). That fix was not imported or duplicated here.
The previously supplied round-4 soak passed six background runs at 95/95;
passing prior runs do not date the cause of an intermittent failure.

## Retained sequence

The [exact input archive](evidence/em-r7-mac-run2.tar.gz) has SHA-256
`d113e693190930ffdc47597f8d9d7a5a88fe432430b7cef23d3001040ca400c6`.
Its relevant snapshot is
`sb4-em-evidence/maintenance-cfef6bd701aa7c2f/snapshot-1791419664460053000-4757c24f-failure-test-guard/`.
[investigate.py](investigate.py) reconstructs the
[timeline, queue, process evidence and file omissions](evidence/snapshot-analysis.json)
without contacting the source host.

| Unix milliseconds | Retained observation |
| --- | --- |
| 1791419580429 | Observer 5642 adopts `{expiresAt:1791423180188, awake:14959559}`, takes and consumes the wakeup. |
| 1791419584185 | Custodian 6004 starts retention; its worker group is launched at 9584505. |
| 1791419584271–4301 | Observer launches scan 7363; scan claims work and records `scanning`. |
| 1791419584324–4680 | Scan 7363 starts retention and launches its worker group. |
| 1791419584734 | Retention worker 7412 emits `compress-before`; the trace ends. |
| 1791419614243 | Test enters `finally` cleanup's drain (`allowParked:true`). |
| 1791419664493.813 | Test-guard snapshot: observer 5642 and scan 7363 are identity-verified live processes. |
| 1791419668197 | Test log records cleanup capture; this snapshot was later evicted from the cleanup ring. |

The failing label is `background proof and post-driver retention finished`,
whose `until` has a **30-second** bound. That check precedes `maintenanceIdle`.
The overall **113.909-second** test duration includes cleanup; it is not the
duration of a failed 90-second queue drain. The snapshot was taken about
50 seconds into cleanup, after the initial failure. Cleanup waits for native
custody; it does not signal these workers. The supplied archive contains no
snapshot at the original 30-second assertion and no final snapshot for this
fixture. The later cleanup captures belong to different fixtures.

`compress-before` is emitted by the retention worker before launching gzip with
`Command::output()`. PID 7412 is therefore not an identified gzip process.
Two `.retention-*` directories show concurrent custodians, but not two workers
waiting on each other's lock. Their group journals were omitted; the archive
does not establish custodian 6004 or worker 7412's liveness at capture. No
`retention-status.json` was inventoried in either work directory.

The 79.760 seconds without a retained trace event is real, but trace writes are
best-effort, asynchronous and droppable. It does not prove that all work threads
stopped, nor reveal their syscall/wait. Snapshot capture itself took 33.6 ms.
It hit the **64-file cap**, not the byte or time cap. In particular, the manifest
records omitted retention stderr files of **157 and 76 bytes**, both group
journals, and the current proof's **1,255-byte background log**. Their contents
cannot be reconstructed from size or modification time.

## Candidate checks

**Wakeup locking:** `maintenance-wakeup.lock` is used only by busy-queue
producers, after failure to acquire pending custody. Consumers, observers and
scans never acquire that writer lock. Publication releases it before retrying
the pending lease. Native retention uses a nonblocking `retention.lock` attempt;
a busy worker refuses rather than waiting there. No cycle with the new lock is
present in those paths. An empty persistent lockfile does not identify a holder.
This snapshot has already passed notification/claim, unlike the earlier EM
stranded-request controls. This does not rule out all native/kernel waits.

**Sleep clock:** the real Darwin predicate already uses
`after.saturating_sub(before) > 1000` milliseconds, not strict equality. The
retained launch and adopted samples are both 14959559; later samples are absent.
There is no retained sleep refusal or parked claim. A new Linux debug-clock
regression uses that baseline, then +1 ms before producer retry, +20 ms before
the holder rechecks, and +1,000 ms before successor start. It drains under the
original sample and absolute expiry. Existing +2,000 ms regressions still stop
and require the documented fresh-export backstop. This rules out small drift
as a sufficient cause in these paths; it does not measure real Darwin sampling
gaps, suspend behavior or background scheduling.

**Native retention/compression:** recovery, preparation and process-group files,
the real Darwin clock and post-driver retention path are byte-identical across
main `2797247960`, round 4 `9337691bee` and round 7 `affcd4919b`.
`run_with_budget` is byte-identical between rounds 4 and 7 (its earlier EM
additions are trace events). [Hash comparisons](evidence/source-provenance.json).
The existing 30-second work loop polls native status; group cleanup follows
under its separate 5-second idle / 60-second hard bound. A 30-second test wait
for the whole worker is therefore shorter than the complete custody allowance.
That is an investigation lead, not proof that this run spent the excess in
normal cleanup. The trace lacks `work-ended` and the needed native logs.
Unchanged paths establish provenance, not a pre-EM reproduction or exclusion
of EM-induced scheduling changes. No speculative product or timeout fix was
made. The original two tickets and the new incident ticket stay open.

## Diagnostic repair

After root queue/log files, the collector now visits retention work directories
(newest first within its bounded discovery batch), then the `latest.json` proof
directory. It prioritizes custody journals, status and stderr before historical
receipts. It also prioritizes the wakeup receipt and makes file-count truncation
explicit in the manifest summary. The same 64 files, 256 inventory entries,
16 KiB marked tails, 1 MiB total, depth four, 1.25-second collector / two-second
parent watchdog, private modes and four-failure/four-cleanup retention apply.
Process admission and argument/descriptor privacy are unchanged. Discovery
remains bounded: records outside the discovery batch are not guaranteed capture.

The new regression supplies twelve historical runs, a current pin older than
all the others, and two retention work directories. Both groups' journals,
stderr/status and the current worker/background log survive the 64-file cap.
[The old-collector control](diagnostic-control.py) fails with the current worker
journal omitted; the revised collector passes. This is a reproduced diagnostic
defect, not a reproduced macOS product stall.

The background test adds only a catch around the existing post-driver wait:
capture `post-driver-timeout`, then rethrow the same error. It neither retries
nor changes that 30-second bound. The separate 90-second drain predicate/guard,
FL identity-bound faults and Darwin fixture bindings remain intact. Linux loads
the revised case and skips its three Darwin variants; macOS must exercise this
new failure capture. LLP §15, both original ticket addenda and JOURNAL record
the evidence limits and the repaired capture selection.

## Verification

The shared Linux runner passes **100 tests, 32 Darwin skips**, no failures or
runner leaks: background **63/63 applicable** (379 s), wakeup/sleep/deadline/
publication **22/22**, diagnostics **6/6**, and FL signals **9/9**.
[Command receipt](evidence/suites.json), [full log](evidence/suites.log).
The direct diagnostic run also passes 6/6. The Darwin-only catch was added
while the suite was running; a subsequent focused load verifies the final test
file and its three platform skips, not Darwin runtime behavior.

Native retention passes **8/8**, parallel recovery **25/25**, and the sleep-clock
unit **1/1**. The prior intermittent recovery ticket remains open; one passing
run does not resolve it. No Rust source changed. Tests use the immutable
round-7 CLI (`da8d88838c98b49f1a417415587b07c8c52938fbc68955e19ef729af1ee551b3`)
and unit harness (`b59dcb53f433d86861315de449200bdd2cbeb09fb3e70e624fd1c4e2151d5870`)
with its matching sibling CLI. Commands, timings and native logs are retained
under `evidence/`; no qualification is claimed for a newly built native binary.

Both held-lease and missing-observer controls fail the unchanged 90-second
drain assertion, retain timeout snapshots, and then recover and clean their own
fixtures (182.42 s combined). [Control receipt](evidence/negative-current/result.json),
[runner](stalls.py). The earlier wakeup/sleep/deadline/publication mutation
binaries were not rebuilt this round; all 22 current regressions, including
their positive/stop controls, were rerun.

`./ref-check --verbose` with the repository root reports **zero errors**.
Two command setup mistakes are retained separately: the first stall invocation
referenced a script before copying it, and the first ref-check used the
Snapback 4 subdirectory as corpus root. Corrected commands passed; neither
setup error is a product-suite failure. [archive.py](archive.py) verified exact
bytes and private modes for **12 snapshots / 454 files** before removing only
this report's unpacked snapshots. The [archive](evidence/snapshots.tar.gz) and
[manifest](evidence/snapshot-manifest.json) retain the new controls and captures;
the supplied macOS archive remains separate and byte-identical.
