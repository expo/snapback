# Snapback 4: guarded delivery acceptance — reclamation test and failed-fence retry

**Status:** Open
**Impact:** 2
**Urgency:** 2
**Ease:** 4
**Confidence:** 4
**Systems:** Snapback 4 — the SDK delivery queue (LLP 3000.022 §4) through the app facade (LLP 3000.023), `packages/snapback4/src/delivery-acceptance.ts`, `read-approval.ts`
**Date:** 2026-09-27
**Related:** lane DC round 13–14 reviews (`dc-r13.grok`, `dc-r14.astra`), `snapback4/reports/20260927-dc-delivery-client/ROUND14.md`

## Summary

Two Lows remained when DS and DC landed. Neither is a production defect that has been observed.

1. **Pending-manifest reclamation is untested.** A guarded client keeps each answer's manifest pending until the facade approves it. Approval deletes the entry. Supersession, withdrawal, expiry and credential or incarnation changes only invalidate it, and garbage collection reclaims it through the `WeakMap` key. Astra's probe created 10,000 refused, superseded answers, dropped them and forced GC; no identity remained.

   But changing the `WeakMap` to a `Map` at `delivery-acceptance.ts:6` passes all 29 facade tests, while the same probe then retains all 10,000.

   **Fix:** add an isolated `--expose-gc` lifetime test with weak references, releasing refused and superseded snapshots before checking reclamation.
2. **`approve` ignores a failed delivery fence** (`read-approval.ts:108`, and the early return at `:57`). A one-shot `query` turns that failure into `{loading: true}`. `observe` still publishes the snapshot and keeps the callback, and a later approval of the same identity does not retry collection.

   **Fix:** retry collection on a later approval of the same identity while its fences hold, or record why not.

   Test a credential or incarnation change in that window.
