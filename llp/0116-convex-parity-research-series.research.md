# LLP 0116: Convex parity research series — overview

**Type:** Research
**Status:** Draft
**Systems:** Competitive evaluation, Developer experience, Authoring, Application data API, Code generation, Runtime, Bootstrap, Packaging, Search, Relational queries, Scheduled work, Client integration, Assets, Storage, Documentation, Testing
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-30
**Revised:**
**Related:** LLP 0115, LLP 0117, LLP 0118, LLP 0119, LLP 0120, LLP 0121, LLP 0122, LLP 0123, LLP 0124, LLP 0125, Diary 0022, Diary 0027–0031, Diary 0032–0039

## Summary

Ten agent-authored diaries — the five-backend bakeoffs (Diary 0022,
0027–0031) and the current-main seven-app Snapback × Convex rerun
(Diary 0032–0039) — form the most complete record we have of why agents
building the same applications on both backends still prefer Convex on
several fronts. Diary 0039 scored the rerun roughly 55/45 in Convex's
favor, and LLP 0115 already sequences the corrective work as a Plan.

This document heads a nine-document Research series that does what a Plan
cannot: think each preference through to the bottom. Every series document
covers, for one front, what Convex actually does, what Snapback actually
does on current main (code-verified, not diary-reported), why the diaries
scored Convex ahead, where Snapback is genuinely stronger, and a
several-path option space with the benefits, costs, risks, and
evidence-model consequences of each path. No series document makes a final
call. Design authority stays with the owning documents, sequencing
authority stays with LLP 0115, and the series exists so that when we do
synthesize concrete changes, the choices are made with the whole option
space visible rather than the first plausible mechanism.

## The series

| LLP | Front | Headline finding |
| --- | --- | --- |
| 0117 | TypeScript type flow: inference, result contracts, structured inputs | The gap decomposes into four separable mechanisms — return inference, structured inputs, omission policy, interior typing — and LLP 0115's board covers only the middle two; a schema-referencing contract vocabulary could attack the measured authoring bulk with zero inference |
| 0118 | Handler composition and helper reuse | The duplication is a designed consequence of LLP 0108's narrowing, not an oversight; Snapback has never had open handler imports, and reviving 0108's bounded static bundling — with a resolve-and-splice execution shape — leads the options |
| 0119 | Reactive-by-default and live search | The live boundary is a documented evidence choice, and coarse live search is mostly composition of already-shipped pieces (a `SearchQuery` matcher arm exists in the live matcher); the quarantine flicker is a wake-precision problem, not a smoothing one |
| 0120 | Relational composition and aggregation | The parity gap is aggregation and multi-child fan-out, not joins — every rerun pain shape is a declared Non-goal of both relational owners; a sequence-allocation primitive is the smallest high-leverage move (three independent demand sites) |
| 0121 | Transactional one-off scheduling | The design already exists in LLP 0070; Convex's advantage decomposes into transactional enqueue, near-zero ceremony, and ordinary-query inspectability — and receipts plus a generated job-status query could out-evidence Convex, not just match it |
| 0122 | Installed-product coherence and packaging | The problem has moved from publication to adoption: the `0.1.0` closure was public and clean-machine-proven three days before the matrix still ran on checkout imports; coherence decomposes into five facets of which the package closure fixes mainly install |
| 0123 | Runtime readiness and operational edges | The incident class is a distribution-shape problem — two swappable artifacts — that Convex makes unrepresentable by sealing engine and server together; static linking already exists unused in-tree (`HERMES_LINK_STATIC`), and sealed per-platform runtime packages already exist |
| 0124 | Product breadth: file storage and vector search | Ownership is asymmetric: storage has a real but stale Draft owner (LLP 0044, zero implementation) while vector search has no owning design document at all; LLP 0073's staged-adapter frame is the honest admission path for vectors |
| 0125 | Concurrency and conflict ergonomics | The retry half is genuinely fixed and held (client-side reservation retry, code-verified); the open remainder — action/mutation failure-shape split, domain-typed rejections, burst performance — is covered by no LLP 0115 CV item |

## Method and provenance

Three evidence layers, kept distinct in every document's Confidence
section:

1. **Diary-recorded comparisons.** The bakeoffs and the rerun were
   authored by agents building the same application contracts on both
   backends with acceptance evidence on both sides. Convex behavior claims
   sourced from the diaries carry that provenance; general background
   knowledge of Convex is labeled as such and is not treated as evidence.
