# Lane OK — owner-key coverage

Date: 2026-09-28. Branch: `sb4-intent/ok-owner-key-coverage`.
Base: `a745b110f`. First operation was `git fetch origin && git merge origin/main`;
merge reported already up to date. Nothing pushed or published.

## Contract and implementation

Read LLP 3000.028 in full before implementation. Scope is §§2.3, 3.4, 6
(owner-key costs), 7.3 and relevant 7.6 boundaries. Orientation also used
Snapback 4 AGENTS, NOT-DOING, JOURNAL, LLP 3000, the 2000.000 design brief,
3000.001 publication fences, 3000.007 maintenance/coverage and 3000.015 meters.
The llp-orient skill was read from the initialized upstream checkout because
this worktree's skill link was unpopulated. No app-authoring or Snapback 1 gates
were applied. No other lane was edited and no tools were installed.

`sync public last … by … with own keys .principal` now opts a source into a
compiler-maintained `$ownKeys:<source>` private, horizon-free partition.
Admission requires a non-expiring uniformly public window, required principal,
total immutable unique key and structurally caller-owned (or denied) writes.
The compiler adds the source owner index. It conservatively selects one
qualifying unique index in schema order; `id`/`value` and field-authority keys
are refused by this initial representation.

Only a full unique-key `exists` with a direct `viewer` owner expression and
no residual predicates is rewritten. Row images, arbitrary owner expressions,
extra predicates and public counts keep their existing reads. Existing
programs without this explicit suffix have no new tables, indexes or capability.
The original builder compiles unchanged alongside its authored summary views.

The hidden projection reuses count maintenance with unique keys, so its row
contains canonical key ID, key fields and constant `value: 1`. Its private
read audience is the owner; application writes deny. Source and projection
writes, indexes, unique probes and log entries share one transaction and the
unchanged meter. Backfill streams 256-row batches instead of retaining a map
of all lifetime keys. Authorization/disclosure and public window sizes remain
unchanged. NOT-DOING records the narrow deliberate extension.

Empty coverage is explicit: snapshot/catch-up publishes the caller's whole
owner group in the existing durable held-groups metadata. Reading a key on a
device requires this exact principal marker. Generation-wide acquisition alone
cannot prove another caller's empty partition. Existing staging, sign-out,
reset and persistence transactions own both keys and markers. The new
`owner-key-coverage` capability fences older decoders; executing the baseline
wasm against the new backend returns `E_SCHEMA_CAPABILITY` ([log](old-device.log)).

The social example in `guide feeds` and the language example default to the
policy; `guide sync` explains adoption, bytes and device compatibility.
No existing windowed declaration is silently expanded.

## §7.3 acceptance

The exact calibration builder is retained in the P19 fixture. The witness
removes `ownLikes`/`ownReposts`, restores raw `exists` in `postState` and
`postCard`, and adds only the two explicit source policies. Additional test
personas/queries and a published author profile isolate lifecycle observations;
[builder-owner.q](builder-owner.q) preserves the executed program.

`owner-coverage.mjs` uses public `createClient` / `createLocalClient`, process
and wasm openers, copied full-scale stores, parked changes and explicit
transport failure. [acceptance.jsonl](acceptance.jsonl) includes every attempt;
[acceptance-final.jsonl](acceptance-final.jsonl) isolates the final run. It records
query requests, raw coverage and public results, timings, residency and outbox.

| Case | Native and wasm result |
| --- | --- |
| u0500, never-queried post after acquisition and disconnect | liked/reposted false, complete, stale |
| Old own like below the 2,000-row window | true, complete |
| Another principal's old key; missing old row image | unknown/unavailable, never a fabricated false/row |
| Empty owner; post shape with its profile available | false/false, complete |
| First insert, last deletion, then reinsert | true → false → true after sync |
| Remote deletion while disconnected | stale true until sync, then complete false |
| Predicted deletion | pending write overlays source and key transactionally |
| Unpredicted insert | pending intent, no projected key; no fabricated settled true |
| Sign-out and caller switch in the same persistence directory | no inherited proof; loading before acquisition; complete false after |
| Snapshot stopped before catch-up | acquired false; reopen requires fresh acquisition |
| Public post counts | original semantics retained (one like and one repost) |

