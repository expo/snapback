# Lane P1 — sync windows and N_SYNC_ORDER

Branch: `sb4-intent/p1-sync-windows`, base `0badac987`. Implementation commit `d0d8998ec`; compatibility expectations in `403e875b1` and `89a9740f4`; capped-domain advisory refinement in `7b890252d`. No push or publication.
Design: supervisor-supplied LLP 3000.019 §3.1, which is not yet in this checkout.

Implemented the column-list spelling and ordinary-page ordering note without
changing the core schema representation, wire format, runtime, authorization,
acquisition protocol or meters.

## Changes by file

Paths below are relative to `snapback4/`.

- `crates/snapback4-lang/src/ast.rs`: represent window order as a named index or ordered column list.
- `crates/snapback4-lang/src/parser.rs`: accept dotted lists for every audience spelling; refuse repeated columns and malformed lists at their source; adapt the existing named-index parser assertion.
- `crates/snapback4-lang/src/bind/intent.rs`: generate audience prefix, authored order and one explicit id component; refuse audience repetition; resolve generated index names through the existing planner.
- `crates/snapback4-lang/src/bind/schema.rs`: consume the resolved index while retaining existing horizon validation.
- `crates/snapback4-lang/src/bind/residency/horizons.rs`: emit N_SYNC_ORDER for device-capable ordinary plain-index pages whose index identity or direction differs from the window; source locations include helpers. Held queries get an incomplete-local explanation. Extra equality pins and order keys following intrinsic id get an explicit-index rewrite.
- `crates/snapback4-lang/src/bind/residency.rs`: export the note pass.
- `crates/snapback4-lang/src/bind/mod.rs`: collect it on every compilation.
- `crates/snapback4-lang/src/bind/program.rs`: clarify that existing aggregate-domain metadata supports diagnostics beyond admission; no metadata or IR change.
- `crates/snapback4-lang/src/diag.rs`: route N_SYNC_ORDER to the sync card.
- `crates/snapback4-lang/src/guide/codes.rs`: register the note and its why explanation, including scope limits.
- `crates/snapback4-lang/src/guide/sync.rs`: compile a two-column window and matching page; document offline boundary coverage, duplicate refusals and note scope.
- `crates/snapback4-lang/src/guide/language.rs`: use the new spelling in the introductory backend.
- `crates/snapback4-lang/src/guide/writes.rs`: distinguish existing-column timestamp order from sequence-by server-arrival order; preserve the older application-counter recipe.
- `crates/snapback4-lang/src/guide/from_sql.md`: make its select/join/aggregate example explicitly online. It deliberately demonstrates several incompatible page orders; retaining a window would now emit the new note. The account example still demonstrates sync.
- `crates/snapback4-lang/tests/fixtures/sync-windows.q`: conversation membership, a 10,000-row two-column window and matching thread query, shared with CLI and device tests.
- `crates/snapback4-lang/tests/sync_windows.rs`: parser, binder, advice and rewrite regression tests.
- `crates/snapback4-device/tests/sync_windows.rs`: both persistent device-store witnesses using actual server acquisition pages and streams.
- `crates/snapback4/tests/check_notes.rs`: text, JSON, repeated-check, why and corrected-window CLI witness.
- `crates/snapback4-lang/tests/guide/definitions.rs`: pin the note's definition in the rendered card.
- `crates/snapback4-lang/tests/guide/refusal_actions.rs`: pin its rewrite and held-query boundary.
- `crates/snapback4-lang/tests/fixtures/guide-fact-homes.json`: replace the deliberately obsolete recommendation to maintain an application ordinal with the existing-column recipe.
- `crates/snapback4-device/tests/readauth/census.txt`: update the two from-SQL mutation classifications to never-predicting after the documented online-example change.
- `crates/snapback4-lang/tests/shape_overrides.rs`: expect exactly two ascending-page notes while retaining type-inference assertions.
- `crates/snapback4-sim/tests/digest/mod.rs`: expect exactly the legacy inbox/ordinalInbox page-order notes while retaining all digest runtime assertions.
- `crates/snapback4/tests/timeline_adoption.rs`: allow the specific home/cards source-page notes exposed by retirement, preserving all adoption runtime assertions.
- `JOURNAL.md`: append the dated implementation and measurement entry.
- This report: retained implementation, qualification and stopped-scope details.

## Forms

The fixture supplies all referenced tables and columns:

