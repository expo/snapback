# Lane SS, round 2 — 1,000-conversation acquisition

Date: 2026-09-27. Branch: `sb4-intent/ss-sync-at-scale`.

The round reduces work at acquisition and adds a real Chromium witness. The
8 s memory / 12 s IndexedDB-shaped targets are **not met**. This report keeps
that distinction from successful correctness checks and from the larger gain
in browser IndexedDB. No package was published and nothing was pushed.

## Scope and constraints

Started with `git fetch origin && git merge origin/main`, fast-forwarding to
`941a3698c` with no conflicts. Read the two prior prompts, reports and journal
entries. The orientation pack is LLP 3000 and the Snapback 4 fence; LLP
3000.019 §3.3–3.5 (publication, retained history and media homes), LLP
3000.016 §2.2 (row-keyed counts), LLP 3000.008.004, and the current sync guide.
The `llp-orient` skill was read through the populated sibling vendor checkout
because this worktree's vendor skill link was uninitialized. No other lane
was edited. No authoring syntax or public API is introduced.

Constraints: publish only after terminal catch-up, persist a whole device
call atomically, keep source-row authorization/expiry/meter checks, retain
scalar count equivalence, and leave the wasm budget at 572,841 gzip bytes.
The risky boundaries are replacement rollback, bucket byte caps, optional
and nested media columns, and restart between staged pages and publication.
The new tests address those boundaries. The only LLP edit documents sparse
media-home markers in the existing §3.5; the acquisition design is unchanged.

## Before changing production code

The original CPU profiles and unprofiled timings were taken before the first
production edit. The instrument is Node 24.13.1's V8 `--cpu-prof` sampler
(default 1,000 µs interval), with a preload that times wasm calls, host JSON,
and physical fake-IDB transactions. A symbol-bearing, otherwise optimized
wasm build makes Rust stacks attributable. Its custom name section exceeds
the shipping budget and is diagnostic only. Timing runs do not enable the
preload or CPU sampling. Final timings use the ordinary stripped build.

The baseline already sends a whole page through each wasm call. Per-row wasm
crossings are not the cause. Index insertion and repeated row-image/index
construction dominate terminal publication. Physical cap counts take only
tens of milliseconds; row-keyed unread counts arrive as server-certified
values and are not recomputed per conversation in this path.

Fake-IDB saves rewrite the existing bounded hash buckets for each incoming
page. The old byte calculation re-encoded every pair in every touched
bucket. Text-only message rows also produced a per-row media marker although
their media column was null. The profile records both costs separately from
IDB request/commit time. Serialized put bytes are application JSON bytes,
not an estimate of disk or structured-clone encoding.

The committed measurements companion retains every timed page/call/save and
sampled category. CPU categories are exclusive; the separately reported host
hotspots are inclusive and must not be added to them. Instrumented runs have
substantial observer overhead and are not the target-compliance numbers.

## Final before/after measurements

These are single complete cold runs on the shared Linux host, serial after
qualification for the final runs, not a distribution or an SLA. Times are
seconds. Node cold mode has no concurrent writer and received exactly
**110,088 rows** in both runs; **30 → 13 responses**, **41,967,795 →
41,958,046 bytes**. Every measurement retains the original page/phase arrays.

| 1,000 conversations, Node | Memory before | Memory after | Fake-IDB before | Fake-IDB after |
| --- | ---: | ---: | ---: | ---: |
| Acquisition total | 21.854 | 16.324 | 41.477 | 21.036 |
| Sync request through complete body | 2.905 | 2.993 | 2.852 | 2.818 |
| — response headers | 2.845 | 2.885 | 2.805 | 2.757 |
| — remaining body | 0.060 | 0.108 | 0.047 | 0.061 |
| Snapshot staging apply, excluding persistence | 3.210 | 2.987 | 3.134 | 2.988 |
| Terminal publication apply, excluding persistence | 13.499 | 8.496 | 15.205 | 9.048 |
| All device apply, excluding persistence | 16.709 | 11.483 | 18.339 | 12.036 |
| All persistence saves | 0.258 | 0.140 | 18.309 | 4.507 |
| — terminal save | 0.206 | 0.091 | 9.443 | 1.659 |
| Other startup/host time | 1.981 | 1.707 | 1.977 | 1.675 |

