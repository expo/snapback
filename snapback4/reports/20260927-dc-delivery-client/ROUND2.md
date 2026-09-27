# Lane DC, round 2 — review repairs

2026-09-27, `sb4-intent/dc-delivery-client`. This round answers both blind
round-0 reviews and the supervisor's round-2 brief. Round-0 `REPORT.md` and
`ROUND1.md` remain historical records. No push, publication, version change,
budget increase or server implementation.

Merged `origin/main` first in `dfe00e837`, including amendment `54099bc88`.
The only conflict was `JOURNAL.md`; both append-only histories were kept.
The amended safe-integer range is now the contract, rather than round 0's
unresolved numeric deviation.

## Findings and commits

Review numbers in this table refer to the reviewers' own reports, not the
supervisor's consolidated list.

| Commit | Findings answered | Change and regression evidence |
|---|---|---|
| `083952bdf` | Astra 3; Grok test strength | Preserve an uncertain attempt's collection boundary; a lost recorded membership refusal cannot erase post-rejoin collections. Pin 41 and 43 without 42. |
| `3d6019954` | Astra 1/3/4/7/8; Grok 5/7 | Carry the fingerprint from schema/manifest to every report; drop exactly that binding on `E_DELIVERY_BINDING`; reconcile individual changed bindings. Per-attempt collections also survive exhausted/parked retries while another interval runs. Adopt DS's streaming binding decoder and remove a reconciliation clone to trim the new wasm bytes. Unsafe coordinates are omitted. |
| `d692a919f` | Astra 5/6 | Activation waits for session witnessing and the persisted-debt flush, behind outbox work. Failed pages resume the device's durable cursor after bounded 1–60 s backoff until done. |
| `9751439e2` | Astra 2/4/9; Grok 1/2/3/4 and below-floor test strength | Collect only at final publication; omit composed manifests; witness fallback query responses; preserve unchanged generation state; route `E_OFFLINE` through the existing link/reconnect path. Real local-client fallback witnesses and code/guide registration. |
| `283b2c5bd` | Astra 2; Grok 1, full-suite follow-up | Preserve the existing transport-to-loading conversion when publication moves out of `ReadObservation.fetch`. Both existing page regressions pass. Make the old membership test hold the next attempt independently, removing a timer race. |

The card's `RUNS_FULL`, server manifest producer, fingerprint validation under
the writer and receipt-only no-op remain DS's. The client's tests fixture
those responses. DS's current `serve_ephemeral::delivery_fingerprint` and
ordinary mutation handler consume the same request field used here:
`delivery: { fingerprint }`. This is source-interface confirmation, not a
claim of integrated server qualification.

## Files

All paths are relative to `snapback4/`.