The scalar SDK represents an unknown `exists` as `E_OFFLINE` on this path,
while the raw device result has `unknown: true` and speculative coverage.
This existing unavailable representation is preserved; it never returns false.
Pending-list `state: sent` can mean a dispatch attempt, not a settled write;
the witness checks `client.write(id).state === 'pending'` independently.

`owner-faults.mjs` kills the native process with SIGKILL after staging the
builder backend's empty owner groups and before publication. Reopen cannot
publish the abandoned capture; restaging/catch-up restores complete false.
A wasm host-save abort similarly discards publication; durable clear removes
its held-group metadata. [faults.json](faults.json) records both passes.
The five device tests additionally cover SQLite and memory lifecycle behavior,
wrong-caller direct reads, failed adoption before generation publication,
failed SQLite partition publication and source/key rollback at rows_written=1.

This lane makes no claim that the RFC's search/diagnostic lanes or §8
React/Expo typing, media and route-lifetime recipes are complete. Their UI
behavior is not changed here. Chromium below measures real IndexedDB storage;
it is not substituted for those UI acceptance witnesses.

## Measurement method and limits

All original input hashes (program, log, SQLite and WAL) match P19's recorded
manifest ([input-integrity.log](input-integrity.log)). Originals were read as
bytes; engines opened only worktree-owned copies. Native fixture comparison
uses a fresh identical copy per arm. The fixture has 5,008 likes and 1,004
reposts; u0500 owns three and one, and the hub is u0001.

[own_keys_cost.rs](../../crates/snapback4-device/tests/own_keys_cost.rs) records
stream-page JSON bytes, decoded rows, row/index/log payload bytes, physical SQLite
page counts (4,096 bytes/page), adoption/backfill, snapshot/catch-up pages,
200 writes per synthetic arm, SQLite BEGIN-to-COMMIT lock hold, meters and
recipient partitions. The full-own-rows arm is an explicit private mirror
control, not a new public-row sync policy: the synthetic app mirrors mutations;
the builder control copies public fields, without replaying engine capture or
feed slots. Its backfill is therefore setup work, not a supported migration API.

Synthetic owners have 1,000, 100,000 or 1,000,000 live keys plus 6,000 unrelated
keys; their ordinary 2,000-row public window remains in all private alternatives.
Every measurement is actual, not a multiple of the four-key fixture saving.
[Native data](native-costs.json) retains all 19 arms and viewers.

`owner-browser.mjs` replays those exact authorized replica rows into Chromium
151.0.7922.34 / real wasm and default IndexedDB persistence, then publishes
catch-up. Its page replay is a storage/cost fixture, not a second authorization
oracle: the public SDK builder witness above supplies that acceptance.
The small cases use 2,000-row pages; million-key and full-builder cases use
10,000-row pages with keyset pagination. Cold browser time includes opener,
backend/wasm load and publication. CDP's IndexedDB usage is actual compressed
allocation and varies with compaction, so it need not rank like logical bytes.
Native wire totals cover snapshot/catch-up bodies. SDK wire totals cover /sync
bodies; browser replay totals include backend JSON and pages. These exclude
HTTP framing/compression and the separately reported wasm/JS download. IDB
usage includes the opener’s persisted wasm cache. Browser cases use fresh
isolated contexts; this measures committed IndexedDB usage, not browser-restart
recovery. Native cold time begins at Device::open; the SDK witness separately measures
createLocalClient through sync. No measurement uses explicitSyncMs alone.
Browser JS heap is sampled after staging pages (a lower bound on total peak);
allocated wasm heap includes final publication for completed cases. These are
not total browser RSS. The stalled million-row cases additionally record
renderer VmHWM covering the entire run. Native VmHWM in the
multi-arm runs is cumulative, not a per-arm maximum; a separate fresh-process
million-key run measures the key arm without inherited summary high-water.
This is a debug/optimized-test build on a shared Linux host, not release latency
qualification. Catch-up is one terminal page; no transfer resumptions were
needed in clean cost runs. Interrupted recovery is measured separately above.

### Full calibration store, all replicated tables

