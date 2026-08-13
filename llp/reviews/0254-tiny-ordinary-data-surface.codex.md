# Codex (GPT family) reviews — LLP 0254 (tiny ordinary data surface)

Review artifacts for `llp/0254-tiny-ordinary-data-surface.rfc.md` from the
GPT family, one dated section per round, bodies verbatim.

## Round 1 — 2026-08-13

- **Runtime:** Codex CLI 0.147.0, model `gpt-5.6-sol`,
  `model_reasoning_effort=xhigh`, read-only sandbox,
  `--skip-git-repo-check`, launched blind in the round-1 capsule by the
  orchestrating session (launch 1). The reviewer's header self-describes
  only as "GPT-5 family; exact deployment variant not exposed"; the
  launched model configuration is as recorded here.
- **Revision reviewed:** r1, SHA-256
  `1cf025584684715e9422eae7fe748008ce6c1be5cdd9666cca1af65d42dc99c2`
  (42,295 bytes); the reviewer verified hash and byte count in-capsule.
- **Capsule inventory SHA-256:**
  `ae05f426e40a4efaa986c90d5d4e64003d2d14c7dcf082b46eeffba007bc3480`;
  instruction SHA-256
  `0f44e12dec3bd2434338bb0631267cd2e56322d3d2b7e7aa0b82b69252a86adf`.
- **Verdict:** NOT READY (2 MATERIAL, 1 DETAIL; direction retained).
  Self-attested capsule-only with one disclosed pre-instruction
  deviation: its harness's mandatory skill rules read two local skill
  files outside the capsule before the confinement instruction was seen;
  no review content was involved. Counted with disclosure.

---

# Independent review — LLP 0254 r1

- **Reviewer/runtime:** OpenAI Codex, GPT-5 family; exact deployment variant not exposed
- **Date:** 2026-08-13
- **Target:** `llp/0254-tiny-ordinary-data-surface.rfc.md`
- **Identity:** SHA-256 `1cf025584684715e9422eae7fe748008ce6c1be5cdd9666cca1af65d42dc99c2`; independently verified at 42,295 bytes and 891 lines
- **Notable capsule files read or searched:** `REVIEW_INSTRUCTIONS.md`; LLP 0254, 0252, 0253, 0065, 0082, 0102, 0155, 0157, 0193, 0197, 0203, 0218, 0231, 0238, 0240–0243, 0245, and 0247; diaries 0027–0031; `guide/index.md`; `guide/capabilities.md`; relevant files under `packages/snapback-codegen/`, `packages/snapback-client/`, `packages/snapback-react/`, `packages/snapback-harness/`, and `src/`.

## Overall assessment

The direction is strong and worth retaining. The RFC draws a credible boundary around a generated ordinary-data layer without creating a third function profile, runtime, cache, policy evaluator, or settlement owner. Its closed query descriptors, server-authoritative writes, explicit escape path, truthful lifecycle distinctions, withdrawal requirement, and same-runtime evaluation design are appropriate RFC-level decisions. The historical and shipped-surface claims I checked were generally accurate, including the current absence of the proposed `Data*V1` artifacts and the partial status of standard-pattern support.

The revision is not ready because two load-bearing contracts are internally inconsistent with the governing corpus. First, it demands byte-equivalent cross-profile artifacts that must themselves contain profile-dependent generation fences. Second, it couples durable offline custody to local prediction even though Snapback’s accepted and shipped lifecycle explicitly permits queued intent with no optimistic installation. Both defects are repairable without changing the product direction.

## Concerns

1. **MATERIAL — D1, Required canonical artifacts, Architecture acceptance: whole-artifact byte equivalence contradicts mandatory profile and generation identity.**

   LLP 0254 gives the data layer its own semantic/generation identity (`llp/0254-tiny-ordinary-data-surface.rfc.md:267`), requires `DataQueryV1` and `DataTransactionV1` to carry the active app/generation (`llp/0254-tiny-ordinary-data-surface.rfc.md:661`, `llp/0254-tiny-ordinary-data-surface.rfc.md:672`), and includes generation inputs in `DataResourceV1` (`llp/0254-tiny-ordinary-data-surface.rfc.md:647`). It nevertheless requires explicit- and familiar-profile applications to generate byte-equivalent complete `DataResourceV1`, `DataQueryV1`, and `DataTransactionV1` facts, excluding only named source-custody differences (`llp/0254-tiny-ordinary-data-surface.rfc.md:771`).

   That equality cannot hold for the required artifacts. LLP 0252 makes the authoring profile a semantic-identity input and requires distinct `semanticId` and `generationId` values even when normalized definitions match; `normalizedContractId` is the separate equivalence witness (`llp/0252-convex-familiar-authoring-profile.rfc.md:271`). LLP 0253 implements the same split, excluding the profile only from `NormalizedApplicationDefinitionV1`, not from semantic/generation fencing (`llp/0253-familiar-profile-v1-api.spec.md:164`). These fences are not source-custody trivia: exact replay and resume retain them (`llp/0241-semantic-artifact-generations.rfc.md:135`), and queued records keep their original generation IDs without retargeting (`llp/0241-semantic-artifact-generations.rfc.md:314`).

   **Resolution:** Split each proposed artifact into a profile-neutral normalized semantic core and a profile/app/generation-bound envelope or instance. Require byte equivalence only for the normalized cores, preferably through a named witness analogous to `normalizedContractId`; require the enclosing generation and replay fences to remain distinct. Amend D1’s allowed residual profile facts, the canonical-artifact requirements, and the acceptance oracle accordingly.

