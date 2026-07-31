# LLP 0116: Convex parity research series — overview

**Type:** Research
**Status:** Active
**Systems:** Competitive evaluation, Developer experience, Authoring, Application data API, Code generation, Runtime, Bootstrap, Packaging, Search, Relational queries, Scheduled work, Client integration, Assets, Storage, Documentation, Testing
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-30
**Revised:** 2026-07-30 (v0.3, own dual-family delta-review fixes —
Round 1 reviews in
`reviews/0116-convex-parity-research-series.fable.md` and
`reviews/0116-convex-parity-research-series.codex.md`; both families
NOT READY on sentence-level items only, with all nine index-table
headlines verified faithful to the reviewed siblings by both. The
overlapping items applied once: the Summary's diary count corrected
from ten to fourteen and "five-backend bakeoffs" re-phrased to
multi-backend (arm counts varied per diary — Diary 0022 ran three
arms, and 0120 records Diary 0029 as the seven-backend Linear
bakeoff), Diary 0022 disambiguated to `0022-backend-bakeoff`,
cross-cutting finding 4 narrowed to what 0121 supports (Convex
terminal state is inspectable in `_scheduled_functions`; the lack is
the enqueue-association receipt and attempt ledger), finding 1
aligned to 0122's "at least five facets" / "addresses mainly the
install facet", finding 7's code-running counterfactual labeled as
this overview's inference, the 0117 row restored to joint
alongside-the-structured-input-extension phrasing, and the Method
section extended with the review program's dated official-Convex-docs
verification lane, stated as it actually landed: dated docs pins in
0121 and 0124, a package-version pin in 0125.)
2026-07-30 (v0.2, post-review-program refresh — the nine
sibling documents completed the tiered LLP 0005 review program journaled
in `reviews/0116-0125-convex-parity-series.super-refine.md` (Tier 1
super-refine on 0117/0118/0122/0123; single-round dual-family on
0119/0120/0121/0124/0125), so this overview is trued up against their
reviewed v0.2–v0.5 texts: index-table headlines corrected where review
changed the finding (most substantially 0117, 0118, 0119, 0120, 0123,
0125), cross-cutting findings 2, 3, 4, and 6 adjusted to the reviewed
claims, a new cross-cutting finding 7 records what the review program
itself demonstrated, and open question 1 is answered with the executed
program and verdicts. Status advanced to Review for this document's own
delta review, per the journal's plan.)
**Related:** LLP 0115, LLP 0117, LLP 0118, LLP 0119, LLP 0120, LLP 0121, LLP 0122, LLP 0123, LLP 0124, LLP 0125, Diary 0022, Diary 0027–0031, Diary 0032–0039

## Summary

Fourteen agent-authored diaries form the most complete record we have
of why agents building the same applications on both backends still
prefer Convex on several fronts: the multi-backend bakeoffs — Diary
0022 (`0022-backend-bakeoff`; the number collides with
`0022-catalog-lens`, so the slug matters) and Diaries 0027–0031 — and
the current-main seven-app Snapback × Convex rerun (Diary 0032–0039).
Diary 0039 scored the rerun roughly 55/45 in Convex's favor, and
LLP 0115 already sequences the corrective work as a Plan.

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
| 0117 | TypeScript type flow: inference, result contracts, structured inputs | The gap decomposes into four separable mechanisms — return inference, structured inputs, omission policy, interior typing — and LLP 0115's board covers only the middle two, with CV-5's typed search AST mapped here as a structured-input instance; the felt cost is per-boundary (totals are tied), the interior gap is untyped handler flow rather than a missing toolchain, and schema-referencing reference-not-respell compression is, alongside the structured-input extension, the most promising near-term option |
| 0118 | Handler composition and helper reuse | The duplication is a designed consequence of LLP 0108's narrowing, not an oversight, and Snapback has never had open handler imports; both motivating instances are same-file, so the same-file lexical slice (1a) precedes the emission question, resolve-and-splice dominates group-bundle under the shipped fresh-per-invocation lifecycle, and the statically provable helper lane is context-capability-freedom — not purity, which needs a separate side-effect analysis |
| 0119 | Reactive-by-default and live search | The live boundary is a documented evidence choice; coarse live search has real shipped ingredients but no end-to-end path — the `SearchQuery` matcher arm is unreachable through any valid subscription, so "mostly composition" is the option's hypothesis, with a named integration-blockers inventory — and quarantine flicker must not be fixed by smoothing the revocation path; whether it is a declaration gap or an obligation-lane cost is an open diagnosis |
| 0120 | Relational composition and aggregation | The parity gap is aggregation and multi-child fan-out, not joins — every rerun pain shape falls outside both relational owners' admitted surface, though not uniformly as Non-goals; the demand decomposes into three primitives, of which sequence allocation is the smallest (two demonstrated demand sites, one inferred reuse) — a labeled lean, not a call |
| 0121 | Transactional one-off scheduling | The design already exists in LLP 0070; Convex's advantage decomposes into transactional enqueue, near-zero ceremony, and inspectability — of which domain-result reactivity already falls out of 0070's terminal mutation — and enqueue receipts could out-evidence Convex, not just match it, with the differing execution guarantees (uniform at-least-once/fenced vs Convex's exactly-once/at-most-once split) stated in any parity claim |
| 0122 | Installed-product coherence and packaging | The problem has moved from publication to adoption: the `0.1.0` closure was public and clean-machine-proven three days before the matrix still ran on checkout imports; coherence decomposes into at least five facets of which the package closure fixes mainly install |
| 0123 | Runtime readiness and operational edges | The incident class is a distribution-shape problem — two swappable artifacts — whose coherence boundary Convex's tested workflow never exposed (the sealed engine+server account is labeled inference); static linking (`HERMES_LINK_STATIC`) and per-platform runtime packages already exist unused, and any boot-qualification probe must not consume the one-shot strict-Host handoff — readiness evidence must not weaken the posture it verifies |
| 0124 | Product breadth: file storage and vector search | Ownership is asymmetric: storage has a real but stale Draft owner (LLP 0044, zero implementation) while vector search has no owning design document at all; LLP 0073's staged, evidence-first pattern already reserves the vector slot, giving admission a paved on-ramp — where the vector design should live is 0019's still-open question |
| 0125 | Concurrency and conflict ergonomics | The retry half is fixed and held in absence-of-regression form (client-side reservation retry, code-verified; the rerun ran few direct contention exercises); the open remainder — the action/mutation failure-shape split, declaration-closed rejection unions (the host-plan `elseError`/`guard` channel already exists), burst profiling — is named by LLP 0115 v0.4's open question 6 but scheduled by no CV item |

## Method and provenance

Three evidence layers, kept distinct in every document's Confidence
section:

1. **Diary-recorded comparisons.** The bakeoffs and the rerun were
   authored by agents building the same application contracts on both
   backends with acceptance evidence on both sides. Convex behavior claims
   sourced from the diaries carry that provenance; general background
   knowledge of Convex is labeled as such and is not treated as evidence.
   The review program added a third verification lane on the Convex side
   of that split: 0121 and 0124 verify their load-bearing Convex
   mechanism claims against official Convex documentation live-fetched
   with dated consultation pins (2026-07-30; the docs are rolling and
   undated, so the consultation date is the version pin), and 0125 pins
   its general Convex background to the package version the bakeoffs ran
   (`convex` 1.42.x).
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
   three scheduling properties (0121), at least five coherence facets
   (0122). Parity work that targets the slogan rather than the
   decomposition will buy less than the diaries suggest — most visibly
   in 0122, where the package closure addresses mainly the install
   facet.
2. **The dominant shape is execution lag, not design absence.** The retry
   complaint is fixed (0125); one-off scheduling is fully designed in
   LLP 0070 (0121); helper bundling was designed and demoted on review
   timeout, not rejection (0118) — though review showed the designed
   group-bundle emission assumed the retired warm-pool lifecycle, so the
   revival must re-derive its execution shape, not just execute; storage
   has a Draft owner (0124); static linking exists as an unused build
   mode (0123); the package closure is published but unconsumed (0122).
   This matches LLP 0115's v0.2 audit bucket (1) and sharpens it: the
   scarce resource is finishing and adoption, not invention.
3. **The genuine design holes are fewer and now named.** Vector search
   has no owner (0124); return inference and interior typing are owned by
   nothing on 0115's board (0117); failure-shape unification,
   declaration-closed rejection unions, and burst profiling have no CV
   item, though 0115 v0.4's open question 6 now tracks the cluster
   (0125); the aggregate profile question is open by declared Non-goal
   (0120); live search is a real hole whose shipped ingredients lack any
   end-to-end path — the head start is the option's hypothesis, not a
   finding (0119).
4. **Several options would out-evidence Convex rather than imitate it.**
   Convex's automatic retries are invisible at the evidence layer, and
   its scheduled work — whose terminal state is inspectable in the
   `_scheduled_functions` system table — carries no receipt tying an
   enqueue to its producing write and no append-only attempt ledger
   (a single mutable status row, per 0121); Snapback can make the same
   ergonomics evidenced — retry-as-evidenced-contract (0125), enqueue
   receipts plus a declared job-status query (0121), enforced declared
   read budgets over imperative handlers (0120's 2a — review split off
   the diagnostic-only variant 2b and named it a no-evidence-regression
   failure as a tier).
   Where the series found paths that keep Convex's ceremony level while
   adding receipts, those paths lead their option spaces.
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
   degraded-contract escape is a working mechanism shipping at
   `severity: 'info'`, not a missing diagnostic — whether the severity
   level caused the omissions is now a named hypothesis for the next
   rerun (0117); the `@snapback/client/online` missing-types gap found
   independently by three bakeoff arms is still unfixed (0122). These
   landed as LLP 0115 v0.4 amendments (open question 2).
7. **The review program validated pre-empirical review itself.** Across
   the tiered program journaled in
   `reviews/0116-0125-convex-parity-series.super-refine.md`, roughly 120
   round-1 findings plus every subsequent round's items were verified
   against the tree before application, and none was refuted — two
   reviewer paraphrases were themselves corrected during verification.
   The highest-value catches were pre-empirical hazard analyses no diary
   or code run had surfaced: 0123's boot-probe consumption of the
   one-shot strict-Host handoff, 0122's name-bound publication authority
   (a scope rename is a proof-system migration, not mechanical), 0118's
   capability-flow reading of helper purity. The loop found these at
   review cost; that running the code would have found them later and
   more expensively is this overview's inference, not a journal
   finding.

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

1. **Answered 2026-07-30:** the tiered review program the author
   approved that day executed in full (journal:
   `reviews/0116-0125-convex-parity-series.super-refine.md`) — full
   dual-family super-refine loops for 0117, 0118, 0122, and 0123;
   single-round dual-family passes with all verified fixes applied for
   0119, 0120, 0121, 0124, and 0125; this overview last, delta-review
   only. Convergence: 0117 dual-READY (round 3), 0118 dual-READY
   (round 5), 0122 dual-READY (round 3), 0123 dual-READY (round 3); the
   Tier-2 documents completed their approved single round.
2. **Answered 2026-07-30:** the candidate amendments landed as LLP 0115
   v0.4 — corrections applied, the status board gained an Analysis
   column pointing each CV item at its series document, and the unowned
   remainders became 0115's open questions 6–7 (author-gated).
3. When concrete changes are synthesized from these option spaces, do
   they land as amendments to owning documents, new Specs, or a
   successor Plan tranche — and does 0115 absorb the unowned items
   (0125's remainder, 0117's uncovered mechanisms, 0124's vector
   ownership) or delegate them to new owners first?
