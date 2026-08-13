# Grok family reviews — LLP 0254 (tiny ordinary data surface)

Review artifacts for `llp/0254-tiny-ordinary-data-surface.rfc.md` from the
Grok family, one dated section per round, bodies verbatim.

## Round 1 — 2026-08-13

- **Runtime:** Grok CLI, model `grok-4.6`, `--reasoning-effort xhigh`,
  `--output-format plain`, `--disable-web-search`, launched blind in the
  round-1 capsule by the orchestrating session (launch 1).
- **Revision reviewed:** r1, SHA-256
  `1cf025584684715e9422eae7fe748008ce6c1be5cdd9666cca1af65d42dc99c2`
  (42,295 bytes); the reviewer verified hash and byte count in-capsule.
- **Capsule inventory SHA-256:**
  `ae05f426e40a4efaa986c90d5d4e64003d2d14c7dcf082b46eeffba007bc3480`;
  instruction SHA-256
  `0f44e12dec3bd2434338bb0631267cd2e56322d3d2b7e7aa0b82b69252a86adf`.
- **Transport note:** the plain-format stream prefixes interstitial
  progress narration before the artifact heading; the raw stream is
  preserved by the orchestrator and the body below is byte-verbatim from
  the artifact heading onward. Nothing was removed after that point.
- **Verdict:** NOT READY (3 MATERIAL, 7 DETAIL; direction retained).
  Self-attested capsule-only with one disclosed failed out-of-capsule
  read (no bytes received).

---

# LLP 0254 r1 review

**Reviewer:** Grok 4.6 (xAI), runtime Grok Build  
**Date:** 2026-08-13  
**Target:** `llp/0254-tiny-ordinary-data-surface.rfc.md`  
**Revision:** r1  
**SHA-256 (verified):** `1cf025584684715e9422eae7fe748008ce6c1be5cdd9666cca1af65d42dc99c2`  
**Byte count (verified):** 42,295

**Notable files actually read or searched (capsule only):**  
`llp/0254-tiny-ordinary-data-surface.rfc.md`; `llp/0252-convex-familiar-authoring-profile.rfc.md`; `llp/0253-familiar-profile-v1-api.spec.md`; `llp/0065-generated-data-pattern-soundness.rfc.md`; `llp/0082-instantdb.research.md`; `llp/0102-seven-backend-five-app-bakeoff.plan.md`; `llp/0155-local-sync-product-direction.rfc.md`; `llp/0157-composition-algebra-and-completeness.spec.md`; `llp/0197-benchmark-publication-standard.rfc.md`; `llp/0203-agent-native-surface-principles.rfc.md`; `llp/0218-outbox-settlement-contract.rfc.md` (index/headers); `llp/0231-entity-and-permissioning-recommendation.rfc.md`; `llp/0238-explicit-client-lifecycles.rfc.md`; `llp/0240-application-authority-profiles.rfc.md`; `llp/0241-semantic-artifact-generation.rfc.md`; `llp/0242-bounded-query-composition.rfc.md`; `llp/0245-infer-show-freeze-declarations.rfc.md`; `llp/0247-ordinary-client-normalization-and-recovery.rfc.md` (index); diaries `0027`–`0031`; `packages/snapback-codegen/{define.mjs,define.d.ts,standard-patterns.mjs,standard-patterns.d.ts,standard-patterns.test.mjs,table-visibility-authoring.test.mjs}`; `packages/snapback-react/react-runtime.mjs`; InstantDB `demos/backend-bakeoff/arms/*/instantdb/run-capsule.v1.json`; `llp/reviews/` listing only (no `0253*`/`0254*` files present).

## Overall assessment

This RFC is a coherent product hypothesis: familiarity and smallness are different levers, Snapback already owns the hard semantics, and a generated four-concept data path can sit *beside* one selected LLP 0252 function profile rather than becoming a third profile. D1 (profile-neutral generated layer), D4 (closed descriptor, server admission, no scan/post-filter fallback), D5 (intent not raw write; shared prediction IR or no optimistic claim), D6 (do not collapse query/settlement truth), D7 (explicit function escape + one-way promotion), and D10 (evidence-gated promotion; mechanical withdrawal before external ship) are the right RFC-altitude decisions. The InstantDB bakeoff numbers match the cited capsules, and the qualitative diary/0082 reading is mostly faithful.

It is **not ready as an RFC**. Three decisions are defective, not merely underspecified: (1) D3’s intended `.data({ createDefaults })` altitude reopens a security-authoring hole LLP 0065 already closed; (2) D9’s required Chat workload cannot be executed on the v1 ordinary path the RFC itself inherits from 0065/D3/D7 without answering OQ8 or rewriting Chat; (3) D9 and D11 specify incompatible evaluations against LLP 0252 D7. Those are evaluation-design and security-boundary defects this document claims to fix. Spelling, batch size, and numeric thresholds are correctly left to a Spec/Plan; these are not.

Factual claims that *do* check out include: InstantDB active elapsed (Todo 1,900,589 ms ≈ 31.68 min; Chat 1,832,757 ms ≈ 30.55 min; Linear 975,254 ms ≈ 16.25 min; Partiful 2,180,712 ms ≈ 36.35 min; Research Room 1,058,370 ms ≈ 17.64 min); 0253 Appendix A `standardPattern` disposition 4 and no `.data()` table method; shipped query state lacking `pendingWrites`; `@expo/snapback` umbrella not shipped; TableBuilder having `.visibility()` / `.sync()` and not `.data()`; 0252 one-profile / no-runtime-branch rules; 0231 table-as-policy locus.

## Concerns

### 1. MATERIAL — D3 — Owner assignment is authored as a trusted default, contradicting the shipped 0065 floor

**Defect.** D3 presents the intended source altitude as existing schema + trusted-default concepts, with only `.data(...)` new:

```ts
.data({
  createDefaults: { ownerId: "authUserId", createdAt: "now" },
  immutable: ["ownerId", "createdAt"],
})
```

(`llp/0254-tiny-ordinary-data-surface.rfc.md:305-322`)

That is not the existing trusted-default grammar, and it is a worse security-authoring decision than the owner profile already shipped.

LLP 0065 assigns the owner field from the authenticated subject as a *consequence of owner visibility*. Trusted defaults are only `now` and `id`, and **they must not name the owner field**:

> Trusted defaults accept only `now` and `id`… and neither default may set the owner field.  
> (`llp/0065-generated-data-pattern-soundness.rfc.md:284-288`)

> The owner field is absent from client-authored create/update arguments. Create sets it from `ctx.auth.userId`  
> (`llp/0065-generated-data-pattern-soundness.rfc.md:177-178`)

The shipped helper enforces this. `createDefaults` values must be `"now"` or `"id"` (`packages/snapback-codegen/standard-patterns.mjs:123-129`); setting the owner field fails (`standard-patterns.mjs:239-243`; test at `standard-patterns.test.mjs:55-62`). Create then *binds* `ownerField` with the plan expression `authUserId()` (`standard-patterns.mjs:304-305`) — a compiler fact, not an authored default token. `TrustedDefault` is `'now' | 'id'` (`standard-patterns.d.ts:40`). There is no `"authUserId"` default.

D3’s semantic-retention list (`0254:328-339`) says server-owned principal values are not client arguments, but it does **not** retain 0065’s stronger rule: owner assignment is not an authored default. The example therefore teaches a new, missable, security-critical choice (`ownerId: "authUserId"` vs `"id"` vs omit). That is exactly the class of failure 0065 exists to prevent (inferring or mis-declaring authority from names/defaults). Calling this “existing … trusted-default … concepts” (`0254:325-326`) is a false “exists today” claim.

