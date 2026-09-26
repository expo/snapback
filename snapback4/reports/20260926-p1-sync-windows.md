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

## Round 1 — 2026-09-26

Read both blind reviews in full (`p1-r0.astra.md`, `p1-r0.grok.md`) and the
original lane prompt. Accepted every finding; none was dismissed.

### Integration and constraints

Fetched origin and merged the requested `99153132b` as the first change,
commit `d7bdc37e6`. The only conflict was `JOURNAL.md`; both complete histories
were retained. The merge includes 0.4.3 and LLP 3000.017's ephemeral tables.
Git had no committer identity configured, so commits use the lane's previous
GPT-6 Astra identity through per-command configuration, with the requested
co-author trailer. No push or publication.

Orientation used the repository's `llp-orient` skill. Scope: compiler advice,
authoring metadata, guide cards and witnesses. Governing constraints: LLP 3000
§4 (fence), LLP 2000.000 §§6–7 (meters and authorized partitions), LLP 3000.007
§§6.2/18.2 (device classification and full-key acquisition), the supplied
LLP 3000.019 §3.1, and LLP 3000.017 §2 (ephemeral server execution).
LLP 3000.019 is still supplied in the prompt rather than present on this
branch; the supervisor owns that document. No new LLP was created.

### Findings, fixes and files

1. **Calendar omission (Astra).** `bind/residency/horizons/sync_order.rs` now
   excludes word indexes specifically, not all nonplain indexes. Calendar
   descriptions show the function and source field (plus bucket/offset when
   present), not a fictitious `.day` column. Ordinary calendar pages receive
   N_SYNC_ORDER. The sync card and `guide/codes.rs` correct the scope described
   in round 0: only word searches and whole-domain aggregates remain excluded.
   The old report's blanket nonplain-index exception is superseded here.

2. **Invalid replacement range (Astra).** The new diagnostic module prints a
   complete source page when changing the index would invalidate its range.
   It keeps compatible ranges and moves incompatible ones into residual
   filters. `bind/program.rs` retains the resolved source AST before filter
   binding in compiler-only metadata, including positional-key names and
   calendar expressions. `bind/actions.rs` initializes that metadata for
   actions. Neither core IR nor wire/schema serialization changes.
   The reviewer's program compiles, and the exact printed repair compiles
   without N_SYNC_ORDER:

   ```quarry
   messages[conversationId, ordinal > 0] first 2 by byOrdinal after c
   -- printed source-page repair:
   messages[conversationId = conversationId] after c last 2 by byWindow where .ordinal > 0
   ```

   The reviewer's alternative ordering of clauses is tested too:
   `messages[conversationId] last 2 by byWindow after c where .ordinal > 0`.
   The corresponding named indexes are `conversationId, ordinal, id` and
   `conversationId, at, ordinal, id`.

3. **Invalid view repair (both reviews).** A merge site or a spelling rooted
   somewhere other than the scan's source table always gets a source-table
   repair. It names that table, retains its branch predicates and cursor
   parameter, and tells the builder to preserve the projection and other
   branches when composing the result. It never tells a view to name a
   physical index. `bind/program/views.rs` retains the authored cursor in
   diagnostic metadata while execution still owns it at the merge.
   `horizons.rs` delegates ordering advice to the new focused module; other
   horizon advice is unchanged. Following retirement now proposes:

   ```quarry
   by bySyncWindow: at, id
   -- on posts; set its horizon to last 1000 by bySyncWindow, then page this source:
   posts[] after c last 20 by bySyncWindow where .parentId = null and .removed = false
   ```

   This is a source-branch repair, not an automatic rewrite of a whole union.
   `tests/timeline_adoption.rs` extracts the actual declaration, horizon and
   page from every retirement note, applies them to a source-branch query
   with its projection, and requires compilation and absence of N_SYNC_ORDER.
   The original retirement/adoption runtime assertions remain intact.

