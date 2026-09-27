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


## Round 2 — 2026-09-27

Read the lane prompt, earlier report and journal entries, and both round-1
reviews in full. First fetched and merged `origin/main` `dde688548` as
`f630aad9a`, preserving OW's sidecar ownership, both journal histories and
both LLP revision histories. Runtime/tests/LLP are committed as `a9428c4b2`.
All three requested findings are addressed; no other implementation changed.

### Built, file by file

Paths are relative to `snapback4/`, except the LLP.

- `crates/snapback4-device/src/device/store_identity.rs`: the published
  restore check now accepts a snapshot as evidence independently of the request
  cursor. A same-store snapshot below the published watermark persists
  `E_STORE_RESTORE`, including `more: true` with no `images_at` during upgrade.
- `packages/snapback4/src/local-assets.ts`: parse the download receipt before
  the `once` early return, and inspect the current entry inside the serialized
  operation. A foreign-store `once` response preserves a confirmed replacement
  entry and its live URLs. Current-store `once` invalidation remains; no `once`
  body enters durable storage.
- `crates/snapback4-device/tests/asset_lists.rs`: two restore regressions
  exercise the exact 5000/100 watermark, requested-zero, nonterminal page on
  memory/SQLite. Existing scalar/list upgrade cases now interrupt after the
  terminal snapshot, inspect the actual device metadata, reopen with transfer
  zero and the same queued intent, and publish only after catch-up.
- `packages/snapback4/test/asset-lists.test.mjs`: both native and wasm run
  Astra's held-A-once/B-ordinary ordering, requiring B's live URL and offline
  bytes before and after reopen. Four scalar/list upgrade cases now fail
  catch-up after the terminal snapshot, reopen, preserve the intent, finish
  acquisition and verify offline bytes. Two restore cases require a persistent
  refusal, halted follow/explicit sync and no outbox send after refusal,
  including reopen.
- `packages/snapback4/test/asset-blob-lifecycle.test.mjs`: a serialized cache
  regression queues the foreign `once` response while the new ordinary entry
  is still being validated, then proves the ordinary bytes survive and the
  `once` body is never copied. Existing current-store invalidation still passes.
- `../llp/3000.019-what-the-builder-still-wrote.rfc.md`: §3.5 records these
  restore, invalidation and terminal-publication boundaries.
- `JOURNAL.md`: one appended dated round-2 entry.
- `reports/20260927-lane-a5-list-offline.md`: this round-2 section; earlier
  reports remain intact.

### Forms and regression evidence

No new authoring form. Existing `images: image <=10000 ?` and
`images: [image <=10000] <=4 ?`, with
`assets: { keep: "viewed", maxBytes: 10000 }`, still recover unchanged rows
through `await client.sync(); await client.asset(id)` and retain the bytes on
offline reopen. Existing `secrets: [image <=10000 once] <=4 ?` serves a
transient view and remains uncached; its delayed old-store response now leaves
a replacement's ordinary download intact.

The restore fixture supplies Grok's exact shape: published/restore watermark
5000, snapshot watermark 100, requested cursor zero, `more: true`, no
`images_at`. Initial acquisition succeeds; healthy upgrade at the published
watermark still finishes. A test-only dispatch hold prevents a write from
racing ahead of the restore evidence; the hold is released after the refusal,
and follow/flush get 1.4 seconds to retry. No new sync or mutation transport
occurs, and reopening preserves the halt and queued intent. The separate
terminal-interruption fixture holds dispatch so the snapshot alone is under
test and server rows remain unchanged. These holds are fixture-only; no runtime
send or retry policy changed.

Affected checks on final source:

- Client list/Blob targets: **60/60** (36 list/HTTP cases, 24 Blob cases).
- Clock and all `store-reset*.test.mjs` targets: **73/73**.
- Device media/list/upgrade cases: **10/10**; store-reset cases **10/10**;
  retained history **20/20**; deferred boundaries **6/6**.
- Whole guide **86/86**; frozen Bun install, native/package build and package
  typecheck pass. Changed source files stay below 1,500 lines.
- Reference audit before the report/journal append: **515 LLP docs, 9,569 refs
  in 27,050 files, 0 errors, 0 unchecked**. Whitespace check passes.

Three failing controls are retained in ignored `target/a5-evidence/`:

