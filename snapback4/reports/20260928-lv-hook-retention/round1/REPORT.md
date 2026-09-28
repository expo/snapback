# LV round 1 — invalidation remains a fence

Implemented Astra's three disclosure Highs, builder-schema Medium and documentation Low, plus Grok's withheld-cut, opt-out and property-test findings. No push or publication. Work started by fetching origin and merging origin/main; merge `3b1ed05dd` preserves both journal entries. Read the original prompt, round-0 report/journal, LLP 3000.029 and both complete reviews. Grok was checked at the start and again before completion. Applied llp-orient to the governing read/authority documents.

## Design and implementation

[LLP 3000.029 §7](../../../../llp/3000.029-hook-retention-with-invalidation.rfc.md#7-round-1-evidence-is-a-fence) records the design and Revised date. A reported cut persists independently of observation reset and pending requests. The client cannot publish an evaluation of an older replica, recover old remembered data, or create a fresh observer to bypass that cut. Only published apply through the cut clears it. A cutless authoritative replacement requires a complete sync requested after its evidence; an already-running sync cannot discharge it. Mutation receipts cover their own commit only; an unseen gap fences conservatively.

Accepted whole authoritative answers and refusals reconcile matching observations across all retention policies. This includes nonempty replacements that remove rows. Sequence and request-start order arbitrate every accepted replacement before values or deadlines are installed. Equivalent JSON arguments share authority regardless of object-key order. Transport failure and withheld answers keep their exception; withholding cannot advance the displayed body's sequence or replace its deadline. An initial loading answer still arms its retry deadline. Credentials, generation, store identity and expiry gates remain at publication.

`E_ASSET_UNKNOWN` revokes all owned SDK grants for that asset before listeners run and fences older in-flight grants. Network failure, HTTP 5xx and `E_ASSET_VIEWED` preserve an already-granted first view. Handles still independently check expiry at access. This does not recall copied bytes, copied URL strings or already decoded pixels.

The profile exception needs positive proof on both sides: the write is only a put to an unconditional public base table, and the query is a direct immutable unique-key lookup. Rule witnesses, mutable lookup keys, predicates/require, deletion, derived tables, expiry, native opacity, acquisition and unknown footprints fail closed. Receipts name actual touched tables; a bounded existing commit scan supplies the change interval's proof. On the replica, a prediction-free observation must remain current through apply. Every affected query still reruns. Public profile changes cannot justify retaining an unrelated guarded secret.

Extracted final publication/deadline plumbing into `local-read-publication.ts` to keep `local.ts` at 1,497 lines. No authorization/meter rule, engine delivered-history grant, budget or dependency changed. README remains 300 lines. The source contract and rebuilt `dist/contract.d.ts` now distinguish failed plain refreshes from authoritative refusals and explain that `keep:true` adds only the unsubscribe linger. Generated declarations remain build outputs, as before.

## Adversarial evidence

All five Astra checks have named regressions:

| Check | Witness |
|---|---|
| 1. Revoked replica row after unrelated prediction | Real process and wasm; deliver `/changes`, hold sync and query, commit prediction, open another policy observer and direct read. No secret can return. |
| 2. Opt-out null versus retained peer | Real online, process and wasm; hold changes, deliver the opt-out answer, check default peer before return. |
| 3. Nonempty subset replacement | Same three hosts; a newer one-shot removes row A while row B remains. Reversed argument-object property order cannot split authority. |
| 4. Asset refusal | Online and process SDK grants/listeners, plus real once-view and HTTP-503 preservation controls. |
| 5. Builder's actual profile gate | Online and browser wasm with the comparative profile schema and `myProfile`. Slow empty revalidation, Bob's profile update and Alice's unrelated mutation preserve the route and typed draft. |

Both browser witnesses report:

```json
{"route":"/conversation/bob","mounts":1,"loadingAfterData":0,"profile":"alice"}
```

Additional regressions cover a withheld newer reply followed by revocation at that cut, mutation receipts after unseen gaps, public tables used as rule witnesses, and a pre-requested sync versus later cutless evidence. Grok's opt-out path now withdraws synchronously at device rerun entry.

The independent oracle keeps authorization history, evidence delivery and replica application separate. Forty seeds independently schedule 160 events, three competing observation policies, direct requests and out-of-order replica/server completions. The assertion compares disclosed grants with independently learned revocations, rather than assigning expected snapshots beside reset calls. A separate grant/event oracle covers 400 sequence pairs, including every immediately-next-cut revocation. The older scalar policy test remains an additional policy check, not the disclosure proof.

[Ten final mutation checks](./mutations.json) all fail with assertions: remove the local changes call; disable replica blocking; omit peer reconciliation; skip nonempty replacement; ignore asset refusal; miss next-sequence asset invalidation; advance displayed cut on withholding; remove local profile proof; restore blanket online receipt reset; clear cutless fences with an older sync. [Runner](./mutations.mjs) uses isolated copies of the compiled client/source and never changes the test worktree. [Output](./mutations-canonical-qualified.log.gz).

## Verification and failures

Ran `bash scripts/test.sh` from `snapback4/` **exactly once**. Exact summary:

```text
== 2 failure(s) in 1200 s
   cargo test
   client tests
```

[Full output](./test-sh.log.gz), exit 1. The client aggregate was 4,171 tests: 4,105 pass, 55 fail, 1 cancelled, 10 skipped. All 79 complete model tests passed. Build, wasm, docs budget, release guard, package build/typecheck, chat/Expo typechecks and fixture wrappers passed. Rust's failure was the added empty change-response field violating the legacy base shape; omission of the empty field fixes it.

This was an intermediate implementation run, including an old built client beside a newly extracted source module. It is not a green full-suite qualification of the final tree. Every failing name and attribution is in [FAILURES.md](./FAILURES.md) and [failures.json](./failures.json). All unexpected code, fixture, assertion, staging and operational failures are **ours**; no baseline exemption is claimed. The unavailable dedicated iOS simulator is **environmental**. No known failing affected case remains.

Final affected results are separate, overlapping scopes; do not sum them:

| Check | Result and evidence |
|---|---|
| Final canonical-key fences, independent model, presence and answer ordering | 112 pass / 0 fail, [ordering-qualified](./ordering-qualified.log.gz). |
| Browser gates, real fences and complete retained-history scenarios | 86 pass / 0 fail, [history-fences-qualified](./history-fences-qualified.log.gz). |
| Asset/answer withdrawal, online order, policy and independent models | 223 pass / 0 fail, [authority-qualified](./authority-qualified.log.gz). |
| Delivery fault matrix plus real fences | 329 pass / 0 fail, including 313 delivery cases, [fences-delivery-qualified](./fences-delivery-qualified.log.gz). Final key canonicalization adds no awaits; all 156 site identities/classifications still match. |
| Provenance controls with no delivered invalidation | 16 pass / 0 fail, [provenance-final](./provenance-final.log.gz). |
| Broad affected discovery | 643 pass / 6 fail of 649, [affected-final](./affected-final.log.gz). Failures led to corrected streaming-fixture evidence capture and updated history/replay assertions. Subsequent 170/176 run retained fixture failures, then all history/fence cases passed in the 86-test successor above. Neither intermediate run is relabelled green. |
| HTTP Rust target, `cargo test -p snapback4 --bin snapback4 serve::` | 155 pass / 0 fail / 4 ignored, [rust-http-qualified](./rust-http-qualified.log.gz). Includes positive and negative public-put/query proofs and exact legacy wire shape. |
| Whole guide, `cargo test -p snapback4-lang --test guide` | 98 pass / 0 fail, [guide-qualified](./guide-qualified.log.gz). |
| Client build and generated declarations | Pass, [declarations-qualified](./declarations-qualified.log.gz). Rust binary build passes in [rust-build-final](./rust-build-final.log.gz). |
| Reference audit and whitespace | `ref-check`: 523 LLP documents, 9,860 refs, 0 errors, 0 unchecked; `git diff --check` passes. |

Native Expo was attempted: [native-expo](./native-expo.log.gz) stops with `WITNESS_UDID must name your dedicated booted iOS simulator`. No native UI success is claimed. Real native-process/device paths and the Expo typecheck were exercised.

Compatibility changes are explicit in the LLP: newer direct reads replace live peers and deadlines; losing competing one-shots may return loading; while a replica is fenced, a checked whole server replacement can temporarily replace retained-history composition. After apply, the existing engine's history policy resumes. Updated tests preserve their disclosure/provenance assertions and distinguish pre-evidence controls from delivered-evidence cases.

## Wasm and custody

The canonical build inside the required suite produced **2,040,999 B raw / 593,213 B GNU file-input gzip-9**, SHA-256 `001b4f9e47acead1dc202060f35e409c4ae31826d972e88965489b3e3cd8c436`. Unchanged cap: 593,719 B; headroom: 506 B. [Measurement](./wasm-measurement.json). Byte-identical to round 0; this round changes server and TypeScript behavior only.

No shared tool installation. Only the small `vendor/llp` submodule was initialized for the required orientation skill. No push, deployment or publication. The local commit includes `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
