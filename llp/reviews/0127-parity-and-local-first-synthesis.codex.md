# LLP 0127 review — Codex family


## Round 1 — 2026-07-30

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default (medium)
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh CLI runner, read-only sandbox, mutually blind on 0127 artifacts
**Target SHA-256:** `e7c17fdeb93b68452bb680ae40fad4359e32fb2fff27de14c7b28bb294cdf4f7`
**Instruction SHA-256:** `d9c98b1fb05479a4ac22e10821ec527aeee3bb6b980129d798fdb115f7f6f8c7`
**Status:** completed

## Verbatim review

## 1. Overall assessment

LLP 0127 is a strong synthesis with a coherent evidence-first thesis, faithful handling of most source findings, and unusually good routing to owning documents. The six moves generally preserve the research corpus’s distinctions between shipped facts, hypotheses, proposals, and empirical gates.

It does not yet meet the stated READY bar. Two coverage/sequencing contradictions and several smaller overclaims mean the RFC currently promises more complete composition than its own sources support. These are pre-empirical document defects, not implementation questions.

## 2. Strengths

- The central “receipts instead of magic” principle accurately synthesizes LLP 0116 findings 4–5 without weakening LLP 0115’s governing constraints ([0127 Summary](/Users/ccheever/projects/snapback/llp/0127-parity-and-local-first-synthesis.rfc.md:11)).

- Move 1 faithfully preserves the crucial distinction between contract checking and contract minting. Its A → E/F → G ordering matches LLP 0117’s composition and strictness dependency, and its CV-5 carrier treatment correctly states that `argsContractHash` is a witness, not a carrier ([0127 Move 1](/Users/ccheever/projects/snapback/llp/0127-parity-and-local-first-synthesis.rfc.md:47); [0117 CV-5](/Users/ccheever/projects/snapback/llp/0117-typescript-type-flow-parity.research.md:552)).

- Move 2 is highly faithful to LLP 0118: both motivating cases are same-file; graph scope precedes emission; resolve-and-splice dominates under fresh-per-invocation execution; context-capability-freedom is not purity; and hermetic package closure is deferred rather than incorrectly dismissed ([0127 Move 2](/Users/ccheever/projects/snapback/llp/0127-parity-and-local-first-synthesis.rfc.md:105); [0118 findings](/Users/ccheever/projects/snapback/llp/0118-handler-composition-and-helper-reuse.research.md:863)).

- Move 3 keeps speculative and settlement evidence distinct, retains 0070’s at-least-once semantics rather than claiming Convex-style exactly-once, and correctly treats the execution-identity tuple as more than a content hash ([0127 Move 3](/Users/ccheever/projects/snapback/llp/0127-parity-and-local-first-synthesis.rfc.md:156); [0126 approach 9](/Users/ccheever/projects/snapback/llp/0126-local-first-and-local-sync.research.md:459)).

- Move 4 handles the live-search evidence boundary well. It repeats LLP 0119’s integration-blocker inventory, retains the separate capability requirement, labels “composition rather than invention” as a hypothesis, and refuses to smooth authorization revocation ([0127 Move 4](/Users/ccheever/projects/snapback/llp/0127-parity-and-local-first-synthesis.rfc.md:231)).

- Move 5 preserves LLP 0123’s most important review discovery: a naïve boot probe consumes the one-shot strict-Host handoff, so serving-boundary qualification cannot proceed until it is posture-neutral ([0127 Move 5](/Users/ccheever/projects/snapback/llp/0127-parity-and-local-first-synthesis.rfc.md:280); [0123 Option 2](/Users/ccheever/projects/snapback/llp/0123-runtime-readiness-and-operational-edges.research.md:334)).

- Move 6 correctly carries forward aggregate result semantics, protected-source noninterference, enforced rather than diagnostic-only budgets, and the maturity-route gate. The exclusions likewise cite real least-promising findings rather than constructing straw alternatives.

- The npm gate, local-first program shape, and maturity route are visibly proposed and routed to the author. I found no move that silently treats any of those three decisions as already ratified.

## 3. Concerns

