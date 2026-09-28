# Reduce cold web acquisition and navigation for a large account

**Status:** Open
**Systems:** Snapback 4 web device, IndexedDB, acquisition
**Date:** 2026-09-28
**Related:** LLP 3000.019; Lane RG

Calibration #24 reported 14.1 seconds for u0500 (500 follows, 100 conversations).
Lane RG reproduced 5.40 seconds on published 0.4.6 and 5.32 seconds on its
starting main, on a different Linux host. The final receipt fix measures 5.89
seconds; it does not claim to have fixed the cold path.

The final measured breakdown is 97 ms initial document, 108 ms entering
credentials, 4,453 ms login through the first feed, 1,220 ms full-document
navigation to the conversation, and 15 ms remaining acquisition. The login HTTP
request itself takes 25 ms. Initial sync delivers roughly 5.37 MB, including
the following feed, reactions, own likes and memberships, plus 500 messages.
The cold Chrome CPU profile samples about 711 ms in wasm, 1,508 ms in JS,
266 ms in GC and 2,655 ms idle; these are sampled thread states, not independent
critical-path phases.

Investigate durable cold installation and reopening after full navigation,
including media reconciliation and the interaction with acquisition. Preserve
publication, custody, expiry, authorization and ready-state guarantees. Do not
declare readiness before the existing acquisition contract is satisfied.
No additional cold-path change was justified as a cheap receipt-lane fix.

Evidence and reproduction are in
[Lane RG's report](../snapback4/reports/20260928-rg-receipts-at-scale/REPORT.md),
particularly `fixed-guide-measurements.json`, the network trace and CPU profile.
Acceptance: repeat that cold path on a fresh device with the same copied store,
attribute each wait, and show an improvement without weakening acquisition.