2. **Code verification on current main.** Each document spot-checked its
   load-bearing Snapback claims against the working tree (the rerun's
   revision lineage, `01e94173` and successors) and cites paths in prose.
   Several diary-era claims did not survive this check — the corrections
   are findings, listed below.
3. **Owning-document review.** Each document reads its owners (LLP 0004,
   0010, 0028, 0041, 0044, 0059, 0070, 0073, 0080, 0108, 0110, 0111,
   0112, 0113, 0114, and others) and records where a diary pain is
   already designed, already fixed, or genuinely unowned.

## Cross-cutting findings

1. **"Convex is better here" almost never names one mechanism.** Each
   front decomposed under analysis: four type-flow mechanisms (0117),
   three scheduling properties (0121), five coherence facets (0122).
   Parity work that targets the slogan rather than the decomposition will
   buy less than the diaries suggest — most visibly in 0122, where the
   package closure fixes one facet of five.
2. **The dominant shape is execution lag, not design absence.** The retry
   complaint is fixed (0125); one-off scheduling is fully designed in
   LLP 0070 (0121); helper bundling was designed and demoted on review
   timeout, not rejection (0118); storage has a Draft owner (0124);
   static linking exists as an unused build mode (0123); the package
   closure is published but unconsumed (0122). This matches LLP 0115's
   v0.2 audit bucket (1) and sharpens it: the scarce resource is
   finishing and adoption, not invention.
3. **The genuine design holes are fewer and now named.** Vector search
   has no owner (0124); return inference and interior typing are owned by
   nothing on 0115's board (0117); failure-shape unification,
   domain-typed rejections, and burst performance have no CV item
   (0125); the aggregate profile question is open by declared Non-goal
   (0120); live search is a real hole with a shipped head start (0119).
4. **Several options would out-evidence Convex rather than imitate it.**
   Convex's automatic retries and scheduled work are invisible at the
   evidence layer; Snapback can make the same ergonomics visible —
   retry-as-evidenced-contract (0125), enqueue receipts plus a declared
   job-status query (0121), declared read budgets over imperative
   handlers (0120). Where the series found paths that keep Convex's
   ceremony level while adding receipts, those paths lead their option
   spaces.
5. **The no-evidence-regression constraint filtered every option space
   the same way.** The consistently least-promising options are the ones
   that erase a boundary to erase its cost: open module imports (0118),
   erasing the live classification (0119), an unbounded general query
   language (0120), permanent nonclaims where the diaries scored GAPs
   (0124). The consistently most-promising options keep the boundary and
   move its cost into generated artifacts or receipts.
6. **Corrections to the record surfaced by code verification.** CV-7's
   indexed-read-duplication evidence is Relay Board (Diary 0033), not
   Campfire (0118); "result-contract-only" validators are literally two
   disjoint validation lanes with a dead `resultOnly` flag (0117); the
   degraded-contract escape is a working mechanism defeated by
   `severity: 'info'` policy, not a missing diagnostic (0117, confirming
   0115's v0.2 finding); the `@snapback/client/online` missing-types gap
   found independently by three bakeoff arms is still unfixed (0122).
   These are candidate LLP 0115 amendments, author-gated.

## What this series is not

It is not a plan — LLP 0115 sequences the work and stays the sequencing
authority. It is not a set of specs — each front's substantive design
lands in its owning document or a new owned Spec, per 0115's governing
constraint. And it does not re-litigate the retired gaps: full-text
search, inline colocation, exact result contracts, manifest-only custody,
indexed pagination, and the other first-bakeoff complaints that current
main already fixed stay retired.

## Confidence

High on the diary record (direct quotation and section citation
throughout the series), high on current-main Snapback behavior where
code-verified (each document separates verified from reported), moderate
on Convex internals (diary-evidenced behavior is provenance-tracked;
mechanism explanations from general knowledge are labeled). The series
was authored 2026-07-30 against the post-rerun tree; the fleet lands
changes daily, so per-document Confidence sections date their
verifications.

## Open questions

1. Which series documents should graduate to review loops (LLP 0005
   scale) before their fronts' next design step, and which are
   sufficient as thinking records?
2. **Answered 2026-07-30:** the candidate amendments landed as LLP 0115
   v0.4 — corrections applied, the status board gained an Analysis
   column pointing each CV item at its series document, and the unowned
   remainders became 0115's open questions 6–7 (author-gated).
3. When concrete changes are synthesized from these option spaces, do
   they land as amendments to owning documents, new Specs, or a
   successor Plan tranche — and does 0115 absorb the unowned items
   (0125's remainder, 0117's uncovered mechanisms, 0124's vector
   ownership) or delegate them to new owners first?
