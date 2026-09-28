# Lane OS — round 3, pagination review repairs

**Both blocking pagination defects are repaired, with failing-before controls.
The comparison-meter gap is covered. Wasm remains above the unchanged cap.**
Nothing pushed or published. [Round 0](./ROUND0.md), [round 1](./ROUND1.md) and
[round 2](./ROUND2.md) preserve their reports and full failure ledgers. New logs
and measurements are in `round3/`; `.gz` files contain the original text/JSON.

First fetched and merged `origin/main` (`80036b466`) into
`sb4-intent/os-ordinary-search`, from round-2 commit `2c6489ff6`. Merge commit
`5febc518d` keeps both journal tails and combines the new device-control/restore
checks with OS's streamed decoding and one-invocation publication marker.
Both `serverOnly` and `searchAttempt` remain in the result contract. No lane's
changes were discarded. Read all three binding prompts, prior reports and OS
journal entries, the Snapback 4 fence/rules, governing LLPs, current search guide
and Astra's full round-1/2 NOT READY review. Grok's file had progress text but
no verdict at the start; did not wait. Used `llp-orient` read-only from the
populated lane-a5 skill copy. No tool was installed and no other worktree changed.

## Repairs

1. **Separate continuation from delivery.** `search_state` now returns a stable
   `epoch` and a broader `delivery` digest. The epoch binds store incarnation,
   backend identity/generation, acquisition validity and this table's scope
   membership (current versus Left). It excludes the global watermark, send and
   transfer progress, unrelated tables' groups, and delivered row IDs inside a
   current rejoined group. Those changes remain in the delivery capture, together
   with the complete retained-state map. A sync or older-message edit between
   pages preserves consumed positions; the same sync during response delivery
   still withdraws that response. Retention transitions and reset still invalidate.
   These are digests of existing state, not new persistent epochs or sessions.
2. **Bind the server audience.** The combined cursor contains SHA-256 of the
   complete, authorized `searchScopes` opening. The server already sorts and
   deduplicates that proof by Value order; no new disclosure or server evaluator
   is added. The coordinator validates the proof on every successful response,
   even with no retained scopes, and charges its JSON/UTF-8/hash scratch and work
   to the existing device allowance. A mismatch returns loading, with no stale
   rows or continuation and no second invocation. Live page chains withdraw and
   reobserve their requested first page, then replace the old suffix using the
   new first-page cursor. A one-shot caller receives loading and can request a
   fresh first page. The original request is never silently retried. Rejoin
   overlap with Left scopes still waits for sync before composition is allowed.
3. **Comparison exhaustion.** Fixed remaining-step cases reach mixed-source
   time comparisons and equal-time Unicode ID comparisons. Enough steps returns
   the independently expected order; one fewer refuses E_BOUND with no partial
   data. Deleting both charges fails both cases; deleting only the time charge
   fails both; deleting only the ID charge fails the tie case while the time
   case still passes. The tests no longer survive Astra's mutation.
4. **Wasm diet.** Removed the unused plan response and redundant retained Boolean;
   the SDK already has the descriptor and can inspect the Left list. Ledger
   records use the canonical text codecs instead of extra typed-to-JSON-Value
   serializers. Copying the six identity metadata entries directly avoids a
   generic map-removal path. Exact measurements and attribution follow below.
5. **Full-suite codec repair.** The suite caught round 1's direct server audience
   serializer outside the canonical codec module. It now uses `to_buffer` in
   that module, preserving the same prepaid Vec, serialized bytes and meter.
   The two census assertions and all affected search tests pass after the fix;
   rebuilding wasm gives the identical final artifact. No census exception added.

The original deliberate behavior change remains: a bare membership-audience word
search changes from an empty incomplete server answer to the compact membership
page when admitted. Guards, explicit membership predicates, held operations,
system queries and declined inference candidates keep their established meaning.
No authorization rule, resource ceiling, cursor limit or public Read field changed.

## Acceptance matrix

