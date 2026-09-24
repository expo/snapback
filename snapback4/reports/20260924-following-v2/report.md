# Lane C report — 2026-09-24

Branch: `sb4-intent/c-following`, base `6d9f3e001`. Local commits only; no push or publication.

**Not ready to merge: the literal fan-out epoch requirement needs a supervisor decision.**
The implemented reader tasks and copies carry edge epochs, but the one fan-out
record created by a post has no single recipient epoch. This produces the
verified late-follower/history-window counterexample below. I stopped that part
rather than inventing an eligibility rule. Everything else below is reviewable
implementation and measured evidence, not a claim that this blocker is resolved.

## Built behavior and forms

- `maintain feed: timeline` needs only events, reposts and edges. No author
  registration, timeline-imposed source caps, promotion, routes or broadcast lane.
  Explicit caps already authored on application tables still mean what they did.
- `authors profiles by principal` and `size authors 1008, edges 5921` still parse,
  compile and run, with `N_TIMELINE_COMPAT`; they do not affect delivery. The old
  numeric size grammar is retained only to recognize compatible declarations.
- Row-local originals selection: `events posts where .parentId = null and not
  .removed by authorId, at removed by removed`. Filter columns must be immutable
  except for the one-way removal flag; non-local/mutable selections refuse with
  `E_TIMELINE_FILTER` and a rewrite. Replies fail the selection and create no event.
- Reads remain `return feed[viewer] after c last 20`. Results are delivered inbox
  contents in descending `(at, eventId)` order. Each examined copy checks current
  edge epoch (unless own) and the public tombstone; a single reader-index probe
  makes `complete` false during backfill/cleanup, including parked work.
- Posting/reposting commits source, event, own inbox and durable work. Example:
  `insert posts { id: postId, authorId: viewer, parentId: null, at: now }`.
  `insert reposts { actorId: viewer, postId, at: now } if absent` requires a live
  original. Independent reposts survive original removal.
- `insert follows { followerId: viewer, followedId: actor } if absent` copies up
  to 50 events immediately; backfill copies the remainder of a 1,000-event engine
  window. `delete follows[viewer, actor]` hides immediately, deletes up to 256
  old-epoch copies, then enqueues remaining cleanup. Devices queue both operations
  without predicting any rows.
- `update posts[postId] { removed: true }` and `delete reposts[viewer, postId]`
  tombstone immediately and purge later. `FEED_EVENT_REMOVED` remains. Last purge
  cancels unfinished fan-out before retiring its tombstone in the same transaction.
- Owned `Posts`, `RemovedEvents`, `Feed` and `Work` tables replace the old shapes.
  Reader work is private and replicated so device completeness matches the server.
  Delivery/purge work is private to its actor. All mapped sources still require
  explicit public disclosure, full public sync, owner rules, immutable mapped
  fields, the required unique pairs, no expiry/horizon/maintained definition.
- Each worker chunk uses system authority, normal job ceilings, at most 256 source
  rows and one transaction for copies plus cursor. Copies use insert-if-absent
  identity `(reader, event, edge epoch)`; own copies use a null epoch.
- Dev/serve wake delivery on commit and recovery. Replay holds schedules/effects,
  not derived delivery. Ordinary maintenance keeps its prior one-second timing.
  Doctor prints pending/parked task counts. `timeline-v2` fences older engines and
  devices; opening a v1 store refuses with `E_TIMELINE_REDEFINE`. No migration.

The runnable standalone program is
`crates/snapback4-lang/tests/fixtures/timeline-v2.q`. Both new compiled guide
blocks are free of diagnostics and notes. The pre-existing complete feeds app
still has its pre-existing maintained-column stream note, explicitly checked by
its existing guide test exemption; that unrelated note was not suppressed.

## Measurements and proofs

| Measurement | Observed |
|---|---|
| Post, five followers | 4 writer-transaction rows |
| Post, 900 followers | 4 writer-transaction rows |
| Delivery to 900 followers | Four chunks, 901 total copies, first chunk 257 writes |
| Crash/reopen after first chunk, plus compatible index adoption | Completes with no duplicates; latest targeted run 140 ms including reopen/adoption |
| HTTP post in `dev --replay`, 900 followers | 73 ms in the initial isolated measurement; actual commit-triggered runner |
| First page, five follows | 61 examinations |
| First page, 500 follows | 61 examinations |
| Follow history with delivery drained beforehand | Preview 50; converged 1,000 from 1,100 live events |
| Unfollow from 1,000 delivered copies | 258 writes; 744 old copies remain, next read excludes them |
| Refollow before cleanup | 1,000 copies in the new edge epoch; retired cleanup cannot delete them |
| Wasm artifact | 1,708,337 raw / 473,253 gzip bytes; 474,000-byte budget unchanged |

