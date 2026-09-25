# Lane U round 1: accepted revision 5

2026-09-25. Implements LLP 3000.016 revision 5, read in full from
`origin/main` at `f5efae87f5539dea539f75c55bb5eb97170523d2`, including its
review record and the final Astra/Grok reviews. The supervisor's accepted
RFC is not rewritten by this lane.

Implementation commits: `0945f88a5` and `c9075a5ba`. No push or publication.
This supersedes the revision-2 behavior and measurement in the previous
[Lane U report](../20260925-bounded-following/REPORT.md).

## Changes, file by file

Paths are relative to `snapback4/`.

| File | Revision-5 change |
|---|---|
| `crates/snapback4-lang/src/bind/timeline.rs` | Remove the derived event horizon/online residency. Owned events keep their template's full public sync. Post/repost inputs still classify from their actual sync; edge transitions remain server sites. |
| `crates/snapback4-core/src/engine/read.rs` | Crossing an inbox acquisition floor withholds the whole query. Coverage recognizes a meter stop at an actual candidate inside the floor, preserving a resumable prefix. |
| `crates/snapback4-device/src/call.rs` | Unavailable replies omit `next` as well as `data`; internal coverage metadata stays available to the client. |
| `packages/snapback4/src/backend.ts` | Type the existing timeline name, so the client can identify owned inbox reads. |
| `packages/snapback4/src/local-reads.ts` | Identify Following inbox/source dependencies and required online-only point reads; implement the shared withheld routing order. Ordinary online-only scans retain their existing behavior. |
| `packages/snapback4/src/local.ts` | Route unknown Following coverage and online-only cards before server-run and remembered-answer shortcuts. Offline, unobserved predictions, and held queries stay loading. Fallback uses original arguments; transport failure stays loading. No prior answer is retained during this fallback. Local-commit revision invalidation remains. |
| `crates/snapback4-lang/src/guide/feeds.md` | State full event sync, all withholding triggers and routing branches, meter-cut behavior, and necessary prediction conditions. |
| `crates/snapback4/src/timeline_cost.rs` | Report full event sync, withholding precedence, transport failure, and published meter/backfill/cleanup partials. |
| `crates/snapback4-lang/tests/bounded_following.rs` | Check full events for all nine source combinations; source/event/removal input classes; synced Work with follow/unfollow still `predicts: never`. |
| `crates/snapback4-device/tests/bounded_following.rs` | Update adoption and floor expectations; prove known event absence, successful prediction despite a newer repost event, edge nonprediction, and a meter prefix on both stores. |
| `crates/snapback4/tests/following_view.rs` | Update the bounded target certificate and assert the actual `check --residency --verbose` output still says `setFollow: predicts: never`. |
| `packages/snapback4/test/bounded-following.test.mjs` | Add ten real wasm/native cases covering routing, inbox floors, meter prefixes, and a response/admission race; strengthen existing online-only behavior and no-next assertions. |
| `reports/20260925-bounded-following/REPORT.md` | Mark the old revision-2 record superseded without changing its historical measurements. |
| `reports/20260925-bounded-following-r1/measure.mjs` | Reproduce whole-partition before/after acquisition with full events and record storage format and the main revision checked for lane V. |
| `reports/20260925-bounded-following-r1/inventory.json` | Exact measurement and source/binary/browser/Quarry fingerprints. |
| `reports/20260925-bounded-following-r1/REPORT.md` | This round's decisions, test evidence, inventory, and limits. |
| `reports/20260925-bounded-following-r1/*.log.gz` | Compressed validation and measurement evidence. |
| `JOURNAL.md` | One dated append-only entry for this correction. |

## Forms and routing

No syntax was added. These existing examples compile and run:

- `sync public last 1000 by .at` on posts/reposts: source acquisition is
  globally bounded, but owned events remain fully synced.
- `online only` on posts/reposts: card reads enter withholding before generic
  server routing; writes to that source do not predict.
- `return feed last 200 by .at after c`: a full page ending at the inbox floor
  is data with a continuation; its next page is withheld.
- `return feed last 201 by .at after c`: with only 200 known copies remaining,
  the whole page is withheld rather than publishing the short prefix.
- `return feed last 20 by .at after c { *, post: posts[.post] }`: an unknown
  source card withholds the whole query.
