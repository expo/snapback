# Claude review — LLP 0252

## Round 1 — 2026-08-12

- **Runtime:** fresh Claude Fable 5 general-purpose agent (not the
  orchestrating/revising session), capsule-only instructions, web disabled;
  201,738 tokens, 26 tool uses, ~649 s. Claude family launch 1.
- **Capsule:** base `d87d8d9a9cb0f35208c889784991ce40b2fcfe27`, inventory
  SHA-256 `478e66c671be06b2f0c1e89c66d22785ce6708b31b64193d1c734667eb5c1263`,
  instruction SHA-256
  `b8ab949dbb24d1a865631bc2a7ed0d7f7130b99bd54dec1f7864b2eefb7662cc`.
- **Target under review:** r1 SHA-256
  `01f35fad3586091e09b5d2b9b1dd0911064f28902b82915482eff9e110552dc6`
  (40,369 bytes), Status: Review.
- **Lens:** standard readiness review plus the author-directed co-author
  direction assessment.
- **Verdict:** READY (0 MATERIAL, 11 DETAIL, all altitude-dispositioned).
  Direction retained; no DIRECTION-DISSENT.

The complete response follows verbatim.

---

I have now read the target completely and verified its claims against the corpus (LLP 0198, 0236, 0225, 0199, 0203, 0238, 0245, 0246, 0247, 0249, 0237, 0241, 0197, 0130, 0119, 0117, 0127, 0074, plus spot-checks of 0004/0108). Here is my review.

---

# Review — LLP 0252: Convex-familiar authoring profile (round 1, Claude-family reviewer)

Target revision: SHA-256 `01f35fad3586091e09b5d2b9b1dd0911064f28902b82915482eff9e110552dc6`, 40,369 bytes — verified byte count and digest in the capsule before reading.

## Direction assessment

**Chosen direction: the RFC's direction — a bounded, parallel, Convex-familiar authoring profile lowering into the one canonical pipeline, with a measured comparison period and a hard stop rule.** No DIRECTION-DISSENT. I re-opened the question against the corpus rather than accepting the RFC's framing, and the evidence keeps landing in the same place:

1. **The dominant measured term is prior orientation, and every other lever on it has already been pulled hard.** The run 2→5 series (LLP 0198 §I.1–I.5) shows defect-shaped loops driven to zero and absolute Snapback numbers improving monotonically, while the ratio persists at ~1.8–2.2x because "Convex lanes read nothing; Snapback lanes still read the guide" — diary 0069's verdict, adopted by 0198 as measurement posture. Scaffold, skill, guide, and template levers all produced real gains without closing the orientation term. The one lever on that term the corpus has never tested is the grammar itself, and LLP 0203 P6 (vocabulary is API surface) is the corpus's own principle predicting it matters. The cross-model synthesis (LLP 0236) makes the friction convergent, not one agent's taste: agents stumble on the novel dialect, the query-kind split, the lifecycle names, and the concept count — not on the semantics underneath.

2. **The alternatives decompose the way the RFC says they do.** *Restart* is settled against by two accepted Decisions (LLP 0199 §Decision; LLP 0225 §Decision) whose reasoning the RFC quotes accurately. *Evolve-in-place* destroys the control lane and forces an irreversible rename of the canonical surface on unmeasured evidence — exactly what LLP 0189's claim discipline exists to prevent; note also that the accepted 0245–0249 wave *is* the evolve-in-place lane, already in flight, and the parallel profile lets that lane serve as a live control rather than being contaminated. *Guide/skills-only* is not refuted outright (0198 P1/P2 are unfinished, so "insufficient" is a forecast), but the record supports the forecast: three releases of aggressive knowledge-placement improvement moved absolute cost, not the ratio, and the comparator now actively productizes its own agent surface. *Actual compatibility* is correctly declined — the mismatches (public-by-export, universal reactivity claims, no offline settlement contract, erased result contracts) are product-shaped, and pretending they alias would breach the truth model the corpus's most consistent praise attaches to. *Immediate default* would swap a measured surface for an unmeasured one whose central risk — familiar names teaching wrong semantics — is documented convergent evidence (0236 P4) that an accepted RFC (0238) was built to fix.