| Policy | Viewer | Wire B | Rows | Row B | Index B | SQLite pages | IDB B | Native / browser cold ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| summaries | empty | 3,618,677 | 11,020 | 3,018,529 | 5,133,018 | 4,693 | 5,645,839 | 597 / 1994 |
| summaries | u0500 | 5,370,455 | 15,679 | 4,615,484 | 9,273,213 | 7,230 | 10,926,239 | 1886 / 2792 |
| summaries | u0001 | 41,533,976 | 109,892 | 42,015,449 | 210,613,384 | 93,612 | 40,103,680 | 50070 / 25944 |
| public | empty | 2,733,356 | 9,024 | 2,611,829 | 3,202,962 | 3,077 | 4,245,484 | 636 / 1450 |
| public | u0500 | 4,485,411 | 13,683 | 4,208,784 | 7,343,157 | 5,621 | 10,404,404 | 1721 / 3952 |
| public | u0001 | 40,648,589 | 107,896 | 41,608,749 | 208,683,328 | 92,235 | 45,127,106 | 52221 / 23458 |
| own_rows | empty | 1,678,303 | 5,008 | 1,675,857 | 2,355,474 | 2,132 | 4,103,381 | 267 / 896 |
| own_rows | u0500 | 3,431,247 | 9,671 | 3,273,720 | 6,497,321 | 4,681 | 8,292,671 | 1246 / 2231 |
| own_rows | u0001 | 39,594,772 | 103,885 | 40,673,905 | 207,837,905 | 91,350 | 41,219,780 | 42430 / 21668 |
| keys | empty | 1,678,375 | 5,008 | 1,675,857 | 2,709,474 | 2,240 | 3,254,886 | 253 / 948 |
| keys | u0500 | 3,431,615 | 9,671 | 3,273,704 | 6,851,517 | 4,774 | 8,291,935 | 1246 / 2333 |
| keys | u0001 | 39,595,236 | 103,885 | 40,673,885 | 208,192,150 | 91,429 | 40,802,157 | 46616 / 21676 |

u0500 saves 1,938,840 wire bytes (36.1%) and 6,008 decoded rows against
public summaries. The hub is dominated by its messages/word indexes, so its
percentage saving is smaller. The owner-key table alone is not this total.
Fixture adoption: summaries 7 ms (already installed), full public rows 1,159 ms,
explicit own-row copy 595 ms, owner keys 1,569 ms. Source backfill details
and server/index/log totals are in native-costs.json.

### Synthetic lifetime keys, prolific viewer

| Live own keys | Policy | Wire B | Row B | Index B | SQLite pages | Native cold ms | Adoption ms |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | summaries | 1,783,888 | 1,290,000 | 2,094,000 | 2,333 | 271 | 237 |
| 1,000 | public | 1,052,393 | 842,780 | 939,000 | 1,236 | 190 | 54 |
| 1,000 | own_rows | 451,780 | 359,890 | 601,000 | 625 | 90 | 182 |
| 1,000 | keys | 517,922 | 390,000 | 792,000 | 758 | 98 | 268 |
| 100,000 | summaries | 22,476,566 | 15,940,000 | 25,242,000 | 29,014 | 4496 | 4188 |
| 100,000 | public | 15,799,319 | 12,713,780 | 13,710,000 | 18,139 | 3473 | 835 |
| 100,000 | own_rows | 15,392,096 | 12,228,890 | 18,502,000 | 19,803 | 3997 | 3058 |
| 100,000 | keys | 21,804,285 | 15,040,000 | 23,934,000 | 28,475 | 4437 | 4574 |
| 1,000,000 | summaries | 210,630,366 | 149,142,000 | 235,842,000 | 272,334 | 82540 | 52396 |
| 1,000,000 | public | 150,844,085 | 121,613,780 | 129,810,000 | 171,995 | 42170 | 9964 |
| 1,000,000 | own_rows | 152,233,656 | 121,130,890 | 181,402,000 | 194,613 | 49378 | 29257 |
| 1,000,000 | keys | 215,357,889 | 148,242,000 | 234,534,000 | 281,076 | 55660 | 58493 |