2. **MATERIAL — D5–D7 and Local-first acceptance: prediction, durable queue eligibility, and function escape are incorrectly collapsed.**

   D5 initially treats outbox retention as an independent generated capability (`llp/0254-tiny-ordinary-data-surface.rfc.md:413`), but then says an operation lacking exact local prediction has neither optimistic nor offline support (`llp/0254-tiny-ordinary-data-surface.rfc.md:423`). D7 further routes every operation whose prediction cannot share the server form to the function escape (`llp/0254-tiny-ordinary-data-surface.rfc.md:464`). This also conflicts with D6’s own separate distinctions among optimistic paint, durable custody, queued state, and settlement (`llp/0254-tiny-ordinary-data-surface.rfc.md:451`).

   The governing lifecycle deliberately keeps these axes independent. LLP 0155 declares `server-only` a valid local-prediction degradation and permits showing pending intent without fabricating a row effect (`llp/0155-local-sync-product-direction.rfc.md:832`). LLP 0218’s queued outcome carries `presentation: installed | withheld | unavailable` (`llp/0218-outbox-settlement-contract.rfc.md:135`), and explicitly states that presentation failure cannot reject accepted queued intent (`llp/0218-outbox-settlement-contract.rfc.md:206`). The shipped React regression covers a queued mutation with no optimistic installation and reports `presentation: "withheld"` (`packages/snapback-react/optimistic.test.mjs:345`). Thus lack of prediction disables optimistic paint, not necessarily durable offline custody. Moreover, a custom function is not a coherent mandatory escape merely because prediction is unavailable; it may remain equally server-only.

   **Resolution:** Define prediction, durable custody/replay, and settlement as independent generated capability axes. A non-predictable operation may still queue with withheld or unavailable presentation when its custody contract permits; an online-only operation must be online-only for an independently stated reason. Reserve the function escape for server semantics outside the generated operation algebra, not for prediction failure alone. Add acceptance cases for queueable-without-prediction, predictable-but-nonqueueable if admitted, and fully local-capable operations.

3. **DETAIL — D10 and Phase 0: freeze the withdrawal/drain oracle for already accepted queued intents.**

   The RFC correctly requires withdrawal without losing accepted queued intent (`llp/0254-tiny-ordinary-data-surface.rfc.md:606`, `llp/0254-tiny-ordinary-data-surface.rfc.md:780`). The follow-on work should make explicit that withdrawal preserves each record’s original exact generation and compatible executable until settlement or its existing typed stale-generation disposition; it must never rewrite the record to the projected named operation. LLP 0241 already establishes that rule (`llp/0241-semantic-artifact-generations.rfc.md:314`).

   **Disposition:** The follow-on API/descriptor Spec and Phase 0 withdrawal proof should define and test this drain protocol before any external experiment ships.

## Direction assessment

**Retained.** A profile-neutral, generated ordinary-data layer over the existing canonical runtime is a sound experiment. The concerns require correcting identity layering and the capability lattice, not abandoning the four-concept surface, closed descriptors, function escape, or evidence-gated promotion strategy.

## Self-attestation

I used no network access and did not read any file matching `llp/reviews/0253*` or `llp/reviews/0254*`; a capsule-local filename search confirmed none was present. I did not seek or infer other reviewers’ views. Deviation: before opening `REVIEW_INSTRUCTIONS.md`, mandatory harness skill rules caused me to read `/Users/ccheever/.codex/skills/llp-orient/SKILL.md` and `/Users/ccheever/.codex/skills/llp-review/SKILL.md`, both outside the capsule. After discovering the confinement rule, I made no further out-of-capsule access. The harness also injected system/developer instructions, the project `AGENTS.md` and environment context, and later a compaction summary of my own preceding capsule-derived work; none contained another LLP 0253/0254 review or orchestrator run notes.

VERDICT: NOT READY

## Round 2 — 2026-08-13 (delta round)

- **Runtime:** same as round 1 (Codex CLI 0.147.0, `gpt-5.6-sol`,
  `model_reasoning_effort=xhigh`, read-only sandbox), launched blind in
  the round-2 capsule (launch 2). The reviewer's header self-describes as
  "GPT-5-family runtime; exact build identifier unavailable".
