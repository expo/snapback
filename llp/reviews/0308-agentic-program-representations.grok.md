# LLP 0308 review artifact — grok family

Target: `llp/0308-agentic-program-representations.research.md`

## Round 1 — 2026-08-25

- Reviewer: `grok-4.6` @ xhigh reasoning effort, headless CLI
  (`--output-format plain --disable-web-search --permission-mode auto`),
  run from an empty directory with a full terminal/tool ban in the
  prompt; no repository access — the target document was inlined
  verbatim in the prompt.
- Revision under review: r1, target sha256/16 `5a90abcfd8bb9049`
  (commit `e4ecd5d7e99`). Prompt (instructions + verbatim target)
  sha256/16 `e956289cde9e0a7f`.
- Blindness: fresh review; no other 0308 review existed at launch
  (structural — capsule/prompt predate every 0308 artifact).
- Run: launched 2026-08-25T06:44:30Z, exit 0, empty stderr; body below
  is the complete stdout, verbatim.

### Review body (verbatim)

## Summary

This is a useful research mapping: it correctly relocates value away from a new GPU-compiled language and toward Snapback’s existing closed IRs, and the “do not import” dispositions (GPU, new surface language, CRDTs, SMT-now, e-graphs-now) are well argued. It is not ready for a consuming program. Several load-bearing identifications are too strong: F1 treats the current stack as already instantiating the source thesis (including speculate-then-check), I1 treats three distinct problems as one derivation, and I2 treats a differential checker as closing a soundness gap and silently flipping safety-relevant lanes. The I1–I4 ranking also does not match the document’s own payoff and stakes claims. Those defects would change what a follow-on spec or program believes is already done, what I1 must specify, and what I2 is allowed to conclude.

## MATERIAL concerns

1. **F1 over-identifies Snapback with the source thesis, especially source idea 4 (speculate-then-check) and the three-layer split.**  
   The source representation is a canonical graph of **contract + implementation family + schedule**, with untrusted generation gated by a small deterministic validator, and with equivalent forms retained. F1’s evidence (closed `ValueExpr` / `graph_query_v1`, refusal registers, content-addressed identities, `classifyLocalMutationIrV1`, shared client/server evaluator) supports closed analyzable data, honest refusal, and **placement**. It does not support retained implementation families — those are later parked under deferred e-graphs — and it does not support generation-time acceptance. Equating LLP 0270’s divergence kill switch with speculate-then-check is a category error: 0270 compares **two evaluations of the same admitted IR** (local vs server) and disables a lane on mismatch; the source mechanism, and I2, compare **two different programs** (JS handler vs derived plan, or candidate vs contract) before admission. A consumer of F1’s heading and the 0270 bullet can conclude the representation thesis and its validator split are already shipped, which makes I2 look optional and hides that implementation families are absent.  
   **Fix must establish:** an explicit remainder map — which source layers exist (closed IR, contracts/refusals, placement) and which do not (implementation families, retained alternatives, generation-time equivalence gates) — and must describe 0270 as runtime divergence detection, not as the Alive2/translation-validation split I2 is proposing.

2. **I1’s “three fronts, one derivation” claim is false as stated and would mis-scope the spec.**  
   Operator-level incremental semantics in the DBSP / differential-dataflow sense can, for a closed algebra, derive **per-plan deltas** (0209 G3-B) and a **maintained local materialization** (0190 D3) from the same operator rules. It does not derive LLP 0209 §8 rung 5’s replica continuity contract (base-version stamping, cumulative vs compositional deltas, gap-to-replace). That is a distribution/protocol problem that still exists after every operator has a Z-set derivative. The prior-art paragraph then identifies InstantDB’s “one query language, two execution paths” (LLP 0082) with I1’s “same derivation consumed by server and client.” Dual execution of a shared IR is already F1 (and is what Snapback already has); it is not incremental view maintenance. Open question 1 bakes the over-unification into a spec-structure choice (“its own Spec that 0209, 0190, **and the replica contract** all cite”). Confidence is “high … on the three-fronts-one-derivation claim.” A consuming program would under-specify replica work and could specify I1 as InstantDB-style dual backends rather than as an incremental algebra.  
   **Fix must establish:** I1’s deliverable is an incremental operator semantics for the closed query algebra, consumed by matcher deltas and local materialization; replica continuity is a separate contract that may *use* those deltas; LLP 0082/shared-evaluator is precedent for F1, not for DBSP. Recalibrate the “high” on three-fronts-one-derivation or drop it. Re-ask OQ1 without assuming one spec owns all three.