3. **The strongest rival is the narrower experiment: server-only familiarity with canonical 0238 clients.** The server grammar (`defineSchema`/`v`/`query`/`mutation`/`ctx.db`/generated `api`) carries most of the prior, while the client aliases are exactly where the corpus's accepted decisions went the other way (0238 chose kind-explicit hooks on convergent evidence; the RFC concedes it is "reopening" 0238's conclusion). I considered dissenting toward server-only. I don't, for one reason: `useQuery(api.x.y)` is among the highest-prior sequences an agent holds, and a treatment that flows through familiar server code into unfamiliar hooks half-applies the intervention and muddies the readout. The RFC's compromise — typed-narrowed aliases whose types exclude the misleading states, OQ2 making alias value an explicit measurement, and the Risks commitment that a misleading alias "should be withdrawn rather than explained harder" — preserves the full treatment while keeping a component-level exit. That is the right shape, provided the exit is made operable (changes below).

4. **A portfolio caveat, not a dissent.** The scored record's largest *stable* deficit is operations (62–70 vs 96, LLP 0198 §I.3/I.5 term 4), and the corpus's most damning verdict ("If I had to ship this prototype this week, I would choose Convex") is at least as much an ops verdict as a syntax one. The RFC says the right thing (non-goal; P4 owns it; "familiar syntax cannot substitute for it"). Acceptance of this RFC should not be read as sequencing it ahead of the P4 decision — a familiar doorway into a building with no elevator is still a walk-up.

**What I would change to serve this direction** (all reflected in the ledger): (a) preregister component-level loop sub-attribution (server vocabulary / query-kind default / client aliases / package shape) in the Phase 0.4 matrix so the **Merge** disposition and alias withdrawal are evidence-backed rather than judged from aggregates; (b) make mid-period client-alias withdrawal a first-class action of the disposition machinery, not just a Risks sentence; (c) bind the Promote disposition explicitly to the second-family paired N≥3 series — the treatment effect is precisely a familiarity effect, i.e., a model-family property, the exact one-family-artifact hazard 0198 P0b exists for; (d) land a dated cross-reference amendment on LLP 0238 when the experimental entrypoint ships, not only at stop-rule time; (e) add LLP 0242/0248 to the analysis — the familiar profile's imperative `ctx.db` ordinary path leans directly on bounded plans and batch reads (0236's post-snapshot N+1 finding).

## Concern ledger

- **C1 (DETAIL — D1 / D8).** Identity rationale is imprecise in a way that could mislead implementers. D8 justifies rotation with "it still creates a new semantic/generation identity **because source custody changed**" — but under LLP 0241 D1, source custody is *evidence* identity, and keeping custody changes out of `semanticId` is 0241's central point. The correct mechanism is the one D1 states: profile version as a declared semantic-identity input (0246 D5's precedent). Additionally, 0246's "source-profile version" is the *language-custody* axis (`bounded-handler-typescript-v1`); the authoring profile is a new axis, so this RFC must itself declare `snapback-familiar-ts-v1`/`snapback-explicit-v1` a semantic-identity input rather than inheriting the property from 0246 by citation. The decision (conservative rotation; `normalizedContractId` as a non-authorizing witness) is sound; the wording needs repair.

- **C2 (DETAIL — D7).** The cross-family requirement ("at least one second model family runs the paired Snapback profiles at N≥3 before a cross-family default claim") is not explicitly bound to the **Promote** disposition. A Promote made on one family's evidence is exactly the one-family-artifact hazard LLP 0198 P0b names, and maximally so here since the treatment is a familiarity effect. One sentence binds it.

- **C3 (DETAIL — D7 stop rule).** The post-deadline freeze ("no new capabilities, no new default templates, no compatibility promotion") has no named enforcement mechanism. By the corpus's own principle (LLP 0203 P1/P8: a rule that is not a check does not exist), a dated backstop — e.g., an issues-filing check on the drift-backstop pattern, or capability-metadata gating keyed to the stop date — should land with Phase 3.

