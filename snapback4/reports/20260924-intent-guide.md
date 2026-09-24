# Lane F: the guide teaches intent

Date: 2026-09-24. Base: `2bbae4740`. Branch: `sb4-intent/f-guide`.
Scope: LLP 3000.013 §8 / L6. No push or publication.

## Result and boundaries

The core language program, keyword examples, templates and README now teach
predicate/column reads, unnamed uniqueness, `search`, durations, planned and
aggregate views, automatic job sweeps, streaming scalars and permanent emission
keys. The README preserves lane E's app/account entry and is 268/300 lines.
The budget is unchanged. `guide view` and `guide views` reach the views card.

The feeds card's Following section and the README's Following reference remain
with lane C, as instructed. The language card keeps its existing timeline in the
final compatibility block until the new Following binder exists. Global and
Trending are new standalone examples. No engine decisions, authorization,
disclosure, durability, work ceilings or compiler admission were changed.
Compiler/core edits only construct diagnostic rewrite text.

This is not a claim that every requested new surface is available. The explicit
index needed for a role-sensitive after-insert postcondition remains. Two
historical guide-block note exceptions remain. Reproductions follow below.

## Forms exercised

| Form | Example in a compiled card |
|---|---|
| Predicate, order and cursor | `intentPosts where .author = owner and not .removed last 20 by .at after c` |
| Unnamed uniqueness | `unique handle else HANDLE_TAKEN 'That handle is taken.'` |
| Search declaration/read | `search body`; `intentPosts matching q last 20 by .at after c` |
| Durations | `return [500ms, 30s, 15m, 24h, 7d, bucket(now, 2m)]` |
| Planned union | `view intentActivity:` with post and repost projections |
| Maintained view | `view intentCounts: count intentPosts by .author`; `intentCounts[owner]` |
| Maintained column | `voteCount: count votes` |
| Automatic job | `for p in recipients:` inside `job intentDaily(...)` |
| Streaming scalars | `count(events where .recipient = p.principal and .at >= periodStart and .at < periodEnd)`; corresponding `sum(..., .amount)` |
| Permanent emission key | `emit intentDigest { recipient: p.principal, n, amount } once [p.principal, periodEnd]` |
| Calendar uniqueness | `unique principal, day(at) else ALREADY_CHECKED_IN 'One check-in per day.'` |
| Legacy compatibility | One final block demonstrates named indexes, `merge`, `chunk`, `maintain` and the current timeline declaration. |

The new `view following: activity where .actor = viewer or exists
follows[viewer, .actor]` is not claimed to run on this base. It is lane C's
pending binder.

## Tests and measurements

- `guide::intent::language_intent_views_predicates_search_and_durations_run`
  executes the published core: ordered/filtering union branches keep both equal
  source ids; removed posts are excluded from Global; predicate/search results
  agree; maintained views and columns update; durations evaluate in milliseconds. The core job counts two events and sums
  their amounts to 16 within `[0, 20)`, excluding the event at the upper bound.
  The exposed union `id` remains the source id, so the views card tells the client
  to include its branch discriminator in a list key.
- `guide::intent::published_digest_streams_past_the_old_limit_and_once_survives_reopen`
  uses the exact jobs-card schema. Of 130 messages, 125 survive read ordinal,
  own-message, tombstone, expiry and half-open-period filters. UI and job agree.
  A non-member profile receives no effect. Store reopen plus a fresh run of the
  same period yields no duplicate effect and zero new writes. Peak heap: 20,255
  bytes. First run: one effect write.
- The existing language execution and module tests now run the converted core.
  Timeline execution tests run its final compatibility block. All card/README
  compile checks remain. At the first clean targeted checkpoint: 57 guide tests
  passed; two search-guidance tests passed.
- `search_guidance` now compiles the diagnostic's proposed membership-predicate
  repair, requiring no errors or notes.
- The existing Trending oracle runs the new feeds-card predicate over 85 posts,
  exact lower/upper endpoints, equal scores/timestamps, zero likes, removals and
  changing likes. First page: 35 examined, 697 steps, 37,260 heap bytes; complete.
