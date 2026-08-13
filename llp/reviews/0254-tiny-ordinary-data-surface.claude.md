# Claude family reviews — LLP 0254 (tiny ordinary data surface)

Review artifacts for `llp/0254-tiny-ordinary-data-surface.rfc.md` from the
Claude family, one dated section per round, bodies verbatim.

## Round 1 — 2026-08-13

- **Runtime:** headless Claude Code CLI 2.1.231, model `claude-fable-5`,
  `--effort max`, tools restricted to Read/Glob/Grep (no shell, no
  network), launched blind in the round-1 capsule by the orchestrating
  session (launch 1). Shares a model family with the orchestrating
  reviser; the reviewing instance is fresh and wrote no revision
  (author-authorized deviation recorded in the run journal).
- **Revision reviewed:** r1, SHA-256
  `1cf025584684715e9422eae7fe748008ce6c1be5cdd9666cca1af65d42dc99c2`
  (42,295 bytes); the reviewer could not hash in-toolset and relied on
  the recorded identity, as disclosed in its header.
- **Capsule inventory SHA-256:**
  `ae05f426e40a4efaa986c90d5d4e64003d2d14c7dcf082b46eeffba007bc3480`;
  instruction SHA-256
  `0f44e12dec3bd2434338bb0631267cd2e56322d3d2b7e7aa0b82b69252a86adf`.
- **Transport note:** the print-mode stream carried one interstitial
  status line before the artifact heading; the raw stream is preserved by
  the orchestrator and the body below is byte-verbatim from the artifact
  heading onward.
- **Verdict:** NOT READY (2 MATERIAL, 6 DETAIL; direction retained).
  Self-attested capsule-only; harness-injected context disclosed.

---

# Review artifact — LLP 0254 “Tiny ordinary data surface” (RFC), super-refine round 1

## 1. Header

- **Reviewer identity/runtime:** Claude Fable 5 (model id `claude-fable-5`), running on Anthropic’s Claude Agent SDK in a non-interactive session; toolset limited to Read/Grep/Glob (no shell, no network).
- **Date:** 2026-08-13.
- **Target revision:** `llp/0254-tiny-ordinary-data-surface.rfc.md`, r1, recorded SHA-256 `1cf025584684715e9422eae7fe748008ce6c1be5cdd9666cca1af65d42dc99c2`, 42,295 bytes. My toolset cannot hash or byte-count files; I read the file in full (892 lines, size-consistent with the record) and otherwise **relied on the recorded identity**.
- **Forbidden-file check:** Glob for `llp/reviews/0253*` and `llp/reviews/0254*` returned no files. I read no file under `llp/reviews/`.
- **Notable files read or searched:** the target (full); `llp/0252-convex-familiar-authoring-profile.rfc.md` (full); `llp/0253-familiar-profile-v1-api.spec.md` (full, working-tree overlay); `llp/0082-instantdb.research.md` (full); `llp/0102-seven-backend-five-app-bakeoff.plan.md` (partial + targeted greps); `llp/0065`, `0155`, `0157` (targeted), `0166` (targeted), `0193`, `0197` (targeted), `0231`, `0238`, `0240`, `0242`, `0243`, `0245` (summaries/decisions); diaries `0027`–`0031` (InstantDB sections); `demos/backend-bakeoff/arms/{todo,chat,linear,partiful,research-room}/instantdb/run-capsule.v1.json` (`activeElapsedMs`); `packages/snapback-codegen/define.mjs` (table-builder methods), `packages/snapback-codegen/standard-patterns.mjs`; `packages/snapback-react/index.d.mts`; packages-wide grep for `pendingWrites`.

## 2. Overall assessment

This RFC is a disciplined, well-bounded proposal, and its factual base held up unusually well under verification. The five InstantDB wall-clock figures convert **exactly** from the cited run capsules (e.g., 1,900,589 ms → 31.68 min at `demos/backend-bakeoff/arms/todo/instantdb/run-capsule.v1.json:25`, and likewise for chat/linear/partiful/research-room), and the caveat that these are not a clean surface-only comparison is faithful to LLP 0102’s raw-record rule (`llp/0102:542-544`). Diary 0027’s and 0028’s characterizations are near-verbatim accurate (`diaries/0027:554-559`, `diaries/0028:798-800`), diary 0029’s is accurate (`diaries/0029:779-782`), and LLP 0082 supports the architectural reading. The shipped-surface claims check out: the standard-pattern generator exists with owner-scoped CRUD, trusted defaults, transactional owner guards, and bounds (`packages/snapback-codegen/standard-patterns.mjs:178-185,203-244,304-334`); table-level mandatory-able `.visibility()` and `.sync()` exist (`packages/snapback-codegen/define.mjs:1294,1401`); and D6’s honesty about `pendingWrites` is verified — no such field exists anywhere in `packages/` and the shipped query state is exactly `{status,data,error,connection,freshness,retention}` (`packages/snapback-react/index.d.mts:152-157`). The claims about LLP 0253’s Appendix A (`standardPattern` unsupported; no `.data()` row) are both correct (`llp/0253:820,836-846`). The document consistently distinguishes what exists from what it proposes, defers spelling/thresholds/batch sizes to the right owners, designs withdrawal before it designs promotion, and preserves every fail-closed security posture it touches.

Judged as an RFC — semantic boundary, concept budget, escape behavior, evaluation design, relationship to 0252/0253 — the architecture is sound in direction. The one defect I consider clearly material is in the escape design’s interaction with the capsule’s own familiar-profile Spec: D7 routes categories to “the application’s selected LLP 0252 function profile” that LLP 0253’s v1 familiar grammar refuses outright, which both overstates the escape (Goal 5’s “monotonic escape”) for familiar-profile applications and can wedge D9’s own frozen day-two threshold if the familiar profile is the preregistered comparison profile. A second, much smaller material defect is an evidence misattribution in the Motivation (a diary is cited for a weakness it affirmatively contradicts). Both have compact fixes; the rest of my concerns are implementation-phase detail with clear dispositions.

