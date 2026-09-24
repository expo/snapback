# Lane C — materialized Following views, 2026-09-24

Integration base: `2bbae4740` from `sb4-intent/integration`, fetched from
`/home/ccheever/sb4-intent/base`. The requested merge fast-forwarded cleanly;
all integrated lane behavior was retained. Branch: `sb4-intent/c-following`.
Implementation: `151b5d7af`; cost output: `49876e86c`.
No push, publication or migration.

## Built behavior

`FeedView` now binds to the existing timeline engine. Recognition inspects the
union projections and declared column/key types, not application names. It finds
an originals id, a reference back to that originals table, principal actors,
time columns, false/true repost indicators, and the viewer-or-followed predicate.
Branch order, comparison operand order and renamed source/projected fields do
not select a different strategy. A declared two-principal unique edge key gives
the positional probe its meaning; inferred indexes cannot supply it.

Every recognized mapping goes through the existing timeline admission. Public
sources, full public sync, owner write rules, immutable mapped columns, unique
pairs and the absence of expiry/horizons/maintained sources remain required.
Recognition grants no additional authority or disclosure. Owned-name collision
checks now include planned views as well as tables and other declarations.

The reader's single private inbox supplies the page. Its existing epoch and
public-tombstone predicates run before projection. Fields map to the view's names:
`id` is the event id, `post` the original post id, `actor` the event's actor,
`at` its time, and `repost` its kind. Subsequent named or inline shapes operate on
those fields normally. Original event ids remain the original card ids; repost
events keep independently minted event ids, including when application row ids
coincide across the two source tables.

No new delivery strategy or scheduler was added. Cursor semantics, private
partitions, pending-reader completeness, durable tasks, live dependency tracking
and prediction all use the existing timeline path. Own event copies predict;
follow and unfollow queue without prediction. The history window remains 50
synchronous / 1,000 total, with pre-follow backfill and post-follow delivery.

## Forms that compile and run

The exact supervisor target is committed at
`crates/snapback4-sim/tests/fixtures/intent-clique.q`; its bytes match
`~/sb4-intent/target-clique.q`. Following runs alongside its nine aggregate views,
maintained counts, Global, profile/thread/search reads and digest job.

```text
view activity:
  posts where .parentId = null and not .removed { post: .id, actor: .authorId, at, repost: false }
  reposts { post: .postId, actor: .actorId, at, repost: true }
view following: activity where .actor = viewer or exists follows[viewer, .actor]

query home(c: cursor ?):
  return following last 20 by .at after c activityCard
```

Inline shapes work too:

```text
return following last 20 by .at after c { *, post: posts[.post] postCard }
```

The standalone compiled feeds-card block and language card show the new form.
Existing `maintain feed: timeline` declarations and `feed[viewer] after c last 20`
reads retain their meaning and output fields; their regression suites pass.

## Engineering decisions and boundaries

- A supported activity union has exactly two branches and four projected roles
  (original reference, actor, time, repost flag), plus implicit `id`. These roles
  may have different names. Reposts must be unfiltered. Other structures refuse
  with new `E_VIEW_FEED_SHAPE`, a source site and concrete declaration rewrite.
  The old temporary `E_VIEW_FEED_PENDING` refusal is retired.
- A removal flag is optional. A negative top-level conjunct over a changing
  required boolean (`not .flag` or `.flag = false`) identifies it. Timeline
  admission still requires `bool default false` and the one-way transition.
  Repeated references to the same flag are deduplicated. Other predicate fields
  must be immutable. With no flag, the existing fourth mapping slot is empty;
  the engine does no flag lookup. Hard deletion of originals remains refused.
- Feed reads require an explicit descending page ordered by the projected time
  field. An unsupported order, key, filter or domain refuses with
  `E_TIMELINE_READ` and `following last 20 by .at after c` (using actual names).
  No implicit bounded page substitutes for an unbounded domain.
- The exact target's Trending query has only a lower time bound. Restoring its
  exact text preserves the planner's residual scan/note rather than silently
  adding an upper bound. That is outside Following's implementation.
