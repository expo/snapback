# Lane U: Following on a bounded device

Historical revision-2 implementation and measurement. Superseded by the
[revision-5 correction](../20260925-bounded-following-r1/REPORT.md), which keeps
owned events fully synced and specifies the withheld routing precedence.

2026-09-25 · LLP 3000.016 revision 2 · `sb4-intent/u-bounded-following`
Base: `a6bfd07ab`. Implementation commits: `ee4981e5b`, `70b4893a0`,
`aee7cc508`. No push or publication.

The four increments are implemented. The final complete suite exits 0:
**`== 0 failure(s) in 476 s`**. The whole-partition measurement improves
acquisition but **does not meet the 5× target**. The scoped design cannot
produce 5× fewer rows on this reader's partition, even if its four bounded
tables contribute zero rows. That counterexample is recorded below; no other
tables were bounded to make the target pass.

## Forms and behavior

Posts and reposts independently accept these acquisition forms, with their
existing public read and owner write rules:

| Form | Example | Meaning |
|---|---|---|
| Time horizon | `sync public last 1000 by .at` | Acquire the newest 1,000 rows globally, over exactly `(at, id)`. The compiler resolves the index. |
| Explicit time index | `by timeIndex: at, id` followed by `sync public last 40 by timeIndex` | The existing explicit-index spelling remains valid. Mapped time columns may have another name. |
| Online source | `online only` | Source cards are answered by the server. |
| Full source | `sync public` | Existing full acquisition remains valid. |
| Inbox page | `return following last 20 by .at after c` | Complete locally within the inbox floor without reading source cards. |
| Shaped page | `return following last 20 by .at after c { *, card: posts[.post] }` | An unheld card withholds the whole query and continuation. Online fallback uses the same `c`; offline returns `loading`. |
| Repost | `insert reposts { actorId: viewer, postId, at: now } if absent` | Prediction requires held original/event metadata and the removal probe, as well as the existing unique-pair absence proof. Otherwise it queues without rows. |

The compiled standalone program is in the feeds card; the language card also
compiles the bounded posts and online-only repost combination. The existing
`intent-clique.q` fixture is exercised by `following_view.rs`, with both sources
changed to `last 1000 by .at`. Its Following forms match the shared target;
the fixture already includes unrelated trending/profile/membership fixes.

The owned events take the posts acquisition setting, using `byTime` for a
horizon. The private inbox acquires the newest 1,000 copies for its reader
over `byReaderPage`. Follows and removal records remain fully synced. Floors
are fixed at acquisition and do not evict later arrivals. Follow backfill
still has its unchanged 1,000-event history window.

Full sync, a horizon, and online-only switch through the existing generation
adoption protocol: clear the device's acquisition, then snapshot again. The
server's event identities and inbox contents survive. The implementation
does not trim a device in place.

`check --cost` now includes lines such as:

```text
following following acquisition: global, non-sliding source floors; new arrivals accumulate
  posts: newest 1000 by (at, id) globally
  reposts: newest 1000 by (at, id) globally
  followingPosts: newest 1000 by (at, id) globally
  followingFeed: newest 1000 by (readerId, at, eventId, epoch, id) per reader
  follows and followingRemovedEvents: full sync; private edge epochs and work stay synced
  history: newest 1000 events per followed author, unchanged; acquisition never changes delivery
  cards: an unheld original withholds the whole query and continuation; retry original input online, loading offline or while a prediction is unobserved
```

## File map

Paths are relative to `snapback4/`.