## 3. Concerns (most severe first)

**1. MATERIAL — D7 (escape hatch), with D9 and the Summary progression.** D7 states that authors use “the application’s selected LLP 0252 function profile” for, among others, “effects, secrets, HTTP, assets, jobs, schedules, or long-lived workflows” and “authority creation, membership changes, role transitions” (`llp/0254:466-476`). Under the capsule’s own LLP 0253 Draft, the familiar v1 profile cannot express most of these: familiar actions are “composition-plus-compute” with `fetch`/`fetchStream` as always-throwing stubs routing to the explicit profile/LLP 0249 (`llp/0253:389,393-399`); `effects` and `runtime` are disposition 4 (`llp/0253:813-814`); `defineCron`/`defineRoutes`/`defineCommand`/`defineAssetUpload` are disposition 4 and `crons.ts`/`http.ts` refuse (`llp/0253:829-832,216-220`); non-default `authorityCreating` “requires explicit profile” (`llp/0253:816`); and mixing explicit modules into a familiar app refuses (`llp/0253:150-160`). So for a familiar-profile application the promised “monotonic escape into the application’s selected function profile” (Goal 5, `llp/0254:185-186`) is, for these categories, actually a whole-application profile migration — the severe-cliff outcome 0252 D7 counts separately as its worst expressiveness grade. This bites the RFC’s own evaluation: the day-two workload requires “one role transition, and one external effect” (`llp/0254:552-554`), and the frozen minimum threshold requires day-two acceptance “through a bounded function escape” (`llp/0254:585-586`) — unreachable if the D9 preregistration (`llp/0254:541-545`) selects the familiar profile, since an external effect cannot be authored in familiar v1 at all. The document never names this asymmetry (D11 covers only the data-surface dispositions), and it is internally in tension with the Summary’s own three-tier progression, which places assets/authority/jobs in tier 3 capability surfaces rather than the tier-2 function profile (`llp/0254:57-61` vs `:471-474`). **Resolution:** amend D7 to acknowledge that where the selected profile’s v1 grammar refuses a category (today: familiar v1 for external effects, HTTP, jobs/schedules, LLP 0249 runtime, authority-creating operations), the escape routes to the explicit profile or the owning capability surface and the generated diagnostic must name that route honestly; require in D9 that the preregistered function profile’s v1 grammar admits every day-two escape item (under current LLP 0253 that means `snapback-explicit-v1`), or scope the day-two items to the selected profile; align the Summary tier-3 list with D7. The illustrative `snapback data promote … --format familiar|explicit` (`llp/0254:487-489`) should likewise be pinned to the application’s selected profile so promotion cannot become a mixing vector.

**2. MATERIAL — Motivation, “The InstantDB result is repeated evidence.”** The claim that “Diaries 0030 and 0031 preserve the boundary: … **permission diagnostics** … remained weaker” (`llp/0254:126-128`) is contradicted by diary 0030, which lists Instant’s permission debugger as a strength — “the permission debugger was genuinely useful: `debugTransact` exposed evaluated bindings, modified fields, and why reverse links caused a transaction denial” (`diaries/0030:633-635`) — and asks Snapback to *match* it (`diaries/0030:707-708`); 0030’s weakness list (`diaries/0030:700-703`) names invalidation timeliness, conflict ambiguity, asset revocation, and scheduling/effects/secrets, not diagnostics. The permission-diagnostics complaint belongs to diary 0029 (`diaries/0029:795-797`, `:846-847`); diary 0031 records permission-*semantics* sharp edges, with the docs called “unusually useful” (`diaries/0031:520-523`). The other four items in the sentence are well supported. **Resolution:** reattribute (cite diary 0029 for diagnostics) or reword the item (e.g., “permission-invalidation timeliness and link-permission ergonomics”); a one-line fix.

**3. DETAIL — D9, control identification.** “The first comparison uses the same function profile in the tiny and non-tiny arms” (`llp/0254:541-545`) is ambiguous when the minimum lane set contains two non-tiny arms with *different* profiles, and threshold 1 references a singular “equal-proof control” (`llp/0254:581-582`) without naming which lane that is. Read literally the sentence is unsatisfiable; the intent (tiny+P compared causally against the lane authored in P) should be stated. **Disposition:** the preregistered evaluation Plan owns lane pairing and control naming; add one clarifying sentence there (or in D9).

**4. DETAIL — D3 illustration vs shipped trusted-default semantics.** The example writes `createDefaults: { ownerId: "authUserId", … }` under `visibility({kind:"owner", field:"ownerId"})` (`llp/0254:318-322`), and the framing claims the example adds “only one tentative spelling … over existing schema, index, visibility, trusted-default, and sync concepts” (`llp/0254:325-327`). The shipped generator *refuses* trusted defaults on the owner-visibility field (`packages/snapback-codegen/standard-patterns.mjs:239-244`) precisely because it derives the owner value itself (`standard-patterns.mjs:304-305`); the shipped default values are expression objects, not strings. The normative bullets below the example are consistent with shipped law; only the illustration diverges. **Disposition:** follow-on Spec — derive the owner default from the visibility declaration (as shipped) rather than authoring it, or name the divergence.

