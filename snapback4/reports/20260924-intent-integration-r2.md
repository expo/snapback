LLP 3000.013 integration, round 2 — 2026-09-24

Branch `sb4-intent/integration`, worktree `~/sb4-intent/lane-i`. Round 1 ended
at `33669a7ae`; this round merges Lane A's final head `3562069d8` with
`git merge --no-ff`, recorded as `bca135b13`. Nothing pushed or published.

The merged commits are `d39220e88` (lane selectors and nullable ranges),
`b51f67bd0` (exact final probes, aggregate seeks and view cursors),
`86b88f4ae` (verification/design-stop report), and `3562069d8` (the supervisor's
table-order ruling, resolving that stop). All three new committed lane reports
and the external r5/r6/r7 reports were read before merging.

Merge conflicts and resolutions:

| File, relative to the repository root | Resolution |
|---|---|
| `llp/3000.013-quarry-states-intent.rfc.md` | Preserve the revision-2/3 review history and prepend the final table-order ruling. Keep A's table truncation and branch-aware view identity text. |
| `snapback4/JOURNAL.md` | Preserve the entire round-1 journal byte-for-byte as a prefix, then append all three A entries in their original order. |
| `snapback4/crates/snapback4-lang/src/bind/mod.rs` | Keep C's `catalog.feed_views = feeds` and run A's table-order normalization before planned-view expansion. Register aggregate planning. |
| `snapback4/crates/snapback4-lang/src/guide/language.rs` | Preserve F's rewrite, C's standalone Following block, compatibility examples and corrected prose. Remove the explicit role index; place A's compiled `intentIds` query in the existing intent example instead of restoring an obsolete duplicate block. |
| `snapback4/crates/snapback4-lang/src/guide/reads.rs` | Keep the predicate-read introduction and append A's explanation of table versus view ordering. |

`cargo build --workspace` passed after the merge. No engine conflict, feature,
test or diagnostic was removed. The guide still has four compiled language
blocks, including Following and legacy spellings.

Other merged changes, file by file, relative to `snapback4/`:

| File | Behavior |
|---|---|
| `crates/snapback4-lang/src/bind/intent.rs` | Normalize table order at intrinsic id; synthesize exact final-insert probe indexes in written order; invoke aggregate access-path selection. |
| `crates/snapback4-lang/src/bind/intent_aggregates.rs` | Choose a seek range for unpaged count/sum/exists without authored order, preferring finite ranges and canonical column order. Preserve explicit/page order and admission. |
| `crates/snapback4-lang/src/bind/intent_lanes.rs` | Do not add a nullable fallback for integer range sources. |
| `crates/snapback4-lang/src/bind/program/views.rs` | Preserve lane-dependent residual selectors and written literal-id view order; keep range sources out of nullable-list lowering. |
| `crates/snapback4-lang/tests/intent/aggregate_plans.rs` | Three tests cover capped/uncapped seek planning, authored/page order, and deterministic finite-range selection. |
| `crates/snapback4-lang/tests/intent_followup.rs` | Exact role-sensitive final probes, aggregate execution, unchanged unbounded-page refusal and literal-id view pagination. Integration adds the uncapped runtime variant described below. |
| `crates/snapback4-lang/tests/intent_nulls.rs` | Nullable ordered values, literal/dynamic/empty ranges, two authorized owners, mutations, word search and projections. |
| `crates/snapback4-lang/tests/intent_order.rs` | Identical table plans/cursors after id truncation, nested reads, and retained cross-branch view ties. |
| `crates/snapback4-device/tests/intent_views.rs` | Memory/SQLite reopen, nullable-owner order, literal-id cursors and heap charges for rejected large source rows. |
| `reports/20260924-intent-lane-a-delta-review.md` | Preserve A's selector/range evidence. |
| `reports/20260924-intent-lane-a-followup-review.md` | Preserve A's probe/aggregate/cursor evidence and historical design stop. |
| `reports/20260924-intent-lane-a-final-order.md` | Preserve the ruling and resolution of that stop. |

