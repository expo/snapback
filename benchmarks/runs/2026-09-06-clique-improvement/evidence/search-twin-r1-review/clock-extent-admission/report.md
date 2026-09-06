# Checked extent contradiction at public admission

**Confirmed defensive defect in frozen0fa.** A same-sequence complete-extent hole can purge an independently held row while its immutable positive fact guard survives. This is an admitted contradictory test transport; the native owner did not emit the contradiction.

The immutable v4 owner06 (SHA7e6f0cba…) certified and served the valid fixed-extent timed query in run-20260906T153503Z. Two actual SSE frames, an actual authenticated program-custody response, and an untimed point anchor all retain event1 at sequence1. Advancing the control clock changes readTime/data.now; it does not change the row or typed extent. The owner process exited in the fixture's finally block. External static IR compiler is a native-contract fixture, not a Quarry authoring claim.

The client probe first passes those actual frames through OfflineRuntime.program/accept/commit and a file carrier. It then changes the later frame into a clearly labeled synthetic contradiction: same valid schema/program/authority/sequence/typed Exhausted extent, newer readTime, empty rowIds/pool/result, synthetic opaque validator. This reaches the same public admission path used after an authenticated transport; no direct PersistentRangeStore.commit bypass is used for the contradiction.

Both warm and cold cases admit and commit it without error. The anchor becomes null, the pool empties, state.negative records event1 atseq1, but the positive factGuard for event1 atseq1 remains. A separate higher-sequence identical-hole control also removes the row; that behavior must remain supported, with its immutable negative guard advanced consistently.

The correct repair is not the review's blanket clockOnly eviction skip. Approved design§5 preserves checked typed-extent holes. Inferred checked-hole negatives must participate in immutable fact validation/checkpointing: contradictory same-seq assertions refuse the complete transaction; valid later-sequence holes, explicit absences and distinct temporal-bound behavior remain intact. Root approved this exact direction and required warm/cold atomic rollback, anchors and outbox controls.

Evidence: result.json; exact45source captured probe.mjs/inputs/sources; source-verification.json compares every tracked consumed file to0fa; external Unicode table is the same pinned generated input. BundleSHA444024337ab7b6382a0621d18cd8940916916d39a45b89c5bbe94149a1f967ec; Node22.23.2. Native input public frames/program/schema are under run-20260906T153503Z. Do not publish the fixture project's private .snapback owner control state.

Commands: python3 run.py /Users/ccheever/clique-improvement/revisions/search-engine/provisional-06/snapback2-owner; node build-probe.mjs probe.ts probe.mjs; node probe.mjs. All are external, bounded, and run from these exact retained script bytes.
