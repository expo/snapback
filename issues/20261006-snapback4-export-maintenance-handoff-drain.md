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
