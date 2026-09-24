# Timeline test changes for LLP 3000.013

The recipe itself is unchanged; its simulator tests remain. Declaration tests now exercise asynchronous delivery.

## equivalence.rs

Recipe-trace equality pins synchronous fan-out, promotion, slots, duplicate edges and 865-event history. Replaced by background acceptance tests and the counted/uncounted language-card oracle.

- `clique_trace_posts_reposts_removals_refollow_purge_and_profiles`
- `backfill_visits_900_pushed_then_100_shared_and_keeps_765`
- `pull_caps_refuse_atomically_and_promotion_is_permanent`
- `missing_pull_count_in_trusted_history_refuses_like_recipe`
- `ordinary_follow_refusals_match_without_partial_edges`
- `time_ties_page_by_event_id_and_tombstones_fill_the_page`
- `oracle_exception_tombstoned_repost_id_refuses_only_in_f3`

## latency.rs

The ignored latency envelope measured promotion and the two old delivery modes. Replaced by measured durable 900-follower delivery.

- `following_and_posting_latency_envelope`

## measure.rs

Measurements pin old table shapes, capped cleanup and author registration. Replaced by constant writer/read cost and chunk tests.

- `owned_row_and_index_byte_bounds_and_measured_transitions`
- `purge_chunks_over_1001_copies_preserve_live_rows`
- `eager_registration_cap_rolls_back_the_application_profile`

## sizing.rs

Sizes and registration caps no longer govern timelines. Replaced by compatibility-note and semantic-identity tests.

- `source`
- `sizing_values_and_bounds_are_exactly_the_recipe_parser`
- `expansion_admission_profile_note_and_default_encoding`
- `sized_registration_accepts_1008_and_refuses_1009_identically`
- `sized_backfill_clamps_to_200_and_865_without_changing_source_cap`
- `sized_5921_edge_cap_refuses_identically_and_rolls_back`
- `sized_activation_and_redefinition_are_atomic`
- `cli_reports_sized_timeline_cost`

## review.rs

Removed assertions about promotion, author registration or caller-visible purge jobs. Queue authority, recovery and immediate hiding have replacement tests.

- `promotion_counts_routes_once_and_totals_track_unfollow_refollow`
- `posting_without_a_profile_refuses_like_recipe`
- `purge_cannot_insert_update_or_delete_other_tables`
- `a_purge_program_has_delete_authority_for_every_matching_timeline`
- `digest_tombstones_keep_the_recipes_event_order_per_purge_chunk`

## round2.rs

Removed assertions about promotion, author registration or caller-visible purge jobs. Queue authority, recovery and immediate hiding have replacement tests.

- `overbudget_purge_deletes_park_and_rollback_the_entire_chunk`
- `purge_replays_read_and_application_setup_without_owned_authority`
- `purge_with_one_remaining_delete_rolls_back_copies_and_keeps_id_blocked`


## Further changed expectations

- `timeline_design.rs::ruled_promotion_write_headroom_and_atomic_overflow` and
  `eager_registration_preserves_recipe_admitted_posting_ceiling` became
  `background_record_and_source_share_the_1024_write_ceiling` and
  `size_and_authors_are_ignored_compatibility_clauses`: there is no promotion or
  registration write, and an inserted event now costs four writes.
- `timeline_delivery.rs::maximum_backfill_promotion_has_bounded_derived_bytes_and_private_partitions`
  became `follow_preview_and_delivery_have_bounded_bytes_and_private_partitions`:
  the preview has 50 copies and a work record; there are no public modes/routes.
- `lifecycle.rs` activation tests now allow arbitrary existing profile populations
  without owned author rows. Reopen/adoption/import/refusal assertions remain;
  pages before draining intentionally contain only delivered events.
- `review.rs::unfollow_hides_then_cleans_more_than_the_old_copy_cap` now checks
  256 synchronous copy deletes plus durable remaining cleanup.
- `review.rs::background_refusal_rolls_back_chunk_and_parks_work` replaces the
  obsolete promotion authority/reentry check with a real worker transaction
  rollback and parked task. Source authority and all four owned-table write
  fences remain covered.
- `timeline/identity.rs` derives copies from reader/event/edge epoch and work from
  kind/actor/reader/event/epoch. `serve_timeline` retains the paired-world
  tombstone refusal proof using an actually delivered foreign copy.
- Device registration tests now predict one application row and no author mode;
  size does not impose an author cap. Classification targets Work rather than
  PullCounts. Many-followers tests predict the same own Feed copy as small graphs.
- Device `round1` drops route probes and obsolete profile/mode/follower inputs
  to posting; foreign inbox probes, runtime authority, retention, tombstone
  coverage and replay/refusal assertions remain.
- Device `round2::absent_author_*` and `absent_follow_*` are removed because those
  are no longer inputs to posting. Tombstone absence/replay stays covered, and
  retained point/scan coverage now uses public events rather than author modes.
- Device `pending_history_memory` and `pending_history_sqlite` prove the pending
  reader task is replicated and makes local completeness false until completion.
- Guide tests use the second feeds block for the pre-existing complete app; the
  new first block is independently compiled without notes. Old generated purge
  schedule and pull dependencies are replaced by the inbox, edge, tombstone and
  pending-work dependencies. The existing maintained-column stream note exemption
  is preserved for the complete app block.
- Clique's independent model drops promotion and shared routes, uses a 1,000-event
  follow window and compares converged delivery. Lifecycle tests additionally
  check immediate removal before durable purge. Purge tasks replace job schedules.
- Capability tests require `timeline-v2`; the genuine legacy fixture still decodes
  as v1 but no longer equals a newly compiled declaration, and opening its stored
  schema must refuse. This intentionally replaces its pre-existing failing equality.
- Historical oversized-commit Rust/SDK fixtures now use 1,020 notes plus four
  timeline writes. Stream checks address the actual note-update sequence because
  background commits can occur between application commits. Own copy digests add
  the null self epoch. The original oversized-image/snapshot-recovery proof remains.
- `equal_times_order_by_event_id_and_removal_fills_the_page` restores explicit
  time-tie and tombstone page-filling coverage from the retired equivalence suite.

The recipe's synchronous behavior and its simulator tests are unchanged. The
known late-follower epoch counterexample is recorded separately under
`20260924-following-v2/`; its diagnostic probe is not counted as acceptance.
