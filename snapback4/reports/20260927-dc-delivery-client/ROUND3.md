# Lane DC, round 3 — acceptance, conditional collection and activation

2026-09-27, branch `sb4-intent/dc-delivery-client`. No push, publication,
version change or budget increase. The prior reports remain historical.

First fetched and merged `origin/main` in `981699084`. Both journal conflicts
kept both sides; a subsequence check verified every line of both parent
journals remains in order. Read the three lane prompts, both complete round-2
reviews, the prior reports and all three DC journal entries.

## Findings and commits

Numbers below are the supervisor's round-3 consolidated list.

| Commit | Finding | Result |
|---|---|---|
| `c26f2b931` | 5; 6, Astra fixture | Refusal tests protect a second binding's owed, reported, refused and retired state in both envelopes. Each request owns a distinct deferred response. |
| `aa98209e2` | 4 | Reconcile compiled and manifest-only descriptors by fingerprint, then replace the stored descriptor without dropping groups. |
| `9da895bf9` | 3; 6, Grok cursor | Track startup debt only; pause device enumeration at capacity without advancing past a blocked row or evicting debt. Exercise actual SQLite and wasm cursor failures. |
| `be105bdc6` | 3; 6, Astra fixture | Keep a cleared startup barrier cleared when bounded reported history ages out; recheck outbox priority inside serialization. Deterministically dispatch the second independently held request. |
| `08a133d98`, `de1f13a25`, `5f2af6524` | 1 and 2, both reviews; supervisor ruling | Synchronous acceptance, fresh fences for every CAS attempt, guarded host persistence, updated one-shot/watch tests and the LLP amendment in the same commit. |
| `8e8cb4fc6` | 6, independently held responses | The full run exposed another fixture race in binding replacement. Force the replacement dispatch and hold each response independently; all 88 delivery tests pass afterward. |

## Implementation, file by file

Paths are relative to `snapback4/` unless stated otherwise.

| File | Change |
|---|---|
| `crates/snapback4-device/src/device/delivery.rs` | Fingerprint reconciliation; capacity-aware activation collection; blocked-page response and cursor advancement only through consumed rows. Publication keeps its existing bounded collection policy. |
| `crates/snapback4-device/tests/delivery.rs` | Manifest-only adoption on memory/SQLite, capacity/pause/resume on both, and a real SQLite trigger failure after cursor advancement followed by exact retry. |
| `packages/snapback4/src/delivery.ts` | Capture only startup intervals and incarnations; permanently clear that barrier after completion. Pass a live collection predicate to storage on every attempt. |
| `packages/snapback4/src/local-delivery.ts` | Skip unchanged/stale collection writes; use conditional host CAS; wait for capacity instead of draining live debt; preserve outbox priority at the serialized enumeration call. |
| `packages/snapback4/src/local-publication.ts` | One synchronous final-check/publication point. Collection is asynchronous and supplementary, with errors isolated from the accepted answer. |
| `packages/snapback4/src/local.ts` | One-shot queries return immediately after acceptance; watch reruns and background refreshes publish synchronously. Forward the host's conditional collection capability. |
| `packages/snapback4/src/local-device.ts` | Optional internal `deliveryCommit` capability, preserved by existing adapter spread conventions. |
| `packages/snapback4/src/web.ts` | Conditional collection commits on the existing device chain; discard speculative memory when the guard rejects. Optional persistence operation and atomic memory implementation. |
| `packages/snapback4/src/web-idb.ts` | Check inside the live strict IndexedDB transaction and explicitly commit or abort. Ordinary persistence retains its original path. |
| `packages/snapback4/test/delivery.test.mjs` | Unrelated-binding preservation in both envelopes; independently held responses with a forced second dispatch; startup completion remains latched. |
| `packages/snapback4/test/delivery-cas.test.mjs` | Failed first CAS followed by authority, credential or incarnation changes; actual device `Left`/CAS conflict; unaccepted answers; safe omission without conditional host support. |
| `packages/snapback4/test/delivery-publication.test.mjs` | Real local-client acceptance before persistence; pre-acceptance fences; failed/delayed saves; held writes followed by sign-out, expiry or commit; held host saves followed by sign-out/expiry. |
| `packages/snapback4/test/delivery-activation.test.mjs` | Activation under a continuously replenished live group, retaining startup/witness ordering and retry coverage. |
| `packages/snapback4/test/delivery-clients.test.mjs` | The direct local storage fixture explicitly supplies an atomic conditional commit. |
| `packages/snapback4/test/delivery-web.test.mjs` | Real client-generated manifest state survives wasm adoption; a failed host save rolls back the device's actual advanced enumeration cursor; a JSON-normalizing adapter cannot strip the conditional guard. |
| `packages/snapback4/test/web-review.test.mjs` | Real Chromium/IndexedDB transaction abort after a fence changes during its writes; subsequent current collection commits. |
| `../llp/3000.022-delivery-the-sdk-reports.rfc.md` | Revised metadata and supervisor's acceptance/persistence ruling. The quoted sentence was actually in §3; amend it and state the full rule in §4. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | Acceptance timing, guarded collection, capacity-based activation and the unsupported-host limitation. |
| This report and `JOURNAL.md` | Final measurements, checks, limitations and append-only round record. |
| `../issues/20260927-snapback4-parallel-client-econnreset.md` | Track the three full-run direct-fetch resets without weakening their fixtures. |

