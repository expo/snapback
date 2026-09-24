# Lane A, round 11 — optional filters, keyed existence, empty search

2026-09-24. Branch `sb4-intent/a-planner`, starting at `ea8cefd55`.

## Delivered behavior

```quarry
return issues where .org = org and (status = null or .status = status) and (assignee = null or .assignee = assignee) last 50 by .at after c
return count(issues where .org = org and (status = null or .status = status))
return issues where .org = org and exists issueLabels[.id, label] last 50 by .at after c
return profiles matching q first 20 by .handle after c
```

The board chooses four ordinary indexed reads. Absent filters disappear;
present filters pin, seek or enumerate admissible value lanes. Counts/sums
remain streaming and return null on interrupted totals. The label predicate
uses authorized unique point probes when label-driven enumeration is not
uniformly authorized. Empty, whitespace-only and punctuation-only search
needles browse, retaining ordinary order, rules and pagination on both hosts.

A cursor binds the presence combination even when indexes are shared. Changing
presence refuses with E_CURSOR_INDEX and a restart-with-null message. Matching
expressions are evaluated once; presence folding uses the existing metered
tokenizer. IR additions default to absent and omit themselves on serialization.
The frozen lowering corpus and legacy IR remain byte-compatible.

## Files

| File | Change |
|---|---|
| [llp/3000.013-quarry-states-intent.rfc.md](../../llp/3000.013-quarry-states-intent.rfc.md) | Records optional-input alternatives, exact-probe fallback, empty search, shared cursor identity and aggregate semantics. |
| [snapback4/crates/snapback4-core/src/cursor.rs](../crates/snapback4-core/src/cursor.rs) | Optional default/omitted scope identity; E_CURSOR_INDEX on presence mismatch. |
| [snapback4/crates/snapback4-core/src/engine/native.rs](../crates/snapback4-core/src/engine/native.rs) | Mechanical constructor migration: variant: None; preserves existing serialized forms and test purpose. |
| [snapback4/crates/snapback4-core/src/engine/prefetch.rs](../crates/snapback4-core/src/engine/prefetch.rs) | Mechanical constructor migration: variant: None; preserves existing serialized forms and test purpose. |
| [snapback4/crates/snapback4-core/src/engine/read.rs](../crates/snapback4-core/src/engine/read.rs) | Validates and carries variant scope through ordinary, word and eager-merge pages and output cursors; preserves candidate retries when conditional exists is cut. |
| [snapback4/crates/snapback4-core/src/engine/runner.rs](../crates/snapback4-core/src/engine/runner.rs) | Meters search term folding, carries the identity through returned page ownership. |
| [snapback4/crates/snapback4-core/src/engine/timeline.rs](../crates/snapback4-core/src/engine/timeline.rs) | Mechanical constructor migration: variant: None; preserves existing serialized forms and test purpose. |
| [snapback4/crates/snapback4-core/src/engine/view_merge.rs](../crates/snapback4-core/src/engine/view_merge.rs) | Validates and preserves presence on projected view pages. |
| [snapback4/crates/snapback4-core/src/engine/word_merge.rs](../crates/snapback4-core/src/engine/word_merge.rs) | Checks presence before lazy discovery, including empty value lists; preserves it in page positions. |
| [snapback4/crates/snapback4-core/src/engine/write_target.rs](../crates/snapback4-core/src/engine/write_target.rs) | Marks search presence as a pure builtin for write analysis. |
| [snapback4/crates/snapback4-core/src/ir.rs](../crates/snapback4-core/src/ir.rs) | Optional default/omitted variant identity on Scan/Merge; fixed-size lossless JSON identity; SearchPresent builtin. |
| [snapback4/crates/snapback4-core/src/words.rs](../crates/snapback4-core/src/words.rs) | Documents Quarry browse lowering versus unchanged raw words-index IR. |
| [snapback4/crates/snapback4-core/tests/common/cursors.rs](../crates/snapback4-core/tests/common/cursors.rs) | Mechanical constructor migration: variant: None; preserves existing serialized forms and test purpose. |
| [snapback4/crates/snapback4-core/tests/common/meter.rs](../crates/snapback4-core/tests/common/meter.rs) | Mechanical constructor migration: variant: None; preserves existing serialized forms and test purpose. |
| [snapback4/crates/snapback4-core/tests/lane_source.rs](../crates/snapback4-core/tests/lane_source.rs) | Mechanical constructor migration: variant: None; preserves existing serialized forms and test purpose. |
| [snapback4/crates/snapback4-core/tests/maintained_columns_review.rs](../crates/snapback4-core/tests/maintained_columns_review.rs) | Mechanical constructor migration: variant: None; preserves existing serialized forms and test purpose. |
| [snapback4/crates/snapback4-core/tests/read_verdict/mod.rs](../crates/snapback4-core/tests/read_verdict/mod.rs) | Mechanical constructor migration: variant: None; preserves existing serialized forms and test purpose. |
| [snapback4/crates/snapback4-device/tests/codec.rs](../crates/snapback4-device/tests/codec.rs) | Mechanical constructor migration: variant: None; preserves existing serialized forms and test purpose. |
| [snapback4/crates/snapback4-device/tests/device_diet.rs](../crates/snapback4-device/tests/device_diet.rs) | Mechanical constructor migration: variant: None; preserves existing serialized forms and test purpose. |
| [snapback4/crates/snapback4-device/tests/intent_variants.rs](../crates/snapback4-device/tests/intent_variants.rs) | Memory and SQLite/reopen execution of all four plans, cursor scope, aggregate and empty search. |
| [snapback4/crates/snapback4-lang/src/bind/intent_aggregates.rs](../crates/snapback4-lang/src/bind/intent_aggregates.rs) | Exposes the existing safe aggregate-order selection to presence leaves. |
| [snapback4/crates/snapback4-lang/src/bind/intent_lanes.rs](../crates/snapback4-lang/src/bind/intent_lanes.rs) | Checks discovery-source rule uniformity before committing lane extraction; preserves exact point predicates and membership self-witness proofs. |
| [snapback4/crates/snapback4-lang/src/bind/intent_variants.rs](../crates/snapback4-lang/src/bind/intent_variants.rs) | New pass: input-only local tracking, up to three presence inputs, safe predicate recognition, search snapshots, ordinary conditional reads and distributed streaming consumers. |
| [snapback4/crates/snapback4-lang/src/bind/mod.rs](../crates/snapback4-lang/src/bind/mod.rs) | Runs presence expansion before view and index planning; traverses conditional blocks for merge notes and cost explanations. |
| [snapback4/crates/snapback4-lang/src/bind/program.rs](../crates/snapback4-lang/src/bind/program.rs) | Tracks active presence decisions and attaches identities to scans and authored merges. |
| [snapback4/crates/snapback4-lang/src/bind/program/control.rs](../crates/snapback4-lang/src/bind/program/control.rs) | Narrows optional bindings inside their selected presence branch. |
| [snapback4/crates/snapback4-lang/src/bind/program/expr.rs](../crates/snapback4-lang/src/bind/program/expr.rs) | Lowers private presence tests, evaluates a search needle once, and shares logical page sites between exclusive alternatives. |
| [snapback4/crates/snapback4-lang/src/bind/program/reads.rs](../crates/snapback4-lang/src/bind/program/reads.rs) | Derives stable 128-bit variant identities; retains every selection in why/check output. |
| [snapback4/crates/snapback4-lang/src/bind/program/views.rs](../crates/snapback4-lang/src/bind/program/views.rs) | Carries the active presence identity through planned merges. |
| [snapback4/crates/snapback4-lang/src/bind/residency/components.rs](../crates/snapback4-lang/src/bind/residency/components.rs) | Preserves independent returned-field proofs across exclusive alternatives, counting the maximum branch reads and all dependencies. |
| [snapback4/crates/snapback4-lang/src/diag.rs](../crates/snapback4-lang/src/diag.rs) | Routes N_OPTIONAL_FILTER_LIMIT to the reads card. |
| [snapback4/crates/snapback4-lang/src/guide/codes.rs](../crates/snapback4-lang/src/guide/codes.rs) | Registers the fallback note and explains presence-sensitive E_CURSOR_INDEX. |
| [snapback4/crates/snapback4-lang/src/guide/language.rs](../crates/snapback4-lang/src/guide/language.rs) | Compiled optional board example and new search meaning. |
| [snapback4/crates/snapback4-lang/src/guide/reads.rs](../crates/snapback4-lang/src/guide/reads.rs) | Compiled optional-filter example, three-input limit, cursor and certificate rules, exact-probe fallback. |
| [snapback4/crates/snapback4-lang/src/guide/search.rs](../crates/snapback4-lang/src/guide/search.rs) | One-query directory; empty, whitespace and punctuation browse; explicit empty-screen guard. |
| [snapback4/crates/snapback4-lang/src/parser/expr.rs](../crates/snapback4-lang/src/parser/expr.rs) | Accepts == within the optional-filter idiom, preserving ordinary equality-repair diagnostics elsewhere. |
| [snapback4/crates/snapback4-lang/tests/fixtures/intent-variants.q](../crates/snapback4-lang/tests/fixtures/intent-variants.q) | Shared board, aggregate, range, local, label and search backend for server/device/certificate tests. |
| [snapback4/crates/snapback4-lang/tests/intent_nulls.rs](../crates/snapback4-lang/tests/intent_nulls.rs) | Counts both browse/search alternatives while retaining every value/null-lane and authorization assertion. |
| [snapback4/crates/snapback4-lang/tests/intent_target.rs](../crates/snapback4-lang/tests/intent_target.rs) | Migrates a non-uniform discovery test to exact probes; hidden rows and a resumed meter cut remain asserted. |
| [snapback4/crates/snapback4-lang/tests/intent_variants.rs](../crates/snapback4-lang/tests/intent_variants.rs) | Nine server/planner regressions detailed below. |
| [snapback4/crates/snapback4-lang/tests/maintained_columns.rs](../crates/snapback4-lang/tests/maintained_columns.rs) | Mechanical constructor migration: variant: None; preserves existing serialized forms and test purpose. |
| [snapback4/crates/snapback4-lang/tests/prefix_reads.rs](../crates/snapback4-lang/tests/prefix_reads.rs) | Asserts existence consumes one row in both browse and word scans; exact keys remain probes. |
| [snapback4/crates/snapback4-lang/tests/residency_notes.rs](../crates/snapback4-lang/tests/residency_notes.rs) | Both authored search and browse merges retain wide-lane advice; prediction/horizon assertions stay intact. |
| [snapback4/crates/snapback4-lang/tests/search_guidance.rs](../crates/snapback4-lang/tests/search_guidance.rs) | Pins the single-query directory guidance and explicit opt-out guard. |
| [snapback4/crates/snapback4-sim/tests/common/write_observation.rs](../crates/snapback4-sim/tests/common/write_observation.rs) | Mechanical constructor migration: variant: None; preserves existing serialized forms and test purpose. |
| [snapback4/crates/snapback4-sim/tests/condition_authority.rs](../crates/snapback4-sim/tests/condition_authority.rs) | Mechanical constructor migration: variant: None; preserves existing serialized forms and test purpose. |
| [snapback4/crates/snapback4-sim/tests/page_admission.rs](../crates/snapback4-sim/tests/page_admission.rs) | Mechanical constructor migration: variant: None; preserves existing serialized forms and test purpose. |
| [snapback4/crates/snapback4/src/scale.rs](../crates/snapback4/src/scale.rs) | Per-variant class/index facts and growth conditions; whole operation grows if any branch grows. |
| [snapback4/crates/snapback4/src/scale/display.rs](../crates/snapback4/src/scale/display.rs) | Builder-facing presence labels, constant alternatives and qualified growth; hides compiler needle/local names. |
| [snapback4/crates/snapback4/tests/scale.rs](../crates/snapback4/tests/scale.rs) | Adds the language card board to the expected constant-operation set. |
| [snapback4/crates/snapback4/tests/scale_variants.rs](../crates/snapback4/tests/scale_variants.rs) | Two certificate tests: four constant combinations, conditional growth, exact probe explanation, and mixed constant/growing combinations. |
| [snapback4/metrics/wasm-budget.json](../metrics/wasm-budget.json) | Records the measured 487,805-byte gzip artifact and raises the authorized byte ratchet to 488,000; runtime ceilings unchanged. |
| [snapback4/crates/snapback4-core/src/engine/mod.rs](../crates/snapback4-core/src/engine/mod.rs) | Exports the page-origin helper used by returned shape lowering. |
| [snapback4/crates/snapback4-core/src/engine/pages.rs](../crates/snapback4-core/src/engine/pages.rs) | Derives page ownership through conditional blocks, including wrapped returned pages. |
| [snapback4/crates/snapback4-lang/src/bind/program/returned_shapes.rs](../crates/snapback4-lang/src/bind/program/returned_shapes.rs) | Tracks inline and singly bound conditional pages so unfinished shapes retry their source row. |
| [snapback4/crates/snapback4-device/tests/guide_examples/mod.rs](../crates/snapback4-device/tests/guide_examples/mod.rs) | Runs the single directory query for browse and search with ordered handles and continuation. |
| [snapback4/crates/snapback4-device/tests/search_merge/mod.rs](../crates/snapback4-device/tests/search_merge/mod.rs) | Consolidates duplicate covering fixture indexes into unique byTime; locates words scans through alternatives while retaining authorization and expiry checks. |
| [snapback4/crates/snapback4-sim/tests/clique.rs](../crates/snapback4-sim/tests/clique.rs) | Changes empty search expectation to the newest visible browse rows. |
| [snapback4/crates/snapback4-sim/tests/common/held_coverage.rs](../crates/snapback4-sim/tests/common/held_coverage.rs) | Counts both search alternatives; checks empty-needle browse rows while retaining incomplete coverage assertions. |
| [snapback4/crates/snapback4-sim/tests/search_directory/mod.rs](../crates/snapback4-sim/tests/search_directory/mod.rs) | Tests one directory query for empty, whitespace, punctuation and real terms, with continuation. |
| [snapback4/crates/snapback4-sim/tests/search_merge.rs](../crates/snapback4-sim/tests/search_merge.rs) | Checks both pages of an empty-search browse merge. |
| [snapback4/crates/snapback4-sim/tests/uniform_word_expansion/fixture.rs](../crates/snapback4-sim/tests/uniform_word_expansion/fixture.rs) | Finds exactly one words scan recursively when constructing the unchanged nested-cursor stress fixtures. |
| [snapback4/crates/snapback4/tests/check.rs](../crates/snapback4/tests/check.rs) | Expects wide-merge advice for both search and browse alternatives. |
| [snapback4/packages/snapback4/test/fixtures/word-expansion.json](../packages/snapback4/test/fixtures/word-expansion.json) | Regenerates the compiled Quarry backend fixture with search/browse alternatives; raw IR corpus stays unchanged. |
| [snapback4/packages/snapback4/test/retained-history.test.mjs](../packages/snapback4/test/retained-history.test.mjs) | Uses the same consolidated unique byTime fixture index as the native device suite. |
| [snapback4/packages/snapback4/test/word-expansion.test.mjs](../packages/snapback4/test/word-expansion.test.mjs) | Locates exactly one search alternative for budget preludes; retains every index/examined/heap and time-hidden-work assertion. |
| `snapback4/JOURNAL.md` | One appended dated round entry with measurements, checks and exclusions. |
| `snapback4/reports/20260924-intent-lane-a-r11.md` | This file-level report. |