New/expanded acceptance tests:

- `constant_writer_cost_and_crash_resumption_to_900_followers`: writer cost,
  chunk cost, committed-cursor recovery and index-adoption cursor stability.
- `read_cost_is_independent_of_follow_count`: equal measured first-page work.
- `follow_preview_unfollow_removal_and_refollow_are_immediate`: immediate preview,
  edge revocation and tombstones while work remains pending.
- `originals_filter_reposts_and_source_authority`: replies excluded, live-original
  admission, independent repost lifetime, owner rule, immutable/local filter refusal.
- `history_window_epochs_and_pending_completeness`: 50/1,000 history, bounded
  synchronous cleanup, epoch-safe refollow and pending completeness.
- `stale_meter_cut_has_a_continuation_and_never_claims_complete`: finite cursor
  progress over stale copies with a 101-examination ceiling.
- `overlapping_delivery_backfill_and_removal_never_duplicate_or_resurrect`: natural
  identity overlap does not park tasks and removed events never return.
- `last_purge_chunk_cancels_an_older_delivery_before_retiring_tombstone`: inverted
  task order, multi-chunk purge and atomic retirement of copies/tombstone/delivery.
- `equal_times_order_by_event_id_and_removal_fills_the_page`: deterministic ties
  and filling a page through tombstoned newer events. Added after the final suite;
  its focused test passed separately.
- Device `pending_history_memory`/`pending_history_sqlite`: replicated pending
  state, local completeness and immediate unfollow semantics on both stores.
- `background_refusal_rolls_back_chunk_and_parks_work`: partial chunk writes roll
  back and the refusal is durable/operator-visible.
- `background_record_and_source_share_the_1024_write_ceiling`: 1,020 application
  notes plus a four-row post fit; one more note rolls everything back.
- `legacy_timeline_store_refuses_before_open_or_adoption` and capability tests:
  no legacy store silently adopts the new owned shapes.
- `replay_delivers_900_followers_promptly_after_commit_without_schedules`: real
  host wakeup/replication path while replay holds schedules.
- Counted/uncounted language-card oracle compares pending and converged state.
  Clique's independent oracle covers profiles, posts, replies, reposts, removal,
  follow/unfollow, device restart/adoption, counts and cursor pages.

All 26 device timeline tests, 55 guide tests, four timeline-guide tests, 23 CLI
lifecycle/admission/authority tests, three reduced Clique tests and three Clique
census tests pass. The original recipe/simulator tests remain unchanged. Native
and Wasm devices from the pre-change 0.3 checkout both refuse `timeline-v2`;
native refuses before creating a device store. Evidence is beside this report.
`ref-check --verbose`: 504 LLP docs, 9,208 refs in 25,440 files, zero errors or unchecked refs.

Every removed or rewritten old test and its reason is listed in
[`../20260924-following-v2-tests.md`](../20260924-following-v2-tests.md).

## STOP: fan-out epoch / late-follow eligibility

Addendum 2 requires every delivery task to carry the edge epoch that admitted it.
The original brief requires exactly one durable delivery record per post and
constant writer cost. A post with two followers has edge epochs `e1` and `e2`:
that one record cannot have one epoch equal to both. Enumerating all recipients
inside the writer would reintroduce work proportional to follower count and
could exhaust the unchanged mutation meter.

The current implementation discovers the current edge/epoch inside each fan-out
chunk. Backfill and cleanup tasks do carry their specific epoch; copies carry
that epoch, and reads validate it. Thus the refollow cleanup race is fixed, but
recipient eligibility at the time fan-out was enqueued is not represented.

**Verified counterexample:** insert 1,100 original events before any follower,
leave their fan-out tasks pending, then follow and drain. The backfill obeys its
1,000-event limit, but the old fan-out tasks also visit the new edge. The reader
ends with **1,100** copies. This differs from following after those initial
fan-out tasks have drained (1,000 copies), and is why the epoch interpretation
cannot be treated as a harmless wording difference.

Reproduce from `snapback4/`:

```sh
cp reports/20260924-following-v2/epoch-counterexample.rs.txt crates/snapback4-lang/tests/timeline_epoch_counterexample.rs
cargo test -p snapback4-lang --test timeline_epoch_counterexample late_follow_can_receive -- --nocapture
rm crates/snapback4-lang/tests/timeline_epoch_counterexample.rs
```

