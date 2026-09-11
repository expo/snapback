# Snapback2 offline-entrypoint full-delta review

Date: 2026-09-11
Reviewer: `/root/audit_a` (fresh read-only review of the ticket implementation)
Branch head: `e5caae7acdc54617d6dba9fa256dd35181ff3d53`
Product pin: `a52703b7c1c438656937c5a294fca0e0e79d2090`
Ticket implementations: `7760989042bfa3b4fd73dc032e770a872d233269`
and `3a6358e9efed82889105e931140d2a6420224cc5`; adjacent cold
view-once repair `a52703b7c1c438656937c5a294fca0e0e79d2090` was included.

## Verdict

**READY for the cumulative offline-entrypoint correctness scope.** No material
correctness regression was found in the current metadata projection, public
offline projection, retained-reset custody, or adjacent cold view-once paths.
This discharges the ticket's fresh independent review requirement for the
`776098904`/`3a6358e9e` implementation pair. It is not a full-suite deadline,
device-resident, or scale-curve result.

The review read the complete ticket and its 2026-09-08 audit matrix, oriented
to LLP 1000, LLP 1012 §§4–10, LLP 1013 §§2–3 and §14, LLP 1018.003's snapshot
rules, and LLP 1006 §2a.1. Source inspection covered `store/metadata.ts`,
`store/projection.ts`, `store/swap-journal.ts`, both database carriers,
`ClientStore` receipt/row admission, `offlineView`, reset/adoption, range
coverage/image custody, and the once-media answer projection. Existing `@ref`
annotations remain applicable.

## Historical matrix disposition

| Retained counterexample | Current guard and reviewed evidence |
|---|---|
| Nested external-row mutation | `ClientStore.prepareRow` owns a recursive `RowImage`; put, construction, and rehydrate isolation controls ran before the evaluator's later unrelated stop. |
| Malformed receipt replacement | Replacement preparation precedes publication; typed endpoint/suffix/proof rollback controls ran. |
| Denied/partial held projection | `offlineView` omits denied data and non-page continuations; the complete forced/hydrating/retry public-state file passed. |
| Incomplete FULL bounds | Pre-publication carrier/runtime refusal and preservation controls passed. |
| Limit member/halo consumed as exhaustion | Warm/cold overlay removal and actual Exhausted controls passed. |
| Cold moved issuing keys | Zero/one/two movement and cold issuing-key controls passed. |
| Public forced-offline movement | Cold/retry/subscription partial propagation passed. |
| Delayed FULL interior-key replacement | Exact replay plus identical warm/cold custody passed. |
| Equal newer FULL image ownership | Shared keys, rollback, replay, and cold replacement passed. |
| Projection cache retains row bodies | The cache still owns keys only; mutable replacement, abort, deletion, and reclamation passed. |
| Optional indexed own `__proto__` | Raw/prepared/cold sparse ordinary and Unicode admission ran before the unrelated evaluator stop. |
| `completeReset` child resurrection | SQLite/IndexedDB failure, retry, two reset cycles, and reopen passed. |
| Undefined metadata child / trailing holes / first write | Per-root normalization plus committed `state` sentinel is coherent by source; carrier tests passed and a direct key-sensitive `toJSON`, own `__proto__`, sparse-array delta probe passed. |
| Malformed singleton loop domain | A standalone exact four-domain/three-special-statement-name probe passed; empty domain refused. |

The retained-reset follow-through selects the adopted program's full schema
before reset publication, so a manifest projection cannot erase delivery-log
anchors. Its real clock-reset, three-carrier reopen, byte lease, successor
narrowing, and interrupted-adoption tests passed. The adjacent once-media
repair conservatively omits a held validator whenever local projection scrubbed
a descriptor; the live descriptor and cold full-revalidation controls passed.

## Executed checks

Host: arm64 macOS 26.6, Node v26.7.0, Bun 1.4.0.

- `node build.mjs` in `packages/snapback2`: pass. The guide emitted its existing
  low-headroom warnings.
