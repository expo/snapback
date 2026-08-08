# Review artifact — LLP 0198, GPT family

Provenance: llp-super-refine loop, orchestrated 2026-08-08; reviewer =
codex exec, model gpt-5.6-sol, reasoning xhigh, read-only sandbox on the
round-1 capsule (tar sha256 ce0cafe26d10…, git archive of 763b408 with
llp/reviews/0198-* excluded); instructions sha256-16 4a61d27333c303d9 +
GPT addendum c0cf2a269bd0aed4; 180,424 tokens reported by the runner.
Body below is verbatim (complete stdout of the run).

---

## Round 1 — 2026-08-08 — revision (a) 763b4080 / sha256 9351ad5c… — verdict: NOT READY

## Concerns

1. **MATERIAL — P0 says N≥3 will establish a variance band and exit with mean±band, but the governing protocol forbids variance claims below N≥8 while LLP 0197 specifies preregistered N≥3 median+range.** Evidence: `llp/0198-surpass-convex-agent-authoring.plan.md` §I.1 and §II.3 P0; `benchmarks/protocol.md` §Repetitions and variance; `llp/0197-benchmark-publication-standard.rfc.md` §The standard, rule 1.

2. **MATERIAL — “Surpass” has no logical decision rule: P5 may publish when V1 *or* V2 holds, V4 covers only V1/V2, and V1 is merely wall-clock parity while leaving the measured 2.24x token gap unconstrained.** Evidence: `llp/0198-surpass-convex-agent-authoring.plan.md` §II.1 V1–V4 and §II.3 P5; `llp/0186-agent-authoring-efficiency-program.plan.md` §Summary, W1, and §Measurable outcomes.

3. **MATERIAL — V2 applies the messaging-specific frozen rubric across brief families whose requirements explicitly omit weighted dimensions, without defining how unexercised realtime, offline, or media dimensions can be scored or aggregated.** Evidence: `llp/0198-surpass-convex-agent-authoring.plan.md` §I.3, V2, and P3; `diaries/0058-relay-room-expo-backend-bakeoff.diary.md` §Current scores; `benchmarks/briefs/crud.md` and `media.md` §Notes for lane fairness; `benchmarks/schema/run-record.schema.json` `rubric`.

4. **MATERIAL — P1 deliberately builds templates against the exact CRUD/media benchmark capability surfaces and P3 then uses those briefs toward V2, omitting the newly required held-out-brief and symmetric-starter controls.** Evidence: `llp/0198-surpass-convex-agent-authoring.plan.md` P1 and P3; `llp/0196-template-and-recipe-portfolio.plan.md` §Exit criteria; `llp/0197-benchmark-publication-standard.rfc.md` rule 4a.

5. **MATERIAL — Cross-family validity is deferred to OQ3 even though V3 makes a generic claim about “agents,” all published-consumer measurements used Claude Fable 5, and the current skill lane is explicitly shaped around `.claude/skills` and an “installed Claude Code skill.”** Evidence: `llp/0198-surpass-convex-agent-authoring.plan.md` §I.6, V3, and OQ3; `benchmarks/README.md` §Skill payload and registry lag; `benchmarks/lanes/skill.md` and `native-simulator.md` §Parameters and §Template.

6. **MATERIAL — P1’s no-package-source exit is not owned by the cited plans because LLP 0194 explicitly excludes `ctx` and verify/config until declaration files exist, yet 0198 treats those exact excursions as acceptance items already covered by 0194.** Evidence: `llp/0198-surpass-convex-agent-authoring.plan.md` P1; `llp/0194-generated-api-reference.rfc.md` §Design item 5 and OQ2.

7. **MATERIAL — P1 groups `maxAttempts: 1` with auth omission as a cheap sharp-default fix even though the corpus has already determined that raising the generic retry default can replay external effects and that platform-conflict retry requires a separate effect-safe mechanism.** Evidence: `llp/0198-surpass-convex-agent-authoring.plan.md` P1; `issues/closed/20260804-authoring-omission-defaults-widen-effects.md` §Resolution; `llp/0171-chess-authoring-loop-observations.research.md` §Finding D.

8. **MATERIAL — The proposed “idiomatic production auth” comparison does not hold the tested outcome constant and would mix backend trust-boundary quality with provider choice, account setup, credential availability, and third-party integration ceremony.** Evidence: `llp/0198-surpass-convex-agent-authoring.plan.md` P3 real-auth item and OQ2; `benchmarks/README.md` §Fairness rules; `diaries/0057-chess-backend-bakeoff.diary.md` §Honest self-assessment.