- **Revision reviewed:** r2, SHA-256
  `45d72bb110c0d0743085d0cd56548324f0231d0f632cb445917e263ae0ba9505`
  (49,295 bytes); verified in-capsule.
- **Capsule inventory SHA-256:**
  `439db821edf2cec30ef5f70d4ca2a4e2888c027e96bdb9027eee4855d68bcbd8`;
  instruction SHA-256
  `dd8e8f9aa6ba754bd06d65f73e36d356db5a6a26d30677e7c7dc6c92c8d1d467`.
- **Verdict:** NOT READY (5 MATERIAL, all IN-DELTA; zero PRE-EXISTING
  MATERIAL; direction retained). Disclosed deviations: one
  pre-instruction out-of-capsule skill-file read (harness protocol), and
  reads of the capsule-local tracked `REVIEW-CANDIDATE-r*.md` files,
  which concern LLP 0237–0244 and are not sibling reviews of this
  target. Counted with disclosure.

---

# Independent review — LLP 0254 r2 delta round

- **Model/runtime:** OpenAI Codex, GPT-5-family runtime; exact build identifier unavailable
- **Review date:** 2026-08-13
- **Target:** `llp/0254-tiny-ordinary-data-surface.rfc.md`, r2
- **Verified identity:** SHA-256 `45d72bb110c0d0743085d0cd56548324f0231d0f632cb445917e263ae0ba9505`; 49,295 bytes
- **Method:** Independent LLP 0005-style review; no author-status action taken
- **Notable files read or searched:** `REVIEW_INSTRUCTIONS.md`; the complete target; LLPs 0065, 0082, 0102, 0155, 0157, 0193, 0197, 0203, 0218, 0231, 0238, 0240–0243, 0245, 0247, 0252, and 0253; diaries 0027–0031; InstantDB run capsules; `packages/snapback-codegen/{standard-patterns,semantic-generation}*`; generated-mutation IR tests and declarations; `packages/snapback-client`; `packages/snapback-react/index.d.mts`; `guide/backend/standard-patterns.md`; `guide/auth/protecting-data.md`; and target-symbol searches across the named packages, `guide/`, and `src/`.

The 19 enumerated r2 changes are all positively identifiable in the target. The capsule contains no r1 copy of LLP 0254, so I could not perform a bytewise r1→r2 negative check for undisclosed changes. The root `REVIEW-CANDIDATE-r1.md` and `REVIEW-CANDIDATE-r2.md` files are unrelated LLP 0237–0244 review artifacts, not target revisions.

## Overall assessment

The direction remains compelling. The RFC draws a useful boundary around ordinary analyzable data, preserves mandatory policy and server authority, keeps custom logic on an explicit escape path, and treats smallness as a measured product hypothesis rather than an export-count exercise. The r2 corrections to owner assignment, truthful query state, non-predictable queued writes, familiar-profile escape routing, normalized-core equivalence, and staged Chat admission materially improve the proposal.

The revision is not ready, however. Five revised seams remain decision-level defects. D9 does not define one executable comparison matrix; D4 contradicts the accepted materialization-key contract; D5 declares a three-axis capability lattice without selecting its valid combinations or declaration locus; D1 overstates what default omission can preserve in LLP 0241’s identity stack; and D3 silently conflicts with LLP 0065’s explicit-index rule. All concerns are IN-DELTA; I found no separate PRE-EXISTING material concern.

## Concerns

### 1. MATERIAL · IN-DELTA — D9/D11 do not define one executable factorial comparison

D9 says it is a factorial extension of LLP 0252 D7 and that the inherited ablation and pinned-Convex arms remain (`llp/0254-tiny-ordinary-data-surface.rfc.md:590-597`). Its displayed matrix instead contains explicit, familiar, tiny, and InstantDB lanes, omitting both the familiar-server ablation and pinned Convex (`llp/0254-tiny-ordinary-data-surface.rfc.md:601-606`). It then defines the causal control as the non-tiny lane in profile P, while saying the full tiny/non-tiny × explicit/familiar crossing may happen only later (`llp/0254-tiny-ordinary-data-surface.rfc.md:608-617`). D11 nevertheless calls this one factorial extension (`llp/0254-tiny-ordinary-data-surface.rfc.md:721-726`).

The inherited matrix is explicit: explicit, familiar, familiar-server ablation, and pinned Convex across three workload families (`llp/0252-convex-familiar-authoring-profile.rfc.md:654-671`), with a complete round defined as the full lane × workload matrix (`llp/0252-convex-familiar-authoring-profile.rfc.md:704-710`). r2 neither preserves that matrix nor provides a replacement set of cells.

Workloads are also not fully instantiated. Todo is mandatory, Chat is conditional, and day-two starts from an unspecified “completed ordinary app” (`llp/0254-tiny-ordinary-data-surface.rfc.md:619-635`). It is therefore unclear whether day-two evolves Todo, admitted Chat, both, or a separate base.