## Regression evidence

`intent_variants.rs`:

1. `board_variants_pin_arguments_and_page_every_matching_row`: four exact index
   column sets, no residual filters, runtime cursor index, all paginated rows;
   null assignee included only with absent assignee input.
2. `cursor_presence_is_checked_even_when_the_index_is_shared`: board and range
   presence changes both reject saved cursors.
3. `aggregate_and_argument_only_local_choose_the_same_presence_branch`: complete
   5/3 totals and argument-only local aliases select the correct branch.
4. `exact_exists_stays_a_ruled_probe_when_discovery_is_not_admitted`: positional
   and named full unique keys compile without a discovery cap; hidden label
   rows cannot make visible issues match.
5. `empty_folded_search_browses_with_order_continuation_and_authorization`:
   empty/whitespace/punctuation browse in handle order, nonempty words still
   filter, hidden profiles stay hidden.
6. `fourth_optional_filter_stays_residual_and_names_its_fallback`: eight plans,
   named d note, retained residual, and correct filtering by that fourth input.
7. `optional_equality_accepts_both_spellings_and_orders`: =, ==, reversed guards
   and reversed disjuncts select the same four plans.
8. `optional_ranges_lists_helpers_and_streaming_totals_keep_their_consumers`:
   an argument-only helper with a loop deriving the local range, optional list lanes, count/sum/exists seek
   branches; empty lane discovery still rejects a foreign presence cursor;
   interrupted count/sum return null, never partial numbers.