Header/body rows subdivide network time, terminal save subdivides all saves,
and all-device subdivides staging + publication; do not double-count them.
Network is measured client wall time, not isolated server CPU. The remaining
host time includes schema/opening and inter-page bookkeeping. Device apply
includes JS wrapper/encoding and wasm, with the timed persistence saves
subtracted; the CPU profile separates its inner parts.

The uninstrumented all-device cost falls **151.8 → 104.3 µs/row** with
memory, and **166.6 → 109.3 µs/row** with fake-IDB. Memory acquisition improves
25.3%, fake-IDB 49.3%, but **both miss 8/12 s**. For 100 conversations,
final Node memory/fake-IDB acquire in **1.671/2.022 s**, 15,588 rows, three
responses and 4,655,252 bytes. The original 100-conversation ≤5 s target is
met by these runs, including Chromium below.

Chromium **151.0.7922.34**, Playwright-core **1.55.1**, actual IndexedDB:

| Browser, cold with live writer | 100 before | 100 after | 1,000 before | 1,000 after |
| --- | ---: | ---: | ---: | ---: |
| Acquisition (s) | 7.336 | 4.186 | 84.898 | 27.327 |
| Sync fetch/body (s) | 2.748 | 0.919 | 4.566 | 3.821 |
| Device apply excluding persistence (s) | 0.998 | 0.709 | 16.414 | 10.077 |
| — terminal apply excluding persistence (s) | 0.628 | 0.420 | 12.653 | 7.012 |
| All persistence (s) | 2.675 | 1.986 | 61.843 | 11.901 |
| — terminal persistence (s) | 1.274 | 1.185 | 46.862 | 5.197 |
| During live p95 (s) | 2.938 | 2.449 | 1.276 | 13.158 |
| During samples / timeouts | 12 / 0 | 5 / 0 | 40 / 1 | 19 / 0 |
| After live p95 (s) | 0.698 | 0.729 | 0.868 | 0.754 |
| After samples / timeouts | 20 / 0 | 20 / 0 | 20 / 0 | 20 / 0 |
| Observed peak JS heap, entire run (MiB) | 273.3 | 92.1 | 311.9 | 209.6 |
| JS heap just after acquisition (MiB) | 34.5 | 18.7 | 21.3 | 107.8 |
| Wasm heap reported at end (MiB) | 83.0 | 65.4 | 1301.2 | 749.1 |

Final acquisition-only observed JS peaks are **92.1 MiB** (100) and
**186.3 MiB** (1,000); baseline only recorded the entire-run peak. The final
1,000-conversation entire-run peak is 209.6 MiB. JS heap immediately after
acquisition is GC-scheduling-sensitive; its increase is retained in the
table rather than presented as a retained-memory improvement.

Live p95 is nearest-rank with timeouts included as infinity. In the baseline
1,000 run one send exceeded 31 s. Its 1.276 s p95 does **not** mean it lacked
a long stall: 40 during samples put that timeout above the 95th percentile.
The faster final run has 19 during samples, so its p95 is the maximum,
13.158 s. No timeout occurs in either final browser run. Neither during p95
meets the inherited 1 s target; after-acquisition p95 does. These unequal
sample counts do not establish a distributional p95 regression/improvement.
The terminal synchronous apply plus strict IDB save explains the remaining
stall. The 1,000 browser publication itself takes about 7.0 s of device work
and 5.2 s persistence; the browser's all-save time is **11.9 s**, versus
**4.5 s** for fake-IDB. The fake adapter is not a browser-cost substitute.

With live writes, total delivered events can include repeated updates to
50 members' unread counts. Browser before/after delivered rows are
16,056/15,744 at 100 conversations, and 111,856/110,972 at 1,000. Their actual
bytes and per-page rows are in the evidence; these are not identical static
message traces. The private fixture/schema and principal remain the same.

