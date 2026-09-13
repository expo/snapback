# Snapback3 acquisition SDK review, r1

Reviewed the exact source hashes in `inputs.json`. The focused acquisition tests passed 11/11 and `bun run check` passed.

## Material findings

1. **A transaction-rejected acquisition write is reported as durable.** `resource/storage.ts` admits an acquisition patch only when its principal, auth epoch, generation, schema, and sequence floor still match, but both memory and IndexedDB adapters resolve normally when that predicate fails. `client.ts` then publishes the staged pool and resolves `completed`. A second tab can advance the shared acquisition floor while the first tab holds an old response; the first tab does not observe that floor change, its write is discarded, and it still exposes an in-memory ready dataset. Reject the whole storage transaction when an acquisition patch is inadmissible, so publication remains downstream of a successful durable admission. Add a delayed two-client/shared-storage floor race.

2. **Accepted generation replacement does not reset durable acquisition authority.** `storage.ts` resets acquisition state only on session replacement, so an A→B→A generation sequence can retain and later reuse old A ready metadata without fresh validation. Inspection of `Runtime.apply_successor` and `Store.commit_seq` confirms that an ordinary successor preserves the store's monotonic commit sequence; a lower-sequence manifest must therefore remain stale. For an accepted generation/schema transition at the current or a newer sequence, atomically install the new manifest while clearing durable acquisitions and resetting their floor to that manifest sequence. Add A→B→A plus offline reopen coverage.

3. **Registering a changed declaration does not withdraw its old published pool.** `client.ts` seals the same-id handle when revision/root changes, but the old `acquiredFacts` entry remains readable until replacement succeeds. Startup also restores a ready pool before the registered current declaration is checked. A scope-narrowing v2 declaration made while offline can therefore leave v1-derived pages readable indefinitely. Withdraw that id immediately, validate registered identities before startup restoration, and durably replace its metadata before returning the offline/network error. Keep other acquisition ids available.

## Remaining API and test limits

- `DatasetAcquisition.completed` is one deferred promise. A transient failure rejects it permanently even if `resume()` later reaches ready; after initial readiness, later revalidation cannot give `completed` a new cycle meaning. The public lifecycle semantics need an explicit decision and cancel/resume/network-recovery tests.
- A same-sequence generic invalidation now increments `acquisitionEpoch`, so an old in-flight response fails `assertCurrent` and queues a rerun. There was no focused test of that behavior in the reviewed snapshot.
- Acquisition response arrays and the decoded HTTP body have no SDK-side aggregate cap. Individual full envelopes have a 5 MiB decoder cap, but an untrusted endpoint can send arbitrarily many pages/continuations or a compressed oversized body before structural validation. Enforce the owner contract (`pages <= 16`, bounded continuations and unique continuation identities) and a response-body ceiling in a later hardening slice.
- Full acquisition pages are decoded twice: `decodeDeliveryMessage` validates a full envelope and `ownDeliveryEnvelope` immediately clones and validates it again. This repeats serialization and deep traversal in the performance-critical path. Measure and replace with a one-pass owned-message decoder if it remains material.
- Ready-state restoration proves authority, one sequence, and presence of listed resources, but it does not reconstruct every declared cursor chain or prove the resource-key set is exactly the reachable set. Corrupt or stale ready metadata can therefore overstate completion. A tampered ready checkpoint test should precede treating browser storage as an integrity boundary.
- No meaningful focused tests cover malformed or oversized acquisition replies, duplicate/dishonest continuations, cancellation settlement, same-sequence network recovery, auth-epoch change without principal change, or IndexedDB upgrade/lost-write behavior. The delayed logout test does cover an old account response and durable byte removal.

## Performance observations

Every response clones the cumulative resource and row maps before validation, and cursor walks repeatedly rebuild and decode stored envelopes. These are plausible quadratic residuals for large datasets. Keep the correctness boundary first, then profile the integrated endpoint before changing representation or the 20 ms owner budget.