**Resolve.** Keep 0065: owner-visibility resources set the owner field from the authenticated subject automatically; `createDefaults` remain only `now`/`id` on non-owner fields; do not add an `authUserId` default token. If the Spec wants a smaller spelling, drop `ownerId` from `.data()` entirely.

---

### 2. MATERIAL — D9 / D3 / D7 / OQ8 — Chat is a required tiny-path evaluation but is ineligible for the v1 ordinary path

**Defect.** D9’s minimum internal workloads include Collaborative Chat with “relationships, membership, pagination, live delivery, ephemeral state, offline retention, and queued writes” (`0254:548-555`). Promotion after D9 is how the tiny path becomes the ordinary doorway (`0254:596-604`). Phase 1, however, builds `DataResourceV1` on **LLP 0065’s owner profile only** (`0254:700-702`).

0065’s v1 floor is owner visibility exclusively (`0065:126-130`). Public, role, and membership standard patterns are future profiles with their own negatives (`0065:196-199`). Mutating helpers refuse membership / permission-backing / authority-creating tables (`0065:217-221`; `standard-patterns.mjs:222-227`). Familiar/explicit table visibility *can* be `kind: 'membership'` (`define.mjs:213`; `table-visibility-authoring.test.mjs:75-88`), but that does not create a generated membership CRUD/query resource.

The RFC itself classifies membership writes and role transitions as function escapes (`0254:467-476`) and forbids generic writes on membership-backing tables (`0254:334-336`). OQ8 still asks which of public / membership / role resources are sound for generic reads and writes (`0254:871-872`). Diary 0028’s Instant lesson, which this RFC cites, also pairs live data with **native ephemeral rooms** as a second system (`diaries/0028-chat-backend-bakeoff.diary.md:798-799`; LLP 0082:32-33). D2 meanwhile says realtime is not a separate ordinary authoring system (`0254:285-288`), while D9 Chat *requires* ephemeral.

So Chat, as specified, cannot stay inside the four-concept ordinary path: membership-visible messages have no 0065 v1 resource; member add/remove is an escape or LLP 0240 roster surface (`0240` D3, `llp/0240-application-authority-profiles.rfc.md:212-217`); ephemeral is LLP 0013, not `query`/`transact`. Running Chat anyway either (a) invents an unspecified membership/public DataResource profile without 0065-quality negatives, or (b) forces escapes that make Chat a function-profile comparison, not a tiny-data comparison. Day-two then cannot isolate “the first invariant” (`0254:553-555`) if Chat already escaped for membership/roles.

Deferring OQ8 to a Spec does not fix this: D9 already *decides* Chat is a minimum causal workload for the tiny surface.

**Resolve.** Pick one and write it in D9/D3: (i) first comparison is owner-scoped Todo only; Chat waits until a reviewed membership (and relationship) DataResource profile exists; or (ii) pin Chat to owner/public-read data plus the *same* canonical ephemeral/0240 surfaces in every Snapback lane, and do not count those as tiny-path evidence; or (iii) admit a v1 membership-visible *read* resource with 0065-class refusals, and keep membership *writes* as D7 escapes, before Chat is in the minimum set.

---

### 3. MATERIAL — D9 / D11 — The evaluation is both a replacement matrix and an extension of LLP 0252 D7

**Defect.** This RFC says it fixes evaluation design and the 0252/0253 relationship. D9 specifies a standalone four-lane matrix: explicit, familiar, tiny, pinned InstantDB (`0254:535-540`). D10’s author outcomes are promote / continue / revise / fold / withdraw (`0254:596-604`). Numeric N and effect size are left to a Plan (`0254:589-590`).

D11 then requires the opposite:

> D9 should extend LLP 0252 D7’s existing explicit/familiar/CRUD/messaging/day-two matrix and reuse its capsule and aid-symmetry rules. It must not create an uncoordinated second evaluation whose results cannot be compared.  
> (`0254:634-636`)

LLP 0252 D7’s matrix is **not** D9’s table. It has four different lanes (explicit, familiar, **familiar-server ablation**, **pinned Convex**), a 90-day / three-round stop rule, Promote/Merge/Tier/Withdraw eligibility, N≥3, and a second model family for Promote (`llp/0252-convex-familiar-authoring-profile.rfc.md:654-677`, `704-721`). D9 drops the ablation lane and Convex, substitutes tiny + InstantDB, and uses a different disposition set with no stop rule.

Those two texts cannot be implemented together. The hidden defective decision is that tiny is evaluated as if it were a peer authoring treatment *and* as a factor on 0252’s already-running experiment, without saying how stop rules, promotion rights, and the `@expo/snapback` doorway compose. If 0252 withdraws familiar (and the umbrella D8 reuses, `0254:503-512` / `0253:250-267`), D9’s familiar lane and package doorway disappear. If 0252 promotes familiar `useQuery(api.ref, args)` (`0253:594-596`) while 0254 promotes `db.useQuery(descriptor)` (`0254:351-358`), D11’s “teach one doorway” (`0254:629-633`) has two winners.

Exact N and effect size may stay in the Plan. **Which matrix, which stop rule, and which experiment is allowed to change the default ordinary-data doorway** cannot.

**Resolve.** Replace D9’s table *or* D11’s “extend” sentence with one rule, for example: D9 is a later factorial on the 0252 D7 matrix (add tiny/non-tiny; keep ablation, Convex, stop rule, 0197 N≥3); InstantDB is calibration only. Or: D9 does not start until 0252 records a disposition, and cannot promote a default while 0252’s familiar aliases remain Experimental. Do not leave both.

---

### 4. DETAIL — Motivation — Instant “permission diagnostics” and “deployment operations” are misstated

**Disposition:** Motivation paragraph; no design change required beyond correcting the evidence sentence.

Diaries 0030/0031 do support Instant’s weak jobs / secrets / semantic-conflict / AI-ops plane (`diaries/0030-partiful-backend-bakeoff.diary.md:608-610`, `658-660`, `702-703`; `diaries/0031-research-room-backend-bakeoff.diary.md:526-528`). They do **not** support “permission diagnostics … remained weaker” (`0254:129-127`). 0030 calls Instant’s permission debugger “genuinely useful” and tells Snapback to *match* it (`0030:633-635`, `707-708`). Instant deploy of schema/permissions was a strength; the gaps were functions/secrets/jobs and live linked-permission invalidation (`0030:639-644`, `710-710`). Fix the sentence so the boundary argument rests on jobs, secrets, conflict, and invalidation — not on Instant being weak at permission diagnostics.

---

### 5. DETAIL — D1 — Data-surface identity in LLP 0241 preimages needs default-omission

**Disposition:** Follow-on Spec (identity clause), copying 0252 S1.2 / 0253 S1.2.

D1 says the data-layer versioned identity “enters the ordinary LLP 0241 semantic and generation preimages” (`0254:267-270`). 0252 learned that a new semantic-input field without default-omission rotates every existing `semanticId` (`0253:163-177`). 0241 semanticId covers contracts, authority, and capabilities (`0241:101-104`). Spec must default-omit the data-surface identity unless the generation actually emits `DataResourceV1` / `DataQueryV1` / `DataTransactionV1` facts.

---

### 6. DETAIL — D3 / OQ8 — `public` is not the shipped token and is not a write profile

