# Clique 0.3 integration

2026-09-23 · `sb4-03/integration` · engine `dced7a7914` above
`36f0048137` · black M5 Max (18 cores, 128 GB).

The requested F1 + F2 + F3 application is admitted. The reduced and single
full-fixture product runs pass, including independent models, populated-store
adoption, native process restart and the published-0.2.33 device fence. The
historical absolute dense-reader latency comparison remains qualified below;
no overall absolute-latency envelope pass is claimed.

## Blocker found and resolved

On `36f004813`, putting `likeCount: count likes by postId` on the posts mapped
by `maintain feed: timeline` produced `E_MAINTAINED_COLUMN` at schema.q:19.
The two forms admitted separately but not together. The lane stopped without
an application workaround. The supervisor ruled the exclusion too broad and
committed **`dced7a791`** on this branch.

Maintained columns now exclude only timeline-owned tables as parents or
sources. Mapped application tables remain ordinary parents and sources.
A parent mirror is not a source write and does not enter a timeline
transition; delivery copies event IDs, authors and times, never parent
fields. `refuse_timeline_write` protects only owned tables. The supervisor's
`maintained_columns_compose_with_mapped_timeline_tables` test checks a mapped
card's vote, mapped repost contribution, unchanged owned rows on mirroring,
and removal not being a vote.

Rebuilding passed. The app's `snapback4 check --json` exits 0 with no
diagnostics. It emits `N_MAINTAINED_COLUMN_STREAM`, correctly identifying
the cost of streaming a 4,000-byte parent image. Follow and unfollow are
classified as never predicting because their count input is online-only.

## Application and census

[The app](../examples/clique-03/snapback/schema.q) has **134 physical Quarry
lines, 119 nonblank/noncomment lines**. It declares Following with
`size authors 1008, edges 5921`, replies outside that mapping, cursor-paged
threads, `posts.likeCount`, one 25-hour-lane Trending merge, both received
counts and both daily variants. Daily variants mean **post day**, as requested;
they do not implement the benchmark's distinct like-arrival-day activity.

The [source census](../examples/clique-03/census.test.mjs) fixes each table's
columns, the write targets, exact like insertion and single-merge ranking:

| Mechanism | Count |
|---|---:|
| Application source tables | 6 |
| Application-maintained projection tables | 0 |
| Copied attribution fields | 0 |
| Verification clauses | 0 |
| Backfill or repair jobs | 0 |
| Feed helper calls | 0 |
| Zero-like fill | 0 |

Scope is this Quarry backend and its integration harness, not a new frontend
or the benchmark's messaging/media features. The test-only separate-count
control prices the requested alternative; it does not alter the application.
Schema SHA-256: `07369b217b2e0d030bc9ae2cd12d5084130d9d169d4586eef44a9cb0fd626dc4`.
The only tracked-file changes outside the new app/test/report are the language
crate's test-only device dependency and its lockfile entry. No engine
implementation or LLP is changed.

## Fixture and independent oracle

The harness reads the committed starter segments and `scale.log` from
`benchmarks/fixtures/social-messenger/`, version `0.2.2-m8`, verifying SHA-256
`b26bf1ae8ccf2d64c8ca34bca6562b63a5174956a40c33c123aff8050b6abba9`.
Every social write goes through an application mutation, with the log principal
and client-minted IDs. There is no row import. Arrival time advances one second
per log action; documentary timestamps are not used as authoritative time.

The full social projection has 1,008 profiles, 5,921 edges, 48,224 originals,
5,008 likes, 2,004 replies and 1,004 reposts. The harness asserts the named
5-follow sparse reader, 500-follow dense reader, celebrity follower, and the
900-followed celebrity's 200 posts. Registration uses the fixture principal
as its display name. Profile editing, chats, messages, reactions and media are
explicitly outside this backend's requested scope.