4. **Missing secondary/id stream regression (both reviews).**
   `snapback4-device/tests/sync_windows.rs` now streams `(100,1)` and
   `(100,2,id="w")` below the existing `(100,2,id="x")` floor and requires
   both to be absent, alongside the older-timestamp rejection. A tied key
   with id `y` must be kept. It moves held `b` below the ordinal floor and
   previously unheld `z` above it using real mutations and streams, then
   reopens each store. `b` remains point-readable but leaves the suffix;
   `z` enters it. The original floor still bounds coverage, and the complete
   local top page agrees with the server. Both SQLite and persisted memory
   run the identical scenario. Runtime source is unchanged.

5. **Merged cards (user integration requirement).** Both mismatches in the
   receipts card were real: history selected a unique index different from
   the horizon, and progress read oldest first. Commit `e2f4159e3` names the
   existing unique index `byConversationOrdinal` and selects it for sync.
   Progress reads `(delivered, delivered + 100]` newest first on that index:

   ```quarry
   messages where .conversation = conversation and .ordinal > delivered and .ordinal <= delivered + 100 last 100 by .ordinal after c
   ```

   The card allocates contiguous ordinals and never deletes messages, so the
   same next interval advances the prefix. The hook already sorts fetched
   ordinals into runs. `tests/guide.rs` changes two expected page orders and
   preserves every receipt, gap, recipient and watermark assertion. The
   prose states the contiguous/no-deletion requirement and server fallback
   below the acquired window. No warning was suppressed.

   The ephemeral card had a different merge seam: `rooms` repeated its
   audience `.id` in the order, which the requested P1 refusal rejects.
   `guide/ephemeral.md` removes that redundant horizon from a one-row scope.
   Its ephemeral joins remain classified server-side. Both cards compile
   without N_SYNC_ORDER; the complete 85-test guide target passes (including
   the card's existing intentional N_EPHEMERAL_SERVER classification note).

### Tests and mutation evidence

`crates/snapback4-lang/tests/sync_windows.rs` now has 20 tests (15 existing,
five added):

- `calendar_pages_get_order_advice_and_the_window_repair_clears_it`: function
  description, presence of the note, application of its printed named-index
  replacement and removal of the note.
- `index_repair_moves_an_incompatible_explicit_range_into_a_residual_filter`:
  the reviewer's exact range example, printed repair and reviewer spelling
  all compile; the repaired scan uses `byWindow` and retains its filter.
- `view_repair_names_an_executable_source_page_with_its_predicates`: applies
  the printed declaration, horizon and source page; preserves sender filter
  and cursor parameter; clears the note.
- `replacement_preserves_compatible_ranges_and_moves_calendar_ranges`:
  valid range keys stay valid, and a calendar range becomes a function in
  the filter rather than an invalid row-field/key reference.
- `word_search_keeps_its_separate_coverage_requirement`: narrowing the
  nonplain exclusion does not start giving word searches false page advice.

The two device witnesses also run the calendar page (unknown/incomplete),
then the matching window-index repair (complete, equal to the thread page)
on both stores. The four affected Following-retirement cases apply the real
note as described above instead of checking only its code.

Five temporary mutants were compiled and run, then restored. These are
intentional negative checks, not qualification failures:

| Mutation | Assertion failures |
| --- | --- |
| Restore `is_plain()` query-index exclusion | Calendar regression: 1 failed |
| Disable incompatible-range detection | Explicit-range repair regression: 1 failed |
| Emit `use last N by .missing` for view pages | All 4 reviewed Following-retirement cases failed |
| Compare only audience + first order column in `Boundaries::accept` | Both device stores failed (7 rows admitted, expected 5) |
| Compare audience + both order columns but omit id | Both device stores failed (6 rows admitted, expected 5) |

Logs: `/tmp/p1-r1-mutations.log` and
`/tmp/p1-r1-mutant-{calendar-excluded,range-unchecked,view-missing-index,floor-first-column,floor-without-id}.log`.
The mutations changed no committed runtime source. Restored controls are
recorded separately, followed by the complete suite below.

### Compatibility seam found by the complete suite

The merged E1 test `ephemeral_compat::durable_schema_and_types_keep_base_bytes`
compared the complete fixture list against its pre-ephemeral capture. P1's
round-0 `sync-windows.q` was the sole extra filename. This is **ours**, an
integration expectation missed by the targeted set, not a baseline or
an environmental failure.

`tests/ephemeral_compat.rs` now adds one independent P1 expectation from
`tests/fixtures/ephemeral-compat-p1.json`. To produce it, archived round-0
commit `e1d84ebe7` into ignored `target/p1-r0-compat-source`, built that
compiler separately, compiled its unchanged window fixture and captured
its serialized schema and emitted TypeScript. Its compiler reports no
errors or notes. The merged compiler matches those bytes exactly. The
original `ephemeral-compat.json` and `ephemeral-compat-main.json` records
remain byte-for-byte unchanged; no fixture or assertion was removed.
The corrected target passes (1/1) in `/tmp/p1-r1-ephemeral-compat.log`.
The independent capture is `/tmp/p1-r1-round0-compat.json`; build output is
`/tmp/p1-r1-round0-compat-build.log`. This test-only correction was made
after the full run compiled its Rust test inventory; that run's red result
is retained, and the script was not invoked a second time.

### Remaining boundaries

No review finding remains open. The accepted round-0 stops still stand:
query `online only` is unsupported, and changing page order cannot establish
word-search or whole-domain aggregate coverage. Calendar pages are now covered.
The view advice qualifies a source page and explicitly requires preserving
other branches/projections; it does not promise an automatic union rewrite.
A cursor parameter is retained, but pagination restarts when changing order.
Authorization, disclosure, durability and metering rules are unchanged,
as is the budget. Device/core runtime source matches merged main `99153132b`.
P1 round-1 source files remain below 1,500 lines (largest: `tests/guide.rs`,
1,487). An inherited housekeeping exception remains outside this lane:
`packages/snapback4/src/local.ts` is 1,511 lines on the requested main commit
and unchanged here. Reproduce with
`git show 99153132b:snapback4/packages/snapback4/src/local.ts | wc -l`.
This is not a failure reported by `scripts/test.sh`.

### Round-1 qualification

Restored affected controls passed: 20 sync-window language tests, 85 guide,
21 intent-target, 40 residency-note, five shape and four calendar-index tests;
81 device authorization-census tests and both window witnesses; three CLI
check-note tests and all nine timeline-adoption tests; all 12 digest tests.
The compatibility correction then passed its one target test. Logs:
`/tmp/p1-r1-control-{lang,device,cli,digest}.log` and
`/tmp/p1-r1-ephemeral-compat.log`.

The single full-suite invocation (from `snapback4/`) is:

```sh
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$PATH
CARGO_BUILD_JOBS=8 SNAPBACK4_RUST_TEST_PROCESSES=4 SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 scripts/test.sh
```

Wasm from that run:

```text
wasm 2021689 B raw, 581094 B gzip (budget 582094: ok)
```

This matches the merged-main recorded measurement exactly, with 1,000 B
headroom. P1 changes no wasm runtime source or budget; the larger budget
than round 0 is inherited from the requested main merge. No independent
fresh-control wasm delta is claimed.

Rust completed with 3,593 passes, one failure, and 19 existing ignores.
The sole failed target was `snapback4-lang::ephemeral_compat`, test
`durable_schema_and_types_keep_base_bytes`, at line 24: the fixture filename
list included P1's new `sync-windows.q`, absent from E1's expectations.
Classification: **ours**, fixed and separately verified as described above.
The full stage reported `-- FAIL: cargo test (1277 s)`. No other Rust target
failed. The compatibility record correction affects tests only; all product
code was committed before the full suite began.

All build/typecheck/docs/release-guard and fixture-wrapper stages passed
(the fixture wrapper was 9/9). Ordinary client tests passed **2,179**, with
zero failures, zero cancellations and **10 existing platform/opt-in skips**;
the stage reported `-- ok: client tests (1777 s)`. Those are the same ten
conditions listed in round 0: macOS media APIs, managed organization/private
OIDC scratch inputs, and the optional published 0.2.27/0.2.32/0.2.33 binaries
or tarball cache. They are skips, not passes or failures; none was added by P1.
All **78 seeded client-model tests passed**, with zero failures and zero
skips, at the unchanged 5,000 / 5,000 / 3,000 sequence counts. The stage
reported `-- ok: client models (254 s)`.

Exact complete-script result (exit **1**):

```text
== 1 failure(s) in 3364 s
   cargo test
```

Every failure is accounted for: **ours: one**, the corrected compatibility
fixture-list assertion above; **baseline: zero**; **environmental: zero**.
The script ran once. Its red result is not represented as a green full-suite
run. The final test-only correction has a passing targeted control; all
product code had already been included in the full run. No test count,
ignore/skip condition, timeout, model count or runtime ceiling was reduced.
Full log: `/tmp/p1-r1-full-suite.log`; exit status:
`/tmp/p1-r1-full-suite.exit`.

Implementation commits: `d7bdc37e6` (requested merge), `e2f4159e3` (cards),
`c56f051a2` (diagnostics and executable repairs), `18e19c8da` (two-store
witnesses), `b7b43f2eb` (independent compatibility record). Each carries the
requested GPT-6 Astra co-author trailer. The final documentation commit
contains this round-1 report and one appended journal entry.

## Round 2 — 2026-09-26

Read the original lane prompt, this report, and both complete round-1 reviews
(`p1-r1.astra.md`, `p1-r1.grok.md`). Accepted all four repair findings and both
mutation gaps. No finding was dismissed. This section supersedes round 1's
claim that its printed source-branch repairs were sufficient.

### Integration and context

Fetched origin, then merged exactly `992cec75c` before repairs, in
`cf47b8105`. The only conflict was `JOURNAL.md`; both complete sides remain.
The merge includes LLP 3000.019 itself. The post-merge controls passed before
repairs: 20 sync-window compiler tests, 86 guide tests, one compatibility
case, both device stores, three CLI checks and nine timeline-adoption cases.
Git still lacked a configured committer; commits use the existing lane's
GPT-6 Astra identity through per-command options, with the required trailer.

Used `llp-orient` for the compiler, guide and device witness scope. Governing
context: LLP 3000 §4 (fence), LLP 2000.000 §§6–7 (meter and authorized
partitions), LLP 3000.007 §§6.2/18.2 (classification and full-key acquisition),
and LLP 3000.019 §3.1 (P1, now in current/), refined by the user's explicit
round-2 exact-repair rule. Relevant current authoring facts are in the sync
and writes cards. No new design, protocol, LLP or budget was introduced.
Hand-off: none. The runtime, wire, authorization, disclosure, durability and
metering implementations remain unchanged.

### Findings and implementation, file by file

- `crates/snapback4-lang/src/bind/residency/horizons/sync_order.rs` now has
  one full-page repair path. Every named-index repair lifts each audience
  equality out of `where` into a bracket key, including reversed equalities.
  This fixes Grok's ordinary page, ascending full-page and `count(page)`
  reproductions. It never offers a bare `last N by name` fragment. For a
  generated window, it prints the exact named index declaration, the sync
  horizon replacement and the full page. This prevents another identical
  physical index or an extra equality pin from silently selecting a
  different acquisition index.
- The same file rejects outer-focal key/seek operands before moving any
  predicate. Astra's `.threshold` and `.ordinal` endpoints get only words
  naming the window's order and index. A scope-independent named local such
  as `floor` can still move into the residual without changing its binding.
- Generated membership lanes (including nullable/null lanes), explicit
  merges and projected views get prose only. A source lane lacks the full
  authored predicate, merge cursor and/or projection. The note does not
  pretend it is a complete read. Compiler-only bindings such as `$intentLane`
  are omitted from both the repair and displayed source spelling.
- A capped ordinary read without an authored range now gets an explicit
  descending range with the bound scan's N (`last 50` in Astra's example).
  Its cursor, if authored, is kept. Compatible seeks stay in bracket keys;
  incompatible independent seeks become residual comparisons, preserving
  calendar functions and any residual already present.
