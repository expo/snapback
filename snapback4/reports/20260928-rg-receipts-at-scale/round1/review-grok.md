I'll review the round-0 receipts change read-only: the lane prompt, the report, and the diff from `1972112a0` to `65e843be9`.The source diff is small next to the report. I'll read the server certification, client sharing, and guide changes in full context.The bounded probe is the riskiest piece. I'll read how live ranges, expiry, and authorization interact with it.The bounded head count is exact on the paths that matter here, and the measured 913 ms p95 matches the retained run. Two regressions should be fixed before this is ready: a large unread suffix can now abort a member write, and a successful send followed by a refusal never syncs that send inside the outbox flush.

## 1. Server certification

The small-range count matches the old walk for a conjunctive row-key predicate. `live_range` supplies one necessary bound, so the probed index is a superset of the matches; `k.matches` then applies the rest (tombstone, self-send, `joinedAt`). Expired rows are not counted: `authorize_image` drops them, and `live_basis_walk_charges_bounded_candidates_on_its_internal_ledger` still expects 2 live rows out of 5. An empty suffix certifies 0 without decoding. A range of more than 64 stored keys returns `None`, zeroes the group, and takes the existing shared expiry walk (`batch.rs:86-95`). `fifty_members_share_one_live_walk_and_match_fifty_scalar_certifications` still decodes 1002 rows once. Scalar reads still reserve one examined unit and one step on the public meter; the probe runs inside `disclosed_scratch`, which restores that meter. Devices do not take the probe (`live.rs:93` requires `!self.device`).

**Medium.** `snapback4/crates/snapback4-core/src/engine/row_views/live.rs:80` and `snapback4/crates/snapback4-core/src/engine/row_views.rs:473`.

A declined probe keeps its examined charges. `release_heap` at `live.rs:85` does not roll back the 65 `index_head` charges. The member-write path then walks the limit it computed before those charges, on the same cloned meter (`row_views.rs:64-79`).

Failing case: one expiring row-keyed view, default `Cut::Abort`, remaining examined in `[210, 1088]`, and more than 64 live messages above the cursor. `scan_room >= 194`, so the probe runs, returns `None`, then the walk of `min(scan_room, 1024)` rows exceeds the ceiling by about 49 and the mutation returns `E_BOUND`. Before this change that write committed a partial recount. A fresh `seen` on an 8192 ceiling does not hit the window (65 + 1024 fits). The new guard test uses a ceiling of 48, which skips the probe entirely.

Smallest fix: on `Ok(None)`, `meter.restore` the mark taken at the start of `small_view_range`, not only `release_heap`. Add a writer test with `examined: 1024`, 100 live messages, and `readUpTo: 0`, and assert the mutation commits with `recountPending` rather than `E_BOUND`.

**Low.** `snapback4/crates/snapback4/src/scale.rs:833`.

`check --cost` still says the server certifies only through the parent/expiry index and that unswept expired rows are not visited. A suffix of at most 64 stored keys is certified on the predicate index and does decode those expired rows (then excludes them). The public reservation is unchanged, and the answer still omits them. The scale test asserts the old sentence, which is why the suite stayed green.

Smallest fix: say that a range of at most 64 stored keys is certified from the necessary predicate index, that those candidates include unswept expired rows, and that anything larger keeps the shared expiry walk. Keep the one-examined, one-step public reservation.

## 2. Client

Pending-write sharing is sound. One `PendingWrites` per client and operation, revision-fenced reads, snapshot identity when `JSON.stringify` matches, and the last unsubscribe drops the subscription and clears the value. Admission, settlement, failure, and replacement all change that JSON, so hooks update. `pending.notify()` still runs on admit, settle, apply, adopt, and `observe_store`, so reconnect and store replacement invalidate the shared snapshot. The issued-time floor is a different record (`server-clock-floor` and admission `now`); offset dedup does not touch it. A failed offset save clears `lastSave` and the next `persist` retries. A new `attach` closure is a new owner, so another device writes its own clock. `observe_store` with `reset: false` only updates sync metadata; row clears and receipt retirement stay inside `if reset`. Skipping media reconcile on that reply is safe, and `reset !== false` still reconciles.

