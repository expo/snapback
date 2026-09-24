# Lane C review round 1 — 2026-09-24

Branch: `sb4-intent/c-following`. Implementation commit: `e78b7f4b2`.
Implements all five findings in
`~/sb4-intent/fix-c-r1.md`. FeedView binding still waits for the supervisor's
Lane A landing notification. No push or publication.

## Fixes and engineering decisions

1. **Engine-owned epochs.** A private, synced `<timeline>Edges` row holds each
   current `(reader, actor)` admission. Its epoch encodes the engine commit
   sequence and write ordinal as two fixed-width hexadecimal components. It
   never derives from the application's follows id or event time. Copies,
   backfill and cleanup carry that epoch; reads compare it with the current
   owned edge. Unfollow deletes the admission in the same transaction as the
   application edge, immediately hiding all retired-epoch copies. Trusted row
   restore advances its commit beyond the imported admission sequence floor;
   reopening the complete store already preserves the commit sequence.
2. **Exactly one producer.** A delivery record captures its event's admission
   order. Fan-out admits only edges older than that event. Backfill admits only
   events older than its edge, and skipped newer events do not consume history
   slots. Completed delivery records remain with status `done` until event
   removal, preserving admission metadata for later backfill without adding a
   writer-transaction row. They are not pending work. Purge retires that record
   before the tombstone, in the same transaction as its last copies.
3. **Reserved follower index.** Every declaration uses
   `$timeline:<name>:followers` with exact `(followed, follower)` columns.
   Authored names cannot reach this namespace. An existing definition under the
   reserved name must match exactly or admission refuses with `E_TIMELINE_SHAPE`.
4. **Heap accounting.** Timeline scans use the interpreter's metered store scan
   and pre-allocation accounting for decoded payload, row retention and keys.
   The reviewer's 256 follows × 100,000-character payload aborts with
   `E_BOUND: HeapBytes reached 16849849 against the ceiling 16777216` at the
   follower scan. No follower copies or cursor progress commit; the task parks
   with its refusal. No meter ceiling was raised.
5. **Pagination proof.** The refollow test now traverses every page before
   cleanup, asserting the exact 50-event preview and uniqueness. Temporarily
   removing the epoch predicate makes this test fail; the predicate was restored
   before final validation.

The public/full-sync source prerequisites and application write authority are
unchanged. Devices still queue follow/unfollow without prediction and now read
current epochs from their private partition. No new authoring form or refusal
code was introduced. The existing declaration, filtered originals, legacy
ignored authors/size clauses and `feed[viewer] after c last 20` remain the surface.

## Measurements and test changes

- Wasm is **1,708,510 bytes raw / 473,320 gzip**, within the unchanged 474,000-byte budget (final full run).
- Post writes remain **4 with five followers and 4 with 900**.
- First-page examinations remain **61 with five follows and 61 with 500**.
- Delivery to 900 followers still takes **four chunks / 901 copies**; the latest
  targeted crash/reopen/index-adoption run took **301 ms** on the shared host.
- A follow preview now costs at most **53 writes**; unfollow with pending cleanup
  costs **259**, including the new admission insert/delete. It still removes
  256 copies synchronously and leaves 744 stale copies from a 1,000-copy inbox.
- Reusing `fixed-edge` for a 600-event refollow, including a repeated clock and
  two replacements in one transaction, converges to **600 unique events** with
  no pending or parked work.
- Both drain orders produce the same **1,000 historical events** from 1,100.
  A newer event with a backdated `at` is delivered separately, without consuming
  a historical slot (1,001 total in that expanded regression).

New tests in `crates/snapback4-lang/tests/timeline_background.rs`:

| Test | Proof |
|---|---|
| `application_edge_id_reuse_cannot_reuse_an_engine_epoch` | Reused application id, repeated clock, pending cleanup and same-transaction replacements cannot lose or duplicate copies. |
| `late_follow_history_is_independent_of_delivery_drain_order` | The old 1,100-copy counterexample yields exactly the intended 1,000 historical events in both orders; newer backdated delivery remains separate. |
| `authored_follower_index_name_cannot_replace_the_engine_index` | The reversed `byTimelinefeedFollowers` index cannot capture delivery scans. |
| `delivery_charges_large_edge_payloads_before_materializing_them` | The review payload refuses under the unchanged heap ceiling, rolls back the chunk and leaves the cursor unchanged. |
| `admission_order_distinguishes_event_and_edge_inside_one_transaction` | Write ordinals separate events on both sides of a follow within one commit, independently of event time. |
| `trusted_restore_preserves_the_admission_order_floor` | A restored store can deliver newer events and mint strictly newer edge epochs. |

The existing `history_window_epochs_and_pending_completeness` now checks the
entire sequence before cleanup and was mutation-tested. Binder unit test
`reserved_follower_index_requires_its_exact_definition` checks both idempotent
reservation and rejection without overwriting a conflicting definition.

The counted/uncounted differential oracle canonically renames admission orders
and their derived ids/cursors, preserving their ordering and references. Counts
can add commits and writes, so raw engine tokens need not match; all owned
relationships and home-page results still must match. No test was deleted.

Affected checks: 15 background tests, four timeline-guide tests, 26 device
timeline tests, 23 CLI timeline tests, two mutation/compatibility tests, both
delivery/stream tests and 15 replay tests pass. The language library's 11 tests,
55 guide tests and three reduced Clique tests pass. The strengthened pagination
mutation check fails as intended when the predicate is absent. The unrelated
HTTP admission timing test failed once under shared-host load, then passed in
isolation (0.04 s); its code was not changed.