| Final Node observed memory | 100 conversations | 1,000 conversations |
| --- | ---: | ---: |
| memory: JS heap (MiB) | 125.3 | 198.7 |
| memory: external (MiB) | 85.2 | 878.1 |
| memory: RSS (MiB) | 322.9 | 1267.1 |
| idb: JS heap (MiB) | 175.2 | 723.1 |
| idb: external (MiB) | 102.6 | 877.6 |
| idb: RSS (MiB) | 398.7 | 1688.3 |

At 1,000, memory-persistence peak JS/external falls **285.6/1,452.5 →
198.7/878.1 MiB**; fake-IDB falls **1,262.9/1,446.9 → 723.1/877.6 MiB**.
These are observations, not a sublinear total-memory claim; see the retained
replica lower bound below. The browser reload/crash witness passed with
**9,922 staged rows, zero published rows, acquired=false** before navigation,
and a complete acquired partition after restart. Its timing was taken
concurrently with qualification and is functional evidence only.

## Device and persistence profiles

The initial pre-edit profile attributed 9.341 s to index insertion, 3.852 s
to index construction, 1.468 s to staging, 0.632 s to coverage, and 0.018 s
to physical counts. That heavily instrumented acquisition took 36.7 s. The
isolated repeat of the same baseline below took 23.6 s and supplies aligned
per-page samples; both captures are retained. CPU samples are a diagnosis,
not an uninstrumented speedup claim.

| Exclusive sampled CPU, memory witness | Baseline repeat (s) | Final (s) | Baseline / final µs per received row |
| --- | ---: | ---: | ---: |
| command decode and validation | 1.348 | 1.223 | 12.25 / 11.11 |
| staged row decode | 0.594 | 0.399 | 5.39 / 3.62 |
| staging | 0.964 | 0.925 | 8.76 / 8.40 |
| coverage | 0.404 | 0.364 | 3.67 / 3.31 |
| boundaries | 0.016 | 0.012 | 0.14 / 0.11 |
| row writes | 0.216 | 0.200 | 1.96 / 1.81 |
| index construction | 2.951 | 2.184 | 26.81 / 19.84 |
| index insertion | 6.470 | 3.220 | 58.77 / 29.25 |
| media markers | 0.305 | 0.127 | 2.77 / 1.16 |
| physical counts | 0.006 | 0.006 | 0.06 / 0.06 |
| publication remainder | 1.068 | 0.807 | 9.70 / 7.33 |
| commit and change encoding | 1.256 | 1.053 | 11.41 / 9.56 |
| drain encoding | 0.700 | 0.724 | 6.36 / 6.58 |

Command decode/validation includes the Rust JSON entry-point work that cannot
be assigned further by sampled stacks, including store observation; it is
not just JSON tokenization. The staged-row decode is separate. Host JSON
and boundary copies are measured independently: in the original profile,
JSON.parse was 1.173 s and JSON.stringify 0.306 s; sampled input/output wasm
string-copy stacks were 0.245/0.120 s. In the final memory profile they were
0.823/0.195 s for host parse/stringify and 0.172/0.092 s for the copy stacks.

Per-page wall times and all aligned category totals are in
`round2-measurements.json`, `profiles.*.pageCalls`. Ordinary snapshot applies
stage rows and coverage; the empty terminal catch-up applies the whole
partition and builds indexes. Examples from the aligned memory runs:

| Page | Rows received | wasm call (ms) | Main sampled work (ms) |
| --- | ---: | ---: | --- |
| before, first snapshot | 3999 | 69.4 | command decode and validation 13.9; staging 30.9; coverage 5.3 |
| before, terminal catch-up | 0 | 13039.2 | index insertion 6469.6; index construction 2951.3; staged row decode 593.5; commit and change encoding 930.3 |
| after, first snapshot | 9999 | 120.8 | command decode and validation 25.8; staging 57.5; coverage 5.3 |
| after, terminal catch-up | 0 | 7987.7 | index insertion 3220.3; index construction 2183.9; staged row decode 398.7; commit and change encoding 737.5 |

