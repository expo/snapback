# Snapback 4 export maintenance queue did not drain after publication-handoff crash

Status: Open
Date: 2026-10-06
Scope: Snapback 4 Expo export maintenance / crash recovery tests
Related: LLP 3000.030 §15

RO Round 3's complete suite, with SDK implementation `63d6cf1400`, failed:

```text
export-background.test.mjs
maintenance crash matrix: publication-handoff (off, next Expo fails)
AssertionError: coalesced maintenance queue drained
maintenanceIdle:571; test:1022
```

The test killed the publisher after verified publication and before maintenance
handoff, then ran an export whose Expo fixture exits 23. Its 90-second
maintenance-idle guard expired; the subtest finished after 98.25 seconds.
The other crash-matrix cases completed. The full client pool reported 6,525
passes, three failures and 47 labelled skips; the other two failures were the
RO await census and the pre-fix replacement-account logout expectation.

Export maintenance code and this test are unchanged from Round 2 head
`929086afde`. The failed fixture's cleanup ran before investigation, so no
maintenance queue/process snapshot was retained. The cause is unknown; this
record does not establish a leaked process or attribute the failure to load.
Do not weaken the drain check based on this failure alone.

The entire export-background file is being rerun unchanged. Results will be
appended below. Evidence is in the
[RO Round 3 report](../snapback4/reports/20261006-ro-read-only/REPORT.md):
`evidence/round3-full-suite.log.gz` and `evidence/round3-export-rerun.log.gz`.

Next: retain queue records, maintenance log and owned-process liveness before
fixture cleanup on the next occurrence, then establish which queued transition
failed to settle. A passing rerun does not erase the full-suite failure.

Unchanged entire-file rerun: **58 passed, 36 platform skips, zero failures**
in 320 seconds. The failed crash case passed. The original failure remains
unexplained; keep this ticket open for snapshot capture on recurrence.


EM investigation, 2026-10-07: **still open; historical cause unclassified.**
The [retained report](../snapback4/reports/20261007-em-export-maintenance-drain/REPORT.md)
records 200 passing short invocations and eight passing complete-file runs,
additional focused/original-binary controls, then 32 passes per affected case
under four-core bursty CPU/disk load. The final instrumented complete file also
passes (58 passed, 36 platform skips). Grok subsequently identified an untested
wakeup candidate; passing repetitions do not resolve the original failure.

Drain failure now captures queue/lease/journal files, process/descriptor evidence
and maintenance step timestamps before fixture cleanup. Set
`SNAPBACK4_MAINTENANCE_EVIDENCE` to retain successful snapshots during a soak too.
The exact 90-second predicate rejects both a held-lease stall and pending work
whose fixture observer was killed; both snapshots are retained. No bound,
process-identity check, retry policy or product scheduling behavior changed.
Rebuilding a live Linux CLI contaminated early experiments with spawn ENOENT;
those failures are disclosed separately, and subsequent tests pin an immutable
binary. This does not establish the cause of the historical incident.
Next: use the retained diagnostics on recurrence, including the operator's macOS
soak, before assigning a cause or closing this ticket.


EM round 2: the [diagnostic hardening report](../snapback4/reports/20261007-em-export-maintenance-drain/round2/REPORT.md)
records bounded/private capture, birth/command/group admission and asynchronous
trace I/O that cannot block a custodian on a FIFO. These fix the instrumentation,
not the historical queue failure. The 90-second predicate remains unchanged.
Grok identified a pre-existing candidate: `kick_until`'s second `!runnable` check
can return success while its next lease is still held, allowing a newly committed
request to coalesce against an exiting holder. A guard unwind can similarly
follow a fresh producer's coalescing attempt (guard cancellation/expiry itself
is a documented stop). Neither candidate was reproduced or attributed to this
incident. Keep both in the next regression/audit; no queue fix is included here.