1. Leaving `published_restore` unchanged fails both new device restore tests:
   `observe_store` returns success instead of `E_STORE_RESTORE`.
   Log: `round2-restore-old-predicate.log`.
2. Stamping the format while staging the terminal snapshot fails both device
   upgrade tests at “terminal snapshot is not publication.”
   Log: `round2-premature-stamp.log`.
3. Removing the serialized `once` store guard fails both native/wasm held-once
   tests when reading B's revoked live URL.
   Log: `round2-once-unguarded.log`.

Every temporary mutation was restored; final affected checks pass. Initial
client fixture failures were corrected before the full run: device metadata
must be read from raw storage rather than the client-prefixed metadata API,
and pending dispatch must be held until the boundary being tested. None
required another product change.

### Wasm and scope

Production `scripts/build-wasm.sh`, Rust 1.97.0 / wasm-bindgen 0.2.127,
`CARGO_INCREMENTAL=0`, no wasm-opt:

| Artifact | Raw B | Gzip B |
| --- | ---: | ---: |
| Round 1 | 1,980,804 | 571,975 |
| Round 2 | 1,980,820 | 571,988 |
| Round-2 delta | +16 | +13 |

Final gzip is **853 B below main's unchanged 572,841 B ratchet**, and **147 B
above main's recorded 571,841 B artifact** (raw difference +567 B against
main's recorded 1,980,253 B). The full suite reproduced the final measurement.
Raw SHA-256:
`8748eaf2d95b77d1242a887e87105722719231bd38f83cf4ea964a7ff783d79e`.
Whole-artifact measurements; no per-component attribution or budget increase.

No scope deviation. Server placement, authorization, meters, package versions
and public APIs remain unchanged. No push or publication.

### Required complete suite

Ran `scripts/test.sh` **once**, on implementation commit `a9428c4b2`,
exit **0**. Exact final summary:

```text
== 0 failure(s) in 1455 s
```

Every phase passed. Rust compiled **236 test binaries**, ran **949 executions**
and workspace doctests: **3,795 passed, 0 failed, 24 intentional ignores**;
Rust phase **964 s**. Ordinary clients across the main process and seven shards:
**2,580 tests, 2,570 passed, 0 failed, 10 skipped**; client phase **195 s**.
All **78 client model tests passed**, no failures or skips; model phase **259 s**.
Native/wasm builds, docs budget, release guard, package typecheck/build, chat
check, chat/Expo typechecks and fixture wrapper tests all passed.

Environment: Node 24.13.1, Rust 1.97.0, wasm-bindgen 0.2.127;
`CARGO_INCREMENTAL=0`, `CARGO_PROFILE_TEST_DEBUG=0`,
`CARGO_PROFILE_DEV_DEBUG=0`, `CARGO_BUILD_JOBS=8`,
`SNAPBACK4_RUST_TEST_PROCESSES=8`, `FORCE_COLOR` unset. The suite chose its
normal parallel client scheduling (host load 2.22 across 96 CPUs). No test
count, timeout, assertion or runtime ceiling was relaxed.

**Every full-suite failure:** none — no lane-owned, baseline or environmental
failure to classify. No full-suite rerun. Full log:
`target/a5-evidence/round2-full-suite.log`; recorded exit:
`target/a5-evidence/round2-full-suite.exit`.

**Open problems:** none known in the requested scope. The report retains the
three reproducible failing controls above; none is present in the final tree.