The diagnostic probe deliberately asserts the observed 1,100; its passing result
is **not** an acceptance pass. Its output is in `epoch-counterexample.log`.
No eligibility redesign was made. Supervisor resolution is required before merge.

## Other deviations and deferred work

- The addenda supersede the original unlimited-history instruction: the implemented
  backfill window is 1,000, own-copy identity includes the epoch, and unfollow
  performs up to 256 deletes synchronously.
- Reader work is synced privately so the completeness contract is executable
  locally. Non-reader fan-out/purge work uses an actor-private partition and a null
  reader key; it cannot make the actor's page incomplete.
- Delivery scans a stable `(followed, follower)` index, synthesizing one if needed.
  Choosing an arbitrary authored followed-leading index would reinterpret a
  persisted cursor on compatible adoption; the recovery test covers this choice.
- Existing author/size/purge fields and a few old constants remain in Rust schema
  compatibility code. V2 creates no modes, pulls, totals, broadcast or purge job.
- I did not rebase or bind `FeedView`: no supervisor notification that Lane A
  landed arrived. The target's Following behavior was exercised in declaration
  form. Attempting `view following: activity ...` remains outside this lane's
  completed work until that dependency is delivered.
- The rest of the feeds card and historical Clique reports retain old prose by
  the lane boundary; the guide lane must reconcile them. Only the requested
  section and required compiled/declaration expectations were changed.
- No migration, publication, push, ceiling increase, private-source materialization
  or follow/unfollow device prediction was added. All modified source files stay
  below 1,500 lines.

## Exact suite results and failures

Final full `scripts/test.sh` run:

```text
== 1 failure(s) in 173 s
   cargo test
```

Log: `/home/ccheever/sb4-intent/lane-c-test-final.log`.
All three failing tests are present in the supplied baseline:

| Classification | Test | Reproduction from snapback4/ |
|---|---|---|
| Baseline | `uniform_word_expansion::search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots` | `cargo test -p snapback4-device --test device uniform_word_expansion::search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots` |
| Baseline | `census::authoring_census` | `cargo test -p snapback4-device --test readauth census::authoring_census` |
| Baseline | `w9b_why_operation_keeps_residency_and_cost_output` | `cargo test -p snapback4 --test check w9b_why_operation_keeps_residency_and_cost_output` |

No new failing suite test remains. The client summary is 1,004 tests: 994 passed,
zero failed, ten pre-existing skips. The known epoch counterexample above remains
an acceptance blocker despite that result.

The first full run was `== 2 failure(s) in 238 s` (`cargo test`, `client tests`),
log `/home/ccheever/sb4-intent/lane-c-test.log`. Its additional failures were:

- **Ours, fixed:** capabilities derived under the old name; old route-total maintain
  target; old legacy-store reopen expectation; both Clique lifecycle/application
  oracle tests; feeds block selection; historical commit's 1,021-note envelope;
  SDK recovery's old copy digest, note count and assumption of no intervening work
  commit. These were deliberate semantic changes or missing test adaptations.
- **Baseline with changed meaning, updated:**
  `genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier` now
  explicitly distinguishes decoded v1 from compiled v2, while preserving the
  actual legacy decoding/carrier checks.
- **Ours, fixed:** ordinary maintenance was accidentally run immediately on startup;
  restore/parked-job timing and adoption-lock retry tests exposed the regression.
  Restored its one-second timing while keeping delivery immediate.
- **Environmental/transient on that run:** `raw HTTP settlement validates declared
  results terminally and never reclaims them` (fetch failure), `actual worker
  crashes replay a completed step or reconcile uncertain provider acceptance`,
  and `sync store identity survives a server restart; a live client detects an
  equal-watermark replacement`. All passed focused retry and the final full run;
  no application/action/store-reset implementation was changed. The timing failures
  may also have been affected by the startup correction; root cause was not isolated.

The final suite preceded only an additional passing time-tie test, comments,
whitespace, this report and the journal; no runtime behavior changed afterward.

## File-by-file changes

All paths below are relative to `snapback4/`.