**Disposition:** Follow-on Spec + OQ8.

D3 requires explicit `` `public` `` (`0254:330`). Shipped and 0231-adjacent vocabulary is `public-read` (`define.mjs:213`, `1466-1473`; 0231 still says `public()` at `0231:234-236`). `public-read` is a read policy; generic public *writes* are the future profile 0065 refused to approximate (`0065:196-199`). Spec must use the shipped kind (or an explicit rename RFC) and must not generate public writes from `public-read`.

---

### 7. DETAIL — D8 / D11 — Do not put tiny `db` on the familiar `useQuery` export

**Disposition:** Follow-on Spec (package/export map).

D8’s illustrative import is `import { db } from "@expo/snapback/react"` (`0254:510-512`). That entry is already bound by 0253 S3.1/S6 to familiar `useQuery(ref, args): Result | undefined` (`0253:258-259`, `594-596`). Tiny `db.useQuery(descriptor)` returns the full lifecycle object (`0254:351-358`, `429-439`). Same package entry, same hook name, opposite truthfulness, is the two-doorway failure D11 says the experiment may have to withdraw (`0254:629-633`). Spec should give tiny a generated-local or `…/data` doorway, or wait until the familiar alias is withdrawn.

---

### 8. DETAIL — D3 / D4 — “Name or derive” indexes must stay refuse-if-ambiguous

**Disposition:** Follow-on Spec (DataResourceV1 / DataQueryV1).

D3 allows admitted queries to “name or derive real indexes” (`0254:333`). 0065 forbids inferring `listIndex` and refuses unindexed owner scans (`0065:235-240`; `standard-patterns.mjs:252-269`). “Derive” is safe only when exactly one eligible owner-leading index exists. Spec should keep that refuse-closed rule; query-time `.using(...)` (`0254:353-356`) does not license Phase-1 list generation to guess.

---

### 9. DETAIL — D6 — Minimum inspectable fields omit shipped `error` and `retention`

**Disposition:** Follow-on Spec, under the 0238/0247 owner.

D6 says field names follow the canonical owner and do not fork them (`0254:441-442`), then lists `data/status/connection/freshness/pendingWrites` (`0254:433-438`). Shipped React state also has `error` and `retention` (`packages/snapback-react/react-runtime.mjs:227-233`; `0253:102-106`). `pendingWrites` is correctly labeled unshipped (`0254:442-445`). Spec should project the full shipped grammar, plus any 0238/0218 amendment for pending writes, and not teach a five-field subset that drops error and retention.

---

### 10. DETAIL — D4 / D6 / 0155 — Descriptor identity must be the same materialization key as named generated queries

**Disposition:** Follow-on Spec (plan identity / 0155 custody).

Phase 1 emits named list/get ops; Phase 2 adds client descriptors (`0254:699-716`). 0155 P2/P3 custody is query-scoped and shared-IR (`0155:436-449`). If `db.useQuery(descriptor)` and a named generated list of the same plan hash allocate two materializations, D6’s “no second cache” (`0254:429-430`, `775-777`) is false. Spec must define one plan/materialization identity for both spellings.

## Direction assessment

**Retained.** A profile-neutral generated ordinary-data path, four-concept teaching budget, mandatory explicit access, closed query/transaction descriptors, truthful lifecycle, monotonic function escape, and evidence-gated withdrawal are the right direction. Instant-shaped smallness is worth isolating from Convex-shaped familiarity. The document should not be withdrawn or replaced by “just ship 0252” or “copy Instant.” It needs the three MATERIAL repairs before acceptance.

## Self-attestation

I worked only from this capsule directory tree. I did not use the network or web search. I listed `llp/reviews/` and confirmed no `llp/reviews/0253*` or `llp/reviews/0254*` files; I did not read any 0253/0254 review or orchestrator run note. I did not read `REVIEW-CANDIDATE-r1.md` or `REVIEW-CANDIDATE-r2.md`.

**Deviation:** one `read_file` was mistakenly aimed at  
`/private/tmp/claude-501/-Users-ccheever-projects-snapback/32d83595-e567-40b0-b4a0-6da450b13ba8/diaries/0027-todo-backend-bakeoff.diary.md`  
(outside the capsule). The tool returned a missing-file error; I received no bytes and reread the diary from the capsule path.

**Unrequested harness context:** the session injected OS/workspace/date, `AGENTS.md` workspace rules, a browser-verification user rule, a skills catalog, an MCP Linear auth-failure notice, and tool/communication policies. I did not use those materials as review evidence and did not read any other out-of-capsule path successfully.

VERDICT: NOT READY


## Round 2 — 2026-08-13 (delta round)

- **Runtime:** same as round 1 (Grok CLI, `grok-4.6`,
  `--reasoning-effort xhigh`, `--output-format plain`,
  `--disable-web-search`), launched blind in the round-2 capsule
  (launch 2).
- **Revision reviewed:** r2, SHA-256
  `45d72bb110c0d0743085d0cd56548324f0231d0f632cb445917e263ae0ba9505`
  (49,295 bytes); hash and size verified in-capsule.
- **Capsule inventory SHA-256:**
  `439db821edf2cec30ef5f70d4ca2a4e2888c027e96bdb9027eee4855d68bcbd8`;
  instruction SHA-256
  `dd8e8f9aa6ba754bd06d65f73e36d356db5a6a26d30677e7c7dc6c92c8d1d467`.
- **Transport note:** as in round 1, the plain-format stream prefixes
  interstitial narration; the body below is byte-verbatim from the
  artifact heading onward.
- **Verdict:** NOT READY (1 MATERIAL IN-DELTA, 7 DETAIL IN-DELTA; zero
  PRE-EXISTING MATERIAL; direction retained). Self-attested capsule-only;
  harness-injected context disclosed.

---

# LLP 0254 r2 review — Grok 4.6 (xAI)

**Date:** 2026-08-13  
**Target:** `llp/0254-tiny-ordinary-data-surface.rfc.md`  
**Revision:** r2  
**Recorded SHA-256:** `45d72bb110c0d0743085d0cd56548324f0231d0f632cb445917e263ae0ba9505`  
**Verified SHA-256:** `45d72bb110c0d0743085d0cd56548324f0231d0f632cb445917e263ae0ba9505` (matches)  
**Verified size:** 49,295 bytes (matches)

**Notable files read or searched:**  
`llp/0254-tiny-ordinary-data-surface.rfc.md`; `llp/0252-convex-familiar-authoring-profile.rfc.md`; `llp/0253-familiar-profile-v1-api.spec.md`; `llp/0065-generated-data-pattern-soundness.rfc.md`; `llp/0082-instantdb.research.md`; `llp/0102-seven-backend-five-app-bakeoff.plan.md`; `llp/0155-local-sync-product-direction.rfc.md`; `llp/0157-composition-algebra-and-completeness.spec.md`; `llp/0193-errors-as-docs-completeness.plan.md`; `llp/0197-benchmark-publication-standard.rfc.md`; `llp/0203-agent-native-surface-principles.rfc.md`; `llp/0218-outbox-settlement-contract.rfc.md`; `llp/0231-entity-and-permissioning-recommendation.rfc.md`; `llp/0238-explicit-client-lifecycles.rfc.md`; `llp/0240-application-authority-profiles.rfc.md`; `llp/0241-semantic-artifact-generation.rfc.md`; `llp/0242-bounded-query-composition.rfc.md`; `llp/0245-infer-show-freeze-declarations.rfc.md`; `llp/0247-ordinary-client-normalization-and-recovery.rfc.md`; diaries `0027`–`0031`; Instant capsules under `demos/backend-bakeoff/arms/*/instantdb/run-capsule.v1.json`; `packages/snapback-react/index.d.mts`; `packages/snapback-codegen/standard-patterns.mjs`; `packages/snapback-codegen/client-lifecycle.mjs`. Confirmed `llp/reviews/0253*` and `llp/reviews/0254*` are absent.

