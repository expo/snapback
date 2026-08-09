# Review artifact — LLP 0207, GPT family

## Round 1 — 2026-08-09

**Provenance.** Reviewer: GPT family via `codex exec`, model `gpt-5.6-sol`,
reasoning effort xhigh, read-only sandbox, working directory confined to
the review capsule. Orchestrated by the super-refine loop recorded in
`0207-agent-efficiency-round-two.run.md`. Target revision (b), git blob
`515f01e06e537f2903b1cb492ab7e13175e3275f`. Capsule aggregate sha256
prefix `2b34699ff0f5ac96`; instructions sha256 prefix `899942fdd75f78fb`.
Blindness: structural (capsule excludes all 0207 review artifacts; the
Claude-family review had not been written into the capsule and the codex
process had no repository access). Verdict binds to the capsule hash
above. Body below is verbatim from the agent's final message.

---

## Leverage ranking

1. **S1 — MERGE and narrow.** This has the best leverage-to-effort ratio because LLP 0146 already supplies bounded suggestion machinery and LLP 0194 supplies the symbol authority. Land codegen, generated-binding, and native-CLI enrichment under LLP 0146 D7, using LLP 0194 identities and signatures. Defer any TypeScript language-service plugin until a probe proves that ordinary compiler diagnostics cannot be enriched more cheaply. The evidence is weaker than claimed: the three `defineRelationalQuery` misses were failures to discover a symbol, not observed near-name failures, so S1 should begin as a measured extension rather than a broad rollout.

2. **S3 — MERGE a narrow core; CUT the generic dry-run half.** Aggregating independent authoring checks could directly reduce W5 actions and edit cycles, and Run 5 at least establishes action multiplicity. It should become another phase of LLP 0146 D2's existing `snapback verify`, not a new `snapback check` verifier. Collect all independently knowable static diagnostics in one result, but do not promise every violation or universal dry-run behavior. The capsule contains no causal evidence that first-error validation produced a material share of the 131 calls, so expansion should depend on before/after semantic-action measurements.

3. **S2 — MERGE the substrate; DEFER `whatsnew`.** Rapid publication makes version skew plausible, but the capsule contains no retained stale-symbol incident demonstrating its cost. Add explicit lifecycle metadata and exact tombstones to LLP 0194's registry/publication pipeline now, while history is short. Defer the standalone command and broad signature-history work until the stale-knowledge probe shows measurable recovery benefit. Registry diffs alone can reliably identify additions and removals, but not renames or deprecations.

4. **S4 — MERGE and measure before expanding.** A compact state summary may be cheap, but no supplied benchmark evidence attributes meaningful cost to compaction, handoff, or resumed-checkout reorientation. Fold the fields into LLP 0203's canonical `snapback agent setup` or an existing status projection rather than minting another verb. Keep it only if W5 traces show repeated rediscovery of those facts.

5. **S5 — DEFER.** Deterministic replay would have high theoretical value, but its cost, privacy exposure, and correctness requirements are much larger than the Plan acknowledges. The available complete documents attribute the named bisections mainly to misleading or incomplete diagnostics, not missing replay state; the cited diaries and raw run data are absent, so the stronger reconstruction claim cannot be verified. Any eventual implementation belongs with LLP 0156, whose body is also excluded from this capsule.

6. **S6 — CUT from this Plan.** It does not directly improve authoring action economy, and `SNAPBACK_*` frequency telemetry observes the refusal-reachable population rather than the Plan's claimed no-refusal layer. Frequencies also cannot establish whether a remediation worked or what costly recovery followed. A manual feedback link can be folded into LLP 0193's measurement loop, but telemetry transport should wait for a demonstrated question it can answer.

## New ideas

1. **Add a failure-to-recovery trace to W1/W5 first.** For every costly episode, record the first failed action, carrier class (`SNAPBACK_*`, compiler/codegen diagnostic, bare not-found, silent discovery miss), semantic actions until recovery, and recovery outcome. This targets the Plan's current inability to distinguish vocabulary, fail-fast validation, reorientation, and reproduction costs. Rough cost: small—a run-record schema and post-run annotation, with no runtime telemetry required.

2. **Build one registry-backed authoring diagnostic pass.** As part of `snapback verify`, collect TypeScript/compiler and codegen unknown-symbol diagnostics through their structured APIs, batch them, and join them to LLP 0194 symbols, aliases, lifecycle tombstones, signatures, and guide anchors. This merges the useful parts of S1, S2, and S3 into one existing proof action and targets hallucinated APIs, stale names, and serialized correction cycles. Rough cost: medium.

