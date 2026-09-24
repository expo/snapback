# Lane C review round 2 — 2026-09-24

Branch: `sb4-intent/c-following`. Implementation commit: `e1ef352ea`.
All three Grok findings are addressed. Round 1's
five fixes remain in `e78b7f4b2`; its verification report is `4da10f8d6`. Local
commits only; no push or publication. FeedView binding still waits for the
supervisor's Lane A landing notification.

## Findings and changes

1. **Late delivery/window: confirmed fixed, with new proofs.** The round-1
   engine admission order gives each copy one producer: backfill owns events
   older than the current edge, while fan-out owns newer events. Neither the
   application's edge id nor `at` participates in this comparison. Worker
   progress counts examined edges, including skipped edges, so skipping cannot
   finish a full chunk early. No additional delivery runtime change was needed.
   The saved 1,100-event counterexample is now a committed regression expecting
   exactly the newest 1,000. Two late followers on opposite sides of a committed
   cursor receive identical history. A full chunk of 256 ineligible edges still
   advances to an eligible follower in the next chunk.
2. **Legacy device store: fixed.** Server and device share
   `schema::timeline::check_version`. Device open checks both the saved backend
   and selected backend before schema preparation or installation. Adoption
   checks the incoming backend before any mutation. A supplied modern backend
   cannot silently replace a saved legacy timeline. The refusal is exactly the
   server's `E_TIMELINE_REDEFINE`, including fresh-store guidance. Tests preserve
   metadata, a source row and an outbox entry on both memory and SQLite; the saved
   backend is still read only once. Legacy bytes remain decodable for diagnosis.
3. **Refollow first page: strengthened.** Before cleanup or backfill runs, the
   refollow test now explicitly asserts 20 distinct first-page event ids and one
   new-epoch copy for each. The round-1 whole-page traversal still asserts the
   exact 50-event preview and uniqueness before draining. Its previous mutation
   check failed when the epoch predicate was removed.

No authoring form, capability name, refusal code, disclosure prerequisite,
prediction boundary or meter ceiling changed in this round.

## Files

Paths are relative to `snapback4/`.

| File | Change |
|---|---|
| `crates/snapback4-core/src/schema/timeline.rs` | Shares the existing version fence with server and device. |
| `crates/snapback4-core/src/engine/mod.rs` | Server open calls the shared fence. |
| `crates/snapback4-core/src/engine/timeline.rs` | Activation calls the shared fence; removes its duplicate location. |
| `crates/snapback4-device/src/device.rs` | Checks saved/selected backends on open and the incoming backend on adoption. |
| `crates/snapback4-device/tests/schema_capabilities_legacy.rs` | Replaces two obsolete successful-open expectations with six codec/refusal/state-preservation tests. |
| `crates/snapback4-lang/tests/timeline_background.rs` | Adds cursor-side and all-skipped-chunk regressions; strengthens the pre-cleanup first page. |
| `crates/snapback4-lang/tests/timeline_epoch_counterexample.rs` | Promotes the saved backlog/window counterexample to a permanent acceptance test. |
| `reports/20260924-following-v2/epoch-counterexample.rs.txt` | Matches the committed 1,000-event regression. |
| `reports/20260924-following-v2/report.md` | Marks the original STOP historical and replaces copy/remove instructions with the committed test command. |
| `reports/20260924-following-v2/review-round2.md` | This report and reproduction instructions. |
| `reports/20260924-following-v2/review-round2-evidence.log` | Affected-test measurements, checks and full-suite summary. |
| `JOURNAL.md` | Dated, appended round-2 implementation and validation record. |

## Tests and running forms

New or strengthened tests:

| Test | Proof |
|---|---|
| `late_follow_can_receive_only_the_history_window_from_pending_deliveries` | 1,100 pending event tasks plus a late follow converge to precisely events `p0100` through `p1099`, with no pending/parked work. |
| `followers_on_both_sides_of_a_saved_cursor_receive_identical_history` | Late followers before/after the saved cursor each receive exactly the same 1,000 events; the earlier follower receives all 1,100. Application ids and clocks deliberately look older. |
| `a_full_chunk_of_skipped_edges_keeps_the_delivery_cursor_live` | 256 skipped edges commit only cursor progress; the next chunk reaches the eligible follower. |
| `history_window_epochs_and_pending_completeness` | First page has 20 distinct ids backed by new-epoch copies; every pre-cleanup page contains exactly the 50-event preview. |
| `genuine_legacy_codec_remains_recognized_but_timeline_execution_is_fenced` | Genuine pre-carrier bytes decode as v1 and round-trip their capabilities, but cannot execute. |
| `legacy_timeline_first_install_refuses_without_writes` | Both initial and explicit installs refuse a v1 backend before writing anything. |
| `legacy_timeline_reopen_refuses_memory` / `legacy_timeline_reopen_refuses_sqlite` | Kept, initial-modern and explicit-modern opens all refuse saved v1 state without changing it. |
| `legacy_timeline_adoption_refuses_memory` / `legacy_timeline_adoption_refuses_sqlite` | Both adoption entry points refuse v1 and preserve the live backend and durable state. |

The old `legacy_recorded_and_timeline_reopens_memory` and
`legacy_recorded_and_timeline_reopens_sqlite` expected v1 execution and were
replaced deliberately. Legacy codec compatibility itself remains tested.

The runnable no-cap declaration fixture remains
`crates/snapback4-lang/tests/fixtures/timeline-v2.q`. Representative forms still
compile and run:

```text
maintain feed: timeline
  events posts where .parentId = null and not .removed by authorId, at removed by removed
  reposts reposts by actorId, postId, at
  edges follows by followerId, followedId

return feed[viewer] after c last 20
insert follows { followerId: viewer, followedId: actor } if absent
delete follows[viewer, actor]
```

These are excerpts from the compiled fixture, not a standalone program. Posting,
reposting, removal, source disclosure and device prediction are also exercised by
the unchanged timeline suite. No new form was introduced by a review fix.

## Validation and remaining work

Affected tests passed: 17 background, one saved counterexample, six device legacy
fence, three device capability, 26 device timeline and three core legacy tests.
Reproduce from `snapback4/`:

```sh
cargo test -p snapback4-lang --test timeline_background --test timeline_epoch_counterexample -- --nocapture
cargo test -p snapback4-device --test schema_capabilities_legacy --test schema_capabilities --test timeline --no-fail-fast
cargo test -p snapback4-core --test schema_capabilities_legacy
```

Measured again: post writes **4/4** for five/900 followers; first-page examinations
**61/61** for five/500 follows. The 900-follower crash/reopen test completed in
**460 ms**, four chunks and 901 copies on this shared host. History is **1,000**,
preview **50**, and unfollow writes **259**. The wide-edge test still refuses at
**16,849,849 charged heap bytes** against **16,777,216**, without committing a copy
or cursor. Refused tasks park visibly; adaptive smaller chunks are outside this
review. Reproduce that limit with the background test
`delivery_charges_large_edge_payloads_before_materializing_them`.

`./ref-check --verbose`: 504 LLP docs, 9,209 refs in 25,444 files, zero errors or
unchecked refs. All touched source files remain below 1,500 lines.

The rebuilt Wasm artifact is **1,708,992 bytes raw / 473,405 gzip**, below the
unchanged **474,000-byte** budget.

Required full `scripts/test.sh` run, exit 1:

```text
== 1 failure(s) in 192 s
   cargo test
```

Full log: `/home/ccheever/sb4-intent/lane-c-round2-test.log`. Its only failing
step contains these three tests, all present in the supplied baseline:

| Classification | Test | Reproduction from `snapback4/` |
|---|---|---|
| Baseline | `uniform_word_expansion::search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots` | `cargo test -p snapback4-device --test device uniform_word_expansion::search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots` |
| Baseline | `census::authoring_census` | `cargo test -p snapback4-device --test readauth census::authoring_census` |
| Baseline | `w9b_why_operation_keeps_residency_and_cost_output` | `cargo test -p snapback4 --test check w9b_why_operation_keeps_residency_and_cost_output` |

No introduced or environmental failures occurred in this round. All affected
Rust targets passed in the full run as well. Client tests: **994 passed, zero
failed, ten existing skips** (1,004 total). The full run used the committed
implementation; only this report, evidence and the journal were finished later.

No deviation from the review requests. FeedView remains deferred by the explicit
dependency gate; until Lane A lands, use the declaration fixture above. No
migration, rebase, push, publication or cap increase was performed.
