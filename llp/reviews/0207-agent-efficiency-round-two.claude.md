# Review artifact — LLP 0207, Claude family

## Round 1 — 2026-08-09

**Provenance.** Reviewer: Claude family (fresh general-purpose subagent,
Fable 5, no session context; capsule-only inputs). Orchestrated by the
super-refine loop recorded in `0207-agent-efficiency-round-two.run.md`.
Target revision (b), git blob `515f01e06e537f2903b1cb492ab7e13175e3275f`.
Capsule aggregate sha256 prefix `2b34699ff0f5ac96`; instructions sha256
prefix `899942fdd75f78fb`. Blindness: structural (capsule excludes all
0207 review artifacts; none existed at launch); sandbox confinement to the
capsule directory is instruction-based and self-attested. Verdict binds to
the capsule hash above. Body below is verbatim.

---

## Leverage ranking

Ranked by expected leverage per effort against the stated goal (the LLP 0186 W1/W5 instrument), using only capsule evidence. Where the capsule cannot support a premise, that is said and priced in.

**1. S1 — Nearest-symbol repair on the authoring surface. KEEP, rescoped and merged with S2's consumer.** Highest leverage-per-effort because both substrates it needs already shipped and are verified in the capsule: the LLP 0146 D7 suggestion substrate (implementation record 2026-08-06) and the 847-symbol LLP 0194 registry (confirmed by LLP 0202's "already strong" list). Extending typed candidates to codegen unknown-export failures and `controls describe <unknown>` (whose bare bail is independently evidenced in the audit's P2 evidence) is a small delta on working machinery, and alias-aware routing is the genuinely novel part — plain edit distance at the typecheck layer is largely already provided by TypeScript's own "did you mean" ("Property 'useQuery' does not exist… did you mean 'useSnapbackQuery'"); the increment S1 uniquely adds there is the P6 alias/intent table, and the plan should say that. Two caveats priced into the ranking: (a) the flagship evidence cited for S1 does not actually belong to S1's failure class (Concern 1); (b) OQ1 rightly notes the typecheck layer may be out of reach — the codegen/CLI layer plus the tombstone mechanism in New ideas §1 is the shippable core. Rank it first, but let the stale-knowledge/wrong-guess probe lane (New ideas §3) confirm the frequency claim on the first cadence run.

**2. S2 — Version-skew ledger and `whatsnew`. SPLIT: keep the ledger generation now; defer the `whatsnew` verb; merge consumer 1 into S1.** The ledger-generation half is the best-timed item in the plan: diffing successive LLP 0194 registries at publication is nearly free, the argument "start now while the history is short" is sound and genuinely time-sensitive (a ledger begun at 0.1.20 has an unrecoverable hole), and it is pure P1 — generated at the authority, never transcribed. Its high-value consumer is exactly S1's unknown-name path ("X was renamed to Y in 0.1.12" ranked above fuzzy candidates), which is why S1 and S2 should run as one workstream, as the sequencing half-admits. The `whatsnew` verb, by contrast, rests on a premise the capsule undermines rather than supports (Concern 4): the "version in the model's head" population is essentially empty today, and the actual observed skew channel — published skill/guide/template drift — is already fenced (`check-rosetta.mjs`, `guide/published-closure.json`, the `since:`/`unreleased:` contract, all verified in 0186's amendment record). Defer the verb until the probe lane shows a real session recovering via it; the ledger loses nothing by waiting for its second consumer.

**3. S3 — Batch validation. KEEP the `check` half, gated on one measurement; DEFER `--dry-run`.** This is the only workstream aimed squarely at the W5 action-economy number, and complete-population diagnostics is a mechanism with strong priors (it is why compilers report all errors). But its evidence bullet is defective as written (Concern 2): the 131-vs-39 figure is borrowed to support a first-error-serialization claim that 0186's own W5 text forbids deriving from that run, and the capsule contains no observation that Snapback's validation actually stops at the first violation or that any lane paid N serialized fix cycles. The fix is cheap and already in the plan's toolbox: W5's semantic action facts can count validation-retry cycles in the next cadence run before the workstream is sized. If the count is material, ship `check`; the `--dry-run` half is a separate, larger contract (side-effect-free evaluation of every mutating verb) that should wait for the first half's evidence. Also state the `check`/`verify` boundary explicitly (Concern 5) — landing a second proof-shaped verb while the audit's verify-trust-gaps ticket is open is how the P5/consolidation posture gets violated by its own adherents.

**4. S4 — Session context pack. MERGE into LLP 0203's `snapback agent setup` (answer OQ5 as "fold").** The mechanism is sound and cheap, but the plan already cites the argument that decides its placement: 0203's consolidation posture and addition 4 make `agent setup` the canonical verb every funnel points at, and a second orientation verb is verb proliferation with a discovery cost of its own (an agent must now find *two* orientation commands). The mid-session-reorientation cost is asserted from post-compaction experience, not evidenced in the capsule — plausible, but not enough to justify a separate workstream when a `--status`/`--context` mode on the existing verb delivers the same content inside 0203's existing commitment. This is the clearest absorption candidate in the plan.

**5. S6 — Out-of-checkout feedback channel. SPLIT: absorb the `feedback` verb into LLP 0193 Phase 4; defer telemetry on OQ4.** The gap is real and audit-evidenced (LLP 0202 theme 5), and the verb is a day of work. But it has near-zero effect on the W1/W5 instrument this plan is measured by — it is an evidence-collection channel whose value scales with an external population that is currently tiny, and whose named consumer is LLP 0193 Phase 4's grading loop. A workstream whose output feeds another plan's loop belongs to that plan; the boundaries section is silent on this (Concern 8). The telemetry half is correctly author-gated and policy-heavy; nothing is lost by deferring it until the verb proves demand — which is what OQ4 itself proposes.

**6. S5 — Error receipts and replay. DEFER; narrow to a receipt/scene-capture spike.** Weakest on both axes. Evidence: the bisection-cost claim leans on diaries 0065–0069, which are not in the capsule; the evidence that *is* in the capsule points the other way — LLP 0193's r9 reconciliation routes all six of run 5's expensive moments to knowledge-shaped causes (templates, signatures, anchors), none to an irreproducible runtime failure, and the classic bisection exemplars (multi-JSON load, hashed field path) are fixed. Cost: highest in the plan, and the mechanism is underspecified to the point of infeasibility as written (Concern 3) — a state *digest* verifies state identity but cannot reconstruct state, so "one deterministic command" is unearned. The cheap, defensible core is capture-without-replay (New ideas §4). Being author-gated on OQ3 does not fix this, because OQ3 is about privacy posture, not reconstruction feasibility.

Net structure: the plan should ship **S1+S2(ledger) as one workstream, S3(check) gated on one measurement, and the S4 fold into 0203** — three concentrated efforts — with S5 narrowed to a spike and S6 donated to 0193. That matches the plan's own thesis better than six parallel lanes.

## New ideas

**1. Generated deprecation tombstones: make the TS bindings themselves the ledger carrier.** Mechanism: when the S2 registry diff records a rename/removal, codegen continues to emit the old name as a typed tombstone — `@deprecated` doc text "renamed to `Y` in 0.1.12; use `Y`", typed `never` (or a branded error type) so use fails typecheck *with the ledger entry in the diagnostic/hover*. Failure mode targeted: stale-name authoring at the exact layer OQ1 worries S1 cannot reach — no language-service plugin, no new lookup verb; the generated bindings are the carrier, which is the plan's own errors-as-docs thesis applied to the layer TypeScript owns. This substantially answers OQ1 and would let the `whatsnew` verb stay deferred indefinitely. Cost: small — a codegen emission rule driven by the ledger, plus one eval case per tombstone.

**2. Enumerate and convert the no-refusal population — the 0193 move applied to this plan's own thesis.** The plan's identity is "failures that never reach a refusal," yet unlike 0193 it never enumerates that population; S1–S5 each carve off one guessed slice. The audit already counted the raw material: 20 uncoded codegen throws, 138 undocumented client-raised codes plus bare throws, prose-with-exit-1 native failures. Mechanism: one bounded audit lane over authoring-layer failure exits (codegen, client arms, native CLI, typecheck seams), each exit either minting a `SNAPBACK_*` code or classified unreachable — i.e., *convert no-refusal failures into refusals*, after which 0193's existing ratchet, grading, and D7 carrier do the rest with zero new machinery. This is arguably the cheapest and most complete attack on the layer, it rides an existing ticket (`uncoded-throws-and-untyped-client-errors`), and it gives the plan the clean boundary statement it currently lacks: 0193 owns refusal quality; **0207 owns making failures become refusals**. Cost: moderate, mostly mechanical, parallelizable by subsystem.

**3. Probe lane first, as the evidence gate for S1/S2 sizing.** Outcome 3 already commissions a stale-knowledge probe lane; invert the order — build it in week one (pin an agent to the 0.1.10-era surface description, run against the current closure; a variant seeds Convex-vocabulary priors) and let its transcript establish which no-refusal failure presentations actually occur and at which layer, *before* the consumer surfaces are sized. Cost: one benchmark lane variant on existing W1 infrastructure. This is the plan's own W1 falsification discipline applied to itself, and it converts three of my concerns from blockers into scheduled measurements.

**4. Failure-scene capture instead of deterministic replay (S5 replacement).** Mechanism: on runtime failure, attach a bounded "scene" to the refusal via the P2/D7 carrier — operation, args shape (not values, respecting the D7 disclosure posture), schema generation, digests of the touched rows/collections, and the last N envelope events. Failure mode targeted: bisection cost, by converting reconstruction into inspection — the agent learns *what the failing state was* without the plan having to promise reconstruction it cannot deliver from a digest. Replay can be a later tier if scenes prove insufficient, at which point the real design question (state snapshot vs. time-travel substrate) gets asked honestly. Cost: small fraction of S5 as specced; fits 0156's exemplar machinery (though the capsule's 0156 excerpt cannot confirm fit — see Concern 7).