Resolve this with one normative cell table naming, for the first comparison:

- every data-surface × function-profile × workload cell;
- which 0252 ablation and Convex cells remain;
- which InstantDB cells are calibration-only;
- the base app for day-two;
- which cells are conditional on Chat admission; and
- which exact cells can support tiny promotion versus only LLP 0252’s profile disposition.

### 2. MATERIAL · IN-DELTA — D4’s materialization-sharing rule contradicts `QueryMaterializationKeyV1`

D4 says a descriptor and named generated query share one materialization identity when their canonical plan and arguments match (`llp/0254-tiny-ordinary-data-surface.rfc.md:410-415`).

That is not LLP 0157’s identity rule. Its preimage includes activation, the complete generated function reference, plan hash, canonical arguments, and authority partition (`llp/0157-composition-algebra-and-completeness.spec.md:752-778`). It explicitly states that two exported functions with the same plan hash have distinct keys and that cross-function deduplication is not observable query identity (`llp/0157-composition-algebra-and-completeness.spec.md:838-844`).

The phrase “occupies the exported-function slot” does not repair the contradiction because r2 makes sharing depend only on plan and arguments. Resolve it by requiring a descriptor to alias one exact generated function reference and share a QMK only when the complete LLP 0157 preimage is identical. Otherwise retain distinct identities, or explicitly amend LLP 0157 with a reviewed replacement identity contract.

### 3. MATERIAL · IN-DELTA — the prediction × custody × settlement lattice is underdetermined

D5 calls prediction, durable custody, and settlement “independent generated capability axes” (`llp/0254-tiny-ordinary-data-surface.rfc.md:455-463`), but never enumerates their values, valid combinations, or declaration/derivation locus. The artifact lists merely name a “prediction and settlement profile” and a “custody/queue/settlement capability” (`llp/0254-tiny-ordinary-data-surface.rfc.md:744-778`).

The cited owners do not define the asserted three-axis operation lattice. LLP 0155 separates optimistic presentation from authoritative settlement and classifies local execution as ready, partial, server-only, or refused (`llp/0155-local-sync-product-direction.rfc.md:451-456`, `llp/0155-local-sync-product-direction.rfc.md:832-846`). LLP 0218 defines queued versus foreground-settled dispatch and requires queued records to be replay-eligible (`llp/0218-outbox-settlement-contract.rfc.md:150-159`); it does not define an admitted generated mutation with settlement capability absent. The shipped IR exposes only `local-executable | server-only` (`packages/snapback-client/index.d.mts:133-148`), and its server-only test is explicitly a degradation without durable outbox composition (`packages/snapback-client/generated-mutation-ir.test.mjs:177-180`).

Resolve this at RFC altitude with a normative table that states:

- whether authoritative settlement is mandatory for every admitted data transaction;
- whether the actual lattice is prediction × custody with settlement invariant;
- every permitted and forbidden combination;
- how target capability affects each combination;
- whether each fact is authored, profile-defaulted, or derived; and
- the stable reason/refusal vocabulary for every unsupported combination.

### 4. MATERIAL · IN-DELTA — D1 overclaims default-omission identity stability

D1 says an application with no data-resource facts hashes exactly as before and that introducing the layer rotates no existing identity (`llp/0254-tiny-ordinary-data-surface.rfc.md:278-285`).

That is not the LLP 0253 S1.2 lesson cited there. LLP 0253 preserves the semantic preimage by omitting the default profile fact, but explicitly says the new generated member rotates `bundleId` and therefore `generationId` on regeneration (`llp/0253-familiar-profile-v1-api.spec.md:162-177`). LLP 0241 defines `generationId` over semantic, executable, evidence, bundle, app/data/target, and schema identities (`llp/0241-semantic-artifact-generation.rfc.md:101-119`), matching the shipped implementation (`packages/snapback-codegen/semantic-generation.mjs:405-427`).

Resolve this by limiting the no-rotation promise to the exact identity layers whose preimages remain byte-identical—probably the data-surface semantic subgraph and application `semanticId`. Separately state when emitter, package, evidence, bundle, or generation identities rotate. If byte-identical `generationId` is truly required, specify how the complete bundle input and generation schema remain unchanged, not only how a semantic field is omitted.

### 5. MATERIAL · IN-DELTA — D3 silently reverses LLP 0065’s explicit-index decision

D3 permits deriving an index when exactly one is eligible (`llp/0254-tiny-ordinary-data-surface.rfc.md:359-361`). LLP 0065 requires the author to name `listIndex` explicitly and says index choice is never inferred (`llp/0065-generated-data-pattern-soundness.rfc.md:235-240`). The shipped implementation refuses an absent `listIndex` (`packages/snapback-codegen/standard-patterns.mjs:257-268`), and the guide documents the same rule (`guide/backend/standard-patterns.md:78-93`).