- **C4 (DETAIL — D7 / Phase 0.4).** The treatment bundles at least four distinct changes (server vocabulary; one query kind live-by-default; narrowed client aliases; umbrella package shape), and the minimum three-lane matrix cannot decompose them — yet **Merge** ("only measured wins move") presupposes component-level attribution. Preregister loop sub-attribution by profile component (extending 0198 P0.0(c)'s `defect`/`knowledge-gap` sub-attribution pattern) in the Phase 0.4 matrix.

- **C5 (DETAIL — D4).** Composition with LLP 0247 D2 is unspecified: 0247 gives protected reads while anonymous a *stable non-error* `authentication-required` blocked state; familiar `useQuery` exposes only `Result | undefined` plus error-boundary refusals. Whether auth-blocked renders as `undefined` (an "authority" state) or throws must be picked and gated; both readings are currently available. Relatedly, `Result | undefined` deliberately collapses four states — the ambiguity 0238 D6 refused for auth — which the RFC honestly discloses as the experiment's central question; no further action needed on that beyond C10.

- **C6 (DETAIL — D1 disposition 3 / D2 / Acceptance 3).** The 0245-backed "reviewed suggestion" disposition is broader than 0245 v1 supports: 0245 proposes result contracts and *addition-only* reads/writes, and explicitly never proposes `auth`, effects, secrets, capabilities, exposure, or retention. D2's "the adapter may accept a missing candidate field only long enough to produce a read-only LLP 0245 suggestion" reads as if any missing field can be suggestion-backed; for `auth`/effects/secrets/capabilities the only lawful disposition is refusal (which Acceptance 3's "or refuses" covers). State the per-field mapping so implementers don't wire disposition 3 where 0245 forbids it.

- **C7 (DETAIL — D2 / D5 / D7 score group 3).** "Escape hatch" semantics are ambiguous under the no-mixing rule. Disposition 4 routes "to the explicit profile," but per-app exclusivity means that route is whole-app migration; meanwhile score group 3 counts "explicit-profile escape hatches" as if intra-app escapes exist. Clarify that the familiar profile's Snapback-specific extension vocabulary (D5) is the intra-app escape, and whole-app migration is the route only for genuinely unsupported constructs — and measure the two separately, since a forced whole-app migration is a much steeper event than an extension call.

- **C8 (DETAIL — Motivation / D2 / D6).** The external-world Convex claims (agent plugins/skills/MCP/evals "verified against Convex's official documentation on 2026-08-12"; "modern Convex guidance" on validators; the D6 public-docs behavioral contrasts) cannot be verified from the capsule. They are load-bearing only for the *urgency* argument; the core case (orientation dominance, vocabulary priors) rests on internal runs and is corroborated by corpus diaries. They are properly dated; keep them refreshed under the 0198/0197 control-lane cadence as D7/Risks already promise.

- **C9 (DETAIL — Motivation / D3 citations).** Citation precision: `LLP 0198#the-remaining-gap-decomposed` does not match the actual heading anchor ("I.5 The remaining gap, decomposed"); `LLP 0127#move-1-contracts-reference-nothing-respells` slugs incorrectly for an em-dash heading; and D3 cites LLP 0074 — now **Shelved** — as the owner of the polling-is-never-proven-push rule. The rule's live carriers (LLP 0119's restatement, LLP 0073's pin, the root invariants) should be cited alongside or instead.

- **C10 (DETAIL — D4 / Status).** Amendment timing: during the experiment the corpus will hold accepted-0238 (whose conclusion, as this RFC itself characterizes it, is that an ambiguous direct-result query name should never be primary) beside accepted-0252 shipping familiar `useQuery` as the experimental entrypoint's primary hook. The Status section defers all amendments to the stop-rule disposition. A dated cross-reference note on 0238 should land when the entrypoint ships, so a reader of 0238 alone cannot draw the wrong conclusion about the familiar package.

- **C11 (DETAIL — Related / D2).** LLP 0242 (bounded children/aggregate/feed plans) and LLP 0248 (same-snapshot bounded batch reads) are absent from Related and from the design, yet the familiar profile's ordinary imperative `ctx.db` path is exactly where the corpus recorded the N+1 hazard (0236 post-snapshot: several host calls per feed card) and where Convex's own "N+1-ish reads" weakness was observed. The familiar lane's plain-CRUD and messaging economics depend on those owners; name the dependency.