**5. DETAIL — D4, materialization-identity attribution.** “Queries, args, authority generation, capability facts, and result contracts form the materialization identity under LLP 0155” (`llp/0254:383-384`), but the identity discipline is owned by LLP 0157 (`QueryMaterializationKeyV1` = activation, exported function identity, contract identities, plan hash, canonical args; `llp/0157:52-56,273-275`), and a descriptor query has no exported-function identity, while “capability facts” are not currently an identity input. **Disposition:** follow-on Spec — define `DataQueryV1`’s slot in LLP 0157’s identity stack explicitly (the Required-artifacts section already demands a “materialization identity” field); cite 0157 alongside 0155 in D4.

**6. DETAIL — D2/D3, sync-enablement and the four-concept count.** The D3 example authors `.sync()` explicitly (`llp/0254:323`); under D2’s own counting rule (“a concept counts when an author must choose, configure, or coordinate it,” `llp/0254:292-293`) an authored per-table sync decision is a fifth choice. LLP 0253 solved the analogous problem with a profile default (`llp/0253:454-456`). **Disposition:** follow-on Spec plus the Phase 0 concept-count freeze — either fold sync-enabledness into the data-resource declaration/default or count it.

**7. DETAIL — Motivation, external freshness claim.** The “As of 2026-08-13” InstantDB documentation claim with five live URLs (`llp/0254:136-144`) is unverifiable inside the capsule and carries no dated in-repo pin; everything capsule-checkable matches LLP 0082’s 2026-07-23 primary-source pass. Corpus discipline (LLP 0197/0198; 0252 Phase 0.5) pins external surface inventories before they carry weight. **Disposition:** evaluation Plan Phase 0 — pin the Instant surface inventory; meanwhile cite LLP 0082 plus a dated re-verification note.

**8. DETAIL — D8 wording vs D10 posture.** “The first-hop scaffold and guide teach the tiny path” (`llp/0254:519`) can be read as making the tiny path the repository-wide first hop while it is still `Experimental`, which D10 (`llp/0254:594-596`), the Status section, and the two-doorways risk (promotion is when demotion of the explicit path happens, `llp/0254:839-841`) all contradict. The intended scope is clearly the experiment’s own scaffold/guide closure. **Disposition:** Spec/guide phase — scope the sentence (“the tiny experiment’s scaffold and guide path…”).

## 4. Direction assessment

**Retained.** The document’s central move — isolating *smallness* from *familiarity* as levers, testing it on the same runtime as generated compression over existing accepted owners (0065/0231/0240/0242/0155/0238/0218/0243/0245) rather than as a third profile or second semantic implementation, with truth-preserving state, refusal-not-fallback semantics, preregistered thresholds, and a withdrawal projection required before external shipping — is well-founded, consistent with corpus law, and correctly positioned relative to LLP 0252/0253. No direction dissent.

## 5. Self-attestation of confinement and blindness

I read and searched only files inside this capsule directory tree; every tool call used paths within it. I used no network access and no web search (the Motivation’s external URLs were left unfetched; I noted their unverifiability instead). I verified via Glob that no file matching `llp/reviews/0253*` or `llp/reviews/0254*` exists; I opened no file under `llp/reviews/` (one broad Glob listed review *filenames*, none 0253/0254-related; no review content was read). I encountered the review histories embedded in the 0252/0253 documents’ own revision notes, which are capsule-internal corpus bytes, not reviewer artifacts. I made no attempt to infer or reconstruct other reviewers’ views. Deviations/injected context to disclose: my harness injected project instructions (CLAUDE.md), a system prompt with tool/skill/MCP listings, memory-directory instructions, and periodic task-tool reminders — none requested by me and none containing 0253/0254 review content; I read and wrote no memory files, spawned no agents/tasks/workflows. My toolset could not compute the SHA-256 or exact byte count of the target; I relied on the recorded identity for revision binding as permitted by the instructions.

VERDICT: NOT READY


## Round 2 — 2026-08-13 (delta round)

- **Runtime:** same as round 1 (headless Claude Code CLI 2.1.231,
  `claude-fable-5`, `--effort max`, Read/Glob/Grep only), launched blind
  in the round-2 capsule (launch 2).
- **Revision reviewed:** r2, SHA-256
  `45d72bb110c0d0743085d0cd56548324f0231d0f632cb445917e263ae0ba9505`
  (49,295 bytes); recorded identity relied on (tool-restricted lane
  cannot hash), as disclosed in the artifact.
- **Capsule inventory SHA-256:**
  `439db821edf2cec30ef5f70d4ca2a4e2888c027e96bdb9027eee4855d68bcbd8`;
  instruction SHA-256
  `dd8e8f9aa6ba754bd06d65f73e36d356db5a6a26d30677e7c7dc6c92c8d1d467`.
- **Verdict:** NOT READY (1 MATERIAL IN-DELTA; 4 DETAIL IN-DELTA;
  1 DETAIL PRE-EXISTING; zero PRE-EXISTING MATERIAL; direction
  retained). Self-attested capsule-only; harness-injected context
  disclosed.

---

# LLP 0254 r2 — Independent delta-round review (family: Claude)

## 1. Header

- **Reviewer:** Claude (Fable 5, model id `claude-fable-5`), running as an autonomous review agent in a Claude Agent SDK harness with Read/Grep/Glob file tools only.
- **Date:** 2026-08-13.
- **Target:** `llp/0254-tiny-ordinary-data-surface.rfc.md`, revision **r2**, recorded SHA-256 `45d72bb110c0d0743085d0cd56548324f0231d0f632cb445917e263ae0ba9505`, 49,295 bytes. My toolset cannot hash or byte-count (no shell); I read the file in full (996 lines, header and revision note consistent with r2) and **relied on the recorded identity**.
- **Notable files read or searched:** the target in full; LLP 0252 (in full), LLP 0253 (in full), LLP 0065 (in full); targeted reads/searches of LLP 0082, 0102, 0155, 0157, 0197, 0218, 0231, 0240, 0241, 0242; diaries 0027, 0028, 0029, 0030, 0031; `demos/backend-bakeoff/arms/{todo,chat,linear,partiful,research-room}/instantdb/run-capsule.v1.json`; `packages/snapback-react/index.d.mts`; grep sweeps of `packages/snapback-codegen` (visibility kinds) and `packages/snapback-client`/`packages/snapback-react` (query-state grammar, `pendingWrites`). Confirmed by glob that no `llp/reviews/0253*` or `llp/reviews/0254*` file exists in the capsule.