Cross-lane changes in this qualification commit:

| File, relative to `snapback4/` | Change and proof |
|---|---|
| `crates/snapback4-lang/src/guide/app.rs` | Remove `byConversationPrincipalRole`; the role-sensitive after-insert example compiles without it. |
| `crates/snapback4-lang/src/guide/reads.rs` | Remove the finite aggregate's former `by .at` workaround; the compiled example now uses inferred range seeks. |
| `crates/snapback4-lang/tests/intent_followup.rs` | Add `uncapped_digest_aggregates_seek_and_stream_without_authored_order`, reusing the capped fixture runner. With no cap, count/sum/exists return 2/22/true and examine at most two qualifying rows from 30 seeded rows. This exercises A's planner through D's admission and streaming path. |
| `crates/snapback4-sim/tests/intent_integration.rs` | Strengthen the target digest regression: both `daily` and `periodCount` must have exactly one metered message scan, index columns `(conversationId, tombstone, at, id)`, two equality pins, and inclusive-lower/exclusive-upper range bounds. A narrow query completes with zero under examined=20 despite 5,000 out-of-window rows. The original broad query still cuts to null/incomplete at that ceiling. |
| `crates/snapback4/tests/scale.rs` | Add the new language-card operation `intentIds` to the exhaustive classification expectation. Assert its sole scan uses `byId`, has no residual filter, and has a 21-row examined bound. The public, non-expiring 20-row page is correctly constant; no analyzer behavior changes. |
| `metrics/wasm-budget.json` | Append this round's unchanged measurement and reason; retain the 486,000-byte ratchet. |
| `JOURNAL.md` | Append one dated integration-round-2 entry after qualification. |
| `reports/20260924-intent-integration-r2.md` | This merge, file map and qualification record. |

No explicit role index remains in the guide cards or package README. The
57-test guide target passes with both role examples using synthesized indexes.
The README stays at 292/300 lines and retains its compiled activity union,
Following and two-bound Trending example. The previous stray-dot prose fixes
survive; the `by \.[a-z]` audit found only intended column syntax.

Target status, form by form:

`crates/snapback4-sim/tests/fixtures/intent-clique.q` already had the requested
digest spelling without `by .at`, so it needs no text change. The complete
fixture, including Following and Trending's `.at <= now`, compiles through
`check --cost --json`: 21 tables, 13 authored operations, zero diagnostics.
The five existing advisory notes remain visible: two `N_NO_HORIZON` notes,
`N_NO_CURSOR`, `N_MAINTAIN_SYNCED`, and `N_MAINTAINED_COLUMN_STREAM`.

| Form | Example and execution |
|---|---|
| Schema intent | `unique handle`, `search displayName, handle`, `expire at .expiresAt`, `sync to members[.conversationId]` all compile. |
| Planned Global | `view activity:` unions projected posts and reposts; equal source ids retain both events and nested card shapes. |
| Following | `view following: activity where .actor = viewer or exists follows[viewer, .actor]` runs shaped delivery, pagination, removal, unfollow/refollow and repost lifecycle. |
| Trending | `posts where .parentId = null and not .removed and .at > now - 24h and .at <= now last 10 by .likeCount, .at postCard` runs. |
| Profile/thread reads | `posts where .authorId = owner ... last 20 by .at after c` and `posts where .parentId = postId first 20 by .at after c` run. |
| Derived state | All nine aggregate views, including `view receivedLikes: count likes by .postId.authorId`, and inferred `likeCount: count likes` / `repostCount: count reposts` run together. |
| Search/history | `profiles matching q last 20 by .createdAt after c`, authorized message search and ordinal history with continuation run. |
| Insights/mutations | Seven calendar buckets and all totals are asserted; `createPost`, `setLike`, `setFollow` execute under source rules. |
| Digest seek/stream | `count(messages where .conversationId = c and .at >= s and .at < e and not .tombstone)` seeks and streams without `by`; hidden/expired/tombstoned rows do not enter totals. The job's extra sender/ordinal filters remain. |
| Sweep/once | `for p in profiles:` and `emit push { ... } once [p.principal, periodEnd]` run across SQLite reopen and produce no duplicate effects on rerun. |
| Exact final probe | `after insert <- exists members[roomId = .id, principal = .ownerId, role = 'admin']` needs no explicit index; non-admin insertion rolls back and admin insertion succeeds. |
| Table/view order | `t first 1 by .id, .at after c` matches `by .id`; `v first 1 by .id, .at after c` preserves later view keys. Both directions run. |
| Nullable membership | `t where .at in range(1, 3) first 10 by .at after c` and nullable value lists compile and page correctly. |