9. `search_helpers_evaluate_once_and_authored_merges_browse`: a point-reading
   needle helper is examined once; authored words merges browse even rows with
   no indexed words; wrapped pages preserve continuation; search/browse cursor
   changes refuse.

`device/tests/intent_variants.rs`: both memory and SQLite hosts, after reopen,
execute all four board combinations, check actual cursor indexes, reject
changed presence, run streaming counts, and paginate empty/whitespace/
punctuation/nonempty search with hidden rows excluded.

`scale_variants.rs`: classifies all four constant board alternatives and their
indexes, names streaming/search growth conditions and exact label probes,
uses authored local names, and refuses a whole-operation constant claim when
two of four variants have per-row authorization growth.

## Engineering choices and compatibility updates

- Lower presence choices to ordinary conditional IR, not a second scan
  interpreter. Up to three distinct optional inputs receive variants; repeated
  guards on the same input share the decision. Search is an additional bit.
- Recognition is conservative about input provenance and safe endpoints;
  unproved expressions stay in their original short-circuit filter. Optional
  ranges use the existing safe endpoint proof and branch narrowing.
- A 128-bit digest of the presence decisions is stored as four u32s: fixed-size
  copying, no heap payload, and lossless JSON through JavaScript. No descriptor,
  authority, meter or residency rule is relaxed.
