# Lane A5 — list media retained offline

2026-09-27; `sb4-intent/a5-list-offline`, baseline `674998886`.
Implementation port from `sb4-intent/a-asset-lists`, after reading the lane-A
report through round 3 and both model families' round 0–2 review records.

## Delivered behavior

Confirmed sync indexes media-bearing **rows**, and validates ordinary scalar,
list and nested-list elements under the ledger home supplied by a successful
HTTP download. The receipt includes the store identity captured with the grant.
A readable legacy reference, even with copied facts, cannot become custody.
Removal, clear, deletion, expiry, generation changes, partition leave and
store replacement retire retained bytes. Reorder keeps them. `once` remains
uncached. Existing `client.asset`, `assetSource` and `useAsset` spellings remain.

## File map

Paths are relative to `snapback4/` unless explicitly prefixed `../`.

- `crates/snapback4-core/src/engine/mod.rs`: `AssetGrant` captures ledger home
  and store ID in the authorization transaction. No placement changes.
- `crates/snapback4/src/assets.rs`: emit the percent-encoded JSON receipt in
  `X-Snapback-Asset-Home`, expose it through CORS, omit it for upload previews.
  Preserve the integrated latency completion hooks.
- `crates/snapback4-device/src/device/media.rs`: recursive media kind and
  element lookup; acquired-row/generation markers; receipt, store, row, field,
  membership, pending and expiry validation via the local authorized reader.
  Keep stream helpers borrowed through `StreamTx`.
- `crates/snapback4-device/src/device.rs`: pass the table identity when retiring
  snapshot and partition media markers.
- `crates/snapback4-device/src/device/deferred.rs`: retire those markers on
  rejected or deleted deferred images and ordinary stream replacements.
- `crates/snapback4-device/src/call.rs`: pass the internal download receipt to
  the device home validator.
- `packages/snapback4/src/local-assets.ts`: require and persist a confirmed,
  store-bound receipt; revalidate it on retention/read/reconcile/reopen; purge
  old cache entries without that authority.
- `crates/snapback4-device/tests/asset_lists.rs`: four new tests, each lifecycle
  covering images, optional videos and nested image lists on memory or SQLite.
- `crates/snapback4-device/tests/device_scenarios/mod.rs`: existing scalar and
  501-row leave tests now supply receipts and reject absent/foreign store IDs.
- `crates/snapback4-device/tests/repair_b_boundaries.rs`: six existing deferred
  boundary tests validate receipt-based access instead of the retired per-ID
  metadata key; synthetic pages identify the store.
- `crates/snapback4-device/tests/retained_history.rs`: existing media history
  cases use store-bound receipts and pages.
- `packages/snapback4/test/asset-lists.test.mjs`: port the 18 reviewed HTTP,
  process-device and wasm cases and add four expiry/generation cases.
- `packages/snapback4/test/asset-blob-lifecycle.test.mjs`: receipt-aware fixtures
  plus five tests for invalid receipts, old manifests and store binding.
- `packages/snapback4/test/server-clock.test.mjs`: receipt-aware expiry fixture.
- `packages/snapback4/test/store-reset-review.test.mjs`: receipt-aware download
  fixtures preserve existing recovery and invalidation assertions.
- `crates/snapback4-lang/src/guide.rs`: replace the scalar-only offline sentence
  with list retention, identity/reorder/removal behavior and old-cache policy.
- `../llp/3000.019-what-the-builder-still-wrote.rfc.md`: new §3.5 records
  calibration #22, the landed M5 server fix, this device port and evidence.
- `../issues/closed/20260926-snapback4-list-asset-offline-cache.md`: ticket
  resolution and verification boundary, moved from the open working set.
- `JOURNAL.md`: one appended dated entry with implementation and measurements.
- `reports/20260927-lane-a5-list-offline.md`: this report.

## Forms

No new Quarry syntax or public client API was introduced. These existing forms
now retain viewed ordinary elements offline:

- `photos: [image <=100] <=4`: required image list; tested with two elements,
  reorder, removal, clear and deletion.
- `photos: [video <=100] <=4 ?`: optional video list; tested on both device
  stores with video facts and the same lifecycle.
- `photos: [[image <=100] <=2] <=2 ?`: the landed server's recursive list form;
  tested through nested membership, order, removal and leave.
- `secrets: [image <=100 once] <=4 ?`: still compiles and serves once; device
  homes are null and web/native offline reads refuse `E_OFFLINE`.
- `createLocalClient({ ..., assets: { keep: "viewed", maxBytes: 10000 } })`
  followed by `await client.asset(id)`: bytes survive close/reopen without
  network when their ordinary home is still held and authorized.