## Concerns

1. **MATERIAL — S1's flagship evidence belongs to a different failure class, and outcome 1 is causally disconnected from every workstream.** The `defineRelationalQuery` hand-roll is a *search-side* failure: the agent never guessed a wrong name, never hit typecheck, codegen, or any unknown-name path — it grepped, missed, and built. S1's own text nonetheless claims the authoring surface is "where the bakeoff losses actually occurred," which the plan's evidence section contradicts (it correctly assigns that loss to P6). Consequence: measurable outcome 1 ("zero hand-rolled reimplementations") cannot be moved by S1's mechanism — a did-you-mean fires only when the agent guesses a name, which the hand-rolling agent never does; that outcome is owned by 0203 P6's aliases. The capsule contains no verified instance of the wrong-guess authoring failure S1 targets (diaries 0065–0069 are excluded; I flag that this concern could be partially answered by unseen diary content). The plan needs either an observed instance or an explicit hypothesis-plus-probe-gate framing, and outcome 1 reassigned or dropped.

2. **MATERIAL — S3's evidence bullet performs exactly the causal conversion LLP 0186 W5 prohibits.** The bullet cites run 5's 131-vs-39 tool calls as evidence for first-error-fails serialization; 0186's own record states the run "does not establish a causal decomposition" and that later documents "must not convert its qualitative orientation diagnosis into a numeric fraction" — and 0193's r9 routes run 5's residues to templates, signatures, and anchors, not validation loops. Nothing in the capsule shows Snapback validation stops at the first violation or that any lane paid serialized fix cycles. The mechanism is plausible on priors, but the workstream is currently sized on misattributed evidence. Fix: cite the correct basis (or none), and gate S3 on one W5 semantic-action count of validation-retry cycles.

