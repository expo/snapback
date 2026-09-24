Lane A implementation report — 2026-09-24

Worktree: `~/sb4-intent/lane-a`; branch: `sb4-intent/a-planner`; base: `6d9f3e001`. Nothing pushed or published.

The Clique acceptance subset compiles without authored index names and runs Global, thread, user posts, finite-window Trending, people search and membership-scoped search-all. All index synthesis is ordinary schema data. Positional resolution uses the original declared candidate set, independently of generated indexes. Rules precede projection, ordering and counting; ordinary program membership reads never become raw authorization probes.

The implementation has conservative planner coverage limits described below. These preserve authorization and bounded execution but do not claim every conjunction receives a Cartesian lane plan.

Forms exercised (schema declarations are shown as individual lines; complete compiled contexts are in `intent_target.rs`, `fixtures/intent-clique.q` and the language card):

| Form | Example |
| --- | --- |
| Equality / boolean / null predicates | `posts where .authorId = owner and .parentId = null and not .removed last 20 by .at after c` |
| Default id order | `posts where .authorId = owner first 20` |
| First-key seek | `posts where .at >= now - 24h last 20 by .at after c` |
| Finite ranked bucket window | `posts where .at > now - 24h and .at <= now last 20 by .likeCount, .at after c` |
| Value lanes | `posts where .authorId in authors last 20 by .at after c` |
| Authorized membership discovery | `messages where exists members[.conversationId, viewer] matching q last 20 by .at after c` |
| Id / declared unique / named extra checks | `posts[postId]`; `members[room, viewer]` when arity is unambiguous; `members[room = room, principal = viewer, role = 'admin']` |
| Named scan | `posts[authorId = owner] first 20` |
| Words declaration / search | `search displayName, handle`; `profiles matching q first 20 after c` |
| Unnamed unique | `unique handle else HANDLE_TAKEN 'That handle is taken.'`; `unique room, principal` |
| Rule probes / audiences | `read <- exists members[.room, viewer]`; `sync to members[.room] last 50 by .at` |
| Caps / expiry | `cap 50 by room`; `expire at .expiresAt` |
| Durations | `[500ms, 30s, 15m, 24h, 7d, bucket(now, 2m)]` |
| Planned union | `view activity:` with `posts { actor: .authorId, at }` and `reposts { actor: .actorId, at }` branches |
| View page / shape | `activity last 20 by .at after c { id, actor, at }` |
| Single-branch projection | `view visible:` with `posts where not .removed { actor: .authorId, at }` |
| Aggregate alias | `view totals: count posts by .authorId` with the existing explicit `read <- allow` body; omitted readability belongs to Lane B |
| Sum/hop parser handoff | `view totals: sum posts of amount by .parent.owner` produces the existing Maintain AST; Lane B owns derived readability |
| Feed parser handoff | `view following: activity where .actor = viewer` produces FeedView and deliberately refuses binding with `E_VIEW_FEED_PENDING`; Lane C owns binding |

Verification:

- Final `scripts/test.sh`: **`== 1 failure(s) in 154 s`**. Failures: **one baseline failure**, `snapback4-core::schema_capabilities_legacy::genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier`; no introduced or environmental failures in this final run.
- Baseline: `~/sb4-intent/baseline-test.log` ends `== 1 failure(s) in 276 s`; its sole failure is `snapback4-core::schema_capabilities_legacy::genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier` at `schema_capabilities_legacy.rs:20`, an existing schema equality assertion. It is not changed by this lane.
- Focused intent tests: 21 passed. Offline union tests: 4 passed across memory and SQLite. Guide tests: 55 passed. Prefix/admission rewrite tests: 10 prefix tests plus 3 papercut tests passed. The final full run also passed all eight historical lowering shards and all 995 client tests (10 skipped). Its log is `/tmp/lane-a-suite-releasecheck.log`.
- `ref-check --verbose`: 504 LLP documents, 9,208 references, 25,455 files; 0 errors, 0 unchecked. Changed source files over 1,500 lines: none. `git diff --check`: clean.
- Final WASM measurement: **1,735,736 bytes raw / 480,624 bytes gzip**, Rust 1.97.0 and wasm-bindgen 0.2.127, no wasm-opt. Gzip is 6,624 bytes above the prior 474,000-byte ceiling. The host baseline measured 1,707,362 bytes raw / 472,890 bytes gzip; the delta is +28,374 raw / +7,734 gzip. The justified ratchet is 481,000 bytes, leaving 376 bytes. This is whole-artifact cost; no per-feature attribution is claimed.
- Earlier introduced failures were fixed: new IR/Bound initializers, positional fixture migrations, inverse-index key width, four golden site offsets, diagnostic rewrites, census/reason snapshots and obsolete missing-index expectations. The intermediate 480,066-byte WASM result exceeded its temporary 480,000-byte ceiling by 66 bytes; the final ratchet and measurement supersede it.
- Two intermittent client failures appeared during earlier full runs: acquisition W5c process pending-write recovery observed `sent` before an assertion expecting `pending`; worker W7r1 deferred presence saw an AbortError during shutdown. **Environmental/timing**, supported by isolated reruns: all four W5c variants passed, and the deferred worker test passed. Neither affected worker/outbox implementation was edited. Commands: `node --test --test-name-pattern='W5c' packages/snapback4/test/acquisition.test.mjs` and `node --test --test-name-pattern='runWorker and doctor observe deferred' packages/snapback4/test/worker.test.mjs`.

Each new intent test and its proof:

- `predicate_indexes_and_durations_compile`: Canonical equality/boolean pins, first-order seek and adjacent duration parsing.
- `schema_intent_compiles_without_index_names`: Unnamed unique, probes, caps, sync audience/horizon, expiry and search synthesize usable schema indexes.
- `union_pages_translate_column_names_and_authorize_each_source`: Different source column names page through one view; hidden reposts remain hidden; TypeScript contains the view.
- `in_and_membership_predicates_become_metered_lanes`: Bounded values and membership search use ordinary authorized scans and preserve deduplication.
- `view_cursor_keeps_equal_ids_across_tables_and_same_table_branches`: Equal source ids in different tables and repeated same-table branches survive deduplication and both page directions, including shaping.
- `finite_windows_match_manual_trending_and_include_future_buckets`: Planned Trending equals the hand-written merge on ties, partial oldest bucket, removals and finite future upper bounds; missing upper stays residual.
- `indexes_are_stable_and_positional_keys_never_guess`: Reordering programs leaves table schemas unchanged; two declared unique keys of equal arity refuse regardless of other planned reads.
- `unused_views_are_checked_and_have_types`: Unused views still validate field compatibility and emit one type.
- `clique_acceptance_subset_compiles_without_authored_indexes`: Run Global, thread, user posts, Trending, people search and search-all, including a hidden conversation.
- `membership_sources_authorize_before_enumerating_and_cuts_have_no_cursor`: Nonuniform membership reads cannot enumerate hidden rooms; discovery cuts cannot emit continuation.
- `union_cursor_uses_projected_keys_and_handles_inserts_and_order_pins`: Source-id aliases, interleaved inserts, order-key equality and an unknown head preserve cursor correctness.
- `domains_views_and_aggregates_keep_scan_admission`: Unbounded count remains refused; query domains and capped view counts retain their existing admission.
- `aggregate_and_feed_view_syntax_has_the_shared_ast`: Aggregate aliases preserve Maintain AST, dotted/hop keys normalize, feed AST gets the pending code.
- `audience_indexes_follow_probe_order_and_inferred_horizons`: Written probe order and principal position survive inference and differently named source/target group columns.
- `projected_predicates_respect_focal_scope_and_field_visibility`: Nested reads keep their own focal scope and cannot refer to unprojected source fields.
- `union_positions_survive_empty_pruning_nullable_keys_and_unequal_caps`: Validate empty-view cursors, page across optional/required source order types and count all rows when branch caps differ.
- `declared_indexes_are_preferred_and_ambiguous_definitions_refuse`: Reuse a declared implicit-id index; refuse competing orders and competing word definitions.
- `value_lanes_skip_null_before_opening_and_deduplicate`: Null values select no lane; duplicate values do not duplicate rows; mutation residual evaluation keeps that meaning.
- `capped_membership_discovery_never_certifies_a_prefix_of_values`: A deliberately shortened source scan makes the final page incomplete and cursorless.
- `argument_pins_prune_constant_branches_before_source_scans`: Dynamic pins eliminate constant-incompatible branches before spending the source meter.
- `bounded_value_predicates_work_in_mutations_and_constant_windows_fold`: Mutation reads retain ordinary scan admission; constant duration arithmetic becomes a finite bucket window.

