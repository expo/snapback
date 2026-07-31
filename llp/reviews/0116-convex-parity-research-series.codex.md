# LLP 0116 review — Codex family


## Round 1 — 2026-07-30

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec` (model: gpt-5.6-sol)
**Reasoning effort:** CLI default
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh CLI runner, read-only sandbox, delta/synthesis review, cross-family blind for 0116 artifacts
**Target SHA-256:** `4d243213f84bcb6b646414afa90ae667e68fe30da78449bca87c6d1a69f5f827`
**Status:** completed

## Verbatim review

## Overall assessment

LLP 0116 is a strong, mostly faithful synthesis. All nine index-table headlines accurately reflect their reviewed siblings and preserve the important qualifications. The review-program record and answered OQ1/OQ2 are also accurate.

Two cross-cutting statements materially overstate their sources, however, and the Summary contains a straightforward diary-count error. Because the requested bar treats genuine factual error or misrepresentation as blocking, my verdict is **NOT READY**, narrowly.

## Per-row headline verification

- **0117 — VERIFIED.** Correctly captures the four mechanisms, CV-4/CV-5/CV-6 coverage, per-boundary cost, existing TypeScript toolchain, untyped handler interior, and reference-not-respell direction.
- **0118 — VERIFIED.** Faithful to Findings 1–2, 7, 10–11: deliberate narrowing, no historical open imports, same-file-first decision order, splice dominance under fresh invocation, and capability-freedom versus semantic purity.
- **0119 — VERIFIED.** Correctly preserves the evidence rationale, unreachable `SearchQuery` subscription path, hypothesis status of “mostly composition,” integration blockers, and unresolved quarantine diagnosis.
- **0120 — VERIFIED.** Accurately distinguishes aggregation/multi-child fan-out from joins, preserves the differing Non-goal statuses, and labels sequence allocation as a lean rather than a decision.
- **0121 — VERIFIED.** Correctly records LLP 0070 ownership, the three-part Convex advantage, terminal-mutation reactivity, receipt opportunity, and execution-guarantee split.
- **0122 — VERIFIED.** Accurately states publication-to-adoption, the three-day mismatch, and that packaging addresses mainly one part of broader product coherence.
- **0123 — VERIFIED.** Faithfully carries the two-artifact incident, labeled inference about Convex’s distribution, existing static/package options, and the strict-Host boot-probe hazard.
- **0124 — VERIFIED.** Correct on stale Draft storage ownership, absent vector owner, LLP 0073’s reserved vector slot, and LLP 0019’s unanswered placement question.
- **0125 — VERIFIED.** Correctly uses absence-of-regression language, acknowledges sparse contention coverage, and identifies the unscheduled remainder tracked by LLP 0115 OQ6.

## Cross-cutting findings

1. **Needs correction.** The decomposition thesis is sound, but “five coherence facets” and “one facet of five” are stale/over-exact. LLP 0122 actually numbers six facets and elsewhere says “at least five.” See [0116 §Cross-cutting finding 1](/Users/ccheever/projects/snapback/llp/0116-convex-parity-research-series.research.md:79) versus [0122’s decomposition](/Users/ccheever/projects/snapback/llp/0122-installed-product-coherence-and-packaging.research.md:225).
2. **VERIFIED.** The execution/adoption-lag synthesis is supported, including the qualification that 0118’s old emission design must be re-derived.
3. **VERIFIED.** The named unowned or unresolved design areas match 0117, 0119, 0120, 0124, 0125, and LLP 0115 v0.4.
4. **Needs correction.** “Convex’s … scheduled work [is] invisible at the evidence layer” is too broad. LLP 0121 explicitly says Convex job terminal state is inspectable through `_scheduled_functions`; Snapback’s proposed advantage is specifically proving the enqueue/write association and supplying stronger declared evidence—not making wholly invisible scheduled work visible. Compare [0116 finding 4](/Users/ccheever/projects/snapback/llp/0116-convex-parity-research-series.research.md:104) with [0121 Summary](/Users/ccheever/projects/snapback/llp/0121-transactional-one-off-scheduling.research.md:38) and [Option 3](/Users/ccheever/projects/snapback/llp/0121-transactional-one-off-scheduling.research.md:379).
5. **VERIFIED as synthesis.** The option ranking is compressed but consistent with the siblings’ evidence-regression analyses.
6. **VERIFIED.** All four corrections match the siblings and current code spot-checks, including the dead `resultOnly` metadata, missing `./online` types export, and static-link/search-admission facts.
7. **Mostly verified.** Counts, convergence, “none refuted,” corrected reviewer paraphrases, and highlighted catches match the journal. The closing assertion that executing code would have found them “later and more expensively” is an unsupported counterfactual; label it as inference or remove it.

## Concerns

- **Material — scheduled-work visibility overstatement.** Finding 4 contradicts 0121’s explicit record of Convex system-table inspectability. Narrow the claim to transactional enqueue association/receipt evidence.
- **Material — coherence facet count.** Finding 1 converts “at least five” into exactly five despite 0122 numbering six. Use “multiple facets” or “at least six,” and describe packaging as addressing mainly the install/naming facet.
- **Minor — diary count.** The Summary says “Ten agent-authored diaries,” while the cited ranges name fourteen files: 0022, 0027–0031, and 0032–0039. See [0116 Summary](/Users/ccheever/projects/snapback/llp/0116-convex-parity-research-series.research.md:23). If synthesis diaries are intentionally excluded, state the counting rule.
- **Minor — unsupported counterfactual.** Finding 7’s “later and more expensively” conclusion is not established by the journal; the journal establishes that the reviews found real, subsequently verified issues.

The answered OQ1 and OQ2 records are accurate. OQ1 matches the approved topology and convergence table in the [program journal](/Users/ccheever/projects/snapback/llp/reviews/0116-0125-convex-parity-series.super-refine.md:13); OQ2 matches LLP 0115 v0.4’s Analysis column and new OQ6–OQ7.

## Verdict

**NOT READY**, narrowly. The index itself is ready, but cross-cutting finding 4 genuinely misrepresents 0121, and finding 1 states an incorrect exact count.

## Recommended next step

Make the four small textual corrections above, then perform a narrow Codex fix-verification limited to those sentences. No sibling re-review or additional empirical work is warranted.

## Round 2 — 2026-07-30 (fix verification)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec` (model: gpt-5.6-sol)
**Reasoning effort:** CLI default
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh CLI runner, read-only sandbox, fix-verification of the v0.3 corrections to the four Round 1 items only (no full re-review), cross-family blind for 0116 artifacts
**Target SHA-256:** `37a5c1cc9724177ca17d9a0ee4f9a999732a0680b9557c9b15cc939b85850650`
**Status:** completed