The default reduced projection keeps starter accounts, scale users 1–62,
500, 900 and 901, the surviving edges, five posts per scale author, and
contributions whose parents survive. It crosses promotion's 51-follower
threshold. Both modes add 45 reverse-inserted, equal-timestamp replies and
32 ranking parents covering zero likes, ties, exact 24-hour boundaries and a
future post. These additions are reported separately from fixture conformance.

The independent model stores source relationships, event publication mode and
the contract's delivery window. It never reads engine projection tables to
construct its expected answers. Every Following cursor page for all three
readers and every Trending cursor page is compared, including joined card
fields. Received likes, replies and post-day variants are checked for every
profile. Thread continuation is compared through all replies. Lifecycle
checks also cover repeated reposts, original removal with surviving reposts,
unlike-to-zero, unrepost and deferred cleanup.

## Adoption and restart

The initial generation omits `likeCount`, its ranking index/query, and both
received-reply maintains, so existing replies have no captured post-attribution
path. It is populated first. A device acquires that generation, the server
activates the complete app, and the device adopts and reacquires. The test
requires zero activation row events, checks every acquired post's count and
compares local Following, Trending and thread answers with the server.
Received aggregates remain online-only and are checked on the server against
the independent model.

A native device queues a post, like, reply, unfollow and follow offline.
Posting must predict; both edge operations must queue without predicted rows.
The admitting CLI process exits, and a second process reopens the same SQLite
store, preserving all five intents and the visible pending post. Reconnection
settles each write and applies its stream. The outbox empties and device
answers equal the server. Unfollow precedes follow to respect the already-full
5,921-edge cap.

## Measurement method

Crate tests use Cargo's repository test profile and an in-memory SQLite engine.
Seeding time includes compilation/admission inside the test, log parsing,
operations, model updates and targeted cases; it excludes Cargo build time.
Store size is SQLite `page_count × page_size`, including indexes, partition
logs, commits and attribution. It is not an fsync throughput measurement.

Following uses 3 warmups and 20 serial local-engine calls; p95 is sorted sample
19. The census-shaped app joins a post and two profiles per event. The recorded
recipe baseline in `20260922-f3a-timeline.md` examined 42 sparse/dense rows and
85 celebrity-reader rows without those three card joins. The test requires
current examinations within 3× that recorded envelope; absolute latency
comparisons must retain the different query shape and shared-host conditions.

Acquisition bytes are compact JSON snapshot page envelopes (1,000-row pages),
including coverage metadata, measured while applying them to a native device.
The complete-app measurement starts a new full snapshot after adoption clears
old images; its request/response bytes are the same as a cold device's. Its
elapsed time includes the subsequent local-answer and all-parent-value checks.
Stream amplification includes compact JSON stream envelopes and the like's
own event; the aggregate-event bytes are also reported separately. It measures
real stream events from this composition, not a proxy parent update. No
HTTP/TLS framing or compression is included.

## Correctness results

| Full-fixture check | Result |
|---|---|
| Pack social projection | Exact counts; all 63,169 social mutations admitted |
| Sparse Following (`u0005`) | 261 events, 14 pages; independent model agrees |
| Dense Following (`u0500`) | 24,555 events, 1,228 pages; independent model agrees |
| Celebrity-reader Following (`u0901`) | 433 events, 22 pages; independent model agrees |
| Trending | 24,130 in-window parents across all cursor pages; zero likes and time/ID ties agree |
| Received counts | Four values checked for each of 1,008 authors; independent model agrees |
| Thread | 46 replies before offline write, 47 after; 45 share one timestamp; cursor continuation agrees |
| Adoption | Generation 1 → 2; zero activation row events; all device parent counts and three local query answers agree |
| Pending/restart | Five intents persisted across two native processes; posting predicts, edge writes queue; settlement and subsequent models pass |
| Removal/cleanup | Duplicate repost is idempotent; repost survives original removal; unlike reaches zero; unrepost and engine purge pass |
| Published 0.2.33 | Native refuses before creating a store or prediction; WASM constructor refuses |

Following and counts are checked again after pending-write settlement and
removal/cleanup. Final model totals are 48,257 parents, 5,029 likes, 2,050
replies and 5,921 edges, including the explicitly added cases. Trending then
has 24,131 in-window parents. No full seed was repeated.