- `query heldCards(c: cursor ?) held:` followed by the shaped read: an unknown
  page stays loading even online, with no server dispatch.

All withheld public results are exactly `{ loading: true }`, without `data`
or `next`. Routing checks offline, then any `predictable === true` outbox
entry with `observed_seq == null`, then `held`, before calling the server with
the original arguments. A queued nonpredictable follow/repost does not fence
fallback. Server transport failure cannot recover an older remembered answer.

A known null on a full source remains null data. A meter cut above the floor
remains partial data with its continuation; actual scanned position determines
coverage, not the nominal range end. Pending backfill/cleanup keep their
existing partial-data meaning. Heap and scalar exhaustion remain unavailable.
No authorization, disclosure, durability, delivery, or meter policy was relaxed.

## Tests

The focused Rust run passes all 13 tests: 3 language tests and 10 device tests.
The device cases run on memory and SQLite; two new cases prove that full event
sync preserves both positive prediction and `FEED_POST_NOT_FOUND` for a held
reply excluded from originals. The inbox cases now publish exactly 1,000 known
copies in full pages and then withhold; a scan exhausting examination before
that floor stays partial with a cursor. Adoption still runs every directed
switch among full, bounded, and online-only source acquisition, keeping all
owned event rows, plus the old full-inbox upgrade and reverse adoption.

The client file passes 18 tests, nine scenarios on each actual wasm and native
process device. It covers every trigger and routing branch:

| Scenario | What it proves |
|---|---|
| Original-cursor cards and quiet authors | Held pages work offline; old cards withhold; online recovery reuses the original cursor. |
| Pending own post | No fallback before acknowledgement or while acknowledged but unobserved; it resumes after observation. |
| Online-only originals | Cards never recover remembered data offline; an ordinary server scan preserves its prior contract. |
| Repost prediction | Unheld originals queue without rows; held originals can predict. |
| Held cards and transport failure | Held queries never dispatch, and failed fallback stays loading. |
| Online-only repost cards with synced posts | The server-run shortcut cannot bypass the own-post fence, including after acknowledgement. |
| Response racing prediction admission | Local-commit invalidation discards an answer obtained before a predicted row was admitted. |
| Repost horizon miss/full-source null | Any horizon point miss withholds, while a known full-source null remains data. |
| Inbox floor and meter prefix | A real 1,204-copy inbox acquires 1,000; full boundary pages publish, crossing pages withhold; offline/pending/held/server/transport paths all agree; a nonpredictable follow does not fence; a meter prefix remains partial. |

All 80 guide tests pass. The CLI certificate checks pass, including follow's
printed `predicts: never`. The complete suite and exact measurement are
recorded below.

## Measurement method

The action log, reader (`u0500`), stable read-only source snapshot, and row-byte
accounting match the prior measurement. The source is the completed replay at
`~/clique-cmp-20260925/lanes/astra-snapback4/scale-instance`; the fixture is
`~/clique-cmp-20260925/instrument/fixtures/scale.log`. Both modes start from
isolated copies of the same cached SQLite backup. No source store is mutated.

Before uses the original application and packaged 0.4.1 server. After uses the
revision-5 production server, posts/reposts horizons of 1,000, the private inbox
floor of 1,000, and fully synced owned events. Both use the same current client
and wasm, with a fresh Chromium context and real IndexedDB. The interval is
from authenticated `createLocalClient` to completed acquisition, excluding
login, page load, and UI rendering. Row bytes are UTF-8 JSON of snapshot row
images; wire bytes include envelopes. This is a single descriptive paired run
on a shared host, not an isolated causal latency estimate or the calibration's
multi-route UI flow.

Lane V had not landed at measurement start: a fresh fetch still had main at
`f5efae87f5539dea539f75c55bb5eb97170523d2`; the entire diff from `a6bfd07ab`
contained the RFC/reviews and lane W, with no client storage changes. This run
therefore uses the existing IndexedDB format. No packed-format measurement is
claimed.

Reproduce from `snapback4/` after the package and wasm builds:

```sh
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo build --profile production -p snapback4
node reports/20260925-bounded-following-r1/measure.mjs
```

The harness accepts `CLIQUE_SCALE_APP`, `CLIQUE_SCALE_LOG`, `SNAPBACK4_BEFORE_BIN`,
and `SNAPBACK4_BIN`, keeps the stable backup in `target/bounded-following-scale`,
and rewrites this directory's inventory. Its storage format and main-check
labels can be set with `LANE_U_STORAGE_FORMAT` and `LANE_V_CHECKED_MAIN`.

