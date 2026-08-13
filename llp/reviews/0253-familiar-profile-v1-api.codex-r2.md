# Delta review: LLP 0253 r2 — Codex

**Reviewer:** Codex CLI, model `gpt-5.6-sol`, `model_reasoning_effort=xhigh`,
read-only sandbox, repo cwd.
**Revision reviewed:** 0253 r2 (SHA-256 `a0bceb70448406c734122f673f115646fb881424e0fa00a6731e5355088be2dd`).
**Provenance:** run by the orchestrating Claude (Fable 5) session on
2026-08-13; delta prompt (closure check of r1 MATERIALs + hunt for
r2-introduced defects); reviewer read both r1 artifacts as the prompt
required, so this round is a non-blind closure check. Verbatim final
message below.
**Verdict:** NOT READY (5 MATERIAL in-delta, 3 MINOR).

---

# Delta review — LLP 0253 r2

**Reviewer family:** GPT / Codex  
**Method:** independent read-only delta review  
**Revision:** r2, SHA-256 `a0bceb70448406c734122f673f115646fb881424e0fa00a6731e5355088be2dd`

## R1 MATERIAL closure audit

| R1 concern | R2 result |
| --- | --- |
| Kind-blind `returns` | **Not closed** — kind partition fixed, totality/bounds remain defective. |
| Normalized witness/name/graph | **Partly closed** — graph exclusion, plans, secrets, and string export feasibility are repaired; the enumerated preimage remains incomplete. |
| D4 projection | **Not closed** — transport loss is fixed, but the authorization/error split is not derivable from the projected state. |
| Helper discovery contradiction | **Closed.** |
| Default-omission | **Partly closed** — preserves `semanticId`, not the promised `generationId`. |
| Undeclared action effects | **Not closed** — fetch/push are addressed, but other host effects and the action-composition seam remain unresolved. |
| Complete disposition table | **Materially closed**, with a minor omission below. |
| Alias ground truth | **Closed.** |
| Authorization provenance | Substantively supplied by the stated author directive and this review prompt; metadata remains inconsistent. |

## Findings

1. **MATERIAL — IN-DELTA — S4.3 remains neither total nor implementable for bounded record arrays.**

   The query table claims to lower the full familiar `v.*` grammar and calls the lowering a total pure function, but it covers only two array element classes and one tuple form. Valid shapes such as `v.array(v.string())`, record unions, and other tuples have neither a lowering nor a refusal row ([0253:294](/Users/ccheever/projects/snapback/llp/0253-familiar-profile-v1-api.spec.md:294), [0253:302](/Users/ccheever/projects/snapback/llp/0253-familiar-profile-v1-api.spec.md:302), [0253:326](/Users/ccheever/projects/snapback/llp/0253-familiar-profile-v1-api.spec.md:326)).

   More concretely, `v.array(v.object(...), {maxItems: 5})` is admitted by `v.array`, which exposes only `maxItems` ([define.mjs:551](/Users/ccheever/projects/snapback/packages/snapback-codegen/define.mjs:551)). Its stated target, bounded `results.records`, requires both integer `minItems` and `maxItems` whenever either is present ([define.mjs:586](/Users/ccheever/projects/snapback/packages/snapback-codegen/define.mjs:586), [define.mjs:602](/Users/ccheever/projects/snapback/packages/snapback-codegen/define.mjs:602)). R2 neither pins `minItems: 0` nor refuses the shape. This leaves implementers choosing between canonical refusal, dropped bounds, and an unstated default.

   Resolve with a true catch-all partition and explicitly map bounded record arrays to `{minItems: 0, maxItems}` or refuse them.