3. **I2 overclaims that checked lowering closes the `reads:`/`writes:` soundness gap and may silently promote a function onto the analyzable lanes.**  
   The gap is real as described: authored `reads:`/`writes:` are trusted declarations used as invalidation keys and are not checked against handler behavior; acorn scanners are admitted unsound under aliasing. The proposed gate is “differential execution against the conformance corpus and representative stores, or per-shape structural proof where the subset permits,” with explicit “no completeness claim” and a later rejection of SMT unless the checker outgrows differential testing. That gate does **not** convert a trusted declaration into a checked fact over the admitted store space, and it does not justify “on success the function **silently** gains the analyzable lane,” where that lane bundles invalidation precision, local-first admission, `rqsEligible`, and delta eligibility. Corpus-differential success is evidence of agreement on tested cases, not equivalence, and silent promotion is a safety decision for live invalidation and optimistic execution. Combining I2 with I3 (“write-site facts become checked rather than scanned”) inherits the same overclaim. Open question 2 notices the checker-strength question but the I2 body already treats the gap as closed.  
   **Fix must establish:** (a) declaration checking and plan-lowering are separate products, with VM-observed read/write sets as the honest check of declarations; (b) lane promotion is an explicit admission with a named soundness claim, residual risk, and non-silent failure; (c) differential testing is a pre-filter, not translation validation in the Alive2 sense, unless the trusted checker is specified more strongly.

4. **The I1–I4 ranking does not match a stated criterion, and it contradicts the document’s own payoff and stakes claims.**  
   The section is titled “Where the imports pay **(ranked)**.” I4 is “smallest theory, most immediately measurable payoff,” “independent of I1–I3,” confidence **high**. I3 is “the weakest representation in the stack” “at the point of **maximum stakes**” (authorization), confidence **high** on direction. I1 is ranked first with a motivating measurement that the document itself marks **N=1** (Zerobugs, delta-lane delivery count zero) and with medium effort because excluded shapes are the hard incremental cases. A program that takes the numbering as adoption order will start the largest, least-measured algebra project first, defer the independent generate-loop incrementality that the text says pays immediately, and treat authorization IR as third despite the stakes language. That is a decision-quality defect, not a presentation nit.  
   **Fix must establish:** one ranking criterion (architectural leverage vs. do-now vs. stakes) and an order that follows it — or two lists (research depth vs. implementation priority) so I4 can be first on the do-now list without pretending I1 is the cheapest win.

5. **Source idea 6 has no disposition, despite being listed as load-bearing.**  
   The compressed source makes structured diagnostics a first-class claim: a failure returns the violated constraint, the smallest conflicting subgraph, and candidate repairs — not prose. Findings map ideas 1–5 onto F1 / deferred e-graphs / I2 / I4 (and reject GPU). Idea 6 never appears as an import, a defer, a reject, or as already satisfied. Named `SNAPBACK_*` refusal codes and `Unanalyzable` are authoritative *reasons*; they are not a conflicting subgraph plus repair candidates, which is what LLP 0000’s “complete feedback loops” would need if this mapping is the agent-facing half of the thesis. A consuming agent-experience program can miss a high-leverage import or assume refusal codes already fulfill the idea.  
   **Fix must establish:** a disposition — already met (with evidence of subgraph-level repair input), a ranked import, defer-until, or explicit reject — for structured diagnostics.

## Non-material observations

1. F1’s file and LLP citations are the right *kind* of evidence for a research doc; the load-bearing counts (“~13 `HandlerPlan` arms,” “~4,700 lines,” “seven graph node kinds,” `MAX_PLAN_STEPS = 64`) are not independently shown here. They color F2/I3/GPU-reject and should be pinned to named artifacts when this is consumed, but they do not by themselves reverse a recommendation.

2. Prior art for I2 cites Alive2 while F4 rejects SMT and I2 proposes differential testing. That is coherent if the import is the **generation/acceptance division of labor** only; the prior-art line should say so, or a reader will expect a formal translation validator.

3. F2 names five representations including a migration-intent IR, then never disposes of it. Reasonable if the source scope is reactive application code, but a unification-minded reader of F2 will think I1–I3 cover the fragmentation gap.

