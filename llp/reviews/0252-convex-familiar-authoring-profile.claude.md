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