3. **Use authored lifecycle tombstones rather than inferred renames.** A symbol change records `replaces`, `removedIn`, and replacement identity at the authority where the change is made; publication generates diagnostics and release diffs from those facts. This targets stale model knowledge without heuristic rename inference. Rough cost: small to medium, owned by LLP 0194 and the publication pipeline.

4. **Ship a sanitized evidence bundle before replay.** Extend LLP 0156 with a local, identity-bound bundle containing the diagnostic, closure/build IDs, redacted request shape, principal class, readiness facts, and relevant bounded logs. It targets expensive reconstruction and bug reporting without claiming that a state digest can recreate execution. Rough cost: medium; add replay only for operation classes later proven deterministic and safely capturable.

## Concerns

1. **MATERIAL — The portfolio is selected before its causal evidence exists.** The Plan commits six mechanisms and sequences S1/S2 first even though Run 5 explicitly lacks a causal phase decomposition and the cited diaries and benchmark data are excluded. Several premises—first-error multiplicity, mid-session reorientation, and missing reproduction state—are asserted rather than established. W1/W5 should first classify recovery costs, then commission at most the top two or three mechanisms.

2. **MATERIAL — S1's primary evidence does not demonstrate S1's trigger.** The three arms hand-rolled an existing capability because retrieval vocabulary missed it; they did not encounter an unknown-symbol diagnostic that a nearest-name suggestion could repair. S1 may still be worthwhile because its substrate is cheap, but the current Plan incorrectly treats P6 discovery evidence as proof of authoring-diagnostic leverage.

3. **MATERIAL — S2 cannot derive its stated ledger from registry diffs.** Successive snapshots can show that `X` disappeared and `Y` appeared, but cannot establish that `X` was renamed to `Y`, that a removal was intentional, or that a signature change is behavior-preserving. Those claims require stable cross-version identities or authored lifecycle metadata. Without that authority, the generated ledger risks giving confidently wrong migrations.

4. **MATERIAL — S3 contradicts its "no new verifier" boundary and overpromises feasibility.** `snapback check` is functionally a second verifier beside `snapback verify`. "Every violation" is undefined in the presence of cascading compiler errors, runtime state, and checks that depend on earlier successful generation. Universal `--dry-run` for mutating verbs is substantially harder and potentially misleading because preflight cannot generally predict authorization, concurrency, or state-dependent outcomes without executing them. The safe, coherent scope is aggregation of existing side-effect-free checks under the existing verifier.

5. **MATERIAL — S5's receipt is insufficient to support its replay guarantee.** Operation, inputs, closure version, and a state digest do not reconstruct state. Deterministic replay may also require the exact executable artifact, data snapshot, principal and capabilities, environment, time, randomness, queues, and external-service responses. Capturing enough of those facts creates the privacy and retention design that OQ3 leaves unresolved. The Plan must either define a bounded replayability matrix or reduce the commitment to an evidence bundle.

6. **MATERIAL — S6 measures the wrong population.** Opt-in `SNAPBACK_*` frequency telemetry covers failures that did reach a Snapback diagnostic, contradicting the Plan's no-refusal scope. Frequency without denominator, recovery outcome, or action trace cannot feed LLP 0193's one-attempt grading loop. The feedback verb and telemetry also have different value, consent, transport, and ownership profiles and should not be one workstream.

7. **MATERIAL — Outcomes do not make the six workstreams independently falsifiable.** S5 and S6 have no outcome at all; S3 and S4 share a generic tool-call reduction that cannot attribute benefit; zero hand-rolled implementations may result from the already-shipped W2/P6 retrieval work; and "resolves or files evidence" is not a measurable recovery criterion. Each retained mechanism needs a baseline, a dedicated probe, and its own pass/fail outcome.

8. **MATERIAL — The ownership boundary is rhetorical rather than operational.** "This Plan owns failures that never reach a refusal" does not align with its contents: S1 extends LLP 0146, S2 changes LLP 0194, S3 reimplements LLP 0146 D2 orchestration, S4 overlaps LLP 0203 setup, S5 extends LLP 0156, and S6 feeds LLP 0193. Several workstreams also create or modify refusals. The document should become a sequencing/measurement plan whose artifacts land under those owners, or clearly identify the genuinely new artifact it owns.

9. **minor — S4 can emit stale evidence as current context.** "Last verify outcome" and readiness facts need current-state identity, timestamp, and explicit stale/absent states; otherwise the context pack can violate P3's "green means evidence" rule.