| File | Final change |
|---|---|
| `crates/snapback4-core/src/schema/delivery.rs` | Required fingerprint; DS's small streaming binding reader. Three argument names remain mandatory. The in-memory argument container is `Vec<String>`, matching DS; JSON is unchanged except for the amended fingerprint. |
| `crates/snapback4-device/src/device/delivery.rs` | Persist each collected binding's fingerprint. Move old reconciliation JSON instead of cloning it. Existing reconciliation preserves unchanged bindings/cursors and retires changed ones. |
| `crates/snapback4-device/tests/delivery.rs` | Memory/SQLite fingerprint adoption tests and missing/duplicate/extra-argument codec refusals. |
| `packages/snapback4/src/backend.ts` | Compiled fingerprint type. |
| `packages/snapback4/src/delivery-state.ts` | Manifest fingerprint validation, individual binding reconciliation, binding-state removal, per-attempt post-collection tracking. |
| `packages/snapback4/src/delivery.ts` | Fingerprinted request, named mismatch outcome, preserved uncertain-retry boundaries, offline notification, activation flush completion. |
| `packages/snapback4/src/online-delivery.ts` | Forward committed offline outcomes to the client link. |
| `packages/snapback4/src/local-delivery.ts` | Final publication callback inside serialized acceptance, startup/flush/outbox ordering and activation retry. |
| `packages/snapback4/src/local-query.ts` | Carry a pure server manifest to the caller, never persist while evaluating; neither composed path carries delivery. |
| `packages/snapback4/src/local-publication.ts` | One final acceptance callback, idempotent across CAS retries; isolate persistence errors. |
| `packages/snapback4/src/local.ts` | Final rerun/background-refresh/query publication checks; per-query captured restore witness; offline link hook. |
| `packages/snapback4/src/client.ts` | `currentRead` has no delivery side effect; final query/watch/background publication accepts delivery. Preserve bindings through unrelated generations; offline link hook; final expiry check. |
| `packages/snapback4/test/delivery.test.mjs` | Retry, gap, mismatch, reconciliation and unsafe-number regressions. |
| `packages/snapback4/test/delivery-clients.test.mjs` | Actual online generation, sequence-floor, offline/reconnect and final one-shot acceptance witnesses. |
| `packages/snapback4/test/delivery-activation.test.mjs` | Startup-witness/debt ordering and persisted-cursor retry after one failed page. |
| `packages/snapback4/test/delivery-publication.test.mjs` | Real local client, wasm device and server; only fallback can deliver the online-only source. Durability before return, delayed/failed saves, interleaved commit, credential change, expiry, restore and offline recovery. |
| `packages/snapback4/test/prediction-routing.test.mjs` | Both composition paths omit the server manifest. |
| `packages/snapback4/test/helpers/delivery-fixture.mjs`, `test/delivery-outbox.test.mjs` | Fingerprinted DS fixtures; retain existing wasm/crash/outbox assertions. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | Publication, restore, startup, fingerprint and exact-coordinate contract. |
| `crates/snapback4-lang/src/guide/receipts.rs` | Client-side fingerprint, composition and safe-integer prose; DS still owns the mutation clause/body. |
| `crates/snapback4-lang/src/guide/codes.rs`, `src/diag.rs` | `E_DELIVERY_BINDING` explanation and receipts-card routing. |
| `crates/snapback4-lang/tests/guide/definitions.rs`, `tests/guide/refusal_actions.rs` | Pin the new explanation's defining fact and recovery instructions. |
| This report and `JOURNAL.md` | Round record and append-only journal entry. |

## Acceptance and forms

The governing context is LLP 3000.022 §§3–5 (collection, scheduling and binding
identity), LLP 3000.016 §2.2 (publication authority) and LLP 3000.018 §3.2
(overtaken background answers). The `llp-orient` skill was read from the
available lane-a5 vendor checkout because this worktree's vendor link was
uninitialized. No new design document or review apparatus was added.

The local acceptance callback runs after pending delivery reads and checks
expiry, incarnation, authority, credential, watch ownership/reset and ephemeral
state immediately before selecting/publishing the answer. It collects that
answer's manifest in the same serialized acceptance, then awaits persistence.
A CAS retry does not republish. Once accepted, persistence cannot reject that
answer; a failed save can under-report. Watch expiry/sign-out still withdraw
an already published answer during a delayed save, and save completion never
republishes it. One-shot queries await the save for their selected snapshot.
This makes the acceptance point explicit instead of adding a new asynchronous
boundary between final checks and publication.

No new Quarry form is implemented by DC. Existing Quarry and the guide's
examples still compile. The amended consumer forms run in fixtures:

```json
{"table":"messages","group":"room","position":"ordinal","mutation":"delivered","args":["conversation","from","through"],"fingerprint":"fixture:messages"}
```

That binding travels in `backend.schema.delivery`. An accepted answer can
carry:

```json
{"delivery":[{"table":"messages","mutation":"delivered","args":["conversation","from","through"],"fingerprint":"fixture:messages","rows":[["c",41],["c",43]]}]}
```

It reports two separate intervals, never 42:

```json
{"id":"00000000000000000000000001","args":{"conversation":"c","from":41,"through":41},"store_id":"S","delivery":{"fingerprint":"fixture:messages"}}
```

The response fixture `{"denied":{"code":"E_DELIVERY_BINDING"},"head":10}`
drops only the named attempt's binding. A response fixture
`{"why":{"code":"RUNS_FULL"},"head":10}` keeps the interval parked.
The public `onDeliveryRefused` option is unchanged.

## Round-2 regression map

These numbers refer to the supervisor's consolidated findings. The negative
controls below were applied to temporary copies of built JavaScript, never
to the committed source or the full-suite input.

