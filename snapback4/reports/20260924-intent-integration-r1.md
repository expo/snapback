# LLP 3000.013 integration, round 1 — 2026-09-24

Branch `sb4-intent/integration`, worktree `~/sb4-intent/lane-i`, starting at
`2bbae4740`. This round supersedes the previous integration report's pending
Following status. Nothing pushed or published. A's subsequent delta round
remains assigned to the supervisor's next integration request.

## Merges and resolutions

External final reports and each lane's committed reports were read before
merging. Every merge used `git merge --no-ff --no-commit`, followed by a merge
commit and successful `cargo build --workspace` before the next lane. G was
already an ancestor; its requested merge returned `Already up to date`, and
its workspace build also passed. No artificial empty merge was created.

| Lane / accepted head | Merge | Conflicts and resolution |
|---|---|---|
| D `eadb198d5` | `5646ae573` | Journal plus `engine/read.rs`: keep C's `metered_payload` branch while applying D's scratch-to-retained-row allowance handoff and removal of unused domain keys. Earlier input-coverage preservation combines automatically. |
| E `d778b9266` | `524d9f10f` | Journal only; keep all entries. Shared logout epochs, quota cleanup, restoration retry and cross-tab witness combine without code conflicts. |
| G `542df62f4` | Already included | No conflict or new commit; build passed. |
| A `dd0552d79` | `e753a6967` | Journal plus `engine/read.rs`: include `view_scan_active` in prepaid payload scans and retain the full fetched-source payload charge before projection. Preserve D's transient release, cursor reservation, scalar interruption and domain handoff, and C's timeline prepayment/filter continuation. Nullable membership and cursor changes combine automatically. |
| C `4e2e890e1` | `2fd58e8ba` | Journal only; A's intent planning combines automatically with structural Following recognition. C already contains the earlier integration. |
| F `827c0d752` | `cf803ffca` | Journal, `guide/codes.rs`, `guide/feeds.md`, `guide/language.rs`; details below. |

F's language-card prose and examples are the base. C's complete Following
program remains as an additional compiled block before F's final compatibility
block. Thus both the new view and historical timeline programs remain tested.
F's Global, Trending and aggregate-copy guidance remains; the historical
aggregate-copy program remains in F's legacy fixture. C's current
`E_VIEW_FEED_SHAPE` explanation replaces the deliberately retired
`E_VIEW_FEED_PENDING`, and F's aggregate-view wording survives. The Following
section added by C remains alongside F's rewritten later feed sections.
No active diagnostic or regression assertion was removed to pass a merge.

Every merged lane's journal text was checked as an ordered subsequence of the
integrated journal. Build logs: `~/sb4-intent/integration-r1-build-{d,e,g,a,c,f}.log`.

Detailed incoming file inventories: [D coverage](20260924-intent-work-r3.md),
[D retention](20260924-intent-work-r4.md), [E shared sessions](20260924-lane-e-grok-delta.md),
[E final](20260924-lane-e-final-delta.md), [A review 1](20260924-intent-lane-a-review-1.md),
[A review 2](20260924-intent-lane-a-review-2.md), [C binding](20260924-following-view/report.md),
[C delta](20260924-following-view/delta-review.md), [F guide](20260924-intent-guide.md).

## Additional cross-lane changes, file by file

Paths below are relative to `snapback4/`.

| File | Change and reason |
|---|---|
| `crates/snapback4-sim/tests/fixtures/intent-clique.q` | Keep C's restored complete target, including `view following` and `home`; restore the previously commissioned `.at <= now` endpoint on Trending. This endpoint is the only difference from the supplied target file. |
| `crates/snapback4-sim/tests/intent_integration.rs` | Keep C's complete Following lifecycle and owner-authorized repost mutation. Strengthen the composed target assertion: Bob's repost is shaped with Bob as actor and Alice as original author. |
| `crates/snapback4-lang/src/guide/language.rs` | Fix `recorded by .the engine` and `read it by .group`; state that Following's view is available. The merge preserves C's executable view block and F's complete compatibility block. |
| `crates/snapback4-lang/tests/guide.rs` | Expect four language blocks: running core, server extension, Following view and legacy compatibility. All remain compiled. |
| `packages/snapback4/README.md` | Reference map now names Following as `view following`, Global as a planned view and Trending as a predicate read. Add a standalone compiled activity-union/Following/finite-window Trending example under the whole model. Reflow prose without removing its wording or onboarding blocks: 292/300 physical lines. |
| `crates/snapback4-device/tests/readauth/census.txt` | Add exactly four reviewed `card/language/4` entries for the preserved compatibility block. No entries or read-rule records removed; 271 mutation occurrences and the same 49 distinct private write sites. |
| `metrics/wasm-budget.json` | Record the integrated artifact and justified 486,000-byte gzip ratchet. |
| `JOURNAL.md` | Append one dated round-1 entry with measurements, qualification and omissions. |
| `reports/20260924-intent-integration-r1.md` | This report. |