3. **MATERIAL — S5's replay mechanism is infeasible as specified, and the feasibility question is missing from the OQ list.** A receipt of "operation, inputs, closure version, state digest" cannot drive deterministic replay: a digest verifies state identity but does not reconstruct state. Either the receipt captures actual state (contradicting the bounded/redacted posture and inflating OQ3), or replay works only when local state coincidentally matches, which is not "one deterministic command." OQ3 covers privacy, not reconstruction; the load-bearing design question is unasked. Defer S5 to a spike or narrow to scene capture (New ideas §4).

4. **MATERIAL — S2's consumer premise ("the version in the model's head") is unsupported for any current session.** Snapback's public closure has existed since 2026-07-26 (LLP 0041 excerpt); no deployed model's training plausibly contains any Snapback release, so the stale-trained-knowledge population `whatsnew` serves is empty today and for at least a model generation. The observed skew channel — skill/guide/template drift against installed closures — is already mechanically fenced per 0186's implementation record. The ledger-generation decision survives on the archival-timing argument alone; the `whatsnew` verb and evidence framing do not. Scope: this does not touch S2's first-tranche placement for the ledger, only the consumer half and the leverage narrative.

5. **minor — The `check`/`verify` boundary is unstated.** The plan asserts "no new verifier" but never says whether `snapback check` is a verify profile, a pre-verify static stage, or a sibling verb — while the audit's verify-trust-gaps ticket (vacuous-green bare `verify`) is open and 0203's strip list warns against verb proliferation. Implementation-phase resolvable, but it should be one sentence in the boundaries section.

6. **minor — Sequencing mislabels S3 as "implementation-light."** Whole-surface keep-going validation plus `--dry-run` on every mutating verb is a contract change across subsystems, not a catalog consolidation like S4. The mislabel risks under-resourcing the tranche.

7. **minor — Two capsule-limited verification gaps, flagged per instructions.** (a) "Extends LLP 0156's tracking shape" cannot be checked against 0156's excluded body — the 80-line excerpt shows heavy, carefully-reviewed machinery (versioned fingerprints, classification-only groups, raw-tier exemplars) whose fit with a replay receipt is a real design question, not a footnote. (b) The bisection-cost and diary claims rest on diaries 0065–0069, which the capsule excludes; I treat them as unverified claims throughout, as CONTEXT.md directs.

8. **minor — The boundaries section omits two owners it needs: LLP 0156 (S5's substrate) and LLP 0193 Phase 4 (S6's consumer), plus the audit tickets S1 overlaps (`controls describe` bare bail, `refusals-lack-acquisition-path`).** The section is otherwise the best-written part of the plan; these are the seams where duplicate ownership would actually occur.