1. **BLOCKING-FOR-BAR — “0126 in full” is not supported, and the first-slice claim obscures the scored arm’s retainability limit.**

   Move 3 says it covers “0126 in full,” and its first slice calls option A’s work “the diaries’ exact GAP rows” ([0127 lines 197–222](/Users/ccheever/projects/snapback/llp/0127-parity-and-local-first-synthesis.rfc.md:197)). But LLP 0126 says the scored browser arm used protected opaque queries, which remain non-retainable by design even under option A. Thus default persistence cannot provide cold retained protected rows for that exact arm without moving LLP 0053’s invariant ([0126 findings 3–4](/Users/ccheever/projects/snapback/llp/0126-local-first-and-local-sync.research.md:1067)).

   The RFC also silently omits 0126’s offline-search question and option F’s independently composable explicit-sync lane. Those may be excluded, but “in full” and the composition-map row require them to be named as residuals.

   **Resolution:** qualify option A’s first slice explicitly—cold retention only for retainable/analyzable surfaces—and add protected opaque retention, offline search, and explicit-sync F to the residual/exclusion accounting. Replace “0126 in full” with the exact subset actually selected.

2. **BLOCKING-FOR-BAR — Move 5’s first slice and v0.5 absorption are internally inconsistent.**

   Move 5’s first slice includes the CV-1 external workout rebuild “once the custody decisions land” ([0127 line 325](/Users/ccheever/projects/snapback/llp/0127-parity-and-local-first-synthesis.rfc.md:325)). The conclusion nevertheless says none of the open questions blocks Move 5’s first slice, even though open question 4 is precisely admin-client/test-helper custody ([0127 lines 598–620](/Users/ccheever/projects/snapback/llp/0127-parity-and-local-first-synthesis.rfc.md:598)).

   More broadly, the proposed 0115 v0.5 mapping equates Move 5 with Tranche A plus polish, but Move 5’s load-bearing sealed-artifact program also includes adopter-only co-packaging, assembly-boundary qualification, static-versus-dynamic policy, and a posture-neutral serving witness. CV-1/2/3 do not sequence all of that. The RFC therefore lacks sequencing authority for part of its own central move.

   **Resolution:** split the unblocked CV-2/`types` work from the custody-blocked CV-1 rebuild, and either add explicit 0115 work items for the sealed-artifact components or declare them a separately sequenced owner program with named cross-gates.

3. **MATERIAL — The 0122 composition-map cell does not cover all five facets it invokes.**

   LLP 0122 decomposes coherence into naming unity, one CLI entry point, one documentation dialect, app-owned artifacts, and a silent runtime. Move 5 covers or residualizes four, but drops the one-CLI question and LLP 0122 OQ6 concerning `@snapback/app-cli`. Yet it claims “0122 and 0123 in full.”

   **Resolution:** add the one-CLI/app-CLI question as an explicit residual or incorporate it into Move 5’s owner and decision list.

4. **MATERIAL — Move 1 conflates return-inference relief with the return-inference mechanism.**

   It claims 0117 mechanisms (a)–(d) “in full” while using E’s declaration compression as “return-inference relief.” E reduces transcription but does not implement mechanism (a), and the composition map correctly lists full inference as unadopted.

   **Resolution:** say the move addresses all four *felt gaps* while deliberately replacing return inference with declaration compression, or say it covers mechanisms (b)–(d) plus an alternative response to (a).

5. **MATERIAL — The asserted Move 6 → Move 4 vocabulary dependency is not traceable as written.**

   The composition paragraph says “move 6’s profiles are move 4’s matcher vocabulary” ([0127 line 415](/Users/ccheever/projects/snapback/llp/0127-parity-and-local-first-synthesis.rfc.md:415)). LLP 0119’s live-search path uses the `SearchQuery` matcher arm and 0073 search grammar; Move 6 chiefly proposes relational profiles, aggregate nodes, and partial-replica admission. A broad family resemblance between declared bounded shapes is not yet one shared artifact or grammar.

   **Resolution:** identify the concrete shared descriptor, owner, and consumer mapping, or weaken this to an architectural analogy rather than a dependency.