**Commits:** `f630aad9a` (merge), `a9428c4b2` (two runtime fixes, regressions
and LLP), followed by the report/journal evidence commit. Every commit carries
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`. Nothing was pushed or published.

Final post-documentation reference audit: **515 LLP docs, 9,569 refs in 27,050
files, 0 errors, 0 unchecked**; `git diff --check` passes. Full-suite log SHA-256:
`9186528832fa4f6be8f9a8f82f808fddf700ed4539c5665a48e3346e5f72d4bb`.

## Round 3 — 2026-09-27 (final round)

Read the lane prompt, rounds 0–2 reports and journal entries, and both round-2
reviews in full: Grok READY and Astra READY WITH CHANGES. No merge, push or
publication. This round changes only the requested restore classification,
its regressions, receipt-less `once` coverage and the associated records.

### Built, file by file

Paths are relative to `snapback4/`, except the LLP.

- `crates/snapback4-device/src/device/store_identity.rs`: reject a snapshot
  continuation (`after` present) below published progress with `E_GENERATION`
  before either restore check can persist a halt. Infer snapshot-as-head only
  from a fresh first page. Preserve actual same-store restore refusal.
- `crates/snapback4-device/tests/asset_lists.rs`: memory/SQLite regressions
  stage A at watermark 1, advance the real engine, publish B at 2, capture 2
  for A, then request its old continuation. Both nonterminal and terminal
  responses retain 1; observation and application must return `E_GENERATION`,
  retain B's five rows and watermark, and remain healthy after reopen. The
  host-mediated scenario persists and reopens owners between turns; the HTTP
  test below supplies simultaneous native owners. Restore tests retain the
  original empty 5000/100 page and add a populated 12/7 page, both nonterminal,
  requested from zero without `images_at`, with durable refusal after reopen.
- `packages/snapback4/test/asset-lists.test.mjs`: one real HTTP regression
  keeps native owner A open while B publishes into their shared SQLite store.
  `createLocalClient` captures B's progress before requesting A's old,
  nonterminal continuation; it receives `E_GENERATION`, never a durable
  `E_STORE_RESTORE`, and reopened offline queries retain B's touched row.
- `packages/snapback4/test/asset-blob-lifecycle.test.mjs`: parameterize current
  `once` invalidation with valid, absent and malformed receipts. Keep an ordinary
  Blob URL live until invalidation; assert URL revocation, manifest and file
  removal, exactly one ordinary-byte copy/write, no `once` body retention,
  transient-Blob ownership and offline refusal after cache reopen. No change
  to `local-assets.ts` was needed.
- `../llp/3000.019-what-the-builder-still-wrote.rfc.md`: narrow §3.5 to fresh
  first pages, state the pinned-continuation exception and receipt-less `once`
  invalidation, and record the regression evidence and revision.
- `JOURNAL.md`: one appended dated round-3 entry.
- `reports/20260927-lane-a5-list-offline.md`: this round-3 section.

### Forms and affected verification

No new Quarry or public client API. The existing forms remain:

- `images: image <=10000 ?` — scalar upgrade and offline reopen.
- `images: [image <=10000] <=4 ?` — list retention under
  `createLocalClient({ ..., assets: { keep: "viewed", maxBytes: 10000 } })`,
  then `await client.sync(); await client.asset(id)`.
- `secrets: [image <=10000 once] <=4 ?` — a transient `await client.asset(id)`;
  `Accept-Ranges: none` invalidates current cached ordinary bytes even without
  a valid home receipt, and retains none of the response body.
- Snapshot `after: <A's token>, from: 0`, with published/captured watermark 2
  and pinned page watermark 1 — `E_GENERATION`; a fresh snapshot below 2 still
  supplies restore evidence. Same-head snapshots keep their existing path.

Final affected Rust checks: device media **12/12**, retained history **20/20**,
deferred boundaries **6/6**, device store-reset **10/10**, whole guide **86/86**.
Frozen Bun install, native build, wasm build, package build and typecheck pass.
Affected list/Blob, all server-clock and all store-reset clients: **175/175**,
zero failures or skips (55.991 s). List/Blob alone account for 63 cases.
Reference audit: **515 LLP docs, 9,571 refs, 0 errors, 0 unchecked**; whitespace
check passes. Changed source files are at most 656 lines.

### Named mutations: all fail

Temporary Rust edits were compiled and tested one at a time, then restored.
The JS controls temporarily edited the generated `dist/local-assets.js`, then
restored it; no mutated source or generated artifact is committed.
Logs: `target/a5-evidence/round3-mutant-<name>.log`; machine-readable outcomes:
`round3-rust-mutations.json` and `round3-blob-mutations.json` in that directory.

