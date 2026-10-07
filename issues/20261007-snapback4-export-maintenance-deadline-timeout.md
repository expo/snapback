# Snapback 4: skipped export maintenance deadline test times out

Observed during RX round-1 qualification on eb1000, 2026-10-07. Open;
cause and baseline reproducibility are unconfirmed.

`packages/snapback4/test/export-background.test.mjs:532` was cancelled at its
120,000 ms test timeout in the full 24-file client pool. The case is
`skipped maintenance never blocks publication and drains under deadline (off)`.
Its contract includes the real 30-second retention deadline, owned compression
group cleanup, exited custodians and five full/twenty compressed retained runs.
The log has no assertion stack identifying which step or cleanup await held.
The file completed with 57 passes, one cancellation and 36 platform skips;
the runner confirmed cleanup of the file's owned process group.

The test and exporter paths are unchanged by RX. This is distinct from
`20261006-snapback4-native-export-status-intermittent.md`, which records a
different exit-status assertion. Published 0.4.13 is not a valid control for
the current export-maintenance protocol, so no baseline claim is made.

The complete file then passed through the normal serial runner: 58 passed,
36 platform skips, no failures/cancellations, 309 seconds. This establishes an
intermittent outcome, not its cause; keep this ticket open. No implementation,
deadline, assertion or test count changed between runs.

Evidence: [first failure](../snapback4/reports/20261006-rx-rule-hops/round-1/export-background-first-failure.log),
[complete rerun](../snapback4/reports/20261006-rx-rule-hops/round-1/export-background-rerun.log.gz)
and [RX report](../snapback4/reports/20261006-rx-rule-hops/REPORT.md#round-1--legacy-identity-and-merged-qualification-2026-10-07).
Reproduce from `snapback4/` using
`node scripts/run-client-tests.mjs 1 files packages/snapback4/test/export-background.test.mjs`,
or select the exact case with Node's `--test-name-pattern` flag. Keep the real
deadline, existing assertions and full-count qualification unchanged.

Next: preserve the fixture's maintenance log and custody records on timeout
to identify whether deadline enforcement, group observation or final cleanup
failed to progress.


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
