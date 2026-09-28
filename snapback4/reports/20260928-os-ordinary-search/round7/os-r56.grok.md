I'll review rounds 5 and 6 of lane OS against the LLP contract, starting with the diff, the ruling, and the earlier reviews.The range mixes a main merge with two lane commits. I'll isolate rounds 5 and 6, the contract ruling, and the merge's conflict resolution.Conflict resolution kept both parents' text and the EQ descriptor check. Next I'll read the composition, the oracle, and the contract those have to satisfy.The coordinator can be imported directly. I'll run it against a keyset fixture and against copies that break the merge, the cursor, deduplication, and the identity check.**READY.** Rounds 5 and 6 match the keyset ruling. The online composer is checked by an independent model, and the four mutations below fail it. Nothing here should stop landing except the wasm budget, which the supervisor is raising.

The merge `b44e5b66b` is sound. Its conflict resolution keeps both parents: the LLP revision line and the journal carry the ordinary-search notes and the equality-prefix notes, and `word_merge.rs:41-44` keeps the ordinary-search public-index remap and then calls `check_descriptor`. That call is the same table, index, order, and suffix check the ordinary-search side had inlined.

I did not re-run the 300 host seeds. This worktree has no device wasm and no server binary. I bundled `ordinarySearch` and ran it against a scripted two-lane fixture, including one-edit copies.

## 1. Oracle

On the path that matters, the oracle is honest. `SearchModel` in `search-oracle.mjs:4-39` is updated only from authored writes, membership, sync, and reset. `KeysetModel` in `search-oracle.mjs:57-65` advances its position from the page it computed, and `ordinary-search-oracle.test.mjs:144` requires the returned page to equal that page. Returned ids are not the expectation.

Lane visibility matches the ruling. Online, `readable` is server rows in current memberships, plus device images only for rooms that are not in the last synced membership (`search-oracle.mjs:33-38`). An unsynced server row in a current room is included. A retained image after a synced departure is included. An edit after departure stays on the delivered image. A rejoined room makes the model domain the server rows. The implementation withdraws instead, and the test accepts that loading state because membership changed. Both are allowed. Publishing the stale image is not.

These mutations fail:

- Seeking each lane with its own cursor again (`position.local` and `position.server` instead of `position.after`) returns a server row inserted at `at=180` after the combined page had consumed `at=150`. The real function seeks both lanes at 150 and returns `S100`. That is seed 159.
- Removing the identity check and answering the next page as `store:2` returns `S100`. The real function returns `{loading:true}`.
- Emitting every merged row, including a second copy of `m`, returns `['m','m','S']`. The real function returns one `m`.
- Treating an equal `(at, id)` as local-before-server keeps the stale body. The real function keeps the server body.

A stable row is not skipped or repeated, and a page is not out of order, on a non-cut online seed. `assert.deepEqual(read.data, expected)` runs before `consume`, so a bad page cannot drag the model along. Within a page, order is checked on every path.

**Low. Does not block.** `ordinary-search-oracle.test.mjs:143-152` and `:164-167`.

The strict compare is skipped when the seed is a word or meter cut and the page is offline or the scope is mutable. The position is then taken from `read.data`. Terminal exactly-once is skipped for every cut seed, including online ones. A replica of that branch accepts a traversal that drops stable `a` and a traversal whose second page sorts before the first. It still rejects a repeated stable id, and it still rejects a page that is unsorted inside itself.

That hole does not cover the composer. Offline and mutable queries never enter `ordinarySearch` (`local-query.ts:263` requires an online composition descriptor). Online cut seeds still compare each page to the keyset. Once `localCut` is set they compare it to the current-scope keyset only, which is the existing cut rule: the retained lane stays suspended. A current-scope stable row still cannot disappear.

Mutable seeds call `readable(false)` (`ordinary-search-oracle.test.mjs:66`), so they model device images, not unsynced server rows. That is the conservative fallback, not the composer.

## 2. Fixes

Each fix is real, and each has a test that fails without it.