6. **DETAIL — The 0115 sequencing amendment needs a carve-out for breadth work.**

   LLP 0115 currently says Tranche A runs “first, and alone,” while 0127 proposes starting storage/vector ownership in parallel with Tranche A. That is a legitimate proposed OQ7 answer, but v0.5 must amend the “alone” sentence explicitly.

7. **DETAIL — Several “first slices” are bundles rather than singular vertical slices.**

   Move 3 names two independent programs as one substrate’s first slice, and Move 5 combines runtime qualification, export-map repair, and an external workout rebuild. This is not fatal, but it weakens sizing clarity.

   **Resolution:** label them independent first pilots and give each its own completion boundary and blockers.

## 4. Suggestions

- Replace every “in full” formulation with either a closed checklist or a narrower claim such as “covers the headline gap while retaining these residuals.”

- Add a traceability identifier to each composition-map cell, pointing to the exact source finding, selected option, residual, and owning destination.

- Distinguish “shared principle,” “shared artifact,” and “hard prerequisite” in the final composition paragraph.

- In Move 5, separate adopter distribution, contributor qualification, serving readiness, and first-hour CI. They compose, but they have different owners and gates.

## 5. Open questions

1. Is “in full” intended to mean every source option, every headline finding, or merely the selected strategic direction? The present text uses all three senses.

2. Does the author want the sealed-runtime work itself sequenced by LLP 0115, or only cross-gated from its existing owners?

3. Is offline search intentionally outside the local-first successor Plan? If so, where is that exclusion recorded?

4. Is the one-CLI facet deliberately deferred, or was it lost when 0122 was compressed into Move 5?

## 6. Verdict

**NOT READY.**

The RFC is close in conceptual quality, but the local-first coverage overclaim and Move 5 sequencing contradiction fail the capsule’s coverage-honesty and sequencing-coherence requirements. Both are resolvable without implementation or empirical work.

## 7. Recommended next step

Revise the 0126 and 0122 composition-map cells, split Move 5’s first slice and sequencing destinations, explicitly amend 0115’s “Tranche A alone” rule, and tighten the “in full” claims. Then run a focused dual-family delta review limited to those changes and their cross-move dependencies. The three forced author decisions should remain open unless the author separately adjudicates them.

**NOT READY**

## Round 2 — 2026-07-30

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default (medium)
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh CLI runner, read-only sandbox, round-2 delta review of `git diff 2fb51bdb -- llp/0127-parity-and-local-first-synthesis.rfc.md` at commit 90fa0501, round-1 record required reading, mutually blind on the Fable 0127 artifact
**Target SHA-256:** `c3b2175dba330f247607de37af91029130feaa69a13b0cd5ee21f0c7d9356aa4`
**Instruction SHA-256:** `d9c98b1fb05479a4ac22e10821ec527aeee3bb6b980129d798fdb115f7f6f8c7`
**Status:** completed

### Verbatim review

## Per-item resolution check

1. **0126 accounting — PARTIALLY RESOLVED.** The revised Move 3 and composition-map cell now correctly name:

   - protected opaque queries as non-retainable under LLP 0053;
   - offline search as unowned;
   - the unbuilt delta-resume consumer;
   - option F as a successor-Plan rider.

   However, the closing assertion that “no front outside 0124 needs a mechanism not already in the set” contradicts those residuals, particularly unowned offline search and option F’s backup/export/restore surface ([0127](/Users/ccheever/projects/snapback/llp/0127-parity-and-local-first-synthesis.rfc.md:492), [closing claim](/Users/ccheever/projects/snapback/llp/0127-parity-and-local-first-synthesis.rfc.md:506)).

2. **Move 5 slice split and CV-1 custody — RESOLVED.** `5-qual`, `5-types`, and custody-blocked `5-rebuild` are separated, and the closing accounting correctly says custody blocks `5-rebuild` and CV-1’s exit—not the other two slices ([0127](/Users/ccheever/projects/snapback/llp/0127-parity-and-local-first-synthesis.rfc.md:393), [accounting](/Users/ccheever/projects/snapback/llp/0127-parity-and-local-first-synthesis.rfc.md:741)).