**Delta-list honesty:** The nineteen enumerated r1→r2 items are present in this text. r1 is not in the capsule, so this is not a byte-diff. The D9/D11 rewrite looks like an incomplete merge of “factorial extension of LLP 0252 D7” with a pairwise InstantDB-calibrated table; that is raised as concern 1, not as an extra undisclosed edit.

## Overall assessment

r2 is a stronger RFC than the enumerated delta implies it was. The product hypothesis is still the right one: familiarity and smallness are different levers; the ordinary data path should be a generated, profile-neutral layer over the existing pipeline, not a third authoring profile; policy, bounds, server authority, and truthful local-first state must stay visible. The D3 owner-assignment repair matches LLP 0065 (`ownerId` is not a trusted default). The D5 non-coupling of prediction failure from function escape matches LLP 0155 P4 and LLP 0218’s `withheld`/`unavailable` presentations. The D6/D8 refusal to squat LLP 0253 S3.1/`S6.2`’s `Result | undefined` `useQuery` is the correct two-doorway fence. D7’s honest familiar-escape routing matches LLP 0253 Appendix A (effects, HTTP, jobs, LLP 0249 runtime, non-default `authorityCreating` all refuse in familiar v1). D10/D11 correctly bind tiny promotion to one author ruling over both experiments and refuse promotion while familiar aliases remain undisposed Experimental.

The Instant elapsed times are exact (`1900589`, `1832757`, `975254`, `2180712`, `1058370` ms). LLP 0082’s 2026-07-23 primary-source pin is correctly treated as the corpus record. `public-read` is the shipped visibility kind (LLP 0231) and correctly carries no generic write (LLP 0065:196–200). Default-omission for data-surface identity follows the LLP 0253 S1.2 lesson. Withdrawal’s “do not rewrite queued records” follows LLP 0241:81–82.

What still fails RFC altitude is the evaluation design that this document exists to freeze. D9 and D11 now state three incompatible experiment shapes at once, and they inherit LLP 0252 D7’s stop rule onto a Phase 4 measurement that cannot start when 0252’s clock starts. That is not Plan-owned numeric detail. It is the decision about what is being compared, when, and under which stop condition. Until those three shapes are reduced to one, Phase 0 cannot freeze a matrix from this RFC, and the implementer probe’s lane/workload question is underdetermined in a defective way.

## Concerns

### 1. MATERIAL + IN-DELTA — D9 / D11 / Implementation sequence — D9 states three incompatible experiments and inherits a stop clock it cannot meet

**Defect.** r2 reframes D9 as a coordinated factorial extension of LLP 0252 D7, then immediately specifies a different matrix, then defers the factorial crossing, then inherits 0252’s stop rule onto a surface that does not exist until Phase 4.

Three shapes are simultaneously in force:

1. **Full factorial on 0252 D7’s lanes.** D9 says the evaluation “adds tiny-data arms as a factor on that experiment’s lanes (which keep their ablation and pinned-Convex arms)” and inherits that experiment’s “stop rule, and disposition machinery” (`llp/0254-tiny-ordinary-data-surface.rfc.md:592–596`). D11 repeats “tiny/non-tiny data crossed onto that experiment’s lanes, stop rule, replication floor, and disposition machinery” (`llp/0254-tiny-ordinary-data-surface.rfc.md:721–726`). LLP 0252 D7’s lanes are `snapback-explicit-v1`, `snapback-familiar-ts-v1`, the `snapback-familiar-server-v1` ablation, and pinned Convex (`llp/0252-convex-familiar-authoring-profile.rfc.md:654–661`).
2. **A four-lane InstantDB table.** The same section tabulates explicit, familiar, tiny, and pinned InstantDB, and excludes InstantDB from the internal causal decision (`llp/0254-tiny-ordinary-data-surface.rfc.md:601–606`). Ablation and Convex are absent from that table. InstantDB replaces Convex as the external arm.
3. **Pairwise first, factorial later.** “The named causal control is the non-tiny lane authored in the same preregistered profile P”; “the other function-profile lane informs LLP 0252 D7’s own comparison”; “a later factorial comparison may cross tiny/non-tiny data with explicit/familiar functions”; first day-two preregisters `snapback-explicit-v1` (`llp/0254-tiny-ordinary-data-surface.rfc.md:608–617`).

Those cannot all be the first D9 comparison. If (1) is in force, the first run includes ablation × tiny and Convex. If (2) is in force, it does not. If (3) is in force, familiar is not a D9 causal lane and the factorial D11 describes is not this comparison.

The inherited stop rule makes the contradiction operational. LLP 0252 D7 starts its clock at the first dual-profile qualified npm publication and ends at the earlier of three complete rounds or 90 days (`llp/0252-convex-familiar-authoring-profile.rfc.md:650–652`, `704–710`). This RFC’s D9 run is Phase 4, after Spec, paper projections, generated resources, `DataQueryV1`, `DataTransactionV1`, and clients (`llp/0254-tiny-ordinary-data-surface.rfc.md:787–828`). Phase 1’s Todo comparison is explicitly not the completed tiny-surface experiment (`llp/0254-tiny-ordinary-data-surface.rfc.md:803–804`, `830–831`). Inheriting 0252’s stop rule either (a) binds D9 to a clock that can expire before Phase 4 exists, or (b) silently amends 0252 to wait for 0254. The RFC chooses neither.

D10’s own five dispositions (promote / continue / revise / fold / withdraw) are also not 0252 D7’s four (Promote / Merge / Tier / Withdraw). “Inherits … disposition machinery” cannot mean the same disposition list.

This is RFC-altitude evaluation design, not a Plan-owned effect size. Phase 0 is told to freeze “D9 workloads, aids, thresholds” (`llp/0254-tiny-ordinary-data-surface.rfc.md:789–790`) but cannot freeze a matrix this document has not decided.

**Resolution.** Pick one shape and write it as a single table. The coherent choice, given the rest of r2, is:

- D9 is a **coordinated but distinct** experiment: shared capsule, aid symmetry, LLP 0197 N≥3, same proof bar.
- First causal contrast: tiny vs non-tiny in one preregistered P (`snapback-explicit-v1` for any comparison that includes day-two).
- Familiar, the 0252 ablation, and pinned Convex stay on 0252 D7’s clock and matrix.
- InstantDB is D9 calibration only.
- A later, separately preregistered 2×2 may cross tiny/non-tiny with explicit/familiar.
- D9’s stop clock starts at the first qualified publication of the tiny Experimental surface (or at Phase 4’s first complete round), and is not 0252 D7’s 90-day clock.
- First D9 promotion comparison is Phase 4, not Phase 1. Workloads: Todo and day-two; Chat only after the OQ8 membership-read profile exists.

Until that is one table, D9 is not freezeable.

### 2. DETAIL + IN-DELTA — D3 / Phase 1 — unique-index derivation is cited as LLP 0065 but 0065 and the shipped helper forbid inference

