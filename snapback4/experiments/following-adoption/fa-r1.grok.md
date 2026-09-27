I'll review the revision against the round-0 findings and the simpler alternative, starting with the prompt, both prior reviews, and the RFC diff.The round-0 blockers are specific. Next I’ll read the revised RFC and the diff that claims to answer them.The revision recommends in-place initialization plus finite rosters. I’ll check that against the scheduler, backfill, fence, and publication code it cites.The revision answers the round-0 list in prose, and the finite-roster argument is right. It is not ready to implement: a queued write can still be lost, a committed in-place slot is already visible to predecessor reads, and reusing today's backfill copy path neither freezes the window nor survives a removal.

## What is sound

"Start this feed now" is the right contract for a view that has never existed. It is not historical equivalence. The newest 1,000 live events per current follow, with removals that do not refill, matches the window the product already ships (`schema/timeline.rs:11`, `online.rs:14–18`). The new case is real and is now written down: follow after 2,000 posts, receive 1,000, delete those 1,000, and a fresh launch copies the older 1,000 still live (§3). Own retention and the device's merged 1,000-copy floor stay different things. Grandfathering a retained repost whose original is gone or filtered is what the union already says; future repost insert stays strict.

There is still no disclosure path through sources, events, tombstones, the inbox, or work rows, as long as launch rosters stay server-private. Inboxes and work stay reader-private (`bind/timeline.q:37`, `:56`). Birth records initialized `done` are required: a missing one parks on `FEED_APP_NOT_FOUND` (`work.rs:87`). New repost ids salted with the fence incarnation, first-use names only, and no same-name re-add beside a literal default are the right identity rules. Adding a slot still makes `keeps_literal_default_images` false (`successor.rs:222–225`), so a first adoption drops device images. A new `Work` kind is correctly rejected (`successor.rs:246`, `timeline.q:41`).

The lock order, as specified, does not deadlock. The fence wait holds neither `shared.engine` nor a SQLite write transaction, and a blocked maintenance job yields instead of waiting (§4.1). Between chunks, `serve_maintenance.rs:94–101` already drops the engine lock. Presence stays on the separate wait budget (`serve.rs:383`, `:436–438`).

Round-robin across nonempty declarations is the right fix for the scheduler bug at `work.rs:149–167`, which returns after the first declaration that has any pending row. Separating fence waiters from the 32-slot `Mutation` budget is the right fix for admission: those waiters are what fill the budget today (`serve.rs:401–423`). Atomic publication plus a recount, rather than "no work row means complete," is the right fix for `timeline.rs:279–283`, which sets `timeline_pending` only for `Cut::Cap` reads on `byReaderTime` and `byReaderPage`.

The simpler-design analysis in §4.3 is right. See below. The round-0 numbers are not the cost of this design, and §5 says so honestly.

## 1. Round-0 findings

| Round-0 finding | In this text |
|---|---|
| Durable reservation, execute at most once | Specified, not closed. High 1. |
| Fence epoch and publication high-water | Epoch yes. High-water does not see the writes that matter. Medium 4. |
| Recount, and pending on every read | Specified, including point misses, folds, and devices (§4.2). Still depends on High 3. |
| Round-robin | Specified, including recovery and the regression (§4.1). Low residual: the cursor has to be store state. An in-memory field resets on a crash loop and starves declaration 2 again. |
| Admission isolation | Resolved as specified. |
| Newest-first roster, no refill, halfway device | The contract is resolved (§3, §4.2). The mechanism that is supposed to implement it is not. High 3, Medium 5. |
| No `mutate` replay; copy other slots unchanged | In-place fill does not go through `mutate`. `event_slots.rs:43–48` keeps other JSON keys. Visibility of the new key is not solved. High 2. |
| `backfill` plus a roster id, no new enum | The enum part is resolved. Where the roster lives can still force every device to drop images. Medium 6. |
| Measurements | A plan, not evidence. Section 3. |
| Newly included older events | Resolved (§3, the 2,000-post example). |

## 2. The recommended design