## Validation and failures

The round's only complete `scripts/test.sh` invocation, from `snapback4/`,
exits 0: **`== 0 failure(s) in 481 s`**. Every section passes, including all
80 guide tests, the complete Rust suite, fixture tests, all client tests, and
the full model counts. The main client process reports 1,490 passes, 10
existing skips, and zero failures; its seven acquisition/server shards add
34 passes. The model process reports 78 passes, zero failures. No tests were
removed or waived. Log: [test-final.log.gz](test-final.log.gz).

The initial focused TypeScript check failed with `TS2322`: the new loading
object inferred `nextExpiry` as only `null`, while the shared router can return
a numeric expiry. This was **ours**, fixed with the explicit `number | null`
type. Typecheck/build were repeated successfully. The focused Rust, guide,
certificate, and client runs had zero failures. The narrow online-only routing
check also passed all four actual wasm/native cases after adding the ordinary
server-scan control. The complete client run includes that final control.
There are no unresolved baseline or environmental failures. The supplied
baseline's four Rust failures did not recur and were not used as waivers.

`./ref-check --verbose`: **509 LLP docs, 9,291 refs in 26,137 files, 0 errors,
0 unchecked** (before the evidence append). Wasm: **1,776,336 B raw /
495,355 B gzip**, below the unchanged **496,000 B** ceiling. Production build,
package typecheck/build, docs budget, and release guard pass. Every changed
source file remains at or below 1,500 lines; `local.ts` is 1,497 lines.

No runtime design deviation from revision 5 is known. M remains the specified
1,000 default; no override syntax was invented. The previous derived event
floor is removed. This round adds no syntax, diagnostics, contract changes,
ceiling increases, delivery/window changes, or publication. The one remaining
qualification limit is the scale target, quantified in the inventory below;
packed IndexedDB was unavailable on main when measured.

## Whole-partition inventory and result

| Table | Before rows | After rows | Before row bytes | After row bytes |
|---|---:|---:|---:|---:|
| posts | 50,228 | 1,000 | 13,496,683 | 299,000 |
| reposts | 1,004 | 1,000 | 161,640 | 161,000 |
| followingPosts | 49,228 | 49,228 | 7,796,444 | 7,796,444 |
| followingRemovedEvents | 0 | 0 | 0 | 0 |
| follows | 5,921 | 5,921 | 852,624 | 852,624 |
| followingFeed | 24,555 | 1,000 | 7,938,537 | 327,458 |
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
| **Total** | **171,330** | **98,543** | **35,901,571** | **15,092,169** |

| Metric | Before | After | Reduction factor |
|---|---:|---:|---:|
| Rows | 171,330.0 | 98,543.0 | 1.739× |
| Row bytes | 35,901,571.0 | 15,092,169.0 | 2.379× |
| Wire bytes | 48,521,623.0 | 22,236,578.0 | 2.182× |
| Cold browser acquisition (ms) | 281,263.9 | 117,812.5 | 2.387× |

**The 5× target is unmet.** Owned events (`followingPosts`) dominate afterward:
49,228 rows and 7,796,444 row bytes (50.0% of rows,
51.7% of row bytes). Recipients are next, at 25,000
rows and 3,225,000 row bytes. Events are 48,224 originals plus 1,004 reposts;
the 2,004 replies in posts do not produce Following events.

**Concrete counterexample:** even deleting every posts, reposts, and inbox row
from this partition leaves **95,543 rows / 14,304,711 row bytes**. A 5× reduction
would require at most **34,266 rows / 7,180,314.2 row bytes**. Therefore neither
5× fewer whole-partition rows nor 5× fewer row bytes is attainable through the
three floors this accepted design permits. No other table's residency was
changed to manufacture that target. This is the remaining open qualification
problem; the reproduction above measures it directly.

The real-browser time improvement is 2.387× in this paired run. Packed
IndexedDB was still not merged in the final availability check (main remained
`f5efae87f`), so that additional measurement could not be performed. This is
recorded as an unavailable dependency, not a packed-format performance claim.

There are no known unresolved implementation failures. Measurement evidence:
[inventory.json](inventory.json) and [measurement.log.gz](measurement.log.gz).
