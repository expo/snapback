# Cumulative offline-ticket audit at d19d9399e

Read-only audit of committed objects by GPT-6 Astra, 2026-09-08. No new tests,
builds, probes, native-device evidence or publication qualification were run.
The only Snapback2 file changed between qualified `43e06fa90` and audit pin
`d19d9399e` is `AGENTS.md`; the inspected product/test sources are identical.

LLP 1018.000 §10 records the combined canonical execution: 815 Node passes,
865 native passes/four skips, 225 evaluator cases plus two visibility checks,
and 214 compiler checks. Exact process 697134, source, JUnit and hashes are
in the coordinating `items-canonical.receipt.json`, also copied into this run’s
`performance.json`. The evaluator entry imports `test-indexed.ts`; its added
assertion blocks execute with the corpus and are not a separately inferred count.

Paths below are relative to `snapback2/packages/`. `tests/` abbreviates
`snapback2/tests/`. These are regression mappings, preserving each fixture’s
scope rather than turning synthetic controls into native-emission claims.

| Retained counterexample | Executed regression | Scope and disposition at audit pin |
|---|---|---|
| Shallow-frozen nested rows bypass put/constructor/rehydrate isolation | evaluator/src/test-indexed.ts:1170 | All three admission paths preserve rows/search/directory after caller mutation; invalid input and reclamation controls. Synthetic standalone inputs. Mapped. |
| Malformed receipt endpoints destroy previous authority before refusal | evaluator/src/test-indexed.ts:1208 | setReceipt and rehydrate preserve proof/index/absence/verdict/image state; valid replacement control. Synthetic receipt controls. Mapped. |
| Offline projection exposes denied payload or denied/partial cursor | tests/offline-public-state.test.ts:86 | denied/partial/complete/capped across forced/hydrating/retry and subscription. Real client/runtime, synthetic frames. Mapped. |
| Incomplete full bounds persist before Twin refuses | tests/store-review-custody.test.ts:701 | Empty/populated, direct/checked runtime, durable/slot/outbox/warm/reopen preservation and valid full tuple. Native initial program, synthetic malformed frames. Mapped. |
| Consumed Limit member/halo incorrectly proves exhaustion | tests/store-review-custody.test.ts:747 | Member/halo/both removals warm/cold, rejection restoration, actual retained native Exhausted control. Synthetic queued overlays; no public grant-admission claim. Mapped. |
| Cold moved keys return capped while warm is partial | tests/store-review-custody.test.ts:777 | Zero/one/two member/halo moves, immutable rowProofs, warm/cold equivalence, conflicting replacement and owner reclamation. Synthetic later frames. Mapped. |
| Public forced-offline movement omits halo and uses historical capped membership | tests/twin.test.ts:1431 | Cold forced/retry/query/subscription requires partial, no cursor and exact values. Native initial frame, synthetic later movement/transport. Mapped. |
| Delayed FULL misses changed interior issuing keys | tests/store-review-custody.test.ts:811 | Warm partial, exact replay idempotence, identical cold result and persisted bytes. Mapped. |
| Equal newer FULL retains separate current/effective images | tests/store-review-custody.test.ts:874 | Object identity/shared prepared keys, unchanged revisions, no-op overlay, replay, rollback and cold replacement. Ownership witness, not a new wrong-value claim. Mapped. |
| ProjectionCache retains full row JSON | tests/sqlite.test.ts:391 | Actual Node SQLite and FakeIndexedDB; payload-retention inspection, mutation, abort, reopen, deletion and reclamation. Mapped. |
| Omitted optional indexed __proto__ breaks raw/cold keys | evaluator/src/test-indexed.ts:1357 | Ordinary/Unicode indexes, raw/prepared admission, omitted wire form, cold reopen. Synthetic schema/direct carrier. Mapped. |
| completeReset children survive removal and reappear after reopen | tests/sqlite.test.ts:427 | Actual Node SQLite/FakeIndexedDB, populated rows, failure/retry, two reset cycles, outbox/fact preservation, root scalar/null/absent transitions. Not native-device COMMIT proof. Mapped. |
| Existing metadata child becomes undefined; trailing-hole root array loses length | store/metadata.ts:11–18; store/projection.ts:38–41 | Two source-level gaps remain at d19d9399e. Direct SQLite/IndexedDB call projection before hook normalization. Existing tests cover nested undefined and root deletion, not these cases. No new execution claimed. |
| Malformed singleton loop-domain containers change canonical bytes | evaluator/src/test.ts:1010 | String/singleton-array/opaque future tag/known ordering/empty tag controls; external tag reconstruction retained. Synthetic hasher inputs. Mapped. |

## Remaining correctness controls

The metadata repair needs existing object/array child → undefined cases with
JSON omission/null behavior, reopen, rollback/retry and unrelated outbox
preservation. It also needs trailing-hole and all-hole nonempty root arrays,
with normalized length/null slots through direct and journaled replacement.
This audit does not claim those controls already passed.

## Resource obligations remain separate

Current complete runtime measures 83,227 gzip under the independently amended
84,000-byte allocation, with 773 bytes left. The unchanged 80,000 target is
missed by 3,227. The combined suite takes 83.921s and misses its 60s target.
Actual 100-lane media-bearing closure/max-width measurements, phone cold-build
peak, and full-engine 10%/50%/100% latency curves are not discharged by these
unit regressions or generic Chrome/Expo qualification. No completed evidence
for those obligations was found in the governing records inspected.

Both rejected Unicode/structural-codec experiments and their original failed
measurements remain historical rejected alternatives. They are not landed
repairs or resource passes. The selected cumulative ticket remains open.