## Tests and evidence

All evidence logs/artifacts are under the ignored `target/a5-evidence/`.

- New `list_lifecycle_memory` / `list_lifecycle_sqlite`: exact reordered query
  arrays, membership of both retained elements, removal of only one, clear,
  local expiry, row deletion, delivered-history leave and cold reopen. Each
  covers required image, optional video and nested image lists; `once` has no
  ordinary home. The final video fixture uses MP4 facts.
- New `list_generation_memory` / `list_generation_sqlite`: a changed generation
  revokes the old acquisition across reopen, reacquisition stamps the new
  generation, and clearing rows withdraws the home again.
- The 22 HTTP/client cases prove the actual server receipt/CORS/preview,
  both native and wasm offline byte equality, exact reorder, element removal,
  deletion and uncached `once`; 12 combined legacy-reference cases cover
  bare/copied facts × real-home revoke/clear/delete × both tiers; two delayed
  replacement tests pin different store IDs at the same generation, completed
  acquisition and an empty manifest before releasing the old response; four
  additional tests cover wholly offline expiry and same-store schema-generation
  change, both immediately and after reopen. All **22 passed** on final source.
- Blob lifecycle's five new tests prove malformed/missing/empty/non-string
  receipt rejection, unconfirmed old-manifest purge, and binding revalidation
  on read, reconcile, reopen and missing-binding reopen, including byte removal.
- Targeted Rust: new list tests **4/4**, retained history **20/20**, deferred
  boundaries **6/6**, and existing media scenarios **2/2** (each on both stores).
- Existing landed-server `snapback4-core --test asset_lists`: **28/28**, run
  separately because the inherited workspace compile failure skipped test binaries.
- Whole guide target **86/86**. Dependency install, package build and native
  CLI build passed. `ref-check`: **515 LLP docs, 9547 refs in 27025 files,
  0 errors, 0 unchecked**. Changed source files remain below 1,500 lines.
- Initial combined client check: **93/94**; one imported assertion expected
  enriched facts in a mutation return, but the landed server returns its
  original list argument there. Corrected that witness to query the newly
  authorized row and assert stored facts. The complete list target then passed
  **22/22**. This was a lane-owned test adaptation, not a server runtime change.
  The other 72 affected Blob/clock/reset tests passed in that combined check.
- The expiry test uses the existing controllable `ServerClock` to advance
  device time offline, without sleeps or altered server authorization.

## Wasm

Same host, same production `scripts/build-wasm.sh`, Rust 1.97.0,
wasm-bindgen 0.2.127, no wasm-opt installed, `CARGO_INCREMENTAL=0`.

| Artifact | Raw bytes | Production gzip bytes |
| --- | ---: | ---: |
| Unmodified `674998886` baseline | 1,980,253 | 571,842 |
| A5 port | 1,980,173 | 571,839 |
| Delta | −80 | −3 |

Budget stays **570,966 B**. The baseline already exceeds it by **876 B**;
the port exceeds it by **873 B**. Both builds emit artifacts and then exit 1
at the budget gate. This is a whole-artifact comparison, not per-component
attribution. The full suite's wasm step reproduced **571,839 B**.

SHA-256 of retained raw artifacts:

- Before: `1d4fdb281e417df0a24d7338bb189cbebda9710abcc960f8277e13a7bf410e3e`.
- After: `b6c6765f799380919c7c42d672ed48729ce77ac92a2d36477190b69df411588e`.

## Decisions, deviations and open problems

- The landed server remains truth: no lane-A `assets/placement.rs`, parser
  refusals, scalar reservations, automatic legacy repair, or server activation
  policy was ported. `asset_columns.rs` and all existing server semantics stay
  unchanged. Only the receipt fields/emission extend the server.
- The device mirrors landed recursive optional/list membership locally because
  the server asset module is sqlite-only. It traverses the already authorized,
  metered row without allocating a second element list. Acquired-row markers
  implement the reviewed final design, replacing early per-element indexing
  which reviewers demonstrated could turn legacy references into custody.
- Device tests live in `snapback4-device/tests/asset_lists.rs`, where the
  memory/SQLite host harness is maintained; the earlier lane's server-only
  simulator tests were not transplanted over the landed server's tests.
- Receipt-less old cache bytes deliberately require redownload and confirmed
  row acquisition. Public authoring/client spellings, meters, package versions
  and budget are unchanged. No push or publication.