The terminal per-row denominator is the 110,088 rows already staged, not the
zero events in the final response. Its wasm call is 118.4 → 72.6 µs per
staged row in these diagnostic runs. Maintained counts are not a useful
optimization lever here: server-certified row-keyed values are received, and
physical cap counts stay synchronous; their measured CPU is below 0.1 µs/row.

| Physical fake-IDB work, diagnostic run | Before | After |
| --- | ---: | ---: |
| Transactions (including opening/cache) | 102 | 50 |
| Puts | 115,000 | 18,570 |
| Gets | 7,814 | 3,584 |
| Deletes | 13,338 | 13,308 |
| Serialized put bytes | 1,301,860,497 | 626,866,368 |
| Synchronous IDB request issue (s) | 1.208 | 0.381 |
| Summed transaction wall lifetime (s) | 30.441 | 6.434 |
| Inclusive bucket rewrite CPU (s) | 18.049 | 4.565 |
| Inclusive pair byte calculation CPU (s) | 6.185 | 0.346 |

The before/after transaction modes are 98/46 readwrite, two readonly and two
versionchange. Transaction wall lifetimes include JSON work in request
callbacks, cloning and scheduling; the difference from request-issue time
is not pure disk I/O. Every page's `persistence` record gives transactions,
puts, gets, deletes and bytes from that apply until the next, including sync
progress metadata. Initial setup/cache transactions are in the overall total.
The after put bytes break down into 607.9 MB of buckets, 7.87 MB of overflow
staging rows, 1.93 MB of metadata, and 9.15 MB of the wasm cache (decimal MB).
The original profile predates that per-store breakdown; its total is exact.

## Implementation, file by file

| File | Change and reason |
| --- | --- |
| `crates/snapback4-core/src/rows.rs` | Materialize a row's optional-field image once for all its indexes, keeping key and structural checks. |
| `crates/snapback4-device/src/memory.rs` | Group indexes by namespace; move owned values; save the previous index tree once during whole-partition replacement instead of one undo record per new index entry. Physical cap counts still update immediately. |
| `crates/snapback4-device/src/store.rs` | Internal `replace_rows` loader contract; default stores use ordinary transactional writes. No reads/deletes/savepoints inside its loader. |
| `crates/snapback4-device/src/device.rs` | Use that loader for the existing terminal staged-row replacement; indexes finish before prediction replay and publication. |
| `crates/snapback4-device/src/device/media.rs` | Omit home markers for null/recursively empty media, remove an old marker on confirmed clear, recreate it when confirmed media arrives. Receipt and current-column authorization still apply. |
| `packages/snapback4/src/local.ts` | Start at the existing server ceiling of 10,000 rows rather than 4,000; retain the byte ceiling and `E_BOUND` halving down to one row. |
| `packages/snapback4/src/web-idb-buckets.ts` | Measure existing bucket JSON once, and re-encode only changed pairs. Preserve 512-entry/256-KiB limits, spill records and the strict transaction. |
| `packages/snapback4/src/utf8-size.ts`, `web-residency.ts` | Exact ASCII byte-length shortcut, with TextEncoder fallback for all non-ASCII text; reuse it for residency accounting. |
| Two core self-send fixtures | Give members distinct `id` and `principal`, send as `principal`, retain scalar comparisons and own/other unread assertions. |
| `memory_tests.rs`, `asset_lists.rs`, `web-durability.test.mjs` | Replacement rollback/index equivalence, sparse media authorization, and staged-page restart/publication failure coverage. |
| `sync-overflow.test.mjs`, `client-lifecycle.test.mjs`, `http-bounds.test.mjs` | Update only the intentionally changed initial page size and its expected halving sequence. |
| `witness/sync-profile.mjs`, `sync-profile-summary.mjs` | Repeatable CPU/wasm/JSON/physical-IDB instrumentation and per-page attribution. |
| `witness/sync-scale-browser.mjs` | Real Chromium and IndexedDB, fresh browser context, cold acquisition with a live watch, sampled heap and optional navigation/restart witness. |
| LLP 3000.019 §3.5, this report, measurements and `JOURNAL.md` | Record the representation detail, evidence, misses and qualification. |
| `issues/20260927-snapback4-1000-conversation-acquisition-budget.md` | Keep the unmet acquisition and during-acquisition latency targets open with a reproduction. |

