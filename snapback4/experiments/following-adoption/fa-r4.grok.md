I'll review the FA round-4 delta read-only: the prompt, both round-3 reviews, the round-4 report, and `git diff 48895b810..15234d8ee`.The review is the round-4 delta `48895b810..15234d8ee`, not a branch-vs-main pass. I'll read the report and the diff next, then check each Astra finding against the code.The delta is one commit on top of the merge. I'll read the admission, materialization, and test changes in full rather than the truncated diff.**NOT READY.** Astra's three findings are fixed and their new tests fail if those fixes are removed. Slot fill then writes the materialized source image back, so a successful launch freezes literal defaults into retained post and repost rows.

## 1. Astra's findings

**Waiting syncs exhaust the read pool. Fixed.** `/sync` is its own class with a 32-permit cap (`serve.rs:385`, `serve.rs:420`). The held-commit test blocks 32 syncs on the engine lock, then requires `/q/home` and `/schema` to return the predecessor, and requires a 33rd sync to be aborted (`serve_adoption/mod.rs:38`). Putting `/sync` back on the short pool fails that test: the query response is empty.

**Sparse images fail construction. Fixed for the read, not for storage.** Cards, edges, and slot-fill inputs call `materialize_optional_fields` before mapped field reads (`timeline_launch.rs:177`, `timeline_launch.rs:124`, `timeline_launch.rs:198`, `event_slots.rs:41`). `sparse_literal_defaults_agree_in_check_and_atomic_launch` builds the rows by adoption, checks that the default is absent, then runs check and runtime together. Dropping any one of those materialize calls returns `MissingField` and fails the test.

**Aggregate ceiling. Fixed.** `admission` sums copies (`timeline_launch.rs:45`). The new test uses two declarations at 3,001,001 each and requires refusal of 6,002,002 with zero SQLite writes (`following_atomic_launch.rs:156`). Replacing `sum()` with `max()` admits the launch. The production sum was already correct.

## 2. Admission

The sync pool is bounded: `fetch_update` stops at 32, and the permit is acquired at dispatch, so a sync that starts before the launch flag still cannot sit in the short pool.

Authentication precedes the wait on a file store. `handle` and `serve_sync` both resolve the bearer through a detached reader before `lock(&shared.engine)` (`serve_sync.rs:36`). Missing and invalid tokens return 401 with `engine.waiting() == 0` while that lock is held. After the wait, `mutation_authority` resolves the token on the writer connection (`serve_sync.rs:51`). Deleting or expiring the session during the wait returns 401. That recheck is what the new test actually pins. The invalid-token half was already rejected in `handle` before `serve_sync` ran.

On a file-backed server, no other request kind waits out adoption while holding a short permit. Queries, `/schema`, `/`, `/probe`, `/api.ts`, `/native.wasm`, `/dev/status`, `/auth/config`, and `OPTIONS` use detached readers or no engine lock. Mutations, `/changes`, claims, routes, and assets have their own pools. Memory-store queries still fall back to the engine lock inside `principal_of` and can fill the short pool. Dev and deploy open a file; that path is unchanged.

Outside adoption, the only change is that `/sync` no longer shares the 32 short slots. The sync cap is still 32. Steady state can run 32 syncs and 32 queries together. A sync blocked on an ordinary write no longer aborts `/q` or `/schema`.

## 3. Materialization

Event and edge reads materialize the candidate image before `live()`, filters, and mapped fields, in both the preflight and `build`. Removal is required `bool default false`, so materialize cannot turn a sparse row into removed. The filter treats a missing field as null (`maintain.rs:47`); a literal default is a real value, and both walks apply it first, so they agree. A repost's author is read only in `build`, off a local card image, and the preflight never needed that field for the count. Edges are not written back. Sources must be public, and the walk does not consult owner rules. Retirement still uses the previous schema on the raw row, before materialize.

The slot walk does not keep that split.

**Medium. `snapback4/crates/snapback4-core/src/store/event_slots.rs:41`**

`materialize_optional_fields` mutates the same `row` that line 51 writes with `UPDATE r SET data = ?1`. The new comment says literal defaults need not be stored. The projection pass below says the opposite of this write: defaults are an interpretation, and only a destructive projection is persisted (`activation.rs:186`).

Failing scenario: the existing card case. After `adopt(&mut e, &without_view(&s))`, `authorId` is absent. After the timeline `adopt`, `posts.authorId` is the stored id `a`, and a repost row stores `actorId` and `postId`. Replies the filter excluded are rewritten too. Check still passes. A later edit of that literal default does not reinterpret the row, because the value is now stored. Asserting `field(authorId).is_err()` after the timeline adopt fails on the current tree.

Smallest fix: materialize a clone for the actor and post lookup, and write the original image plus the slot only. Assert the missing fields are still absent after launch in the card, post-slot, and repost-slot cases.

## 4. Else

Atomicity is unchanged. One immediate transaction still does the in-lock preflight, retirement, `build`, slot fill, indexes, and the generation commit. A crash before commit leaves the predecessor. The copy set is still own live events plus the newest 1,000 per follow, with no refill. Dev still launches without the flag. Deploy still needs `--allow-feed-adoption`. The 5,000,000 ceiling does not consult the flag. New timeline slots still clear `keeps_literal_default_images`, so devices reacquire. They reacquire the baked source image. No new viewer-facing disclosure. The operator text is still counts, and on refusal an id, not a body.

## 5. Test strength

The three new tests kill the mutations they were written for. They do not kill this one: delete the in-lock `preflight` at `activation.rs:111` and keep the unlocked call at `activation.rs:68`. Every ceiling test, including the two-declaration test, refuses on a quiescent store before `transaction_with_behavior(Immediate)`. Nothing commits a follow in that gap. The shipping code still recounts under the writer lock. The smallest fix is a test that publishes one more follow of a full actor after the unlocked estimate and asserts `E_TIMELINE_ACTIVATE`, the same generation, and no feed rows.

**NOT READY.**
