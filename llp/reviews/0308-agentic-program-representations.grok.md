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