## Acceptance and forms

There is no new Quarry form or wire field. DS still owns the clause producer,
manifest producer, writer fingerprint check and the card's `RUNS_FULL` body.
Their consumer fixtures remain intact. For example, the compiled binding is:

```json
{"table":"messages","group":"room","position":"ordinal","mutation":"delivered","args":["conversation","from","through"],"fingerprint":"fixture:messages"}
```

An accepted answer may carry a descriptor without the compiled columns:

```json
{"delivery":[{"table":"messages","mutation":"delivered","args":["conversation","from","through"],"fingerprint":"fixture:messages","rows":[["c",41],["c",43]]}]}
```

The queue reports two runs, omitting 42. Its first request is still:

```json
{"id":"00000000000000000000000001","args":{"conversation":"c","from":41,"through":41},"store_id":"S","delivery":{"fingerprint":"fixture:messages"}}
```

A watch publishes, or `query` resolves, synchronously after its final fences.
It never waits for the collection save. Each collection CAS and the host's
commit guard checks current authority, incarnation, credentials and expiry.
A losing/stale write cannot unaccept or republish the answer, and collects
nothing. Persistence failure only under-reports. The old fallback tests that
required durability before query resolution deliberately changed to this rule.
A response already expired before acceptance may yield `loading`; its manifest
is rejected. That replaces the old test's incidental expectation of an immediate
fresh answer after holding the collection read.

## Test discrimination

- The memory and SQLite adoption regressions both failed before the fingerprint
  fix, losing the whole manifest-only group, and pass after it.
- The continuous-traffic regression failed before the startup fix: after twelve
  successful live reporting cycles it still had zero enumeration pages. It now
  completes with live debt still queued.
- The capacity tests preserve the first 256 disjoint runs of a 300-row page,
  leave state/cursor unchanged while blocked, then resume at run 257 after room
  is made. They cover memory and SQLite.
- The SQLite trigger rejects the delivery metadata INSERT only once the actual
  encoded cursor contains `after`. The device call errors, cursor and debt
  remain empty, and retry collects rows 1–500 and then 501. The wasm witness
  independently fails the host save after the real cursor advance and proves
  the same retry sequence.
- Actual local queries have resolved while collection writes are held. Sign-out,
  expiry and a commit before releasing those writes leave no debt or reports.
  The host-save tests also hold after the first CAS check, then invalidate
  credentials or expiry; conditional persistence writes nothing.
- The `Left` witness applies a real device scope publication, observes a real
  failed CAS, and proves its retry cannot recreate debt. Publication occurs once.
- A second binding retains its entire state, including owed, reported, refused
  and retired entries, through either mismatch envelope.
- Chromium changes the fence during `IDBObjectStore.put`; the final guard
  aborts the transaction and preserves prior metadata. A later current write
  commits normally.

Negative controls use temporary built-JavaScript edits or the browser harness's
existing source-override facility, restoring every input byte afterward:

| Mutation | Result |
|---|---|
| Cache the collection fence (`() => true`) after acceptance | All authority/credential/incarnation and actual `Left` CAS regressions fail. |
| Restore the exact round-2 helper and its awaited one-shot query | The real local delayed-save timing regression fails. |
| Make acceptance asynchronous | Synchronous acceptance regressions fail. |
| Remove the memory host's final guard | Both held-host-save regressions fail. |
| Remove the IndexedDB transaction guard | Chromium assertion fails: stale write incorrectly succeeds. |
| Route the conditional capability through an overridable ordinary-call wrapper | The JSON-normalizing adapter regression fails, retaining stale debt. |
| Delete every group after dropping a refused binding | Both mismatch-envelope tests fail. |
| Reuse the first resolved refusal for the next request | The deterministically dispatched second-request test fails. |

## Context, decisions and limits

Used `llp-orient`, read from the available lane-a5 vendor checkout (the lane's
vendor link is uninitialized). Governing constraints: LLP 3000 §§1–4 (fence,
fixed budgets), LLP 3000.022 §§3–5 (collection, scheduling and binding identity),
LLP 3000.021 §3.2 as amended by 3000.022, LLP 3000.018 §3.2 (overtaken answers),
and LLP 3000.002's device-codec/wasm budget section. The delivery RFC is in
`llp/current/`. No new LLP, gate or dependency was introduced. Hand-off: none
for the amended acceptance decision; host completion below needs supervision.

**Conditional host support is a material limitation.** Rechecking in the queue
alone cannot satisfy the ruling if a host delays a write after that check. The
web memory and IndexedDB implementations now support a conditional transaction.
A legacy/custom `DeviceCore`, the current process adapter, or the current Expo
adapter without `deliveryCommit` omits supplementary fallback manifest saves.
Likewise, custom web persistence without `saveIfCurrent` omits them. Answer
acceptance and ordinary device publication collection still work; omitted rows
stay `sent`. This is conservative under-reporting, not a claim of complete
native fallback delivery support.

Counterexample to an unguarded adapter: accept a fallback, pass `current()`,
send an asynchronous native/IPC CAS, sign out while the host delays it, then
let it commit. Retrying fences in JavaScript cannot cancel that already-running
write. I stopped that unsafe path instead of claiming a pre-dispatch check
solves it or adding unqualified native cancellation/synchronous bridge APIs.
A host conditional-commit implementation is needed to restore those fallback
collections under the stronger ruling. Reproduce the safe omission with
`node --test --test-name-pattern='without conditional commit' packages/snapback4/test/delivery-cas.test.mjs`.

Other existing integration limits remain: no DS server qualification, full
comparative choreography, full wasm path matrix, native process-kill witness
or IndexedDB crash witness is claimed. The new browser test is a transaction
abort witness, not a browser-crash witness. Authorization, disclosure, meters,
store formats, retry identities and request envelopes were not relaxed.

## Measurement and verification

Same production path and no-optimizer toolchain as rounds 1–2: Rust 1.97.0,
wasm-bindgen 0.2.127, Node 24.13.1 and Bun 1.3.14. Existing tools were reused;
no tool was installed to a shared path. Frozen dependency install passed.

| Artifact | Raw B | Gzip B |
|---|---:|---:|
| Accepted round-1 remainder | 2,024,468 | 585,362 |
| Round 2 | 2,021,859 | 584,954 |
| Round 3 | **2,022,931** | **585,317** |
| Round 3 minus accepted round 1 | **−1,537** | **−45** |

The round adds 1,072 B raw / 363 B gzip over round 2, staying below the
supervisor's accepted remainder. The unchanged checked-in 572,841 B gate still
reports 12,476 B over. Integration owns the already accepted ratchet increase;
this lane did not change it. `bash scripts/build-wasm.sh` reproduces that gate.
The merge changed no core/device source from round 2 before our edits.

Production SHA-256:
`c0f4bc6f1cc1b881ee4f7b4fbb6ee2883306b8c9d92ace7ae73b163b555c2321`.