## 2. Overall assessment

r2 is a substantially strengthened revision, and the delta list is honest as far as this capsule allows verification. Every one of the nineteen enumerated delta items is present in r2 as described, and the factual re-attributions the delta makes were each checked against primary capsule sources and found accurate: diary 0029 (not 0030) owns the permission-diagnostic gap (`0029:792–797`, `0029:846`), diary 0030 praises Instant's permission debugger and owns the invalidation-timeliness and asset-revocation weaknesses (`0030:633–635`, `0030:639–650`, `0030:663–667`, `0030:702–716`); the five LLP 0102 timings match the run capsules to the recorded decimal; LLP 0082 is dated 2026-07-23 with a 2026-07-23 fetch pass; LLP 0157 really owns `QueryMaterializationKeyV1` (`0157:52–56`, `0157:752–778`); LLP 0218 really ships `withheld`/`unavailable` queued presentation (`0218:137–142`, `0218:197–204`); the shipped query state really is exactly `{status,data,error,connection,freshness,retention}` with no `pendingWrites` anywhere in `packages/` (`packages/snapback-react/index.d.mts:152–157`); LLP 0241 really pins the queued-record drain semantics D10 now cites (`0241:314–319`); and the D7/D8/D9/D11 characterizations of LLP 0252 D7 and LLP 0253 (S1.2 default-omission, S3.1 `useQuery` binding, Appendix A `standardPattern` disposition 4, the familiar v1 refusal categories) are correct against those texts. r1 is not in the capsule, so undisclosed-change detection was limited to internal and corpus consistency; nothing surfaced suggesting an undisclosed material change.

The revision's central moves are right: making prediction/custody/settlement independent generated axes matches how LLP 0155 and 0218 actually decompose the machinery; deriving owner assignment from visibility removes an authored fact that LLP 0065 already forbids delegating to trusted defaults; the normalized-core-plus-envelope layering resolves what would otherwise be a contradiction between profile-neutral byte equivalence and the LLP 0241/0252 identity fences; and reframing D9 as a factorial extension of LLP 0252 D7 removes the two-uncoordinated-matrices problem.

One in-delta defect survives scrutiny: the new D3 index-derivation bullet grounds a rule in LLP 0065 that LLP 0065's Implemented text forbids, with no amendment named — a coherence defect in exactly the "must retain these semantic facts" list a follow-on Spec is bound to. The remaining concerns are implementation-phase details with clear dispositions, several of them coordination-naming gaps rather than wrong decisions.

## 3. Concerns

**Concern 1 — MATERIAL, IN-DELTA. D3 (semantic-fact bullets): the derive-when-unique index rule contradicts LLP 0065's ratified rule while citing LLP 0065 as its support.**
The new bullet reads: "admitted queries name a declared index and fixed bounds, or derive an index only when exactly one is eligible — ambiguity refuses rather than guesses (LLP 0065)" (`llp/0254-tiny-ordinary-data-surface.rfc.md:359–361`). LLP 0065's operative, Implemented rule is stricter and unconditional: "The generated list requires an explicitly named `listIndex` … the author's option selects one, so **index choice is never inferred**. Without one, generation fails with `SNAPBACK_STANDARD_PATTERN_LIST_INDEX_REQUIRED`" (`llp/0065-generated-data-pattern-soundness.rfc.md:236–240`). Derivation-when-exactly-one-is-eligible is inference of index choice under 0065's letter, even though it honors 0065's never-guess intent. The document compounds the conflict by building Phase 1 "over the existing LLP 0065 standard-pattern owner profile" (`0254:797–799`) with no amendment named anywhere, and it is ambiguous whether the bullet governs declaration-time generated operations (where 0065 directly applies) or descriptor admission (where the citation is borrowed). A Spec author following this bullet would embed a silent divergence from an Implemented RFC — the exact failure mode LLP 0253 exists to avoid on the 0252 side ("names the divergence and pins the v1 resolution"). **Resolution:** either retain 0065's explicit-name-always rule, or present derivation-when-unique as a scoped relaxation the follow-on Spec must land as a dated LLP 0065 amendment, citing 0065 only for the refusal posture, and say which layer (generated-operation declaration vs. descriptor admission) the rule governs.

**Concern 2 — DETAIL, IN-DELTA. D9/D11: the inherited LLP 0252 D7 stop rule can be inherited already-running or expired.**
D9 "inherits its capsule discipline, aid-symmetry rules, LLP 0197 replication floor, **stop rule**, and disposition machinery" (`0254:595–597`; `0254:721–726`). LLP 0252 D7's stop rule ends the period at the earlier of three complete rounds or 90 days after the first dual-profile qualified npm publication (`llp/0252-convex-familiar-authoring-profile.rfc.md:704–711`), forbids pooling runs across configuration versions, does not reset the calendar on configuration change (`0252:745–755`), and permits extension only by dated author amendment (`0252:757–761`). The tiny factor cannot exist until 0254 Phases 0–4 complete, plausibly well into or past that window; adding a factor is a larger configuration change than the component withdrawal 0252's machinery covers. The coordination decision itself is sound and not defective. **Disposition:** the evaluation Plan (or a dated 0252 amendment at tiny-lane readiness) states how the tiny factor's rounds and calendar compose with 0252's period — a new named treatment configuration entering via 0252's dated-extension path — so the inherited stop rule cannot arrive pre-expired.

