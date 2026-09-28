# Lane OS — round 4, device cuts preserve current search

**The blocking device-cut discard is fixed. Freshness follows emitted rows.
The retained-filter mutation now fails. The unchanged wasm cap still fails.**
Nothing pushed or published. Prior reports remain [round 0](./ROUND0.md),
[round 1](./ROUND1.md), [round 2](./ROUND2.md) and [round 3](./ROUND3.md).
This round's logs and measurements are under `round4/`; gzip files retain the
original output. No tool was installed or shared path changed.

First ran `git fetch origin && git merge origin/main`; already up to date at
`d2b561fb3` on `sb4-intent/os-ordinary-search`, with origin/main `80036b466`.
Read the four binding prompts, reports and journal entries, the complete Grok
round-1/2 NOT READY review, earlier reviews, Snapback 4 fence/rules, governing
LLPs and current search guide. Applied llp-orient read-only using the populated
lane-a5 copy; this lane's skill symlink remains unpopulated.

## Changes and limits

1. **Unresumable device cuts preserve the proved server stream.** A cut device
   scan cannot establish the newest retained hit: the 40-word fixture includes
   a newer retained row in an undiscovered word, as well as a returned retained
   candidate. Merging those candidates as if they were a complete head would
   be unsound. The coordinator publishes the server's proved current rows,
   with `complete: false` and the constituent cut. Its cursor advances the
   server only through emitted rows and leaves the device position unchanged.
   A bounded `localCut` flag suspends that device source for the continuation;
   otherwise a later retry could place newer retained rows behind emitted
   current rows. A new first-page request can retry the device. If there are
   no proved server hits either, an explicit E_BOUND names the repair: narrow
   the search or search one chat. No empty non-progressing cut page is published
   by this device-cut path. Server refusals and delivery fences remain authoritative.
2. **Keep exhausted read counters without resetting the ledger.** The real
   8,192-hit scan records examined 8,193, including the rejected charge. Before
   this correction, the SDK rejected that receipt before contacting the server.
   SDK resumption now accepts that recorded read overrun only with a meter cut,
   and keeps it unchanged. A delivery-only Rust state observation can retain
   exhausted examined/index/probe dimensions and spend the remaining heap,
   step and output allowance. Query resumption stays strict; further work in
   an exhausted dimension still fails, all counters stay monotone, and the
   ceilings are unchanged. This is the same ledger, not another allowance.
3. **Completeness: prove it or explain the missing proof.** The blanket claim
   that any departure prevents completeness is too broad: the horizon-free
   process/wasm controls already return complete empty answers. No new
   completeness override was needed. Windowed unscoped words remain incomplete
   even if the stored rows happen to be exhausted. Their range does not pin a
   group, so the device cannot use its per-group acquisition boundary and
   records an unknown fact. The Left list is membership state, not a range
   proof. This conservative limit is documented in the guide and existing
   [coverage issue](../../../issues/20260928-snapback4-empty-retained-search-coverage.md).
   A complete server page cannot clear it. The SDK seam also checks that two
   complete exhausted constituents produce a complete empty answer.
4. **Freshness follows emitted rows.** Only a page emitting retained rows has
   `fresh: false` and `since`. A current-only page is fresh, even with Left
   scopes or an incomplete device source. Completeness stays independent.
5. **Strengthen the retained guard tests.** The guard itself was already correct
   in round 1 and remains unchanged. New raw-device tests put a current row
   ahead of the retained row and require only the retained row from the scan,
   before SDK deduplication. Another test edits current `m000` to timestamp
   3000 with a new body without syncing: it appears on page one once, and its
   old device image never appears later. Traversal checks all 65 oracle IDs.

The device still uses its bounded unscoped scan and can spend its word/read
budget on current hits. This fix takes the user's permitted incomplete-device
alternative: such cuts publish an explicitly incomplete current subset, not a
claim that all retained hits were retrieved or globally merged. Normal resumable
mixed pages retain their previous ordered merge. No new device merge engine,
server invocation, synced data, public Read field or durable search session.
The combined cursor still contains no room IDs, unconsumed server keys or Left set.

**Already handled before this round:** round 3 removed the unused plan payload;
`pagination_epoch_excludes_progress_but_delivery_fence_keeps_it` still asserts
that `search_state` has no `plan`. Its independent delivery/continuation identity,
audience-binding and comparison-meter tests pass again. Round 3 did not fix the
word-cut discard or freshness issue; the new failing-before tests show both.
The five round-0 findings remain covered by the passing original-evaluator,
optional-index, scope-order, standalone-provisioning and empty-server tests.