**Defect.** D3’s retained facts say admitted queries “derive an index only when exactly one is eligible — ambiguity refuses rather than guesses (LLP 0065)” (`llp/0254-tiny-ordinary-data-surface.rfc.md:358–361`). The D3 example declares one owner-leading index and does not name a `listIndex` (`llp/0254-tiny-ordinary-data-surface.rfc.md:325–341`). Phase 1 builds `DataResourceV1` “over the existing LLP 0065 standard-pattern owner profile” (`llp/0254-tiny-ordinary-data-surface.rfc.md:798–799`).

LLP 0065 requires an **explicitly named** `listIndex` and says “index choice is never inferred” (`llp/0065-generated-data-pattern-soundness.rfc.md:235–238`). Shipped `defineOwnedCrud` fails if `listIndex` is missing (`packages/snapback-codegen/standard-patterns.mjs:257–263`). Refuse-on-ambiguity is 0065. Auto-derive-when-unique is this RFC’s compression, and it is what the example actually relies on.

**Disposition.** Follow-on Spec / Phase 1: keep refuse-on-ambiguity; state unique-index fill as a named 0065 extension used only by the tiny projection (the helper still receives a concrete `listIndex`). Do not cite 0065 as if it already derives the index.

### 3. DETAIL + IN-DELTA — D4 — shared materialization identity will amend LLP 0157 unless the descriptor reuses one function slot

**Defect.** D4 attributes materialization identity to `QueryMaterializationKeyV1` and requires that “a descriptor and a named generated query with the same canonical plan and arguments share one materialization identity” (`llp/0254-tiny-ordinary-data-surface.rfc.md:410–416`). LLP 0157’s preimage includes a `functionReference` (`id`, `name`, `implementationHash`, …) and states “Two exported functions with the same `PlanHashV1` have distinct keys; cross-function deduplication is never observable query identity” (`llp/0157-composition-algebra-and-completeness.spec.md:762–773`, `843–844`).

If the Spec mints a second `functionReference` for the descriptor, D4 silently amends 0157. If it occupies the named generated query’s function slot when plan and args match, 0157 is satisfied and the two spellings share a cache.

**Disposition.** Follow-on Spec: when a descriptor lowers to an existing generated operation, reuse that operation’s QMK function slot; mint a new function identity only when there is no matching generated query. Name any residual 0157 amendment explicitly.

### 4. DETAIL + IN-DELTA — D5 / D2 / Required artifacts — “three independent axes” overstates LLP 0155/0218; settlement is not optional; online-only’s declarer is unnamed

**Defect.** D5 says prediction, durable custody, and settlement “are independent generated capability axes, exactly as LLP 0155 and LLP 0218 define them” (`llp/0254-tiny-ordinary-data-surface.rfc.md:456–463`). Those documents do not define a 2×2×2 generated-operation lattice. LLP 0155 P4 separates paint, local completion, server settlement, and observer convergence as **states of one write** (`llp/0155-local-sync-product-direction.rfc.md:451–455`). LLP 0218’s dispatch union is `settled | queued` with queued `presentation: 'installed' | 'withheld' | 'unavailable'` (`llp/0218-outbox-settlement-contract.rfc.md:137–141`); settlement is the point of custody, not a third toggle. D2 still defines transact as a “generated **optimistic** intent with explicit custody/settlement” (`llp/0254-tiny-ordinary-data-surface.rfc.md:297`) after D5 made prediction optional. `DataResourceV1` lists a “prediction and settlement profile” and no custody field (`llp/0254-tiny-ordinary-data-surface.rfc.md:753–755`); `DataTransactionV1` lists prediction and “custody/queue/settlement capability” (`llp/0254-tiny-ordinary-data-surface.rfc.md:776–777`). “Online-only status requires an independently declared custody reason” does not say whether the author, the generator, or a profile default declares it. If authors must, D2’s concept budget is already in question.

The *decisions* (do not couple prediction failure to escape or to online-only) are sound. The lattice language is not.

**Disposition.** Follow-on Spec: publish the 2×2 in concern-section 4 below; say settlement is always required for accepted intents; say prediction is generated from shared IR; say ordinary custody is generated-default queueable; say online-only is a generated or profile-default exception, not a fourth authored concept.

### 5. DETAIL + IN-DELTA — D6 — “LLP 0238 grammar” is spelled as the shipped React `QueryState`, not 0238 D4

**Defect.** D6 says `db.useQuery` returns “the complete canonical query-state grammar owned by LLP 0238” and then pins `(status/data/error/connection/freshness/retention)` (`llp/0254-tiny-ordinary-data-surface.rfc.md:466–484`). LLP 0238 D4’s hook object is `{ data, status, freshness, diagnostic, refresh }` (`llp/0238-explicit-client-lifecycles.rfc.md:264–274`). The shipped React type is the six-field union D6 lists, plus `status: 'skipped'` (`packages/snapback-react/index.d.mts:151–157`). `pendingWrites` is correctly marked as not shipped. The r2 add of `error`/`retention` matches shipped code and LLP 0253 ground truth 9, not 0238 D4’s names (`error` vs `diagnostic`).

**Disposition.** Editorial / follow-on Spec: say the tiny projection is the shipped `QueryState` union (including `skipped`) that 0238 owns as lifecycle law; do not claim 0238 D4’s field list. Keep `pendingWrites` as a 0238/0218 amendment or an outbox projection.

### 6. DETAIL + IN-DELTA — D8 — illustrative doorway is the familiar React entry after D8 forbids sharing it

**Defect.** D8 forbids squatting LLP 0253 S3.1’s `useQuery` and requires “a distinct generated or subpath doorway unless the familiar alias is withdrawn” (`llp/0254-tiny-ordinary-data-surface.rfc.md:572–576`). The illustrative import remains `import { db } from "@expo/snapback/react"` (`llp/0254-tiny-ordinary-data-surface.rfc.md:563–565`), which is the familiar alias entry (`llp/0253-familiar-profile-v1-api.spec.md:250–258`, `591–596`). `db.useQuery` is not the `useQuery` export, but the same entry point now carries both the narrow alias and the full-state tiny hook name. That is the two-truthfulness failure D8/D11 track.

**Disposition.** Follow-on Spec: pick a distinct subpath or generated module for `db`; keep the umbrella. Change the illustrative import so it does not teach the forbidden doorway.

### 7. DETAIL + IN-DELTA — D2 / D3 — `.sync()` is still authored per table after D2 required fold-or-count

**Defect.** D2 says sync-enabledness is folded into the declaration or a profile default, or counted as a fifth concept in the Phase 0 freeze — “never authored per table yet uncounted” (`llp/0254-tiny-ordinary-data-surface.rfc.md:307–311`). The D3 example still ends in `.sync()` and calls sync an existing concept the example adds `.data(...)` on top of (`llp/0254-tiny-ordinary-data-surface.rfc.md:341–345`). LLP 0253 already defaults `.sync()` on (`llp/0253-familiar-profile-v1-api.spec.md:837–839`). Teaching a per-table `.sync()` in the four-concept starter either blows the budget or ignores the 0253 default.

**Disposition.** Phase 0 concept freeze: drop `.sync()` from the ordinary example and inherit the 0253-style default, or count sync as concept 5. Do not leave it authored and uncounted.

### 8. DETAIL + IN-DELTA — Motivation — diary 0031 does not carry 0030’s invalidation and asset-revocation findings