- The device fixture uses complete capped partitions. Alternative indexes do
  not imply coverage beyond an acquired horizon.
- Raw serialized words-index IR retains its existing empty-lane behavior;
  Quarry, including authored words merges, lowers empty needles to browse.
- Existing nullable-lane and prefix-existence tests now count both search and
  browse branches. Residency-note tests check both branches' wide-merge advice.
  The membership-discovery fixture now checks exact probes and their resumable
  meter cut. The language certificate inventory adds the new constant board.
  None of these migrations removes a disclosure or uniqueness assertion.
- The retained-history fixtures declared two indexes covering the same new
  browse read. They now declare `unique byTime: room, at` (with the implicit id
  tiebreak), preserving uniqueness and existing byTime reads. The compiler
  still refuses ambiguous covering indexes; its selection rule was not weakened.
- Conditional reads remain expressions in ordinary IR blocks. Page provenance,
  returned-shape retries, retained-field ownership and merge diagnostics all
  traverse those blocks. A cut in conditional exists retries the current
  candidate; the existing 8,193-membership test proves it is not skipped.
- The device byte ratchet follows the explicit policy in snapback4/AGENTS.md:
  1,751,318 B raw / 487,805 B gzip, versus the preceding recorded lane artifact
  1,744,842 / 484,967 (+6,476 raw / +2,838 gzip). Raise 486,000 to 488,000 B,
  leaving 195 B. This is whole-artifact attribution. Engine ceilings unchanged.

