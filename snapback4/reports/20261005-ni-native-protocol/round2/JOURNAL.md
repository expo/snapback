# NI Round 2 journal — 2026-10-05

This is the companion entry for the native instrument qualification work;
the existing large Snapback 4 root journal remains unchanged. There is no engine,
sync, rule or meter change, and this is not a Snapback or Convex application build.

Both supplied round-1 reviews were read in full. The confidentiality proof now
binds the prime fixture, native frame, both screenshots and the reopen attempt.
A later cache load invalidates the earlier receipt through backend readiness.
Video validation decodes the actual retained video independently. Every read
receipt requires current native and server corroboration plus the latest
committed screen. Search supports a later successful poll and a target initially
outside the viewport. Bob waits for actual expected identity and bodies within
ten seconds. The diagnostic backend isolates consumption and ordering state.

The useful lesson from the live runs was that a committed read screen can be
older than the receipt window while still accurately describing the final UI.
Requiring a new event created another false failure. The correction accepts the
latest committed state only when the native snapshot and authoritative server
sample agree inside the window. A newer contradictory screen still rejects.

Fresh source review also exposed a buffered-load gap at backend readiness.
The fix drains the journal again before closing the guard and uses both sequence
and timestamp boundaries in exported validation. The new reproduction is retained.
The tests exercise actual reconnection; replacing it with a no-op now fails.

The [report](../REPORT.md#round-2--remaining-false-passes-and-false-failures)
and [reproduction table](./reproduction-coverage.md) contain the final matrix,
checks and costs. Every original attempt retains its own source identity. Raw
packets and logs are archived off-repo with a committed hash index. Only the
Apartment mini's dedicated simulator was used, with sourced environment and
scratch removed after verified export. No push or scored calibration is made;
Phase 2 remains separate and unexecuted.

## Interrupted-session continuation

The item-by-item audit preserved all five existing commits and identified the
missing final-source matrix, report and archive closeout. A fresh M8 run exposed
a further false failure: AVFoundation's presentation-order output coalesced
seven repeated timestamps, producing 1,337 images for 1,344 encoded samples.
Reading compressed samples and decoding each synchronously through VideoToolbox
restores the full count without weakening the timing or endpoint checks. A small
ten-sample fixture with one repeated timestamp now prevents that regression.
The final source checkpoint is `66763bd85845c35664d983b4e3a52de4e5355c09`.
The original failure retains its original null verdict and source identity.