| Mutation / evidence name | Failing regression | Result |
| --- | --- | --- |
| Restore round-2 continuation behavior (`overtaken-round2`) | `overtaken_snapshot_memory/sqlite` | exit 101; 2 failures |
| Require empty snapshot events (`restore-empty-events`) | `media_upgrade_restore_memory/sqlite`, populated page | exit 101; 2 failures |
| Hardcode watermark 100 / published 5000 (`restore-hardcoded-watermarks`) | same tests, 12/7 page | exit 101; 2 failures |
| Remove snapshot restore arm (`restore-old-predicate`) | both original upgrade-restore regressions | exit 101; 2 failures |
| Change published `<` to `<=` (`restore-equal-head`) | healthy equal-head scalar/list upgrades on both stores | exit 101; 2 failures |
| Stamp format at terminal staging (`premature-format-stamp`) | terminal-interruption upgrade tests on both stores | exit 101; 2 failures |
| Remove serialized `once` store guard (`once-unguarded`) | foreign-store serialized Blob test loses ordinary file | exit 1; 1 failure |
| Guard on `!receipt || foreign store` (`once-receiptless-guard`) | absent and malformed `once` cases retain stale ordinary bytes | exit 1; 2 failures |

All affected checks were rerun with the mutations removed. During fixture
construction, the HTTP witness was corrected to expect an omitted optional
refusal field and checked recovery only after reopening. Round 4 replaces that boundary
with required recovery in the still-open owner.

### Wasm, scope and remaining boundary

Production `scripts/build-wasm.sh`, Rust 1.97.0 / wasm-bindgen 0.2.127,
`CARGO_INCREMENTAL=0`, no wasm-opt:

| Artifact | Raw B | Gzip B |
| --- | ---: | ---: |
| Round 2, measured before edits | 1,980,820 | 571,988 |
| Round 3 | 1,980,999 | 572,131 |
| Round-3 delta | +179 | +143 |

Final gzip is **710 B below the unchanged 572,841 B budget**. Whole-artifact
measurement. Before SHA-256:
`8748eaf2d95b77d1242a887e87105722719231bd38f83cf4ea964a7ff783d79e`;
after SHA-256:
`8f84511926747dcc06525d6c2bcf342326243fcb1911011d576119a587ff79f3`.
Artifacts and logs are under ignored `target/a5-evidence/round3-*`.

No design or scope deviation. Server placement, authorization, meters, budgets,
package versions and public spellings are unchanged. The extra populated restore
fixture addresses Grok's named surviving mutations within the requested restore
regression scope.

The open-owner adoption defect observed in this round is fixed in round 4 below.

### Required complete suite

Implementation/tests/LLP commit: `36247cf00`, with the required co-author trailer.

Ran `scripts/test.sh` **exactly once**, on implementation commit `36247cf00`,
exit **0**. Exact final summary:

```text
== 0 failure(s) in 1488 s
```

Every phase passed. Rust: **236 test binaries, 949 executions plus workspace
doctests; 3,797 passed, 0 failed, 24 intentional ignores** (1,008 s). Ordinary
clients across the main process and seven shards: **2,583 tests, 2,573 passed,
0 failed, 10 skips** (195 s). Client models: **78/78 passed**, no failures or
skips (262 s). The full script reproduced **1,980,999 B raw / 572,131 B gzip**.

**Every full-suite failure:** none — no lane-owned, baseline or environmental
failure to classify. No full-suite rerun.

Environment: Node 24.13.1, Rust 1.97.0, wasm-bindgen 0.2.127;
`CARGO_INCREMENTAL=0`, `CARGO_PROFILE_TEST_DEBUG=0`,
`CARGO_PROFILE_DEV_DEBUG=0`, `CARGO_BUILD_JOBS=8`,
`SNAPBACK4_RUST_TEST_PROCESSES=8`, `FORCE_COLOR` unset. The script chose normal
parallel client scheduling at host load 7.97 across 96 CPUs. No assertion,
timeout, count or runtime ceiling was relaxed.

Full log: `target/a5-evidence/round3-full-suite.log`; exit:
`target/a5-evidence/round3-full-suite.exit`; log SHA-256:
`0fb4b438e83ec8238a9ebbefe00f7d9884e72615b8b7ef1a2bcdb9758e459ce9`.