**Medium.** `snapback4/packages/snapback4/src/local.ts:1159`.

Concurrent successful sends keep FIFO and sync once, when `queued()` is entirely `successSequence`. A non-retryable refusal does not. `seen` is sent, the later `send` is still queued, so the sync at `1159` is skipped and the `seen` promise resolves. The refusal takes the `rerunTables` branch and does not sync either. The loop ends at `1167` with no trailing sync. Nothing is awaiting an outcome, which is when `llp/3000.019` says the sync runs. `caughtUp` is still true, so `follow` waits for `/changes` instead of syncing now. The caller can observe `sent` and then read a local progress or unread query that does not yet contain the commit. A retryable head is less sharp: the changes poll usually repairs it, and the spec does mean to avoid a sync between the two posts.

Smallest fix: before every `retryFlush(); return` and after the `for` loop, if every remaining entry has a success sequence and any of them is unobserved (`observed_seq == null` or `!caughtUp`), `await syncOnce()`. Do not put that sync back between the two posts. Extend the new outbox test with a non-retryable refusal of the second write and assert the first commit is applied locally before both promises settle.

## 3. Guide

The added paragraph matches the card. The published hook only reports visible `seen`. `reports delivery` stays on the SDK, gaps are not filled, and continuous `progress` is still described as acquiring the next page. A builder starting from this card does not need a schema rewrite.

An app that keeps the old hook still has a working `delivered` mutation and still reports only runs it fetched. This diff does not make those writes wrong. It also does not make that hook cheap: `pre-migration-failure.log` is a second send that never settled within 30 seconds (`completedMeasuredSamples: 0`). That is the old stall, not a wrong receipt.

## 4. Measurements

The retained JSON matches the report's latency table. Fixed send/settlement p95 is 913.1 ms, 19 of 20 samples are under 1 second, the max is 1019.7 ms, visible-render p95 is 58.7 ms, and read convergence p95 is 3.733 s. Published is 15.596 s and starting main is 9.275 s. The loaded, before-media, and media-only runs are present at 1.106 s, 1.532 s, and 2.731 s. Browser counters match: 80,149 IndexedDB transactions, 631 saves, 2,519 `queued` calls, 230 history and receipt evaluations, wasm `apply` 299 ms with max 12.2 ms. Wire receipts are two events, 533 B and 715 B; main seen engine time is 110.105 ms and fixed is 19.895 ms, with 523 message rows across the run rather than a 10,000-row replay. The witness summary matches 382.7 ms, and the baseline control fails the save bound at 19,584 saves while its latency is 845 ms. The suite log ends with `== 1 failure(s) in 1836 s`. Wasm raw size is 2,019,815 B in `digests.txt`, same as the baseline artifact, different hash.

**Low.** `snapback4/reports/20260928-rg-receipts-at-scale/REPORT.md:227`.

The report says that pre-migration run displayed an examined-row ceiling refusal. The log and `pre-migration-failure.json` contain only `sent message settled within 30 seconds`. There is no `E_BOUND` and no examined ceiling. The 30-second miss is real; the refusal is not. The report is otherwise careful: warmups are excluded, the 1.020 s sample is disclosed, DOM counts are not called render counts, and the full suite is not claimed green after the later media and settlement edits.

## 5. Test strength

A mutation that survives: in `small_view_range`, drop `&& k.matches(&row, member)` and count every non-expired decoded row. `fifty_receipts_at_the_head_do_not_walk_ten_thousand_messages` still passes, because the single head message is not a tombstone or a self-send. `live_basis_walk` still passes, because its five rows are all eligible except for expiry. `fifty_members_share_one_live_walk` still passes, because that group is larger than 64 keys and still uses the shared walk, which has its own `matches`. The witness never reads the `unread` view it seeds, and its receipt text comes from `receipt()`, so a wrong unread count does not fail it either.

The new outbox test only covers two successful posts. The writer guard test never enters the probe.

## Verdict

**READY WITH CHANGES.** Restore the meter when the probe declines, and sync an unobserved success after a refusal. Correct the cost sentence and the examined-ceiling claim. The head-count optimization, the shared pending list, the clock dedup, and the measured p95 are sound.