The `by \.[a-z]` audit covers all cards and README text, with code versus
prose/comments inspected. Only the two reported stray dots were defects;
actual column expressions remain unchanged. No guide Quarry example required
an execution workaround: the current code compiles every preserved example
and the new README example. F's two pre-existing, exact guide-note exceptions
remain; no new note exception was added. Every README Quarry block is silent.

The compact README feed declares an ordinary `score` field for its ranking
example. It makes no claim that this field is an engine-maintained like count;
the complete Clique target continues to use its maintained `likeCount`. This
keeps the separate feed example small and note-free without changing source
authorization or suppressing a maintained-column stream-cost note.

## Complete target status and executable forms

The restored target passes CLI `check --cost --json`: **21 tables, 13 authored
operations, zero diagnostics**. Five advisory notes remain: `N_NO_HORIZON` for
messages and profiles, `N_NO_CURSOR` for Trending, `N_MAINTAIN_SYNCED` for the
nine aggregate views and `N_MAINTAINED_COLUMN_STREAM` for posts. None is hidden.
The JSON is `~/sb4-intent/integration-r1-target-check.json`.

| Form | Running example/status |
|---|---|
| Schema intent | `unique handle`, `search displayName, handle`, `expire at .expiresAt`, `cap 50 by conversationId`, `sync to members[.conversationId]`; all compile. |
| Planned Global | `view activity:` combines post/repost projections; equal source ids survive both branches and nested card shaping. |
| Following | `view following: activity where .actor = viewer or exists follows[viewer, .actor]`; `return following last 20 by .at after c activityCard` now compiles and executes. |
| Trending | `posts where .parentId = null and not .removed and .at > now - 24h and .at <= now last 10 by .likeCount, .at postCard`; runs the finite-window plan. |
| Profile/thread pages | `posts where .authorId = owner ... last 20 by .at after c` and `posts where .parentId = postId first 20 by .at after c`; both run. |
| Derived views/columns | All nine views, including `view receivedLikes: count likes by .postId.authorId`, and inferred `likeCount: count likes` / `repostCount: count reposts` run together. |
| Search/history | `profiles matching q last 20 by .createdAt after c`; membership-authorized message search; ordinal history with continuation all run. |
| Insights | Nine aggregate reads and seven calendar buckets produce the asserted totals. |
| Mutations | `createPost`, `setLike` and `setFollow` execute under their source owner rules. Reposts in the test use an authorized mutation because timeline imports correctly refuse. |
| Streaming predicate | `count(messages where .conversationId = c and .at >= s and .at < e and not .tombstone)` returns the exact authorized total, or null/incomplete on a meter cut. |
| Sweep/once | `for p in profiles:` and `emit push { ... } once [p.principal, periodEnd]` complete across reopen and suppress duplicate effects on rerun. |
| Client | Existing `createApp`, `useAuth`, logout/refresh and `web-shell` forms retain their interfaces; final E regressions are included in qualification. |

Following's scale certificate correctly says **grows** because retired epochs
and tombstones can consume work before 20 matches. It has one inbox scan and
zero author merge lanes; the integration does not turn page size into a work
bound or completeness promise.

## Tests and measurements

Focused language run: **75 passed** — 57 guide, seven Following, seven planner
review and four nullable-membership tests. It compiles the new README block
without diagnostics or notes and preserves F's execution witnesses.

Focused simulator run: **nine passed**:

- `target_queries_and_nine_derived_views_run_together`: all derived/query forms,
  same-id Global branches and Following repost actor versus original author.
- `predicate_stream_and_target_digest_sweep_preserve_authority_restart_and_once`:
  67 profiles, 5,000 period rows, exact authorized count 4,949, hidden/expired/
  tombstoned/out-of-window exclusions, meter-cut null, restart and durable once.