The existing `sync-scale.mjs` and synthetic fixture extension are unchanged.
There is no auth bypass, relaxed durability, delayed physical count, new
diagnostic, public spelling, raised timeout, meter or wasm budget.

## Correctness evidence and existing forms

The memory replacement test compares every ordinary/search/expiry index and
physical cap count against scalar insertion for 200 rows in reverse order.
It also rolls back a later prediction savepoint, an interrupted replacement,
and a completed replacement, comparing durable changes and original rows.
SQLite continues to use its transaction's ordinary index writes.

Two media tests run on memory and SQLite. Optional scalar media and nested
lists start empty, receive confirmed media, clear it, reopen, and receive it
again. Empty rows have no marker; receipts work only while confirmed media
is present. Existing asset/retained-history tests check the surrounding
authorization and expiry paths.

The new durability test (memory persistence, with the host save made to
throw) persists snapshot pages, disposes and reopens, then faults terminal
persistence. It exercises recovery from an atomic host-save failure, not an
interruption inside an IndexedDB transaction; the existing real-IndexedDB
abort tests remain the evidence for that. At each interruption there are
staged rows but no published partial partition. Reacquisition publishes the
complete partition and clears staging. The browser companion additionally
destroys the owner realm by navigation after the first durable page and
reacquires using the same real IDB store.

Both revised self-send fixtures use e.g. `id = member-000` and
`principal = principal-000`; the self-send references `principal-000`.
A production-code mutation substitutes the member id for principal before
the batch's predicate match. Both tests fail with exit 101. After restoring
the code both pass. Scalar equivalence is retained, rather than replaced by
only hand-written expected totals.

No new syntax needs an example. These existing forms still compile and run:

```quarry
view unread: count messages by members m
  where .conversationId = m.conversationId and .ordinal > m.readUpTo
    and .senderId != m.principal and not .tombstone and .ordinal > m.joinedAt
query unreadFor(member: members):
  return unread[member]
```

```js
const watch = client.observe({ kind: 'query', name: 'messaging.history' }, { conversation });
const stop = watch.subscribe(() => render(watch.getSnapshot()));
```

The first is exercised by the existing row-keyed view fixture and count
tests; the second is the live watch in both scale witnesses.

## Memory and remaining limits

Total retained memory cannot grow sublinearly in this fixture's authorized
conversation count: every added conversation has independent rows/index
entries that the offline replica must keep. That is an Ω(rows) lower bound.
Wasm's linear memory also retains its allocated high-water capacity. The
memory persistence adapter keeps another logical copy, and fake-indexeddb
retains completed transactions and their rollback records, as round 1's
release-of-finished-transactions control established.

Larger pages reduce accumulated bucket rewrites and transient allocation but
do not make the terminal atomic publication delta bounded independently of
the partition. Page row/byte bounds still bound individual network pages;
the full replica, previous partition undo image on reacquisition and final
change vector remain proportional to the retained data. The 20 ms JS samples
plus call/save checkpoints are observed peaks, not a proof of the true
within-call maximum. Chromium `performance.memory` does not include wasm
linear memory or IndexedDB's browser-process/disk storage; residency reports
wasm heap separately. Two fixture sizes cannot prove asymptotic scaling.

The remaining acquisition and during-acquisition tail latency come mainly
from the synchronous terminal index/publication work. Deferring publication
without an additional transaction protocol would break atomicity. Experiments
with sorted bulk index construction and alternative byte comparisons did
not meet the time target within the unchanged wasm budget, so they are not
included. Worktree-local Binaryen 123 and an alternate Rust size profile did
not reduce the gzip artifact; the normal build path remains unchanged.

