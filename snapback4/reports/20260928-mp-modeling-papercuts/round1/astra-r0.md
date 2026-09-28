No aggregate disclosure regression found. Three Medium diagnostic issues should be fixed before MP lands.

1. **Medium — refusal records cross process/store boundaries.** [dev_refusals.rs:40](/home/ccheever/sb4-intent/review-mp-r0-astra/snapback4/crates/snapback4/src/dev_refusals.rs:40), [verbs.rs:843](/home/ccheever/sb4-intent/review-mp-r0-astra/snapback4/crates/snapback4/src/verbs.rs:843).

   Reproduced with two simultaneous `dev --fresh` processes in one project, using different store IDs. A refused; B had no refusals; `why recent` reported A’s record without identifying its producer. Both processes write the same file, and records contain neither store nor instance identity.

   **Smallest fix:** partition records by store and dev-instance identity, and make `why recent` select or explicitly identify that instance. Reject stale or mismatched records. **Blocks landing.**

2. **Medium — read-through insert refusals produce no developer cause.** [through.rs:64](/home/ccheever/sb4-intent/review-mp-r0-astra/snapback4/crates/snapback4-core/src/engine/through.rs:64), [dev_refusals.rs:28](/home/ccheever/sb4-intent/review-mp-r0-astra/snapback4/crates/snapback4/src/dev_refusals.rs:28).

   A child with `read through .parent` and `insert <- allow`, inserted against a missing parent, returns `E_RULE` while the enabled trace remains empty. I reproduced this. Unreadable-parent denial follows the same uninstrumented path. Dev therefore logs nothing, and `why recent` can keep showing an unrelated earlier cause.

   **Smallest fix:** instrument the capture-denial branches and map their cause to the read-through declaration/parent-rule source site. Add missing, expired and unreadable-parent tests. **Blocks landing.**

3. **Medium — `N_SEQUENCE_READ` can falsely promise inevitable failure.** [refusals.rs:28](/home/ccheever/sb4-intent/review-mp-r0-astra/snapback4/crates/snapback4-lang/src/bind/refusals.rs:28).

   The detector checks whether `.parent` occurs anywhere in the witness key, without checking the corresponding indexed column. With `ordinal: sequence by parent` and `read <- exists members[access = .parent, principal = viewer]`, a witness whose `parent` is another group can authorize the first insertion into the new group. I reproduced a successful insertion accompanied by “always refuses E_RULE.”

   **Smallest fix:** match indexed columns to key terms and prove that the witness belongs to the same sequence-parent group. Otherwise omit this categorical note. **Blocks landing.**

4. **Low — diagnostic persistence blocks request execution.** [dev_refusals.rs:36](/home/ccheever/sb4-intent/review-mp-r0-astra/snapback4/crates/snapback4/src/dev_refusals.rs:36).

   Stderr output and file replacement happen before the response, while the durable mutation still holds the engine lock. Slow diagnostic storage or blocked stderr delays this request and other mutations. This work also changes caller-observable dev `Server-Timing`; timing is not equivalent with collection enabled.

   **Smallest fix:** hand bounded records to a dev writer outside the engine lock and response path. **Does not block landing:** LLP 3000.019 explicitly permits timing differences on loopback dev.

5. **Low — the preview rewrite assumes external usage it cannot know.** [prefix.rs:100](/home/ccheever/sb4-intent/review-mp-r0-astra/snapback4/crates/snapback4-lang/src/bind/program/prefix.rs:100).

   Any affected query sharing a helper with a job is called “unused,” including a query invoked by an application screen.

   **Smallest fix:** say “if this viewer query is unused, remove `<name>`.” **Does not block landing.**

The aggregate admission is sound in the paths inspected and exercised. Parent authorization precedes group access; unpinned raw IR and explicit read overrides remain refused. Additional probes verified missing/hidden equivalence through examined-meter cuts, cursor continuation and emitted-row expiry, twice-nested shapes, and authorization gained after child capture. An expiring membership witness correctly controls the aggregate deadline. Devices retain server fallback.

Production `serve` cannot enable collection through the available configuration paths: capture requires the dev-only `personas` flag. The tested refusal bytes and meters remain unchanged. This is not a constant-time guarantee.

The sequence decision is sound: parent creation does not establish freshness of the shared, persistent counter, and conditional admission based on zero would reveal history. A narrower future design could use a fresh counter namespace owned by each parent lifetime, inaccessible to earlier allocations. That would permit safe initialization, but requires a deliberate semantic extension; it is not required here.

The owner-key rewrites are valid, and the rewritten fixture’s tested behavior holds. I ran **187 repository tests successfully**, with one full-store test ignored, plus the additional probes above, entirely on temporary copies. No worktree files changed. I did not rerun the complete suite.

A mutation that would survive the submitted tests: delete the 32-record eviction at `dev_refusals.rs:38`. The process test creates only one record. Aggregate coverage also needs a committed test where an expiring authorization witness precedes the source-row deadlines.

**Verdict: NOT READY.**
