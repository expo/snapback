# Clique final report

Clique is green for the requested web-only M1-M6 and M8 scope under the frozen `social-messenger@0.3.6-m8` instrument. All 58 suite-required assertion IDs pass, all seven final frozen choreography segment summaries are green, the 87-action committed starter replay passes, the validated 50-action/13-verb sample replay passes, and the Snapback verify receipt has status `passed`.

## Identity and scope

- Lane: `sol-explicit-0129-036-admitted2`
- Journey start: 1787988922
- First product edit claim: 1787989130; earliest retained file evidence: 1787989134. The mandated immediate harness stamp was missed, so `first-product-edit.json` is explicitly a late reconstruction and its token fields are `unknown`.
- Backend: default explicit Snapback authoring profile; no `authoringProfile` override.
- Published packages: `@expo/snapback-acceptance`, `cli`, `client`, `codegen`, `expo`, and `react`, all exactly `0.1.29`.
- Published template attribution: `expo-chat@0.1.29`, generated in an isolated temporary directory.
- Runtime: `@expo/snapback-runtime-linux-x64`, 202200440 bytes, SHA-256 `03c4c2d8b407e767951a88a2710d1a29cbe3d57b650d1fb089e4c2e5d8d95c84`, commit `90ee0937d20beab14463ba837f2228c9c06818cc`, clean release build.
- Instrument: `social-messenger@0.3.6-m8`, revision `eff33c5882fce03edfcd572fb1e0284344a3827d`.
- Served Guide build: SHA-256 `d256138f15ebabd9b3c0157fdee32ca6562db4f9c284838c79bde02cf74a4c00`.
- Inspection disclosure: no sibling lane, prior Clique implementation, Snapback source checkout, or package implementation source was inspected. The lane packet, allowlisted skill, frozen instrument, generated artifacts, isolated published template packet, and trigger-selected served Guide pages were read. The frozen instrument was not edited.

## Milestone time and proof

M1's boundary is the explicit journey start. Later boundary epochs are reconstructed from each first retained frozen proof start because contemporaneous diary entries were not emitted. “Retained complete green” is the exact final conjunction after the assertion-complete suites existed. An earlier M6 complete-green event is ordered as harness item_535 but lacks an event epoch, so it remains `unknown`; the final retained M6 regression green is exact.

| Milestone | Boundary epoch | Suite green epoch | First complete green epoch | Final retained green epoch | Proof-wall seconds | Suite | Final frozen segment |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| M1 | 1787988922 | 1787997304 | 1787998206 | 1787998206 | 9284 | 7/7 | green, 3/3 |
| M2 | 1787991693 | 1787997411 | 1787998290 | 1787998290 | 6597 | 22/22 | green, 9/9 |
| M3 | 1787992220 | 1787997636 | 1787998962 | 1787998962 | 6742 | 7/7 | green, 6 passed; 5/5 required, 1 optional skipped |
| M4 | 1787993719 | 1787997734 | 1787999055 | 1787999055 | 5336 | 5/5 | green, 5/5 |
| M5 | 1787993977 | 1787997824 | 1788000115 | 1788000115 | 6138 | 6/6 | green, 4 passed; 2/2 required |
| M6 | 1787995503 | 1787997965 | unknown | 1788000884 | 5381 | 5/5 | green, 1/1 |
| M8 | 1787995971 | 1787998174 | 1788000862 | 1788000862 | 4891 | 6/6 | green, 5/5 |

Every retained proof-wall is under the 14400-second milestone cap. These walls include later correction work and proof reruns; they are not claimed as uninterrupted per-milestone authoring time.

The proof paths are:

- Typed suites: `receipts/m1/suite.json` through `receipts/m8/suite.json`, mapped assertion by assertion in `coverage-manifest.json`.
- Frozen two-browser proof: each milestone directory contains `choreography.jsonl` and typed `choreography.observations.jsonl`; every final segment summary has `green:true`.
- Replays: `receipts/replay.json` has 87 authenticated app-write actions; `receipts/replay-sample-50.json` has 50 validated actions spanning all 13 verbs.
- Static/runtime closure: `npm test`, `npm run test:static`, and `npm run typecheck` pass. Runtime qualification passes. `.snapback/verify-receipt.json` has `ok:true`, `status:passed`, generated inputs identity `snapback.v1:sessions:inputs:sha256:2c5262f396b3f04619562476b5f55cbbf8e71e6b78738116a53d2b522c7be436`, and a digest-bound receipt-closure profile.
- Verify nonclaim: no D1 path observations are registered; the receipt correctly reports `no-registered-acceptance-paths`. Verify closes artifact/runtime/receipt identity, not semantic product completeness.

## Correction-loop curation

Four done-claim → contrary-evidence → revision narratives are retained in
`correction-loops.json`:

1. M3 was green, then accumulated history exceeded the browser snapshot boundary; a separate 100-row live query restored green while preserving 500-row headless history.
2. M5 was green, then accumulated state pushed the seeded offline-search target outside the warm message window; a compact owner search projection and route-persistent subscription restored green.
3. M6 was green, then a concurrent receipt/inbox update caused the second queued message to be abandoned; sequential idempotent retry, visible terminal errors, identity-based read triggers, and flush-order alignment restored green.
4. M8 was green, then a later run exposed online-send contention and optimistic dual-context order; bounded retry and authoritative flush ordering restored green.

Final curation found that the record lacks the attribution field required by
`benchmarks/protocol.md` and does not map each exercised LLP 0317 obligation as
required by the preregistration. The protocol count is therefore `unknown`,
not four. Total elapsed seconds are also `unknown`, not zero:
`harness.ndjson` preserves item ordering and the receipts preserve
contrary/revision epochs, but earlier done-claim events have no per-item wall
timestamp.

## M7 and scale

M7 is environment-null by contract. No physical device, Simulator, or EAS workflow was attempted or claimed.

The instrument's `sample-50.log` validator and authenticated replay passed 50 actions across 13 verbs. The full scale log was not attempted, so O5 is `null`; no throughput, latency, or zero-value estimate is inferred.

## Candid gaps and boundaries

- Schema defense in depth is weaker than intended. Cross-recipient fan-out was refused under owner-policy tables, and the served diagnostic exposed no admitted server-owned projection repair. All 17 tables therefore declare `public-read`; application exports still authenticate and filter owner projections with `authUserId()`, and mutations check membership. A raw table-capable reader has broader visibility than the app query surface.
- Media uses compact frozen fixture references. There is no first-party upload custody, signed delivery, byte revocation, or asset garbage-collection proof. View-once prevents a second app-level consume but does not prove byte revocation.
- Disappearing messages use shortened development TTLs (180000 ms for “24h”, 300000 ms for “7d”) and are hidden by live/client projection after expiry. Physical server-row purge was not implemented or proven.
- No server-scheduled digest job is implemented. Insights, seven-day activity, trending ranking, and digest-shaped preference/UI behavior exist, but scheduled delivery does not.
- Search is a bounded 500-row compact owner projection, not a full-corpus indexed search guarantee. A member added later receives message history projections, but historical compact search backfill for that membership transition is not complete.
- Receipt aggregation is based on recipient views observed by the product, not a formally frozen sender-time retained-recipient set.
- Generation passes with 85 review warnings. Four are concrete N+1 batch-read advisories in `changeMember`, `createGroup`, and `sendMessage`; the remainder primarily record the deliberate public-write posture.
- The final runtime is a supervised local development target, not a deployed production target. It was cleanly stopped at epoch 1788001390, and the exact owned ports had no remaining listeners.

## Outcome

Within the requested web benchmark boundary, the journey is complete and green. The evidence does not expand that claim into production storage confidentiality, real media lifecycle, physical retention purge, scheduled delivery, full-scale performance, native delivery, or deployment readiness.

end=1788001513