9. **minor — OQ5 should be answered, not left open.** The plan itself cites 0203's consolidation posture as the argument; leaving the verb-vs-fold question open contradicts the cited principle and invites the default (new verb) to win by inertia.

## Verdict

NOT READY

---

## Round 2 (delta round) — 2026-08-09

**Provenance.** Reviewer: Claude family (fresh general-purpose subagent,
Fable 5, no session context; capsule-only inputs; blind to round 1's
review bodies). Target revision (c), git blob
`eaa259717e561bd73649def0094f421d77d15cb4`. Capsule aggregate sha256
prefix `570e050685333164`; instructions sha256 prefix `2a780499271e6683`
(delta-round contract: IN-DELTA vs PRE-EXISTING classification required).
Verdict binds to the capsule hash above. Body below is verbatim.

---

## Assessment

The restructure holds together. Revision (c) is a genuinely better plan than the shape its own revision history describes: the measurement-gated commissioning frame is the right response to an evidence base that counts a population but cannot yet rank its cost; the ownership discipline (every mechanism landing under LLP 0146/0194/0203/0156/0193, this plan holding only traces, the conversion program, and commissioning records) is consistent with the corpus's anti-parallel-machinery posture and with LLP 0189's cadence rules; and the cuts are the right cuts, each with an argument rather than a shrug — replay reduced to an evidence bundle because a digest cannot reconstruct state, telemetry dropped because it observes the wrong population and lacks a denominator, `--dry-run` dropped because preflight cannot honestly predict authorization- and state-dependent outcomes, `whatsnew` deferred behind an observed-recovery trigger. The evidence section's self-limiting moves are mostly correct and unusually honest: the flagship discovery loss correctly reassigned to LLP 0203 P6, Run 5's action multiplicity correctly refused as causal evidence (matching LLP 0186 W5's own prohibition), model-knowledge skew correctly restated as future-tense with P1b resting on archival timing alone. Outcomes are per-mechanism and mostly falsifiable, and treating a never-firing gate as a success of gating is the right epistemics.

One evidence misassignment survived the rewrite, however, and it sits at the plan's center of gravity: the 138 undocumented client-raised codes are claimed for the no-refusal layer, which contradicts both LLP 0202's own wording and LLP 0193's population definition, and inflates P1a's baseline across the exact boundary the plan states in one sentence. That is the same defect species revision (c) exists to eliminate, so it blocks READY despite being surgically fixable.

Where the capsule limits confidence: diaries 0065–0069 and the benchmark run data are absent, so Run 5 figures and the probe-lane premises are taken on faith (they are at least consistent with LLP 0186's W5 text); the 0156 body beyond 80 lines and the 0146 body beyond D7 are excluded, so the evidence-bundle fit and the D2 `verify` ownership claim are checked only against corroborating text in 0193/0186, not the owner documents themselves. None of my concerns hinge on the unseen portions except where noted.

## Concerns

1. **MATERIAL / IN-DELTA — The 138 undocumented client-raised codes are misassigned to the no-refusal layer, corrupting P1a's baseline and the plan's own boundary.** The evidence bullet asserts that the 138 codes "never become refusals" and therefore "cannot… enter LLP 0193's grading." That is wrong on both halves: undocumented is not uncoded. Per LLP 0202 theme 4, the client arms *raise* 138 `SNAPBACK_*` codes (the *uncoded bare throws* are listed separately), and LLP 0193's Phase 1 population is the full identifier sweep — 1,316 distinct identifiers in `packages/**/*.mjs` are already inside its measured 2,418 — with ledger fields (`structured | message-text` representation) designed precisely to grade non-envelope emissions. So the 138 are already refusals in 0193's sense; their defect is documentation/structure, which is 0193's (and partly 0194's) territory. Consequences in this document: the evidence claim is false; outcome 2's conversion baseline ("20 codegen throws, 138 client codes, prose native failures… reaches zero open entries") counts a large tranche for which "mints a coded refusal" is a no-op; and the plan's crispest sentence — "LLP 0193 owns refusal quality; this plan owns making failures become refusals" — is undermined by its own inventory. Fix is narrow: restrict P1a's inventory to genuinely uncoded exits (20 codegen throws, the bare throws on documented subpaths, prose native failures, `unknown`-typed throw seams) and route the 138 to 0193's grading explicitly.

2. **minor / IN-DELTA — The P2a gate as worded is biased toward firing.** The probe lane is *seeded* with Convex-vocabulary priors and a stale surface description, then the gate is "the probe lane exhibits wrong-guess presentations." A lane constructed to induce wrong guesses will usually produce some; the discriminating question is whether those guesses surface as presentations *lacking usable candidates or diagnostics* (versus dying cleanly in an already-adequate carrier such as typecheck). The gating decision itself is sound — the seeding is a legitimate simulation of an admitted future-tense condition — but the gate's registered wording should require the unserved presentation class, or P2a is measurement-gated in name only.

3. **minor / IN-DELTA — Commissioning-gate thresholds and adjudication authority are unstated.** "Material cost" (P2b) and "repeated rediscovery" (P2c) have no quantitative pre-registration and no named decider; OQ2 covers grading authority for P1a classifications but not gate adjudication. Additionally, P2c's condition (fact rediscovery) is not naturally observed by a *failure-to-recovery* trace — rediscovery without a failed action never enters the P0 schema as specified — so the conservative failure mode (gate never fires despite real cost) is structurally possible. Both are repairable at P0 schema-definition time by folding W5's semantic-action classes (lookups, orientation reads) into the trace and pre-registering thresholds then; the plan should say that is where it happens.

4. **minor / IN-DELTA — P1b's tombstone mechanism conflates two carrier behaviors and states no retention policy.** "`@deprecated` doc text… typed so use fails typecheck" combines a warning-class affordance (deprecated, still usable) with a hard error, and the migration-message-in-diagnostic-without-plugin trick, while achievable in TypeScript, is asserted rather than designed. For a *rename*, hard-failing the old name is a real DX choice (versus a working deprecated alias) that the text makes silently. Nothing here identifies a defective decision at plan altitude — the change-site authoring rule and the diff-as-safety-net design are correct and well argued — but the landing under LLP 0194 should decide error-vs-warning per lifecycle kind and bound tombstone accretion.

5. **minor / IN-DELTA — P2c presumes the answer to LLP 0203's open OQ1.** Folding orientation fields into `snapback agent setup` treats the canonical-onboarding-verb question as settled while 0203 is Draft and its OQ1 explicitly offers the alternative. The fold decision is reasonable and the landing owner is correctly 0203, but the text should acknowledge the contingency (the fields land on whatever verb 0203 canonicalizes) rather than citing "0203's own consolidation posture" as if ruled.

6. **minor / IN-DELTA — "None mint a new… landing gate" overclaims.** P1a's negative test (refusing a new uncoded authoring-layer exit) and P1b's publication refusal of an undeclared removal are new gates in the plain sense. They are defensible as extensions of existing gate families (the 0193-style drift gate; the publication qualification pipeline), and neither violates LLP 0189's affected-scope rule, but the summary sentence should claim "no new gate *family*" or name the existing gates being extended.

7. **minor / IN-DELTA — Two evidence citations are stretched.** (a) "The out-of-checkout population is invisible (LLP 0202 theme 5)" — theme 5 documents surface deficiencies (licenses, dead loopback links, funnel exclusions), not observability of failures; the invisibility claim is true but unsourced by that citation. (b) "No deployed model's training data contains any Snapback release" is stated as verified fact when it is an unverifiable (if plausible) claim about third-party training cutoffs; the archival-timing argument for P1b does not need it stated that strongly. Neither changes a decision.

8. **minor / IN-DELTA — Evidence-bundle fit with LLP 0156 is asserted beyond what the capsule can verify.** The donation is well bounded (this plan commissions only the OQ3 spike proposal, and 0156's raw-tier/retention/redaction architecture visible in its header history looks compatible), but the capsule's 80-line excerpt cannot confirm that a local, identity-bound bundle-on-failure sits inside 0156's accepted scope rather than requiring a scope amendment. The plan should say the donation is a proposal contingent on 0156's owner accepting the scope, which its wording ("proposed to LLP 0156") mostly already does — flagged here as a confidence limit rather than a defect.

## Verdict

NOT READY

---

## Round 3 (delta round) — 2026-08-09

**Provenance.** Reviewer: Claude family (fresh general-purpose subagent,
Fable 5, no session context; capsule-only inputs; blind to all prior
review bodies). Target revision (d), git blob
`6d331b94cf02a4f8f7ae7ff9a459a03da31174cb`. Capsule aggregate sha256
prefix `6a13ce1cd3bd00bf`; instructions sha256 prefix `b42c9e0971a74876`
(delta-round contract: IN-DELTA vs PRE-EXISTING classification required).
Verdict binds to the capsule hash above. Body below is verbatim.

---

## Assessment

Revision (d) resolves the structural questions this plan needed to answer to be commissioned. The measurement-gated shape established at (c) is now operationally credible: P0.3's gate registration (cost measure, denominator, recurrence/sample rule, threshold, decider, all fixed before the first measured run) converts the P2 gates from vibes into pre-registered, falsifiable tests, and the explicit "a gate that never fires is a success of the gating" posture in Outcome 4 removes the incentive to commission anyway. The P1a partition is the right cut — the 138 undocumented-but-coded client codes genuinely belong to LLP 0193's graded population (its Phase-1 sweep of `packages/**/*.mjs` covers them), and the one-sentence boundary ("0193 owns refusal quality; this plan owns making failures become refusals") is clean and correct. The P1b split is well-reasoned in both directions: the archival-timing argument (rename facts unrecorded at the change site are unrecoverable; snapshots cannot distinguish rename from remove-plus-add) justifies commissioning the authored-facts half now, and the spike gate on the tombstone projection correctly identifies the real technical risk (plain `@deprecated` is advisory and fails nothing). The conditional owner handoffs with declined-fallbacks respect the fact that 0156's and 0193's scope decisions are not this plan's to make, and the P2c binding to 0203's open OQ1 rather than pre-empting it is the right ownership behavior. The gate-family claim is now accurate and consistently repeated at the points of extension. Folding W5's semantic-action classes into the trace schema closes what would otherwise have been a real hole — P2c's rediscovery gate and the `whatsnew` deferral trigger are only observable because of it.

Confidence limits: I cannot verify diary 0065–0069 or benchmark-run claims (absent from the capsule); the 0156 body and 0146 beyond D7 are excluded, so the evidence-bundle scope fit and the P2b claim that a diagnostic pass fits as a `snapback verify` phase rest partly on unseen material — though nothing visible contradicts either.

## Concerns

1. **minor / IN-DELTA — The Swift arm's uncoded errors sit ambiguously in the P1a partition.** LLP 0202 theme 4 names four uncoded populations plus "the Swift arm's client-originated errors carry no codes at all." Revision (d)'s in-scope list ("uncoded bare throws on documented client subpaths") may or may not include the Swift arm, and the enforcement gate is scoped to "syntactic exit sites the audit sweep can soundly enumerate" — a sweep that (per 0193's method) covers `.rs`/`.mjs`, not Swift. Since the Swift arm is also not in 0193's route (its errors carry no codes to grade), a strict reading leaves a named member of exactly this plan's target class outside both partitions. The ride-on ticket carries the full audit evidence, so the lane will likely encounter it, and 0202 theme 5's not-consumable finding is a defensible reason to exclude it — but the plan should say which, in one sentence. The partition decision itself is sound; this is an enumeration ambiguity.

2. **minor / IN-DELTA — Outcome 2's "LLP 0202 counts" baseline is only partially a count.** The audit gives a number for exactly one in-scope population (20 codegen throws); bare client throws, `unknown`-typed seams, and prose CLI failures are named but uncounted in 0202. The P1a audit lane will produce the real enumeration, so the outcome is still falsifiable against that enumeration — but "the LLP 0202 counts … as the baseline" overstates what the audit recorded.

3. **minor / PRE-EXISTING — "Round one … made Snapback's refusals excellent" overstates.** LLP 0193 is Accepted but mid-execution: the audit measured ~12% of ~2,418 codes documented, and 0193's exit criteria (100% graded, all agent-triggerable at grade A) are not met. The framing sentence is contrastive rhetoric and no decision in the plan depends on it, but "made the refusal *machinery* excellent" would be the defensible claim.

4. **minor / PRE-EXISTING — Systems header lists "Telemetry" while the plan's one telemetry mechanism is explicitly dropped.** The proposals section drops code-frequency telemetry and P0.1 is "no runtime telemetry"; nothing remaining in the plan touches the telemetry system. Header hygiene only.

5. **minor / IN-DELTA — "decided at the 0194 landing" is ambiguous.** LLP 0194's registry has already landed (the 847-symbol reference exists per 0202); the phrase presumably means the lifecycle-metadata landing under 0194, but as written it points at an event that already happened. One clarifying word fixes it.

6. **minor / IN-DELTA — Residual tension in the softened training-cutoff sentence.** "Almost certainly predates it (plausible, not independently verifiable)" asserts near-certainty and mere plausibility in the same breath. The claim's use — P1b resting on archival timing alone rather than on the skew claim — is correct either way, which is why this is only prose.

7. **minor / IN-DELTA — P2a's synthetic-probe commissioning leans on an unquantified representativeness judgment.** The delta correctly bounds the probe's evidentiary role (occurrence + unserved, with representativeness recorded), and OQ2 gives the adjudicator — but "records why the induced condition represents expected real sessions" is a rationale, not a registered measure, so the P2a gate is the one gate whose decisive input is judgment rather than threshold. This is probably irreducible for a stale-knowledge hypothesis with no observed instance, and the document is honest about it; noted so the commissioning record treats that rationale as a reviewable claim, not a formality.

## Verdict

READY

---

## Round 4 (delta round, author-authorized extension) — 2026-08-09

**Provenance.** Reviewer: Claude family (fresh general-purpose subagent,
Fable 5, no session context; capsule-only inputs; blind to all prior
review bodies). Target revision (e), git blob
`dfcffa696941e110596c08790abd885f54a04576`. Capsule aggregate sha256
prefix `bdcd53609c3873d2`; instructions sha256 prefix `6118a56e253983a7`
(delta-round contract: IN-DELTA vs PRE-EXISTING classification required).
Verdict binds to the capsule hash above. Body below is verbatim.

---

## Assessment

Revision (e) is a coherent, well-bounded measurement-gated commissioning plan, and the enumerated delta items each close a real gap rather than adding surface. Checked against the capsule context: the evidence claims trace correctly to LLP 0202 (the 20 codegen throws, the 138-coded-codes partition to LLP 0193, the Swift no-codes finding, the verify-receipt raw-Node-code finding) and to LLP 0186's own Run 5 record (131 vs 39 tool calls, the no-decomposition rule); the tickets P1a rides (`20260808-uncoded-throws-and-untyped-client-errors`, `20260808-native-cli-machine-mode`, `20260808-verify-trust-gaps`) all exist in 0202's ticket index. The ownership boundaries are the plan's strongest feature: P1a's one-sentence boundary with LLP 0193 ("0193 owns refusal quality; this plan owns making failures become refusals") is exactly right; P2a/P2b extend shipped LLP 0146 substrate (D7's implementation record and D2's verify, both confirmed in the capsule excerpt); P2c now carries a fallback that respects 0203 OQ1's authority either way; the 0156/0193 items are correctly framed as conditional proposals with declined-path fallbacks. The delta's exhaustiveness fix (Swift arm in scope, deferral as recorded classification, denominator anchored where the audit counted) resolves the main falsifiability weakness a partitioned inventory would otherwise have. Outcomes 1–4 are falsifiable, including the honest "gate never fires → recorded as not commissioned" branch. No MATERIAL defect found in delta or pre-existing text.

Confidence limits: diaries 0065–0069 and benchmark run data are absent from the capsule, so run-derived claims were checked only against their restatements in 0186/0193; LLP 0156 and 0041 are excerpts, so the evidence-bundle proposal's fit with 0156's accepted scope and the exact shape of the publication qualification checks P1b extends are plausible-but-unverified. Nothing in the concerns below hinges on the unseen portions.

## Concerns

1. **minor / IN-DELTA — P2a's external-validity second disjunct is an unspecified escape valve.** The gate can be satisfied without any naturalistic wrong-guess episode if "an external-validity criterion registered at P0.3" is adjudicated under OQ2. Pre-registration before the first measured run, author adjudication, and reviewable-claim status bound the risk, and the valve is a defensible hedge given the hypothesis has no verified instance — but the criterion's content is wholly deferred, so the delta's own anti-synthetic-commissioning intent rests on P0.3 discipline rather than on anything checkable in this document. No defective decision; a registration-time specification demand.

2. **minor / IN-DELTA — the extended drift gate's scope may exclude the Swift arm the delta just brought into inventory scope.** P1a's enforcement is "scoped to the syntactic exit sites the audit sweep can soundly enumerate," and the audit sweep was `.rs`/`.mjs` — the same limitation the delta cites as the reason for a separate Swift enumeration sweep. As written it is ambiguous whether Swift exit sites, once enumerated, join the ratchet, so converted Swift exits could regress without the negative test refusing them. Given the arm's not-consumable status and the allowed recorded-deferral path, this is a scoping sentence to tighten, not a defective gate design.

3. **minor / IN-DELTA — P1b's negative-spike branch hands stale-name serving to carriers that may never exist.** "Stale-name serving falls to the P2a/P2b carriers" is contingent on P0-gated mechanisms whose gates may never fire; if both the spike is negative and the gates stay closed, the residual floor is only the authored release diff plus the publication refusal. That floor is real and the outcome is consistent with the plan's gating philosophy, but the branch would be more honest naming the floor explicitly rather than implying a carrier is guaranteed.

4. **minor / IN-DELTA — Outcome 2's denominator is produced by the lane being measured.** "The lane's own per-class enumeration as the denominator" is self-referential; the mitigations (seeded by 0202's named classes, "counted where the audit counted," OQ2 adjudication of classifications) are adequate, so this is a spot-check note for the adjudicator, not a defect.

5. **minor / IN-DELTA — the "refusal *machinery* excellent" summary claim is generous against the audit it cites.** LLP 0202 found `next[]` populated on exactly one path repo-wide and never on failure — a machinery gap, not only a coverage gap. The italicized machinery/coverage distinction plus the "0193 mid-execution" parenthetical keep the sentence defensible, but "excellent" slightly overstates what 0202's "already strong" list actually certifies.

6. **minor / PRE-EXISTING — P1b's landing under LLP 0194 is asserted, not conditioned.** The 0156 and 0193 items get explicit conditional framing with declined-path fallbacks; the lifecycle-metadata landing under 0194 (and the Related line's "gains lifecycle metadata") reads as decided. Lifecycle facts are a natural extension of a registry that already records stable identity and closure applicability, 0194 is Accepted, and the same author adjudicates — so no ownership boundary is actually violated — but the asymmetry in framing is visible.

7. **minor / PRE-EXISTING — capsule-limited verification.** The evidence-bundle proposal's fit within LLP 0156's accepted scope could only be checked against that document's first 80 lines, and the publication qualification checks P1b extends could only be checked against LLP 0041's first 60 lines. Both fits are plausible from the excerpts and both proposals carry fallbacks, so nothing turns on the unseen text — stated per the capsule's instruction rather than as a document defect.

## Verdict

READY

---

## Round 5 (delta round, final authorized round) — 2026-08-09

**Provenance.** Reviewer: Claude family (fresh general-purpose subagent,
Fable 5, no session context; capsule-only inputs; blind to all prior
review bodies). Target revision (f), git blob
`93765d32dc18af084dad560c575577db7ff81e35`. Capsule aggregate sha256
prefix `fa77ad56951cbc58`; instructions sha256 prefix `7ef2db3e76eee9e8`
(delta-round contract: IN-DELTA vs PRE-EXISTING classification required).
Verdict binds to the capsule hash above. Body below is verbatim.

---

## Assessment

Revision (f) is a sound, well-bounded plan, and the five delta changes each close a real hole rather than reword one. Delta 1 removes the last blanket escape from the P1a ledger (whole-arm Swift deferral can no longer masquerade as closure); delta 2 fixes a genuine authority-boundary error — the LLP 0194 registry, built from published `.d.mts` declarations, cannot be the candidate source for app-derived schema fields and functions, and routing those to the codegen manifest / caller-visible served generation matches what the LLP 0146 D7 implementation record says the shipped substrate already reads; delta 3 makes the P2a gate strictly harder to fire, in the falsifiability-preserving direction; delta 4 gives the tombstone projection the same demand discipline as `whatsnew` and names the negative-branch residual floor explicitly; delta 5 is honest softening. The core decisions — measurement-gated commissioning with pre-registered gates and a named decider, the conversion program as this plan's only owned mechanism, everything else landing under its real owner or proposed conditionally with fallbacks — hold up under adversarial reading, and Outcomes 1–4 are each falsifiable, including the "gate never fires" case being recorded as a success of gating rather than quietly forgotten.

Confidence limits: diaries 0065–0069 and the benchmark run records are not in the capsule, so Run 5 figures, the residue routings, and the "no verified wrong-guess instance" claim were checked only against LLP 0186/0193's own accounts, with which they are consistent. The LLP 0041 and 0156 excerpts are headers only, which limits verification of two claims noted below.

## Concerns

1. **minor / IN-DELTA.** With the external-validity escape valve removed, the only naturalistic evidence channel for the P2a and P1b demand gates is the scheduled benchmark lane corpus — lanes that are skill-equipped and guide-primed, and therefore systematically less likely to exhibit wrong-guess or stale-change episodes than real out-of-benchmark sessions. The plan accepts under-commissioning deliberately (and says so), but it does not state this representativeness limit, and the `snapback feedback` verb — which, if LLP 0193 accepts it, would create a second naturalistic channel — is not wired into the gates as an admissible evidence source. No defective decision; a one-sentence acknowledgment would complete the honesty of the design.

2. **minor / IN-DELTA.** P1b's dual gates sit outside the P0.3 registration discipline, which by its text covers "each P2 gate." The feasibility spike is self-terminating, but the demand gate has no registered evaluation window or decider, so Outcome 3's "either gate fails" branch has no defined trigger for the demand half — "no naturalistic trace yet" is indistinguishable from "gate failed" without a window rule. Outcome 4 handles exactly this for P2 ("a mechanism whose gate never fires is recorded as not commissioned"); extending P0.3 registration or that recording rule to the P1b projection gate would close the gap. Detail-level; the gate itself is well defined.

3. **minor / IN-DELTA.** "Its enumerated exit sites join the drift-gate ratchet like any other" presumes a soundly automatable Swift exit-site enumeration, which nothing in the capsule establishes — the audit was static reading, and the Swift arm's errors carry no codes at all. The enforcement sentence's own bound ("scoped to the syntactic exit sites the audit sweep can soundly enumerate") honestly covers the failure case, but it sits in mild tension with the unconditional "like any other." If Swift sites prove not soundly enumerable, the one-time conversion still works and the ledger stays open, so no decision is defective — this is a feasibility caveat worth one qualifying clause.

4. **minor / PRE-EXISTING.** P1b's publication refusal is claimed as "an extension of its existing qualification checks, not a new gate family." The capsule's LLP 0041 excerpt (header only) shows a qualification/promotion machinery exists but not the checks themselves, so the no-new-gate-family claim is plausible but not verifiable from this capsule. Flagged as a confidence limit, not a suspected defect.

5. **minor / PRE-EXISTING.** The Summary's "No new verifier, verb family, or *gate family*" sits beside the conditional proposal of `snapback feedback` — a new verb, albeit proposed to LLP 0193 with a filed-ticket fallback rather than owned here. The claim is defensible as scoped to mechanisms this plan owns, but adding "owned here" would remove the surface contradiction a fast reader will trip on.

## Verdict

READY