4. Mapping Halide “schedule” onto `classifyLocalMutationIrV1` is placement (where it may run), not Halide’s compute schedule (tiling, fusion, vectorization). The conversation’s generalized three-layer split allows that; do not let later work treat admission classification as cost-model extraction (that is the deferred e-graph item).

5. I1’s caveat on top-N and membership retractions is the right honesty. If I1 proceeds, wrong deltas are a live-data correctness failure and should sit next to LLP 0270’s trusted comparator rather than being treated as a pure matcher speedup. That is spec work, not a reason to drop the recommendation.

6. Related-header gaps (LLP 0068, 0234, 0307 appear in the body; LLP 0200 is listed and unused) are corpus hygiene.

7. Open questions 2–4 are the right research questions once the material overclaims above are withdrawn; OQ1 needs the I1 restatement in concern 2.

8. “What not to import” is the strongest section: GPU (bounded IR, no volume), new surface language (LLP 0304), CRDTs (OCC commitment, not a gap), SMT deferred until a checker actually needs it, e-graphs parked until authored plan shape is a measured bottleneck. Those dispositions can stand.

## Verdict
NOT READY

## Round 2 — 2026-08-25 (delta round on r2)

- Reviewer: `grok-4.6` @ xhigh, headless, terminal ban, no repository
  access; received r2 in full, the r1→r2 unified diff, and its own
  round-1 review only (cross-family blindness preserved).
- Revision under review: r2, target sha256/16 `f56cde3cca4dd3a4`
  (commit `bf3943a80`). Prompt sha256/16 `f449609fbe3b8f69`.
- Run: launched 2026-08-25T07:08:06Z, exit 0, empty stderr; body
  below is the complete stdout, verbatim (including the reviewer's two
  leading narration sentences about reading the offloaded prompt).

### Review body (verbatim)

The full prompt was offloaded; I’ll read it first so the review is based on the complete r1→r2 material.The offload cut off mid-document; I’ll read the remainder so the delta review covers all of r2.## Round-1 disposition check

1. **F1 over-identification / 0270 as speculate-then-check — DISPOSED.** Remainder map states the missing layers (implementation families, generation-time gate, subgraph-level diagnostics); 0270 is reclassified as runtime divergence detection of the same admitted IR, not an Alive2-style split.
2. **I1 three-fronts-one-derivation — DISPOSED.** Scope is two consumers (0209 G3-B, 0190 D3); replica continuity and 0190 custody contracts are explicit non-products; 0082 is F1 precedent; the “high on three-fronts” claim is gone; OQ1 no longer assumes one spec owns all three.
3. **I2 closes the declaration gap / silent lane promotion — DISPOSED.** Declaration conformance and plan derivation are separate products; promotion needs a named sound checker, residual risk, and non-silent failure; differential testing is a pre-filter; I3 no longer inherits the overclaim.
4. **I1–I4 ranking vs payoff/stakes — DISPOSED.** Architectural-leverage numbering is distinguished from do-now order (I4 probe + I1 spike, then I3-with-0274, I1 spec, I2 last).
5. **Source idea 6 undispositioned — DISPOSED.** F3 now records partial satisfaction (refusal/ledger/conformance reasons), an unmet remainder (conflicting subgraph + repairs), an owner line, and an explicit “not already satisfied.”

## MATERIAL concerns

None.

## Non-material observations

1. **IN-DELTA.** F1’s lead sentence still counts “three of the source’s layers” as closed-IR + contract + placement. The source’s three layers are contract / implementation family / schedule; closed IR is substrate, not the missing family layer. The remainder map prevents the r1 misread.
2. **IN-DELTA.** The leverage criterion (“how much of F2’s fragmentation map each import unifies”) is looser than I1’s actual product (one algebra, two consumers) and than I3’s reduced form (implement already-accepted 0274). The I1 body and the do-now list are what a program should follow.
3. **IN-DELTA.** Several r2 factual reversals are citation-grounded but unverifiable here (`FunctionWritePolicyV1` / 0274 successor carriers, 0146 D1 in `conformance.rs`, 0276 “structurally realized,” 0241 sub-identity diff vs atomic activation, 0307 closed, scanner past §S0). They are internally consistent; a consumer should check those artifacts rather than treat this document as the proof.
4. **IN-DELTA.** Related-header hygiene: LLP 0203 and LLP 0307 appear in the body and are absent from Related; LLP 0173 remains in Related with no body cite after the I2 rewrite.
5. **IN-DELTA.** Do-now’s “I1 scope spike” is unnamed (OQ1 vs a prototype). That is implementation-phase, not a scoping defect.
6. **PRE-EXISTING.** Numeric color (`~13` `HandlerPlan` arms, `MAX_PLAN_STEPS = 64`) is still unpinned to a counted artifact.