9. **MATERIAL — P4 option (b) invites contesting the operations dimension after observing an unfavorable score, which conflicts with V2’s frozen rubric and LLP 0197’s preregistration discipline.** Evidence: `llp/0198-surpass-convex-agent-authoring.plan.md` P4 and §Risks; `llp/0197-benchmark-publication-standard.rfc.md` rules 1 and 3.

10. **MATERIAL — The central “zero framework defects in any Snapback lane” claim rests on an unreconciled retained record whose bare-web row says `6 (~2)` under “Loops (framework),” even though the same record’s note says zero.** Evidence: `llp/0198-surpass-convex-agent-authoring.plan.md` §Summary and §I.2; `benchmarks/records/2026-08-08-messaging-0115.md` lane table and Notes; `diaries/0069-run5-measurement-0115.diary.md` §The table and §Reading it.

11. **minor — The run-2 rubric transcription substitutes approximate run-1-like values for several retained scores: diary 0065 records 95/97 functional, 78/93 images, and 94/90 data/type, not ~96/97, ~82/92, and 94/91.** Evidence: `llp/0198-surpass-convex-agent-authoring.plan.md` §I.3; `diaries/0065-rematch-published-closure-bakeoff.diary.md` §Scores.

12. **minor — P2 restores a causal training-data claim that revised LLP 0195 carefully downgraded to an unverified hypothesis, while public docs can immediately improve retrieval but cannot change a pinned model’s prior.** Evidence: `llp/0198-surpass-convex-agent-authoring.plan.md` §I.5 and P2; `llp/0195-public-documentation-and-training-surface.rfc.md` §Summary, Proposal item 4, and OQ4.

## Generative input

1. **Replace V1–V4 with an explicit claim ladder.** Idea: distinguish “wall parity,” “equal-proof workload superiority,” “broad agent-authoring superiority,” and “publication-ready,” then define the exact conjunction required for the phrase “surpasses Convex.” Why: narrower wins can be published honestly without letting one favorable rubric or parity result imply the global claim. Where: rewrite §II.1 and make P5 select the precise claim tier supported.

2. **Promote cross-family measurement from OQ3 into a phase.** Idea: add P0b with at least Claude and GPT families under two conditions: native ecosystem discovery and context-normalized payload injection. For Codex, exercise hierarchical `AGENTS.md` plus `.agents/skills` discovery rather than presenting a `.claude` payload as already loaded; record exact model, effort, tool policy, and harness version. Why: run 1 cannot answer this—it was in-checkout, used a different basis, and excluded orientation—while GPT-family agents consume instructions, skills, tool output, and errors differently. Where: after P0 calibration and before V1/V3 claims.

3. **Do not pool raw token counts across model families.** Idea: make within-family token ratio, harness-reported dollar cost where available, wall time, and tool calls separate measures; report model-family interactions rather than one grand token mean. Why: tokenizers, hidden reasoning accounting, caching, and tool-result charging differ across Codex and Claude harnesses. Where: V1, benchmark schema, P0b, and LLP 0197’s model-disclosure rule.

4. **Use a blocked, randomized repetition design.** Idea: treat N=3 as a pilot/claim floor and N=8 as the first variance study; preregister an ABBA or Latin-square lane order, pair runs within narrow time blocks, record fleet load, and analyze paired ratios with median+range plus an uncertainty interval. Why: repeated serial execution on a continuously loaded shared machine otherwise confounds platform with lane order and time of day. Where: P0 and `benchmarks/protocol.md`.

5. **Split authoring efficiency into objective milestones.** Idea: automatically timestamp time-to-first-live-backend, feature-complete, equal-proof-complete, and final acceptance; separately meter orientation, diagnosis, and verification. Add “detour tax” as wall/tokens from first contrary evidence to restored green proof. Why: loop count treats a thirty-second self-explanatory Convex error and an eighty-line workaround as equal, while the diaries say resolution cost is the real difference. Where: V1, P0 schema, and OQ5.

6. **Give V1 both time and resource bounds.** Idea: require wall-clock noninferiority and either token/cost noninferiority or a declared Pareto rule, such as “≤1.2x wall and ≤1.2x within-family tokens.” Why: an agent backend has not reached efficiency parity if it is fast only by consuming twice the inference budget. Where: V1 and the headline claim templates in P5.