## Validation and open issues

Final full suite: **`== 0 failure(s) in 196 s`**, exit 0.

Invocation from snapback4/:
`taskset -c 64-79 env SNAPBACK4_RUST_TEST_PROCESSES=8 scripts/test.sh`.
The full inventory ran; affinity and process limits reduce contention without
skipping tests. Final log: `/tmp/lane-a-r11-test-zero.log`.
The final argument-only-loop proof also passed the nine-test intent_variants
rerun (`/tmp/lane-a-r11-helper.log`). `git diff --check` passes; every changed
source file remains below 1,500 lines. `bun install --frozen-lockfile` passed.

Affected final checks: 68 CLI check tests, 2 certificate tests, 57 guide tests,
9 planner/server tests, 40 residency-note tests and 11 search-merge tests passed.
Both new device tests passed on memory and SQLite/reopen. The 99-test client
rerun passed all retained-history, release-activation, store-reset and worker
cases. Legacy positional serde, component ownership and shape/membership cut
regressions passed unchanged.

Initial affected runs exposed old plan/note-count assertions, a missing seek
choice for presence-wrapped exists, and the newly checked empty-discovery
cursor case. These were this round's work, corrected and rerun. A new test's
first build used the wrong Scan field name; corrected before execution.
The first device fixture used a horizon that could not cover all new indexes;
it was changed to a capped whole partition, preserving coverage checks.
An intermediate rerun also exposed five missing merge-note/cost explanations
after conditional reads became expression blocks; teaching the shared merge
walker to enter those blocks fixed all five without weakening their assertions.
The initial wasm build exceeded the inherited byte ratchet; the measured
increase is recorded above under the repository's authorized size policy.

