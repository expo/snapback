Two implementation fixes are needed.

1. **Medium — waiting syncs exhaust the read pool.** [serve_sync.rs:37](/home/ccheever/sb4-intent/review-fa-r3-astra/snapback4/crates/snapback4/src/serve_sync.rs:37)

   `/sync` now blocks on `shared.engine`, but dispatch still assigns it a `Short` permit alongside queries and discovery. During adoption, 32 waiting syncs exhaust that pool; subsequent `/q/home` and `/schema` requests are aborted. The wait also precedes authentication.

   **Reproduction:** extend the held-commit HTTP test to start 32 sync requests before requesting `/q/home`. The current test uses only one sync and queries before starting it, so it misses this.

   **Smallest fix:** give blocking sync requests a separate bounded admission pool, or transfer their permits out of `Short` before waiting. Preserve query/discovery capacity throughout adoption.

2. **Medium — valid sparse source images pass preflight but fail construction.** [timeline_launch.rs:177](/home/ccheever/sb4-intent/review-fa-r3-astra/snapback4/crates/snapback4-core/src/store/timeline_launch.rs:177)

   The event walk materializes candidate defaults, but the repost’s original-card lookup reads raw stored fields. Ordinary schema adoption deliberately leaves literal defaults unmaterialized in retained rows.

   **Failing scenario:** create post `p` before adding `authorId: principal default 'a'`; adopt that field and the required owner/immutability rules, retain a repost referencing `p`, then introduce Following. Preflight interprets the post’s default and succeeds. Construction reads the raw card, finds no `authorId`, and aborts. Check and runtime disagree despite valid sources.

   The same omission exists in edge reads and [slot filling at event_slots.rs:39](/home/ccheever/sb4-intent/review-fa-r3-astra/snapback4/crates/snapback4-core/src/store/event_slots.rs:39).

   **Smallest fix:** consistently materialize candidate-schema source images before reading mapped fields—including cards, edges, and slot-fill inputs. Add this sparse-image regression.

3. **Low — the aggregate ceiling lacks a discriminating test.** [following_atomic_launch.rs:136](/home/ccheever/sb4-intent/review-fa-r3-astra/snapback4/crates/snapback4-lang/tests/following_atomic_launch.rs:136)

   Replacing the admission calculation’s `sum()` with `max()` would survive the added ceiling tests: they exceed the ceiling with one declaration.

   **Smallest fix:** introduce two declarations together, each estimating 3,001,001 copies, and assert refusal before writes for their combined 6,002,002 copies. The production sum is currently correct.

The atomic publication boundary is sound on the inspected paths: slots, births, copies, catalog changes, sequence, and generation share one SQLite transaction. Errors roll back candidate state; repost identities use fresh entropy; birth ordering supports later follows; new slot names force device reacquisition. I found no partial-publication or new disclosure path.

I ran the requested diff and five existing in-memory tests from the implementation worktree at the same commit: four launch-contract tests and device adoption/reacquisition. All passed. The two failing scenarios above are source-derived, not executed reproductions. No files changed.

**Verdict: NOT READY.**