- `check --cost` correctly reports **grows** for Following: stale epoch and
  tombstone candidates can consume the meter before 20 rows match. It has one
  direct inbox scan and zero merge lanes. The existing formatter always said
  `first`; it now uses `last` for descending scans. Its growth explanation names
  retired epochs as well as tombstones. This related diagnostic correction
  changes no runtime cost or ceiling.

No deviation from the requested design or remaining Following implementation
blocker. Existing wide-payload delivery tasks can still park on the heap ceiling;
this binding does not add adaptive chunk retries or alter that recorded limit.
Reproduce with `cargo test -p snapback4-lang --test timeline_background
 delivery_charges_large_edge_payloads_before_materializing_them -- --nocapture`
(on one shell line).

## File-by-file changes

Paths are relative to `snapback4/`.

| File | Change |
|---|---|
| `crates/snapback4-lang/src/bind/feed_view.rs` | Structural recognizer, located refusals, field/type mapping and view-read lowering. |
| `crates/snapback4-lang/src/bind/catalog.rs` | Holds authoring-only feed projection plans. |
| `crates/snapback4-lang/src/bind/mod.rs` | Recognizes feeds before owned-table expansion, admits them through timelines and publishes view types. |
| `crates/snapback4-lang/src/bind/program.rs` | Routes a feed-view read through its projection plan. |
| `crates/snapback4-lang/src/bind/intent.rs` | Removes the temporary pending-feed refusal. |
| `crates/snapback4-lang/src/bind/timeline.rs` | Includes view names in owned-name collisions; permits absent removal mapping while retaining all admission checks. |
| `crates/snapback4-core/src/engine/timeline.rs` | Skips removal-column lookup when a view has no removal flag. |
| `crates/snapback4-core/src/schema/timeline.rs` | Documents the optional removal mapping sentinel; no owned-table shape change. |
| `crates/snapback4-lang/src/diag.rs` | Routes E_VIEW_FEED_SHAPE to feeds. |
| `crates/snapback4-lang/src/guide/codes.rs` | Registers the new refusal and its why entry. |
| `crates/snapback4-lang/src/guide/feeds.md` | Following section's compiled view example, field contract and new refusal explanation. Other sections remain for the guide lane. |
| `crates/snapback4-lang/src/guide/language.rs` | Compiled Following view and shaped read replace the old featured declaration. |
| `crates/snapback4-lang/tests/fixtures/following-view.q` | Runnable compact view fixture with source mutations, raw and shaped pages. |
| `crates/snapback4-lang/tests/following_view.rs` | Six structural, lifecycle, paging, optional-flag and refusal tests. |
| `crates/snapback4-lang/tests/intent_target.rs` | Replaces the temporary pending-code expectation with the structural refusal. |
| `crates/snapback4-device/tests/following_view.rs` | Shared memory/SQLite proof of pages, persisted reopen, completeness, invalidation and prediction boundaries. |
| `crates/snapback4-sim/tests/fixtures/intent-clique.q` | Restores the full exact target, including Following and home. |
| `crates/snapback4-sim/tests/intent_integration.rs` | Adds full Following lifecycle; replaces direct repost import with an owner-authorized mutation. |
| `crates/snapback4/src/scale.rs` | Following growth explanation includes retired edge epochs. |
| `crates/snapback4/src/verbs.rs` | Cost output preserves descending scan direction. |
| `crates/snapback4/tests/following_view.rs` | Runs the exact target through text/JSON check --cost and asserts its verdict. |
| `JOURNAL.md` | Dated implementation/measurement/scope append. |
| `reports/20260924-following-view/report.md` | This report and reproductions. |
| `reports/20260924-following-view/evidence.log` | Focused and full-suite validation evidence. |

## Tests and what they prove

