# Snapback 4 progressive writes: inspection completion reschedules every loading watch, not only custody-parked ones

Status: Closed
Date: 2026-10-30
Scope: progressive web startup (LLP 3000.002.000 §7.2); progressive becomes the web default under the author's 2026-10-30 ruling, so this is default-path exposure once Lane D lands
Source: Fable, Lane B verification pass, Low, recorded after the Lane B landing (68b3e2f829)

`local.ts` reschedules every watch whose snapshot is `loading` when journal-custody uncertainty clears (five or six refresh cycles per write), re-running watches that are loading for unrelated reasons, including in-flight server fetches. Bounded by notification count; extra `/q/` traffic only. The companion ticket about watches retaining data (Astra, inspection-completion-misses-retaining-parked-watches) asks for an explicit set of custody-parked watches; that set resolves both.

Fix: track custody-parked watches explicitly and wake only those.

Landing posture: Lane B landed after four blind fix rounds; the author ruled "land it and make it the default and then keep
working on ironing out all bugs in it", so this ticket is bug-ironing work (Lane E), not a landing veto.

Resolution: fixed in Lane E round 1. Wake only that explicit set, leaving unrelated in-flight loading fetches alone.
Proof: progressive-writes.test.mjs:699 — inspection completes while an unrelated server fetch is held; exactly one fetch. Negative control: snapback4/reports/lane-e1/negative-parked-v2.log.