- Conservative guards also keep advice in words when a target index cannot
  carry the cursor, dropping pins would lose the cap that made a cursorless
  page complete, rule-deciding fields would be unpinned, or the replacement
  would introduce a sparse-filter/seek note. No executable-looking fallback
  is printed if an exact page cannot be constructed.
- `crates/snapback4-lang/src/bind/program/views.rs` drops the now-unused
  diagnostic-only cursor copy into individual view lanes. Execution still
  owns its original merge cursor; no IR or execution change.
- `crates/snapback4-lang/src/guide/{sync.rs,codes.rs}` states the exact-page
  versus words boundary and explains outer-row and merge scope. All Quarry
  blocks and the existing guide/action facts still pass.
- `crates/snapback4-lang/tests/sync_windows.rs` applies complete emitted
  repairs instead of substituting independently written approximations.
  Its view case now requires words, because a branch is not a whole view.
- New `crates/snapback4-lang/tests/sync_windows/repairs.rs` extracts and
  applies the emitted declaration/horizon/page text. It requires no compile
  diagnostics, no N_SYNC_ORDER or N_NEVER_COMPLETE, and no newly introduced
  note. The cursorless legacy regression retains its pre-existing
  N_NO_CURSOR; all new executable repair fixtures have zero notes.
- `crates/snapback4/tests/check_notes.rs` expects the new full repair through
  the actual CLI. `tests/timeline_adoption.rs` requires all retirement/view
  advice to stay in words, name the index and direction, preserve the
  enclosing merge, and expose no compiler binding. Its runtime retirement
  assertions are unchanged.