7. **Replace the universal weighted score with a two-layer scorecard.** Idea: retain the historical 0058 rubric unchanged for messaging, but create preregistered outcome rubrics per brief plus a separate invariant platform score for DX, diagnostics, and operations; aggregate through noninferiority/dominance counts rather than scoring unrequested features. Why: this preserves longitudinal integrity without pretending CRUD exercised offline or media. Where: V2, P0, P3, and the benchmark schema.

8. **Create truly held-out brief variants.** Idea: classify CRUD/media runs against T1/T2 as template-assisted development evaluations, then freeze capability-isomorphic but structurally novel held-out briefs before measuring general authoring claims; apply a symmetric policy for discovering and selecting Convex starters. Why: it separates “our template is excellent” from “an agent can author arbitrary apps cheaply.” Where: P1/P3 and the LLP 0196/0197 joins.

9. **Replace the real-auth brief with a trust-boundary brief plus a separate onboarding brief.** Idea: the trust brief supplies two principals and an anonymous caller, then tests owner spoofing, cross-tenant reads, revocation, stale/offline replay after authority changes, and audit evidence; a different brief measures identity-provider setup. Why: it prices Snapback’s structural moat using vendor-neutral security outcomes without letting Clerk/Auth0/account ceremony dominate the result. Where: P3 and OQ2.

10. **Turn operations into a runnable agent-operations challenge.** Idea: require fresh-machine setup, a shareable endpoint that survives the authoring process, logs/data/job inspection, secret installation, rollback, state recovery, idle/resume behavior, and cleanup; record time, logins, manual interventions, and operator evidence. Why: this reveals whether Snapback should build hosted parity, differentiate through scale-to-zero agent-operated environments, or accept the deficit—without redefining a score afterward. Where: a new operations brief owned by a dedicated P4 RFC.

11. **Decompose orientation causally.** Idea: run the same pinned model in prior-only, public-web retrieval, native skill, and template conditions, recording every knowledge source and first correct API-shape acquisition. Why: this separates current-model retrieval value from speculative future-training value and shows whether docs, skills, or scaffolds deserve the next investment. Where: P2 exit and LLP 0195 OQ4.

12. **Define an assistance envelope for ecosystem-realistic fairness.** Idea: publish two headline series: “best automatically discoverable first-party assistance” for each ecosystem, and “equal injected context” where both receive bounded vendor-authored packets. Why: Convex’s training-data familiarity functions like free context, while Snapback’s explicit skill is productized context; showing both makes the asymmetry informative rather than arguable. Where: benchmark lanes, P0b, and LLP 0197 fairness notes.

13. **Make native skill discovery itself an acceptance surface.** Idea: publish a versioned skill manifest with closure compatibility and test cold discovery through `.agents/skills`, `.claude/skills`, Cursor conventions, and scaffold `AGENTS.md`, without pasting the skill into the benchmark prompt. Why: a GPT-family consumer follows hierarchical AGENTS instructions and skill triggers differently from Claude Code; prompt injection measures payload quality, not distribution quality. Where: P2, LLP 0195 Proposal item 3, and benchmark lane variants.

14. **Create an explicit P1 declaration-source work item.** Idea: assign owners to publish machine-readable declarations for handler `ctx` and verify-config contracts, then generate a coverage ledger showing included and excluded surfaces; run exact retrieval probes for every diary-0069 package-source excursion. Why: it makes “no source inspection” achievable rather than depending on an RFC that deliberately excludes the missing surfaces. Where: P1 and LLP 0194 Design item 5/OQ2.

15. **Measure preference after experience, not only before it.** Idea: collect pre-build and post-build choices, allow abstention, run both named-platform and vendor-neutral capability-card conditions, and have an independent rubric code the reasons. Why: a pre-build choice mostly measures brand prior and prompt framing; the change after an actual build measures revealed authoring preference. Where: V3 and OQ4.

16. **Give the public surface a bounded “first ten minutes” contract.** Idea: require a stable public domain, versioned quickstart, `npm create` path, compact machine-readable index, exact API signatures, searchable diagnostic codes, and one proof-carrying example reachable without package-source inspection. Why: from a GPT consumer’s eye, Convex already supplies familiar canonical shapes; Snapback needs one short, authoritative route before the full guide’s richness becomes useful. Where: P2 and LLP 0195 acceptance.

17. **Publish an adversarial control, not only Snapback-shaped wins.** Idea: preregister a plain CRUD brief expected to favor Convex, retain losing Snapback runs, invite a third party or competitor-informed reviewer to challenge the lane setup, and publish corrections visibly. Why: a credible loss is stronger evidence of instrument honesty than another fairness disclaimer. Where: P3/P5 and LLP 0197 OQ2.