- Open verification problem: inherited wasm overrun. Reproduce with
  `PATH=$HOME/.local/bin:$HOME/.cargo/bin:$PATH CARGO_INCREMENTAL=0 bash scripts/build-wasm.sh`
  from `snapback4/`. The baseline and final logs are preserved. No budget
  increase or unrelated size redesign was attempted.
- Open verification problem: the baseline's
  `crates/snapback4-device/tests/unread_range/counted.rs:43` implements and calls
  `release_asset(id, now)`, while `snapback4-core/src/rows.rs:286` requires
  `(id, table, row, column, now)` with sqlite enabled. Reproduce with
  `cargo test -p snapback4-device --test unread_range --no-run`. Rust reports
  E0050 and E0061, preventing the full workspace artifact build and therefore
  its test-binary execution. Both definitions are byte-for-byte unchanged from
  `674998886`; `git show` confirms the same incompatible definitions there.
  No unrelated test adapter change was folded into this lane.

## Required complete suite

The single required `scripts/test.sh` run uses Node 24.13.1, eight Cargo build
jobs, eight Rust test processes and serial client files, with `FORCE_COLOR`
unset and `CARGO_INCREMENTAL=0`, `CARGO_PROFILE_TEST_DEBUG=0`,
`CARGO_PROFILE_DEV_DEBUG=0`. No runtime limit, test count or assertion was
relaxed. It ran exactly once and exited **1**. Exact ending:

```text
== 3 failure(s) in 2372 s
   wasm build
   cargo test
   client tests
```

All **78 client model tests passed** (zero failures or skips). Native workspace
build, docs budget, release guard, package typecheck/build, chat check,
chat/Expo app typechecks, fixture wrapper tests and workspace doctests passed.
The ordinary client result and full failure list are below. There were no
A5-owned or timing/environmental assertion failures in this complete run.
The workspace Rust test-binary inventory did not execute, so this is not a
green full-suite claim. No full-suite rerun was made.

Every failure, with classification:

1. **Baseline — wasm build:** 571,839 B gzip exceeds the unchanged 570,966 B
   budget by 873 B. The independently built unmodified baseline was 876 B over.
2. **Baseline — cargo test artifact build:** E0050/E0061 in
   `snapback4-device/tests/unread_range/counted.rs:43`, due to the inherited
   `release_asset` trait mismatch described above. Workspace doctests execute,
   but the ordinary workspace test binaries are not run after this compile
   failure. Targeted A5 device and guide results are reported separately.
3. **Baseline consequence — client tests:** `event-slot-capability.test.mjs`
   and `event-slots.test.mjs` fail at import with ENOENT for
   `target/event-slots-traces.json`. Its producer was skipped by (2).
   Reproduction: run either client file on a fresh tree without first running
   `cargo test -p snapback4-device --test event_slots_trace`.
   Diagnostic rerun: that unchanged producer passed **2/2** and generated the
   fixture; the two unchanged client files then passed **48/48** together.
   This supplements, and does not replace, the required full-run result.
   The original ordinary-client summary is **2,506 tests: 2,494 passed,
   2 failed, 10 skipped**, in 1,939 seconds. The two failures are exactly the
   import failures above; no ordinary-client assertion failed.


## Commits

- `b8bf5c327`: receipt-bound retention runtime, existing fixture migrations,
  guide and LLP §3.5.
- `1158caa1b`: list lifecycle and HTTP/native/wasm regressions.
- Final documentation commit: report, closed ticket and one journal entry.