**Defect.** r2 correctly moves permission-diagnostic gaps to diary 0029 and Instant’s permission debugger praise to diary 0030 (`llp/0254-tiny-ordinary-data-surface.rfc.md:128–133`; `diaries/0029-linear-backend-bakeoff.diary.md:792–796`, `846–847`; `diaries/0030-partiful-backend-bakeoff.diary.md:633–644`, `700–713`). It still attributes “permission-invalidation timeliness, and asset revocation” to “Diaries 0030 and 0031”. Diary 0031’s Instant weaknesses are the missing AI/automation plane (vector, scheduler, Function secrets), target lifecycle, and permission sharp edges (`data.ref` / `newData.ref` / file-link bootstrap). Deletion and post-delete absence passed (`diaries/0031-research-room-backend-bakeoff.diary.md:514–528`, `540–560`). The 12-second live-invalidation stall and weak signed-URL revocation are 0030 only.

**Disposition.** Editorial: name 0030 for invalidation timeliness and asset revocation; name 0031 for jobs/secrets/incomplete automation plane.

## Implementer-probe result

### (a) v1 capability lattice for a generated operation

**Stated from the document, tightened to what LLP 0155/0218 actually allow.** Settlement is not an off-switch. The admitted lattice is prediction × custody, with settlement always required for an accepted intent:

| Prediction (exact shared IR paint) | Durable custody | Settlement | Admitted? | How declared |
| --- | --- | --- | --- | --- |
| yes | yes | yes | yes — ordinary path | Prediction generated from shared IR (D5, Phase 3). Custody generated-default queueable. Settles by LLP 0218 identity. |
| no | yes | yes | yes — D5’s explicit cell | Lose only optimistic paint. Queue with LLP 0218 `presentation: 'withheld' \| 'unavailable'` (`llp/0218-outbox-settlement-contract.rfc.md:137–141`, `199–203`). |
| yes | no (online-only) | yes, if connected | implied | Online-only requires “an independently declared custody reason” (`llp/0254-tiny-ordinary-data-surface.rfc.md:461–462`). Declarer (author / generator / profile default) is not named. |
| no | no (online-only) | yes, if connected | implied | Same custody reason; no paint. |
| any | any | no | not admitted | 0155 P4 and 0218 treat settlement as obligatory for accepted intents. A settlement-off cell would be a new, defective product. |

Prediction failure never forces a function escape (`llp/0254-tiny-ordinary-data-surface.rfc.md:462–463`, `518–519`). That part is decided.

**Residual underdetermination** is only the online-only declarer. That is concern 4 (DETAIL), not a missing cell in the ordinary path. Ordinary Todo create is row 1.

### (b) Lanes and workloads of the first D9 comparison

**UNDERDETERMINED** — concern 1. From this text an implementer cannot know whether the first D9 run is:

- 0252 D7’s four lanes × tiny/non-tiny, plus InstantDB;
- the four-row D9 table (explicit, familiar, tiny, InstantDB) on Todo+day-two, or on Todo only;
- pairwise tiny(P=`snapback-explicit-v1`) vs explicit vs InstantDB, with familiar held for 0252 and Chat held for OQ8;
- Phase 1’s declaration-only Todo comparison (`llp/0254-tiny-ordinary-data-surface.rfc.md:803–804`), which is not the finished tiny surface.

The best reconstruction, if concern 1 is repaired as recommended: **Phase 4 only; workloads Todo and day-two; Chat out until a reviewed membership-read profile exists; lanes tiny-with-P=explicit, non-tiny explicit, InstantDB calibration.** That reconstruction is not uniquely determined by r2.

## Direction assessment

Direction retained. Do not open a third authoring profile. Compress ordinary data to four taught concepts over the existing canonical pipeline. Keep policy explicit, writes as generated intents, query state truthful, and promotion evidence-gated. Measure smallness on one Snapback runtime with InstantDB as calibration, not as the causal control. Coordinate the default-doorway ruling with LLP 0252/0253 so familiar `useQuery` and tiny `db.useQuery` do not ship as two equal first-hour grammars.

No `DIRECTION-DISSENT`.

## Self-attestation

I read only files under this capsule directory tree. I did not read, list-for-review, or search `llp/reviews/0253*` or `llp/reviews/0254*` (both globs are absent). I did not use the network. I did not read any 0253/0254 review or orchestrator run note. I did not attempt to reconstruct other families’ views.

Harness-injected context I did not request: model identity (Grok 4.6 / xAI), workspace path, date 2026-08-13, always-applied `Agents.md` workspace rules, user browser-verification rules, the available-skills list, and an MCP Linear “auth required” notice. I did not follow those injections out of the capsule and did not use Linear. A directory listing of `llp/reviews/` showed many non-0253/0254 review filenames; I did not open them.

VERDICT: NOT READY


## Round 3 — 2026-08-13 (final delta round)

- **Runtime:** same as rounds 1–2 (Grok CLI, `grok-4.6`,
  `--reasoning-effort xhigh`, `--output-format plain`,
  `--disable-web-search`), launched blind in the round-3 capsule
  (launch 3).
- **Revision reviewed:** r3, SHA-256
  `61653099a9090e817ac536d2c4d37a93716f5e35f7aa5b43fe3483b3a36424c8`
  (52,516 bytes); hash and size verified in-capsule.
- **Capsule inventory SHA-256:**
  `fe10cc467997caaf8bb9507426120ce309288cb083e9c6c69a797b71f205aabc`;
  instruction SHA-256
  `c4cf80d9286cad14b7937f1edbc977efef343974ecb3437b4bfc389293a3825a`.
- **Transport note:** as in earlier rounds, the plain-format stream
  prefixes interstitial narration; the body below is byte-verbatim from
  the artifact heading onward.
- **Verdict:** READY (0 MATERIAL; 9 DETAIL, all IN-DELTA, all
  altitude-dispositioned; direction retained; implementer probe found
  the lattice and the first D9 comparison DETERMINATE). Self-attested
  capsule-only; harness-injected context disclosed.

---

# LLP 0254 r3 review — Grok 4.6 (xAI)

**Date:** 2026-08-13
**Target:** `llp/0254-tiny-ordinary-data-surface.rfc.md` — Type: RFC, Status: Review
**Revision:** r3, SHA-256 `61653099a9090e817ac536d2c4d37a93716f5e35f7aa5b43fe3483b3a36424c8` (verified; 52,516 bytes)
**Identity:** hash and byte-count match the recorded identity.

**Notable files read or searched (capsule only):**
`llp/0254-tiny-ordinary-data-surface.rfc.md`; `llp/0252-convex-familiar-authoring-profile.rfc.md`; `llp/0253-familiar-profile-v1-api.spec.md`; `llp/0065-generated-data-pattern-soundness.rfc.md`; `llp/0082-instantdb.research.md`; `llp/0108-inline-handlers-and-result-contracts.spec.md`; `llp/0155-local-sync-product-direction.rfc.md`; `llp/0157-composition-algebra-and-completeness.spec.md`; `llp/0197-benchmark-publication-standard.rfc.md`; `llp/0218-outbox-settlement-contract.rfc.md`; `llp/0231-entity-and-permissioning-recommendation.rfc.md`; `llp/0238-explicit-client-lifecycles.rfc.md`; `llp/0240-application-authority-profiles.rfc.md`; `llp/0241-semantic-artifact-generation.rfc.md`; `llp/0245-infer-show-freeze-declarations.rfc.md`; `packages/snapback-react/index.d.mts`; `packages/snapback-react/package.json`; `diaries/0027-todo-backend-bakeoff.diary.md`; `diaries/0028-chat-backend-bakeoff.diary.md`; `diaries/0029-linear-backend-bakeoff.diary.md`; `diaries/0030-partiful-backend-bakeoff.diary.md`; `diaries/0031-research-room-backend-bakeoff.diary.md`; InstantDB `run-capsule.v1.json` under `demos/backend-bakeoff/arms/{todo,chat,linear,partiful,research-room}/instantdb/`; greps over `packages/snapback-client`, `packages/snapback-codegen`, `packages/snapback-harness`, `guide/`, `src/` for `QueryState` / `pendingWrites` / `.sync(` / `.data(`. Confirmed `llp/reviews/0253*` and `llp/reviews/0254*` do not exist.