No target form is refused. The existing scale certificate still conservatively
classifies Following as growing work: one inbox scan, with stale entries bounded
by the meter. Page size is not a population-independent work bound.

Validation and measurements:

- Focused language integration tests: 103 passed (guide 57, followup 5,
  nullable 7, order 3, review 7, target 21, lane domains 3).
- Aggregate planner unit tests: 3 passed.
- Device view tests: 14 passed, covering Memory and SQLite.
- Scale certificate tests: 17 passed after the new guide operation was added
  to the exhaustive expectation, with its plan and work bound checked.
- Complete target simulator tests: 3 passed. The digest processes 67 profiles
  and 5,000 period rows in two chunks, K=64, zero retries, peak heap 312,580 B.
  The count's retained heap is 823 B; its authorized total is 4,949. Effects
  contain 4,899 unread messages for Alice and 4,949 for Bob, one chat each.
- WASM: 1,744,850 B raw / 485,005 B gzip, unchanged from round 1. Compiler-only
  fixes do not enter the web device artifact. Ratchet 486,000 B, headroom 995 B;
  no runtime meter change. Rust 1.97.0 / wasm-bindgen 0.2.127, no wasm-opt.
- `ref-check --verbose`: 504 LLP documents, 9,232 references in 25,524 files,
  zero errors and zero unchecked references. Whitespace checks pass and all
  changed source files remain below 1,500 lines.
- First full suite: **`== 1 failure(s) in 273 s`**, exit 1. Its only failed
  step was `cargo test`; its only failed test was
  `snapback4::scale::language_operation_classes`. Classification: **ours,
  integration expectation omitted the new compiled guide query**, not a
  product regression or baseline/environmental failure. The maps differed
  solely by `intentIds: Constant`. Reproduce before the correction with
  `cargo test -p snapback4 --test scale language_operation_classes`.
  After checking the intrinsic-id scan and its 21-row bound, update the list
  and keep assertions establishing why the output is intended. The isolated
  17-test scale target then passed. All 1,088 client tests passed, 10 skipped;
  no intermittent client failure occurred and no client rerun was needed.
- Final full suite: **`== 0 failure(s) in 262 s`**, exit 0. All 1,088 client tests passed, 10 skipped. No remaining integration, baseline or environmental failure; no intermittent client failure to rerun.

Scope and deviations: no design deviation or new open problem. The fixture's
already-correct digest is deliberately unchanged; execution-plan and runtime
assertions establish the requested behavior. A's historical table-cursor stop
is resolved by its final commit. Baseline failures were already corrected in
the earlier integration; no baseline snapshot or census expectation was changed
this round. No source authority, disclosure, durability or meter bound was
weakened. No push, publication or deployment was performed.

Evidence logs under `~/sb4-intent/`: `integration-r2-build-a.log`,
`integration-r2-lang.log`, `integration-r2-aggregate-unit.log`,
`integration-r2-device.log`, `integration-r2-target.log`,
`integration-r2-target-check.json`, `integration-r2-target-cost.log`,
`integration-r2-bun-install.log`, `integration-r2-wasm.log`,
`integration-r2-suite-first.log`, `integration-r2-scale.log`,
`integration-r2-suite.log`, `integration-r2-prose-audit.log`,
and `integration-r2-ref-check.log`.