Every commit carries `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.


## Round 1 — 2026-09-27

Read the lane prompt, round-0 report/journal/LLP section and both reviews in
full. Merged `origin/main` `0cca900d8` first, built it, and committed the merge
as `18c3b31e3`. LLP 3000.019 retains A5's full §3.5 and main's §3.6; revision
histories and both journal sides are preserved. Main supplies the unread-range
`release_asset` adapter fix and the **572,841 B** wasm ratchet.

### Built, file by file

Paths below are relative to `snapback4/`, except the LLP.

- `crates/snapback4-device/src/device/media.rs`: define the acquired-row
  media-index format and refuse retention until that format is confirmed.
- `crates/snapback4-device/src/device.rs`: initialize new stores with the
  current format; existing unversioned stores request a normal snapshot from
  zero and remain unacquired for media until snapshot/catch-up publication
  stamps the format. Preserve the published watermark, private restore
  evidence, outbox, predictions and delivered history. Interrupted acquisition
  restarts on reopen; a completed upgrade does not repeat.
- `packages/snapback4/src/local-assets.ts`: an invalid response drops bytes
  only when no confirmed entry exists or its receipt names that entry's store,
  table, row and column. A different receipt leaves newer bytes and URLs intact.
- `crates/snapback4-device/tests/asset_lists.rs`: upgrade, interrupted snapshot,
  outbox/history, exact-column and multi-inner-list witnesses on memory/SQLite.
- `crates/snapback4-device/tests/common/mod.rs`: test-only persisted metadata
  editing on both hosts to represent the shipped old media-index format.
- `packages/snapback4/test/asset-lists.test.mjs`: real HTTP/native/wasm witnesses
  for unchanged scalar/list upgrades, newer-download-before-old-response,
  nested-list movement/empty first list, and same-row `photo`/legacy `refs`.
- `packages/snapback4/test/asset-blob-lifecycle.test.mjs`: exact receipt fixture
  and six regressions for foreign/missing versus matching invalid receipts.
- `crates/snapback4-lang/src/guide.rs`: the assets card now states automatic
  reacquisition, redownload of unconfirmed bytes and preserved queued writes.
- `../llp/3000.019-what-the-builder-still-wrote.rfc.md`: extend §3.5 with the
  upgrade protocol, delayed-response rule and round-1 evidence.
- `../issues/closed/20260926-snapback4-list-asset-offline-cache.md`: append
  the round-1 correction to the original resolution.
- `JOURNAL.md`: one appended dated round-1 entry with measurements and outcome.
- `reports/20260927-lane-a5-list-offline.md`: this round-1 record; round 0 remains.

### Forms and regressions

No new Quarry or public client spelling. Existing `photo: image <=10000 ?`
and `images: [image <=10000] <=4 ?` now recover retention after an upgrade
through `await client.sync(); await client.asset(id)`, with
`assets: { keep: "viewed", maxBytes: 10000 }`. The upgrade fixtures preserve
rows, store id, generation and watermark, project only media metadata to the
shipped old shape (no row markers/version, scalar per-id metadata), then close
and reopen. They sync twice, require exactly one snapshot, download, reopen
wholly offline and require byte equality. No server row is touched.

`images: [[image <=10000] <=2] <=2 ?` is placed by the real server as
`[[a], [b]]`, reordered to `[[b], [a]]`, then moved to `[[], [b,a]]`.
Both bytes survive each offline reopen. Device tests also remove an element
with the first inner list empty. Existing optional video and `once` forms
continue to run; `once` remains uncached.

The same-row witness uses `photo: image <=10000 ?` and
`refs: [image <=10000] <=4 ?`. Its legacy `refs` copy is installed directly in
the stopped fixture database, without moving the real `photo` ledger home.
Clearing `photo` returns HTTP 404 for that asset, while `refs` remains readable;
offline reads and reopen must return `E_OFFLINE`.

The replacement race now has both orderings: an unplaced replacement still
cannot inherit the old download; a placed replacement first downloads and
caches the asset, then receives the old store's held response. Its manifest
stays bound to the replacement, its live URL remains usable and its bytes
survive offline reopen. The cache unit tests independently vary store, table,
row, column and absent receipt; a matching invalid receipt still deletes bytes.

Memory/SQLite upgrade tests additionally preserve a real pending predicted
write, restart an interrupted multi-page snapshot, wait for catch-up before
media authority, retain left text history without media markers, and prove the
format stamp prevents another reacquisition after reopen.

### Verification

Evidence is under the ignored `target/a5-evidence/round1-*` paths.

- Affected clients: **110/110 unique tests**, with the final list/Blob run
  **55/55** and clock/reset cases **55/55**. The list target is now **32/32**;
  Blob lifecycle is **23/23**.
- Device list/upgrade/column cases: **8/8** on restored source. Retained
  history: **20/20**; deferred boundaries: **6/6**.
- Existing scalar media scenarios: **2/2** (both stores); the filtered target
  also ran two matching trending tests, for **4/4**. Server lists: **28/28**.
- Whole guide: **86/86**. Frozen dependency install, package typecheck/build
  and native builds passed. Source files remain below 1,500 lines.
- Four temporary counterfactuals compiled and failed the intended assertions:
  first-inner-list-only traversal **2 failures**; any-column fallback **2**;
  disabled upgrade reacquisition **2**; unconditional invalid-receipt deletion
  **2**, including both native and wasm replacement live URLs. Every mutation
  was restored, then affected tests reran on the final code.
- Final reference audit: **515 LLP docs, 9,567 refs in 27,049 files, 0 errors,
  0 unchecked** after the report/journal append.

### Wasm and scope

Same host, Rust 1.97.0 / wasm-bindgen 0.2.127, production `build-wasm.sh`,
no wasm-opt, `CARGO_INCREMENTAL=0`:

| Artifact | Raw B | Gzip B |
| --- | ---: | ---: |
| Merged 0.4.4 + A5 round 0 (`18c3b31e3`) | 1,980,173 | 571,841 |
| Round 1 | 1,980,804 | 571,975 |
| Round-1 delta | +631 | +134 |

The final gzip is **866 B below** main's unchanged **572,841 B** ratchet.
It is **+134 B gzip** against main's recorded 571,841 B release measurement;
main's recorded raw size is 1,980,253 B, so the cumulative raw difference is
+551 B. Whole-artifact measurements; no per-component attribution.

Preserved raw-artifact SHA-256:

- Merged baseline: `7d84b18c911ad5f88e929e7380b3ff56b91f2554199ee7ed00f35f5d3994d6fa`.
- Round 1: `a71993c5f58fa6bef720e519d2f04ffbbf53bef3dcefb1253d0121fb20a1fb4d`.

No implementation-scope deviation. The required full-run compile failure needed
a corrected Rust-phase rerun, documented below; the full script was not repeated. Engineering choice: preserve the old published
watermark/restore floors and force only the transfer request to zero, rather
than erase progress. This retains restore protection while using the ordinary
confirmed acquisition path. Upgrade fixtures construct the exact older media
metadata shape in a persisted current device; they do not embed an old runtime
in the test suite. Server placement, authorization, meters, version and budget
are unchanged. No push or publication.


### Required complete suite and correction

Ran `scripts/test.sh` **once**, exit **1**. Exact ending:

```text
== 1 failure(s) in 622 s
   cargo test