This cannot be left ambiguous between dynamic `DataQueryV1` admission and Phase 1’s generated list operation, because Phase 1 promises list generation over the LLP 0065 owner profile (`llp/0254-tiny-ordinary-data-surface.rfc.md:796-804`).

Resolve it by choosing one rule explicitly:

- retain authored `listIndex` for generated CRUD while allowing uniquely determined index selection only for a separately defined descriptor shape; or
- deliberately amend LLP 0065, the implementation, and the guide, with identity and schema-evolution behavior for the newly derived choice.

## Implementer probe

### Capability lattice

From r2 alone, only these conclusions are possible:

| Prediction | Durable custody | Settlement | Status |
| --- | --- | --- | --- |
| yes | yes | yes | Clearly intended ordinary case |
| no | yes | yes | Explicitly admitted with `withheld`/`unavailable` presentation |
| yes | no | yes | Plausible online-only case, but not explicitly admitted |
| no | no | yes | Plausible server-only online case, but not explicitly admitted |
| any | any | no | Undefined; likely invalid, despite “independent axis” wording |

The declaration mechanism is also unresolved: D5 says the capabilities are generated, D2 describes custody/settlement as explicit transaction facts, and the canonical-artifact section supplies no closed enum or derivation rule. The lattice is therefore UNDERDETERMINED in the material sense described in concern 3.

### First D9 comparison

The defensible partial statement is:

- the causal pair is tiny data versus non-tiny data under the same preregistered profile P;
- full day-two coverage forces P to `snapback-explicit-v1`;
- Todo is mandatory;
- Chat is conditional on a reviewed membership-read profile; and
- InstantDB is calibration-only.

The complete first comparison cannot be stated. The document does not reconcile that pair with its four-lane table, LLP 0252’s retained ablation and Convex lanes, its “later factorial” sentence, or the workload from which day-two begins. The lane/workload probe is therefore UNDERDETERMINED as concern 1 describes.

## Direction assessment

Retained. A profile-neutral, generated ordinary-data surface over Snapback’s existing authority, materialization, custody, and settlement owners is worth specifying and testing. The concerns require tightening owner contracts and the experiment, not abandoning the direction.

## Verdict

Self-attestation: I did not use the network and did not read any `llp/reviews/0253*` or `llp/reviews/0254*` file or attempt to infer sibling-review views. After reading the brief, all repository reads and searches stayed inside the capsule. Before opening the brief, the higher-priority harness skill protocol required me to read `/Users/ccheever/.codex/skills/llp-review/SKILL.md` outside the capsule; that is the sole confinement deviation. The harness also supplied the request’s AGENTS/environment context and system/developer instructions; none contained LLP 0253/0254 review content. During an attempted r1 lookup I opened capsule-local `REVIEW-CANDIDATE-r1.md` and `REVIEW-CANDIDATE-r2.md`; they concern LLP 0237–0244, are not forbidden sibling reviews or target revisions, and were excluded from the findings.

VERDICT: NOT READY


## Round 3 — 2026-08-13 (final delta round)

- **Runtime:** same as rounds 1–2 (Codex CLI 0.147.0, `gpt-5.6-sol`,
  `model_reasoning_effort=xhigh`, read-only sandbox), launched blind in
  the round-3 capsule (launch 3).
- **Revision reviewed:** r3, SHA-256
  `61653099a9090e817ac536d2c4d37a93716f5e35f7aa5b43fe3483b3a36424c8`
  (52,516 bytes); verified in-capsule.
- **Capsule inventory SHA-256:**
  `fe10cc467997caaf8bb9507426120ce309288cb083e9c6c69a797b71f205aabc`;
  instruction SHA-256
  `c4cf80d9286cad14b7937f1edbc977efef343974ecb3437b4bfc389293a3825a`.
- **Verdict:** NOT READY (2 MATERIAL, both IN-DELTA; zero PRE-EXISTING
  MATERIAL; direction retained). Disclosed deviations: the
  pre-instruction skill-file read (harness protocol), an in-capsule git
  invocation that walked parent directories without retrieving outside
  repository content, and a read of capsule-local `REVIEW-CANDIDATE-r2.md`
  (unrelated 0237–0244 code review) while searching for the target's r2
  text. Counted with disclosure.

---

# Independent review — LLP 0254 r3

**Reviewer/runtime:** OpenAI Codex, GPT-5 family; exact serving build not exposed  
**Date:** 2026-08-13  
**Target:** `llp/0254-tiny-ordinary-data-surface.rfc.md` r3  
**Verified identity:** SHA-256 `61653099a9090e817ac536d2c4d37a93716f5e35f7aa5b43fe3483b3a36424c8`; 52,516 bytes  
**Notable files read or searched:** `REVIEW_INSTRUCTIONS.md`; the target in full; LLPs 0000, 0053, 0065, 0082, 0102, 0108, 0155, 0157, 0193, 0197, 0203, 0218, 0231, 0238, 0240–0243, 0245, 0247, 0252, and 0253; diaries 0027–0031; relevant material under `packages/snapback-codegen`, `packages/snapback-client`, `packages/snapback-react`, `packages/snapback-harness`, `guide/`, and `src/`.