| File | Change |
|---|---|
| `crates/snapback4-core/src/engine/components.rs` | Tracks pending reader work in component completeness. |
| `crates/snapback4-core/src/engine/local.rs` | Includes pending work in local query completeness. |
| `crates/snapback4-core/src/engine/maintains.rs` | Refuses aggregate targets in timeline-owned tables; updates authority test. |
| `crates/snapback4-core/src/engine/mod.rs` | Fences legacy store opening and includes pending state in server outcomes. |
| `crates/snapback4-core/src/engine/read.rs` | Runs the pending probe and preserves continuation on interrupted timeline predicates. |
| `crates/snapback4-core/src/engine/runner.rs` | Stores pending timeline state for the current query. |
| `crates/snapback4-core/src/engine/timeline.rs` | Event/filter/removal transitions, durable task enqueue, epoch copy identities and pending probe. |
| `crates/snapback4-core/src/engine/timeline/online.rs` | 50-copy follow preview, 1,000-event backfill budget and 256-delete unfollow preview. |
| `crates/snapback4-core/src/engine/timeline/work.rs` | Durable chunk runner, epoch checks, cursor commits, purge/cancel ordering, parking and counts. |
| `crates/snapback4-core/src/engine/timeline_authority_tests.rs` | Uses canonical v2 owned/mapped fixtures for authority tests. |
| `crates/snapback4-core/src/schema/capabilities.rs` | Derives and recognizes the timeline-v2 fence separately from legacy timeline. |
| `crates/snapback4-core/src/schema/timeline.rs` | Version/filter metadata, four owned roles, engine window/chunk constants and canonical ownership. |
| `crates/snapback4-core/tests/schema_capabilities.rs` | Checks v2 capability derivation and exact round trips. |
| `crates/snapback4-core/tests/schema_capabilities_legacy.rs` | Preserves legacy decoding; separates v1/v2 and refuses legacy store open. |
| `crates/snapback4-device/tests/timeline.rs` | Adapts prediction/registration/partition tests; adds pending history on both stores. |
| `crates/snapback4-device/tests/timeline/round1.rs` | Retains disclosure, retention and tombstone proofs using new inbox identities. |
| `crates/snapback4-device/tests/timeline/round2.rs` | Retains missing-tombstone/replay/retained-read proofs; removes obsolete author/follower inputs. |
| `crates/snapback4-lang/src/ast.rs` | Optional size and originals predicate in TimelineDecl. |
| `crates/snapback4-lang/src/bind/mod.rs` | Avoids horizon notes that contradict required full timeline source partitions. |
| `crates/snapback4-lang/src/bind/residency.rs` | Exposes the implicit pending-work read dependency. |
| `crates/snapback4-lang/src/bind/timeline.q` | Canonical public event/tombstone and private inbox/work table shapes. |
| `crates/snapback4-lang/src/bind/timeline.rs` | Admission without caps/registration, immutable filter, owned expansion, stable followed index and epoch-aware read. |
| `crates/snapback4-lang/src/diag.rs` | Maps new filter and compatibility diagnostics to feeds. |
| `crates/snapback4-lang/src/guide/codes.rs` | Registers E_TIMELINE_FILTER and N_TIMELINE_COMPAT with concrete rewrites. |
| `crates/snapback4-lang/src/guide/feeds.md` | Requested contract section, no-cap compiled example, diagnostics and compatible declaration cleanup. |
| `crates/snapback4-lang/src/guide/language.rs` | Compiles the optional-authors/no-size/filter declaration in the language card. |
| `crates/snapback4-lang/src/parser/timeline.rs` | Parses optional authors/size and row-local events filter. |
| `crates/snapback4-lang/tests/clique_03/lifecycle.rs` | Drains delivered state for device comparison and tests durable purge tasks. |
| `crates/snapback4-lang/tests/clique_03/measure.rs` | Removes the promotion assertion; retains independent graph/read/write measurements. |
| `crates/snapback4-lang/tests/clique_03/mod.rs` | Explicit background draining at converged fixture boundaries. |
| `crates/snapback4-lang/tests/clique_03/model.rs` | Independent copies/current-edges/window model, with no promotion or pull semantics. |
| `crates/snapback4-lang/tests/fixtures/timeline-v2.q` | Runnable no-cap filtered originals/reposts/edges program. |
| `crates/snapback4-lang/tests/guide.rs` | Updates guide block positions, schedule/dependency expectations and new contract assertions. |
| `crates/snapback4-lang/tests/guide/feeds.rs` | Runs the complete card against new delivery semantics, preserving source/read oracles. |
| `crates/snapback4-lang/tests/guide/feeds_followups.rs` | Selects the complete Global/Trending block after adding the standalone timeline block. |
| `crates/snapback4-lang/tests/timeline_background.rs` | Nine measurement, recovery, history, epoch, filter, removal and pagination tests. |
| `crates/snapback4-lang/tests/timeline_guide.rs` | Compares counted/uncounted timelines before and after background drain. |
| `crates/snapback4/src/serve_maintenance.rs` | Commit-triggered/recovery delivery and replay support; preserves ordinary maintenance cadence. |
| `crates/snapback4/src/timeline_cost.rs` | Prices constant posts, previews, chunks, per-examined-row probes and bounded stream bytes. |
| `crates/snapback4/src/verbs.rs` | Doctor pending/parked work output. |
| `crates/snapback4/tests/feed_bridge.rs` | Selects the complete feeds example while keeping recipe helper/bridge tests. |
| `crates/snapback4/tests/replay.rs` | Real HTTP replay delivery to 900 followers without scheduled jobs. |
| `crates/snapback4/tests/serve_timeline/mod.rs` | HTTP paired-world tombstone refusal using epoch-derived delivered copy IDs. |
| `crates/snapback4/tests/timeline.rs` | Removes registrations of retired promotion/size/equivalence test modules. |
| `crates/snapback4/tests/timeline/admission.rs` | Preserves public-source/ownership/immutability refusals; drops required caps and updates costs. |
| `crates/snapback4/tests/timeline/common.rs` | New owned roles and drain helper; removes obsolete recipe/declaration trace-pair harness. |
| `crates/snapback4/tests/timeline/equivalence.rs` | Removed obsolete synchronous/promotion/size tests; exact names and replacements in the test-change inventory. |
| `crates/snapback4/tests/timeline/identity.rs` | Canonical epoch-aware copy/task identity assertions. |
| `crates/snapback4/tests/timeline/latency.rs` | Removed obsolete synchronous/promotion/size tests; exact names and replacements in the test-change inventory. |
| `crates/snapback4/tests/timeline/lifecycle.rs` | Unbounded registration-independent activation, pending persistence/import fences and legacy refusal. |
| `crates/snapback4/tests/timeline/measure.rs` | Removed obsolete synchronous/promotion/size tests; exact names and replacements in the test-change inventory. |
| `crates/snapback4/tests/timeline/review.rs` | Authority, natural identity, asynchronous cleanup and worker rollback/parking regressions. |
| `crates/snapback4/tests/timeline/round2.rs` | Canonical ownership tamper/collision and hit/miss refusal proofs without obsolete purge jobs. |
| `crates/snapback4/tests/timeline/sizing.rs` | Removed obsolete synchronous/promotion/size tests; exact names and replacements in the test-change inventory. |
| `crates/snapback4/tests/timeline_delivery.rs` | Preview/chunk stream envelopes and recipient partition isolation. |
| `crates/snapback4/tests/timeline_delivery_counterexample.rs` | Preserves oversized historical-image counterexample with four-write post cost. |
| `crates/snapback4/tests/timeline_design.rs` | Mutation ceiling atomicity and compatibility clauses replace promotion/eager-registration tests. |
| `examples/clique-03/census.test.mjs` | Matches the optional-authors/no-size declaration. |
| `examples/clique-03/fence.test.mjs` | Expects timeline-v2 capability in the integrated backend. |
| `examples/clique-03/snapback/schema.q` | Removes unused authors and size clauses; application source caps retain their meaning. |
| `packages/snapback4/test/helpers/timeline-recovery.mjs` | Epoch-derived own IDs and actual update sequence boundaries in SDK recovery proof. |
| `packages/snapback4/test/helpers/timeline-recovery.q` | 1,020 application notes leave room for source/event/own-copy/task writes. |
| `packages/snapback4/test/timeline-delivery.test.mjs` | Updates the exact note count in the retained SDK recovery regression. |
| `JOURNAL.md` | One dated append recording implementation, measurements, scope and the epoch blocker. |
| `reports/20260924-following-v2-tests.md` | Complete retired/rewritten test inventory and reasons. |
| `reports/20260924-following-v2/report.md` | This report, deviations, failures and reproduction instructions. |
| `reports/20260924-following-v2/epoch-counterexample.rs.txt` | Copyable diagnostic reproduction of the unresolved late-follow window behavior. |
| `reports/20260924-following-v2/epoch-counterexample.log` | Observed 1,100-copy result. |
| `reports/20260924-following-v2/native-fence.log` | Pre-change native device rejects timeline-v2. |
| `reports/20260924-following-v2/wasm-fence.log` | Pre-change Wasm device rejects timeline-v2. |
| `reports/20260924-following-v2/measurements.log` | Captured writer/read/chunk/runner timing and stream bound measurements. |