Deviations from the requested outcome are the missed 8/12 s acquisition
targets and the inherited one-second during-acquisition p95. The requested
sublinear total-memory outcome is replaced by the explicit retained-replica
lower-bound explanation above. No other rule was relaxed to improve a
measurement. The open performance work and exact reproduction are tracked
in [the follow-up ticket](../../../issues/20260927-snapback4-1000-conversation-acquisition-budget.md).

## Reproduction

Use only private copies of the GS scale store. The lane copies are
`target/lane-ss-evidence/scale` (100 conversations) and `scale1000` (synthetic
1,000 conversations, produced by the unchanged round-0 extension). Serve
them with the release server's `dev --replay --no-watch` on ports 49371/49372.
The original GS store and WAL were never served or modified. Run probes
serially on this shared Linux host; fixture live sends add a few rows, so
the measurements include each run's actual row and byte totals.

From `snapback4/`, use the worktree's Node/Bun wrappers (avoiding the host's
incompatible optional wasm-opt 108):

```sh
export PATH=$PWD/target/lane-ss-evidence/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin
export CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
ulimit -n 65536
bash scripts/build-wasm.sh
bun run --cwd packages/snapback4 build
SS_SAMPLES=0 node witness/sync-scale.mjs http://127.0.0.1:49372 target/cold-memory.json memory
SS_SAMPLES=0 node witness/sync-scale.mjs http://127.0.0.1:49372 target/cold-idb.json idb
node witness/sync-scale-browser.mjs http://127.0.0.1:49371 target/browser-100.json
node witness/sync-scale-browser.mjs http://127.0.0.1:49372 target/browser-1000.json
SS_CRASH=1 node witness/sync-scale-browser.mjs http://127.0.0.1:49371 target/browser-crash.json
```

The browser uses the existing Playwright and Chromium install. `SS_CHROMIUM`
can point to a different local executable. The writer uses the ordinary
online Node client; the reader, its watch, wasm and durable IDB all run in
Chromium. This avoids turning a bare browser writer's admission refusal into
an acquisition failure. Each invocation creates a fresh browser context and
IDB. It sends sequentially throughout acquisition, then three warm-ups and
twenty measured sends. Timeouts are counted explicitly in the p95 data.

For diagnostic profiles, build symbols and copy **both** wasm and matching
glue into an isolated package tree, build its SDK, and copy the unchanged
Node witness and diagnostic preload beside it. The actual final profile
commands used the isolated `target/lane-ss-round2/diagnostic/` tree:

```sh
CARGO_PROFILE_WASM_STRIP=false cargo build -p snapback4-device --no-default-features --features web --profile wasm --target wasm32-unknown-unknown
# wasm-bindgen --target web into diagnostic/packages/snapback4/src/wasm;
# copy the complete generated directory into diagnostic/packages/snapback4/dist/wasm.
SS_SAMPLES=0 SS_PROFILE=target/lane-ss-round2/after-memory-profile node \
  --cpu-prof --cpu-prof-dir=target/lane-ss-round2 --cpu-prof-name=after-memory.cpuprofile \
  --import ./target/lane-ss-round2/diagnostic/witness/sync-profile.mjs \
  target/lane-ss-round2/diagnostic/witness/sync-scale.mjs \
  http://127.0.0.1:49372 target/lane-ss-round2/after-memory.json memory
node witness/sync-profile-summary.mjs target/lane-ss-round2/after-memory.cpuprofile \
  target/lane-ss-round2/after-memory-profile.json target/lane-ss-round2/after-memory-attribution.json
```

Use `idb` and distinct output names for physical persistence attribution.
The original pre-edit commands used `witness/` directly with
`before-memory`/`before-idb` output names. An additional baseline diagnostic
run reconstructs SDK sources at `941a3698c` in an isolated tree and uses the
saved matched pre-edit symbol-bearing wasm/glue to align CPU samples with
page calls. The original profile lacked the absolute monotonic origin needed
for that alignment. It still records every page's wall time.

## Qualification, exact full result and wasm

Ran `bash scripts/test.sh` **exactly once**, exit **1**. Exact summary:

```text
== 1 failure(s) in 1285 s
   client tests
```