The empty owner with one million keys elsewhere still acquires only 2,000
public rows: 300,918 wire bytes, 242,000 row bytes, 534,000 index bytes and
472 SQLite pages with owner keys. Public summaries/full public rows deliver
their entire lifetime sets to that empty viewer too. At 1m, full own rows
use 121,130,890 row bytes and 181,402,000 index bytes, versus 148,242,000 and
234,534,000 for keys. The extra canonical-ID bytes and source owner index
outweigh removing this deliberately narrow raw row’s timestamp.

At 1m the key backfill processes 1,006,000 source rows in 30,832 ms; total
adoption is 58,493 ms. The isolated key-arm run is 58,601 ms adoption,
30,907 ms backfill, 47,543 ms native acquisition and 3,194,744 KiB process
VmHWM. Streaming the aggregate totals does not make full-store adoption
bounded-memory: the surrounding adoption transaction/index work still costs.

### Server amplification, 100 insert/delete pairs

| Live keys | Policy | Write p50/p95 ms | Lock p50/p95 ms | Rows written per insert/delete | Index entries per insert/delete | Added log B / entries | Recipient partitions |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | baseline | 0.243 / 0.285 | 0.238 / 0.279 | 1 / 1 | 3 / 3 | 20,490 / 200 | 1 |
| 1,000 | summaries | 0.168 / 0.258 | 0.164 / 0.247 | 2 / 2 | 5 / 5 | 45,050 / 400 | 1 |
| 1,000 | public | 0.220 / 0.278 | 0.216 / 0.271 | 1 / 1 | 2 / 2 | 20,490 / 200 | 1 |
| 1,000 | own_rows | 0.221 / 0.399 | 0.217 / 0.378 | 2 / 2 | 6 / 6 | 42,180 / 400 | 2 |
| 1,000 | keys | 0.189 / 0.282 | 0.185 / 0.279 | 2 / 2 | 6 / 6 | 47,050 / 400 | 2 |
| 100,000 | baseline | 0.236 / 0.289 | 0.231 / 0.280 | 1 / 1 | 3 / 3 | 20,490 / 200 | 1 |
| 100,000 | summaries | 0.172 / 0.252 | 0.168 / 0.247 | 2 / 2 | 5 / 5 | 45,050 / 400 | 1 |
| 100,000 | public | 0.128 / 0.200 | 0.125 / 0.196 | 1 / 1 | 2 / 2 | 20,490 / 200 | 1 |
| 100,000 | own_rows | 0.196 / 0.288 | 0.192 / 0.272 | 2 / 2 | 6 / 6 | 42,180 / 400 | 2 |
| 100,000 | keys | 0.200 / 0.333 | 0.195 / 0.319 | 2 / 2 | 6 / 6 | 47,050 / 400 | 2 |
| 1,000,000 | baseline | 0.230 / 0.294 | 0.226 / 0.279 | 1 / 1 | 3 / 3 | 20,490 / 200 | 1 |
| 1,000,000 | summaries | 0.288 / 0.433 | 0.280 / 0.413 | 2 / 2 | 5 / 5 | 45,050 / 400 | 1 |
| 1,000,000 | public | 0.141 / 0.216 | 0.138 / 0.207 | 1 / 1 | 2 / 2 | 20,490 / 200 | 1 |
| 1,000,000 | own_rows | 0.191 / 0.312 | 0.187 / 0.281 | 2 / 2 | 6 / 6 | 42,180 / 400 | 2 |
| 1,000,000 | keys | 0.282 / 0.484 | 0.276 / 0.442 | 2 / 2 | 6 / 6 | 47,050 / 400 | 2 |

For keys, insert/delete costs 2 written rows and 6 index entries each, versus
1 row/3 entries on the original window. Log payload is 47,050 versus 20,490
bytes for these 200 operations. There are two recipient **partitions** (public
plus one owner), not necessarily two connected clients; public subscriber
fan-out remains unchanged. The new private partition has one principal.
The source owner index is charged even when the public window is already held.
No query, write, output or heap allowance is reset or increased.

### Chromium / IndexedDB: complete and incomplete results

All byte figures below are CDP IndexedDB usage, including the wasm cache.
Completed rows have a durably published acquisition. The million-row failures
show **partial** usage and elapsed lower bounds; these are not finished replicas.