- `full_target_following_shapes_delivery_and_lifecycle`: 65 delivered originals,
  replies excluded, shaped actor/post data, exact descending multi-page order,
  own repost identity, removal, unfollow, pending refollow, drain and unrepost.
- D's three coverage/cursor regressions preserve hoisted and saved-local unknown
  input coverage and detect the retained cursor's heap-refusal boundary.
- D's three retention regressions prove scratch-to-image handoff, no unused
  result keys, and unavailable totals when uniform capped aggregates are cut.

Target digest: **two chunks, K=64, zero retries, 310,936 B peak heap**. The count
reports **650 B retained heap**, not a peak. D's three large inner-domain rows
complete at **16,014,923 B peak**, below the unchanged 16,777,216 B limit;
the 16,370-row domain peaks at **4,484,226 B**.

WASM: **1,744,850 B raw / 485,005 B gzip**, Rust 1.97.0 / wasm-bindgen 0.2.127,
without wasm-opt. Previous integration: 1,743,957 / 484,640; delta **+893 raw /
+365 gzip** for the combined source-payload metering, scalar coverage, retained
domain handoff and Following runtime changes. Whole-artifact measurement, not
individual feature attribution. The artifact exceeds 485,000 by five bytes;
the next 1,000-byte ratchet is **486,000**, leaving **995 B**. No runtime ceiling
changes. Log: `~/sb4-intent/integration-r1-wasm.log`.

## Qualification and failures

The initial focused census run failed because preserving both language examples
adds the four compatibility-block occurrences listed above. Classified **ours,
stale integration expectation**; reviewed and corrected without changing any
authorization assertion. The first standalone WASM measurement exceeded the
artifact ratchet by five bytes; classified **ours, measured artifact growth**,
addressed through the documented ratchet. No other focused failure occurred.

Required full `scripts/test.sh`: **`== 0 failure(s) in 279 s`**, exit 0.
Every stage passed, including the rebuilt WASM at 485,005 / 486,000 B, docs
budget at 292 / 300 lines, builds, typechecks, fixtures and Rust/client tests.
Client shards total **1,088 passed, zero failed, ten skipped** in 162 seconds.
All four previously failing baseline areas remain green, including the
81-test readauth target and 68-test CLI check target. No integration, baseline
or environmental failure remains in this full run. Log:
`~/sb4-intent/integration-r1-suite.log`.

Neither historical intermittent client failure occurred in the full suite.
Both were nevertheless rerun alone on the merged tree and passed **1/1**:

```sh
node --test --test-name-pattern='W5c process: pending writes recover' packages/snapback4/test/acquisition.test.mjs
node --test --test-name-pattern='stopped full-release restore' packages/snapback4/test/release-activation.test.mjs
```

Logs: `~/sb4-intent/integration-r1-acquisition-rerun.log` and
`~/sb4-intent/integration-r1-release-rerun.log`. No test timing or outcome
assertion was changed. Their earlier scheduling counterexamples remain in
E's linked reports; neither reproduces in these unmodified isolated runs.

Reference audit passes with zero errors and zero unchecked references. Every
changed source file is at most 1,500 lines; the combined read implementation
is 1,361 lines. `git diff --check` passes. Only this report, the dated journal
append and final validation of their references followed the complete suite.

## Scope and remaining limits

No target form remains blocked. No authorization, disclosure, durability or
runtime meter was weakened. No new design or delivery scheduler was introduced.
The full target retains the previously commissioned upper bound; no other
target spelling was changed. A's later delta commits belong to the next round.

Inherited wide-payload Following tasks can park at the heap ceiling; they are
not copied without metering. Reproduction:
`cargo test -p snapback4-lang --test timeline_background delivery_charges_large_edge_payloads_before_materializing_them -- --nocapture`.
F's other compiler handoffs and existing note exceptions remain documented in
its report; Following's former pending-binding handoff is resolved here.

The existing lane-i worktree and local commit identity are retained. Native
builds use 12 Cargo jobs, 12 Rust test processes, no debug symbols and no
incremental cache; the suite chooses normal client parallelism on this host.
Bun frozen-lockfile install passed in `snapback4/`. No new browser/native-device
witness, provider delivery, performance score, package publication or push.
