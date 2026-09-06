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
5. **Resolved in the reconnect lane, 2026-09-06: a full delivery at a conditionally
   refreshed sequence was falsely rejected as conflicting** (astra 3). See the
   reproduction and resolution below; the other findings keep this ticket open.
6. **Non-array object projections cannot prove a tail page** (grok r3 M3): array scalars count
   as page evidence, but an object projection with no `$row` in `data` still cannot; either
   count its rows through the receipt or record that a drained log must page as an array.

## Finding 5: published M6 evidence and independent reduction (2026-09-06)

The immutable packet at
`~/clique-improvement/revisions/reconnect/evidence/README.md` records
snapback2@0.0.6 refusing `chats.inbox` at seq 1754 during offline-send
reconnect, leaving the send pending. It preserves the SDK hash and throw
site, but no response bodies or full SDK stack. Its suggestion that replacing
a membership reference with a joined object caused the failure is unconfirmed.
The running benchmark app was not used for this investigation.

Against integrated `21b21abd361c72fb7da968a0ae06ed82ef7436cc`, the real-owner
test holds a nonempty page, commits an unrelated post, obtains `unchanged`,
queues an offline send, and reconnects. The nonempty resume log returns a
full envelope even when its validator matches. The original and resumed
envelopes differ **only in seq**: data, rows, receipt, validator, next,
generation, schema, plan, and authority match. The old fingerprint still
contains the original seq while the held answer has the refreshed seq,
causing the exact conflicting-deliveries refusal before outbox replay.
This reproduces for nested joins replacing a reference, joins under another
alias, and a plain page. The test adapts the preserved shape to the existing
delivery-log fixture; it does not reconstruct the unavailable original app.

The store now compares the incoming full content at the persisted original
full-delivery sequence (`nextSeq`), then installs an equal envelope normally
at the refreshed sequence. All content fields remain bound; row conflicts
across queries remain checked. Full delivery renews continuation evidence;
conditional refresh alone does not. Existing snapshots retain their digests
and need no format change, cache clearing, or reconstruction from held rows.

Regression coverage is in existing `real-owner.test.ts`, `store-review.test.ts`,
and `overlay-retirement.test.ts`: queued-send settlement against the real
owner, reopen on file/IndexedDB/SQLite carriers, changed-content refusal,
cross-query row equivocation, idempotent duplicates, late older frames,
and continuation-based overlay retirement. The real-owner cases fail before
the fix and pass afterward. This establishes the product defect and fix;
the exact cause of historical seq 1754 remains limited by missing raw frames.