18. **Stage the run budget explicitly.** Idea: use one-run brief validation, N≥3 confirmatory measurement, and N≥8 variance only for the primary claim pair; expand the cross-family matrix only after checking for a family interaction. Why: this keeps the plan executable without weakening the evidence standard or committing immediately to dozens of expensive serial runs. Where: P0/P3 sequencing and phase exits.

## Verdict

NOT READY

The direction is strong, but the variance protocol, victory logic, cross-brief scoring, template contamination, model-family validity, and several ownership/fairness joins remain materially unresolved; reviewed revision 763b4080 / sha256 9351ad5c….

---

## Round 2 — 2026-08-08 — revision (b) 2f117950 / sha256 404b0b93… — DELTA ROUND — verdict: NOT READY (10 MATERIAL, all IN-DELTA; 1 IN-DELTA minor, 1 PRE-EXISTING minor)

Provenance: codex exec, gpt-5.6-sol, reasoning xhigh, read-only sandbox
on capsule-r2 (tar sha256-16 2ebbcffa4b9760df; round-1 artifacts and run
journal structurally excluded; DELTA-a-to-b.diff at root); instructions
sha256-16 1c24ec63046f17f1; runner-reported: tokens used 185,957 . Body verbatim
(complete stdout).

## Concerns

1. **MATERIAL — IN-DELTA.** The ladder narrows LLP 0197 rule 4a from all vendor-authored benchmark-targeted aids to templates/starters, so skill-, recipe-, or example-assisted results could be mislabeled as general authoring evidence (`0198:335–350, 484–487`; `0197:66–77`).

2. **MATERIAL — IN-DELTA.** The requalification tuple omits LLP 0189’s qualification commit and claim-scoped evidence surface, while its triggers do not age out a claim when the competitor moves materially unless performance breaches the old band (`0198:365–371`; `0189:98–136`; `0197:94–95`).

3. **MATERIAL — IN-DELTA.** P0b’s `N≥1–3` is neither a preregistered sample count nor necessarily LLP 0197’s N≥3 minimum, yet P0b is allowed to lift every rung’s family scope and supply L5’s family panel (`0198:335–360, 407–417`; `0197:43–49`).

4. **MATERIAL — IN-DELTA.** Mirroring the four wall-clock phases into `tokens.phases` cannot make I.5’s different four causal terms—orientation, knowledge residue, proof depth, and operations—record facts, especially when the protocol permits phase attribution to be unavailable (`0198:264–298, 390–398`; `protocol.md:39–68`).

5. **MATERIAL — IN-DELTA.** L4 depends on “P0’s two-layer scoring,” but P0 defines no such scoring or aggregation rule and the current schema only supports the fixed eight-dimension rubric, leaving a required global-claim rung non-operational (`0198:349–353, 390–423, 538–542`; `run-record.schema.json:153–178`).

6. **MATERIAL — IN-DELTA.** L5 cites a “P3 pick-and-build probe” that P3 never owns or schedules, while OQ4 leaves its mechanics unresolved and no preregistered N or decision rule defines “favors,” so the confirmation required for the unqualified claim cannot be executed (`0198:353–360, 457–493, 560–564`; `0197:43–49`).

7. **MATERIAL — IN-DELTA.** P1 incorrectly says verify-config is excluded pending a declaration source, whereas LLP 0194 says published `verify.d.mts` already places it in initial scope and only `ctx` remains behind OQ2 (`0198:424–432`; `0194:46–60, 64–73, 87–94`).

8. **MATERIAL — IN-DELTA.** P1 places the retry remedy under documentation/template owners even though LLP 0171 assigns retry policy to LLP 0070 and requires a finite cap, jitter/backoff, generation pin, and proved no-effect stage, not merely a generic “cannot replay external effects” condition (`0198:424–440`; `0171:116–143`).

9. **MATERIAL — IN-DELTA.** The trust-boundary brief requires both transcripts to be published, directly contradicting LLP 0197’s publication-safe projection rule that raw transcripts never publish (`0198:465–477`; `0197:96–108`).

10. **MATERIAL — IN-DELTA.** The trust-boundary and day-2 briefs leave the measured construct uncontrolled by excluding onboarding without fixing preprovisioned inputs or clock boundaries and by leaving starting artifacts plus same-agent-versus-cold-agent context unspecified (`0198:465–483`; `README.md:59–93`; `protocol.md:11–37`).

11. **minor — IN-DELTA.** P3 says either equal-proof outcome is “L2 either way,” although L2 is defined only as a Snapback superiority result (`0198:345–348, 460–464`).