## Measurement table

| Measure | Full-fixture result |
|---|---:|
| Seeding and model construction | 113.662 s |
| Entire serial fixture test | 137.330 s |
| SQLite allocated size after adoption | 731,238,400 B (697.36 MiB) |
| Physical stored rows after adoption | 420,549 |
| Prior-generation cold acquisition, sparse reader | 113,997 rows / 19,524,910 JSON B / 1.997 s |
| Complete-app acquisition, sparse reader | 113,997 rows / 20,307,039 JSON B / 2.185 s |
| Populated-store activation | 12.464 s; 0 row events |
| Following sparse: examined / p95 | 102 / 0.218208 ms |
| Following dense: examined / p95 | 102 / 0.320333 ms |
| Following celebrity reader: examined / p95 | 145 / 0.270834 ms |
| Dense/sparse latency ratio | 1.468× (≤ 3×) |
| Celebrity/sparse latency ratio | 1.241× (≤ 3×) |
| Per-like stream, 500-byte body: column / separate count | 939 / 439 B (2.139×) |
| Per-like stream, 4,000-byte body: column / separate count | 4,439 / 439 B (10.112×) |
| Aggregate event alone, 500-byte body: column / separate | 639 / 139 B |
| Aggregate event alone, 4,000-byte body: column / separate | 4,139 / 139 B |

Every measured like emits exactly two stream events: the like plus its parent
or separate count row. It emits no timeline event. At the full envelope,
public application data dominates acquisition: a 20-row feed page is not a
20-row device partition. These byte observations are for native JSON protocol
pages, not browser transport or gzip transfer sizes.

Comparison to the recorded recipe's raw event query:

| Reader | Recipe examined | App / recipe examined | Recipe p95 ms | App / recipe p95 |
|---|---:|---:|---:|---:|
| Sparse | 42 | 2.429× | 0.0852 | 2.561× |
| Dense | 42 | 2.429× | 0.0822 | **3.897×** |
| Celebrity | 85 | 1.706× | 0.2204 | 1.229× |

Examinations and the requested reader-scaling ratios are within 3×. **The
absolute dense p95 is above 3× the historical recipe number.** That old query
returned events without the app's three joins; it also ran under 71.16/66.27
one-minute starting/ending load. This is a reported comparison, not a matched
query or matched-load regression attribution. No engine defect was inferred
from it, and no latency gate was silently relaxed. The full app measurements
are not publication or network-latency qualification.

### Combined device WASM

Both source builds use the unmodified existing `build-wasm.sh`, Rust 1.97.0,
wasm-bindgen 0.2.127 and wasm-opt 132 available on PATH. The current artifact
contains all combined forms. The baseline was freshly extracted with
`git archive c842dbaa5 snapback4` and rebuilt serially using the warm Cargo
cache. After the baseline build, the shared top-level WASM output still
named the baseline despite a fresh-looking Cargo invocation. Cleaning only
the device crate's WASM build artifacts and rebuilding restored the current
artifact with the exact original hash; a current-WASM constructor also
accepted the full app's generation-2 backend. No source repair was needed.
The published artifact is the npm package's actual WASM, checked against
the SHA-256 established by the integrity-verified fence run.

For comparable transfer bytes this table recompresses every artifact using
Apple gzip 479 with `gzip -n -9`, excluding filename/mtime headers. The build
script uses ordinary `gzip -9`, adding 25 bytes: current 473,116 B, baseline
443,551 B. The unchanged 474,000-byte build ratchet passes with 884 B headroom.
The fence test's Node zlib diagnostic is a different compressor and is not
mixed into this comparison.

| Artifact | Raw B | Gzip B | Current delta raw / gzip |
|---|---:|---:|---:|
| Published 0.2.33 | 1,599,837 | 443,422 | +107,753 / +29,669 |
| Pre-program `c842dbaa5` | 1,599,837 | 443,526 | +107,753 / +29,565 |
| Current `dced7a791` | **1,707,590** | **473,091** | — |