3. **0122 one-CLI facet and OQ6 — RESOLVED.** `@snapback/app-cli` placement is now an explicit decision and composition-map residual; the unadopted meta-package is also accounted for ([0127](/Users/ccheever/projects/snapback/llp/0127-parity-and-local-first-synthesis.rfc.md:402), [map](/Users/ccheever/projects/snapback/llp/0127-parity-and-local-first-synthesis.rfc.md:488)).

4. **Move 1 narrowed claim — RESOLVED.** The text now states that E compresses declarations but never infers, mechanism (a) remains unimplemented, and infer-then-freeze C is 0117’s conditional bridge ([0127](/Users/ccheever/projects/snapback/llp/0127-parity-and-local-first-synthesis.rfc.md:96)).

5. **Move 6/Move 4 coupling — RESOLVED.** It is explicitly a shared-principle “architectural rhyme,” not an artifact dependency ([0127](/Users/ccheever/projects/snapback/llp/0127-parity-and-local-first-synthesis.rfc.md:494)).

6. **0115 §Sequencing-1 amendment — RESOLVED.** The proposed v0.5 now explicitly amends “Tranche A first, and alone” with the product-breadth carve-out ([0127](/Users/ccheever/projects/snapback/llp/0127-parity-and-local-first-synthesis.rfc.md:597)).

7. **Slice sizing — RESOLVED.** The Round 1 bundles in Moves 3 and 5 are split into separately named pilots/workstreams with distinct blockers and boundaries.

## New concerns

- **MATERIAL — Global composition claim contradicts the newly explicit 0126 residuals.** The document cannot simultaneously say offline search is unowned and option F is a separate successor-Plan rider, then conclude that every non-0124 front needs no mechanism outside the six-move set. Resolve by narrowing the closing claim to covered headline gaps, explicitly excepting named residuals.

- **DETAIL — The 1a attribution remains internally inconsistent.** Move 4 correctly says selecting 1a is this RFC’s judgment because LLP 0119 ranks neither hybrid. Later, “only the 1a hybrid is pre-registered (0119 finding 6)” again makes the source appear to select it ([0127](/Users/ccheever/projects/snapback/llp/0127-parity-and-local-first-synthesis.rfc.md:530)). Finding 6 only establishes that 1a/1b make simplicity compatible with per-function facts. Attribute the pre-registration to this RFC, informed by finding 6.

## Verdict

**NOT READY.**

The substantive Round 1 repairs are strong, but the remaining global accounting contradiction prevents concern 1 from being genuinely closed under the stated bar.

## Recommended next step

Make the two narrow textual corrections above, then run a final focused delta check of the composition-map closing paragraph and Move 4’s 1a attribution. No broader redesign or renewed corpus review appears necessary.

## Round 3 — 2026-07-30

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default (medium)
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh CLI runner, read-only sandbox, round-3 final focused check (requested by Round 2) of the two Round 2 items against the v0.3 fix (`git diff 90fa0501 -- llp/0127-parity-and-local-first-synthesis.rfc.md`), plus a no-fresh-defect check on the completed items 7–10 blocked-accounting and the 1a locating clause; Round 2 record required reading, mutually blind on the Fable 0127 artifact
**Target SHA-256:** `340a5f47122e36bdec7e7c6d8bb2ccf34cf127b0023c4cbcff49493fd31d9b24`
**Instruction SHA-256:** `d9c98b1fb05479a4ac22e10821ec527aeee3bb6b980129d798fdb115f7f6f8c7`
**Status:** completed

### Verbatim review

**Verdict: READY**

1. **MATERIAL — RESOLVED:** The closing claim now explicitly excludes all four LLP 0126 residuals and no longer asserts complete six-move coverage.
2. **DETAIL — RESOLVED:** The 1a pre-registration is clearly this RFC’s judgment, merely informed by LLP 0119 finding 6, which selects neither hybrid.
3. **Items 7–10 accounting — CLEAN:** The added blocker/exit mapping matches the stated slices, successor work, and Move 3’s five owner-landings.
4. **1a locating clause — CLEAN:** It precisely limits erasure to the function-kind surface while retaining the declared subscribability fact in the manifest entry.

**Recommended next step:** Append this Round 3 READY verdict to the Codex review artifact; the author may then conclude the LLP 0005 review loop and decide LLP 0127’s status.