```quarry
sync last 10000 by .at, .ordinal
```

It generates `[conversationId, at, ordinal, id]`. Its query is:

```quarry
query thread(conversationId: conversations, c: cursor ?):
  return messages where .conversationId = conversationId last 2 by .at, .ordinal after c
```

Within the acquired suffix this answers offline. Explicit `sync to members[.conversationId] last 10000 by .at, .ordinal` works too. `sync last 500 by .at, .id` creates one explicit id component. Old single-column and named-index forms retain their existing order: `sync last 500 by .at` and `sync last 500 by byThread` over `by byThread: conversationId, at, ordinal, id`.

Changing only the fixture's window to `.at` emits one N_SYNC_ORDER at the
query's file:line:column. Changing the window back, or changing the page to
`last 2 by .at, .id`, removes it. Changing the page to `first 2` emits the
ascending-order note. All remain compilable operations.

`sync last 50 by .at, .at` refuses E_QUARRY_SYNTAX with
`last 50 by .at`; repeating `.conversationId` in the window order refuses
with the audience column omitted from the rewrite.

## Tests and what they prove

The new language target has 15 tests:

1. `parser_keeps_column_order_for_every_audience_spelling`: inferred, public, column and target audiences retain the ordered list.
2. `parser_refuses_duplicate_and_malformed_column_lists_with_rewrites`: duplicate columns, missing dots, trailing commas and index/list mixtures refuse with locations and rewrites.
3. `generated_window_and_query_share_the_full_order_and_one_id`: exact 10,000-row builder declaration binds to the query's physical index, with optional authored id appearing once.
4. `named_and_single_column_windows_keep_their_meaning`: exact declared-index reuse and legacy one-column compatibility.
5. `audience_columns_are_refused_for_inferred_and_explicit_sync`: inferred and explicit target/owner prefixes cannot be restated as order keys.
6. `unknown_columns_and_nonplain_or_wrong_prefix_indexes_still_refuse`: existing schema safety checks remain effective.
7. `builder_mismatch_is_noted_and_both_supported_order_repairs_remove_it`: exact builder regression, source site, both orders, generated-name hiding, code discovery, unchanged device eligibility and corrected advice.
8. `ascending_and_nested_helper_reads_are_located_but_server_queries_and_mutations_are_not_noted`: ascending advice, helper attribution and execution-scope filtering.
9. `held_order_note_does_not_promise_server_fallback`: retained local execution is described honestly.
10. `extra_equality_pins_get_an_explicit_index_rewrite_that_clears_the_note`: predicate pins that choose another index get an applicable physical-index repair.
11. `intrinsic_id_is_not_duplicated_when_followed_by_another_column`: preserve authored sync order even past id; give an explicit-index repair because ordinary query intent normalizes at id.
12. `named_indexes_with_identical_columns_still_have_distinct_window_coverage`: index identity matters, not just equal column lists; the named-index repair clears advice.
13. `online_only_is_not_a_query_modifier_in_the_current_language`: executable reproduction of the stopped RFC rewrite.
14. `legacy_implicit_id_index_gets_a_repair_that_selects_the_window_index`: a cursorless legacy index lacking explicit id needs physical-index selection; the repair clears N_SYNC_ORDER while preserving independent N_NO_CURSOR advice.

15. `capped_whole_domain_aggregates_do_not_get_page_order_advice`: a non-uniform whole-domain count with a literal bound supplied by `cap 50` also stays outside page-order advice, preserving its independent N_NEVER_COMPLETE authorization note.

Two device tests run the same scenario on SQLite and persisted memory:
`full_window_order_is_offline_after_reopen_on_sqlite` and
`full_window_order_is_offline_after_reopen_on_memory`. They prove timestamp
and ordinal ties, the full encoded floor, no other conversation's rows,
offline equality with the server, durable boundaries across reopen, partial
crossing pages, ascending/other-index unknown coverage (the client's fallback
signal), continued server execution, and admitting newer streamed keys while
dropping previously unheld keys below the floor. The window is reduced to
three rows in this boundary witness; this is not a 10,000-row scale measurement.

The CLI test is
`sync_order_note_is_printed_on_every_check_and_clears_with_matching_window`.
Guide definition/action pins and the revised ordinal fact accompany the
compiled-guide suite.