| Test | Proof |
|---|---|
| `viewer_pages_map_event_fields_then_apply_shapes_and_keep_pending_completeness` | Own visibility, deferred foreign delivery, exact descending multi-page sequence, reply exclusion, five view fields, nested cards, repost identity, removal, unfollow and pending refollow. |
| `recognition_uses_structure_including_renamed_projected_fields` | Renamed tables, mapped columns, view name and projected role names still compile and run. |
| `removal_flag_is_optional_and_immutable_filters_still_apply` | No removal column is needed; immutable parent selection still excludes replies. |
| `private_mutable_horizon_and_wrong_structures_refuse_at_the_declaration` | Private sources, missing owner authority, mutable mappings/filter columns, horizons, wrong edge keys/probes, invalid projections, filtered reposts and owned-name collisions cannot gain materialization. |
| `branch_and_predicate_order_do_not_choose_the_strategy` | Reversing union branches, OR operands and equality operands yields the same admitted timeline. |
| `unsupported_feed_read_order_has_a_located_rewrite` | Ascending or implicit-order reads refuse with the actual feed/time names. |
| `materialized_view_memory` / `materialized_view_sqlite` | Offline shaped pagination, restart, backfill completeness, replicated invalidation tables, immediate unfollow/removal and own prediction; follow/unfollow never predict. |
| `full_target_following_shapes_delivery_and_lifecycle` | Complete target's shaped home pages, exclusion of replies, event ids, post/repost/removal/unfollow/refollow/unrepost and completion after drain. |
| `full_target_check_cost_reports_one_inbox_and_meter_bounded_residuals` | Real CLI accepts the exact target and reports truthful text/JSON cost, one inbox scan, zero author merge lanes. |

The existing `target_queries_and_nine_derived_views_run_together` now creates its
same-id repost through a mutation: timeline sources deliberately refuse fixture
imports. It still proves both Global branches survive, and additionally checks
Following's independent event ids. No import fence was relaxed.

The rest of the integrated target tests still prove digest restart, authority,
streaming counts and once-key semantics. Existing timeline background, old
syntax, counted/uncounted oracle, reduced Clique, guide, planner and cost tests
were rerun. During development, test assumptions about prediction identifiers
and direct fixture imports were corrected; no runtime workaround was introduced.

## Governing context

The scoped llp-orient context is the binder, source admission, timeline transition,
view reads and their device/CLI surfaces. LLP 3000.013 §3.3 and §4 govern the
materialization shape and delivered-contents contract; §2.2 preserves declared
positional-key meaning; §9 governs cost claims. LLP 3000.007.003 §3.3 supplies the
retained event identities, one-way removal, independent repost lifetime and source
authority prerequisites, with its old promotion/cap behavior superseded by
3000.013 and the supervisor addenda. No new policy or migration is inferred.
The required guide updates are included. No further design hand-off is needed.

## Validation

Focused commands (run from `snapback4/`):

```sh
cargo test -p snapback4-lang --test following_view --test intent_target --test guide --no-fail-fast
cargo test -p snapback4-lang --test following_view --test timeline_background --test timeline_guide --test clique_03 --no-fail-fast
cargo test -p snapback4-device --test following_view
cargo test -p snapback4-sim --test intent_integration
cargo test -p snapback4 --test following_view --test scale --test scale_intent --test check --no-fail-fast
```

All pass. Existing measurement assertions remain 4 post writes for both five and
900 followers, and 61 first-page examinations for both five and 500 follows.
The reference check passes with zero errors or unchecked refs. Changed source
files are all below 1,500 lines. Bun's frozen-lockfile install passed after merge.

Required full `scripts/test.sh`, exit 0:

```text
== 0 failure(s) in 204 s
```

Log: `/home/ccheever/sb4-intent/lane-c-feed-view-test.log`.
Every suite step passed; no introduced, baseline or environmental failures.
The integration base had already corrected the original host baseline's stale
expectations; all of those tests pass here too. Client totals across the eight
processes: **1085 tests, 1075 passed, 0 failed, 10 existing skips**.

Wasm: **1,743,912 bytes raw / 484,496 gzip**, within the integrated, unchanged
**485,000-byte** ratchet. No runtime meter ceiling changed. The focused commands
cover 203 distinct test cases (including 55 guide and 68 CLI check cases); the
full suite also includes the committed new tests. `ref-check --verbose` reported
504 LLP docs, 9,227 refs in 25,499 files, zero errors or unchecked refs.

Only this report, its evidence and the journal append were completed after the
full run; the tested runtime and test code are the committed implementation.