```

The run used Node 24.13.1, eight Cargo build jobs and eight Rust test processes,
`CARGO_INCREMENTAL=0`, `CARGO_PROFILE_TEST_DEBUG=0`,
`CARGO_PROFILE_DEV_DEBUG=0`, and no `FORCE_COLOR`. Client concurrency used the
suite's normal host-load selection (13.70 across 96 CPUs, parallel files);
no count, timeout, runtime ceiling or assertion was relaxed.

**Every failure:** one **lane-owned** test-helper compile error. The new
`tests/common/mod.rs::patch_meta` referred directly to `rusqlite`, available in
the device test crate but absent from the simulator crate that imports this
shared source. The full Cargo artifact build failed with E0433 at
`snapback4-device/tests/common/mod.rs:133`, from `snapback4-sim`'s
`page_admission` target. Reproduce on `ad160808f` with
`cargo test -p snapback4-sim --test page_admission --no-run`. The helper is now
corrected to open `snapback4_core::store::Store` and use its existing connection;
no dependency was added. The failure is fixed in the final tree, but the
original full-run result remains red and is not relabeled as a green suite.

All other phases passed: native/wasm builds, docs budget, release guard,
package typecheck/build, chat check, chat/Expo typechecks, fixture tests,
ordinary clients and models. Across the main ordinary-client process and
seven shards: **2,575 tests, 2,565 passed, 0 failed, 10 skipped**. All **78
client models passed**. No baseline or environmental failure was reported.
The wasm step reproduced 1,980,804 B raw / 571,975 B gzip. Main's unread-range
trait fix compiled; there was no missing event-trace client import.

To verify the helper across all importers and execute the Rust tests skipped
by the compile failure, ran `node scripts/run-rust-tests.mjs` separately after
correction, with the same Rust environment. This is a rerun of the failed
phase, not a second `scripts/test.sh` invocation. Its result follows below.


**Corrected Rust phase: exit 0.** The complete inventory compiled and ran:
**236 test binaries, 949 executions, plus workspace doctests**, with no failed
execution. This includes the previously blocked simulator `page_admission`
**15/15**, device media **8/8**, server assets **28/28**, unread range **7/7**,
all **86** guide tests, the long disclosure targets and the isolated
performance/lifecycle/witness targets. No runtime code changed after the
successful client and wasm phases. The only source correction was the shared
test helper's connection constructor.

**Open problems:** no known unresolved implementation defect from this round.
The verification limitation is explicit: the once-only full script exited 1;
the corrected complete Rust phase passed separately. There was no second full
script invocation. Reproduction of the fixed failure is pinned above to its
pre-correction commit.

**Commits:** `18c3b31e3` (merge/build), `ad160808f` (runtime, tests, guide and
LLP), and the final helper-correction/report/journal commit containing this
record. All carry `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
Nothing was pushed or published.