SHA-256: current
`e0088029dde19c22fdd2b5b8779c28b5a62de9d2b81aaae0c3d4de1db5e02eae`;
pre-program
`10697d6577ccc3286ed0cd5c8ec71aa375da73c5a06f4b84c35ee90cb0e16b5c`;
published
`7bd0e119cedcc9ff7eababb71023adf84e59e9978130a51705d0ddb15b282bfb`.
These are whole-artifact deltas, not independently attributed feature costs.

## Full-run load record

The wait began **11:42:47 PDT**, with samples every 30 seconds. One-minute
samples were **16.04, 18.09, 20.56, 15.19, 16.76, 13.06, 11.18**.
The full test started once at **11:45:47 PDT**, after **180.126 seconds** of
waiting. Starting load (1/5/15 minutes): **11.18 / 15.92 / 23.90**.
It ended at **11:48:05 PDT**, with **22.18 / 18.41 / 23.70**. The 30-minute
fallback was not needed. No other build or test was started by this lane
during the full run. The machine remained shared with other sessions.

## Verification and reproduction

All shell commands used Node 24.18.0 on the brief's PATH. No `scripts/test.sh`,
commit, push, stash or LLP edit was made. The full test ran exactly once.
Every authored file is below 1,500 lines. `git diff --check` passes.

| Check | Result |
|---|---|
| `cargo build -p snapback4` | Pass, 4.81 s |
| App `snapback4 check --json` | Pass, no diagnostics; expected stream advisory |
| Default crate app test | 2/2 pass |
| Full flag, `application_fixture --exact`, serial | 1/1 pass in 137.33 s |
| Affected Rust tests | 65/65 pass: app 2, maintained columns 41, maintains 14, recorded round 1 5, timeline guide 3 |
| Node source census + published fence | 3/3 pass; neither skipped |
| Current and baseline WASM builds | Both pass their existing ratchets; final current hash restored and full-app backend accepted |

Commands from `snapback4/` are in the app's README. Affected Rust command:

```sh
cargo test -p snapback4-lang --test clique_03 --test maintained_columns --test timeline_guide --test maintains --test recorded_round1 --no-fail-fast -- --test-threads=1
```

The format-only pass after the full run is covered by the reduced/affected
rerun. Two subsequent comments link the governing LLP sections; no test logic
or app behavior changed after the full run. The raw
measurement and test records remain at `/tmp/sb4-clique-full.log`,
`/tmp/sb4-clique-full-load.json`, `/tmp/sb4-clique-reduced.log`,
`/tmp/sb4-clique-affected.log`, `/tmp/sb4-clique-fence.log`,
`/tmp/sb4-clique-wasm-current.log`, `/tmp/sb4-clique-wasm-baseline.log` and
`/tmp/sb4-clique-wasm-sizes.json`. The report retains the durable results;
these temporary paths are supporting local evidence.

The npm integrity pins verified by the fence were:

- `snapback4@0.2.33`: `sha512-z6nd0glf9qkms1GzIfJ4jvJAUr1Y0JqgV8rfXsxWcqhDK7MlEHxAeZlsRBuW5PoJpoHRKOzqxdvgkitVBHQ1vQ==`.
- `snapback4-darwin-arm64@0.2.33`: `sha512-gRXvTa7jSDMXVhepsLaI+D/ydt8r93ROmpbC6rTUYh9cI+EBGMIqbwcVjDyb5suXwRECaJOPW90ZAXMF43cp6A==`.


## Guide gaps

The original cross-form refusal is now resolved in the engine and the
maintains card explicitly permits mapped timeline tables. The cards already
explain replies outside the mapping, distinct repost event IDs, queued
follow/unfollow, whole-parent stream amplification, activation reacquisition
and inherited maintain sync. No new authoring guide gap has been established
by the reduced or full runs. The internal Rust test transport and native device
JSON protocol required reading existing test helpers; that is harness setup,
not an additional application mechanism.