| File | Change |
|---|---|
| `crates/snapback4-lang/src/bind/timeline.rs` | Admit the two additional acquisition choices; keep other shape and authority checks; derive events/inbox sync; classify implicit horizon inputs. |
| `crates/snapback4-core/src/engine/read.rs` | Flag an unheld Following source point read as query-unavailable. |
| `crates/snapback4-core/src/engine/local.rs` | Withhold data and cursor for unavailable interpreted/native queries, including a subsequent require/unwrap. |
| `crates/snapback4-core/src/engine/timeline.rs` | Require the original's live/removal probe when reposting. |
| `packages/snapback4/src/backend.ts` | Type the existing serialized timeline source mappings used by the client. |
| `packages/snapback4/src/local.ts` | Fence Following card fallback until predictions are observed; keep original input and offline loading, including online-only sources. |
| `packages/snapback4/src/local-reads.ts` | Move existing server-routing and predicted-table helpers out of `local.ts` to keep it at 1,500 lines. |
| `crates/snapback4/src/timeline_cost.rs` | Report acquisition, history window, and card fallback alongside unchanged metered delivery costs. |
| `crates/snapback4-lang/src/guide/feeds.md` | Put bounded Following in the standalone example; explain global floors, cards, prediction, adoption, and unchanged history. |
| `crates/snapback4-lang/src/guide/language.rs` | Compile bounded posts and online-only reposts in the Following example. |
| `crates/snapback4-lang/src/guide/codes.rs` | Update the existing `E_TIMELINE_SHAPE` explanation and concrete rewrite; no new refusal code. |
| `crates/snapback4-lang/tests/bounded_following.rs` | Three admission, floor, classification, and refusal regressions. |
| `crates/snapback4-device/tests/bounded_following.rs` | Eight real-store tests for coverage, prediction, source adoption, and inbox adoption. |
| `packages/snapback4/test/bounded-following.test.mjs` | Eight real wasm/native client cases for offline/online behavior and prediction. |
| `crates/snapback4/tests/following_view.rs` | Check the bounded target's acquisition certificate. |
| `crates/snapback4/tests/timeline/admission.rs` | Replace the old online-only posts/reposts refusal expectation with admission; follows still refuse it. |
| `crates/snapback4/tests/timeline_adoption.rs` | Rename every query in a copied guide program, including its new cards query. |
| `crates/snapback4-lang/tests/guide/definitions.rs` | Update the old full-sync-only diagnostic text assertion. |
| `crates/snapback4-lang/tests/guide/refusal_actions.rs` | Assert the new source rewrites and unchanged full-sync follows rule. |
| `packages/snapback4/test/helpers/timeline-recovery.q` | Read newest private copies over `byReaderPage`, matching the newly bounded inbox; retain recovery assertions. |
| `reports/20260925-bounded-following/measure.mjs` | Reproduce the real-browser acquisition on isolated copies of the completed scale replay. |
| `reports/20260925-bounded-following/inventory.json` | Exact whole-partition counts, row/wire bytes, timings, and artifact fingerprints. |
| `reports/20260925-bounded-following/REPORT.md` | This scope, validation, measurement, and deviation record. |
| `reports/20260925-bounded-following/*.log.gz` | Compressed logs for both full-suite attempts, the measurement, and reference validation. |
| `JOURNAL.md` | One dated append-only entry for the implementation and evidence. |

## New tests and what they prove

Language tests (3):

- `acquisition_combinations_preserve_audiences_and_use_the_posts_floor_for_events`
  compiles all nine full/horizon/online source combinations; checks public
  event sync, reader-private inbox, full follows/removals, and the original's
  held/horizon/server classification.
- `time_floor_uses_mapped_columns_and_explicit_index_spelling_still_works`
  checks renamed mapped time and compatibility with explicit indexes.
- `other_orders_bounded_edges_private_sources_and_expiry_still_refuse`
  checks id/wrong-column floors, bounded or online follows, private sources,
  and expiry. Refusals must name a site and a concrete rewrite.

Device tests (8, each scenario on memory and SQLite):

- `cards_*`: exact within-floor pages, no local data or continuation past an
  old-original repost, original-cursor server answer, metadata without cards,
  and a quiet author's card outside the global floor.
- `prediction_*`: unheld originals queue without rows; held originals predict;
  an author's own post and inbox still predict; the outbox survives reopening.
- `adoption_*`: all six directed switches among full, bounded, and online-only;
  generation advances, acquisition clears, source/events re-snapshot to the
  correct count, and server inbox contents remain identical.
- `inbox_*`: a pre-RFC 1,004-copy inbox becomes a 1,000-copy acquisition via
  generation change; its tail cannot claim exhausted history; switching back
  to full reacquires all 1,004 copies.

Client tests (8, each scenario on the actual wasm and native process device):

- Exact offline pages, original-cursor fallback, reactive online recovery,
  quiet authors, and required point reads that must withhold rather than
  falsely deny absence.
- A pending predicted post appears in metadata. A shaped page stays loading
  before acknowledgement and after acknowledgement but before sync
  observation; no server query runs until observation. Then the answer
  contains both the predicted post and the old original.
- Online-only cards answer online and become loading offline, while the
  inbox projection remains complete locally.
- Reposting an unheld original queues without a row; reposting a held original
  predicts when its unique pair is knowably absent.

The CLI certificate test checks every acquisition/window/fallback line above
against the bounded target. The 80 guide tests compile the affected examples
with no diagnostic or note. Existing timeline, recovery, authorization,
disclosure, metering, and model tests remain in the complete suite.

## Whole-partition scale measurement