10. **minor — The alias join assumed by S1 is unspecified.** LLP 0194 defines symbol identities and signatures, while the supplied P6 aliases live primarily in capability/Rosetta records. The Plan should identify the generated identity join rather than implying the symbol registry already contains that metadata.

## Verdict

NOT READY

---

## Round 2 (delta round) — 2026-08-09

**Provenance.** Reviewer: GPT family via `codex exec`, model `gpt-5.6-sol`,
reasoning effort xhigh, read-only sandbox, capsule-confined; blind to all
review artifacts. Target revision (c), git blob
`eaa259717e561bd73649def0094f421d77d15cb4`. Capsule aggregate sha256
prefix `570e050685333164`; instructions sha256 prefix `2a780499271e6683`
(delta-round contract: IN-DELTA vs PRE-EXISTING classification required).
Verdict binds to the capsule hash above. Body below is verbatim from the
agent's final message.

---

## Assessment

Revision (c) is substantially stronger: it corrects the causal overclaims, sensibly cuts deterministic replay and universal dry-run, drops unhelpful telemetry, and routes mechanisms toward existing owners. However, the plan is not ready: its conversion inventory crosses into LLP 0193's existing scope, its commissioning gates remain subjective, and P1b commits immediately to a typecheck mechanism the document has not made feasible.

No concern below is PRE-EXISTING. The absent diaries and benchmark data prevent independent verification of transcript-level claims such as "no wrong name was ever guessed." The truncated LLP 0146, 0156, and 0041 excerpts also limit confidence in the P2b, evidence-bundle, and publication-pipeline ownership handoffs.

## Concerns

1. **MATERIAL — IN-DELTA: P1a conflates coded-but-undocumented client errors with uncoded exits.** LLP 0202 deliberately distinguishes "138 undocumented client-raised codes" from "uncoded bare throws," while LLP 0193 already inventories production `SNAPBACK_*` identifiers, unregistered emissions, emitting sites, and agent-triggerability. The target nevertheless says none of these can enter LLP 0193 grading and uses all 138 codes as part of an "uncoded-exit inventory." That creates overlapping ownership and a false zero-open baseline: an existing coded client error needs registration, carrier, typing, or remediation work—not a newly minted code. P1a must partition the inventory into already-coded failures owned by 0193, genuinely uncoded exits owned by this conversion program, type-contract defects such as `unknown`, and native prose failures requiring P7 conversion.

2. **MATERIAL — IN-DELTA: the supposedly pre-registered commissioning gates are not operational decision rules.** P0 selects "costly episodes" without defining costly or recording an opportunity denominator; P2a fires on any wrong guess in a deliberately stale/seeded probe; P2b uses undefined "material cost"; and P2c uses undefined "repeated rediscovery." The outcome then promises a "pass/fail delta" without a threshold, repetition count, comparator, or minimum evidence. This permits every commissioning decision to be made post hoc and lets a synthetic probe designed to induce stale guesses commission a product-wide mechanism without establishing representative session cost. Before measurement, each lane needs a named cost measure, denominator, recurrence/sample rule, commissioning threshold, and improvement/retirement criterion. The synthetic probe can prove that a carrier occurs, but should not by itself prove that the mechanism is worth commissioning. The `whatsnew` deferral is similarly circular: P0 cannot observe recovery *via* a projection that does not exist; it can only observe a stale-change episode whose missing fact such a projection might supply.

3. **MATERIAL — IN-DELTA: P1b's archival argument does not establish the typed-tombstone mechanism it commissions immediately.** Recording lifecycle facts at the change site and refusing undeclared removals is timing-critical and well justified. It does not follow that codegen should immediately retain every old name as a typecheck-failing tombstone. In TypeScript, `@deprecated` documentation is advisory: it neither makes ordinary `tsc` fail nor guarantees that the migration text appears in the diagnostic. Keeping an old export with a valid type may instead let stale code continue compiling; making it deliberately poisonous requires a concrete type-level or compiler carrier and proof across each symbol shape. The plan also lacks a tombstone lifetime/name-reuse policy. Split P1b: commission authored lifecycle facts and the removal gate now, then commission the generated tombstone projection only after a spike demonstrates the promised diagnostic and defines closure applicability and retention.

4. **minor — IN-DELTA: proposed owner handoffs are described as settled decisions before the receiving documents settle them.** P2c calls `snapback agent setup` canonical even though LLP 0203 is Draft and its OQ1 explicitly leaves that choice open. Likewise, LLP 0193 Phase 4 currently specifies post-run grading, not a feedback intake verb, while this plan's OQ4 still asks who owns that verb. These should be conditional amendment proposals, with fallback disposition if the owner declines, rather than completed donations.

