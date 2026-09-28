# Snapback 4 IndexedDB witness assumes orphan recovery finishes in open

Status: Open
Date: 2026-09-28
Owner: Snapback 4 browser witnesses

`node witness/idb.mjs` exits 1 on merged main
`1972112a04fc03ece3423fbd4af67646f0cd5826`: its durability result reports
`adoptionRejected: false` and `adoptionUnlocked: false`. All other assertions
in that run pass. The same failure occurs with lane SS round 4's journal split.

The witness injects a failed destination outbox put, then expects
`opener.open(base, backend)` itself to run orphan recovery, reject, and release
both locks. Current `web.ts` defers `recoverOpening()` to the first device call
or authority attachment. The unexpected successful open is then abandoned by
the witness without closing it, so the next open also uses an alternate store.
This is an obsolete timing expectation and leaked test owner, not evidence of
a failed strict transaction being published.

Update the witness to force the deferred recovery call and close its owner,
retaining assertions that the aborted destination contains no adopted outbox,
the orphan survives, locks release on close, and the next recovery succeeds.
Do not change the production opening/authority protocol to satisfy the old
test assumption.

Reproduce from `snapback4/` after normal wasm, package and debug CLI builds:
`node witness/idb.mjs`. The round-4 baseline control substitutes only
`origin/main`'s original `web.ts` and `web-journal.ts` through the existing Vite
source override hook, using the same compiler/server/wasm. Both raw outputs
and the pinned control script are linked in
[ROUND4.md](../snapback4/reports/20260927-ss-sync-scale/ROUND4.md).