**High. A write queued across publication can be lost for good.** §4.1, `llp/3000.026-following-over-a-populated-store.rfc.md:196–199`. `engine/mod.rs:1088–1112`.

The reservation, the duplicate join, and "claim under the writer transaction" are the right shape. Effects already commit in that same transaction (`engine/mod.rs:1085–1113`), so a crash before commit does not double-fire the outbox. The hole is "generation compatibility." Today's `mutate` stores a refusal in `_ops` and every replay returns it. `acknowledged` treats only `state = sent` as done (`engine/mod.rs:957–959`), so the device outbox retries the same id and gets the same failure forever.

Counterexample: client mutation `m1` inserts post `p`. The id is reserved, the request waits, publication commits the new slots and the new generation. Execution then refuses `E_GENERATION`, or refuses because the pre-fence plan no longer typechecks, and that refusal is recorded. Every retry of `m1` returns failure. The post never lands. A second id would work, but this client's outbox will not mint one.

Smallest fix: a generation change is not a terminal receipt. After the fence releases, execute `m1` once against the live engine, filling the new slot in that commit. Replay of an in-flight reservation joins the claim; it must not decode as `failed` or `sent`. Record a terminal failure only for a real application refusal or for authority that is expired at execution time.

**High. A committed in-place slot is already visible, and it can wedge a later write.** §4.2, `llp/3000.026-following-over-a-populated-store.rfc.md:239–241`. `engine/recorded.rs:20–23`. `engine/validate.rs:33–35`.

`public_image` returns the stored row unchanged when the published table has no slot column. Query and sync both go through it (`engine/read.rs:1007`, `engine/read_point.rs:174`). The strip runs only after the schema lists a slot. `validate_row` rejects any key the schema does not declare. `event_slots.rs:48` and `activation.rs:166` are raw `UPDATE r`s: they commit the extra key without a log entry, which is what you want for devices, and without going through the projector, which is not.

Counterexample: the initializer commits one chunk. A signed-in read of `posts` returns `$timeline:following:post`. A sync page carries the same key to a device whose schema does not declare it. The next local or server write of that row fails with "undeclared field." Cancellation that misses one row leaves the key in place forever, because the predecessor schema never strips it. §4.2 says that if this isolation cannot be proved, in-place chunking must not be used. It is not proved, and the current projector contradicts it.

Smallest fix: one sentence, and then it is true. Any read, sync page, or snapshot emitted under the predecessor schema strips keys for which `is_slot` is true, even when the column is not declared. Reads must not validate those stored bytes. The publication generation is the first schema that lists the column. Add that as a signed-in read and a sync page during a committed chunk. Until that sentence is in the RFC, the recommendation's precondition fails; use the private replacement image instead.

**High. Reusing the backfill copy path does not implement a frozen roster.** §3 `llp/3000.026-following-over-a-populated-store.rfc.md:157–161` and §4.3 `:301–302`. `work.rs:56–59`, `:83–92`, `:120–127`, `:169–176`. `timeline.rs:215–218`.

§4.3 correctly says the unchanged task is not enough, then says to reuse its copy and epoch machinery with a roster cursor. That machinery is the wrong walker.

- The cursor is hex passed to `key::decode` and then to `byActorTime` (`work.rs:56–59`, `timeline.rs:258–263`). A roster id that survives the hex decode becomes an index continuation. The scan copies whatever is live, spends `remaining`, deletes the task, and the reader goes `complete: true` on the wrong set. A quiet store therefore completes with a refilled window. A noisy one may never complete.
- `timeline_copy` treats a tombstone as `FEED_EVENT_REMOVED`. Any refusal parks the whole task (`work.rs:169–176`) and does not advance the cursor. One removed roster member sticks that reader on `pending` or `parked` forever. Finite roster termination is then false. Deleting the parked row to "unstick" it makes `byReader` miss and the feed look complete with the rest of the roster uncopied.

