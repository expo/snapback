## Verdict

**CHANGES REQUIRED.** Three P1 false-ready/cycle blockers remain. No tests or benchmarks were run; implementation-team validation claims were not treated as reviewer evidence.

## Confirmed blockers

1. **P1 — Changing a declaration does not withdraw an already displayed result from its old scope.**

   [client.ts:268](/Users/ccheever/projects/snapback/.llp/ship-runs/snapback3-acquisition-20260912/reviews/final-v6/source/snapback3/packages/snapback3/src/client.ts:268) deletes the old acquired pool, but neither this branch nor the restored-identity mismatch branches at lines 275–282 call `withdrawAcquiredResources(id)`. The held `Resource` therefore retains its ready snapshot. Even successful replacement does not repair it because [client.ts:778](/Users/ccheever/projects/snapback/.llp/ship-runs/snapback3-acquisition-20260912/reviews/final-v6/source/snapback3/packages/snapback3/src/client.ts:778) only republishes resources whose data is already undefined.

   Concrete sequence:

   1. Acquire `history` v1, including a derived query `Q`.
   2. Call `watch(Q)` before replacement; it becomes ready and records acquisition origin `history`.
   3. Call `acquire({id:"history", revision:"v2", expand:()=>[]})`.
   4. Whether replacement completes or fails offline, the held `Q` remains ready with v1 data even though v2 removed it from scope.

   This contradicts [guide.md:129](/Users/ccheever/projects/snapback/.llp/ship-runs/snapback3-acquisition-20260912/reviews/final-v6/source/snapback3/guide.md:129), which requires an explicitly changed declaration to withdraw its previous scope. The test at [acquisition-client.test.ts:208](/Users/ccheever/projects/snapback/.llp/ship-runs/snapback3-acquisition-20260912/reviews/final-v6/source/snapback3/tests/acquisition-client.test.ts:208) creates `Q` only after replacement, so it misses the held-resource case.

2. **P1 — Cancelling an already-ready acquisition leaves its pool and snapshots usable.**

   [DatasetAcquisition.cancel at client.ts:104](/Users/ccheever/projects/snapback/.llp/ship-runs/snapback3-acquisition-20260912/reviews/final-v6/source/snapback3/packages/snapback3/src/client.ts:104) changes the handle to `cancelled`, while [cancelAcquisition at client.ts:591](/Users/ccheever/projects/snapback/.llp/ship-runs/snapback3-acquisition-20260912/reviews/final-v6/source/snapback3/packages/snapback3/src/client.ts:591) only aborts work and persists that status. Neither removes `acquiredFacts` nor calls `withdrawAcquiredResources(id)`.

   Concrete sequence:

   1. Complete acquisition `D` and materialize `Q` from it.
   2. Set the client offline and call `D.cancel()`.
   3. Wait until storage records `D.status === "cancelled"`.
   4. Both held `Q` and a new `watch(Q)` remain ready because `acquiredFacts` still contains `D`; `query(Q)` succeeds offline.
   5. Close/reopen, and `Q` becomes unavailable because restoration correctly rejects the cancelled checkpoint.

   RAM thus remains false-ready after durable eligibility was withdrawn. No added test cancels a ready acquisition and asserts both held and newly created resources are unavailable.

3. **P1 — A delayed cancellation can cancel a successor declaration or account’s acquisition with the same ID.**

   [client.ts:594](/Users/ccheever/projects/snapback/.llp/ship-runs/snapback3-acquisition-20260912/reviews/final-v6/source/snapback3/packages/snapback3/src/client.ts:594) performs an asynchronous load and then selects solely by acquisition ID. At [client.ts:596](/Users/ccheever/projects/snapback/.llp/ship-runs/snapback3-acquisition-20260912/reviews/final-v6/source/snapback3/packages/snapback3/src/client.ts:596), it marks whichever checkpoint now owns that ID as cancelled. The cancellation captures no declaration hash, account epoch, authority, handle, or cycle.

   Executable sequence using the existing custom-storage pattern:

   1. Complete `history` v1.
   2. Delay the next `storage.load()`, call `v1.cancel()`, and wait until that load is blocked.
   3. Start `history` v2 and let it complete durably.
   4. Release v1’s delayed load.
   5. The old cancellation reads v2’s ready checkpoint and persists it as cancelled.
   6. The v2 handle and RAM pool remain ready, while storage says cancelled; offline reopen loses v2.

   The same sequence can target a new account’s checkpoint after an account switch. The new test at [acquisition-client.test.ts:635](/Users/ccheever/projects/snapback/.llp/ship-runs/snapback3-acquisition-20260912/reviews/final-v6/source/snapback3/tests/acquisition-client.test.ts:635) verifies cancellation during invalidation, but never installs a successor cycle while the old cancellation is pending.

## Other reviewed boundaries

The new same-adapter initialization queue correctly encloses failed withdrawal plus conditional session cleanup, and the added immediate-reopen test has meaningful assertions.

I found no confirmed cache-authority counterexample: reusable envelopes require module-owned immutable resources, the exact immutable manifest/schema identity and generation/hash, and identical module-owned row bindings. Missing, replaced, mutated, wrong-table, wrong-account, and changed-manifest controls are substantive.

The committed/rejected/conflict tests now materialize the resource before sequence advance and preserve the original receipt state and sequence; the implementation does not relabel mixed outcomes by a maximum sequence. Durable acquisition progress still precedes ready publication.

The stated whole-corpus mapping, absent GC, finite synchronous gzip, separate-adapter notification, and universal-write-failure limits were not elevated into blockers.

## Exact input binding

Candidate `v6`, frozen `2026-09-12T20:31:17.934256+00:00`, base review `final-v4`.

```text
994bb1b4127fbac0994bd20deb84a192279e90fd332b09398d7cc4550a6a30e3  inputs.json
e4d3cd66bb68cc59e5b9866b2f1a45b87b5aedc7f90ab516338d495c82a1d097  delta.diff
```

All 17 packet sources matched the hashes and byte counts in `inputs.json`. Finding-bearing sources:

```text
05e6374c9575d6099a67e4926e2f830a7e19c7d788937e780af1b27f5cdccaab  snapback3/packages/snapback3/src/client.ts
3670f0f41d7a706bc1a9caaa01fb7ded50576dde497c21ac7bb45146f1ac979a  snapback3/tests/acquisition-client.test.ts
60e20e0cfa8a4820509251091ad715e566021d8a460bd28c959e398900ab56e5  snapback3/guide.md
39029642455df547724b4a8d493057bbc6fd60e1651a8dfc5aadbe26bba17c83  llp/2000-snapback3.rfc.md
```