12. **minor — PRE-EXISTING.** I.2 calls the trajectory the “skill lane” while including run 2, which I.1 correctly identifies as a bare run before the skill existed (`0198:67–78, 105–110`).

## Generative input

A single rung matrix covering required configurations, aid labels, preregistered N/success thresholds, family aggregation, snapshot scope, and invalidation events would eliminate several cross-section contradictions.

## Verdict

NOT READY — revision `2f117950` / sha256 `404b0b93…` has unresolved MATERIAL concerns in revision (b).

---

## Round 3 — 2026-08-08 — revision (c) b5a1a7d6 / sha256 db995830… — DELTA ROUND — verdict: NOT READY (5 MATERIAL, all IN-DELTA; 2 PRE-EXISTING minor)

Provenance: codex exec, gpt-5.6-sol, reasoning xhigh, read-only sandbox
on capsule-r3 (tar sha256-16 590e4cc9c11fa629; 0198 artifacts excluded;
DELTA-b-to-c.diff at root); instructions sha256-16 9f06e55946a7833f.
Body verbatim (complete stdout).

## Concerns

1. **MATERIAL — IN-DELTA.** L2/P3 can call an N≥3 median an “outright” equal-proof-bar win although P0.2’s N≥8 study covers only the baseline messaging configuration, contrary to the protocol’s N≥8-per-configuration floor and without explicitly carrying LLP 0197 rule 4b’s N≥3-success and success-rate gates; evidence: LLP 0198 §II.1 L2 and §II.3 P0.1–P0.2/P3, `benchmarks/protocol.md` “Repetitions and variance,” LLP 0197 rules 1 and 4b.

2. **MATERIAL — IN-DELTA.** The new qualification digest is described as containing run records and verify receipts but omits the rung/run matrices, protocol, briefs, lane prompts, and scoring checkers that define claim semantics, allowing semantic drift to escape LLP 0189’s claim-relevant invalidation boundary; evidence: LLP 0198 §II.1 “rung matrix” and “Requalification,” LLP 0189 D-3/D-4, LLP 0197 rules 1–4a.

3. **MATERIAL — IN-DELTA.** Revision (c) supplies an N≥3 floor for lifting family scope but no sufficient decision rule, while P0b tests only the primary messaging pair and waits for an interaction to appear before expanding the matrix, so it cannot justify lifting L2–L4 across unmeasured equal-proof, held-out, and other-brief configurations; evidence: LLP 0198 §II.1 opening scope rule and §II.3 P0b, LLP 0197 rules 1 and 3.

4. **MATERIAL — IN-DELTA.** L5 remains undecidable because “N≥5 … across the P0b family panel” does not require N per model-family/brief/redaction configuration and “at worst neutral” is undefined, permitting pooled families or opposite family results to satisfy a gate required for the unqualified claim; evidence: LLP 0198 §II.1 L5 and §II.3 pick-and-build probe, LLP 0197 rules 1 and 3.

5. **MATERIAL — IN-DELTA.** The day-2 design freezes an unspecified post-run artifact without requiring acceptance-equivalent paired starting states or treating artifact identity as a configuration dimension, so repeated cold-agent runs can pseudoreplicate one lucky or poor prior implementation rather than measure platform evolution cost; evidence: LLP 0198 §II.3 P3 day-2 brief, `benchmarks/protocol.md` “Run rules,” LLP 0197 rules 1, 3, and 4a.

6. **minor — PRE-EXISTING.** I.2 still says the verify-config contract exists only in `verify.mjs`, contradicting both corrected P1 and LLP 0194’s published `verify.d.mts` source; evidence: LLP 0198 §I.2/P1, LLP 0194 Design 5 and OQ2.

7. **minor — PRE-EXISTING.** P4 says the operations deficit “caps L4 at every scoring,” although operations carries only 10% of the rubric and P4 option (c) itself permits winning through the other seven dimensions; evidence: LLP 0198 §I.3 scoring table and §II.3 P4.

## Generative input

Represent every claim as a frozen configuration cell containing family/model, brief and starting-artifact hashes, aid/redaction condition, success floor, N, statistic, margin, and semantic-input digest; require family-specific verdicts and either N≥8 for each ordering claim or an explicit preregistered variance-transfer rule.

## Verdict

NOT READY — reviewed revision b5a1a7d6 (sha256 db99583036f3aee8d5f8dfbf6007f8fa767171dd2a31c33114d85cf54fe3161c) has unresolved MATERIAL defects in its claim, qualification, family-scope, and probe rules.