Source codec census passes. The symbol-bearing artifact also passes the serde
family and server-only/Unicode-table absence checks. All changed source files
are at most 1,500 lines (`local.ts`: 1,499). Typecheck/build, README budget
300/300 and reference audit pass (517 LLPs, 9,627 refs, zero errors/unchecked).

Scoped checks:

- Complete device crate: 1,344 passed, zero failed, three ignored, across
  68 test-result summaries. All 24 delivery tests pass.
- Whole guide: 86 passed, zero failed.
- Final complete delivery suite: 88 passed, zero failed. The final
  conditional-host/IndexedDB run passed 14/14; the final adapter/publication/
  durability run passed 34/34. These overlapping runs are not added together.
- Source census and broader browser/durability/navigation/reset checks:
  78 passed, zero failed. Artifact family/absence checks also pass.

The final JavaScript adapter correction was made while the sole full suite
was in its Rust phase. Its package was rebuilt and its 34 affected tests
passed before the full suite started its client phase. Rust inputs and the
wasm artifact were unchanged. The final response-fixture correction followed
the full suite's client phase and passed the complete 88-test delivery suite.
No second full suite was started.

Full-run Rust: 244 binaries, 957 executions plus doctests; 3,907 passed,
zero failed, 24 ignored, 1,060 seconds. Client main: 2,719 passed, four
failed, ten skipped; seven additional shards passed 56/56. Client phase:
198 seconds. Both app typechecks and all nine fixture wrappers passed.

Every failure in the sole full run:

| Classification | Failure | Evidence and disposition |
|---|---|---|
| Baseline, supervisor-accepted remainder | `wasm build` | 585,317 B gzip exceeds the unchanged 572,841 B gate by 12,476 B, but is 45 B below the accepted round-1 remainder. No budget increase. |
| Ours, corrected after the run | `binding fingerprints travel on reports and reconcile only changed bindings` | `delivery.test.mjs:153`: expected owed `[[3,3]]`, saw `[]`. Its automatic pump could finish the replacement's immediate-success response before the assertion. Explicitly pumping reproduced the old failure; independently held responses fix the fixture. Commit `8e8cb4fc6`; complete delivery retest 88/88. |
| Environmental transport failure | `local: global logout follows another tab's held rotation and revokes external siblings` | Direct fixture probe at `app-global.test.mjs:12`, reached from line 48, fails with `TypeError: fetch failed`, cause `read ECONNRESET`. No auth assertion failed. |
| Environmental transport failure | `wire stamps successes and refusals on sync, changes, query, mutation and session endpoints` | Direct fixture POST at `server-clock-wire.test.mjs:18`, reached from line 47, fails with the same `read ECONNRESET`. |
| Environmental transport failure | `R2 item 1: changes with a foreign identity returns before its production wait` | Direct fixture seed fetch at `store-reset-reconnect.test.mjs:58`, reached from line 97, fails with the same `read ECONNRESET`. |

Transport classification names the observed socket failure, not a proven
root cause. Before the reporter printed the details, all 12 isolated runs of
the global-logout file passed on current source and all 12 passed against a
package rebuilt from merged baseline `981699084`. Its auth, app, native adapter
and test/helper inputs are unchanged; its fixture declares no delivery binding.
No production network retry or assertion was weakened. These isolated passes
do not erase the failures or establish that the shared-run transport issue is fixed.
The final isolated run of all three affected files passed 29/29 in
58,951.281469 ms. The open ticket above records the complete test names,
stack sites and reproduction command; use the concurrent `scripts/test.sh`
path to attempt the intermittent failure. The isolated command is:

```sh
node --test --test-concurrency=1 packages/snapback4/test/app-global.test.mjs packages/snapback4/test/server-clock-wire.test.mjs packages/snapback4/test/store-reset-reconnect.test.mjs
```

Ran `scripts/test.sh` **exactly once**, exit 1. Exact summary:

```text
== 2 failure(s) in 1569 s
   wasm build
   client tests
```

All 78 model tests passed in 280 seconds. Every remaining suite phase passed.
The script's inherited 60-second budget is unchanged. The full-run wasm
rebuild is byte-identical to the pre-suite artifact and retains the SHA above.
No push, package publication or shared-path tool installation occurred.
Evidence is retained under ignored `target/lane-dc-round3/`.