EM round 3, 2026-10-07: **still open pending macOS soak.** The
[round-3 report](../snapback4/reports/20261007-em-export-maintenance-drain/round3/REPORT.md)
now demonstrates both wakeup defects deterministically. A scratch binary with
the exit fixes removed reaches each forced coalescing window, leaves the request
pending with no observer, and fails the unchanged 90-second drain check. The
fixed binary drains both. These are demonstrated product defects consistent
with the symptom, but the missing historical snapshots still prevent attribution
to this incident.

An empty second runnable check releases the pending lease and rechecks in a loop.
A fresh producer that sees a busy lease records a bounded wakeup and retries the
lease before coalescing; a stopped observer releases custody before handing off
an unobserved wakeup using that producer's absolute deadline. Successful guards
consume the wakeup before observing work. Cancellation and expiry remain stops
without a fresh producer; the original sleep claim here was incomplete (see the
round-5 correction below). Automatic peer chains cannot renew their budget.
Debug barriers are inert in release. The original drain predicate/90-second
guard and round-2 diagnostic safety fixes remain unchanged; lane FL's shared
process-identity checks are untouched. Retained evidence and validation counts
are in the report. No push or publication occurred.

A loaded EM round-3 repetition also produced this drain assertion with a
**parked cleanup error**, `E_WITNESS_PROCESS: invalid /proc process group`.
The retained result/trace shows native work finished after 142 ms, cleanup
refused, and the claim parked before the observer exited. This recurrence is
linked to the existing [native inspection ticket](20261004-snapback4-native-witness-proc-group-inspection.md).
It is retained as a failure, not a successful soak or proof of either wakeup
race in the historical runs. Native ownership checks and the refusal to treat
parked maintenance as drained remain intact.


## 2026-10-08 — EM round 5 sleep-clock correction (still open)

Astra reproduced two ways the round-3/4 implementation could restart an intent
spanning sleep: producer retry checked only expiry, and successor entry took a
new sleep baseline after the old observer had validated the wakeup. The previous
sleep claim was too broad. Round 5 carries the original expiry and clock sample
together through retry, observer launch/entry and scan backup handoff. Each
receiver checks the inherited pair before consuming the notification or starting
work. A later fresh export still samples after sleep and can recover durable work.

The [round-5 report](../snapback4/reports/20261008-em-export-maintenance-sleep/REPORT.md)
retains injected-clock regressions and controls against round-4 retention code.
These simulate Darwin's clock predicate on Linux; they do not suspend a host or
identify the historical macOS cause. The unchanged 90-second drain check, the
original two wakeup fixes, FL's identity checks and bounded diagnostics remain.
Both commissioned tickets stay open while the operator's macOS soak proceeds.


## 2026-10-08 — EM round 6 later-deadline correction (still open)

Grok identified two further orderings: an idle success could spawn before
rereading a later wakeup, and a live guard could consume that wakeup while
retaining its older deadline. The round-3 handoff claim and the round-5 phrase
that the deadline survived were too broad. Round 5 preserved the sleep sample
of the selected intent, but did not ensure adoption of this later intent.

Round 6 adopts a strictly later valid expiry and its original sleep sample
before observer launch and before notification consumption. The accepted pair
updates the live observer and its successful handoff. An atomic receipt prevents
consumption from erasing a concurrent producer replacement; a refused guard
leaves the receipt available after lease release. Equal, earlier, expired or
crossed-sleep notifications cannot extend observation. A new accepted intent
resets the monotonic ceiling without recomputing its absolute expiry.

The [round-6 report](../snapback4/reports/20261008-em-export-maintenance-deadline/REPORT.md)
retains deterministic cases and controls for both orderings. The unchanged
90-second predicate must still fail stranded work. A fresh producer does not
guarantee recovery after every later stop or failure: consumed/expired intent,
launch/I/O errors, retry exhaustion and simultaneous peer death retain their
existing backstop limits. No historical attribution or macOS qualification is
claimed. This ticket remains open for the operator's soak.