| Keys | Policy | Viewer | IDB B | Acquisition seconds | JS sample peak B / wasm allocated peak B |
| ---: | --- | --- | ---: | ---: | ---: |
| 1,000 | summaries | empty | 2,186,336 | 1.48 | 93,092,560 / 28,573,696 |
| 1,000 | summaries | prolific | 2,179,098 | 1.55 | 93,096,096 / 28,573,696 |
| 1,000 | public | empty | 1,946,023 | 1.12 | 93,010,874 / 17,104,896 |
| 1,000 | public | prolific | 1,946,023 | 1.14 | 93,020,786 / 17,104,896 |
| 1,000 | own_rows | empty | 1,579,363 | 0.52 | 93,079,155 / 7,143,424 |
| 1,000 | own_rows | prolific | 1,903,755 | 0.60 | 93,084,726 / 8,847,360 |
| 1,000 | keys | empty | 1,653,183 | 0.54 | 93,079,702 / 7,340,032 |
| 1,000 | keys | prolific | 1,687,426 | 0.65 | 94,046,270 / 9,502,720 |
| 100,000 | summaries | empty | 5,933,902 | 29.81 | 97,392,368 / 362,414,080 |
| 100,000 | summaries | prolific | 5,969,480 | 28.63 | 112,991,391 / 362,414,080 |
| 100,000 | public | empty | 7,352,204 | 29.09 | 93,039,882 / 241,565,696 |
| 100,000 | public | prolific | 9,094,231 | 28.57 | 125,909,903 / 241,565,696 |
| 100,000 | own_rows | empty | 1,656,010 | 0.51 | 93,051,839 / 7,077,888 |
| 100,000 | own_rows | prolific | 4,249,133 | 32.90 | 93,051,986 / 247,660,544 |
| 100,000 | keys | empty | 1,635,665 | 0.49 | 93,081,726 / 7,340,032 |
| 100,000 | keys | prolific | 5,565,967 | 25.26 | 102,974,789 / 355,008,512 |
| 1,000,000 | summaries | empty | 94,702,079 partial | unfinished after 2077 | 360,495,695 at observation / unqualified |
| 1,000,000 | summaries | prolific | 94,702,079 partial | unfinished after 2077 | 360,495,695 at observation / unqualified |
| 1,000,000 | public | empty | 101,430,852 partial | unfinished after 1793 | 302,465,310 at observation / unqualified |
| 1,000,000 | public | prolific | 101,430,852 partial | unfinished after 1793 | 302,465,310 at observation / unqualified |
| 1,000,000 | own_rows | empty | 1,582,095 | 0.54 | 93,088,887 / 7,077,888 |
| 1,000,000 | own_rows | prolific | 116,652,902 partial | unfinished after 1783 | 303,492,531 at observation / unqualified |
| 1,000,000 | keys | empty | 1,582,697 | 0.51 | 93,092,434 / 7,340,032 |
| 1,000,000 | keys | prolific | 96,197,547 partial | unfinished after 1773 | 363,574,454 at observation / unqualified |

The 1m public-summary and full-public replicas are byte-identical for empty
and prolific viewers; their row/held-metadata SHA-256 comparisons are in
[browser-identical-payloads.json](browser-identical-payloads.json). Their
failed public-payload observation applies to both, not two independent runs.
The empty own-row/key replicas completed normally with only the public window.

The four distinct 1m browser failures acknowledged at least 1,000,000 staged
rows, then did not settle the final acquisition. We stopped them after capturing
the lower bounds above. The summary tab remained responsive; IDB database
listing also stayed pending. Browser/renderer CPU stopped advancing. None
produced a completed-replica result. CDP storage usage remained below quota.
Renderer high-water RSS (KiB), including wasm/JS/native browser allocations:

- summaries: 5,371,948.
- public: 4,097,912.
- own_rows: 4,523,392.
- keys: 5,301,668.

This is **environmental/unresolved** qualification failure: all four alternatives
are affected, including controls without owner-key coverage. The persistence
implementation is unchanged; the root cause has not been isolated to Chromium
or the existing persistence path. The implementation is not advertised as a
qualified million-key browser solution. See the
[open follow-up](../../../issues/20260928-snapback4-million-row-indexeddb-acquisition-stalls.md).
The harness now records progress and times out explicitly after 25 minutes.
Its corrected small-case success and forced 1 ms timeout paths were exercised.