No MATERIAL concerns. I specifically pressure-tested: the no-branch-below-normalization rule against the D3 profile default and D4 `queue: "never"` (both are adapter/client-level facts, canonical after lowering — coherent); ER-2/evidence boundaries (nothing weakened: liveness must be proved or refuse, `useMutation` resolves only validated authoritative results, retained/optimistic data never presented as current — consistent with 0074/0119/0155/0218/0238); LLP 0130 ER-3 (D3 correctly reserves the existing profile's classification to the author); the stop-rule arithmetic and clock definitions (consistent); Acceptance 1's equivalence-witness feasibility (bounded by "facts intended to be equal" plus the Phase 3 neutral outcome specification); and the D8 migration consequences for queued predecessor-generation work (truthfully deferred to 0241's fences and dispositions).

## Altitude dispositions

- **C1:** Reword D8's rationale to "profile version is a declared semantic-identity input (0246 precedent)" and state that declaration explicitly in D1 — implementation-phase drafting fix.
- **C2:** Add one sentence binding Promote to the second-family paired N≥3 series — drafting fix.
- **C3:** Name a dated enforcement (backstop check or capability-metadata gate) for the freeze; land with Phase 3.
- **C4:** Preregister component-level loop sub-attribution in the Phase 0.4 matrix; no decision in this document changes.
- **C5:** Spec-phase choice: pick undefined-vs-throw for `authentication-required` in familiar `useQuery`, gate it, and cross-reference 0247 D2.
- **C6:** Add the per-field disposition-3 eligibility table (returns, reads/writes-additions only) at Phase 0.2; refusal covers the rest.
- **C7:** Define "escape hatch" = D5 extension vocabulary intra-app; count whole-app migrations as a separate expressiveness metric.
- **C8:** Keep external Convex claims dated and refresh at Phase 0 under the existing control-lane cadence; no design change.
- **C9:** Fix the two anchors; add the live carriers of the polling rule beside the 0074 citation.
- **C10:** Land a dated cross-reference amendment on 0238 with the Phase 2 shipping change, per the repo's docs-with-code rule.
- **C11:** Add 0242/0248 to Related and one sentence in D2 noting the batch-read/bounded-plan dependency of the imperative path.

## Verdict

VERDICT: READY — bound to SHA-256 01f35fad3586091e09b5d2b9b1dd0911064f28902b82915482eff9e110552dc6

## Self-attestation

I read only paths under the capsule directory (`/private/tmp/claude-501/-Users-ccheever-projects-snapback/cacc6372-1db6-4066-a114-318f7e8b68f7/scratchpad/r1/capsule`): the review instructions, the target, and the following corpus documents in full or in targeted excerpts — LLPs 0198, 0236, 0199, 0203, 0238, 0245, 0246, 0241, 0237, 0247, 0249, 0197, 0130, 0119 (option space and findings), 0117/0127/0074/0225 (cited sections and headings), plus status-line checks on 0004 and 0108. All shell commands (`ls`, `shasum`, `wc`, `grep`) operated exclusively on capsule paths. I did not use the network, WebFetch, or WebSearch, and I did not modify, create, or delete any file. The revision under review was verified against the required SHA-256 and byte count before reading.

## Round 2 — 2026-08-12 (delta round + implementer probe)

- **Runtime:** fresh Claude Fable 5 general-purpose agent (not the
  orchestrating/revising session and not the round-1 reviewer), capsule-only
  instructions, web disabled; 122,925 tokens, 29 tool uses, ~560 s. Claude
  family launch 2.
- **Capsule:** base `d87d8d9a9cb0f35208c889784991ce40b2fcfe27` (round-1 clone
  with r2 overlay), inventory SHA-256
  `62197614b6afb32a05665f6ad12aed4e5656a8694fa084dc899b0ad0840901e2`,
  instruction SHA-256
  `ebfa37e6402f9c6577f77fc8f67231003e3b2b82ae865cb613c6f6d976401a72`.
- **Target under review:** r2 SHA-256
  `001ed2dca02e9eb36fc096f84a6c5adffcd7bd14e49e18f8c03f082f9bd47cd8`
  (48,812 bytes), Status: Review.
- **Lens:** delta round (IN-DELTA vs PRE-EXISTING classification) plus the
  bounded D2/D4 implementer probe.
- **Verdict:** READY (0 MATERIAL; 11 DETAIL — 7 IN-DELTA, 4 PRE-EXISTING —
  all altitude-dispositioned; no material underdetermination in the
  implementer probe).

The complete response follows verbatim.

---

All verification is complete. Here is my review.

---

## Concern ledger

**C1. [DETAIL / IN-DELTA / D7 "The freeze is a check, not prose" + Rollout Phase 3]** D7 assigns the stop-date enforcement backstop to Phase 3 ("Phase 3 lands a dated backstop on the existing drift-backstop pattern…"), but Rollout Phase 3's enumerated items (templates, migrations, qualification/clock start) do not include it. The named enforcement mechanism — a load-bearing r2 addition — has no home in the phase list it claims.

**C2. [DETAIL / IN-DELTA / D7 disposition-eligibility block]** The insufficient-evidence clause reads "permits only the freeze below plus Withdraw or a dated extension amendment — never Promote or Tier." The "only" excludes Merge, but the "never" list omits it, and "insufficient evidence" is not defined relative to Merge's own component-level gate. If the ablation lane plus sub-attribution have cleanly identified a winning component while overall rounds are incomplete, the block is ambiguous on whether Merge is eligible — precisely the kind of decision the preregistered block exists to pin.

**C3. [DETAIL / IN-DELTA / D3, final paragraph of the delivery-default section]** The polling-never-reported-as-proven-push rule cites three live carriers: LLP 0119, LLP 0073's search pin, and "the root invariants." The first two check out exactly (LLP 0119 pins the rule at multiple points, quoting LLP 0074's Refuse list; LLP 0073 reaffirms non-live search posture and `SNAPBACK_FUNCTION_NOT_LIVE`). The root explainer, however, states realtime propagation as a cross-cutting requirement but nowhere states the polling-not-reported-as-proven-push rule in invariant form that I could find. The third carrier is the weakest leg of an otherwise correct citation repair; point at a specific root section or drop it.

**C4. [DETAIL / PRE-EXISTING / D3 last paragraph; OQ3]** LLP 0130 ER-3 literally governs "the 1a pre-registration's acceptance" (one authored kind, split capability facts); this RFC's query model is the option-**1b** family (live by default, authored escape hatch). Invoking ER-3 as the owner of "promotion of the model" is conservative in effect — it keeps promotion the author's call, which is ER-3's spirit — but the 1a/1b scope mismatch should be named in the Phase 2 dated amendment to LLP 0130 that this RFC already obligates.

**C5. [DETAIL / IN-DELTA / D2 canonical key list]** The per-kind reach clarification covers two of three kinds: "a query declares reads only" and write-capable kinds add `writes`. Whether `action` is write-capable, declares `reads`, declares neither and relies on `effects`, or refuses both keys is unstated. The canonical definition presumably owns the answer, but the v1 function-object key list is this document's contract-bearing surface and should say one line.

**C6. [DETAIL / PRE-EXISTING / D2, D6]** The admitted v1 `ctx.db` surface (method set — get/insert/patch/replace/delete; builder grammar — order/take/first/unique/paginate; index-range predicate forms) is never enumerated. It is implicitly deferred to the Phase 0 construct inventory and the D6 four-state compatibility table ("query consumers" row), but nothing says the D6 table is the *normative* enumeration of the v1 subset rather than documentation of it.

**C7. [DETAIL / PRE-EXISTING / D4 `useQuery`]** Two D4 rules can collide at the mid-subscription authority-revocation edge: "loss of current authority" is enumerated as an `undefined` state, while "typed refusals… are never silently converted to `undefined`." A revocation both removes the authoritative result and may surface as a typed refusal on resubscribe. LLP 0247 D2's vocabulary (continuing reads take stable blocked *states*; one-shot refusals are typed *errors*) resolves it, but the alias document should pin which surface wins at that edge rather than leaving the reconciliation to inference across two documents.

**C8. [DETAIL / IN-DELTA / D4 diagnostic vs. companion alias]** The development-build routing diagnostic "names `useQueryState` whenever a blocked query renders as `undefined`," and Acceptance 5 requires that diagnostic — but D4 makes `useQueryState` optional ("a companion `useQueryState` alias **may** point to that same canonical hook"). As written, a conforming implementation could omit the alias while its mandatory diagnostic names a nonexistent API. Either make the alias mandatory in the familiar package or have the diagnostic name `useSnapbackLiveQuery`.

**C9. [DETAIL / IN-DELTA / D1 no-mixing enforcement; Acceptance 2]** D1 describes the profile brand as nominal/type-level ("familiar client aliases type-accept only familiar-branded references") plus a Phase 2 build gate; Acceptance 2 extends this to what reads as a runtime refusal ("the familiar aliases refuse references from an explicit-profile generation"). Whether the brand is carried as a runtime-checkable fact on generated refs (joining kind/authority/retention/delivery/queue in D4's fact list) or is compile-time-only is left implicit; the two sections imply different mechanisms.

**C10. [DETAIL / PRE-EXISTING / D7 stop rule]** "Three complete qualified comparison rounds covering all workload families" — "round" is never defined (presumably one full pass of the preregistered lane × workload matrix at preregistered N). Phase 0 item 4 preregisters the matrix but not the round definition; one line would make the stop rule's non-calendar bound mechanically checkable.

**C11. [DETAIL / IN-DELTA / D2 adapter rule vs. Acceptance 3]** Disposition 3 is now restricted to `returns` and "addition-only reach patches." Whether an entirely **absent** `reads` key is a refusal (missing required field) or a patch candidate (addition from empty) is determinable only by cross-reading Acceptance 3 ("Omission either produces an LLP 0245 patch or refuses"); D2's own adapter rule ("may accept a missing candidate field only long enough to produce a… suggestion") should state which fields the absent-key patch path covers.

Citation verification performed against the capsule corpus, for the record: LLP 0225#decision, 0199#decision, 0236 (summary, both section anchors, the 55/45 figure), 0198 (summary "roughly half the wall-clock and 45% of the tokens" ↔ "roughly twice the time and tokens"; I.5 anchor; P0.0(c); P0b at N≥3; P4 as the operations owner), 0203 P1/P6 anchors, 0117#option-space, 0127 Move 1 anchor, 0074 Status Shelved + "polling fallback must not be reported as proven push," 0119 option 1b and its carriage of the rule, 0073 non-live search pin, 0130 ER-3 text, 0247 D2 `authentication-required` stable blocked state, 0238 D4 `{data,status,freshness,diagnostic,refresh}` and the deprecated-ambiguous-name conclusion, 0245 D2/D3 (result contracts first; dependency suggestions only widen; stale-safe compare-and-write), 0246 D5 (source-profile version bound into semantic identity — the claimed precedent is real), 0241 D1/D3 (five identities; custody = evidence identity; semantic-identity change does **not** force incompatible reload — D8's fence-preservation claim is coherent with the closed reload classes), 0242/0248 (bounded composition, same-snapshot batch reads, N+1 provenance), 0249 (Node power confined to the isolated action profile), 0237 (bounded helper graph), 0197 (all nine claimed rule elements present), and `v.principal()` (exists in LLP 0004/0108 — not an invented validator). All check out except the "root invariants" leg noted in C3. All twelve enumerated delta items are present in the text as described.

## Implementer probe

**Contract A — familiar function-object validation (from D2).** The adapter accepts a module graph under `snapback/`, requires every operation export to be constructed by `query`/`mutation`/`action` from `./_generated/server`, and validates per object: `args` present (absent → refuse; not suggestion-eligible); `returns` present (absent → read-only LLP 0245 suggestion, activation refused until accepted source); `auth` present from the canonical authority vocabulary (absent → refuse, never suggested); `reads` required (query: reads only), `writes` required for write-capable kinds (incomplete → addition-only LLP 0245 patch or refusal before artifact replacement); `effects`/`secrets`/`capabilities`/`runtime` required when used, never inferred (used-but-undeclared → refuse); `delivery` legal only on `query`, default `"live"` frozen in the profile version, `"read"` the only opt-out, no `auto`; `handler` admitted as a bounded `.ts`/`.mts` graph under LLP 0237/0246. Every canonical field resolves to exactly one of the four dispositions; no silent unknowns. Output: `NormalizedApplicationDefinitionV1` + `normalizedContractId`, profile version recorded as a semantic-identity input, `api.<module>.<fn>` aliases over nominal profile-branded refs.

Underdeterminations logged: action-kind reach requirements (→ C5); absent-vs-incomplete `reads` disposition (→ C11); the admitted `ctx.db`/builder surface (→ C6); unknown-key handling (I inferred refusal from "no silent unknown," but D2 never says unknown keys take disposition 4 — folded into C6's normative-enumeration ask); `auth` value vocabulary (explicitly delegated to the authority owners — adequate, not logged as a concern).

**Contract B — `useQuery`/`useMutation` behavior (from D4).** `useQuery(FamiliarLiveRef<A,R>, args): R | undefined` — subscribes through the canonical machinery (no second cache/transport/outbox); returns `R` only while an authoritative current result exists; `undefined` for initial load, authority transition, unavailable current data, loss of current authority, and the LLP 0247 `authentication-required` stable blocked state; never retained/optimistic/queued data through this shape (types + runtime); typed refusals/errors throw to the documented error boundary, never `undefined`; dev builds emit the routing diagnostic when a blocked query renders `undefined`; only familiar-branded live-capable refs type-accepted. `useMutation(FamiliarMutationRef)` returns a callable that dispatches `queue: "never"`, resolves only with the validated authoritative result, rejects offline with a typed refusal before accepting custody, never resolves from queued intent, and carries the mismatch diagnostic routing queue-capable declarations to `useSnapbackMutationDispatch`/`useSnapbackMutationStatus`.

Underdeterminations logged: the revocation edge between the `undefined` state list and the never-converted-to-`undefined` rule (→ C7); the diagnostic naming an optional API (→ C8); conditional-query ("skip") support — Convex-prior agents will write it and the document neither admits nor refuses it; it is an inventory row for the D6 table, not a defective decision (folded into C6); resubscribe keying and error-boundary mechanics — determinable by inheritance from LLP 0238 D5 and the "projection over existing owners" rule, not logged.

No underdetermination found is material: each is either explicitly delegated to a named owner (authority vocabulary, reach syntax, read shapes), pinned by another section of this document (Acceptance 3, D6, Phase 0 inventory), or fixable by one declared line without changing any decision.

## Altitude dispositions

- **C1** — add the backstop as a Phase 3 (or Phase 4) rollout item; implementation-phase placement fix.
- **C2** — one sentence defining "insufficient evidence" and stating Merge's eligibility under its component gate at the stop date.
- **C3** — replace "the root invariants" with a specific root-section citation or drop the third carrier.
- **C4** — name the 1a/1b scope extension inside the already-obligated Phase 2 amendment to LLP 0130.
- **C5** — one line stating the action kind's reach-key requirements (or naming the canonical definition as the decider).
- **C6** — one line declaring the D6 table the normative enumeration of the v1 `ctx.db`/consumer subset, including the skip/conditional-query row.
- **C7** — Phase 2 pins the revocation edge using LLP 0247/0238 vocabulary; no decision changes.
- **C8** — make `useQueryState` mandatory in the familiar package or rename the diagnostic's target; one-line fix either way.
- **C9** — one line stating whether the profile brand is a runtime-carried ref fact or compile-time only; Acceptance 2 already implies the answer.
- **C10** — one line defining a comparison round; Phase 0 preregistration absorbs it.
- **C11** — one clause in D2 stating which absent keys are patch-candidates versus refusals; Acceptance 3 already implies the answer.

## Verdict

VERDICT: READY — bound to SHA-256 001ed2dca02e9eb36fc096f84a6c5adffcd7bd14e49e18f8c03f082f9bd47cd8

## Self-attestation

I read only paths under `/private/tmp/claude-501/-Users-ccheever-projects-snapback/cacc6372-1db6-4066-a114-318f7e8b68f7/scratchpad/r2-capsule` (the review instructions, the r2 target, and referenced LLPs under the capsule's `llp/` directory). I verified the target's byte count (48,812) and SHA-256 (`001ed2dca02e9eb36fc096f84a6c5adffcd7bd14e49e18f8c03f082f9bd47cd8`) before reading. I used no network access, no WebFetch/WebSearch, and no prior review of this document; I did not seek one. All shell commands were read-only (`ls`, `shasum`, `wc`, `grep`, `sed -n`) inside the capsule. I modified, created, and deleted no files. No deviations.
