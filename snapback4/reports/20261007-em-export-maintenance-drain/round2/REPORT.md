# EM round 2 — bounded diagnostics, 2026-10-07

All three required Astra changes are addressed. This fixes a **round-1 diagnostic
bug** that could block a debug observer on a FIFO, plus unbounded snapshot growth
and disclosure through stale process records. It does not identify the earlier
intermittent drain failures. The queue/retention decisions, process-custody
semantics, drain predicate and 90-second guard remain unchanged. All three
investigation tickets remain open. Nothing was pushed or published; work stayed
in lane-em on eb1000.

The received Astra verdict is **READY WITH CHANGES**, preserved with its full
review in `evidence/astra-review.*`. Grok also returned **READY WITH CHANGES** during this round; its received text is
in `evidence/grok-review.md`. Its audit correction is adopted below and its lsof
concern is removed with the unrestricted Darwin descriptor collector. Neither
review is a post-fix approval of this revision.

## Changes

| Concern | Resolution |
| --- | --- |
| Whole-file copies and unlimited retention | Disposable collector copies marked tails of at most 16 KiB, up to 64 files. Inventory caps at 256 entries/four directory descents; all output file bytes cap at 1 MiB per snapshot. Queue records and trace/log files are prioritized. A 1.25-second collection budget is enclosed by a two-second asynchronous parent watchdog. |
| Accumulation and permissions | A nonblocking collector lock protects a checkout-specific namespace. It retains four failure snapshots and four cleanup snapshots; successful captures cannot evict failures. Directories are 0700 and files 0600. Other checkouts' namespaces are never pruned. |
| PID reuse and sensitive process output | Birth must match before command inspection; the command must bind to this fixture and the process must belong to its test group or a birth/command-verified native group. Direct-child discovery on Linux uses the same fixture/group checks. Admission is checked again around descriptor capture. No bare maintainer PID grants admission. Rejections retain a PID/reason only. |
| Process data bounds | At most 24 processes, eight fixed verbs/redacted fixture arguments, and 16 descriptors each. Outside-fixture targets are redacted. Descriptor flags and at most two bounded lock rows are retained; no full command line, environment, raw stat/status dump, or unrestricted lsof output is persisted. Darwin uses libproc birth identity and omits descriptors. |
| FIFO or stalled trace I/O | The native custodian only offers events to a bounded 32-slot channel with `try_send`. An unjoined background thread does all trace filesystem work and receives no custody descriptors. A blocked writer cannot block a deadline check, maintenance lease release or native cleanup. Its sink must be an owned, singly linked regular file; open uses NONBLOCK/NOFOLLOW/CLOEXEC. A nonblocking diagnostic flock bounds concurrent append growth. |
| Trace accumulation/release work | Trace lines cap at 4 KiB and the file at 256 KiB with an explicit truncation record; already oversized files receive no further writes. Full channels, contention and process exit can drop events. Both emitter and argument evaluation are compiled out of release builds. The extra diagnostic `pending()` filesystem probe is removed. |
| Test-side diagnostic blocking | Drain timing uses a 64-event memory ring. The helper no longer opens the fixture trace file. Snapshot filesystem/probe work runs in a disposable child, leaving the event loop live. The watchdog terminates only that owned child, closes its pipes and does not wait for shutdown; the original assertion survives capture refusal or timeout. |

The collector is test-only Python (already required by export-background's lease
fixtures), invoked by the existing test helper. The shared export-background file
has one additional `await` at its existing post-custody cleanup capture hook.
Lane FL's process-identity checks are untouched. Native trace files live outside
the retained run trees; no published package inputs, wasm or SDK code changed.

The separate two-second snapshot watchdog is **not** extra time for maintenance
to pass: capture starts after the original drain assertion has failed. The test
awaits this bounded capture before deleting evidence. Native custody never awaits
it or the trace writer. Snapshot observations remain non-atomic and can be
incomplete; limits, omissions and rejected identities are recorded. Busy capture
or timeout is reported as skipped, never as successful maintenance.

## Regressions and validation

- A synthetic 16 MiB log is reduced to a marked tail below 16 KiB. A 400-file
  fixture exercises inventory, file and aggregate byte caps. Repeated successful
  and failing captures leave exactly eight snapshots, retain the latest failure,
  and verify 0700/0600 permissions throughout the snapshots.