- `node --test --test-timeout=10000` over `sqlite`,
  `offline-public-state`, `twin`, `store-review-custody`, `offline-bytes`, and
  `real-owner-media`: **427 passed, 0 failed**, 8.70 s.
- Direct metadata projection probe: pass for named `toJSON`, nested named
  `toJSON`, own `__proto__`, undefined-object removal, and a four-slot sparse
  array through a child/root journal delta.
- Exact canonical-domain probe: four domain controls and three special
  statement names passed; empty domain refused.
- `./ref-check --verbose`: pass, 439 LLP documents and 8,050 references.
- `node scripts/caps.mjs`: the review files add no violation; the command
  reports the two existing 1,504/1,508-line source overages against the
  204-file baseline and exits nonzero.
- `bun src/test.ts` in `packages/evaluator`: every offline audit control above
  ran and passed, then the process stopped in the unrelated maintained-address
  assertion at `test-maintained-address.ts:24`. Bun 1.4 compares the tagged
  null-prototype result with an ordinary-object fixture prototype. This is a
  nonzero full-evaluator result and is not presented as a suite pass.

`scripts/ibex-doctor` began its optional scratch Cargo link probe. It was
stopped with exit 130 when the concurrently owned Android witness build became
visible, so it supplies no qualification and no Cargo/resource test was run.
No emulator, simulator, phone, Silver host, or other lane was touched.

## Practical resource-obligation map

| Obligation | Practical current entry point | Claim boundary / remaining work |
|---|---|---|
| 100-lane media/max-width closure | After `scripts/bootstrap-ibex-runtime`, run `cd snapback2 && cargo test -p snapback2-core maximum_media_shape_and_twenty_kib_stress_fit_actual_closure_and_scratch -- --nocapture`. | `engine/search_media_tests.rs` builds 100 scopes, 200 messages with image/video/once-image, and both ordinary and 20 KiB message / 576-byte membership shapes. It emits two `SEARCH_MEDIA` JSON lines and asserts actual closure, derived steps/scratch, 4 MiB closure, and 8 MiB heap bounds. It was not rerun here because a separate Android build owned local build capacity. Preserve stdout, exact source/toolchain SHA, exit, and wall/resource receipt when scheduled. |
| Phone cold-build peak resident/storage | `scripts/witness-expo.mjs` supplies the iOS simulator process-kill/cold-construction choreography; `scripts/witness-expo-android.mjs` supplies an API-36 emulator build/install/drain. | Neither script samples peak RSS and the Android script deliberately rejects a physical device whose AVD name differs. A claim-ready physical-device wrapper is still needed. On Android it can bracket the fresh construct/reopen with `adb shell pidof dev.snapback.chat`, read `/proc/$pid/status` `VmHWM`, retain `dumpsys meminfo`, and measure the app database via `run-as`; iOS needs the equivalent Instruments/xctrace physical-device capture. Simulator host RSS is not phone evidence. |
| Full-engine 10%/50%/100% search curve | No stable in-repository runner currently produces this curve. `packages/evaluator/measure-node.mjs` measures one hydration case, and `compiler/fixtures/quarry-clique/corrections/follower-scale.mjs` measures 5-vs-900 follower mutation latency; neither is a substitute. | Add or retain a bounded harness over one fixed full-engine search corpus, with exact 10/50/100 checkpoints, invariants/hashes, warmups and sample counts, p95 latency, owner/store identity, steps/scratch, timeout and process receipts. The 2026-09-09 treatment reports refer to raw-lane `scale-replay.ts`/probe artifacts that are not committed as a reusable entry point. |
| Original canonical-suite 60 s bar | From an idle prepared checkout: `cd snapback2 && /usr/bin/time -p bash scripts/test.sh`; preserve the exact stdout/exit/toolchain and elapsed receipt. | Not run here. The selected 427 tests are correctness evidence only, and the evaluator stop means this review cannot infer a current whole-suite pass or timing. |

The ticket should therefore remain open only for the canonical-suite timing and
the three measured resource obligations above. No correctness repair remains
from its historical audit matrix at this pin.