## Overall assessment

The direction is coherent and substantially better pinned than a typical experimental-surface RFC. The profile-neutral boundary, explicit authority floor, closed query descriptors, function-slot materialization identity, truthful shipped `QueryState` names, monotonic function escape, withdrawal requirement, and normative D9 cell table all align well with their governing owners. The revised diary attribution is supported by diaries 0029–0031, and the D1, D3, D4, D6, and Phase 2 revisions accurately acknowledge the current corpus rather than relabeling proposed behavior as shipped.

All fourteen enumerated r3 outcomes are present in the target. The capsule, however, contains no r2 target snapshot or patch, so I could not mechanically prove that the enumeration omits no other r2→r3 change. Classification below therefore uses the supplied delta enumeration and direct inspection of r3.

Two IN-DELTA material defects remain. The first leaves the new online-only custody cells without a sound post-send ambiguity disposition. The second makes the newly introduced D9 clock circular with the implementation sequence. Both are local repairs; neither warrants abandoning the direction.

## Concerns

1. **MATERIAL · IN-DELTA — D5/D6: the online-only cells have no sound disposition for a post-send ambiguous result.**

   D5 declares settlement obligatory for every accepted intent, admits both online-only cells, and says they “settle in the foreground attempt or reject” (`llp/0254-tiny-ordinary-data-surface.rfc.md:474`). D6 separately requires the transaction result to distinguish authoritative settlement or refusal (`llp/0254-tiny-ordinary-data-surface.rfc.md:523`). Neither section says what happens when the request may have committed but its response is lost.

   That omission conflicts with the governing rule that a receipt-less ambiguous result remains pending unless idempotency proves another safe disposition (`llp/0155-local-sync-product-direction.rfc.md:1103`). It is not hypothetical implementation detail: the shipped client explicitly treats a receipt-less failure as ambiguous (`packages/snapback-client/index.mjs:9525`) and, when durable queue capability is unavailable, exposes the ambiguous transport error while creating no durable intent (`packages/snapback-client/index.mjs:9573`, `packages/snapback-client/index.mjs:9584`). Thus “reject” can mean neither authoritative refusal nor known non-acceptance.

   An implementer must currently choose among violating obligatory settlement, silently collapsing ambiguity into rejection, or adding an unnamed custody mechanism to the online-only cell. Resolve this by pinning the online-only post-send lifecycle: either dispatched intent identity remains recoverably pending until a server-ledger terminal answer, with its exact custody owner named, or “reject” is restricted to proved pre-dispatch non-acceptance and every possibly accepted request receives another explicit terminal/ambiguous disposition. The named LLP 0218/0108 amendment should carry response-loss and crash-boundary acceptance cases.

2. **MATERIAL · IN-DELTA — D9/Phase 4: the experiment clock is circular.**

   D9 says its clock starts at the first qualified tiny-surface publication “after Phase 4” (`llp/0254-tiny-ordinary-data-surface.rfc.md:629`). But Phase 4 itself requires shipping that closure and then running D9 (`llp/0254-tiny-ordinary-data-surface.rfc.md:867`). Read literally, Phase 4 cannot complete until D9 runs, while D9’s clock cannot start until after Phase 4 completes.

   This prevents the 90-day stop date and three-round trigger from acquiring an unambiguous start instant. Resolve it by starting the clock at the qualified publication made during Phase 4, after the client/package qualification bullets and before any D9 result is observed, and by ordering the Phase 4 bullets accordingly.

## Implementer probe

### A. Generated-operation v1 capability lattice

The document determines these four cells:

| Prediction | Custody | Required behavior |
| --- | --- | --- |
| generated exact shared prediction | queue-eligible durable custody | optimistic paint, durable offline queue, authoritative settlement |
| none | queue-eligible durable custody | no optimistic paint; `withheld`/`unavailable` presentation; durable queue and identical settlement |
| generated exact shared prediction | online-only | optimistic paint with foreground-only dispatch |
| none | online-only | no optimistic paint; foreground-only dispatch |

Prediction is generated from the operation IR. Custody defaults to queue-eligible; an online-only exception is generated or profile-defaulted and carries a stable declared reason. Settlement is obligatory for every accepted intent and is not a third toggle. Operation-declared custody reaches the shipped contract only through a named LLP 0218/0108 amendment or canonical owner.

The Cartesian lattice is enumerable, but both online-only cells are **UNDERDETERMINED** at the response-loss boundary for the reason in Concern 1.

### B. First D9 comparison

The first comparison runs:

- tiny data surface with function profile `snapback-explicit-v1` (P): Todo plus day-two evolution from that Todo app;
- explicit data path with the same profile: Todo plus the corresponding day-two evolution;
- pinned InstantDB: Todo only, as external calibration and excluded from the causal decision.