- A stale birth record, a current birth with an unrelated command, and a current
  fixture command in an unapproved group all refuse process/descriptor capture.
  A real owned Python lease holder is captured. Synthetic token arguments on all
  four processes appear nowhere in the snapshot.
- A real observer with a 1.5-second supplied observation expiry and a FIFO trace
  sink exits at its deadline and releases its actual queue lease. The test-side
  drain wait also ignores the FIFO. Against the round-1 binary, that exact test
  fails: its four-second watchdog must kill the blocked observer. That negative
  result is retained separately and is expected.
- A fake collector that sleeps for 60 seconds is stopped at the two-second bound;
  event-loop ticks continue and the original drain error object is rethrown.
- Partial file writes followed by I/O errors consume their reserved byte/file
  budget, so errors cannot permit additional output beyond the caps. A separate
  fault-injection regression exercises that limit.
- The Rust trace-sink regression refuses a symlink, preserves the target, enforces
  the collective file bound/truncation marker and verifies private permissions.

The first complete export-background rerun passed **58 tests / 36 Darwin skips**,
zero failures/cancellations, in **294.69 s**. Both actual 90-second controls reject
with the original drain assertion and subsequently clean up (182.33 s combined).
The first bounded snapshots retain a live observer plus its owned lease holder,
versus no process for the deliberately stranded request. The second whole-file run passed **58 / 36 skips** in **306.60 s**; both controls
again rejected correctly. Final counts, timing, source identities and the later
focused budget-fault verification are recorded in `evidence/results.json`.
The final raced-deferral integration case passes in **8.08 s** after the budget
fault refinement. The diagnostics file passes **five tests**, including that
partial-write fault injection. Rust passes **three retention checks** (including the new trace test) and **14 recovery checks** (ten recovery
plus four Linux process-inspection tests). Debug build and release `cargo check`
pass. Reference, syntax and whitespace checks are retained with the evidence.

Native and fixture guards are unchanged. The controls do not shorten or replace
`maintenanceIdle`. The negative-control script only changes snapshot discovery
to recurse into the new bounded namespace. The five FIFO/capture regressions
are a separate test file, keeping shared export-background edits merge-friendly.
There is no macOS execution claim; the operator's macOS soak remains the next
source of evidence about the historical failure.

## Grok audit correction: open wakeup suspects

The earlier report overstated the ordinary exit/request audit. In `kick_until`,
the first runnable check precedes lease acquisition; the second is under the
lease. Another scan can cover the earlier work in between. If the second check
finds no work, a preemption before the successful return releases the lease can
allow a producer to commit a new request and coalesce against that exiting
caller. There is no subsequent recheck on that success path. This is a concrete
code-level candidate for a stranded request, not a reproduced historical cause.

Grok also noted coalescing immediately before an observer's guard error unwinds
its lease. Cancellation, sleep and expiry are documented stop conditions; the
interaction with a fresh coalesced request remains worth an explicit regression.
No new product behavior is inferred from the passing soaks. The parent report
and ticket addenda now state these suspects. An append-only JOURNAL correction
supersedes the earlier audit statement. A product correction and deterministic
interleaving regression belong to the continuing open investigation; this
commissioned diagnostic revision changes neither scheduling nor retry decisions.

## Evidence and continuation

`evidence/results.json` binds final source/binary hashes, commands, results,
negative controls and retained archive checksums. Raw TAP and Rust logs are
compressed without changing bytes. Snapshot archives preserve private entry
modes and the collector's manifests. Because runtime retention is intentionally
bounded, whole-file evidence keeps the latest four cleanup snapshots, not every
successful fixture. Both control failures survive their subsequent cleanup.
The earlier round-1 cohort archives and their measurements are unchanged.

The existing macOS command in the parent report still applies. Build once and
point `SNAPBACK4_EXPORT_TEST_BINARY` at a stable copy. With
`SNAPBACK4_MAINTENANCE_EVIDENCE` set, the helper reports the retained snapshot
path under its checkout namespace. Preserve that directory on the next genuine
failure before later failures rotate it out. Queue/result records, bounded trace
tail, `processes.json`, `test-drain.jsonl` and the omission inventory supply the
next diagnosis; no timeout increase or scheduler correction is claimed here.
