# Snapback 2 twin: overlay retirement follow-ups from the third review round

**Status:** Resolved (2026-09-06; findings 1–5 fixed or fixture corrected, finding 6 disproved under the current certified resume contract)
**Systems:** snapback2 client (`packages/snapback2/src/store/{overlay-retirement,range-store,canonical}.ts`, `src/types.ts`)
**Date:** 2026-09-04
**Related:** ticket 20260904-snapback2-twin-overlay-retirement-hazards (closed by lane T1 after three review rounds); LLP 1012 §7 (the retirement record); reviews `t1-r3-{astra,muse}.md`

## Findings (third round; the lane's limit)

1. **Resolved: `types.ts`'s `stableSerialize` was a second serializer** (Muse M1), textually identical to
   `store/canonical.ts`; it now imports and re-exports that function.
2. **Resolved: `overlayNegatives` survived `resetCoverage` without a generation tag** (Muse M2);
   reset now clears them with `state.negative`, preserving intent custody and requiring fresh evidence.
3. **Resolved: a retained denied page could count as authoritative page arrival** (astra 1): retained
   answers are excluded from selected-log page and continuation evidence.
4. **Resolved: the recorded-cursor precedence test used an owner that accepted engine-invalid arguments**
   (astra 2): replaced by a real-owner test, including refusal of the wrong spelling.
5. **Resolved in the reconnect lane, 2026-09-06: a full delivery at a conditionally
   refreshed sequence was falsely rejected as conflicting** (astra 3). See the
   reproduction and resolution below.
6. **Closed as not reproducible through the certified resume contract: non-array object projections cannot prove a tail page** (grok r3 M3).
   A selected resume log returns a certified page, including an array of projected objects;
   an outer object wrapper is not certified as a page. See the real-owner proof below.

## Remaining findings: independent reproduction and resolution (2026-09-06)

Against base `6b0a8e2937d3754e575aba9b2ffe51cee0c7b1ef`, the new regression cases
in `overlay-retirement.test.ts` fail before the fix: a primary absence or tombstone
saved while queued survives a reset/reopen and falsely retires the delayed committed
terminal; a previously complete delivered-history tail, re-delivered as denied,
falsely proves arrival once a fresh link reaches its position. Reset now clears the
saved negatives with the other coverage facts, preserving intent and overlay; a
fresh negative at the same data sequence can retire the prediction. Retained pages
no longer prove authoritative arrival or continuation. The regressions exercise
file and IndexedDB custody and cold reopen.

The old cursor test's changing manifest retained the same generation while its fake
owner accepted either argument spelling. The replacement in `real-owner.test.ts`
drains and reopens a certified `after` query with a second nullable `label` argument,
then perturbs only the runtime metadata fallback during settlement. The owner keeps
the actual certified program throughout, refuses an extra `c` argument, and receives
the stored `after` name with its own minted cursor. A controlled removal of recorded-name
precedence fails this test with `E_INPUT: unknown operation args: c`. A separate real-owner case
proves scalar-field projected pages, whose data contain no `$row`, retire via a
held cursor chain after reopen.

Finding 6's synthetic object-tail allegation does not describe a current resumable
log: `certificate/page.rs` tracks page/merge origins and one-to-one collectors;
the existing compiler test explicitly asserts that an outer object wrapper has no
`result_pages`. The real-owner fixture certifies such a wrapper as an ordinary
query, returns `next: null`, and refuses `/api/resume.log` with HTTP 413,
`E_OFFLINE_RESUME`, `returns no page`. Supported arrays of projected objects still
work. No receipt fallback for an impossible selected-log shape was added, and no
supported projection was removed. Wrapped-page cursor semantics would be separate
feature work; this resolution makes no claim to implement them.

Validation: 183 affected client/store/real-owner tests pass at their original 10 s
test timeout, including the existing fingerprint, authority, supersession, byte
custody and replay regressions. The batch uses the named M5 lane and its private
build cache. `caps` and `ref-check --verbose` pass. No running benchmark app, diary,
or scoring record was consulted.

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