`ref-check --verbose`: 504 LLP docs, 9,208 references; zero errors
or unchecked references. Every modified source file remains below 1,500 lines.

## Required full-suite result

The first round-1 run reported `== 1 failure(s) in 145 s` (`cargo test`),
with three host-baseline failures and three introduced digest regressions:

- **Ours, fixed:** `digest::parked_digest_replacement_skips_completed_profiles`,
  `digest::hub_seeks_the_period_in_one_chunk_and_ordinal_history_parks_on_examined`,
  and `digest::single_profile_stops_at_the_exact_examined_envelope`. Ordinary
  jobs carry an empty timeline Purge grant; the first heap-path condition treated
  that as a timeline transition, changing their meter outcomes. The final
  condition explicitly requires engine-owned Transition authority. No digest
  test, application job or ceiling was changed to make these pass.

Final `scripts/test.sh` result, with no subsequent runtime changes:

```text
== 1 failure(s) in 197 s
   cargo test
```

Log: `/home/ccheever/sb4-intent/lane-c-round1-test-final.log`.
Only these three tests fail, all present in the supplied host baseline:

| Classification | Test | Reproduction from snapback4/ |
|---|---|---|
| Baseline | `uniform_word_expansion::search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots` | `cargo test -p snapback4-device --test device uniform_word_expansion::search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots` |
| Baseline | `census::authoring_census` | `cargo test -p snapback4-device --test readauth census::authoring_census` |
| Baseline | `w9b_why_operation_keeps_residency_and_cost_output` | `cargo test -p snapback4 --test check w9b_why_operation_keeps_residency_and_cost_output` |

All timeline and digest targets pass. Client tests: **994 passed, zero failed,
ten pre-existing skips** (1,004 total). The earlier HTTP timing failure passed
both isolated retry and the final full suite. All five review findings are
resolved; no introduced suite failure remains.

The retained large-payload regression proves safe refusal/parking; it does not
claim that a 25.6 MB chunk completes under a 16 MB heap ceiling. FeedView remains
the separately gated Lane A dependency. No other round-1 item is deferred.

## File-by-file changes

Paths are relative to `snapback4/`.

| File | Change |
|---|---|
| `crates/snapback4-core/src/engine/mod.rs` | Advances trusted-restore commit sequence beyond imported admission tokens. |
| `crates/snapback4-core/src/engine/read.rs` | Applies existing payload/key/retention heap accounting to internal timeline scans. |
| `crates/snapback4-core/src/engine/timeline.rs` | Engine admission tokens, owned-edge lookup, stable delivery identity and restore sequence floor. |
| `crates/snapback4-core/src/engine/timeline/online.rs` | Inserts/deletes the current engine-owned edge admission atomically with follow/unfollow. |
| `crates/snapback4-core/src/engine/timeline/work.rs` | Separates delivery/backfill eligibility, retains completed admission metadata, excludes newer events from history-slot counts. |
| `crates/snapback4-core/src/schema/timeline.rs` | Adds the canonical owned Edges role. |
| `crates/snapback4-lang/src/bind/timeline.q` | Defines private synced Edges and Work admission/done metadata. |
| `crates/snapback4-lang/src/bind/timeline.rs` | Reserves and validates the internal index; reads compare the owned current epoch; collision unit test. |
| `crates/snapback4-lang/src/guide/feeds.md` | Documents the engine epoch and one-producer history contract in the requested section. |
| `crates/snapback4-lang/tests/timeline_background.rs` | Six new regressions and complete pre-cleanup pagination assertions. |
| `crates/snapback4-lang/tests/timeline_guide.rs` | Preserves the differential oracle through canonical admission-token renaming. |
| `crates/snapback4-lang/tests/guide.rs` | Expects the owned edge dependency in device residency. |
| `crates/snapback4-device/tests/timeline/round1.rs` | Checks private Edge partition parity on both device stores. |
| `crates/snapback4/src/timeline_cost.rs` | Updates follow/unfollow write and stream bounds for the admission row. |
| `crates/snapback4/tests/serve_timeline/mod.rs` | Uses the engine epoch for copied-event identity in the HTTP disclosure proof. |
| `crates/snapback4/tests/timeline/common.rs` | Includes Edges in owned-state snapshots. |
| `crates/snapback4/tests/timeline/identity.rs` | Checks canonical admission-row identity. |
| `crates/snapback4/tests/timeline/lifecycle.rs` | Includes admission rows in import/refusal/restore coverage. |
| `crates/snapback4/tests/timeline/review.rs` | Pins the reserved index across adoption and the new unfollow write count. |
| `crates/snapback4/tests/timeline_delivery.rs` | Verifies admission-row audience isolation and updated stream/write bounds. |
| `JOURNAL.md` | Dated review-fix entry with measurements, validation and remaining dependency. |
| `reports/20260924-following-v2/report.md` | Marks the earlier blocker report as resolved by this round. |
| `reports/20260924-following-v2/review-round1.md` | This review-fix report. |
| `reports/20260924-following-v2/review-round1-evidence.log` | Captured measurements, expected mutation-test failure, targeted outcomes and final-suite summary. |

The earlier counterexample and its log are retained as historical evidence;
the executable regression above replaces their former acceptance-blocker status.