Separate inherited reference-audit failure (outside scripts/test.sh):
`./ref-check --verbose` reports the unchanged store.rs:809 reference to
`LLP 3000.013#5.3-effects-keyed-once`. Reproduce with that command; the document
anchor is `#5.3`. `git show ea8cefd55:snapback4/crates/snapback4-core/src/store.rs`
contains the same reference. No new reference errors. This is already fixed
in newer upstream, not part of this lane's fixes.

The local llp-orient links are dangling and no readable alternate package was
found; orientation used the governing LLP and guide directly. No feature work
was stopped. No push, publication, version bump, changes to runtime meter
ceilings, streaming-union implementation or residency relaxation.

## Commits

- `c7579dd15` — Keep exact exists probes when discovery cannot prove authorization.
- Presence/search implementation, compatibility fixtures, this report and the journal: `Plan optional filters and empty search through presence variants`.

## First full-suite failure inventory (all rerun)

`== 2 failure(s) in 199 s` (cargo test, client tests).

The following Rust failures were introduced by this round: conditional-page
ownership/component proofs, interrupted-existence recognition, positional serde
compatibility, deliberate search semantics and fixtures tied to a single scan.

- `snapback4-device::components::component_frames_uniform_words_and_nonuniform_cuts_memory`
- `snapback4-device::components::component_frames_uniform_words_and_nonuniform_cuts_sqlite`
- `snapback4-device::components::retained_words::matching_horizon_free_retained_memory`
- `snapback4-device::components::retained_words::matching_horizon_free_retained_sqlite`
- `snapback4-device::components::retained_words::matching_positive_existence_retained_memory`
- `snapback4-device::components::retained_words::matching_positive_existence_retained_sqlite`
- `snapback4-core::lane_source::typed_errors_keep_text_positions_and_nested_sources_use_the_same_decoder`
- `snapback4-device::device::guide_examples::w10r1_directory_card_pages_and_searches_on_both_stores::guide_examples::w10r1_directory_card_pages_and_searches_on_both_stores`
- `snapback4-device::device::merge_continuation::memory::shape_pages::w13j_unfinishable_merge_shapes_refuse_in_both_directions::merge_continuation::memory::shape_pages::w13j_unfinishable_merge_shapes_refuse_in_both_directions`
- `snapback4-device::device::merge_continuation::sqlite::shape_pages::w13j_unfinishable_merge_shapes_refuse_in_both_directions::merge_continuation::sqlite::shape_pages::w13j_unfinishable_merge_shapes_refuse_in_both_directions`
- `snapback4-device::device::search_global::coverage::w9r2_matching_full_memory::search_global::coverage::w9r2_matching_full_memory`
- `snapback4-device::device::search_global::coverage::w9r2_matching_horizon_memory::search_global::coverage::w9r2_matching_horizon_memory`
- `snapback4-device::device::search_global::coverage::w9r2_matching_online_memory::search_global::coverage::w9r2_matching_online_memory`
- `snapback4-device::device::search_global::coverage::w9r2_matching_full_sqlite::search_global::coverage::w9r2_matching_full_sqlite`
- `snapback4-device::device::search_global::coverage::w9r2_matching_horizon_sqlite::search_global::coverage::w9r2_matching_horizon_sqlite`
- `snapback4-device::device::search_global::coverage::w9r2_matching_online_sqlite::search_global::coverage::w9r2_matching_online_sqlite`
- `snapback4-device::device::search_global::forms::memory::cases::uniform_word_grouped_matching_membership_is_last_rule_visible_on_cut_page::search_global::forms::memory::cases::uniform_word_grouped_matching_membership_is_last_rule_visible_on_cut_page`
- `snapback4-device::device::search_global::forms::sqlite::cases::uniform_word_grouped_matching_membership_is_last_rule_visible_on_cut_page::search_global::forms::sqlite::cases::uniform_word_grouped_matching_membership_is_last_rule_visible_on_cut_page`
- `snapback4-device::device::search_merge::r1a_empty_matching_horizon_is_unknown_held_and_retained_left::search_merge::r1a_empty_matching_horizon_is_unknown_held_and_retained_left`
- `snapback4-device::device::search_merge::r1a_left_read_cannot_mask_an_unknown_held_read_in_either_order::search_merge::r1a_left_read_cannot_mask_an_unknown_held_read_in_either_order`
- `snapback4-device::device::search_merge::r1a_repeated_site_still_rechecks_an_expired_audience_on_both_stores::search_merge::r1a_repeated_site_still_rechecks_an_expired_audience_on_both_stores`
- `snapback4-device::device::search_merge::round2::program_only_adoption_resets_retained_components_on_both_stores::search_merge::round2::program_only_adoption_resets_retained_components_on_both_stores`
- `snapback4-device::device::search_merge::round2::r2_n3_mixed_returned_history_exposes_independent_components::search_merge::round2::r2_n3_mixed_returned_history_exposes_independent_components`
- `snapback4-device::device::search_merge::round2::retained_point_hits_and_misses_on_both_stores::search_merge::round2::retained_point_hits_and_misses_on_both_stores`
- `snapback4-device::device::uniform_word_expansion::search_reduced_ceilings_on_both_stores::uniform_word_expansion::search_reduced_ceilings_on_both_stores`
- `snapback4-device::device::uniform_word_expansion::search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots::uniform_word_expansion::search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots`
- `snapback4-sim::clique::a_search_matches_word_prefixes_newest_first::a_search_matches_word_prefixes_newest_first`
- `snapback4-sim::clique::merge_continuation::shape_pages::w13j_unfinishable_merge_shapes_refuse_in_both_directions::merge_continuation::shape_pages::w13j_unfinishable_merge_shapes_refuse_in_both_directions`
- `snapback4-sim::clique::search_directory::w10c_directory_uses_the_cards_queries_and_separate_cursors::search_directory::w10c_directory_uses_the_cards_queries_and_separate_cursors`
- `snapback4-sim::clique::search_global::forms::uniform_word_grouped_matching_membership_is_last_rule_visible_on_cut_page::search_global::forms::uniform_word_grouped_matching_membership_is_last_rule_visible_on_cut_page`
- `snapback4-sim::clique::uniform_word_expansion::search_nested_cursor_ir_is_borrowed_without_per_lane_clones::uniform_word_expansion::search_nested_cursor_ir_is_borrowed_without_per_lane_clones`
- `snapback4-sim::clique::uniform_word_expansion::search_thousand_words_borrow_eight_4k_literals_and_continue_many_pages::uniform_word_expansion::search_thousand_words_borrow_eight_4k_literals_and_continue_many_pages`
- `snapback4-sim::residency::w9r2_matching_full_source`
- `snapback4-sim::residency::w9r2_matching_horizon_source`
- `snapback4-sim::residency::w9r2_matching_online_source`
- `snapback4-sim::search_merge::matching_lanes_authorize_order_deduplicate_and_continue`
- `snapback4::check::horizon_check_and_why_keep_the_same_advice_across_checks`