- Search forms tests continue to execute the published card on the server and
  both device stores. The 1,000-membership first page is complete with 20 rows,
  3,040 examined and continuation. Sampled widths 2,717, 2,718, 2,730, 2,731 and
  3,000 heap-cut with null data and no continuation on the current predicate plan.
  The card replaces its old memory-only threshold claim with these measurements.
  Legacy explicit-lane drain/cursor tests retain their original controls.
- Updated wording expectations and the read-authorization source census to match
  the new compiled documents. The census sees 267 mutation occurrences and 49
  distinct private write sites. Its lifecycle assertions remain unchanged.
- The final affected batch passed 199 tests across eight targets, with zero
  failures. The qualified WASM build is 1,743,957 bytes raw / 484,641 bytes gzip,
  within the unchanged 485,000-byte budget. Docs budget is unchanged.
- Historical feed and capped digest recipes remain fixtures for existing
  algorithm, overflow, marker, rollback and compatibility tests; they are not
  published teaching examples. The new digest is tested separately above.

## Decisions and deviations

1. Preserve the exact role-sensitive after-insert postcondition and its one
   explicit index in the language and app cards. Removing the role check would
   weaken the invariant; declaring redundant uniqueness would hide the missing
   planner support. This portion is stopped for the supervisor.
2. Keep the Following section untouched and its materialized example in the
   compatibility block pending lane C. Therefore the feeds card is not yet one
   page, and the final compatibility block is longer than requested.
3. Preserve the two existing exact note exceptions: feeds block 2 emits
   `N_MAINTAINED_COLUMN_STREAM`; search block 2 emits `N_NO_HORIZON` for intentional
   full-history acquisition. All other blocks must be silent. Removing these
   notes would hide cost, while adding a horizon would change the held-search
   contract. The strict zero-note target is not claimed.
4. Use `by .at` for the finite-window streaming count in reads. Its default id
   order currently lowers to a bucket merge the scalar binder does not admit.
5. Preserve compatibility tests in dedicated fixtures instead of retaining old
   algorithms in the teaching cards. Tests of the new cards keep executing the
   current text. Source-based wording tests were updated, not removed.
6. Keep actual product limits, UI page sizes, acquisition horizons and documented
   meter ceilings. Remove author-chosen physical indexes, lane lists and chunk
   sizes from current examples. Legacy-specific diagnostics retain legacy forms.
7. Move this lane's ignored target and test temporaries to
   `/var/cache/expose-build/sb4-intent-lane-f.mFT6qN/` because the shared root disk
   approached capacity. Builds use eight Cargo jobs, no debug info/incremental
   cache, and eight Rust test processes. No other lane's files were removed.

## Open compiler reproductions

Run `snapback4 check` with this `snapback/schema.q`:

```text
table rooms:
  owner: principal
  after insert <- exists members[room = .id, principal = .owner, role = 'admin']
table members:
  room: rooms
  principal: principal
  role: enum('admin', 'member')
  unique room, principal
```

It refuses `schema.q:3:3` with `E_QUARRY_UNKNOWN`, "members has no index with
3 columns matching this key". Adding `by byRoomPrincipalRole: room, principal,
role` works. A member row with role `member` is the counterexample to dropping
the role clause: it would satisfy a weaker postcondition when no admin exists.

This independent scalar example also refuses:

```text
table messages:
  room: id
  at: time
  public
  online only
query total(room: id):
  return count(messages where .room = room and .at >= now - 1d and .at <= now)