Affected qualification: 24 language unit tests, 84 guide tests, 21 intent-target
tests, 40 residency-note tests, 15 new language tests, two device tests and
three CLI check-note tests passed. The final legacy-index and capped-domain advisory refinements was made after the full suite compiled its test binaries; the affected language targets (including all 84 guide tests and the final 15-test regression target) and all three CLI check-note tests were rerun successfully on the final source. The full suite also exposed expected census/diagnostic assertions, listed below. Their corrected targets passed in full: 81 readauth tests, five shape tests, 12 digest tests and nine timeline-adoption tests. No runtime assertions were removed.

## Engineering decisions and stopped portions

- Keep this as compiler lowering onto existing indexes. The device already carries the full key; no capability bit, serialization change or runtime code is needed.
- Add an explicit id component only when not already listed. Preserve keys authored after id in the window, as a named index would; query intent's existing id normalization remains intact, so this edge case gets a named-index rewrite instead of a misleading column-order rewrite.
- Extra equality pins or a legacy implicit-id index can select another index even after the suggested column-order edit. Give a concrete index declaration/selection repair for those reads, preserving audience keys, residual predicates and the cursor.
- Held queries receive an honest incomplete-local explanation; they never promise server fallback.
- Audience-column repetition was formerly silently deduplicated in the one-column spelling. Its E_QUARRY_SYNTAX refusal is the deliberate compatibility change required by the brief.
- The from-SQL worked backend now explicitly runs its varied-order select/join/aggregate examples online to keep every guide Quarry block free of notes. Its separate account example still syncs.

Stopped rather than redesigning:

1. **Query `online only` rewrite does not exist.** Reproduce by changing the fixture header to `query thread(conversationId: conversations, c: cursor ?) online only:` and running `snapback4 check`: E_QUARRY_SYNTAX at `schema.q:21:58`, `expected ":", got "online"` (confirmed with the built CLI in `/tmp/p1-repro-online-only`). The parser recognizes `held` on queries and `: server` only on mutations. Applying the RFC's second rewrite would replace a runnable query with a syntax error. I did not add a new query execution modifier or recommend an unsupported spelling. N_SYNC_ORDER gives the supported order/index repair; the supervisor must decide the query-modifier addition.
2. **The universal order-only repair does not apply to whole-domain aggregates or nonplain indexes.** The new note is limited to ordinary finite pages on plain indexes. The binder's existing whole-domain metadata also excludes aggregate domains whose literal bound comes from a schema cap; `Bound::Meter` alone was insufficient. A regression pins that case. Reproduce a word-search limitation by adding `body: text`, `search body` to a windowed table and querying `messages where .conversationId = conversationId matching q last 2 by .at, .ordinal after c`: the word index remains different even when all order columns match, and the existing device word-read path marks horizon coverage unknown. The built CLI reproduction in `/tmp/p1-repro-word-window` passes without a note, as this stopped scope documents. A whole-domain `count(messages where .conversationId = conversationId)` likewise needs coverage outside the horizon; rewriting it as a bounded page changes the count's meaning. Those runtime paths remain unchanged and receive no new N_SYNC_ORDER. Extending the diagnostic to these reads needs different advice. This limitation is stated in `why` and the sync card.

No changes to authorization, disclosure, durability, meters or size budgets.
All changed source files are below 1,500 lines; `git diff --check` passes.
LLP 3000.019 references deliberately target the supervisor-supplied design; its file is not yet on this branch.
No packages published and no commits pushed. The supervisor owns integration
and the two blind reviews.

## Wasm and complete qualification

Rust 1.97.0, wasm-bindgen 0.2.127, Node 24.13.1, no wasm-opt. Build output:

```
wasm 2009169 B raw, 577903 B gzip (budget 578207: ok)
```

304 B gzip headroom; budget unchanged. The core and device runtime sources,
Cargo manifests/lock and wasm build script are identical to base `0badac987`.
Compiler/test/doc changes are outside the web artifact. This is a measured
current artifact; no independently rebuilt-control delta is claimed.

The required invocation was:

```sh
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$PATH
CARGO_BUILD_JOBS=8 SNAPBACK4_RUST_TEST_PROCESSES=4 SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 scripts/test.sh
```

Exact complete-script summary (exit 1):

```text
== 1 failure(s) in 3026 s
   cargo test
```

The failing stage printed `-- FAIL: cargo test (1214 s)`. All other stages
passed, including both app typechecks, package build/typecheck, wasm and
release guard, docs budget, nine fixture-wrapper tests, client tests and
seeded client models. There were no baseline or environmental failures.