**Concern 3 — DETAIL, IN-DELTA. D4: descriptor/named-query identity sharing needs scoping against LLP 0157's cross-function-dedup rule.**
D4 requires "a descriptor and a named generated query with the same canonical plan and arguments share one materialization identity — two spellings never allocate a second cache" (`0254:407–417`). LLP 0157 pins that "cross-function dedup is explicitly not identity" and binds the exported-function block (id, name, implementationHash, contract hashes) into `QueryMaterializationPreimageV1` (`llp/0157-composition-algebra-and-completeness.spec.md:52–56`, `0157:752–778`). The only 0157-consistent reading is that the descriptor resolves to the named operation's function slot when plan+args coincide (aliasing — one owner, two spellings); read as plan-keyed sharing it violates 0157, and where two named queries legitimately share one plan (distinct identities by 0157's design) the literal sharing requirement is unsatisfiable against both. The RFC already assigns slot-occupancy to the follow-on Spec, so this is deferred detail, not a wrong decision. **Disposition:** the Spec defines descriptor→named-operation resolution, the synthesized-identity fallback for unmatched descriptors, and the ambiguity case; the RFC sentence should be scoped to that resolution.

**Concern 4 — DETAIL, IN-DELTA. D5: operation-declared custody capability is the per-operation queue policy LLP 0252 says requires an LLP 0218/0108 amendment, and 0254 does not name it.**
D5 makes custody a generated per-operation capability ("the outbox may retain it when the operation's generated capability allows"; "Online-only status requires an independently declared custody reason", `0254:456–463`; acceptance at `0254:862–869`). In the shipped model, queueing is a dispatch-time contract (`queue: false`), and LLP 0252's Terminology explicitly anticipates: "Should a per-operation queue policy ever be introduced (an LLP 0218/0108 amendment), it enters by this rule" (`0252:191–198`; `llp/0218-outbox-settlement-contract.rfc.md:137–142`). D6 models the right behavior for the analogous `pendingWrites` case (named canonical amendment or projection, `0254:485–489`); the custody axis gets no such sentence. **Disposition:** the follow-on Spec names the LLP 0218/0108 (and LLP 0043 where applicable) amendment or canonical owner through which operation-declared custody capability enters the dispatch/settlement contract; the design itself is correct.

**Concern 5 — DETAIL, PRE-EXISTING. Retained/offline capability for generated queries depends on an LLP 0065 future profile the document never names.**
The tiny path's core promise makes generated queries live, retained, and offline-capable (D2 table, D6, local-first acceptance `0254:852–869`), and Phase 2 binds materialization/retention to LLP 0155/0166/0243 (`0254:810–814`). LLP 0065 §4 expressly disclaims this for the profile Phase 1 builds on: "Generated queries claim no retained/offline capability in v1: retention requires LLP 0053's lease rules plus the LLP 0008 L4-style `authScopeField` convergence fixture, and is a future profile, not a default" (`0065:302–305`; OQ5 at `0065:427–429`). The work is anticipated by 0065's own open question, so this is a dependency-naming gap, not a hidden contradiction. **Disposition:** the follow-on Spec's LLP 0065 relationship (see Concern 1) also names the retained-profile admission for generated queries and its 0053 lease/convergence obligations.

**Concern 6 — DETAIL, IN-DELTA. Motivation promises a Phase 0 Instant surface-inventory pin that Phase 0's checklist omits.**
The new pin sentence — "the D9 Plan pins a dated Instant surface inventory in Phase 0 before the calibration arm carries evaluative weight" (`0254:152–155`) — has no corresponding item in the Phase 0 list (`0254:787–795`), unlike LLP 0252's parallel Phase 0.5 Convex-inventory pin (`0252:887–889`). **Disposition:** add the pin to Phase 0's checklist or state explicitly that it arrives through the inherited 0252 D7 control-lane machinery.

## 4. Implementer-probe result

**(a) The v1 capability lattice for a generated operation — statable from the document.** Three independent generated axes:

- **Prediction** ∈ {generated exact shared prediction, none}. Never authored (no separate optimistic reducer, D5); derived by generation from the operation IR (Phase 3), recorded in `DataResourceV1`'s prediction/settlement profile and `DataTransactionV1`'s prediction profile (with provisional-id reconciliation).
- **Custody** ∈ {queue-eligible durable custody, online-only}. A generated custody contract recorded in `DataTransactionV1`'s custody/queue/settlement capability and `DataResourceV1`'s live/local/retained/offline facts; online-only is lawful **only** with an independently declared custody reason.
- **Settlement** — not an optional value: every accepted intent settles authoritatively exactly once through the LLP 0218 machine, refusals reconcile by stable intent/operation identity, and conformance compares prediction with outcomes; its contract facts are declared per operation.

All four prediction×custody combinations are admitted: (predict, queue) = full local-first; (no-predict, queue) = accepted into durable custody with LLP 0218 `withheld`/`unavailable` presentation, settling identically; (predict, online-only) and (no-predict, online-only) = settle in the foreground attempt or reject, with the declared custody reason. Prediction failure alone never forces a function escape and never forces online-only status. Residual openness — the concrete declaration spelling, and whether a predictable online-only operation paints before settlement — is explicitly Spec-assigned; I judge it deferred detail, not a defective decision.