```

At `schema.q:7:16`, `E_QUARRY_BOUND` asks for a cap over `room, hour` or a page.
A cap changes the product and a page is not a total. Appending `by .at` inside
`count(...)` compiles with zero notes and is the published workaround.

For the pending Following form, add the target-clique `view following` line and
`home` query to the integration's planned-activity schema: this base emits
`E_VIEW_FEED_PENDING`. The minimal binder reproduction is a schema containing
`view following: activity where .actor = viewer`; the existing
`cargo test -p snapback4-lang --test intent_target aggregate_and_feed_view_syntax_has_the_shared_ast`
asserts that exact refusal. Reading Global instead cannot establish a follower
audience.
For the two note exceptions, compile the second Quarry block of `guide feeds`
or `guide search` directly. The guide test pins their exact code/site behavior.

## Full-suite result

Final result: **`== 0 failure(s) in 351 s`**, exit 0. All stages pass.
There are no final failures to classify. Client shards total 1,075 passed,
zero failed and ten skipped. The guide target passes 57 tests; readauth passes
81; page admission passes 15; CLI check passes 68. The reference audit passes:
504 LLP documents, 9,226 references, zero errors, zero unchecked. All changed
source files remain within 1,500 lines. Final log:
`~/sb4-intent/lane-f-suite-complete.log`.

The first complete run was `== 2 failure(s) in 424 s`:
`cargo test` and `client tests`. Those failures were caused by this lane's changed
examples, wording, sample plan cost and generated inventory, not the four known
baseline failures. Every failed first-run target is recorded in the appendix.

The second complete run was `== 1 failure(s) in 207 s`: `cargo test`.
It failed to build after this lane removed a test constant but left its import
in `search_global/forms.rs` (`E0432`, `super::DECODED_STORE`). The stale import
is now removed. Client tests passed across all shards: 1,075 passed, zero failed, ten skipped.
This build failure is also lane F, not baseline or environmental.

The standalone Rust rerun then found two lane-F expectation failures:
`papercuts::w9c_writes_nested_in_derived_loops_still_refuse` and
`prefix_reads::explicit_caps_stay_silent_and_predicting_short_pages_stay_refused`.
Both still refused correctly; their expected whole-group rewrite retained the
old index or redundant order. They now expect the concrete predicate rewrite.
The last diagnostic audit also required updating
`maintains::retired_w15c_value_index_refusals_point_at_the_column` from an authored
ranking index to `posts last 20 by .likeCount, .at after c`.
All eight affected test targets passed after these fixes. No compiler decision
or test admission expectation changed.

The third complete run was `== 1 failure(s) in 369 s`: `cargo test`, with two
lane-F expectation failures:
- `snapback4-sim::page_admission::w4_live_maintain_probe_equalities_ignore_expired_contributions`
  expected "read the maintain" instead of "read the view".
- `snapback4::check::b2_l12_final_ranked_writes_and_entry_counts_remain_visible_in_json_and_text`
  expected "remove online only from maintain entryCounts" instead of the view
  wording. This second failure arrived later in the parallel log and was missed
  before the fourth run, where it recurred alone.

Both assertions are corrected; their admission, expiry and residency assertions
are unchanged. All other Rust targets and all client tests passed.
Raw log: `~/sb4-intent/lane-f-suite-qualified.log`.

The fourth complete run was `== 1 failure(s) in 358 s`: `cargo test`, only
the CLI residency-wording assertion above. It is lane F, now corrected.
Raw log: `~/sb4-intent/lane-f-suite-pass.log`.

## File-by-file changes

All paths below are relative to `snapback4/`.

| File | Change |
|---|---|
| `JOURNAL.md` | Append one dated lane entry with measurements, validation and omissions. |
| `crates/snapback4-core/src/engine/admission.rs` | Rewrite text only: predicate whole-group loops and automatic job sweeps. |
| `crates/snapback4-core/src/error.rs` | Rewrite text only: job sweep terminology. |
| `crates/snapback4-device/tests/readauth/census.txt` | Refresh the reviewed compiled authoring census; lifecycle assertions unchanged. |
| `crates/snapback4-device/tests/search_global/forms.rs` | Current horizon detection on both device stores. |
| `crates/snapback4-device/tests/search_global/mod.rs` | Exercise current horizon spelling on actual held-search acquisition. |
| `crates/snapback4-device/tests/trending/mod.rs` | Preserve existing algorithm/upsert controls on the historical feed fixture. |
| `crates/snapback4-device/tests/trending/rolling.rs` | Preserve existing algorithm/upsert controls on the historical feed fixture. |
| `crates/snapback4-device/tests/upsert/mod.rs` | Preserve existing algorithm/upsert controls on the historical feed fixture. |
| `crates/snapback4-lang/src/bind/catalog.rs` | Rewrite text only: name the aggregate view in collision repairs. |
| `crates/snapback4-lang/src/bind/columns.rs` | Rewrite text only: recommend a separate view for maintained-column refusals and stream cost. |
| `crates/snapback4-lang/src/bind/mod.rs` | Rewrite text only: schedules, horizons, cursors, scope/search repairs and concrete whole-group predicates. |
| `crates/snapback4-lang/src/bind/program.rs` | Rewrite text only: aggregate pages/ranking and stable job id order. |
| `crates/snapback4-lang/src/bind/program/control.rs` | Rewrite text only: place effects inside the automatic job sweep. |
| `crates/snapback4-lang/src/bind/residency.rs` | Rewrite text only: view terminology in residency and disclosure repairs. |
| `crates/snapback4-lang/src/bind/schema.rs` | Rewrite text only: view/count repairs preserve group-key expressions; current ranking and live-expiry guidance. |
| `crates/snapback4-lang/src/guide.rs` | View aliases and current inline residency/expiry/assets examples. |
| `crates/snapback4-lang/src/guide/app.rs` | Convert the complete chat example; preserve its role-sensitive after-insert index. |
| `crates/snapback4-lang/src/guide/bounds.rs` | Separate product limits from chosen plans; streaming scalars, adaptive sweeps and scale certificates. |
| `crates/snapback4-lang/src/guide/codes.rs` | Restate why entries in current forms; retain compatibility-only explanations. |
| `crates/snapback4-lang/src/guide/effects.rs` | Use current schema/read forms and keyed emits; remove the marker-table recipe recommendation. |
| `crates/snapback4-lang/src/guide/feeds.md` | Replace the sections after Following with planned Global and predicate Trending; link aggregate-copy guidance. |
| `crates/snapback4-lang/src/guide/indexes.rs` | Teach chosen indexes, inspection, optional tuning, unnamed uniqueness and calendar uniqueness. |
| `crates/snapback4-lang/src/guide/jobs.rs` | Automatic for sweeps; live streaming digest with permanent emission keys; retain recipient authority and parking semantics. |
| `crates/snapback4-lang/src/guide/language.rs` | One running intent core, server extension and final compatibility block; preserve existing true language features. |
| `crates/snapback4-lang/src/guide/maintains.md` | Views card: planned union, derived aggregate audiences, recorded attribution, maintained columns and aggregate-copy rules. |
| `crates/snapback4-lang/src/guide/native.rs` | Use view/sweep terms while retaining the native SDK contract. |
| `crates/snapback4-lang/src/guide/prediction.rs` | Convert example schema, reads and aggregate views without changing prediction/retention rules. |
| `crates/snapback4-lang/src/guide/programs.rs` | Current read/sweep forms and createApp onboarding; preserve mutation admission. |
| `crates/snapback4-lang/src/guide/reads.rs` | Predicate and column-order reads, streaming totals, continuation, authorization and expiry; remove hand-written lane tutorial. |
| `crates/snapback4-lang/src/guide/refusals.rs` | Use current read example in refusal guidance. |
| `crates/snapback4-lang/src/guide/rules.md` | Unnamed uniqueness and aggregate views; preserve every rule/disclosure constraint. |
| `crates/snapback4-lang/src/guide/search.rs` | search declarations and predicate reads for directory, scoped and grouped search. |
| `crates/snapback4-lang/src/guide/search_all.md` | Membership-predicate newest search; current measured envelope and full-history caveat. |
| `crates/snapback4-lang/src/guide/services.rs` | Unnamed uniqueness in the service example. |
| `crates/snapback4-lang/src/guide/shapes.rs` | Column-order shapes and nested predicate/existence scope. |
| `crates/snapback4-lang/src/guide/sync.rs` | Column horizons, generated audience indexes and view terminology. |
| `crates/snapback4-lang/src/guide/templates.rs` | Both todo starters use generated indexes and column-order reads. |
| `crates/snapback4-lang/src/guide/types.rs` | Durations, unnamed uniqueness, chosen indexes and current aggregate vocabulary. |
| `crates/snapback4-lang/src/guide/writes.rs` | Unnamed unique declarations and aggregate-view vocabulary; preserve write/refusal semantics. |
| `crates/snapback4-lang/src/parser.rs` | Rewrite text only: sync horizons by .at. |
| `crates/snapback4-lang/src/parser/programs.rs` | Rewrite text only: automatic for sweep repair. |
| `crates/snapback4-lang/tests/aggregate_copies.rs` | Follow the moved aggregate-copy section and its current maintained-column spelling. |
| `crates/snapback4-lang/tests/attribution_guide.rs` | Select the published recorded-attribution view by its new declaration. |
| `crates/snapback4-lang/tests/builder_guidance.rs` | Compile current predicate repairs while preserving original scope equalities. |
| `crates/snapback4-lang/tests/fixtures/legacy-digest.q` | Exact pre-rewrite digest for cap/marker/crash compatibility tests; not published. |
| `crates/snapback4-lang/tests/fixtures/legacy-feed-recipes.md` | Exact pre-rewrite feeds card for historical algorithm tests; not published. |
| `crates/snapback4-lang/tests/frontend_regressions.rs` | Expect current scope-repair text; same read-rule assertions. |
| `crates/snapback4-lang/tests/guide.rs` | Execute the new core and compatibility block; compile all examples; preserve exact note exceptions. |
| `crates/snapback4-lang/tests/guide/feeds_followups.rs` | Run the ranking oracle against the new Trending predicate and inspect its generated index. |
| `crates/snapback4-lang/tests/guide/intent.rs` | New published-program execution witnesses for views/search/durations/scalars and durable digest deduplication. |
| `crates/snapback4-lang/tests/maintains.rs` | Current aggregate terminology plus preserved historical ranking fixture. |
| `crates/snapback4-lang/tests/papercuts.rs` | Expect the whole-domain rewrite without its old explicit index; nested-write refusals remain. |
| `crates/snapback4-lang/tests/prefix_reads.rs` | Expect the predicate whole-group repair; cap and prediction admission assertions remain. |
| `crates/snapback4-lang/tests/repairs.rs` | Keep historical bounded-ranking repair controls in a fixture. |
| `crates/snapback4-lang/tests/residency_notes.rs` | Update rewrite snapshots; retain compile/runtime proofs of remedies and prediction. |
| `crates/snapback4-lang/tests/search_guidance.rs` | Expect and compile the membership-predicate search repair. |
| `crates/snapback4-lang/tests/timeline_guide.rs` | Run mapped-table/timeline controls against the language compatibility block. |
| `crates/snapback4-sim/tests/digest/mod.rs` | Point old digest semantics tests at their historical fixture. |
| `crates/snapback4-sim/tests/page_admission.rs` | Expect view terminology for the live aggregate probe refusal; expiry and meter assertions unchanged. |
| `crates/snapback4-sim/tests/search_global/cursors.rs` | Use explicit-index compatibility control for crafted cursors. |
| `crates/snapback4-sim/tests/search_global/fixture.rs` | Keep published source unchanged; add explicit indexes only for legacy cursor/lane controls. |
| `crates/snapback4-sim/tests/search_global/forms.rs` | Current column horizon and measured heap-cut envelope for the actual published predicate. |
| `crates/snapback4-sim/tests/search_global/lazy.rs` | Use explicit-index compatibility control for exact lane/drain boundaries. |
| `crates/snapback4-sim/tests/search_global/mod.rs` | Recognize the current horizon spelling in the server coverage control. |
| `crates/snapback4-sim/tests/search_merge.rs` | Update the diagnostic rewrite expectation; legacy execution remains covered. |
| `crates/snapback4-sim/tests/trending/lanes_fixture.rs` | Preserve existing algorithm/upsert controls on the historical feed fixture. |
| `crates/snapback4-sim/tests/trending/mod.rs` | Preserve existing algorithm/upsert controls on the historical feed fixture. |
| `crates/snapback4/src/verbs/init.rs` | Retired-installer rewrite drops obsolete timeline author/size lines. |
| `crates/snapback4/tests/check.rs` | Inspect current Trending plan with engine-bounded lanes and current residency advice; same derived-write ceilings. |
| `crates/snapback4/tests/init.rs` | Expect retired-installer rewrite without obsolete sizing. |
| `crates/snapback4/tests/scale.rs` | Pin classes for the new language program and its intent operations. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | Unnamed unique examples; remove obsolete Following size instruction. |
| `packages/snapback4/README.md` | Preserve first account screen; add whole-model schema and hooks; remain at 268/300 lines. |
| `packages/snapback4/SERVER.md` | Convert schema indexes/unique declarations in compiled server examples. |
| `packages/snapback4/test/first-account.test.mjs` | Distinguish runnable entry-file blocks from the optional hooks reference; keep both full account-flow witnesses. |
| `packages/snapback4/test/init-recipe.test.mjs` | Pin the updated retired-installer diagnostic. |
| `packages/snapback4/test/readme-examples.test.mjs` | Require predicate reads and engine-chosen lanes in the read card. |
| `reports/20260924-intent-guide.md` | This reviewable report, reproductions and failure inventory. |

## Commits

- `87683e19c`: preserve historical feed controls.
- `78958a1fb`: preserve historical digest and ranking controls.
- `d17d4e79d`: current diagnostic repairs and their expectations.
- `91187d234`: compiled guide programs and runtime witnesses.
- `195c06f51`: whole-model README and current package examples.
- `40ac7b435`: align the live aggregate probe snapshot.
- `2a3cbaf93`: align the CLI residency advice snapshot.
- The final report/journal commit contains this report and the final result.

## First-run failure inventory

All entries below are **lane F**, caused by changed examples or rewrite/measurement expectations. No first-run failure is attributed to the baseline or environment. Full raw log: `~/sb4-intent/lane-f-suite.log`.

- `snapback4-device::device::search_global::forms::memory::cases::w13e_both_forms_report_unknown_history_at_a_device_horizon`.
- `snapback4-device::device::search_global::forms::sqlite::cases::w13e_both_forms_report_unknown_history_at_a_device_horizon`.
- `snapback4-device::device::search_global::lazy::memory::cases::w13f_clique_every_row_hits_in_1000_lanes`.
- `snapback4-device::device::search_global::lazy::memory::cases::w13f_dense_100`.
- `snapback4-device::device::search_global::lazy::memory::cases::w13f_dense_1000`.
- `snapback4-device::device::search_global::lazy::memory::cases::w13f_dense_500`.
- `snapback4-device::device::search_global::lazy::memory::cases::w13f_flattened_drain_cut_continues_after_32_emissions`.
- `snapback4-device::device::search_global::lazy::memory::cases::w13f_flattened_opening_cut_stays_terminal`.
- `snapback4-device::device::search_global::lazy::memory::cases::w13f_further_terms_and_duplicate_words_preserve_one_ordered_walk`.
- `snapback4-device::device::search_global::lazy::memory::cases::w13f_hidden_worlds_have_identical_pages_and_dev_meters`.
- `snapback4-device::device::search_global::lazy::memory::cases::w14a_uniform_words_past_32_keep_later_scopes_and_nonuniform_stays_capped`.
- `snapback4-device::device::search_global::lazy::sqlite::cases::w13f_clique_every_row_hits_in_1000_lanes`.
- `snapback4-device::device::search_global::lazy::sqlite::cases::w13f_dense_100`.
- `snapback4-device::device::search_global::lazy::sqlite::cases::w13f_dense_1000`.
- `snapback4-device::device::search_global::lazy::sqlite::cases::w13f_dense_500`.
- `snapback4-device::device::search_global::lazy::sqlite::cases::w13f_flattened_drain_cut_continues_after_32_emissions`.
- `snapback4-device::device::search_global::lazy::sqlite::cases::w13f_flattened_opening_cut_stays_terminal`.
- `snapback4-device::device::search_global::lazy::sqlite::cases::w13f_further_terms_and_duplicate_words_preserve_one_ordered_walk`.
- `snapback4-device::device::search_global::lazy::sqlite::cases::w13f_hidden_worlds_have_identical_pages_and_dev_meters`.
- `snapback4-device::device::search_global::lazy::sqlite::cases::w14a_uniform_words_past_32_keep_later_scopes_and_nonuniform_stays_capped`.
- `snapback4-device::device::search_global::w7d_every_chat_word_search_measures_full_and_horizon_holdings_on_both_stores`.
- `snapback4-device::device::search_global::w7r1b_search_cursor_memory`.
- `snapback4-device::device::search_global::w7r1b_search_cursor_sqlite`.
- `snapback4-device::device::search_global::forms::memory::cases::w13e_newest_measures_complete_page_and_opening_envelope`.
- `snapback4-device::readauth`: `census::authoring_census`.
- `snapback4-lang::aggregate_copies`: `aggregate_copy_card_section_is_verbatim_and_discoverable`, `aggregate_copy_claim_is_reached_from_the_orientation`.
- `snapback4-lang::attribution_guide`: `nested_credit_follows_immediate_targets_and_surviving_contributions`, `explicit_reference_backfill_precedes_capture_and_doctor_distinguishes_missing_credit`.
- `snapback4-lang::builder_guidance`: `scope_guidance_uses_existing_index_and_preserves_the_message_equality`.
- `snapback4-lang::frontend_regressions`: `self_witness_notes_name_only_the_unpinned_deciding_columns`.
- `snapback4-lang::maintains`: `cards_pin_retirement_and_newest_first_column_recipe`.
- `snapback4-lang::repairs`: `trending_card_finds_winners_after_200_and_1000_candidates_without_hiding_its_ceiling`, `trending_card_ranks_the_day_and_reports_a_cut_set`.
- `snapback4-lang::residency_notes`: `horizon_calibration_advice_preserves_prediction_and_groups_sites`, `w16h_horizon_advice_does_not_depend_on_index_name_order`, `w6r1_ordinary_mutation_page_keeps_growing_table_advice`, `w6r2_descending_page_keeps_horizon_rewrite`.
- `snapback4-lang::timeline_guide`: `language_timeline_registers_delivers_and_removes_without_helpers`, `maintained_columns_compose_with_mapped_timeline_tables`, `maintained_columns_on_mapped_tables_leave_timeline_state_identical`, `maintained_columns_refuse_timeline_owned_sources_in_the_binder`.
- `snapback4-sim::clique::digest::chat_overflow_refuses_before_admitting_a_partial_total`.
- `snapback4-sim::clique::digest::each_recipient_rechecks_live_state_after_earlier_chunks`.
- `snapback4-sim::clique::digest::hub_seeks_the_period_in_one_chunk_and_ordinal_history_parks_on_examined`.
- `snapback4-sim::clique::digest::markers_are_private_unsynced_and_cannot_be_forged`.
- `snapback4-sim::clique::digest::parked_digest_replacement_skips_completed_profiles`.
- `snapback4-sim::clique::digest::period_digest_and_viewer_inbox_agree_before_the_expiry_sweep`.
- `snapback4-sim::clique::digest::refusal_before_or_after_emit_or_marker_rolls_back_the_whole_recipient`.
- `snapback4-sim::clique::digest::schedule_cursor_and_markers_survive_restart_and_manual_rerun`.
- `snapback4-sim::clique::digest::two_queued_runs_share_markers_and_an_empty_period_stays_silent`.
- `snapback4-sim::clique::digest::membership_bound_is_enforced_before_a_digest_can_skip_a_chat`.
- `snapback4-sim::clique::digest::single_profile_stops_at_the_exact_examined_envelope`.
- `snapback4-sim::clique::search_global::forms::w13e_both_forms_report_unknown_history_at_a_device_horizon`.
- `snapback4-sim::clique::search_global::lazy::w13f_dense_100`.
- `snapback4-sim::clique::search_global::lazy::w13f_clique_every_row_hits_in_1000_lanes`.
- `snapback4-sim::clique::search_global::lazy::w13f_dense_1000`.
- `snapback4-sim::clique::search_global::lazy::w13f_flattened_drain_cut_continues_after_32_emissions`.
- `snapback4-sim::clique::search_global::lazy::w13f_dense_500`.
- `snapback4-sim::clique::search_global::lazy::w13f_further_terms_and_duplicate_words_preserve_one_ordered_walk`.
- `snapback4-sim::clique::search_global::lazy::w13f_hidden_worlds_have_identical_pages_and_dev_meters`.
- `snapback4-sim::clique::search_global::lazy::w14a_uniform_words_past_32_keep_later_scopes_and_nonuniform_stays_capped`.
- `snapback4-sim::clique::search_global::w7r1b_server_search_cursor_positions_and_descriptors`.
- `snapback4-sim::clique::search_global::lazy::w13f_flattened_opening_cut_stays_terminal`.
- `snapback4-sim::search_merge`: `matching_merge_refusals_name_the_admitted_rewrite_and_51_lanes_get_a_note`.
- `snapback4::check`: `column_trending_cost_has_one_merge_and_derived_bounds`.
- `snapback4::scale`: `language_operation_classes`.
- Client: README first account, online and local (entry-block selector included the new hooks fragment).
- Client: Retired Following installer and orphan options (old diagnostic snapshot).
- Client: R1a Queries lists matching merges over scope lanes (old teaching assertion).