- Immutable admission is `ordinary.rs:134-139`. `scope == "id"` or the scope column is in `immutable_fields`. Otherwise `composition` is absent and `mutable_scope` returns the table and column. `bind/mod.rs:420-423` emits `N_SEARCH_MUTABLE_SCOPE` with `messages.room is mutable` and the rewrite `add immutable room to table messages`. The server plan stays. `ordinary_search.rs:355-370` fails if the descriptor is still attached or the note disappears. With no descriptor, `local-query.ts:263` does not call the composer, so ordinary routing runs and cannot emit the same id from two search lanes. `cross-scope-review.test.mjs:97-106` fails if moved `m001` appears twice. It does not check which body, or the other 64 ids.
- Store and generation withdrawal is `local-search.ts:11-16` and `:200-204`. A mismatched store, a witness failure, `backend_required`, or a generation mismatch yields no identity, and the old cursor is not applied. `identity-review.test.mjs:96-125` covers replacement and generation on process and wasm. The harness above fails if the check is removed.
- Reset identity is `device.rs:679-681` plus the epoch input at `search.rs:31`. Reacquiring the same generation does not restore the old epoch. `search.rs:109-116` and `identity-review.test.mjs:144-151` both require a fresh source cursor. I did not recompile the Rust test.
- The combined cursor is `local-search.ts:187` and `:197`: both lanes get `position.after`, set at `:293` for every consumed row, including a deduped one. `ordinary-search.test.mjs` (`combined keyset boundary excludes new heads`) and the harness both fail on the old per-lane seek. Unconsumed rows after that key still come out (`S100`, then `L40`, then `S30`).

Same-count audience swap from the rounds 3–4 review is in `review-probes.test.mjs:185-197`.

## 3. SDK dedupe

It does not drop a distinct row. `react-pages.ts:109-118` collapses only a string `id`, keeps the first slot, and replaces that slot with the higher image revision. A separator with no id is kept. Two `{id: 7}` rows are both kept. Thread and history pages are message rows, one string id each. A second sighting of that id is the same row.

What a builder does not see is the previous body, and the row does not move to the later keyset position. The card at `search_all.md:80-81` says that, and says to refresh from the first page. That is the ruling, not an extra filter.

## 4. Disclosure

Sound. The continuation carries the binding (operation, arguments with the cursor cleared, principal, generation, link revision, plan), the epoch hash, the audience hash, `store_id:generation`, and source cursors of consumed `(at, id)`. A cursor produced by the harness contains no room id and no membership list. `left` scope keys stay on the in-process `search_state` reply, and only on the first call (`search.rs:51-56`). `store_id` is already on the query JSON to the same client.

## 5. What does not stop landing

**Low. Does not block.** `local-search.ts:305`. `complete` is true when both lanes say their own fetch is complete, even if the merge has not emitted every fetched row. With one retained row and one server row and limit 1, the first page is `[L]`, `complete: true`, and `next` set. Following `next` returns the server row. `usePage` uses `next` for `hasMore`. The oracle only rejects `complete: true` when `next` is null (`ordinary-search-oracle.test.mjs:146`).

**Low. Does not block.** `search_all.md:32-33`. That sentence still says `next` advances each source only past the hits that source consumed. Seeking is the combined key. Lines 79–81 state the ruling correctly.

The 4,077-scope drain continuation is now `E_SEARCH_OPEN`, the same refusal as a direct server seek with that cursor (`ordinary-search.test.mjs:263-269`). It does not silently skip. The smaller word-dense drain still returns the unconsumed hits. That is the keyset ruling meeting the server envelope.

Wasm was not remeasured. Per the brief, the budget raise is the supervisor's.

## 6. A mutation that survives

Delete the per-page `seen` set at `local-search.ts:280-287` and always push the merged row. The 300 seeds and the named composer tests still pass. Under `immutable`, one id is in one room, so it is never both a current server row and a retained image. Rejoin returns loading at `local-search.ts:229-234` before the merge. The oracle's pages therefore never contain two copies, and `deepEqual` never sees the missing dedupe. The cross-scope duplicate runs without a composition descriptor, so it never reaches `seen` either.

Smallest fix for that gap: one immutable-schema page whose retained image and server row share an id only if you also want to lock the defense in depth. The admission check is what makes the duplicate unreachable. I would not hold landing for an untested second net.

**Verdict: READY.**