## Verdict
READY

## Round 3 — 2026-08-25 (delta round on r2→r3)

- Reviewer: `grok-4.6` @ xhigh, headless, terminal ban, no repository
  access; received r3 in full, the r2→r3 unified diff, and its own
  round-2 review only.
- Revision under review: r3, target sha256/16 `d9f306d0d91582b0`
  (commit `6583d3e07`). Prompt sha256/16 `07cabb87d898bf3f`.
- Run: launched 2026-08-25T07:35:04Z, exit 0, empty stderr; body
  below is the complete stdout, verbatim (including leading narration
  about reading the offloaded prompt).

### Review body (verbatim)

The offloaded prompt holds the full r2→r3 diff and r3 document. I’ll read that file first so the delta review is based on the complete material, without running any shell commands.The first chunk covers instructions, the r2 review, and the start of r3. Next I’ll read the rest of the document so the delta review covers the full text.I’ll grep the offloaded prompt for a few consistency checks (Related cites, leftover r2 wording) so the review rests on the full r3 text.## Round-2 disposition check

1. **NM1 F1 layer-count wording — DISPOSED.** Summary, F1 heading, and F1 lead now name the source’s three layers (contract / implementation family / schedule), call closed IR the substrate, and state that the family layer is the absence.
2. **NM3 unverifiable r2 reversals (scanner past §S0) — PARTIALLY DISPOSED.** The r2 “unresolved alias/computed paths go opaque” claim is gone and replaced by named exact-empty false negatives; those replacement claims, like the rest of NM3’s list, remain citation-grounded and unverifiable from this document alone.
3. **NM4 Related-header hygiene — DISPOSED.** LLP 0203 and LLP 0307 are in Related; LLP 0173 is out; body cites and Related now match.
4. **NM6 numeric pinning — PARTIALLY DISPOSED.** `~13` `HandlerPlan` arms are pinned to the enum in `crates/snapback-types/src/manifest/types.rs`; `MAX_PLAN_STEPS = 64` in F4 is still unpinned.

## MATERIAL concerns

None.

## Non-material observations

1. **IN-DELTA.** The one-line finding still says “strengthening the shipped declaration-conformance mechanism,” while I2(a) now refuses a default-strict change and names LLP 0146 D2 coverage as the import. “Strengthening” still covers shipping D2; a reader of the one-liner alone could hear a stronger 0146 amendment than the body now allows.
2. **IN-DELTA.** I2(a) says over-/under-declaration verdicts “legitimately live” in D2. That over-groups: D1 strict already verdicts observed under-declaration (`SNAPBACK_HANDLER_UNDECLARED_READ`/`_WRITE`). The F2 matrix is more careful (over-declaration and completeness are the aggregate remainder). No change to the I2(a) product is required.
3. **IN-DELTA.** Do-now still ranks “I2 last — gated on its open checker question” after I2(a) became 0146’s already-named D2 rung, which is not gated on OQ2. The checker gate belongs to I2(b). LLP 0146 can still run D2 on its own schedule; this is grouping, not a wrong owner.
4. **IN-DELTA.** F2 prose now splits captured point reads (exact positive wakes) from serialized query predicates (disjointness). The invalidation matrix residual still says only “captures prove disjointness only where captured.” The Today column remains right; the residual cell did not pick up the split.
5. **IN-DELTA.** New load-bearing status claims (scanner exact-empty holes, load-refusal of non-enforcing targets, `implementationHash` / envelope-member digests unused by any validation pass) are internally consistent and still unverifiable here. Same consumer rule as r2 NM3: check the artifacts; do not treat this document as the proof. The scanner holes, unlike `HandlerPlan`, are not pinned to a file.
6. **IN-DELTA.** The F1 confidence label still reads “closed-IR/contract/placement layers implemented” after the heading moved to substrate / contract / placement. Cosmetic leftover.
7. **PRE-EXISTING.** `MAX_PLAN_STEPS = 64` in F4 is still an unpinned numeric. The ranking criterion (“how much of F2’s fragmentation map each import unifies”) is unchanged and still looser than the I1/I3 bodies; those bodies and the do-now list remain what a program should follow.

## Verdict
READY