Client failures: the 48 retained-history cases below were ours (the fixture's
ambiguous duplicate index and the conditional returned-field proof), fixed and
rerun. Three failures were environmental/timing-sensitive under the concurrent
suite: stopped-release restore (`done` versus `parked`), equal-watermark store
replacement not yet observed, and worker shutdown seeing `AbortError`. All three
passed unchanged in the isolated 99-test client rerun (99 passed, 0 failed).
A subsequent run serialized client test files using the suite's supported
`SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1` setting. Final qualification limits
affinity to 16 CPUs and Rust test processes to eight, keeping the full inventory. None is classified as baseline.


- stopped full-release restore preserves its recovery point and stays separate from the original
- W14A horizon-free matching wasm: retained history and independent held coverage
- W14A positive existence wasm: retained history and independent held coverage
- R5 history wasm: retained history and independent held coverage
- R1a empty search wasm: retained history and independent held coverage
- R1a mixed reads wasm: retained history and independent held coverage
- R2 mixed result wasm: retained history and independent held coverage
- R2 sync during reply wasm: retained history and independent held coverage
- MQ ineligible wasm: retained history and independent held coverage
- MQ points wasm: retained history and independent held coverage
- MQ delete current wasm: retained history and independent held coverage
- MQ revoke current wasm: retained history and independent held coverage
- MQ rejoin wasm: retained history and independent held coverage
- MQ held change wasm: retained history and independent held coverage
- MQ close wasm: retained history and independent held coverage
- MQ sign-out wasm: retained history and independent held coverage
- MQ transport wasm: retained history and independent held coverage
- MQ adoption wasm: retained history and independent held coverage
- MQ reset wasm: retained history and independent held coverage
- MQ rotation wasm: retained history and independent held coverage
- MQ prediction wasm: retained history and independent held coverage
- MQ expiry left wasm: retained history and independent held coverage
- MQ expiry held wasm: retained history and independent held coverage
- MQ interrupted snapshot wasm: retained history and independent held coverage
- MQ retained snapshot wasm: retained history and independent held coverage
- W14A horizon-free matching process: retained history and independent held coverage
- W14A positive existence process: retained history and independent held coverage
- R5 history process: retained history and independent held coverage
- R1a empty search process: retained history and independent held coverage
- R1a mixed reads process: retained history and independent held coverage
- R2 mixed result process: retained history and independent held coverage
- R2 sync during reply process: retained history and independent held coverage
- MQ ineligible process: retained history and independent held coverage
- MQ points process: retained history and independent held coverage
- MQ delete current process: retained history and independent held coverage
- MQ revoke current process: retained history and independent held coverage
- MQ rejoin process: retained history and independent held coverage
- MQ held change process: retained history and independent held coverage
- MQ close process: retained history and independent held coverage
- MQ sign-out process: retained history and independent held coverage
- MQ transport process: retained history and independent held coverage
- MQ adoption process: retained history and independent held coverage
- MQ reset process: retained history and independent held coverage
- MQ rotation process: retained history and independent held coverage
- MQ prediction process: retained history and independent held coverage
- MQ expiry left process: retained history and independent held coverage
- MQ expiry held process: retained history and independent held coverage
- MQ interrupted snapshot process: retained history and independent held coverage
- MQ retained snapshot process: retained history and independent held coverage
- sync store identity survives a server restart; a live client detects an equal-watermark replacement
- W7r1 runWorker and doctor observe deferred presence effects


## Subsequent full-suite failures

- The serial-client run: `== 1 failure(s) in 740 s` (client tests). The process-tier test
  `W5c process: pending writes recover by id through sent and failed, including settlement before reopen returns`
  observed `sent` where line 375 expected `pending`. It passed unchanged in an isolated invocation of
  `node --test --test-name-pattern='W5c process: pending writes recover' packages/snapback4/test/acquisition.test.mjs`.
  Classification: environmental/timing-sensitive; the fixture has no matching
  or optional filters, and its source and client implementation are unchanged.
- The first 16-CPU/eight-Rust-process qualification reported
  `== 1 failure(s) in 193 s` (client tests). Two failures were ours:
  `wasm index budget exhaustion is false/meter/no-next` and
  `wasm expired sub-pair (ii), meter boundary retains the existing time-hidden work bit`.
  Their manual IR preludes assumed a top-level Return.Scan; after fixture
  regeneration, that read is inside a conditional block. Both now find exactly
  one words scan. No ceiling, expected cut, envelope or disclosure assertion
  changed. All 17 word-expansion tests passed on the direct rerun.