| Requirement | Round-3 evidence |
| --- | --- |
| Unrelated hidden sync | Pass on process and wasm. Copied Astra reproduction first fails; final traversal emits all 65 oracle IDs exactly once, with stable epoch and one invocation per page. |
| Older-message edit followed by sync | Same failing-before/passing-after result on both hosts; full traversal remains ordered without repeated retained rows. |
| Unsynced server audience gain | Pass on both hosts with no retained scopes. Old suffix is loading, fresh page includes timestamp-2000 `newmessage`, and the cursor audience changes. Removing the digest comparison fails both. |
| Unsynced server audience loss | Pass on both hosts. Old suffix withdrawn; fresh page contains only currently authorized room rows. Removing the check fails both. |
| Live page-chain recovery without sync | Pass on both hosts through the `Pages` implementation used by `usePage`. Exactly one stale-suffix call, one fresh-root call and one fresh-suffix call; 40 unique ordered rows beginning with `newmessage`. Removing the check fails both. |
| Broader delivery fence | Pass on both hosts. Hidden write plus sync while a reply is held withdraws that reply without refetch; the next requested page resumes under the unchanged epoch. |
| Relevant local epoch | Two Rust tests cover watermark/send/transfer progress versus delivery, row IDs in rejoined groups, unrelated table groups, membership/retention and cleared acquisition. |
| Mandatory server proof | Current-only SDK case with a missing audience proof withholds; no retained scopes are needed to activate validation. |
| Shared ledger and comparisons | Real device prepaid exhaustion remains green. New time and equal-time ID step boundaries reject all three charge-removal mutations. Stream decoding and both state checks continue the original ledger. |
| Retained dominates first page | Process/wasm 65-ID traversal remains green: 20 retained hits leave all fetched server hits unconsumed, full-key Unicode ties preserved. |
| One invocation and mixed drain | Existing real 4,077-live-scope drain and synthetic cut-stream traversal pass again, including under the added audience-digest charges. No automatic drain/refill. |
| Departure during delivery, link change, reset, reopen | All existing real process/wasm and coordinator cases pass. |
| Retained edits, expiry, rejoin, complete empty server | Existing cases pass again; no whole-result server replacement. |
| Round-0 compiler/evaluator fixes | All 16 ordinary-search tests pass again, alongside 24 membership and 11 merge tests: system compatibility, optional admission, scope-first provisioning, standalone capture, hidden populations and explicit/guarded/held controls. |
| Mounted React | Existing browser/wasm same-query current/departed/offline/rejoin witness passes again. New page-chain cases exercise the actual paging resource on both hosts. Expo remains separately unwitnessed. |
| Full builder u0500 / coffee | Round 1's two 501-page / 10,014-unique-ID traversals remain evidence; not rerun on the full copied store this round. |
| Builder searchChat floor matrix and guarded searchIn | Round 1's current/departed × online/offline floor, rejoin and NOT_MEMBER controls remain evidence. No per-chat code changed in this round. |
| Builder-specific 245-scope × 32-word drain | Round 1's two-page one-invocation evidence remains, distinguished from the current real-fixture rerun. |
| Whole guide | 92 passed / 0 failed, including the updated search guidance. |
| Codec funnel | Full suite caught two lane-owned assertions; the canonical prepaid-buffer helper repairs both. All 36 codec/family tests and the 51 Rust / 41 JS affected reruns pass. |

Astra's fixture was copied from
`/tmp/os-review-astra-SnwlDy/snapback4/packages/snapback4/test/review-probes.test.mjs`.
Only diagnostic logging that assumed a data result was removed before the first
run. The copied six cases all failed on the merged pre-fix binary and wasm.
The fixture now also asserts request counts, full traversal and fresh recovery.

## Wasm measurement and remaining bytes

Canonical `scripts/build-wasm.sh`, Rust 1.97.0, wasm-bindgen 0.2.127,
GNU file-input `gzip -9 -c`, no wasm-opt:

| Build | Raw bytes | Gzip bytes |
| --- | ---: | ---: |
| Merged rounds 1–2, before edits | 2,044,274 | 593,309 |
| Remove only unused plan response | 2,039,006 | 591,908 |
| Separate continuation/delivery state | 2,040,214 | 592,389 |
| Canonical ledger codecs and no redundant Boolean | 2,040,059 | 592,404 |
| Include digest work reservation | 2,040,062 | 592,408 |
| Final: copy identity fields without generic removal | **2,039,892** | **592,307** |

