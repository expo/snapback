# Snapback 4 local reads: an unsequenced server-only reply discharges a changeCut in ordinary mode (undisclosed default-path change)

Status: Closed
Date: 2026-10-30
Scope: progressive web startup (LLP 3000.002.000 §7.2); progressive becomes the web default under the author's 2026-10-30 ruling, so this is default-path exposure once Lane D lands
Source: Fable, Lane B verification pass, Low, recorded after the Lane B landing (68b3e2f829)

`local-reads.ts` `unchanged` branch (introduced by Lane B) applies in ordinary, non-progressive mode whenever a `/q/` reply lacks `seq` and `head`. Harmless if the server always sequences replies; the lane's reports disclosed only the `hide()` reorder as a default-path change.

Fix: either restrict the branch to progressive mode or document it as a default-path change with a test against an old unsequencing server.

Landing posture: Lane B landed after four blind fix rounds; the author ruled "land it and make it the default and then keep
working on ironing out all bugs in it", so this ticket is bug-ironing work (Lane E), not a landing veto.

Resolution: fixed in Lane E round 1. Restrict unsequenced unchanged-response acceptance to progressive startup, including presence refresh; awaited mode retains its previous cut requirement.
Proof: progressive-writes.test.mjs:708 — old unsequencing server cannot discharge an awaited-mode notified change cut. Existing progressive legacy-response test remains. Negative control: snapback4/reports/lane-e1/negative-unsequenced-v2.log.