5. **minor — IN-DELTA: P1a introduces the landing gate that the Summary says no mechanism will mint.** Refusing every new uncoded authoring-layer exit and running "conversion gates" in affected-scope proofs requires a new enforcement surface unless this is explicitly an extension of LLP 0193's drift gate. Name that existing gate and define the syntactic exit sites it can soundly cover, or acknowledge and own the new gate; the current universal wording is both contradictory and insufficiently scoped.

## Verdict

NOT READY

---

## Round 3 (delta round) — 2026-08-09

**Provenance.** Reviewer: GPT family via `codex exec`, model `gpt-5.6-sol`,
reasoning effort xhigh, read-only sandbox, capsule-confined; blind to all
review artifacts. Target revision (d), git blob
`6d331b94cf02a4f8f7ae7ff9a459a03da31174cb`. Capsule aggregate sha256
prefix `6a13ce1cd3bd00bf`; instructions sha256 prefix `b42c9e0971a74876`
(delta-round contract: IN-DELTA vs PRE-EXISTING classification required).
Verdict binds to the capsule hash above. Body below is verbatim from the
agent's final message.

---

## Assessment

Revision (d) improves ownership and gate structure, but material coherence and completeness gaps remain. Confidence is limited where the capsule omits benchmark data, diaries, LLP 0041's qualification-pipeline body, LLP 0146 D2, and most of LLP 0156.

## Concerns

1. **MATERIAL — IN-DELTA.** P1a's partition is not exhaustive against LLP 0202. The audit also identifies uncoded Swift client-originated errors and verify receipts carrying raw Node codes such as `ENOENT`; P1a neither includes nor explicitly routes those classes while claiming to enumerate the genuinely uncoded authoring-layer exits. Moreover, LLP 0202 supplies a numeric baseline only for the 20 codegen throws, not for the other included classes, so Outcome 2's "LLP 0202 counts" cannot establish the claimed denominator. A zero-open ledger could therefore pass while relevant exits were never inventoried. The plan must either establish a complete per-class enumeration method and baseline or narrow the completeness claim and route every excluded class to a named owner.

2. **MATERIAL — IN-DELTA.** The P2a commissioning gate still conflates synthetic occurrence with demonstrated demand. An intentionally stale or competitor-primed probe can prove that an unserved presentation is constructible, but "records why" it represents expected sessions is not a falsifiable representativeness test. P0.3's cost and recurrence registration does not solve this if the denominator itself is induced. The same ambiguity lets the synthetic stale lane trigger the deferred `whatsnew` projection. Synthetic probes should remain presentation/carrier tests; commissioning needs either a naturalistic costly trace or a preregistered, falsifiable external-validity criterion distinct from the constructed probe result.

3. **MATERIAL — IN-DELTA.** P1b's spike policy and measurable outcome contradict each other. The program leaves error-versus-warning behavior open per lifecycle kind and commissions the projection only if the spike proves a diagnostic carrier, while Outcome 3 unconditionally requires every tombstoned-symbol use to fail typecheck. A warning does not satisfy that outcome, and a negative spike leaves no specified outcome or alternate carrier. The plan needs explicit positive and negative spike branches and per-kind acceptance criteria consistent with the eventual severity decision.

4. **MATERIAL — IN-DELTA.** P2c's conditional handoff does not cover LLP 0203 OQ1's actual alternative. OQ1 may reject a canonical onboarding verb and keep funnels pointed at the guide; it does not necessarily canonicalize some other verb. If P2c's evidence gate fires under that ruling, "whichever verb OQ1 canonicalizes" supplies no landing target or declined fallback. The plan must name the owner-controlled fallback surface or define non-commissioning under the no-verb ruling.

5. **MATERIAL — PRE-EXISTING.** P2a assigns one authority shape to incompatible surfaces. LLP 0194's registry covers declaration-derived package symbols, whereas LLP 0203 locates native-operation intent metadata in the control catalog and LLP 0146 D7's shipped candidates come from the served manifest. An LLP 0194 identity/signature plus Rosetta/capability alias join cannot soundly supply `controls describe <unknown>` candidates. P2a must specify authoritative per-surface joins—including the control catalog/served manifest for native operations—to avoid transcription drift and preserve P1.

## Verdict

NOT READY

---

## Round 4 (delta round, author-authorized extension) — 2026-08-09