This experiment owns its clock. LLP 0252 D7 retains its separate clock, four lanes—explicit, familiar, familiar-server ablation, and pinned Convex—and its four dispositions. Chat enters D9 only through a dated Plan amendment after OQ8 admission. Familiar-profile D9 cells belong to a later separately preregistered 2×2.

The cells and workload ownership are determinate. The clock’s start instant is **UNDERDETERMINED** because of the Phase 4 cycle in Concern 2.

## Direction assessment

Direction retained. A generated, policy-composed ordinary-data layer over one canonical runtime is a sound experiment, and the RFC keeps its abstraction cliff, capability truth, and withdrawal obligations visible. The remaining defects are repairs to settlement and evaluation operability, not reasons to reject the product hypothesis.

## Self-attestation

I did not use the network and did not read, list, or search any file matching `llp/reviews/0253*` or `llp/reviews/0254*`. Deviations/context disclosure: higher-priority runtime instructions required me to read `/Users/ccheever/.codex/skills/llp-review/SKILL.md`, outside the capsule. I also invoked Git from the capsule; because it was not a repository, Git searched parent directories and macOS tooling made unsuccessful `/tmp/xcrun_db-*` cache-file attempts, yielding no outside repository content. I opened capsule-local `REVIEW-CANDIDATE-r2.md` while looking for the target’s r2 text; it proved to be an unrelated code review and was not used in this review. The harness injected system/developer/tool instructions, the AGENTS/environment context, and the available-skill catalog; I did not request that context. No other known confinement or blindness deviation occurred.

VERDICT: NOT READY


## Commissioned round — r3→r4 delta review, 2026-08-13

- **Runtime:** same as the loop rounds (Codex CLI 0.147.0, `gpt-5.6-sol`,
  `model_reasoning_effort=xhigh`, read-only sandbox), launched blind in
  the commissioned-round capsule (launch 4). Author-commissioned
  post-loop round per the run journal.
- **Revision reviewed:** r4, SHA-256
  `2aa81da0573dcad714808807d2338ee706e80574beaaf872ab894d1d69d602d6`
  (54,093 bytes); verified in-capsule.
- **Capsule inventory SHA-256:**
  `fcc98945c9fb45593d140b05196a28ae5a16fe76c8c87e67214d3a96c18a7e23`;
  instruction SHA-256
  `582c6cab0c1ffd12c379c0d19a9b726debddcb13b79a16c4fde8b2ca7a76b440`.
- **Verdict:** READY (0 MATERIAL; 2 DETAIL — 1 IN-DELTA, 1 PRE-EXISTING,
  both Spec/Plan-dispositioned; direction retained; no confinement
  deviation reported). Orchestrator provenance note: two citations in
  the body carry incorrect file slugs ("0252-one-expo-package",
  "0238-react-hooks-package") — the actual corpus files are
  `0252-convex-familiar-authoring-profile.rfc.md` and
  `0238-explicit-client-lifecycles.rfc.md`; the cited content (the 0238
  `refresh`/`diagnostic` hook vocabulary; a pre-clock backstop
  precedent) matches what other families verified against the real
  files, so the ledger substance stands. Body verbatim below.

---

# Independent Review — LLP 0254 r4

- **Reviewer:** OpenAI Codex, GPT-5-family model, sandboxed CLI runtime
- **Date:** 2026-08-13
- **Revision:** `2aa81da0573dcad714808807d2338ee706e80574beaaf872ab894d1d69d602d6` (verified; 54,093 bytes)
- **Primary artifact:** `llp/0254-tiny-ordinary-data-surface.rfc.md`
- **Notable evidence reviewed:** LLPs 0043, 0065, 0082, 0102, 0108, 0155, 0157, 0193, 0197, 0203, 0218, 0231, 0238, 0240–0243, 0245, 0247, 0252, and 0253; diaries 0027–0031; relevant guide pages; and implementation surfaces under `packages/snapback-codegen`, `packages/snapback-client`, `packages/snapback-react`, `packages/snapback-harness`, and `src`.

## Overall assessment

Revision r4 is ready. It presents a coherent, bounded ordinary-data surface while preserving Snapback’s existing authority, identity, visibility, generated-artifact, query-state, mutation-settlement, and offline-custody owners.

The revision resolves the two highest-risk questions:

- D5 now gives online-only mutations a determinate ambiguous-outcome lifecycle. A post-dispatch response loss is not falsely reported as rejection; the intent remains recoverably pending under stable identity until the server ledger supplies a terminal result or non-acceptance is proven. The RFC also assigns the necessary implementation-contract change to a named LLP 0218 amendment, with LLP 0043 included if dispatch surfaces change.
- D9 now identifies both the initial comparison cells and the precise clock anchor. Earlier development checkpoints cannot consume the experiment window.