## Wasm and JavaScript

Same toolchain and environment before/after: Rust 1.97.0, wasm-bindgen 0.2.127,
no wasm-opt, `CARGO_INCREMENTAL=0`, fresh bindgen output. Node 24.13.1 and Bun
1.3.14. The baseline was built before editing engine code and retained outside
the commit for the actual older-device refusal test.

| Build | Raw | GNU gzip-9, build-script convention |
| --- | ---: | ---: |
| Baseline | 2,019,815 B | 585,384 B |
| Owner-key implementation | 2,017,908 B | 585,100 B |
| Delta | −1,907 B | −284 B |

Budget stays **586,193 B**: 1,093 B headroom. No budget, meter or dependency
was raised. This reuses existing maintenance/partition machinery; new marker,
serde and coverage paths still have real runtime/storage costs. Compiler
code-layout/optimization accounts for the net binary reduction; it is not
proof of zero implementation cost. [wasm.json](wasm.json) has hashes and
filename-free GNU gzip sizes (25 bytes below the build-script form).

The unchanged JS source bundles measure online 95,984 raw / 27,778 gzip B,
local-first 192,359 raw / 55,072 gzip B ([bundle.log](bundle.log)). That script
uses Node zlib and reports wasm gzip 587,895 B; the enforced wasm budget uses
GNU gzip, so these compressor results are kept distinct.

## Verification and every failure

The required `scripts/test.sh` was run **once**, with all phases allowed to
finish. Its full output is [full-suite.log](full-suite.log); saved logs normalize
trailing whitespace without changing messages or summary lines.

Exact final summary:

```text
== 1 failure(s) in 1862 s
   cargo test
```

All other phases pass, including wasm budget, package/chat/Expo typechecks,
fixture wrappers, client tests (3,845 passed, 10 skipped; 464 s) and client
models (79 passed; 275 s). The ten existing skips require macOS media
frameworks or explicitly supplied managed/legacy binary fixtures; these are
qualification limits, not new test failures. The sole
failed phase was the four introduced Rust fixture assertions below; all were
fixed and rerun in affected scope. The full suite was not rerun.

The original Rust phase had exactly four failed tests, all **ours**:

- `readauth::census::authoring_census`: the new guide repost/unrepost now
  maintain the private owner projection. Reviewed and added exactly these
  two read-rule census sites; all 81 authorization tests pass afterward.
- `timeline_adoption::check_and_adoption_agree_across_expiry_through_changes_and_following_presence`:
  its online-only rewrite left the new suffix behind. The fixture now removes
  that suffix when disabling sync.
- `timeline_adoption::deploy_removal_uses_the_same_destructive_flag_as_maintained_views`:
  retiring the feed intentionally preserves source owner-key projections;
  the assertion now checks that only these remain.
- `timeline_adoption::redefinition_refuses_atomically_and_delivery_keeps_running`:
  the alternate copy of the guide needed to rename its newly added likes table.

All 15 timeline-adoption tests pass after these fixture updates. These fixes
change tests/census only; the product implementation exercised by the full
suite is unchanged. No second full-suite invocation hides its original red.

Affected checks: five owner-key device tests, three compiler tests, the whole
92-test guide, 81 readauth tests and 15 timeline-adoption tests pass. The final
builder lifecycle run and native-kill/wasm-save-abort witnesses pass. All 19
native cost arms and the isolated million-key arm finish successfully.
`git diff --check` and the 1,500-line Rust source cap pass. Ref-check passes;
its final count is recorded in the log. Schema tests were moved unchanged to
`schema/tests.rs` to keep `schema.rs` below the existing cap.

Earlier failed development commands are retained and classified **ours**:

| Log/attempt | Failure and resolution |
| --- | --- |
| `check.log` | Three `Index::new` compile errors; used the existing `Index::of` constructor. |
| `device-test1.log` | Memory and SQLite fixtures tried to resume a crashed snapshot owner's transfer; they now assert refusal and restage. |
| `device-test3.log` | Memory and SQLite tests exposed missing explicit held groups for owner-key snapshots; server now emits the caller group, including empty. |
| `guide1.log` | Two failures: the guide's retired `recipe` keyword check and aggregate card word target. Reworded the social example and shortened existing comments. |
| `guide2.log` | Word target remained one failing check; corrected the counted language card. Whole guide then passes. |
| `acceptance-run1.log` / JSONL | Witness expected loading, but the existing scalar SDK exposes unknown as `E_OFFLINE`; accepts that unavailable outcome and asserts raw unknown. |
| `acceptance-run2.log` / JSONL | Composed post lacked its author's profile; explicitly seeded the test personas' profiles. |
| `cost1.log` | Rust SQLite binding did not accept u64 sequence; checked value is passed as i64. |
| `fixture-cost.log` | The raw-row control tried to write an engine-recorded field; its cloned control schema treats captured public data as ordinary fields and excludes feed slots. Remaining arms rerun successfully. |
| `browser1.log` | Vite emitted `entry.mjs`, not `entry.js`; corrected the fixture server. |
| `browser4.log` | Intentionally stopped the first million-row browser attempt before any case completed to replace OFFSET/2,000-row replay with keyset/10,000-row paging. No partial result is claimed. |
| `faults.log` | Native opener backend file uses an `initial_backend` envelope; witness now unwraps it. |
| Old-wasm first invocation (tool transcript) | Missing required kept-state constructor string; corrected to empty string, then verified `E_SCHEMA_CAPABILITY`. |
| Final staged whitespace check | Newly staged logs contained trailing whitespace/blank EOF lines; normalized log whitespace and reran the check successfully. |
| Source-cap command (tool transcript) | Guessed a nonexistent `check-source-size.mjs` path; directly enumerated Rust source lengths instead. None exceeds 1,500. |

The explicit injected save/adoption/meter failures and baseline old-capability
refusal are expected assertions in passing tests, not unreported regressions.
No baseline product failure has been identified. Long shared-host build/test
times are environmental timing evidence, not passing the documented 60-second
suite target. SQLite is built with `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`
on this host to avoid the known serialized memory-management bottleneck;
this does not change transaction or durability semantics.

The four distinct million-row browser runs above are additional
**environmental/unresolved** measurement failures. No complete acquisition or
complete IDB byte total is claimed. Deliberate termination produced the final
`Target page, context or browser has been closed` errors in their logs. Native
results and completed smaller browser cases remain separately identified.
Initial DevTools attachment/pause and module-scope lookup attempts did not
retrieve the browser object (ours; `browser-debug*.log`); the later Playwright
context lookup captured storage, responsive-tab and Web Lock evidence.
An initial diagnostic attached before the prior inspector released its port,
and the first issue-file write used the wrong directory (ours); both were
corrected without product changes. The forced 1 ms harness timeout is an
expected failing check, saved separately
in `browser-timeout-check.json`, not another capacity observation.

## Reproduce

From `snapback4/`, with existing worktree dependencies and the stated tools:

```sh
CARGO_INCREMENTAL=0 LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo test -p snapback4-lang --test own_keys --test guide
CARGO_INCREMENTAL=0 LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo test -p snapback4-device --test own_keys --test readauth
CARGO_INCREMENTAL=0 LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo test -p snapback4 --test timeline_adoption
node experiments/p19-one-query/owner-coverage.mjs
node experiments/p19-one-query/owner-faults.mjs
OWNER_KEY_COST_DIR=target/owner-key-cost cargo test -p snapback4-device --test own_keys_cost costs -- --ignored --exact --nocapture
OWNER_KEY_COST_DIR=target/owner-key-cost OWNER_KEY_FIXTURE_COPY=<owned-byte-copy> cargo test -p snapback4-device --test own_keys_cost fixture_costs -- --ignored --exact --nocapture
node experiments/p19-one-query/owner-browser.mjs
python3 experiments/p19-one-query/verify-inputs.py
```

The public SDK harness expects the copied app at P19 `.work/ok/app`; do not
point it at the supplied evidence. Measurement paths are ignored worktree
artifacts; report JSON/logs contain the durable results, not store contents.