2. **MATERIAL — IN-DELTA — S5.2’s new enumerated preimage still drops behavior-bearing canonical facts.**

   Plans and secrets are now correctly included, and `graphRecords` is correctly excluded. But the per-operation list omits `stream`, `sequences`, `boundedSkew`, `standardPattern`, and `authorityProfileDependence`; the application list omits the top-level authority profile and asset-upload intents ([0253:441](/Users/ccheever/projects/snapback/llp/0253-familiar-profile-v1-api.spec.md:441)).

   These are real canonical records: `stream`, `boundedSkew`, and `sequences` are emitted on functions ([index.mjs:9519](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:9519), [index.mjs:9528](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:9528)); authority-profile dependence and standard-pattern facts are also retained ([index.mjs:9547](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:9547), [index.mjs:9555](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:9555)). Existing semantic input separately carries application authority and asset intents ([semantic-generation.mjs:326](/Users/ccheever/projects/snapback/packages/snapback-codegen/semantic-generation.mjs:326), [semantic-generation.mjs:330](/Users/ccheever/projects/snapback/packages/snapback-codegen/semantic-generation.mjs:330)).

   Consequently, explicit definitions differing only in streaming, sequences, settlement skew, authority dependence, or asset intent can collide under the proposed `normalizedContractId`, contrary to LLP 0252’s all-behavior-bearing-fields rule ([0252:183](/Users/ccheever/projects/snapback/llp/0252-convex-familiar-authoring-profile.rfc.md:183)).

3. **MATERIAL — IN-DELTA — Default omission preserves `semanticId`, but r2 falsely promises an unchanged `generationId`.**

   Conditional omission works for `semanticId`: canonical hashing includes every own key, so omitting the default profile preserves the old preimage ([semantic-generation.mjs:45](/Users/ccheever/projects/snapback/packages/snapback-codegen/semantic-generation.mjs:45), [semantic-generation.mjs:399](/Users/ccheever/projects/snapback/packages/snapback-codegen/semantic-generation.mjs:399)).

   It cannot preserve `generationId` as claimed at [0253:146](/Users/ccheever/projects/snapback/llp/0253-familiar-profile-v1-api.spec.md:146). R2 adds profile/reference fields and a new `normalized-definition.v1.json` member that explicitly enters the generation envelope ([0253:152](/Users/ccheever/projects/snapback/llp/0253-familiar-profile-v1-api.spec.md:152), [0253:481](/Users/ccheever/projects/snapback/llp/0253-familiar-profile-v1-api.spec.md:481)). Bundle identity hashes generated members ([index.mjs:6443](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:6443), [index.mjs:6470](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:6470)), and `generationId` hashes that `bundleId` ([semantic-generation.mjs:418](/Users/ccheever/projects/snapback/packages/snapback-codegen/semantic-generation.mjs:418)).

   Narrow the guarantee to “no existing `semanticId` rotates” and disclose the ordinary generated-bundle/generation rotation.

4. **MATERIAL — IN-DELTA — S4.4’s effect closure and sole action-composition seam are not implementable as written.**

   First, the claimed exact allowlisted facade never enumerates its exact own and nested properties. The canonical action context contains many base properties plus `runMutation`, realtime, push, fetch, stream-attempt, and stream-emission host operations ([ctx-bootstrap.js:890](/Users/ccheever/projects/snapback/packages/snapback-harness/ctx-bootstrap.js:890), [ctx-bootstrap.js:981](/Users/ccheever/projects/snapback/packages/snapback-harness/ctx-bootstrap.js:981), [ctx-bootstrap.js:1175](/Users/ccheever/projects/snapback/packages/snapback-harness/ctx-bootstrap.js:1175)). R2 stubs fetch/fetchStream/push but never disposes `streamAttempt` or `stream.emit`; without a complete allowlist, “every effectful host operation is unreachable” is unproved ([0253:346](/Users/ccheever/projects/snapback/llp/0253-familiar-profile-v1-api.spec.md:346)).

   Second, the only composition spelling is `ctx.runMutation(api.x.y, args)`, but familiar handlers are declared to use the existing inline lift unchanged ([0253:213](/Users/ccheever/projects/snapback/llp/0253-familiar-profile-v1-api.spec.md:213)). That lift classifies imports as free top-level bindings and refuses them ([inline-handlers.mjs:360](/Users/ccheever/projects/snapback/packages/snapback-codegen/inline-handlers.mjs:360), [inline-handlers.mjs:675](/Users/ccheever/projects/snapback/packages/snapback-codegen/inline-handlers.mjs:675), [inline-handlers.mjs:1251](/Users/ccheever/projects/snapback/packages/snapback-codegen/inline-handlers.mjs:1251)). A direct probe with imported generated `api` produced `SNAPBACK_INLINE_HANDLER_FREE_IDENTIFIER` and no extracted handler.

   R2 needs a specified, custody-bound generated-reference capture/lowering before inline extraction, plus a complete facade property table.

