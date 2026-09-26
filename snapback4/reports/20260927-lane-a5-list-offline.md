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