The complete run compiled the original expectation assertions before their
fixes. These 17 failed cases are **ours**, all corrected and passing in
subsequent targeted reruns. No baseline or environmental Rust failure was
observed.

- `snapback4-device::readauth`: `census::authoring_census`. The from-SQL
  example's documented online change makes its add/remove mutations never
  predicting; the census now records that result. All 81 target tests pass.
- `snapback4-lang::shape_overrides`:
  `replacing_fields_determine_the_inferred_and_generated_types`. The two
  ascending pages now get N_SYNC_ORDER; the test pins both note locations.
  All five target tests pass.
- `snapback4-sim::clique::digest` (11 cases):
  `chat_overflow_refuses_before_admitting_a_partial_total`,
  `each_recipient_rechecks_live_state_after_earlier_chunks`,
  `hub_seeks_the_period_in_one_chunk_and_ordinal_history_parks_on_examined`,
  `markers_are_private_unsynced_and_cannot_be_forged`,
  `membership_bound_is_enforced_before_a_digest_can_skip_a_chat`,
  `parked_digest_replacement_skips_completed_profiles`,
  `period_digest_and_viewer_inbox_agree_before_the_expiry_sweep`,
  `refusal_before_or_after_emit_or_marker_rolls_back_the_whole_recipient`,
  `schedule_cursor_and_markers_survive_restart_and_manual_rerun`,
  `single_profile_stops_at_the_exact_examined_envelope`,
  `two_queued_runs_share_markers_and_an_empty_period_stays_silent`.
  Their finite ascending inbox pages now get N_SYNC_ORDER. The helper pins
  the specific query's note, retaining every runtime assertion. All 12 digest
  tests pass after the correction.
- `snapback4::timeline_adoption` (four cases):
  `a_new_view_preserves_preexisting_application_tables_with_owned_names`,
  `retirement_cancels_pending_delivery_and_rolls_back_with_a_failed_adoption`,
  `two_step_replacement_over_empty_sources_is_supported`,
  `unfinished_experimental_rebuild_is_fenced_but_can_be_removed`.
  Retiring Following exposes the ordinary source pages' ordering mismatch;
  the helper accepts the specific home/cards N_SYNC_ORDER notes in addition
  to existing N_NO_HORIZON. All nine target tests pass after the correction.

Targeted reruns, each with `CARGO_BUILD_JOBS=4`:

```sh
cargo test -p snapback4-device --test readauth --quiet
cargo test -p snapback4-lang --test shape_overrides --quiet
cargo test -p snapback4-sim --test clique digest:: --quiet
cargo test -p snapback4 --test timeline_adoption --quiet
```

The complete script was run once, as requested; its red result is retained,
not represented as a green complete-suite result. Those 17 failure fixes affect diagnostic
expectations only, with the final sources covered by the targeted passes.
Final compiler qualification: `/tmp/p1-final-lang.log` and `/tmp/p1-final-cli.log`.
Full output: `/tmp/p1-full-suite.log`; corrected target output:
`/tmp/p1-readauth.log`, `/tmp/p1-shape-overrides.log`, `/tmp/p1-digest.log`,
`/tmp/p1-timeline-adoption.log`.


Client checks completed with 1,997 passes, zero failures and 10 pre-existing
platform/opt-in skips (not counted as passes):

- Expo native media storage: requires macOS Foundation and AVFoundation.
- Managed organization/invitation policy: requires `SNAPBACK4_B1D_MANAGED_BIN`, its SHA-256 and `SNAPBACK4_B1D_MANAGED_SCRATCH_PARENT`.
- Managed OIDC profile binding: requires `SNAPBACK4_IDENTITY_PROFILE_SCRATCH_PARENT`.
- Published 0.2.27 bounds reference: requires `BOUNDS_BINARY`.
- Published 0.2.33 F2-store refusal: requires `SNAPBACK4_F2_LEGACY_BIN`.
- Three published 0.2.33 capability fences and one capability-free control: require `SNAPBACK4_FENCE_PUBLISHED`.
- Published 0.2.32 server request contract: requires `SNAPBACK4_LEGACY_BIN`.

These inputs were not provisioned for this lane; the full script's ordinary
skip conditions were unchanged. Seeded client-model result: 78 passed, zero failed and zero skipped.