**(b) Lanes and workloads of the first D9 comparison.** Workloads: **Owner-scoped Todo plus day-two evolution; Chat excluded** until a reviewed membership-read data-resource profile with LLP 0065-class negatives is admitted (OQ8), with membership/role writes remaining function escapes in every arm and ephemeral state symmetric and non-evidentiary. Lanes: the tiny arm (function escapes in preregistered profile P); the **named causal control = the non-tiny lane authored in the same P**; the other function-profile lane (informing LLP 0252 D7's own comparison, not the tiny causal decision); pinned InstantDB as external calibration only; with 0252's ablation and pinned-Convex arms persisting in the host matrix. Because day-two includes an external effect and a role transition, any comparison containing day-two preregisters **P = `snapback-explicit-v1`** under LLP 0253's current Draft (or cuts the item list and scopes the claim). Remaining preregistration slots — P for a Todo-only comparison, and the exact relationship of Phase 1's pre-client "Todo comparison" (declaration compression through generated named operations) to D9's frozen thresholds — are Plan-owned under the stated constraint system, and I do not find a defective decision hiding in them; the stop-rule composition question is Concern 2.

## 5. Direction assessment

**Retained — no DIRECTION-DISSENT.** A profile-neutral generated data layer over the existing canonical owners, with capability honesty preserved and promotion gated on a same-runtime factorial experiment, is the right shape: it isolates the smallness lever 0252 leaves unisolated, it is compression over machinery that already exists (0065/0231/0240/0242/0155/0238/0218/0245), and its withdrawal story is unusually complete. The r2 revisions move the document toward, not away from, the corpus's actual semantics.

## 6. Self-attestation

I read and searched only files inside this capsule directory tree, used no network or web access, and read no file matching `llp/reviews/0253*` or `llp/reviews/0254*` — I verified by glob that none exists in the capsule. I read no other file under `llp/reviews/` either (including the 0252 reviews present there). I did not attempt to infer or reconstruct other reviewers' or round-1 views; the delta list in REVIEW_INSTRUCTIONS.md was treated as the orchestrator's enumeration only. Deviations and injected context, disclosed exactly: (1) my harness injected project instructions (the repository `CLAUDE.md`), system reminders about task-tracking tools and available skills, a persistent-memory preamble naming a memory directory (I read and wrote no memory files), and a list of connected MCP servers/tools (unused) — none of which I requested and none of which contained LLP 0253/0254 review content; (2) I could not hash or byte-count the target (no shell tool), so I relied on the recorded revision identity as instructed; (3) r1 is absent from the capsule, so my delta-honesty check verified that every enumerated delta item is present and accurate in r2 and consistent with the corpus, but could not diff-detect an undisclosed change against r1's bytes.

VERDICT: NOT READY


## Round 3 — 2026-08-13 (final delta round)

- **Runtime:** same as rounds 1–2 (headless Claude Code CLI 2.1.231,
  `claude-fable-5`, `--effort max`, Read/Glob/Grep only), launched blind
  in the round-3 capsule (launch 3).
- **Revision reviewed:** r3, SHA-256
  `61653099a9090e817ac536d2c4d37a93716f5e35f7aa5b43fe3483b3a36424c8`
  (52,516 bytes); recorded identity relied on (tool-restricted lane
  cannot hash), as disclosed in the artifact.
- **Capsule inventory SHA-256:**
  `fe10cc467997caaf8bb9507426120ce309288cb083e9c6c69a797b71f205aabc`;
  instruction SHA-256
  `c4cf80d9286cad14b7937f1edbc977efef343974ecb3437b4bfc389293a3825a`.
- **Verdict:** READY (0 MATERIAL; 5 DETAIL — 4 IN-DELTA,
  1 PRE-EXISTING; all altitude-dispositioned; direction retained;
  implementer probe found the lattice and the first D9 comparison
  DETERMINATE). Under the run's authorized pool-exit rule, this READY
  verdict removes the Claude family from the reviewer pool at loop
  close. Self-attested capsule-only; harness-injected context disclosed.

---

# Review: LLP 0254 r3 — Tiny ordinary data surface (super-refine round 3, final delta round)

## 1. Header

- **Reviewer:** Claude (Fable 5, `claude-fable-5`), running as an autonomous review agent in a Claude Agent SDK harness with Read/Grep/Glob file tools only.
- **Date:** 2026-08-13.
- **Target:** `llp/0254-tiny-ordinary-data-surface.rfc.md`, revision r3, recorded SHA-256 `61653099a9090e817ac536d2c4d37a93716f5e35f7aa5b43fe3483b3a36424c8`, 52,516 bytes. My toolset has no shell or hashing capability, so I could not compute the digest or byte count; **I relied on this recorded identity.** The file I read is 1,040 lines and its `Revised:` note matches the r3 description.
- **Capsule integrity:** no file matching `llp/reviews/0253*` or `llp/reviews/0254*` exists in the capsule (verified by glob). Only r3 of the target exists; r2 is not in the capsule, so delta honesty was verifiable in one direction only (every enumerated delta item present in r3 and corpus-consistent); undisclosed r2→r3 changes cannot be mechanically detected without r2.
- **Notable files read/searched:** the target in full; `llp/0252` (full), `llp/0253` (full), `llp/0065` (full), `llp/0238` (D3–D7), `llp/0241` (identities, drain rules), `llp/0218` (§4.1–4.4), `llp/0157` (QMK section), `llp/0155` (P2–P6), `llp/0242`, `llp/0231`, `llp/0240`, `llp/0245`, `llp/0053`, `llp/0197`, `llp/0102`, `llp/0082`, `llp/0203`; diaries 0027–0031; `packages/snapback-react/index.d.mts`, `packages/snapback-codegen/standard-patterns.mjs`, `packages/snapback-codegen/define.mjs`; `demos/backend-bakeoff/arms/{todo,chat,linear,partiful,research-room}/instantdb/run-capsule.v1.json`.

## 2. Overall assessment

r3 is a disciplined revision that resolves the round-2-shaped problems with determinate, owner-respecting answers, and its new text survives adversarial checking against both the corpus and the shipped code unusually well. Every one of the fourteen enumerated delta items is present in the document as described, and each item's factual load checks out against its cited owner:

- **D6's field-name pin is exactly right.** The shipped `QueryState` union is `pending | blocked | ready | refreshing | error | skipped` with axes `data/error/connection/freshness/retention` (`packages/snapback-react/index.d.mts:152-157`); no `pendingWrites` exists anywhere in `packages/` (grep-verified); LLP 0238 D4's illustrative list really does spell `diagnostic` (`llp/0238:271`). The resolution (shipped names govern, `pendingWrites` only by canonical amendment or projection from the canonical outbox owner) matches LLP 0253 S6.5's identical handling, so the two in-flight documents no longer diverge on state-grammar authority.
- **D3's index bullet now quotes LLP 0065 accurately.** "Explicitly named list index, never inferred, refusing with the existing stable code" is LLP 0065 §3 verbatim (`llp/0065:237-244`), and `SNAPBACK_STANDARD_PATTERN_LIST_INDEX_REQUIRED` is shipped (`packages/snapback-codegen/standard-patterns.mjs:259`). The relaxation for `.data(...)` is now honestly labeled as this RFC's proposal requiring a dated LLP 0065 amendment, scoped so the generator still receives a concrete index. Phase 2's retention framing matches LLP 0065 §4 and OQ5 (`llp/0065:302-307, 427-429`) including the LLP 0053 lease and convergence-fixture obligations.
- **D4's sharing rule is now LLP 0157-compatible.** Function-slot resolution respects LLP 0157's explicit pin that "two exported functions with the same `PlanHashV1` have distinct keys; cross-function deduplication is never observable query identity" (`llp/0157:842-844`), and the residual-amendment clause covers the one real gap (synthesized function identities are not "exported function identity" as LLP 0157 currently words it).
- **D5's lattice is closed, and its LLP 0218 vocabulary is used correctly.** `withheld`/`unavailable` are the shipped queued-branch presentations with exactly the glosses the RFC relies on (`llp/0218:137-141, 199-204, 210-215`); the online-only cells match the shipped `queue:false` settled-or-reject path; the rule that operation-declared custody enters the shipped contract only via a named LLP 0218/0108 amendment matches LLP 0252's Terminology rule for `normalizedContractId`.
- **D1's default-omission scoping matches LLP 0253 S1.2 precisely,** including the disclosed bundle/generation rotation, which is the correct LLP 0241 consequence (`bundleId` hashes generated members, `llp/0241:112-119`). D10's queued-intent drain restates `llp/0241:314-319` faithfully.
- **D9/D11's companion design matches LLP 0252 D7 as written:** four lanes (`llp/0252:654-661`), clock (`:704-710`), four dispositions (`:713-739`), the Phase 0 item-5 external-inventory pattern (`:887-889`), and LLP 0197's N≥3-per-configuration floor (`llp/0197:46-55`). The Motivation's diary attributions are all correct (diary 0030: capacity-settlement ambiguity, 12-second linked-permission staleness, signed-URL revocation GAP, and the permission-debugger praise, `diaries/0030:639-716`; diary 0031: no scheduler/cron/hosted-function/secret plane; diary 0029: `Permission denied: not…` diagnostic gap, `diaries/0029:792-795`; diary 0027: near-verbatim, `diaries/0027:554-559`; diary 0028: `diaries/0028:798-799`). All five InstantDB elapsed values match their run capsules to the recorded millisecond (e.g., Todo 1,900,589 ms = 31.68 min).

Judged as an RFC: the semantic boundary (generated layer over existing owners, not a third profile), the concept budget with its no-authored-yet-uncounted rule, the escape behavior (honest about LLP 0253's v1 refusal categories, which I verified against S4.4/Appendix A), the evaluation design (clean tiny-vs-explicit causal pair holding function profile constant, calibration lane quarantined, familiar crossing deferred to a preregistered 2×2), and the 0252/0253 integration (verified: Appendix A has no `.data()` row, `standardPattern` is disposition 4, and the shipped table builder has no `.data` method so the refusal expectation is grounded) are all coherent and appropriately altitude-limited. What remains open is genuinely Spec/Plan material. Every concern I could sustain is DETAIL-grade.

## 3. Concerns

**1. DETAIL, IN-DELTA — D4 (materialization sharing): function-slot resolution lacks a uniqueness/tie-break rule.**
The rule "a descriptor lowering to an existing generated operation's plan and contract resolves to that operation's exact function reference" (`llp/0254:428-433`) presumes exactly one matching generated operation. If the Spec's grammar ever admits two generated operations with identical plan+contract on one resource (or must arbitrate between generated and non-generated candidates), resolution is indeterminate. This identifies no defective decision — the direction (function-slot, never plan-hash) is correct and the residual-amendment clause reserves the vehicle. **Disposition:** the follow-on Spec pins the candidate set (generated operations only), a deterministic tie-break or refusal for degenerate matches, and notes that a synthesized-to-resolved flip coincides with ordinary generation rotation (QMK preimages are generation-bound anyway), so no extra custody migration rule is needed.

**2. DETAIL, IN-DELTA — D3: "unique-index fill" is ambiguous terminology.**
At `llp/0254:369-374`, "unique-index fill" can be read as (a) filling `listIndex` from the sole owner-leading candidate index, or (b) something involving unique indexes (which LLP 0065 uses for a different helper, `defineOwnedUniqueLookup`). Context ("the generator still receives a concrete index"; "every ambiguity refuses") supports reading (a), and the D3 example (one index) only works under it. **Disposition:** the dated LLP 0065 amendment defines the fill rule; a two-word clarification ("sole-candidate index fill") would remove the ambiguity now.

**3. DETAIL, IN-DELTA — D9: two reference ambiguities in the rewritten section.**
(i) "Membership and role writes remain D7 function escapes in every arm" (`llp/0254:666-668`) sits in a section where every other "D7" means LLP 0252 D7; here it must mean this RFC's D7 (or "escapes recorded per LLP 0252 D7's measurement"), and both readings happen to converge operationally, but the reference should be disambiguated. (ii) The clock starts "at the first qualified publication of the tiny Experimental surface after Phase 4" (`llp/0254:628-630`), yet Phase 4 itself contains "Run D9"; the intended anchor is Phase 4's package-closure shipment (its second bullet). **Disposition:** editorial disambiguation; no decision changes.

**4. DETAIL, PRE-EXISTING — D8: the illustrative static subpath import needs a mechanism the Spec must supply.**
`import { db } from "@expo/snapback/react/data"` (`llp/0254:593`) yielding an app-schema-typed `db` from a fixed package subpath is not achievable by a plain static re-export; LLP 0253's precedent is generated local modules (`_generated/`). The RFC acknowledges this ("app-generated or provider-bound"), so the decision — a distinct doorway that never squats the familiar `useQuery` binding at `@expo/snapback/react` (verified against LLP 0253 S3.1/S6.2) — is sound. **Disposition:** Spec fixes the doorway mechanics.

**5. DETAIL, IN-DELTA — Acceptance wording can be misread against D5's own rule.**
"prediction, custody, and settlement capabilities are declared and tested independently" (`llp/0254:905-910`) is readable as making settlement a declarable capability, which D5 forbids ("settlement obligatory for every accepted intent … never a third toggle", `llp/0254:471-475`). The intended meaning — settlement *facts* are present in artifacts and independently tested while never being a toggle — is recoverable, and D5 governs. **Disposition:** reword to "settlement obligations" (or similar) in the next editorial pass.

## 4. Implementer-probe result

**(a) Complete v1 capability lattice for a generated operation — DETERMINATE.**
Axes: **prediction** ∈ {generated exact shared prediction, none} × **custody** ∈ {queue-eligible durable custody, online-only}. **Settlement is not an axis**: authoritative settlement is obligatory for every accepted intent. All four cells admitted with stated behavior: (generated, queue-eligible) = full local-first path (optimistic paint, durable offline custody, exactly-once reconnect settlement); (none, queue-eligible) = accepted into durable custody and queues offline under LLP 0218 `withheld`/`unavailable` presentation, settles identically, no optimistic paint; (generated, online-only) and (none, online-only) = settle in the foreground attempt or reject. Declaration of each fact: neither is authored — prediction is derived from the operation IR (Phase 3); custody defaults to queue-eligible, with online-only as a generated or profile-default exception carrying a stable declared reason in the artifact; operation-declared custody enters the shipped dispatch/settlement contract only through a named LLP 0218/0108 amendment or canonical owner.

**(b) First D9 comparison — DETERMINATE.**
Lanes and workloads, per the normative cell table: (1) **tiny data surface** with function profile P = `snapback-explicit-v1`, on Todo plus day-two-from-that-Todo (treatment); (2) **explicit data path**, same P, same two workloads (named causal control); (3) **pinned InstantDB** on Todo only (external calibration, excluded from the causal decision). No familiar-profile cells (a later, separately preregistered 2×2 under a new configuration version); Chat cells only by dated Plan amendment after OQ8 admission. Clock: the tiny experiment's **own clock** — starting at the first qualified publication of the tiny Experimental surface after Phase 4 ships the package closure, ending at the earlier of three complete rounds or 90 days, extendable only by dated author amendment, disposing through D10's five outcomes; LLP 0252 D7's four lanes stay on D7's own clock and four-outcome disposition set. Phase 1's Todo checkpoint is explicitly not this experiment.

Both halves are now determinate from the document alone; neither is UNDERDETERMINED.

## 5. Direction assessment

**Retained.** The document's direction — isolate smallness from familiarity by generating the ordinary data path from declarations whose semantics existing owners already prove, with a monotonic function-profile escape, evidence-gated promotion, and a mechanically provable withdrawal — is well-supported by the diary/0082/0102 evidence and correctly refuses the failure modes (inferred authority, silent fallbacks, second caches, a third profile). No DIRECTION-DISSENT.

## 6. Self-attestation

I read and searched only files inside the capsule directory tree; I used no network access and no web search. I verified that no `llp/reviews/0253*` or `llp/reviews/0254*` file exists in the capsule and read none. I did not attempt to infer or reconstruct other reviewers' views in this or earlier rounds; the delta list in `REVIEW_INSTRUCTIONS.md` was treated as the orchestrator's enumeration only. Deviations/disclosures, exactly: (1) my harness injected context I did not request — the repository's `CLAUDE.md` project instructions, system reminders about tool availability/authentication and task-tracking tools, and a persistent-memory directive; none contained LLP 0253/0254 review content and none influenced the review's substance; (2) my toolset cannot hash or byte-count files, so the target's recorded SHA-256/byte identity was relied upon rather than verified; (3) r2 of the target is not in the capsule, so delta-list honesty was verified one-directionally (each enumerated item confirmed present in r3 and corpus-consistent; absence of undisclosed changes could not be mechanically confirmed); (4) `final-cli.log` at the capsule root was listed but not read, as it was not needed for the review.

VERDICT: READY