5. **MATERIAL — IN-DELTA — S6.2’s code-class table cannot distinguish authority transition from an error-class permission refusal.**

   R2 distinguishes a “mid-subscription authorization denial” from error-class typed refusals using only a diagnostic-code table ([0253:549](/Users/ccheever/projects/snapback/llp/0253-familiar-profile-v1-api.spec.md:549), [0253:552](/Users/ccheever/projects/snapback/llp/0253-familiar-profile-v1-api.spec.md:552)). But `QueryState.error` carries only `error`, `connection`, and the ordinary axes—no event reason or temporal provenance ([index.d.mts:151](/Users/ccheever/projects/snapback/packages/snapback-react/index.d.mts:151)). The React implementation observes `detail.kind === "authorization_denied"` and then discards that fact when publishing the error state ([implementation.mjs:992](/Users/ccheever/projects/snapback/packages/snapback-react/implementation.mjs:992), [implementation.mjs:1009](/Users/ccheever/projects/snapback/packages/snapback-react/implementation.mjs:1009)).

   Moreover, `SNAPBACK_AUTH_PERMISSION_DENIED` is also the trusted code for handler-level permission checks ([ctx-bootstrap.js:1219](/Users/ccheever/projects/snapback/packages/snapback-harness/ctx-bootstrap.js:1219)). A code-only classifier must therefore either turn an error-class handler refusal into `undefined` or throw a continuing authority revocation. Add canonical reason/provenance to the state, or revise the contract to classify all subscription authorization denials identically and prove that no error-class path shares those codes.

## Minor findings

- **MINOR — IN-DELTA — Dotted names are feasible through esbuild, but the required emission sweep is underspecified.** ES2022 string exports survive the actual esbuild configuration, so the core choice is sound. However quoting TypeScript members fixes [index.mjs:13508](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:13508) but not generated function declarations and dotted property accesses such as [contract-emitter.mjs:124](/Users/ccheever/projects/snapback/packages/snapback-codegen/contract-emitter.mjs:124) or [index.mjs:11942](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:11942). Phase B should require deterministic safe local bindings, bracket access, string re-exports, and string-alias-aware inline attribution.

- **MINOR — IN-DELTA — Appendix A is not literally complete.** `defineJsMutation` accepts and preserves the authored `outgrewIr` key ([define.mjs:4356](/Users/ccheever/projects/snapback/packages/snapback-codegen/define.mjs:4356)), but Appendix A has no disposition for it ([0253:705](/Users/ccheever/projects/snapback/llp/0253-familiar-profile-v1-api.spec.md:705)). The mandatory generated fail-closed gate prevents silent activation, so this is not independently material.

- **MINOR — IN-DELTA — Acceptance metadata still disagrees.** R2 records an author directive and this review was explicitly instructed to treat LLP 0252 as governing law, but LLP 0252 remains `Review`, says r5 is unreviewed, and still says acceptance “would” authorize the experiment ([0252:4](/Users/ccheever/projects/snapback/llp/0252-convex-familiar-authoring-profile.rfc.md:4), [0252:10](/Users/ccheever/projects/snapback/llp/0252-convex-familiar-authoring-profile.rfc.md:10), [0252:1069](/Users/ccheever/projects/snapback/llp/0252-convex-familiar-authoring-profile.rfc.md:1069)). The promised same-landing status repair should be present before landing.

The filesystem was read-only, so this review was not persisted under `llp/reviews/`.

VERDICT: NOT READY