**Provenance.** Reviewer: GPT family via `codex exec`, model `gpt-5.6-sol`,
reasoning effort xhigh, read-only sandbox, capsule-confined; blind to all
review artifacts. Target revision (e), git blob
`dfcffa696941e110596c08790abd885f54a04576`. Capsule aggregate sha256
prefix `bdcd53609c3873d2`; instructions sha256 prefix `6118a56e253983a7`
(delta-round contract: IN-DELTA vs PRE-EXISTING classification required).
Verdict binds to the capsule hash above. Body below is verbatim from the
agent's final message.

---

## Assessment

Revision (e) improves partitioning and ownership, but four unresolved material concerns remain. The absent diaries and benchmark data prevent independent validation of empirical claims; the concerns below do not depend on them. The truncated LLP 0146/0156 excerpts limit confidence about those proposal boundaries, so no concern is inferred there.

## Concerns

1. **MATERIAL — IN-DELTA:** P1a calls Swift errors in scope, then permits the entire arm to be closed as a "deferral" because Swift is not consumable out of checkout. That distribution defect neither prevents source enumeration nor makes individual failures unreachable/out of scope. Because Outcome 2 counts every "classified" entry as closed, the plan can reach zero open entries while leaving a known failure class uncoded and outside the drift gate. Swift exits need individual conversion/classification; any whole-arm deferral must remain open under an owner and trigger rather than satisfy the outcome.

2. **MATERIAL — IN-DELTA:** P2a assigns the wrong authority to its generated-binding surface. LLP 0194's registry is derived from published package declarations and runtime exports; it does not enumerate application-specific schema, function, codegen-export, or generated-binding names. Consequently it cannot authoritatively supply candidates for the codegen and generated-binding diagnostics P2a targets. Those candidates need the applicable app descriptor/codegen manifest or another explicitly owned per-application authority; expanding LLP 0194 would itself require an owner-approved scope change not specified here.

3. **MATERIAL — IN-DELTA:** The new external-validity alternative leaves the P2a gate bypassable. P0.2 says synthetic probes establish only carrier behavior and that demand must come from naturalistic evidence, but P2a can instead commission from an undefined "external-validity criterion" adjudicated as a reviewable claim. Pre-registration does not make an unconstrained claim empirical or falsifiable. The alternative must specify admissible external observations, denominator/sample rule, and threshold—or be removed—so seeded probes alone cannot commission the mechanism.

4. **MATERIAL — PRE-EXISTING:** P1b's authored lifecycle facts are timing-critical, but the typed-tombstone projection is not. The document acknowledges no verified stale-name episode and says the lifecycle decision rests on preserving otherwise-unrecoverable facts; nevertheless, a technical feasibility spike alone commissions the consumer projection, including retention and name-reuse consequences. That spike tests whether the carrier works, not whether agents need it. Only lifecycle metadata and undeclared-removal enforcement are justified for immediate commissioning; the projection needs a demand gate comparable to the other mechanism extensions.

## Verdict

NOT READY

---

## Round 5 (delta round, final authorized round) — 2026-08-09

**Provenance.** Reviewer: GPT family via `codex exec`, model `gpt-5.6-sol`,
reasoning effort xhigh, read-only sandbox, capsule-confined; blind to all
review artifacts. Target revision (f), git blob
`93765d32dc18af084dad560c575577db7ff81e35`. Capsule aggregate sha256
prefix `fa77ad56951cbc58`; instructions sha256 prefix `7ef2db3e76eee9e8`
(delta-round contract: IN-DELTA vs PRE-EXISTING classification required).
Verdict binds to the capsule hash above. Body below is verbatim from the
agent's final message.

---

## Assessment

Revision (f) resolves the prior material issues: Swift exits cannot disappear behind arm-level deferral, candidate authorities are correctly separated, synthetic evidence cannot commission P2a, and tombstones require both feasibility and observed demand. The excluded benchmark data prevents independent verification of empirical claims, but future naturalistic traces gate the contingent mechanisms, so this does not undermine the plan. No material concern remains.

## Concerns

1. **minor — IN-DELTA:** P2a's new naturalistic-evidence clause is mechanism-wide, while P2a spans package symbols, app-derived names, and native operations. Clarify whether an episode commissions only its matching surface adapter or the entire extension. P0 gate registration could resolve this, but Outcome 4 currently treats P2a as a single decision.

2. **minor — IN-DELTA:** The tombstone demand clause says the same trace un-defers a standalone `whatsnew` projection, but that projection has no definition, owner, or outcome in the capsule. Clarify that the trace merely reopens a named owner's proposal rather than commissioning another mechanism here.

## Verdict

READY