- `crates/snapback4-device/tests/sync_windows.rs` applies the calendar
  diagnostic's actual page. Both stores now delete the floor row through a
  real mutation/stream, confirm it is absent, and stream the exact key back.
  This exercises an unheld row equal to the floor rather than the held-row
  shortcut. All previous tie, below-floor, moved-row, reopen and offline
  coverage assertions remain.
- `JOURNAL.md`: one appended round-2 entry; this report: this appended section.

### Executable forms and deliberate prose boundaries

Given the fixture's named `byWindow: conversationId, at, ordinal, id`:

```quarry
messages[conversationId = conversationId] after c last 2 by byWindow
messages[conversationId = conversationId] after c last 2 by byWindow where .sender = viewer and .ordinal > 0
messages[conversationId = conversationId] last 50 by byWindow where .sender = viewer
count(messages[conversationId = conversationId] after c last 2 by byWindow)
```

These are emitted, applied, compiled and run in the tests. The first handles
both named-index paths; the second preserves the moved seek and existing
residual; the third is the implicit capped read; the fourth retains a count's
audience pin and cursor. Full declaration/horizon/page repairs for generated
indexes, identical named indexes, an order with id in its middle, calendar
indexes/ranges and a named local range are also applied and run.

Outer-row predicates, generated membership lanes, nullable membership,
explicit merges and projected views print no Quarry replacement. For example,
`.sender in [viewer]` is never printed as `.sender = $intentLane`; its
lowered merge gets the window order and index in words. This uses the user's
explicit no-rewrite alternative, not an unresolved finding. A hand rewrite
would need to preserve the authored membership and whole merge cursor; this
lane does not synthesize it from one compiler lane.