Both modes use the completed scale replay in
`~/clique-cmp-20260925/lanes/astra-snapback4/scale-instance`, with reader
`u0500`, and a read-only SQLite backup shared between isolated before/after
copies. The action log is
`~/clique-cmp-20260925/instrument/fixtures/scale.log` (13,014,016 bytes;
SHA-256 `b26bf1ae8ccf2d64c8ca34bca6562b63a5174956a40c33c123aff8050b6abba9`).

Before uses the original application and packaged 0.4.1 CLI. After uses this
lane's production CLI with only the application's posts/reposts sync clauses
changed to `last 1000 by .at`; the compiler supplies the owned floors. Both use
the same newly built client/wasm in Chromium 151.0.7922.34 and a fresh browser
context with the real IndexedDB device. The production build uses the package's
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT` policy.

The measured interval is authenticated `createLocalClient` through completed
acquisition, excluding login, page load, and UI rendering. It includes the
instrumentation that counts snapshot rows. This is one descriptive paired
run on the shared Linux host, not the calibration's 42-second multi-route
browser flow. The server versions differ in other already-landed changes, so
the timing is not an isolated causal estimate of this lane alone.

Row bytes mean UTF-8 JSON bytes of each snapshot event's `data`; wire bytes
include the snapshot and catch-up envelopes. These are not IndexedDB file
sizes. Every sync table is included; zero-row tables are reported explicitly.

| Table | Before rows | After rows | Before row bytes | After row bytes |
|---|---:|---:|---:|---:|
| posts | 50,228 | 1,000 | 13,496,683 | 299,000 |
| reposts | 1,004 | 1,000 | 161,640 | 161,000 |
| followingPosts (events) | 49,228 | 1,000 | 7,796,444 | 167,006 |
| followingRemovedEvents (removals) | 0 | 0 | 0 | 0 |
| follows | 5,921 | 5,921 | 852,624 | 852,624 |
| followingFeed (reader inbox) | 24,555 | 1,000 | 7,938,537 | 327,458 |
| profiles | 1,008 | 1,008 | 357,825 | 357,825 |
| followingWork | 63 | 63 | 22,132 | 22,132 |
| followingEdges | 500 | 500 | 102,500 | 102,500 |
| recipients | 25,000 | 25,000 | 3,225,000 | 3,225,000 |
| likes | 5,008 | 5,008 | 826,312 | 826,312 |
| reactionCounts | 2,000 | 2,000 | 301,000 | 301,000 |
| reactions | 2,000 | 2,000 | 288,500 | 288,500 |
| replyCounts | 1,956 | 1,956 | 117,339 | 117,339 |
| followerCounts | 1,006 | 1,006 | 110,689 | 110,689 |
| followingCounts | 1,005 | 1,005 | 110,588 | 110,588 |
| members | 248 | 248 | 42,556 | 42,556 |
| conversations | 100 | 100 | 23,596 | 23,596 |
| messages | 500 | 500 | 127,606 | 127,606 |
| typing | 0 | 0 | 0 | 0 |
| **Whole partition** | **171,330** | **50,315** | **35,901,571** | **7,462,731** |

The actual event count is 49,228: 48,224 originals plus 1,004 reposts. The
2,004 reply posts do not produce Following events, explaining the difference
from the RFC's approximate event count.

| Metric | Before | After | Reduction factor |
|---|---:|---:|---:|
| Whole-partition rows | 171,330 | 50,315 | 3.405× |
| Snapshot row bytes | 35,901,571 | 7,462,731 | 4.811× |
| Sync wire bytes | 48,521,623 | 11,552,467 | 4.200× |
| Cold browser acquisition | 274,347.6 ms | 56,699.1 ms | 4.839× |
| Snapshot pages | 43 | 13 | 3.308× |

`recipients` dominates afterward: 25,000 rows and 3,225,000 row bytes
(49.7% of rows, 43.2% of row bytes). Nothing in this RFC bounds that table.

**Open target miss and concrete counterexample:** with all rows of posts,
reposts, events, and inbox removed from the measured partition, the unchanged
tables still contribute **46,315 rows**, exceeding `171,330 / 5 = 34,266`.
Thus no floor choice in this design can achieve 5× fewer whole-partition rows
for this reader. The chosen 1,000-row floors also fall short of 5× for bytes
and measured time. I stopped at the specified acquisition scope; changing
recipient or other application-table residency needs a supervisor decision.

Reproduce from `snapback4/` after building the package/wasm and production CLI:

```sh
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo build --profile production -p snapback4
node reports/20260925-bounded-following/measure.mjs
```

The script defaults to the source paths above and the cached 0.4.1 binary.
Overrides: `CLIQUE_SCALE_APP`, `CLIQUE_SCALE_LOG`, `SNAPBACK4_BEFORE_BIN`, and
`SNAPBACK4_BIN`. It keeps a stable backup in
`target/bounded-following-scale/snapshot.sqlite`, recreates its isolated
before/after copies, and rewrites `inventory.json`. It never writes the source
application/store. Authentication uses only the synthetic fixture credentials;
credentials and row contents are not included in evidence. The JSON records
hashes of the source backup, binaries, browser bundle, wasm, and Quarry files.

## Decisions, deviations, and limits

- The measurement target is unmet as quantified above. No design change was
  made to hide that result. There is no known unresolved functional test
  failure.
- The RFC gives a default M but no syntax for overriding an owned inbox floor.
  This implementation uses `HISTORY_WINDOW` (1,000) directly and introduces
  no new configuration surface.
- Whole-query withholding is scoped to point reads of materialized Following
  posts/reposts. Other horizon queries keep their prior coverage behavior.
  The client uses the compiled timeline mapping to scope its additional
  pending-write fence; applying it to every loading query regressed existing
  inbox-fetch behavior and was corrected.
- An acknowledged predictable write remains fenced until `observed_seq` is
  present. An outbox receipt alone cannot release the page. Existing answer
  revision invalidation also discards responses racing a local commit.
- Existing unique-pair absence and held event requirements still apply to
  reposts. With a horizon on reposts, an absent unique pair may itself be
  unknown; the mutation can queue even when the original is held. Positive
  prediction tests keep reposts full-synced to isolate original coverage.
- Adoption uses existing schema comparison, device reset, and snapshot code;
  no special path or in-place trimming was added. Tests cover both source
  changes and the upgrade of an old full inbox.
- No delivery/window/scheduling redesign, contract change, authorization
  relaxation, meter removal, package version change, push, or publication.
  The measurement uses a real browser; no iOS simulator qualification was run.

## Validation and every complete-suite failure

Final invocation: `scripts/test.sh` from `snapback4/`, exit 0,
**`== 0 failure(s) in 476 s`**. Every section passed, including 80 guide tests,
the 12 new Rust tests, 8 new wasm/native client tests, and the unchanged full
model counts. The main client process reports 1,480 passed, 10 existing skips,
0 failed; seven acquisition/server shards additionally report 34 passed.
The model process reports 78 passed, 0 failed. Skips are not counted as passes.
Log: [test-final.log.gz](test-final.log.gz).

The first complete invocation ended **`== 2 failure(s) in 553 s`** (two failed
suite sections, six failing tests). All are charged to this lane's integration
run rather than waived as baseline:

| Test | Classification and resolution |
|---|---|
| `timeline::admission_refuses_every_unsupported_bridge_shape` | Ours: obsolete expectation that online-only sources refuse. Updated only posts/reposts; follows still refuse. |
| `timeline_adoption::redefinition_refuses_atomically_and_delivery_keeps_running` | Ours: copied guide program duplicated the newly added cards query. Rename all copied query declarations. |
| `native process devices bridge an inbox fetch and clear it offline and on account switch` | Ours: the first pending guard applied to all loading queries. Scope it to Following source cards. |
| `web IndexedDB device bridges the two-device inbox fetch in useQuery and usePage` | Ours for integration accounting: browser execution context was destroyed in that run. The exact navigation cause was not isolated. The affected rerun and final suite passed; no environmental waiver. |
| `ready list reads survive account restoration, new chat acquisition and pending unread counts` | Ours: the same overbroad guard withheld unrelated count fallback. The scoped guard restores existing behavior. |
| `oversized historical timeline commit recovers by snapshot with pending writes on both hosts` | Ours: the old fixture read ascending `byReaderTime` while the new acquisition floor is on `byReaderPage`. Read newest copies using the latter; keep exact copy/recovery assertions. |

Log: [test-first.log.gz](test-first.log.gz). Targeted affected reruns also
passed before the final complete suite.

The provided baseline log ends `== 1 failure(s) in 276 s`, with four Rust
failures: `genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier`,
`uniform_word_expansion::search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots`,
`census::authoring_census`, and `w9b_why_operation_keeps_residency_and_cost_output`.
These are baseline failures, did not recur in either lane full run, and were
not changed or used as waivers. No remaining environmental failure.

The wasm is **1,776,065 B raw / 495,264 B gzip**, within the unchanged
496,000 B ceiling. `./ref-check --verbose` passes: 509 LLP docs, 9,288 refs in
26,135 files, 0 errors, 0 unchecked (before this evidence-only append).
`git diff --check`, package typecheck/build, release guard, and docs budget
pass. Every changed source file stays at or below 1,500 lines.