Commits: `36247cf00` (runtime, tests and LLP), followed by the round-3
report/journal record. Both carry
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`. Nothing pushed or published.


## Round 4 — 2026-09-27

Merged `origin/main` `3a1f8b55d` first as `221fd3012`, preserving both sides
of the LLP revision and journal conflicts. This includes published 0.4.4,
DQ's Darwin changes and 0.4.5 lane GN. Read the lane prompt, reports and
journal through round 3, and Astra's complete round-3 review. No push or
publication.

### Built, file by file

Paths are relative to `snapback4/` except the LLP.

- `crates/snapback4-device/src/device/store_identity.rs`: replace the two
  restore predicates and published-only continuation guard with one fresh-head
  versus captured-floor comparison. A continuation's pinned watermark supplies no fresh head,
  regardless of terminality; explicit image heads retain their meaning. Before observation/application it must still match
  the staged owner, cursor and cut. Request captures, never subsequently staged
  private progress, supply the restore floor. Existing send/publication fences
  and durable incarnation-bound refusal remain.
- `crates/snapback4-device/src/device.rs`: pass the current snapshot owner into
  the shared observation routine.
- `packages/snapback4/src/local.ts`: preserve the captured interpreter adoption
  requirement with `backendRequired ||= !!observation.backend_required`.
- `crates/snapback4-device/tests/asset_lists.rs`: memory/SQLite tests now cover
  B staging or publishing, terminal/nonterminal continuations, `observe_store`
  and application, durable health after reopen and eventual acquisition. Two further tests reject borrowing published
  progress for a legacy snapshot with no capture, with healthy offline reopen. Four more
  tests protect independent stream-rewind proof and explicit snapshot heads.
- `crates/snapback4-device/tests/repair_b/round8.rs`: prove a fresh first
  snapshot at 15 below captured private image head 20 halts through observation
  and application and survives reopening, despite published watermark 5.
  Correct the existing healthy-disposal fixture to start at head 20; it still
  proves private image evidence survives replacement/reopen and rejects 15.
- `packages/snapback4/test/asset-lists.test.mjs`: four real HTTP orderings with
  simultaneous native owners, A at cut 2 and B at 3, staged/published crossed
  with terminal/nonterminal. Each requires `E_GENERATION`, no durable halt,
  and acquired, adopted, touched-row offline reads from A before closing,
  followed by offline reopen.
- `packages/snapback4/test/asset-blob-lifecycle.test.mjs`: add valid JSON
  `{"store_id":"old-store"}` without home coordinates to `once` invalidation;
  require ordinary file/manifest removal, live-URL revocation, no body copy
  or retention, and offline refusal after reopen. The parser needed no edit.
- `../llp/3000.019-what-the-builder-still-wrote.rfc.md`: §3.5 records the
  unified proof, continuation preflight, adoption and incomplete-receipt case.
- `reports/20260927-lane-a5-list-offline.md`: this section; remove the resolved
  owner-adoption limitation note from round 3.
- `JOURNAL.md`: one dated, appended round-4 entry; existing entries preserved.

### Rule, forms and scope

The restore rule is **same incarnation + a fresh response head below evidence
known before that request**. Explicit image heads supply head proof, including on snapshots. Without them,
terminal stream heads and first snapshot pages supply a head. A stream rewind
below its requested cursor is independent proof even when an image head is
higher. A snapshot continuation's watermark is only a pinned cut; its current
lease determines whether to retry. This replaces the ordering-specific
restore cases. A concurrent private advance cannot retroactively condemn a
healthy response or erase a restore already proved against its captured floor. Missing capture echoes contribute no published/private floor;
a legacy response attests only its requested cursor. A delayed first snapshot
without capture can retry but cannot borrow a newer shared watermark to halt.

The governing context is LLP 3000 (root), LLP 3000.019 §3.5 (current working
set), LLP 3000.007 §18.2 (current working set), and LLP 3000.001 Repair B
(private evidence versus publication). The current assets/sync guide forms
remain authoritative. No new LLP or review hand-off was needed.

Existing forms compile and run:

- `images: image <=10000 ?`: scalar acquisition and upgrade.
- `images: [image <=10000] <=4 ?`, with
  `createLocalClient({ ..., assets: { keep: "viewed", maxBytes: 10000 } })`
  and `await client.asset(id)`: viewed ordinary list elements survive offline.
- `secrets: [image <=10000 once] <=4 ?`: transient views, no durable bytes;
  an incomplete home receipt cannot protect stale ordinary bytes.
- `await client.sync(); await client.query(query, {})`: the still-open owner
  adopts shared published identity and answers the touched row wholly offline.
- Snapshot `{ from: 0, after: A_token }` at pinned cut 2 after B reaches 3:
  `E_GENERATION` whether B merely stages or publishes, even for terminal pages.

No implementation-scope deviation. The deliberate fixture change above follows the requested
simplification: a fresh head below captured private evidence is a real restore,
not a healthy disposal case. No server placement, authorization, meter, public
API, package version or budget change was introduced by round 4.

### Verification and mutations

The expanded HTTP witness was first run against the merged round-3 runtime:
**0 passed, 4 failed**. Both B-published cases fail the open-owner adoption
assertion; staged nonterminal observation wrongly succeeds; staged terminal
observation returns `E_STORE_RESTORE` instead of `E_GENERATION`. The fixed
runtime passes all four, including A's offline touched-row query before close.

Every temporary mutation was restored. Rust controls compile successfully and
exit 101 at assertions; JS controls exit 1. Logs and outcome JSON are in ignored
`target/a5-evidence/round4-*`.

| Mutation | Detected failure |
| --- | --- |
| Restore round-3 logic | 2 staged memory/SQLite failures, `E_STORE_RESTORE` versus `E_GENERATION` |
| Restore round-2 logic | 4 staged/published memory/SQLite failures |
| Borrow shared published watermark when capture is absent | 2 delayed legacy snapshot failures |
| Remove continuation preflight | 4 observation failures on both stores |
| Require empty first-page events | 2 populated 12→7 restore failures |
| Hardcode restored/published 100/5000 | 2 populated 12→7 restore failures |
| Remove nonterminal snapshot-as-head proof | 2 upgrade restore failures |
| Change head `<` floor to `<=` | 2 healthy equal-head upgrade failures |
| Omit captured private image head from floor | 2 fresh-snapshot private-restore failures |
| Stamp format at terminal staging | 2 interrupted-upgrade failures |
| Remove foreign-store `once` guard | 1 serialized replacement-cache failure |
| Preserve receipt-less `once` bytes | 3 absent/malformed/incomplete receipt failures |
| Remove table/row/column receipt type checks | 1 incomplete-JSON receipt failure |
| Overwrite captured adoption requirement | 2 published-owner HTTP failures |
| Let an image head mask a stream rewind | 2 memory/SQLite restore failures |
| Ignore explicit image heads on snapshots | 2 memory/SQLite false-halt failures |

The initial affected Rust run passed 14 media tests and 106/108 Repair B tests;
the two failures were the synthetic healthy-disposal fixture at 15 after known
head 20, corrected as described above. This is an intentional stronger restore
classification, with a new explicit refusal test, not a removed assertion.
The legacy no-capture regression initially needed an `Option<String>` versus
`Option<&str>` assertion correction; its compiled negative control then failed
on both stores with the actual false `E_STORE_RESTORE`. Calls without capture
evidence now retry backwards progress rather than borrowing shared publication
as proof of restore; normal captured clients retain durable restore protection.

Before the complete run, affected Rust checks passed: **16/16** media/restore, **110/110** Repair B,
**20/20** retained history, **6/6** deferred boundaries, **10/10** store reset,
and **2/2** background durability. Affected clients: **179/179**, including 40 list/HTTP and 27 Blob cases.
Whole guide: **86/86**. Frozen Bun install,
native build, package build/typecheck and whitespace check pass. Across the round, all 16 mutation
controls fail; none is left in the tree. The changed source files stay below
1,500 lines (largest: `local.ts`, 1,471).

### Wasm

Same host and production `scripts/build-wasm.sh`, Rust 1.97.0,
wasm-bindgen 0.2.127, no wasm-opt, `CARGO_INCREMENTAL=0`:

| Artifact | Raw B | Gzip B |
| --- | ---: | ---: |
| Merged round-3 baseline (`221fd3012`) | 1,980,999 | 572,111 |
| Round 4, final correction | 1,981,512 | 572,053 |
| Delta | +513 | −58 |

Final gzip is **788 B below the unchanged 572,841 B budget**. The single
full run measured the pre-correction artifact at 1,981,526 raw / 571,954 gzip. Whole-artifact
measurement. Raw SHA-256 before:
`08b07d72fa83b95a388e197287263473c936d53c56c8047cc849c0ca3fd60492`;
after: `5436a3d17dc29dbee2148bbad942ddea866526e48f9d159e96be5a6c18fe1969`.
Artifacts and logs are retained under ignored `target/a5-evidence/round4-*`.

### Required complete suite

Ran `scripts/test.sh` **exactly once**, with implementation commit `21900c545`,
exit **1**. Exact ending:

```text
== 1 failure(s) in 1440 s
   client tests