An order change intentionally changes page order and potentially which rows
fall on each page. Runtime repair tests drain both original and repaired
pages, require the identical full row population, require descending window
order, and follow a second page without repeats. Their fixture contains a
second *readable* conversation (so authorization cannot hide a dropped
predicate), an excluded sender, a below-range row, and differing time/ordinal
orders. Count uses a companion page of its exact source to obtain the second
cursor, since count itself does not expose the consumed page's continuation.
The outer-threshold fixture has threshold 5 and candidate ordinals 3 and 6,
both with threshold 0: only ordinal 6 is returned, and no false rewrite is
offered. The cap fixture is consumed whole and needs no cursor.

### Tests and mutation evidence

Eight new compiler cases bring the sync-window target to **28**:

1. `named_where_pages_lift_audience_and_keep_second_page`: both old repair
   paths, reversed equality, extra sender equality, exact rows and paging.
2. `count_applies_the_same_audience_page_repair_and_preserves_continuation`:
   count's applied repair compiles without notes and returns the expected
   counts, including a second cursor from its identical source page.
3. `moved_range_keeps_existing_residual_and_second_page`: `.ordinal > 0`
   and `.sender = viewer` both survive, with all five expected rows and
   working continuation.
4. `generated_indexes_calendar_ranges_and_named_locals_apply_and_run`:
   every other emitted repair shape is applied and executes the same rows
   over multiple pages in window order.
