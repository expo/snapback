# First full run: every failure and its ownership

The full suite compiled its Rust inventory before the expectation corrections
were finished. The docs and Rust failures below are lane-owned: an obsolete
completeness or advice assertion, or the edited documentation exceeding its
unchanged budget. Each affected target was rerun after correction. Two client
timing failures are recorded separately at the end. This is a historical
failure record, not a claim that the full run was green.

- `docs budget`: README was 304/300 physical lines. Corrected to 300; the named first-account check and docs budget pass.

## snapback4-core::corpus (1.6 s)

- `corpus --- FAILED`
- `FAIL composite-copied-page-survives-push: expected card state Partial (corpus Fresh), got Fresh`
- `FAIL composite-merge-page-1: expected card state Partial (corpus Fresh), got Fresh`
- `FAIL composite-merge-page-2: expected card state Partial (corpus Fresh), got Fresh`
- `FAIL composite-merge-page-3: expected card state Partial (corpus Fresh), got Fresh`
- `FAIL composite-merge-page-4: expected card state Partial (corpus Fresh), got Fresh`
- `FAIL composite-range-page-1: expected card state Partial (corpus Fresh), got Fresh`
- `FAIL composite-range-page-2: expected card state Partial (corpus Fresh), got Fresh`
- `FAIL composite-range-page-3: expected card state Partial (corpus Fresh), got Fresh`
- `FAIL composite-range-page-4: expected card state Partial (corpus Fresh), got Fresh`
- `FAIL cursor-asc-after-duplicate-tie: expected card state Partial (corpus Fresh), got Fresh`
- `FAIL cursor-desc-after-two-pages: expected card state Partial (corpus Fresh), got Fresh`
- `FAIL edge-has-more-at-bound: expected card state Partial (corpus Fresh), got Fresh`
- `FAIL merge-500-lanes-take-20: expected card state Partial (corpus Fresh), got Fresh`
- `FAIL merge-exhausted-union-over-n: expected card state Partial (corpus Fresh), got Fresh`
- `FAIL merge-shared-cursor-page-two: expected card state Partial (corpus Fresh), got Fresh`
- `FAIL merge-ties-and-empty-lane: expected card state Partial (corpus Fresh), got Fresh`
- `FAIL named-thread: expected card state Partial (corpus Fresh), got Fresh`
- `FAIL scenario-delete-first: expected card state Partial (corpus Fresh), got Fresh`
- `FAIL scenario-hydrate: expected card state Partial (corpus Fresh), got Fresh`
- `FAIL scenario-local-send: expected card state Partial (corpus Fresh), got Fresh`

## snapback4-device::device::merge_continuation::memory::shape_pages::w13j_inherited_exhaustion_names_the_blocked_shape_and_prior_read (0.1 s)

- `merge_continuation::memory::shape_pages::w13j_inherited_exhaustion_names_the_blocked_shape_and_prior_read --- FAILED`

## snapback4-device::device::merge_continuation::sqlite::shape_pages::w13j_inherited_exhaustion_names_the_blocked_shape_and_prior_read (0.2 s)

- `merge_continuation::sqlite::shape_pages::w13j_inherited_exhaustion_names_the_blocked_shape_and_prior_read --- FAILED`

## snapback4-device::device::search_merge::r1a_left_read_cannot_mask_an_unknown_held_read_in_either_order (0.6 s)

- `search_merge::r1a_left_read_cannot_mask_an_unknown_held_read_in_either_order --- FAILED`

## snapback4-device::device::trending::rolling::w12a_bounded_ranking_coverage_on_both_stores (0.9 s)

- `trending::rolling::w12a_bounded_ranking_coverage_on_both_stores --- FAILED`

## snapback4-lang::extremum_expressions (0.2 s)

- `row_expressions_match_a_loop_with_nulls_and_named_outer_values --- FAILED`

## snapback4-lang::feed_forms (0.1 s)

- `filtered_merge_without_cursor_keeps_its_existing_incomplete_word --- FAILED`

## snapback4-lang::guide (1.9 s)

- `familiar::cards_meet_word_targets_and_preserve_every_original_compiled_block --- FAILED`

## snapback4-lang::repairs (0.5 s)

- `trending_card_finds_winners_after_200_and_1000_candidates_without_hiding_its_ceiling --- FAILED`
- `trending_card_ranks_the_day_and_reports_a_cut_set --- FAILED`

## snapback4-sim::clique::merge_continuation::shape_pages::w13j_inherited_exhaustion_names_the_blocked_shape_and_prior_read (0.5 s)

- `merge_continuation::shape_pages::w13j_inherited_exhaustion_names_the_blocked_shape_and_prior_read --- FAILED`

## snapback4-sim::clique::trending::w12a_fresh_ranking_seed_ties_boundaries_and_meter (0.2 s)

- `trending::w12a_fresh_ranking_seed_ties_boundaries_and_meter --- FAILED`

## snapback4::delivery_page (0.0 s)

- `first_fifty_deliveries_warn_and_both_rewrites_reach_the_new_acknowledgement --- FAILED`

## snapback4::scale_row_ranges (0.0 s)

- `live_view_page_and_point_certificates_cover_real_receipts --- FAILED`

## snapback4::check (10.8 s)

- `notes_stay_short_and_verbose_explains_each_code_once --- FAILED`
- `w10r1b_unscoped_cursor_note_never_proposes_a_whole_table_cap --- FAILED`
- `w9b_why_prints_a_codes_card_paragraph --- FAILED`

## Client tests: two timing failures, still open

The full run selected concurrent client files at host load 42.49 across 96
CPUs. These test bodies and the relevant client mutation/startup code are
unchanged by CQ. Both passed when rerun together in isolation: 11 passed,
0 failed, 0 skipped, 5,054.853267 ms. That does not erase the original red or
prove either failure impossible on another run.

1. `W6d web: two client POSTs with the caller id apply once after a lost reply`,
   `packages/snapback4/test/client-seams.test.mjs:282`: expected two attempts,
   saw one. Ownership: **environmental/timing, provisional**, not proven on
   the exact baseline. The fixture drops the response after the server has
   accepted it; sync may recover the receipt before the explicit retry. That
   race is an inference from the unchanged code, not a measured root cause.
2. `HTTP admission, encoding, slow readers and idle changes polls`,
   `packages/snapback4/test/http-bounds.test.mjs:87`: `server did not listen`
   within its three-second startup window. Ownership: **environmental/timing**.
   The isolated rerun completed all nine nested checks. No startup timeout or
   assertion was changed. Earlier host-load failures of this signature are
   documented in `issues/closed/20260914-snapback4-lifecycle-tests-time-out-under-host-load.md`;
   this CQ observation is Linux and is not proof of that older macOS cause.

Observed reproduction: the normal concurrent `scripts/test.sh` on this shared
host. Neither signature was reproduced by the following narrower command
(run from `snapback4/` after the package and wasm builds):

```sh
node --test --test-name-pattern='W6d web: two client POSTs|HTTP admission, encoding' \
  packages/snapback4/test/client-seams.test.mjs \
  packages/snapback4/test/http-bounds.test.mjs
```

All first-run CQ failures are resolved by the final affected checks. These two
unreproduced timing signatures remain for the supervisor; no unrelated client
behavior or test tolerance was changed in this lane.