| Finding | Added witness and what it proves |
|---|---|
| 1, publication | Online one-shot acceptance runs only in its final returned branch. Real local fallback watches publish before a delayed save; expiry and sign-out during that save withdraw them without resurrection. An interleaved commit, credential change or expiry before the final acceptance callback rejects the manifest. A failed save preserves the successful answer. |
| 2, composed answer | Both retained-field composition paths omit the server manifest, including the branch that reuses a previous retained answer. |
| 3, restore floor | A real local fallback answer below the captured restore floor creates no debt. Removing the response witness makes the test fail. |
| 4, membership retry | Lose a recorded refusal, rejoin/collect, then replay the original id: post-rejoin positions remain owed. A second case parks an exhausted attempt and runs another interval before replaying it. |
| 5, individual bindings | An unrelated online generation retains a range refusal. Queue tests retain unchanged saturation/debt and reject callbacks from changed fingerprints. Memory and SQLite adoption retain unchanged state/cursors while replacing only changed bindings. |
| 6, activation ordering | Startup witnessing and the persisted-debt response must both finish before enumeration starts; the existing outbox witness continues to enforce user-write priority. |
| 7, scan retry | Fail one enumeration page, then observe durable cursors `0, 1, 1, 2` through retry and completion, with bounded backoff. |
| 8, offline recovery | Both real clients transition offline on `E_OFFLINE`, recover through the existing link path and resend the same attempt id. |
| 9, local integration | An actual local client reads an online-only source via fallback; its real wasm device has durable debt before the query returns. Delayed storage, failed storage and rejected-answer cases exercise the same wiring. |
| 10, gap/floor strength | Positions 41 and 43 produce two runs when 42 was never fetched; a query at sequence 3 below publication floor 10 accepts no manifest. Both suggested mutations fail their tests. |
| Amendment | Reports carry the binding fingerprint; either refusal envelope for `E_DELIVERY_BINDING` discards only that binding. Schema decoding rejects a missing/duplicate fingerprint and argument lists of the wrong length. Unsafe coordinates produce no debt. |

## Wasm

Same source path and production build profile as round 1, Rust 1.97.0,
wasm-bindgen 0.2.127, no wasm-opt, eight Cargo jobs, `CARGO_INCREMENTAL=0`.

| Artifact | Raw B | Gzip B |
|---|---:|---:|
| Accepted round-1 remainder | 2,024,468 | 585,362 |
| First fingerprint build | 2,025,255 | 585,546 |
| Remove old-binding JSON clone | 2,025,067 | 585,534 |
| Final, with shared streaming binding decoder | **2,021,859** | **584,954** |
| Round-2 delta | **−2,609** | **−408** |

Final production SHA-256: `a6be768c74238c8412013a9325b844aa4529c1969a5cdfac18415def63f317af`.

The unchanged checked-in ratchet is still 572,841 B, so its gate reports
**12,113 B over**. The supervisor explicitly accepted the round-1 remainder
and owns raising that ratchet during integration. This round does not grow
that remainder or change the budget file.

During this session, another lane made `~/.local/bin/wasm-opt` version 108
available. A preflight build then failed validation on Rust's sign-extension
instructions. The final comparison and full suite use a task-local PATH with
Node/Bun symlinks and the ordinary Cargo/system tools, preserving round 1's
no-optimizer configuration. No shared binary was modified. That preflight
failure is environmental; the unchanged gzip gate is the inherited,
explicitly accepted DC remainder.

## Validation

- Full device suite: **1,339 passed, 0 failed, 3 existing ignored**, across
  68 result summaries; the delivery integration file contributes 19 passes.
- The full run's Rust workspace: **3,855 passed, 0 failed, 24 existing
  ignored**. All fixture wrappers and both reference-app typechecks pass.
- Broad affected client/census run: **521 passed, 0 failed**. Subsequent
  focused delivery run: **71/71**, followed by the final added credential-during-save
  test in a **10/10** real-local-publication recheck.
- Whole guide: **86/86**. Its first preflight run failed two registration
  proofs for the newly handled binding refusal (ours); the default card,
  definition and recovery pins were added, and the complete recheck passed.
- Artifact serde-family and forbidden-server-code census: **pass**. Source
  census is included in the broad affected run.