5. `capped_read_without_range_gets_last_from_its_bound`: `last 50` is
   synthesized, the note clears, and the whole capped population survives.
6. `membership_and_explicit_merges_only_name_the_window_in_words`: present
   and nullable membership, nullable list items and explicit merge advice
   contain neither snippets nor compiler bindings.
7. `outer_threshold_stays_outer_and_never_becomes_a_candidate_filter`:
   the reviewer's threshold example executes correctly; both focal
   endpoint spellings get words only.
8. `advice_falls_back_if_an_index_or_cap_cannot_preserve_continuation`:
   a noncursorable window, narrower caps with implicit and explicit page
   bounds, and a would-be new seek note cannot produce a misleading repair.

Both surviving mutations were actually run, failed assertions, and restored:

| Temporary mutation | Result |
| --- | --- |
| `Boundaries::accept`: `>=` to `>` | Both stores fail “an unheld streamed key equal to the floor must be admitted”; 0 passed, 2 failed, exit 101 |
| Clear cursor only when `source_page` moves an incompatible seek | Residual-plus-range test fails “cursor lost”; 0 passed, 1 failed, exit 101 |

Logs: `/tmp/p1-r2-mutant-floor-strict.log` and
`/tmp/p1-r2-mutant-cursor-cleared-on-move.log`. No runtime mutation is committed.
Restored controls passed: 28 sync-window compiler tests, 86 guide, 21 intent,
40 residency notes, five shape, four calendar and one compatibility case;
81 authorization-census tests plus both device stores; three CLI notes and
nine timeline-adoption tests. Logs: `/tmp/p1-r2-control-{lang,device,cli}.log`.
The original compatibility records, assertions and fixture set remain intact.

### Qualification and remaining limits

No review finding remains open. The deliberate no-rewrite shapes above are
conservative advice boundaries under the user's rule. The previous stops
remain: query `online only` is not a supported modifier; word searches and
whole-domain aggregates have separate coverage requirements. Existing query
execution behavior and fallback are unchanged. There is no automatic rewrite
of a whole merge or of an outer-row endpoint through a newly introduced local.

The complete script's wasm build measured **2,021,689 B raw / 581,094 B gzip**
against the unchanged **582,094 B** budget: **1,000 B headroom**. This is the
same whole-artifact measurement recorded for the merged main; no independent
fresh-control delta is claimed. The budget file is unchanged.

The inherited source-length exception noted in round 1 remains outside P1:
`packages/snapback4/src/local.ts` is 1,512 lines on requested main `992cec75c`
and unchanged by this lane. Reproduce with
`git show 992cec75c:snapback4/packages/snapback4/src/local.ts | wc -l`.
All source files edited by round 2 remain below 1,500 lines.

The single complete-suite command, from `snapback4/`, is:

```sh
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$PATH
CARGO_BUILD_JOBS=8 SNAPBACK4_RUST_TEST_PROCESSES=4 SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 scripts/test.sh
```

Node is v24.13.1; Bun is 1.3.14. `bun install --frozen-lockfile` passed before
JS checks (507 installs across 501 packages, unchanged). No skip condition,
test count, model sequence count, timeout or resource ceiling was reduced.
Full log: `/tmp/p1-r2-full-suite.log`; exit status:
`/tmp/p1-r2-full-suite.exit`.

