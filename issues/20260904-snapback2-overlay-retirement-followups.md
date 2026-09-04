# Snapback 2 twin: overlay retirement follow-ups from the third review round

**Status:** Open
**Systems:** snapback2 client (`packages/snapback2/src/store/{overlay-retirement,range-store,canonical}.ts`, `src/types.ts`)
**Date:** 2026-09-04
**Related:** ticket 20260904-snapback2-twin-overlay-retirement-hazards (closed by lane T1 after three review rounds); LLP 1012 §7 (the retirement record); reviews `t1-r3-{astra,muse}.md`

## Findings (third round; the lane's limit)

1. **`types.ts`'s `stableSerialize` is a second serializer** (Muse M1), textually identical to
   `store/canonical.ts`; one function, one import.
2. **`overlayNegatives` survive `resetCoverage` without a generation tag** (Muse M2); the
   tombstone-across-reset test pins the current behavior; tag them with the coverage
   generation or clear them with the reset, consistent with lane T2's rule for
   `state.negative`.
3. **A retained denied page can still count as authoritative page arrival** (astra 1): exclude
   denied answers from the page-of-the-selected-log evidence.
4. **The recorded-cursor precedence test uses an owner that accepts engine-invalid arguments**
   (astra 2): re-pin against the real owner or a fake that refuses them.
5. **A full delivery at a conditionally refreshed sequence is still falsely rejected as
   conflicting** (astra 3): the conditional-refresh seq advance must not make a later full
   delivery at that seq a "conflicting row".
6. **Non-array object projections cannot prove a tail page** (grok r3 M3): array scalars count
   as page evidence, but an object projection with no `$row` in `data` still cannot; either
   count its rows through the receipt or record that a drained log must page as an array.