Counterexample for non-termination of the live scan, which is why a roster is required at all: ten pre-epoch posts, so completion needs `exhausted`, not `copied == remaining`. After the cursor passes time T, insert posts with `.at` still ahead of the cursor, each with a new id. Each visit takes the `Ok(0)` branch at `work.rs:91`, does not spend `remaining`, and the page never ends. `timeline_background.rs:267–285` shows one such insert is delivered and does not consume the window. A continuous stream is a different case, and the code does not finish it. A saved cutoff key does not finish it either: many ids can sort inside one timestamp gap, so the open interval never runs out.

Smallest fix: a roster walker is not `timeline_work`'s backfill arm. Branch on a version prefix before `key::decode`. A removed member, a changed birth token, or a changed edge epoch skips and advances the cursor in that same commit. It is not a refusal and it does not park. Park only for a missing roster, a corrupt cursor, or a meter cut. Unfollow still cancels the old epoch by exhausting that task only.

**Medium. The high-water check is blind to the writes this design actually makes.** §4.1, `llp/3000.026-following-over-a-populated-store.rfc.md:203–209`. `event_slots.rs:48`. `activation.rs:162–166`.

A partition or `_commits` sequence does not move on those `UPDATE r`s. Initializer chunks that follow `event_slots::fill` will not move it either. Publication then compares a number that never covered the slot bytes. A second unlogged writer, or a stale image written back over a pre-fence removal, still publishes.

Smallest fix: the high-water is a per-table counter incremented inside `Tx::put`, `Tx::delete`, and every raw `UPDATE r` / `DELETE FROM r` on that table, in the same commit as the bytes. Log sequence is not the counter. The reservation row lives in an unfenced table and does not bump it.

**Medium. The page is either wrong or blank for the whole copy, because nothing copies the merged head first.** §3, `llp/3000.026-following-over-a-populated-store.rfc.md:164–168`. `work.rs:155`. `timeline.q:52–53`.

`byStatusTime` is `(status, at, id)`. Every launch task is created in one transaction, so they share `at` and run in id-hash order, one task to completion before the next. The read rule says not to expose a non-prefix. Those two rules together withhold the page until whichever task owns the newest head happens to run.

Counterexample: reader R's newest own post is newer than everything on follow B. B's task hashes first. The worker copies B's 1,000 roster members before R's own task runs. The honest read shows nothing, `complete: false`, for that entire foreign roster. At the round-0 follow-phase times, that is on the order of a minute at 1× and about 18 minutes at 10×, not one scheduling turn. Copying B first and then returning the inbox in time order shows B's old posts as the home page, which is the round-0 bug again.

Delayed retained own copies are acceptable for "start now" only if R's newest own page appears within the same bound as today's synchronous 50 (`online.rs:14–16`). They are not acceptable if "after P" means after every earlier foreign roster. Round 0 had those own copies at publication. This revision gives that up (§3 step 5, §4.3) and does not bound it.

Smallest fix: on a reader's turn, advance the task whose roster head is the newest uncopied head, including the own roster. The exposed prefix then grows every granted turn. Keep the read-side withhold as the backstop, not as the only mechanism. Do not call `timeline_follow` for a retained edge inside the publication transaction: that copies 50 live rows per edge, ignores the roster, and puts O(edges) writes on the global lock.

**Medium. The roster id can still force unrelated devices to drop images.** §3, `llp/3000.026-following-over-a-populated-store.rfc.md:157–158`. `timeline.q:41–53`. `successor.rs:246`.

The cursor column is `text <= 4096`. A 1,000-id roster does not fit there, so the body has to live somewhere else. A new `Work` column, a new kind, or a new owned suffix on every existing timeline changes the projected schema and `keeps_literal_default_images` becomes false for apps that never adopt.

Smallest fix: rosters are server-private rows for the new declaration only. `Work`'s columns, kind enum, and cursor type stay byte-identical. Existing declarations' schemas do not change. The store-version bump (`store.rs:31`, `:99`, `:258`) is what keeps an old binary from opening the fenced store; it is an equality check, so it does work, and it also means rollback to the old binary cannot open the store until the new binary finishes or the version is restored.