The complete Rust stage passed: **3,605 passed, zero failed, 19 existing
ignores**, reported as `-- ok: cargo test (859 s)`. Both app typechecks and
all nine fixture-wrapper tests passed.

Ordinary clients: **2,214 passed, one failed, 10 existing skips**, with no
cancellations, reported as `-- FAIL: client tests (1815 s)`. The sole failed
case is `predicted expireMember: every commit clears the pending observation`
in `packages/snapback4/test/page-authority.test.mjs:192`. Its actual failure
was **`AssertionError [ERR_ASSERTION]: timed out: server`**, at `until` line
16 and fixture startup line 33, before the expiry scenario ran. The harness
waits 500 × 10 ms for the dev server's URL. Classification: **environmental**
(transient server startup), not a P1 assertion failure. The test, fixture,
client and runtime sources match requested main, and its fixture has no
horizon that could enter the changed advisory path.

The exact affected-case rerun passed unchanged (**1 passed, zero failed**,
exit 0, 5,300.469 ms total). No timeout was raised and no product code was
changed for this failure. Reproduce the attempted case with:

```sh
node --test --test-name-pattern='^predicted expireMember:' packages/snapback4/test/page-authority.test.mjs
```

The isolated rerun did **not** reproduce the startup timeout. Its log and
exit status are `/tmp/p1-r2-expire-member-rerun.{log,exit}`. The red complete
run is retained; the rerun is not represented as a green complete run.
The ten ordinary client skips are the unchanged platform/opt-in conditions
listed in round 0 (macOS media APIs and optional managed/published inputs).

All **78 seeded model tests passed**, with zero failures and zero skips,
at the unchanged 5,000 / 5,000 / 3,000 sequence counts. The stage reported
`-- ok: client models (255 s)`.

Exact full-script result (exit **1**):

```text
== 1 failure(s) in 2955 s
   client tests
```

Failure classification: **ours: zero; baseline: zero; environmental: one**
(the startup timeout above). The underlying reason for the one delayed
startup was not established. The full script ran once and was not repeated.

### Final conservative guard after the full Rust stage

Final review extended the cap regression to an *explicit* cursorless page:
`cap 50 by conversationId, sender` plus a sender-pinned `first 50` read.
Removing sender from the bracket keys also removes the cap that proved that
this page needed no cursor. The previous guard covered only reads with no
authored range. The expanded regression failed against that implementation
(`/tmp/p1-r2-explicit-cap-before.log`, 0 passed, 1 failed, exit 101).

The final guard compares the original scan's cap with the proposed audience
prefix's cap whenever no cursor is present. If it would lose that completeness
proof, the note prints words. This is the same no-new-note rule, applied to
both implicit and explicit capped pages; the ordinary `cap 50 by
conversationId` repair still prints `last 50` and runs without a note.

Qualification boundary: the single full script compiled the preceding
implementation. This final compiler-only guard is qualified by the affected
compiler/guide/CLI targets below, not by a second full run. It changes neither
the wasm artifact nor any runtime, client, schema or wire code. This is the
only qualification-sequence deviation; every requested finding is addressed.
Final affected targets all passed: **28** sync-window tests, **86** guide,
**40** residency-note, **one** compatibility case, **three** CLI notes and
**nine** timeline-adoption tests. Logs:
`/tmp/p1-r2-final-affected-{lang,cli}.log`. Guard commit: `64ac359ac`.
There is no remaining P1 product finding. The only unresolved observation is
the non-reproduced environmental startup delay above; the unrelated inherited
source-length exception is also retained in this report.
Implementation commits: `cf47b8105` (requested merge), `193dc3e6b` (exact
repairs, guide and compiler/CLI tests), `3b06badfd` (floor equality witness),
and `64ac359ac` (explicit cursorless-cap guard).
Every commit has the requested co-author trailer. No push or publication.