Every full-suite failure is **lane-owned**:

1. `client-lifecycle.test.mjs:238`, “local sync shrinks response-bound pages
   at one cursor and exposes an indivisible refusal”: its expected sequence
   still began at 4,000 rather than the intentionally changed 10,000.
2. `http-bounds.test.mjs:217`, “Wasm and process clients acquire wide snapshots
   by shrinking the same cursor”: the same stale initial-size expectation.
3. Node also reports the enclosing “HTTP admission, encoding, slow readers
   and idle changes polls” test as failed because of item 2. It is not a
   third independent failure.

Updated those policy pins, retaining same-cursor, one-row refusal, byte-bound
recovery and complete-publication assertions. Both entire affected files then
passed **67/67** (`page-policy-recheck.log`). No production code changed after
the full run. Did not rerun the whole suite. Baseline failures: **0**;
environmental failures: **0**. The inherited 60 s suite budget remains
exceeded; no deadline or budget was increased.

Full-run Rust: **3,910 passed / 24 existing ignored** (771 s). Main SDK:
**2,642 passed / 3 reported failures / 10 existing skips**, plus seven
acquisition/server shards; serial models **78/78** (290 s). Fixture wrappers
**9/9**. Native/wasm builds, package build/typecheck, both app typechecks,
docs budget and release guard passed. Logs and exact exit are in
`target/lane-ss-round2/full-suite.log` and `full-suite.exit`; a compressed
copy is retained beside this report.

Affected checks before the full run: device library **48/48**; device,
asset-list, retained-history and repair-B boundary integration targets
**484 passed / 1 existing ignored**; core row views **18/18**; delivery
batch **1/1**. Whole guide **86/86**. SDK affected group initially had
**150 passes / 1 failure** in the new durability fixture: its synthetic
terminal page lacked explicit `snapshot: false`. Fixed that fixture; the
entire durability file passed **15/15**, and the final durability + scale
recheck passed **20/20**. The full run also passed these corrected tests.
Both principal-substitution mutants failed, then both restored tests passed.
`./ref-check --verbose` from repository root passed with **517 LLPs,
9,631 references, 27,279 files, 0 errors**. `git diff --check` is clean.

Commands (from `snapback4/`, environment as above):

```sh
cargo test -p snapback4-device --lib
cargo test -p snapback4-device --test asset_lists --test retained_history --test repair_b_boundaries --test device
cargo test -p snapback4-core --lib engine::row_views
cargo test -p snapback4-core --test sync_count_batch
cargo test -p snapback4-lang --test guide
node --test packages/snapback4/test/web-durability.test.mjs packages/snapback4/test/sync-scale.test.mjs packages/snapback4/test/sync-overflow.test.mjs packages/snapback4/test/web-review.test.mjs packages/snapback4/test/web-start.test.mjs packages/snapback4/test/horizon-boundary.test.mjs
bash scripts/test.sh
node --test packages/snapback4/test/client-lifecycle.test.mjs packages/snapback4/test/http-bounds.test.mjs
```

Final normal wasm is **1,981,590 B raw / 572,590 B gzip**, versus round 1's
1,981,512 / 572,049: **+78 raw / +541 gzip bytes**, with **251 bytes headroom**
under the unchanged 572,841-byte budget. SHA-256:
`3874f6596171e57a4285f85ef45c87546473760bf939ac96914853787e12c62f`.
The diagnostic symbol build never replaced the normal artifact used by
qualification/final timing. `local.ts` is 1,491 lines, `memory.rs` 735;
all edited/new source files stay below 1,500.

Toolchain: Node 24.13.1, Bun 1.3.14, Rust 1.97.0; eight Cargo jobs, dev/test
debug information disabled, fd limit 65,536. Ran `bun install
--frozen-lockfile` once. The only new tool installation was the abandoned
Binaryen 123 experiment inside `target/lane-ss-round2/tools`; no executable
or configuration was installed on a shared path. Chromium and Playwright
were already available. The no-optimizer wasm path avoids the host's old
wasm-opt 108, exactly as in rounds 0–1.