```

Rust passed: **237 test binaries, 950 executions plus doctests; 3,819 passed,
zero failed, 24 intentional ignores** (960 s). Client models: **78/78 passed**
(257 s). All build, budget, release-guard, typecheck, fixture and app phases
passed. Ordinary clients: **2,602 tests, 2,587 passed, 5 failure records,
10 skips** (195 s).

Every failure was lane-owned; no baseline or environmental failure occurred:

1. `acquisition.test.mjs`, “W5R1x wasm: a restore halt keeps acquisition false
   across retries and reopen”: the refactor let a higher `images_at` mask a
   watermark below the request cursor, so the client did not halt.
2. The same acquisition assertion on the process/native tier.
3. `horizon-boundary.test.mjs`, “wasm rejects a skipped snapshot page before
   accepting its completion”: the earlier preflight returned a different
   diagnostic string. The `E_GENERATION` classification was correct.
4. `repair-b-round9.test.mjs`, “native: snapshot-restart head 20, snapshot true”:
   the refactor ignored its explicit image head and treated the lower selection
   cut as a head, causing a false restore.
5. The Repair B parent test's cascading failure from item 4.

Reproduce on `21900c545` with a package/native/wasm build, then
`node --test packages/snapback4/test/acquisition.test.mjs packages/snapback4/test/horizon-boundary.test.mjs packages/snapback4/test/repair-b-round9.test.mjs`.

The follow-up preserves the single request-bound comparison while retaining
independent stream-rewind proof, explicit image-head precedence, and the existing
continuation diagnostic. Existing failing client assertions remain unchanged.
Four new Rust regressions fail on the pre-correction runtime, then exercise both
stores with the fix. The correction is qualified separately below; **the original
full run remains red and was not repeated**.

Environment: Node 24.13.1, Rust 1.97.0, wasm-bindgen 0.2.127, Bun 1.3.14;
`CARGO_INCREMENTAL=0`, `CARGO_PROFILE_TEST_DEBUG=0`,
`CARGO_PROFILE_DEV_DEBUG=0`, `CARGO_BUILD_JOBS=8`,
`SNAPBACK4_RUST_TEST_PROCESSES=8`, `FORCE_COLOR` unset. Normal parallel clients,
host load 2.52 across 96 CPUs; no counts, timeouts or assertions relaxed.

**Final correction: `bc82b1f2b`.** Expanded affected clients: **376/376**, zero
failures/skips (126.903 s), including the unchanged acquisition, horizon-boundary
and all `repair-b*.test.mjs` tests. This covers every full-run failing assertion
and the four HTTP staged/published × terminal/nonterminal orderings, including
same-open-owner offline reads. Final Rust: **20/20** media/restore, **110/110**
Repair B, **20/20** retained history, **6/6** deferred boundaries, **10/10**
store reset and **2/2** background durability. Corrected native, wasm and package
builds pass. Logs: `target/a5-evidence/round4-corrected-*`.

**Open problems:** no known remaining requested implementation defect. The
verification limitation is explicit: the once-only full script remains red on
`21900c545`; the post-run correction has expanded affected qualification, not a
green full-script rerun. The failure reproductions and exact result are retained
above. No assertion was weakened or removed to obtain the correction's passes.

Full log: `target/a5-evidence/round4-full-suite.log`; recorded exit:
`target/a5-evidence/round4-full-suite.exit`; SHA-256:
`f5b14453b029544ba13788c769a52ae4e01a93e19abda863c6c17bd9357caaf9`.

Commits: `221fd3012` (merge), `21900c545` (initial round-4 implementation),
`bc82b1f2b` (complete-suite corrections and head-proof regressions), followed by
the report/journal evidence commit. Every commit carries
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`. Nothing pushed or published.

Final reference audit: **515 LLP docs, 9,586 refs, zero errors and zero unchecked**;
whitespace check passes. The journal diff appends one round-4 entry and removes
no existing line.