The deliberate round-0 behavior change remains: an admitted bare membership
word search produces the compact membership page instead of an empty incomplete
server answer. Explicit membership predicates, guards, held operations, system
queries and declined inference keep their established meaning.

## Acceptance matrix

| Requirement | Round-4 evidence |
| --- | --- |
| More than 32 matching words | Process and wasm pass with 40 current word variants and two retained hits, one in an undiscovered newer word. Two pages publish all 40 current IDs once, with device `words` cut, honest consumed cursors and terminal incompleteness. |
| 8,192 newer current hits before one departed hit | Process and wasm prove the raw device meter cut, empty device result, no device next and examined 8,193 including the rejected charge. Two requested pages emit the exact 40 newest current IDs, one server call per page. The source stays suspended on the continuation. |
| Persistent cut across coordinator loss | Four SDK cases cover words/meter × empty/nonempty device candidates. A fresh coordinator returns the remaining current rows, never a newly available newer retained candidate, and keeps the original cut. |
| Simultaneous constituent cuts | SDK traversal preserves the server meter cut while draining and the device word cut through the terminal page; exactly one invocation per page and all current IDs once. |
| Shared allowance | Rust and SDK tests retain rejected read charges, reject decreases and additional exhausted work, and still refuse heap/step/output/write overruns. Real capped receipts pass both host delivery-state checks. Existing decoder/comparison exhaustion tests remain green. |
| No usable head or progress | SDK test requires E_BOUND with a repair instead of an empty dead end when a device word cut coincides with no server hits. |
| Exhaustion and absence | Both hosts prove complete horizon-free empty answers after departure. Windowed controls stay incomplete/unknown; the guide explains why. SDK accepts two complete empty constituents. |
| Freshness | Both hosts check fresh current-only first pages, stale mixed later pages and since only on retained output. Cut current-only pages are also fresh/incomplete. |
| Retained-only device source | Raw process/wasm scan excludes a newer current row. The at-changing edit traverses exactly 65 distinct IDs and never the stale body. Broadening the filter fails both process cases and the Rust Held/Rejoined guard test. |
| Retained dominates page one / consumed prefix / ties | Existing 65-ID process/wasm traversal passes, including 20 retained first-page hits, unconsumed server prefix and Unicode full-key ties. |
| One invocation / server drain | Existing real 4,077-scope drain plus SDK cut traversal pass again. No automatic refill. |
| Membership, sync and lifecycle | Existing hidden/older-message sync continuation, unsynced audience gain/loss, page-chain refresh, delivery race, reset/reopen, expiry and rejoin cases pass again on their existing hosts. |
| Mounted React | Existing browser/wasm current/departed/offline/rejoin witness passes. Expo remains separately unwitnessed. |
| Round-0 compiler/evaluator controls | All 16 ordinary, 24 membership and 11 merge Rust cases pass again. |
| Full builder u0500 / coffee and searchChat matrix | Round 1's 501-page / 10,014-unique-ID traversals, floor/current/departed/link/rejoin matrix, guarded NOT_MEMBER and builder-specific 245-scope × 32-word drain remain historical evidence. The full copied store was not rerun this round. |
| Whole guide | All 92 tests pass, including the updated cut, freshness and exhaustion explanation. |

## Qualification and negative controls

Final affected qualification: 71 Rust tests (51 server/search, 12 device merge,
4 meter and 4 state/retained-guard tests), 61 JavaScript search cases including
process, wasm and mounted React, and 92 guide tests. Client build/typecheck,
36 codec/family tests, wasm family/absence attribution, original input hashes,
reference audit (522 LLP docs, 9,782 refs, zero errors/unchecked) and whitespace
checks pass. Final artifact reruns follow every
restored mutation. Logs distinguish earlier development results from the final
passes; no test or resource ceiling was weakened.

Executed negative controls, each restored:

| Restored defect / mutation | Failing regressions |
| --- | --- |
| Device-cut discard | 4/4 SDK words/meter × candidate cases fail. Original real word-cut cases also fail before implementation on both hosts. |
| Strict SDK receipt resumption after a meter cut | Both real 8,192-current process/wasm tests fail. |
| Retry the cut device source on continuation | 4/4 SDK reopened-coordinator cases fail. |
| Freshness based on any Left scope | All 4 process/wasm × horizon/window cases fail. |
| Always incomplete combined result | Both horizon-free process/wasm absence cases fail. |
| Broad delivered-history filter plus strict state resumption | The independent Rust retained guard and delivery-state regressions both fail; the two existing epoch tests still pass. |
| Strict observation resumption | The Rust read-counter preservation test fails. |
| Broad delivered-history filter in rebuilt native device | Raw scan returns currentHead; later-page test repeats stale m000. Both dedicated process tests fail. |

Per instruction, **did not run scripts/test.sh**: round 3 ran it exactly once.
Its historical exact summary remains:

```text
== 2 failure(s) in 1682 s
   wasm build
   client tests
```

Round 3 repaired both lane-owned codec assertions afterward; their 36-test
regressions pass here too. That historical full-suite result is not relabeled
as a green round-4 suite. No fresh full-suite or publication qualification claimed.

## Wasm

Canonical `scripts/build-wasm.sh`, same Rust 1.97.0 / wasm-bindgen 0.2.127,
GNU file-input gzip -9, no wasm-opt:

| Artifact | Raw bytes | Gzip bytes |
| --- | ---: | ---: |
| Round 3 | 2,039,892 | 592,307 |
| Round 4 | **2,039,944** | **592,440** |
| Change | **+52** | **+133** |

The additional Rust branch preserves a finished scan's rejected read charge
through delivery observation; SDK cutoff/freshness logic is outside wasm.
Round 3's descriptor, state/digests, ledger, dispatch, retained filter and shared
code attribution still applies; its unused plan serializer remains removed.
Compared with round 0, total composition growth is 20,129 raw / 7,062 gzip bytes.
The unchanged 586,193 B cap fails by **6,247 B** (ours: inherited excess plus
this round's 133 B). The supervisor decides that budget. Exact hash and toolchain
are in `round4/wasm-size.json`; no budget was raised.

## Every failure and classification

- **Ours, reproduced lane defects:** initial SDK run: 13 pass / 6 fail (four
  cut cases, empty-dead-end refusal and freshness). Initial real run: 4 pass /
  6 fail; two word-cut and two freshness failures reproduce lane defects.
- **Ours, fixture expectation:** the other two initial real failures expected
  examined 8,192; Rust receipts include the rejected 8,193rd charge. The first
  post-SDK-fix real run still had those two failures (36 pass / 2 fail).
  Corrected the assertion without changing the actual 8,192-hit fixture.
  The strict-receipt mutation then separately reproduced the product refusal.
- **Ours, fixture expectation:** the first full affected JS run after the
  receipt correction had 56 pass / 2 fail because the new horizon-free control
  correctly reported complete while the draft assertion expected incomplete.
  Split windowed and horizon-free controls; both are required and now pass.
- **Ours, fixture setup:** first device-state Rust run failed all four cases
  because an added retain line duplicated one already in the fixture. Removed
  only that duplicate; all four pass afterward.
- **Ours, expected negative controls:** every mutation failure is listed above
  and retained in its log. All temporary source/generated-output changes were
  restored, and native/device artifacts rebuilt before final tests.
- **Ours, wasm budget:** both canonical builds produce the artifact and then
  fail the unchanged cap at 6,247 B over. This is not a main-baseline failure.
- **Ours, operational commands:** guessed core/device and helper paths and the
  unpopulated skill symlink failed read-only inspection; several log probes
  preceded log creation. One Revised-line patch lacked the full matching line
  and changed nothing; the exact line was subsequently updated. No evidence
  store, shared installation or other lane was changed.
- **Baseline:** no qualification failures. **Environmental:** none observed.
  Existing feature-specific compiler warnings remain warnings, not failed tests.

Reproduction from `snapback4/` uses cargo tests for `snapback4-sim` ordinary_search,
membership_search and search_merge; `snapback4-device --test device search_merge`
and `--lib search::tests`; `snapback4-core --lib meter::tests`; and
`snapback4-lang --test guide`. After native/wasm/client builds, run node tests for
ordinary-search, ordinary-search-ledger and review-probes together with
`--test-concurrency=1`. Cargo uses CARGO_BUILD_JOBS=8, CARGO_PROFILE_DEV_DEBUG=0,
CARGO_PROFILE_TEST_DEBUG=0, CARGO_INCREMENTAL=0,
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT and RUST_TEST_THREADS=8.
The local commit carries `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