All fourteen declared r4 changes are present and internally consistent. The remaining issues below are specification-hygiene details suitable for the required follow-on Spec or evaluation Plan; neither undermines the RFC’s decision.

## Concerns

No MATERIAL concerns were found.

1. **[DETAIL · IN-DELTA] Make the stop-date backstop an explicit pre-clock deliverable.**

   D10 requires the clock-ending decision to produce an Experimental freeze and a repository backstop ticket when no ruling exists (`llp/0254-tiny-ordinary-data-surface.rfc.md:745`). Phase 4 starts the clock upon the first qualified publication but does not explicitly require the backstop mechanism to be installed and tested before that publication (`llp/0254-tiny-ordinary-data-surface.rfc.md:890`). The companion LLP 0252 plan is more explicit about landing the tested backstop before its clock begins (`llp/0252-one-expo-package.rfc.md:929`).

   **Disposition:** In the follow-on evaluation Plan, make installation and verification of the D10 stop-date backstop part of Phase 4 publication qualification. This is a delivery-order clarification, not a flaw in the decision.

2. **[DETAIL · PRE-EXISTING] Reconcile the accepted query-state vocabulary with the shipped vocabulary explicitly.**

   D6 correctly preserves the complete shipped six-field `QueryState` and explains that shipped `error` governs over LLP 0238’s illustrative `diagnostic` name (`llp/0254-tiny-ordinary-data-surface.rfc.md:510`). The shipped React type indeed exposes `status`, `data`, `error`, `connection`, `freshness`, and `retention` (`packages/snapback-react/index.d.mts:151`). However, accepted LLP 0238 also describes a `refresh` control and uses `diagnostic` in its recommended hook contract (`llp/0238-react-hooks-package.rfc.md:245`).

   **Disposition:** The follow-on Spec should either expose the accepted `refresh` behavior and map `diagnostic` deliberately onto the shipped error representation, or accompany the syntax with a dated LLP 0238 amendment consolidating the owner vocabulary. D6’s current deferral of exact syntax makes this non-blocking.

## Implementer probe

### A. Complete v1 mutation-capability lattice

| Prediction capability | Custody capability | Required lifecycle |
|---|---|---|
| Exact generated shared prediction | Queue-eligible durable custody | Apply the generated local prediction, durably accept or queue the intent under stable identity, settle or refuse authoritatively, reconcile local state, and converge observers. |
| No prediction | Queue-eligible durable custody | Expose prediction as withheld or unavailable, perform no optimistic paint, durably accept or queue the same authoritative intent, then settle or refuse and converge observers. |
| Exact generated shared prediction | Online-only | Apply the generated local prediction during foreground dispatch. A terminal response settles or refuses it. A post-dispatch response loss that may conceal acceptance must remain recoverably pending under stable intent identity until the ledger returns a terminal answer or non-acceptance is proven; it must never be reported as rejected merely because the response was lost. |
| No prediction | Online-only | Perform no optimistic paint. Foreground dispatch settles or refuses normally; a possibly accepted response-loss case follows the same stable-identity pending-and-ledger-resolution rule. |

Prediction and custody are independent generated capabilities. Settlement remains obligatory in every admitted cell. Pre-custody validation failures may refuse immediately, while post-dispatch ambiguity must not be collapsed into rejection.

The online-only amendment must preserve stable intent identity and recover the pending observation across a crash without silently converting online-only custody into replay-eligible queue custody.

### B. First D9 cells and clock start

The first qualified cells are:

1. Tiny ordinary-data surface, explicit profile `snapback-explicit-v1`, Todo plus a day-two extension derived from Todo — treatment.
2. Existing explicit data path, the same explicit profile, Todo plus the same day-two extension — causal control.
3. Pinned InstantDB, Todo only — external calibration, excluded from the causal comparison.

Chat is not an initial cell; it requires a dated plan after OQ8. The familiar surface is likewise not substituted into the first causal comparison.

The D9 clock starts at the first qualified Phase 4 publication of the exact tiny Experimental package closure together with its symmetric guide/skill path. Phase 1 Todo completion or any earlier internal checkpoint does not start it, and no D9 result may precede that publication. The clock ends at the earlier of three complete rounds or 90 days unless extended by a dated amendment.

## Direction assessment

The RFC’s direction is sound. It adds a deliberately small, generated, profile-neutral ordinary-data layer instead of inventing a second authority system. Its identity fences preserve default omission behavior; table policy remains mandatory; query construction stays closed and bounded; operation identity and QMK ownership remain aligned with existing owners; prediction is never mistaken for authority; custody and settlement remain explicit; and the surface is experimentally gated, measurable, and withdrawable.

There is no direction dissent.

## Self-attestation

I reviewed the complete specified revision and the relevant corpus, guide, implementation, tests, and diary evidence solely within the supplied capsule. I used no network access, did not read any prior review of LLP 0254 or its revisions, classified every reported concern by severity and provenance, and made no confinement deviation.

VERDICT: READY