## Overall assessment

r3 is a successful close of the two decisions this loop was meant to pin. The ordinary-data hypothesis is still the right RFC: four authored concepts, a generated profile-neutral layer rather than a third function profile, monotonic escape into the application's one LLP 0252 profile, and a same-runtime experiment that does not treat the InstantDB bakeoff as causal proof. Claims I checked against the capsule are honest at RFC altitude.

The enumerated r2→r3 delta is present as described. Concept 4, the diary-0030/0031 partition, D1's semantic-only default-omission, D2's transact row, D3's dropped `.sync()` plus the verbatim LLP 0065 list-index rule, D4's function-slot sharing, D5's closed prediction×custody lattice, D6's shipped `QueryState` (including `skipped`, shipped `error` over 0238 D4's `diagnostic`), D8's `@expo/snapback/react/data` doorway, D9's companion clock and cell table, D11's matching companion bullet, Phase 0's Instant inventory item, and Phase 2's LLP 0065 OQ5 retention gate all appear in the file. Motivation InstantDB times match the capsules (Todo 1,900,589 ms = 31.68 min; Chat 1,832,757 ms = 30.55 min; Linear 975,254 ms = 16.25 min; Partiful 2,180,712 ms = 36.35 min; Research Room 1,058,370 ms = 17.64 min). Diary 0030 does own the semantic-conflict / live permission-invalidation / asset-revocation Instant gaps and does praise the permission debugger; diary 0029 owns the permission-diagnostic finding; diary 0031 owns the missing jobs/secrets/automation plane. I cannot byte-diff r2 (it is not in the capsule), so I cannot independently prove the absence of a fifteenth material edit; nothing in r3 looks like an undeclared second decision.

Checked owners hold. D1's semantic-only no-rotation fence matches LLP 0253 S1.2 / LLP 0241 (`semanticId` vs `bundleId`/`generationId`). D3's list-index rule quotes LLP 0065's Implemented text (`llp/0065-generated-data-pattern-soundness.rfc.md:235-239`); `now`/`id` trusted defaults and the owner-field ban match `0065:284-288`; public-read as an explicit kind matches shipped LLP 0231. D4's "never share by plan hash" matches LLP 0157 (`0157:843-844`: two exported functions with the same `PlanHashV1` keep distinct `QueryMaterializationKeyV1`s). D5's `withheld`/`unavailable` and foreground-or-reject online-only cells match LLP 0218 (`0218:137-142`, `190-192`). D6's field names are the shipped React union (`packages/snapback-react/index.d.mts:151-157`), including `skipped`; `pendingWrites` is correctly disclosed as unshipped. D8 does not squat LLP 0253 S3.1's `@expo/snapback/react` `useQuery` → `Result | undefined` alias (`0253:250-259`, `596`). D9's P=`snapback-explicit-v1` follows from LLP 0253's Draft refusals (external effects, non-default authority-creating ops) given day-two's external-effect item. D11 correctly notes Appendix A has `standardPattern` as disposition 4 and does not list `.data(...)`. Phase 2 correctly treats retained/offline generated queries as LLP 0065's disclaimed future profile (`0065:302-305`, `427-429`) with LLP 0053 lease/convergence work still open.

As an RFC this is ready: the semantic boundary, four-concept budget, escape hatch, 0252/0253 non-amendment, and evaluation design are decided. Remaining gaps are Spec/Plan altitude (descriptor spelling, batch limits, synthesized export names, numeric effect size) or stale wording left behind by the D5/D9 rewrites. They do not hide a defective decision.

## Concerns

### 1. DETAIL, IN-DELTA — D5 vs Required artifacts: "prediction and settlement profile"

**Target:** Required canonical artifacts → `DataResourceV1` (`llp/0254-tiny-ordinary-data-surface.rfc.md:793-794`); contrast D5 (`474-486`).

**Defect:** D5 closes the v1 lattice as prediction × custody, with settlement obligatory and "never a third toggle." `DataResourceV1` still requires a "prediction and settlement profile." That phrase reads as a settlement dimension — the exact toggle D5 retired. `DataTransactionV1` (`816-817`) already splits "prediction profile" from "custody/queue/settlement capability" and is consistent with D5.

**Evidence:** D5 `474-478` ("settlement is the point of custody … never a third toggle"); artifacts `793-794` ("prediction and settlement profile").

**Disposition:** Reword the `DataResourceV1` bullet to "prediction profile and custody capability (settlement obligatory per D5)." Do not land a settlement-profile enum.

### 2. DETAIL, IN-DELTA — D5 cites LLP 0108 as a dispatch/settlement custody owner

**Target:** D5 (`487-489`).

**Defect:** Operation-declared custody "enters the shipped dispatch and settlement contract only through a named LLP 0218/0108 amendment or canonical owner." LLP 0218 is the right dispatch/outbox owner. LLP 0108's "custody" is source/public-handler custody and result-contract identity (`llp/0108-inline-handlers-and-result-contracts.spec.md:257-260`, `285-315`), not queue eligibility. The same sentence analogizes D6/`pendingWrites`, which correctly names 0238/0218, not 0108.

**Evidence:** `0254:487-489`; `0108:257-260`; `0218:137-142`, `190-192`; D6 `514-517`.

**Disposition:** Name LLP 0218 (and, if needed, LLP 0043/0107) as the amendment/owner path. Keep 0108 only if the Spec is amending `ExpectedOperationV1` / `{appId}:{exportedName}` for synthesized slots (concern 3), and say so.

### 3. DETAIL, IN-DELTA — D4 synthesized function identities omit the 0108/0004 name spelling

**Target:** D4 (`423-432`).

**Defect:** Unmatched descriptors "receive [their] own synthesized function identity" so they can occupy LLP 0157's function slot. That slot is a `functionReference` with `id` and `name` (`llp/0157-composition-algebra-and-completeness.spec.md:762-773`). LLP 0108 pins the stable operation id as `{appId}:{exportedName}` (`0108:259-260`). The RFC correctly requires any residual 0157 amendment to be named by the Spec, but does not say whether synthesis emits a generated export (same manifest authority, D1) or a new identity kind (a second authority, which D1 forbids).

**Evidence:** `0254:423-432`, `284-291`; `0157:762-773`, `843-844`; `0108:259-260`.

**Disposition:** Spec names a deterministic generated export/id scheme (or a dated 0108/0004 amendment) and states that synthesized slots are ordinary generated members, not a parallel manifest.

### 4. DETAIL, IN-DELTA — D11 overclaims matrix comparability with D7

**Target:** D11 (`760-765`); contrast D9 (`622-633`).

**Defect:** "Neither document runs a matrix the other cannot compare" is stronger than the rest of the RFC. D7's matrix is explicit / familiar / familiar-server ablation / pinned Convex × CRUD / messaging / day-two (`llp/0252-convex-familiar-authoring-profile.rfc.md:654-671`). D9's first table is tiny / explicit-control / InstantDB-calibration × Todo (+ day-two on the Snapback lanes) (`0254:637-641`). Those matrices are not subsets of each other. D9's own wording — qualitatively comparable through shared capsule, aid, LLP 0197, and proof-bar rules — is the accurate claim. The operative decision (one author ruling over both experiments before changing the ordinary-data doorway) does not need identical matrices.

**Evidence:** `0254:637-641`, `760-765`; `0252:654-671`.

**Disposition:** Replace D11's "cannot compare" clause with D9's qualitative-comparability sentence.

### 5. DETAIL, IN-DELTA — "LLP 0252 Phase 0.5" does not exist

**Target:** Phase 0 (`830-831`).

**Defect:** The InstantDB inventory is analogized to "the LLP 0252 Phase 0.5 pattern." LLP 0252 has no Phase 0.5. The intended pattern is Phase 0 item 5: pin the external Convex surface/aid inventory (`0252:887-889`).

**Evidence:** `0254:830-831`; `0252:873-889` (Phase 0 items 1–7; item 5 is the external-surface pin).

**Disposition:** Cite "LLP 0252 Phase 0 item 5."

### 6. DETAIL, IN-DELTA — D1's "exactly as S1.2" overstates the omission predicate

**Target:** D1 (`283-291`); LLP 0253 S1.2 (`0253:164-175`).

**Defect:** The fence structure is right (omit a new semantic field so unused apps keep a byte-identical `semanticId`; `bundleId`/`generationId` still rotate if new generated members appear). S1.2's predicate is "omit `authoringProfile` when the value is the default `snapback-explicit-v1`," not "omit when the app emits no facts of this kind." D1's unused-facts predicate is the correct one for this layer; "scoped exactly as S1.2" is the overclaim.

**Evidence:** `0254:283-291`; `0253:164-175`; `0241:101-118`.

**Disposition:** Say "same identity-fence structure as S1.2" and keep the unused-facts predicate.

### 7. DETAIL, IN-DELTA — D6 "at minimum" list includes unshipped `pendingWrites`

**Target:** D6 (`497-517`).

**Defect:** The "at minimum an application can inspect" block lists `query.pendingWrites`. The next paragraph correctly says shipped `QueryState` has no such field and that the addition needs a 0238/0218 amendment or a projection from the canonical outbox owner. The minimum inspectable set of the shipped grammar is `status` (including `skipped`) / `data` / `error` / `connection` / `freshness` / `retention` (`packages/snapback-react/index.d.mts:151-157`). Putting `pendingWrites` in the minimum list fights that correction.

**Evidence:** `0254:497-517`; `index.d.mts:151-157`; `0238:264-274` (illustrative `diagnostic`, no `pendingWrites`).

**Disposition:** Keep `pendingWrites` only in the proposed-addition paragraph.

### 8. DETAIL, IN-DELTA — D3 "unique-index fill" is an unnamed predicate

**Target:** D3 (`367-374`).

**Defect:** The proposed LLP 0065 relaxation is honest that today's rule is "explicitly named `listIndex`, never inferred" (`0065:235-239`) and that any fill is this RFC's amendment, scoped to declaration lowering. "Unique-index fill" does not say whether a single owner-leading unique index may supply `listIndex`, whether `.data(...)` also emits `defineOwnedUniqueLookup`, or both. Unique lookup and list order are different helpers in 0065 (`0065:254-258`).

**Evidence:** `0254:367-374`; `0065:235-239`, `254-258`.

**Disposition:** If the Spec wants the relaxation, state the fill predicate (cardinality, owner-leading, list vs lookup) in the dated 0065 amendment. Until then the verbatim named-`listIndex` rule stands.

### 9. DETAIL, IN-DELTA — D9's clock has no missed-disposition backstop

**Target:** D9 (`628-633`); D10 (`715-726`); contrast LLP 0252 D7 (`0252:752-765`).

**Defect:** D9 now has its own clock (first qualified tiny Experimental publication after Phase 4; earlier of three complete rounds or 90 days; dated author amendment extends) and disposes through D10's five outcomes. D7 additionally freezes the experimental profile and files a backstop ticket if the clock ends with no recorded disposition. D10 says only that after D9 "an author decision chooses one of" the five. `continue` is an explicit outcome, which is fine; a missing ruling is not.

**Evidence:** `0254:628-633`, `715-726`; `0252:752-765`.

**Disposition:** Phase 0 / the evaluation Plan name the no-ruling behavior (freeze Experimental, no default-doorway change, ticket) without borrowing D7's four dispositions.

## Implementer-probe result

**(a) v1 capability lattice for a generated operation — DETERMINATE.**

- Axes: prediction ∈ {generated exact shared prediction, none} × custody ∈ {queue-eligible durable custody, online-only}.
- Settlement is obligatory for every accepted intent (LLP 0155 P4 / LLP 0218). It is not a third toggle.
- All four cells are admitted:
  - generated × queue-eligible — full local-first path (predict, queue, settle);
  - none × queue-eligible — queue under 0218 `withheld` or `unavailable`; settle identically; no optimistic paint;
  - generated × online-only — predict; settle in the foreground attempt or reject;
  - none × online-only — no predict; settle in the foreground attempt or reject.
- Declaration: both facts are generated, not authored. Prediction is derived from the operation IR (Phase 3). Custody defaults to queue-eligible; online-only is a generated or data-surface-profile-default exception with a stable declared reason in the artifact. Operation-declared custody enters the shipped 0218 contract only via a named amendment or the existing canonical owner (same discipline as D6 `pendingWrites`). Prediction failure alone is not a function escape.

**(b) First D9 comparison — DETERMINATE.**

- Clock: D9's own, not D7's. Starts at the first qualified publication of the tiny Experimental surface after Phase 4. Ends at the earlier of three complete rounds or 90 days; dated author amendment extends. Disposes through D10's five outcomes (promote / continue / revise / fold / withdraw), not D7's four.
- Normative first cell table:
  - tiny data surface, function profile P = `snapback-explicit-v1`, workloads Todo and day-two from that Todo app — treatment;
  - explicit data path, same P, same two workloads — named causal control;
  - pinned InstantDB, Todo only — external calibration, excluded from the causal decision.
- Chat is not in this table (dated Plan amendment after OQ8 membership-read admission). Familiar-profile cells are a later, separately preregistered 2×2. Phase 1's Todo checkpoint is not this experiment.

## Direction assessment

Retained. Familiarity and smallness are different levers; isolating a four-concept generated data path on the existing Snapback runtime, with InstantDB as calibration rather than a promotion control, is the right experiment. r3 does not reopen a third profile, raw client writes, or a silently expanded 0253 adapter.

## Self-attestation

I worked only from this capsule. I did not read, list, or search paths outside it; I did not use the network or web search. I listed `llp/reviews/` only to confirm that no `llp/reviews/0253*` or `llp/reviews/0254*` file exists; I did not read any review file. I did not read r2 or any earlier-round review (r2 is not in the capsule); delta honesty is the presence of the orchestrator's fourteen items, not a byte-diff. I did not attempt to infer other reviewers' views.

Harness-injected context I did not request: workspace `Agents.md`, user rules, the session skill catalog, a failed Linear MCP notice, and standard system reminders. I did not follow those into any file outside this tree.

VERDICT: READY