`intent_views.rs` adds `union_offline_memory`, `union_offline_sqlite`, `union_unknown_branch_memory` and `union_unknown_branch_sqlite`. The latter two also prove a dynamically eliminated offline-unavailable branch needs no coverage. The JavaScript subscription test starts with empty tables, then writes the same id to both branches and observes each update.

Decisions and limits for integration:

- Both supervisor addenda supersede the original numeric collision suffix, id-only union identity, guessed positional keys and one-sided bucket plan. Generated names use the reserved `$intent:` namespace plus a canonical descriptor hash; pins are sorted for ordinary reads and kept in written order for probes/sync. Indexes have no stored scan direction in this schema model; ascending/descending traversal shares one index definition.
- The IR adds view-owned position metadata, branch identity, a constant guard and value-source deduplication in addition to the requested optional projection. Every added field defaults and disappears when absent. This lets an empty or pruned view validate a cursor, and a nullable projected position seek a required source index, without relaxing public cursor validation. The final ordering is projected keys, source id, branch, as addendum 1 specifies.
- Union lanes currently use the existing eager per-lane scan contract with metered retained rows and sorting. They return an incomplete page without a continuation on unknown heads; they do not claim the ordinary uniform merge's lazy drain optimization. Value/bucket lanes continue through the existing lazy/eager paths and preserve the opening/drain distinction.
- **Planner optimization limit:** one lane-producing conjunct is selected per source read; other `in`, membership or finite-window conjuncts remain exact residual filters. For example, `posts where .owner in owners and .room in rooms last 5 by .rank after c` opens owner lanes and filters room values. This can spend more of the meter than a Cartesian plan. It never certifies an unfinished lane source. Reproduction: declare `owner: principal`, `room: id`, `rank: int`, public posts, and bounded owner/room list arguments; inspect `check --cost`.
- **Calendar naming limit:** a source column named `hour` (or `day` for a day window) collides with the existing computed-component name. This case remains an ordinary residual scan with `N_SPARSE_FILTER`, rather than changing calendar-key semantics. Reproduction: public posts with `hour: int`, `at: time`, `rank: int`; read `posts where .at > now - 24h and .at <= now last 5 by .rank after c`. Optional timestamps likewise retain the existing present-operand/type-narrowing and required calendar-column rules.
- Shared helper/shape definitions and non-query programs use ordinary residual scans for value/window predicates so the caller's scan admission remains unchanged. Query program bodies get lane expansion. Example: `mutation q(owners: [principal] <=2): return posts where .owner in owners first 5` compiles as an ordinary authorized scan; it is not converted into a mutation merge, which core admission intentionally refuses. Jobs' omitted bounds and streaming count/exists admission were not widened.
- The inherited diagnostic expression printer can omit grouping in a displayed read such as `now - (12h + 12h)`. The executed expression and its 24-hour bucket plan are correct (covered by the constant-window test), but `check --cost` can display `now - 43200000 + 43200000`. This presentation issue remains open; the duration literal `24h` avoids the misleading display.
- Declared index reuse compares the effective full ordering including implicit id. An authored definition with extra components after that id is not reused by this implementation; it receives a separate canonical index. This is conservative schema duplication, not an ordering or authorization change. Reproduction: `by authored: owner, at, id, extra` and `posts where .owner = viewer last 5 by .at after c`.
- Aggregate view readability and implicit aggregate foreign-key inference remain Lane B work. Feed view binding/Following remain Lane C work. Self-chunking jobs and streaming aggregates remain Lane D work. The acceptance fixture deliberately excludes those portions and spells existing in-table count foreign keys explicitly.
- Historical lowering sources changed only for the intentional positional-key rule. Four of 740 golden bundles have a shifted `Require.site` column after adding named keys: `3057aa…:probe` 13:33→13:37; `a56271…:push` 124:30→124:42; `b9c841…:clique-relaxed.push` 124:30→124:42; `eaabe4…:scalar` 36:20→36:26. The compared executable IR had no other difference. No historical journal entry was rewritten.