### Verbatim review

- **Item 1 — scheduled-work visibility: VERIFIED.** Finding 4 now acknowledges `_scheduled_functions` terminal-state inspection and narrows Snapback’s advantage to producer/enqueue correlation plus append-only attempt evidence. This matches [LLP 0121](/Users/ccheever/projects/snapback/llp/0121-transactional-one-off-scheduling.research.md:185) and its evidence comparison at line 241.

- **Item 2 — coherence facets: VERIFIED.** Both revised occurrences say “at least five” and describe packaging as addressing mainly the install facet. LLP 0122 explicitly supports that formulation while enumerating six facets. See [LLP 0122](/Users/ccheever/projects/snapback/llp/0122-installed-product-coherence-and-packaging.research.md:225) and line 663.

- **Item 3 — diary count: VERIFIED.** The referenced corpus contains exactly fourteen files: `0022-backend-bakeoff`, 0027–0031, and 0032–0039. The colliding `0022-catalog-lens` is correctly disambiguated and excluded. The revised summary is accurate at [LLP 0116](/Users/ccheever/projects/snapback/llp/0116-convex-parity-research-series.research.md:45).

- **Item 4 — unsupported counterfactual: VERIFIED.** Finding 7 now explicitly labels “running the code would have found them later and more expensively” as the overview’s inference, not a journal finding. The surrounding factual claims match the [program journal](/Users/ccheever/projects/snapback/llp/reviews/0116-0125-convex-parity-series.super-refine.md).

No fresh defect was introduced in these corrected sentences.

**Verdict: READY.**

**Recommended next step:** append this Codex fix-verification as a dated round to the Codex review artifact, then return LLP 0116 to the author for status adjudication under LLP 0005.