## 2026-10-08 — EM round 7 producer ordering (still open)

Astra reproduced a further lost wakeup at round-6 head: an older producer
paused before its unconditional publication, a newer post-sleep producer
successfully coalesced, and the older producer then erased that valid intent
with its crossed-sleep pair. The old producer rejected its retry and the holder
rejected the remaining wakeup; pending work failed the original 90-second drain
check. Killing the older producer before publication let the request drain.

Round 7 serializes producer compare/publication with a short kernel lock,
validates the publisher there, and preserves equal or later valid intent from
either the wakeup or receipt. Consumers keep their receipt protection and never
wait on this writer lock. Producer acquisition checks cancellation/sleep/expiry,
waits at 20 ms intervals and explicitly refuses after five seconds, preserving
the request. Writer death releases the lock. No work, drain or diagnostic bound
was relaxed. The [round-7 report](../snapback4/reports/20261008-em-export-maintenance-publication/REPORT.md)
retains the regression, control, old-code failure and remaining checks.

The operator reports the round-4 macOS soak passed: wakeup 6/6 and six background
runs at 95/95, with no drain timeouts. Those results are recorded as supplied;
this lane did not access the mini or rerun them. They qualify neither the later
rounds nor the cause of the historical failures. This ticket remains open.

## 2026-10-08 — EM round 8 macOS soak evidence (still open)

The supplied `affcd4919b` soak passed wakeup 21/21 and background run 1 at
95/95; run 2 was 93/95. The unchecked process-table listing is assigned to FL
round 10. The other failure was the separate 30-second post-driver wait, before
`maintenanceIdle`: its later snapshot has a live observer and claimed scan,
with the fresh wakeup already adopted/consumed. Missing custody logs prevent
attributing the subsequent wait to compression, native cleanup, host delay or
clock behavior. Unchanged native paths do not prove the incident is pre-existing.

[The separate macOS incident](20261008-snapback4-macos-post-driver-retention-wait.md)
retains the exact snapshot and evidence limits. Round 8 fixes capture selection
under the existing caps, records the initial post-driver timeout before cleanup,
and covers small injected clock drift with the unchanged tolerance. Product
code, the drain predicate and its 90-second guard remain unchanged. This ticket
stays open pending further macOS evidence; no historical cause is claimed.

## 2026-10-08 — EM round 9: macOS deadline parking and fixture priority (still open)

The six-run soak of `e408e47929` passed wakeup 22/22 and five background runs
95/95; run 6 was 94/95. Its retained drain-timeout snapshot shows a delivered
wakeup, a claimed scan, 39 compression commits, then the explicit 30-second
work deadline and a parked claim. Cleanup completed at 30.936 s; no queue
lease was leaked. The drain check correctly refused the remaining parked work.

Darwin's `taskpolicy -b -c background` reaches the observer/scan and proof
worker/driver, then their retention supervisor, worker and gzip descendants.
The 15.782-second initial gap and slow compression are consistent with CPU/I/O
throttling; the archive does not contain kernel throttle counters. Production
priority, parking and next-export recovery stay unchanged. Automatic progress
continuation would need a reliable progress receipt and retry/cleanup semantics;
lossy diagnostic events cannot authorize another work budget.

A debug-only, exact-value fixture override now skips the two launch sites'
background policy; semantic assertions, fault dispatch and both wait bounds
stay unchanged. Separate Darwin tests require policy 1 with the override
removed and policy 0 with it set. Linux validates command selection and release
inertness; the operator will run the real Mac policy probes and soak. This
snapshot does not attribute every earlier timeout. Keep this ticket open until
that qualification, along with the other maintenance/incident tickets.

[Round-9 evidence, implementation, controls and exact mini commands](../snapback4/reports/20261008-em-export-maintenance-priority/REPORT.md).