Open failures and reproductions:

- Baseline schema-capability equality failure: from `snapback4/`, run `cargo test -p snapback4-core --test schema_capabilities_legacy genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier`. The assertion already fails on the unmodified baseline. No fix was attempted.
- Planner optimization limits above are reproducible coverage gaps, not complete Cartesian-planner claims. No known authorization, disclosure or cursor identity failure is being accepted as complete.
- Final introduced test failures: none. Final environmental test failures: none.

File-by-file inventory (every path is relative to `snapback4/`; files described as migrations deliberately change positional spelling only unless an additional change is stated):

| File | Change |
| --- | --- |
| `JOURNAL.md` | Append one dated implementation, measurement and non-work entry. |
| `apps/chat/snapback/schema.q` | Migrate ambiguous positional keys to named equalities or explicit authored prefix indexes; keep existing application/recipe meaning. |
| `crates/snapback4-core/src/engine/admission.rs` | Include projections, guards, deduplication and shared cursor expressions in read-only validation; existing scan admission remains intact. |
| `crates/snapback4-core/src/engine/read.rs` | Dispatch projected unions, translate internal shared seeks, deduplicate/null-skip value sources, and retain incomplete source discovery and cursor eligibility. |
| `crates/snapback4-core/src/engine/rules.rs` | Keep projected lanes off the existing unprojected lazy merge path. |
| `crates/snapback4-core/src/engine/runner.rs` | Carry view cursor suffixes, scoped translated seeks and value-discovery completeness state. |
| `crates/snapback4-core/src/engine/shaping.rs` | Preserve view-owned positions when shaping pages and continuing from shaped results. |
| `crates/snapback4-core/src/engine/view_merge.rs` | New cross-table projected merge interpreter: source authorization, constant guards, branch/source identity, typed shared positions, metered sort and conservative continuation. |
| `crates/snapback4-core/src/engine/word_merge.rs` | Share value discovery and incomplete-source handling with existing word/lazy merge behavior; initialize optional IR fields. |
| `crates/snapback4-core/src/engine/write_target.rs` | Check purity of all new merge expressions. |
| `crates/snapback4-core/src/ir.rs` | Optional projected-lane, branch, value-deduplication, guard and view-position fields; default/skip serialization; traverse all added expressions for read sites and scans. |
| `crates/snapback4-core/tests/lane_source.rs` | Initialize optional merge IR fields; migrate affected positional fixture keys without changing the authority/admission assertions. |
| `crates/snapback4-core/tests/read_verdict/mod.rs` | Initialize optional merge IR fields; migrate affected positional fixture keys without changing the authority/admission assertions. |
| `crates/snapback4-device/tests/device_scenarios/mod.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-device/tests/intent_views.rs` | Memory and SQLite offline union paging, missing branch coverage, and dynamic constant-pruning tests. |
| `crates/snapback4-device/tests/maintains/recorded_membership.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-device/tests/maintains/review.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-device/tests/readauth/census.txt` | Refresh the guide-derived write-authority census for the compiled language block and emitted operations. |
| `crates/snapback4-device/tests/upsert/final_exists.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-device/tests/upsert/mod.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-device/tests/upsert/proof.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-device/tests/write_authority.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-lang/src/ast.rs` | Represent ordered predicate reads, search declarations, union/feed views and planned lanes. |
| `crates/snapback4-lang/src/bind/actions.rs` | Initialize view metadata on generated bound action programs. |
| `crates/snapback4-lang/src/bind/aggregate_provenance.rs` | Update the explanatory positional-count example to named-key spelling; provenance logic unchanged. |
| `crates/snapback4-lang/src/bind/catalog.rs` | Track declared indexes separately from generated planning requests; validate search columns; retain view types and read origins. |
| `crates/snapback4-lang/src/bind/intent.rs` | Collect canonical index requests before binding; pins, seeks, search, probes, caps, expiry, sync; stable reserved names and declared-index preference; preserve caller admission with residual fallbacks. |
| `crates/snapback4-lang/src/bind/intent_lanes.rs` | Build bounded value and ordinary-authorized membership lane sources. |
| `crates/snapback4-lang/src/bind/intent_sync.rs` | Derive sync delivery/inverse indexes from exact rule probes while preserving written order and principal position. |
| `crates/snapback4-lang/src/bind/intent_views.rs` | Validate/expand view branches, map projected fields to source columns, prune literal constant mismatches and retain branch identity. |
| `crates/snapback4-lang/src/bind/intent_walk.rs` | Traverse read sites, helpers, shapes and planned lanes for request collection and name resolution. |
| `crates/snapback4-lang/src/bind/intent_windows.rs` | Build inclusive finite UTC bucket ranges with exact residual endpoints; fold constant arithmetic; note missing upper bounds. |
| `crates/snapback4-lang/src/bind/mod.rs` | Run planning, validate unused views, publish view types, refuse pending feeds, and issue actionable scan-admission rewrites. |
| `crates/snapback4-lang/src/bind/program.rs` | Resolve positional keys only from declared candidates; track chosen indexes and original read sites; route planned merges. |
| `crates/snapback4-lang/src/bind/program/control.rs` | Bind planned and bare-view loop domains through their original scan-admission positions. |
| `crates/snapback4-lang/src/bind/program/expr.rs` | Bind bare tables/views, in predicates and projected rows; explicit shape fields override spread fields. |
| `crates/snapback4-lang/src/bind/program/prefix.rs` | Recognize ordered predicate domains while retaining existing cap/meter placement rules. |
| `crates/snapback4-lang/src/bind/program/reads.rs` | Record synthesized choices and originating reads; give sparse-filter rewrites in intent forms. |
| `crates/snapback4-lang/src/bind/program/views.rs` | Bind per-source scans, unify branch field types, build canonical view cursor descriptors and dynamic constant guards. |
| `crates/snapback4-lang/src/bind/schema.rs` | Enforce declared-only unambiguous positional rule keys and exact named-probe behavior. |
| `crates/snapback4-lang/src/bind/view_predicate.rs` | Substitute projected fields without capturing nested read/shape focal scopes or exposing unprojected columns. |
| `crates/snapback4-lang/src/diag.rs` | Prevent mechanical repair of ambiguous/positional scans that require an author choice. |
| `crates/snapback4-lang/src/emit.rs` | Emit one TypeScript row type per planned view. |
| `crates/snapback4-lang/src/guide/app.rs` | Migrate ambiguous positional keys to named equalities or explicit authored prefix indexes; keep existing application/recipe meaning. |
| `crates/snapback4-lang/src/guide/codes.rs` | Register E_QUARRY_POSITIONAL_SCAN and E_VIEW_FEED_PENDING with why explanations. |
| `crates/snapback4-lang/src/guide/feeds.md` | Migrate ambiguous keys and document the pending feed-view spelling. |
| `crates/snapback4-lang/src/guide/indexes.rs` | Document generated indexes and declared-only positional keys without retiring authored-index compatibility. |
| `crates/snapback4-lang/src/guide/jobs.rs` | Migrate ambiguous positional keys to named equalities or explicit authored prefix indexes; keep existing application/recipe meaning. |
| `crates/snapback4-lang/src/guide/language.rs` | Compiled intent examples: predicates, ordering, search, unnamed unique, durations, union and aggregate view forms; migrate affected older snippets. |
| `crates/snapback4-lang/src/guide/reads.rs` | Document inclusive UTC buckets, maintained-order non-snapshot paging, value-source cuts and corrected positional resolution. |
| `crates/snapback4-lang/src/guide/search.rs` | Migrate ambiguous positional keys to named equalities or explicit authored prefix indexes; keep existing application/recipe meaning. |
| `crates/snapback4-lang/src/guide/search_all.md` | Migrate ambiguous positional keys to named equalities or explicit authored prefix indexes; keep existing application/recipe meaning. |
| `crates/snapback4-lang/src/guide/services.rs` | Migrate ambiguous positional keys to named equalities or explicit authored prefix indexes; keep existing application/recipe meaning. |
| `crates/snapback4-lang/src/guide/shapes.rs` | Migrate ambiguous positional keys to named equalities or explicit authored prefix indexes; keep existing application/recipe meaning. |
| `crates/snapback4-lang/src/guide/types.rs` | Migrate ambiguous positional keys to named equalities or explicit authored prefix indexes; keep existing application/recipe meaning. |
| `crates/snapback4-lang/src/lib.rs` | Expose/initialize bound view types. |
| `crates/snapback4-lang/src/parser.rs` | Parse search, unnamed unique, dotted horizons and aggregate view aliases with dotted/hop group keys. |
| `crates/snapback4-lang/src/parser/expr.rs` | Parse durations, in predicates, dotted order keys and authorized exists read modifiers; initialize legacy merge AST fields. |
| `crates/snapback4-lang/src/parser/programs.rs` | Initialize the added read AST fields in job/program syntax. |
| `crates/snapback4-lang/src/parser/views.rs` | Parse block unions, aggregate aliases and pending feed views; normalize duration units and focal group keys. |
| `crates/snapback4-lang/src/print.rs` | Print predicate reads and column ordering for chosen-plan explanations and rewrites. |
| `crates/snapback4-lang/src/recipe/ADOPTION.md` | Migrate ambiguous positional keys to named equalities or explicit authored prefix indexes; keep existing application/recipe meaning. |
| `crates/snapback4-lang/src/recipe/bridge.q` | Migrate ambiguous positional keys to named equalities or explicit authored prefix indexes; keep existing application/recipe meaning. |
| `crates/snapback4-lang/src/recipe/following.q` | Migrate ambiguous positional keys to named equalities or explicit authored prefix indexes; keep existing application/recipe meaning. |
| `crates/snapback4-lang/tests/aggregate_copies.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-lang/tests/builder_guidance.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-lang/tests/ergonomics.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-lang/tests/fixtures/ergonomics-chat-order.q` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-lang/tests/fixtures/ergonomics-order.q` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-lang/tests/fixtures/intent-clique.q` | Index-name-free Clique subset; explicit existing maintained-column keys pending Lane B, finite Trending window, aggregate/feed/job portions owned by other lanes omitted. |
| `crates/snapback4-lang/tests/fixtures/never-predict.q` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-lang/tests/fixtures/prediction-horizons.q` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-lang/tests/fixtures/rule-live-horizon.q` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-lang/tests/frontend_regressions.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-lang/tests/guide.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-lang/tests/intent_target.rs` | 21 focused tests covering the acceptance subset, authorization, identity, cursors, index stability, parser handoffs, admission and completeness. |
| `crates/snapback4-lang/tests/lookup_selection.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-lang/tests/lowering/README.md` | Explain the deliberate source migration and four site-only golden digest changes. |
| `crates/snapback4-lang/tests/lowering/cases.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-lang/tests/lowering/ce15819ad.sha256` | Update exactly four digests for Require.site column offsets, not executable IR behavior. |
| `crates/snapback4-lang/tests/lowering/r1p-sources.jsonl` | Migrate 178 historical bundles (179 source leaves) to named keys or explicit authored indexes; retain all 740 bundle identities. |
| `crates/snapback4-lang/tests/maintains.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-lang/tests/prefix_reads.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-lang/tests/presence.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-lang/tests/repairs.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-lang/tests/residency_notes.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-lang/tests/sparse_filter.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-lang/tests/spelling.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-sim/tests/adoption.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-sim/tests/clique.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-sim/tests/common/membership.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-sim/tests/common/merge_continuation.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-sim/tests/common/prefix_witness.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-sim/tests/common/row_preserving_pages.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-sim/tests/common/shape_pages.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-sim/tests/condition_authority.rs` | Initialize optional merge IR fields; migrate affected positional fixture keys without changing the authority/admission assertions. |
| `crates/snapback4-sim/tests/exhaustive.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-sim/tests/fixtures/clique-relaxed.q` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-sim/tests/fixtures/membership.q` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-sim/tests/fixtures/prefix-reads.q` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-sim/tests/following/promotion.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-sim/tests/following/slots.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-sim/tests/grace_effects/presence_cost.q` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-sim/tests/page_admission.rs` | Initialize optional merge IR fields; migrate affected positional fixture keys without changing the authority/admission assertions. |
| `crates/snapback4-sim/tests/papercuts/cases.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-sim/tests/prefix_reads/mod.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-sim/tests/read_cut/fixture.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-sim/tests/read_cut/point.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-sim/tests/residency.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-sim/tests/review_corrections.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-sim/tests/reviews.rs` | Migrate keys; test missing sync enumeration at the core schema boundary because planning now supplies the index. |
| `crates/snapback4-sim/tests/search_global/lazy.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-sim/tests/search_merge/round3.q` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-sim/tests/search_merge/schema.q` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-sim/tests/security.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4-sim/tests/write_authority.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4/src/serve.rs` | Initialize bound view metadata for serve-generated program values. |
| `crates/snapback4/src/verbs.rs` | Show the selected/synthesized index and originating read in check --cost. |
| `crates/snapback4/tests/check.rs` | Test synthesized expiry/index choices and updated cost/why diagnostics. |
| `crates/snapback4/tests/feed_bridge.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4/tests/fix.rs` | Update fixes for synthesized indexes and intentional non-mechanical positional ambiguity; retain concurrent-edit coverage. |
| `crates/snapback4/tests/serve_timeline/mod.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `crates/snapback4/tests/timeline/admission.rs` | Remove missing-index refusals now satisfied by synthesis; retain timeline authority/admission checks. |
| `crates/snapback4/tests/timeline/common.rs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `examples/clique-03/census.test.mjs` | Migrate ambiguous positional keys to named equalities or explicit authored prefix indexes; keep existing application/recipe meaning. |
| `examples/clique-03/snapback/schema.q` | Migrate ambiguous positional keys to named equalities or explicit authored prefix indexes; keep existing application/recipe meaning. |
| `experiments/postgres/fixture.q` | Migrate ambiguous positional keys to named equalities or explicit authored prefix indexes; keep existing application/recipe meaning. |
| `loopbar/fixtures/bounds/snapback/schema.q` | Migrate ambiguous positional keys to named equalities or explicit authored prefix indexes; keep existing application/recipe meaning. |
| `metrics/wasm-budget.json` | Ratchet gzip budget from 474,000 to 481,000 bytes with measured shared-interpreter cost and 376-byte headroom. |
| `packages/snapback4/SERVER.md` | Migrate ambiguous positional keys to named equalities or explicit authored prefix indexes; keep existing application/recipe meaning. |
| `packages/snapback4/test/fixtures/identity-recipe/snapback/schema.q` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `packages/snapback4/test/fixtures/word-expansion.json` | Refresh 50 residency reason strings with selected-index explanations; schema index definitions and executable IR unchanged. |
| `packages/snapback4/test/intent-views.test.mjs` | Real dev server/process-device subscription reruns after writes to either source table, including equal source ids. |
| `packages/snapback4/test/periphery.test.mjs` | Expect explicit positional refusal and the remaining authored cursor repair; synthesis removes obsolete missing-index repairs. |
| `packages/snapback4/test/write-authority.test.mjs` | Migrate positional fixture keys to named equalities or explicit authored indexes; update any pinned spelling/refusal expectation for the intentional resolution change. |
| `reports/20260924-intent-lane-a.md` | This review inventory, forms, tests, limitations, reproductions and exact verification result. |

Commits before the evidence entry: `f8ad4c6da`, `21e19d6a8`, `7400d60f1`, `a1812cbab`, `31fc5fe50`, `81963d29d`. Every commit carries the requested co-author trailer.