- Reference audit: **517 LLP docs, 9,617 references, 0 errors, 0 unchecked**.
  Whitespace audit passes; `local.ts` is 1,499 lines, all touched sources below
  the 1,500-line ceiling.

Ran `scripts/test.sh` **exactly once**, exit 1. Its exact summary is:

```text
== 2 failure(s) in 1474 s
   wasm build
   client tests
```

Every failure and disposition:

| Gate / test | Attribution | Cause and disposition |
|---|---|---|
| `wasm build` | **Baseline for round 2: accepted DC round-1 remainder** | 584,954 B gzip exceeds the unchanged 572,841 B ratchet by 12,113 B. It is 408 B smaller than the supervisor-approved round-1 artifact. The supervisor owns the integration ratchet; this lane did not change it. |
| `online membership refusal preserves post-dispatch collections` (`delivery.test.mjs`) | **Ours: existing lane test fixture race** | The fixture returned its already-resolved original refusal for a new attempt too. A scheduled second dispatch could correctly delete the group before the assertion. Hold that second response independently and assert it has a new id; fixed in `283b2c5bd`. |
| `transport failures are loading and an explained server refusal lasts until the next result` (`page-authority.test.mjs`) | **Ours: regression** | Moving final publication out of `ReadObservation.fetch` omitted its transport-to-loading conversion. Restored the conversion in `283b2c5bd`; the existing assertion catches its removal. |
| `unavailable server list responses end retention in both clients` (`page-ready.test.mjs`) | **Ours: same regression** | The online branch published `E_OFFLINE` instead of loading. Fixed by the same conversion; this existing integration assertion now passes. |

The full run's main client process recorded **2,703 passed, 3 failed, 10
existing skipped**; all seven extra client shards passed **56/56**. The seeded
models passed **78/78**. Native build, docs budget, release guard, package
typecheck/build, chat check, both app typechecks and fixture wrappers all pass.
There was **no environmental failure in the full run**.

After the full run, rebuilt and typechecked the package and ran delivery,
page, keep, presence refresh, ephemeral keep, expiry retry and read-observation
tests: **251 passed, 0 failed, 0 skipped**, including all three failures above.
No second full-suite run. These final fixes are JavaScript/test-only; the wasm
SHA-256 remains byte-identical to the full-suite artifact.

Full-suite invocation, from `snapback4/` (the task-local bin contains only
symlinks to the pinned Node 24.13.1 and Bun 1.3.14):

```sh
export PATH="$PWD/target/lane-dc-round2/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin"
ulimit -n 65536
CARGO_INCREMENTAL=0 CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 \
  CARGO_PROFILE_TEST_DEBUG=0 scripts/test.sh
```

Evidence is under ignored `target/lane-dc-round2/`. The mutation driver runs
only copied package bytes. All 16 controls fail with assertions (no timeouts):
unfetched middle, uncertain retry boundary, omitted request fingerprint,
ignored binding refusal, unrelated-generation clearing, below-floor query,
early online acceptance, offline latch, early activation, missing scan retry,
composed manifest, skipped local restore witness, persistence before watch
publication, skipped final authority fence, save-error propagation and a
missing local manifest collector.

## Remaining integration limits and reproductions

- DS must land with DC: the old receipts mutation in this worktree still has
  its historical silent full-runs branch. This round intentionally uses
  `RUNS_FULL` fixtures, as directed; it cannot qualify success-as-coverage on
  that unamended server/card. The compiler/manifest/writer checks and the real
  comparative choreography remain integration work. Reproduce the existing
  card limitation by filling a viewer/group with 64 disjoint stored runs,
  then reporting a 65th disjoint run: its current conditional insert does
  nothing and returns success. DS's amendment must instead refuse `RUNS_FULL`.
- The checked-in wasm gate still fails until the supervisor applies its
  accepted ratchet decision. Run `bash scripts/build-wasm.sh` with the
  no-optimizer PATH described above to reproduce 584,954 B versus 572,841 B.
- Round 0's full wasm path matrix, native process-kill witness, IndexedDB
  browser crash witness and comparative acquisition-gap choreography remain
  unclaimed. This round adds real local fallback coverage; it does not silently
  claim those separate witnesses.