Removing the plan alone saves **5,268 raw / 1,401 gzip bytes**. The additional
codec/Boolean cleanup saves 155 raw bytes but adds 15 gzip bytes through layout;
its retained benefit is one canonical serializer family, not a claimed gzip win.
The final map-copy simplification saves another 170 raw / 101 gzip bytes.
Net round-3 change: **−4,382 raw / −1,002 gzip bytes**. Compared with round 0's
2,019,815 raw / 585,378 gzip artifact, composition still costs **20,077 raw /
6,929 gzip bytes**. The unchanged **586,193 B** cap is exceeded by **6,114 B**.
The supervisor decides the budget. This lane has not raised it.

Final artifact SHA-256:
`35ce9ef347e691e5305ee45d1959dca0ff61d8b97fe920cdbb84a8bdad86a73e`.
`round3/wasm-size.json` records the toolchain, intermediate sizes and hash.

A symbol-bearing build of round 0 (`5a94ba1f8`, archived only under this
worktree's ignored target directory) and the final source gives the following
remaining composition groups. These are **shallow pre-bindgen symbol deltas**,
not additive gzip shares; bindgen removes unreachable code and compression is
shared across groups. The exact classified symbols are retained in
`wasm-delta-attribution.json.gz`.

| Group | Symbol delta | Why it remains |
| --- | ---: | --- |
| Composition descriptor | +6,539 B | Read/write/clone the compiler descriptor in adopted backend schema, so the device can recognize the admitted retained-only scan. The redundant response serializer is gone. |
| State fences and containers | +5,547 B | Inspect and meter retained groups; separate delivery from stable membership/incarnation identity; return bounded state and digests. No persistent search registry. |
| Ledger records and resumption | +5,145 B | Decode prepaid Metered counters, reject resets/overruns, and export the existing allowance. Both hosts and both state observations share it. |
| Device dispatch and query adapter | +1,126 B | Internal search_state and search/spent arguments plus routing into the original device evaluator. |
| Named retained-only filter | +279 B | Exclude current/rejoined rows from the retained lane while retaining existing row authorization and expiry. |
| Data segments | +520 B | Descriptor/ledger field names and bounded-call diagnostics. |
| Shared code and layout | +2,738 B | Descriptor integration into Execution decoding/cloning/lookups; existing canonical map digest/text writer; local observation and scan-consumed dispatch, iterator and allocation specializations. Individual changes are listed in the attribution artifact. |
| Total pre-bindgen delta | **+21,894 B** | Differs from the shipped +20,077 raw bytes because this census precedes bindgen. |

`attribute-wasm --families --check-families --check-absent` passes. The typed
ledger and descriptor records have canonical text serializer/readers; server
membership opening and the TypeScript merge/SHA implementation are absent from
wasm. The SHA helper already exists in the SDK; no dependency was installed.

## Qualification and every failure

Final affected results before the full suite:

- **53 Rust tests passed:** 16 ordinary search, 24 membership search, 11 merge,
  plus two new device-state tests (`affected-rust`, `device-state-compact`).
- **41 JavaScript tests passed:** real process, wasm, mounted React, page-chain,
  lifecycle and coordinator cases (`affected-js-final`).
- **92 guide tests passed** (`whole-guide`). Native/client builds and client
  typecheck pass. Reference audit: **522 LLP docs, 9,780 refs, 0 errors,
  0 unchecked**. Original program/SQLite/WAL hashes remain unchanged.
- Mutation edits were confined to generated SDK output and restored before the
  final build/tests. No tests or caps were relaxed.

Ran `scripts/test.sh` **exactly once**, exit 1. Exact summary:

```text
== 2 failure(s) in 1682 s
   wasm build
   client tests
```

Rust: **4,203 passed / 0 failed / 31 ignored**. Client tests, including all seven
isolated shards: **3,965 passed / 2 failed / 10 skipped** (main run 3,909/2/10;
shards 56/0/0). Models: **79 passed / 0 failed**. Fixture wrappers: **9 passed**.
Native build, docs budget, release guard, package build/typecheck, chat app check,
and both app typechecks pass. The two failing steps are classified below.

After the suite exposed the codec violation, repaired it and reran **36
codec/family tests, 51 affected Rust tests and 41 affected JavaScript tests**:
all pass (`codec-census-fixed`, `affected-rust-post-suite`,
`affected-js-post-suite`). Rebuilt native/client and canonical wasm; the wasm
hash/size is identical and still fails only its cap. The affected JS rerun uses
these rebuilt artifacts, including the mounted React case. The full-suite log
remains the original red result; it was not rerun or relabeled green.

Failure ledger, including expected-red development runs:

- **Ours, reproduced defects:** all six copied review probes fail before the
  fixes (`review-before`): hidden sync, older-message edit sync and unsynced
  new membership, each on process and wasm. These are lane defects inherited
  from rounds 1–2, not main-baseline or environmental failures.
- **Ours, intentional mutation failures:** both comparison charges removed
  gives 2/2 failures; time-only removal gives 2/2; ID-only removal gives 1/2
  (the tie case). Removing audience comparison gives 6/6 failures: gain, loss
  and live-chain recovery on both hosts. Every mutation is restored.
- **Ours, test setup:** the first two Rust metadata tests compiled a namespaced
  `search.q` fixture, then looked up unqualified `search`, so the state was null
  and their delivery assertions failed. Changed the fixture to `schema.q` and
  added a direct descriptor-admission assertion. Both corrected tests pass.
- **Ours, operational setup:** the local llp-orient symlink is unpopulated;
  read the existing lane-a5 skill copy instead. Some discovery reads named
  absent guessed files. Three edit scripts incorrectly repeated `snapback4/`
  while already inside it; they changed no source and were corrected. The
  resulting first ledger calibration import and early not-yet-created log-tail
  probes also failed before correction. These are not product-test failures.
- **Ours, expected wasm cap:** every changed canonical build is over the cap;
  all produce an artifact before the budget exits 1. The final failure is
  6,114 B over, not a baseline-main failure. No ceiling raised.

- **Ours, full-suite client assertion 1:** `web-reachable typed JSON calls all
  use the codec funnel` (`wasm-codec-census.test.mjs:6`). Round 1 introduced a
  direct `serde_json::to_writer` at `membership_search.rs:93`. The census
  correctly rejected it. Fixed through the canonical prepaid-buffer helper.
- **Ours, full-suite client assertion 2:** `census kills parse, encoded, MQ
  components and container regressions` (`wasm-codec-census.test.mjs:10`). The
  same real violation made its intentional one-violation fixture report two.
  The same fix restores this assertion; both are included in the 36 passing
  codec/family checks. Neither is a baseline-main or environmental failure.
- **Baseline/environmental:** none among this round's qualification failures.
  Earlier reports retain their own historical failures; they are not counted
  as failures of this invocation.

All reports distinguish historical builder evidence from this round's reruns.
The broader RFC, Expo recipe qualification and fresh calibration-score claims
remain outside this round. No publication qualification is claimed.

From `snapback4/`, reproduction uses:

```sh
cargo test -p snapback4-sim --test ordinary_search --test membership_search --test search_merge
cargo test -p snapback4-device --lib search::tests
cargo test -p snapback4-lang --test guide
cargo build -p snapback4
bash scripts/build-wasm.sh # expected unchanged-budget refusal
bun run --cwd packages/snapback4 build
bun run --cwd packages/snapback4 typecheck
node --test --test-concurrency=1 packages/snapback4/test/ordinary-search.test.mjs packages/snapback4/test/ordinary-search-ledger.test.mjs packages/snapback4/test/review-probes.test.mjs
node scripts/attribute-wasm.mjs --families --check-families --check-absent
bash scripts/test.sh
# After repairing the two suite codec assertions, rerun the affected commands above
node --test packages/snapback4/test/wasm-codec-census.test.mjs packages/snapback4/test/wasm-families.test.mjs
```

Cargo checks used CARGO_BUILD_JOBS=8, CARGO_PROFILE_DEV_DEBUG=0,
CARGO_PROFILE_TEST_DEBUG=0, CARGO_INCREMENTAL=0,
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT and RUST_TEST_THREADS=8.
The one full-suite invocation also used NODE_OPTIONS=--max-old-space-size=4096
and an open-file limit of 65,536. Local commit carries
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