No deadlock beyond what §4.1 already forbids. No second disclosure path through the inbox or work rows. The shared roster is safe only if it stays server-private; a public or synced roster table would publish minted repost event ids to principals who do not follow that actor.

## 3. Measurement

§5 is sufficient to decide, once the gate is numeric and the two stalls are separate. It is not sufficient as written: "a few seconds" is not a threshold, and "fence acquisition → release" adds a chunked fenced-table wait to one global writer transaction. Three runs decide this design, not a fleet SLO. That part is right. The lower bounds are also right: copy counts and those files' sizes bound the old replay only. They do not bound this pause, heap, or disk.

Ship the publisher only if all of these hold on the skewed fixture §5 already describes (hot actor, one reader with 500 follows at 1× and 5,000 at the scaled-principal 10×):

1. **The publication transaction's writer-lock hold is ≤ 1s** (worst of 3 runs). That transaction blocks identity, other declarations, receipt replay, and `/changes`. One second is the adoption bar LLP 3000.019 §3.6 already used. If this fails, stop. An O(F+U) task insert in one transaction is the wrong publication shape; design the prebuilt coverage §4.2 already says you would need. Do not raise ceilings to get past it (`meter.rs:29–30` is 8,192 writes and 16,384 index entries per page; paging the meter does not shorten the lock).
2. **Queued fenced-table mutation, submission → one durable outcome, p99 ≤ 2s and max ≤ 5s** on skewed 1×, including the wait. Two seconds is the existing detached-read budget while a writer transaction is held. On skewed 10×, p99 > 5s means do not ship this fence; prepare slots without blocking application commits. Do not loosen the number after seeing the sample.
3. **Signed-in `/q` and `/sync` p99 during init ≤ max(2s, 2× the no-adoption control)**, and no read returns `complete: true` while that reader still has a launch obligation. Include the 5,000-follow reader. A merge of 5,000 heads does not fit a comfortable read (`Ceilings::default` examines 8,192). Store a per-reader frontier so the read is O(page), not O(follows).
4. **A declaration that is not adopting keeps its oldest-work age within one round-robin cycle of its control.**
5. **The crash matrix shows one outcome and one effect per mutation id.** Any miss here blocks shipping regardless of latency.

If (1) or (2) fails, the in-place recommendation is not shippable. §5 already says that requires another design. Do not implement past the timed publication prototype in that case.

## 4. Ready to implement?

No. Not the publisher, and not "implement the RFC as written, tests will catch it." An implementer who follows this text still:

- records a generation mismatch as a normal refusal receipt and loses the queued post;
- commits slot bytes that `public_image` serves and `validate_row` later rejects;
- feeds a roster cursor to `byActorTime`, or calls `timeline_copy` and parks the reader on the first removal;
- runs tasks in hash order, so the honest prefix is an empty pending page for the whole foreign copy;
- uses `_commits.seq` as the high-water and publishes over an unlogged clobber;
- adds a roster table or `Work` field and drops images for every existing feed;
- calls `timeline_follow` inside publication and holds the global lock for 50 live copies per edge;
- treats "a few seconds" as permission to ship a multi-minute fence.

Order of evidence:

1. Amend the RFC with the six fixes above. They are small, and they are load-bearing.
2. Prototype only those mechanisms on a small store: same id across publication (one post, one effect, crash before and after the receipt), a removal mid-roster that skips and still completes, a predecessor read and sync page during a committed chunk with no `$timeline:` key, and a second declaration making progress while launch runs.
3. Time the publication lock and one init chunk on skewed 1× against gates (1) and (2). Stop if either fails.
4. Run the rest of §5 only after (3) passes.
5. Implement the product path last. The card fix is already the right thing to have shipped; it is not this work.

The open-question table is a fair record of both round-0 recommendations. The extra pending interval for own copies (question 1) and the in-place fence (question 2) should not be accepted until the head-ordered schedule and the numeric gate exist. Questions 3 and 5 can stand. Question 4 is still no.

**NOT READY.**
