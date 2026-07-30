# LLP 0120 review — Fable family


## Round 1 — 2026-07-30

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh general-purpose subagent
**Effort:** session-inherited
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh non-author subagent context, read-only review of the
working tree at commit 40ca18b9, mutually blind (no llp/reviews/
artifacts for LLPs 0116–0125 read)
**Target SHA-256:** `43bdb65cc7b7a411bf3db4c06f7ea5b20aa2b2f5793deb2ff4ed650efa14e82c`
**Instruction SHA-256:** `30c38e1a8f68e1684dc5373f8651842526556e278804dcffad9a78e2d216292e`
**Status:** completed

## 1. Overall assessment

This is the strongest kind of Research document: nearly every load-bearing
factual claim I spot-checked against the tree and the diaries verified, the
Convex provenance labeling is disciplined, the six-option space is broad and
each option carries a fair evidence-model ledger, and the document really does
decide nothing — ownership is mapped exactly where LLP 0115 governing
constraint 3 puts it. The verified factual base includes: the exact 0080 plan
admission limits (llp/0080 §1, lines 115–124), the stable promotion date and
"both registries" phrasing (0080 Revised header), the 0110 §1.1/§2.1 admission
and refusal lists, the 0113 §1 maturity-terminus quote (lines 62–66), the
`Experimental` pin in `src/manifest.rs` (lines 5335–5342) with
`relational_query_v1` on the `Stable` default, all four builders in
`packages/snapback-codegen/define.mjs`, the `lt`/`order`/`take` builder in
`packages/snapback-harness/ctx-bootstrap.js` (lines 575–650), the verbatim
Diary 0029 quotes (lines 453–457, 546–548), the 148→224 and 379→427 line
counts (Diary 0033 lines 41–43; Diary 0036 lines 113–114), the "slight Convex
win" (Diary 0039 §5), the Campfire send-scan contention note (Diary 0034 lines
195–197), and the ~700/~1,700 line figures (719 and 1,723 actual).

Judged strictly against the stated bar — "as much as we can without writing
code," read as "no flaws" — the document falls one identifiable step short.
Its own headline finding (the LLP 0113 experimental-maturity terminus,
finding 3) is applied as a decisive cost against option 6 but never applied
to options 1 and 5, whose new profiles face the same claimable-maturity route
question; and the cheapest composition variant (a flat snapshot batch of
already-admitted plan invocations) is folded into option 3 and inherits a
sequencing verdict its premise does not satisfy. Both gaps are pre-empirical:
they are resolvable by more analysis of documents already in the corpus,
which is exactly what NOT READY exists to demand under this bar. Both are
small and precisely fixable.

## 2. Strengths (cite sections)

- **Factual accuracy at an unusual standard.** Every quote I checked is
  verbatim: "A single transactional query composed the issue detail graph"
  and the compare-and-set mutation sentence (Diary 0029 lines 453–457), the
  Lessons quote (line 546), "a more natural inferred TypeScript shape"
  (Diary 0039 line 97), and the guide-steering paraphrase "not to select
  them merely because their builders exist" is in fact verbatim from Diary
  0033 line 55. §What Snapback does today's registry/builder facts all match
  the code.
- **Provenance hygiene as a model for the series.** §What Convex does labels
  its design paragraph "general Convex background, not something the diaries
  measured" inline, and §Confidence grades exactly that material medium
  confidence while flagging per-option cost estimates as judgment. The
  "Note the asymmetry" paragraph — what the diaries measured versus what
  they could not — is the honest core of the whole comparison.
- **The decomposition in §How they differ** (inference-vs-declaration is
  CV-4/6 territory, paved-surface refusal is CV-8 proper, aggregation has no
  story) is genuinely clarifying and correctly routes half the felt gap out
  of this front. The CV-4a/CV-6 attribution matches LLP 0115's status board.
- **Findings 3 and 5 are the document's best analysis.** The
  0113-terminates-at-experimental finding is verified against 0113 §1, and
  the capture-versus-declare complementarity (finding 5, option 4's *For*)
  correctly identifies the observed-subset-of-ceiling discipline already in
  0110 (line 558) as the precedent.
- **Decision hygiene.** §Relationship to LLP 0115 maps every decision to its
  owner (0080 OQ7, 0110 OQ2/OQ4, 0113, 0108 family, CV-4/6), and the claims
  match those documents' actual open questions, including the 2026-07-30
  Diary 0039 annotations on 0080 OQ7 and 0110 OQ2/OQ4.

## 3. Concerns

**C1 (BLOCKING-FOR-BAR) — The maturity-route cost is applied to option 6 but
not to options 1 and 5.** Finding 3 makes the 0113 experimental terminus
decisive against "promote what exists," but the option analysis never asks
what maturity route a *new* third profile or maintained-aggregate profile
takes. Two routes exist in the corpus: the 0113 route (code-owned
experimental, qualification-gated, acknowledgment ceremony — the very
properties that made the rerun arms bypass the 0110 profiles) and the 0080
precedent (`relational_query_v1` went stable 2026-07-26 through its own
RFC-acceptance-plus-witnessed-implementation act, without 0113 machinery).
Which route applies is a load-bearing cost/sequencing input to OQ1: under the
0113 route, a shipped third profile enters the next rerun exactly as
bypassable as the current profiles, and CV-8's exit criterion ("no
experimental capability claimed") is only reachable through CV-8 piece 2 —
making pieces 2 and 3 sequenced, not independent as §Relationship asserts.
OQ5 spots this bypass dynamic for the authority dimension but not the
maturity dimension. *Resolution:* a paragraph in options 1 and 5 (or a new
open question) naming the two routes, their costs, and the consequence for
the §Relationship independence claim.

**C2 (MATERIAL) — The flat snapshot-batch variant is unassessed on its own.**
A snapshot-consistent batch invocation of N already-admitted plan instances
(for `boardView`: three `bounded-children.v1` invocations over the same
parent at one snapshot, each keeping its own cursor and `take + 1` ceiling,
evidence the sum of the parts) is genuinely the cheapest composition
candidate, and it is analyzed only as option 3's confined-language variant —
inheriting option 3's verdict "sequenced *after* the profiles exist, not
instead of them." But for this variant the premise is already satisfied:
`bounded-children.v1` exists. OQ4 names the composed-cursor question, so the
document has the raw material; what is missing is the separate assessment
(batch transaction scoping, combined result contract, partial-refusal
semantics, versus option 1's new-profile cursor/refusal design) that would
let OQ1 weigh it as a candidate first shape. *Resolution:* either assess it
as a named sub-option or state explicitly why it collapses into option 1
or 3.

**C3 (DETAIL) — "Explicit Non-goals of both relational documents"
overreaches for two of the four shapes.** Sequence allocation is not an
enumerated Non-goal of either document — it is a 0110 §2.1 admission refusal
("no range read … set-oriented step", line 384) and OQ4's subject; and
one-parent/multi-child fan-out is 0110's Non-goal ("nested relation trees",
line 896) but 0080's *deferred open question 1*, not a 0080 Non-goal. The
Summary and finding 1 flatten refusals, deferrals, and Non-goals into one
category the corpus keeps distinct. *Resolution:* one sentence of
precision in the Summary and finding 1.

**C4 (DETAIL) — Citation imprecision on the scoring-frame quote.** "Convex
infers more, Snapback proves more" is cited as Diary 0039 §2 but lives in
the Executive answer table (line 22); §2's own wording is "Convex is terser;
Snapback is more inspectable" (line 101). Same substance, wrong pointer.

**C5 (DETAIL) — The `reads`/`writes` enforcement claim is per-kind, not
per-handler.** `jsQueryDef` requires non-empty `reads` and pins
`writes: []` (define.mjs lines 1689, 1721); `defineJsMutation` requires
non-empty `writes` while `reads` defaults to `[]` (lines 2234, 2259). "The
handler declares its read/write tables (`define.mjs` requires non-empty
`reads`/`writes` declarations)" reads as both-required-per-handler.

**C6 (DETAIL) — "so individual reads are index-served" overstates the
builder's guarantee.** The ctx-bootstrap plan surface defaults
`indexed_by: null` with `withIndex` opt-in (ctx-bootstrap.js lines 575,
590); the cited handlers do use indexes per the diaries (e.g. Diary 0034
`by_room_sequence`), but the causal "so" attributes to the surface what the
handlers chose.

**C7 (DETAIL) — The third sequence-primitive demand site is inference
presented as evidence.** Campfire's send-scan and Relay's `moveCard` collect
are diary/spec-evidenced demands; "would have shortened the Linear arm's
cursor scheme" extrapolates from Diary 0029's sequence-cursor design (line
78) with no recorded allocation pain. "Three independent demands" presents
all three as equally evidenced.

**C8 (DETAIL) — Option 5's contention claim is an empirical expectation
stated as fact.** "Contention behavior improves rather than merely being
documented" (*For*) sits beside the *Against*'s own concession that
hot-counter contention "needs its own statement"; the improvement is exactly
the kind of only-running-code-can-establish claim the document elsewhere
names as empirical.

## 4. Suggestions (non-blocking)

- Explicitly dismiss (or admit) client-side composition of separate live
  queries as an option — 0080 OQ1 offers it ("a direct child query plus
  client composition") and 0110 OQ2's annotation records why it loses (the
  single-snapshot property); one sentence closes the enumeration.
- In §What Convex does, the "Note the asymmetry" paragraph's claims about
  what Convex does not surface could carry the same general-background label
  the preceding paragraph has; §Confidence covers it, but the inline label
  is the better pattern.
- Finding 4's "three primitives" and OQ2 lean toward the sequence primitive
  shipping first ("suggest it should not wait"); consider marking that as
  the reviewer-visible recommendation it is, so the OQ1 decision-maker sees
  the lean labeled.
- The option 1 *Against* on `localeCompare` migration is well-sourced from
  0080 OQ7; noting that the underlying Split handler lives outside this
  repository (the rerun workspace) would make the provenance chain explicit.

## 5. Open questions

- For C1: is the 0080 direct-to-stable precedent actually available to a new
  profile under current governance, or has 0113 made the qualification route
  mandatory for all new relational capability ids? The corpus supports
  either reading; the answer determines how heavy C1's interaction is.
- Does the batch variant in C2 require a new capability id (and thus meet
  C1's question) or can it be expressed as a client-invisible evaluation
  detail of existing plans?
- Is the LLP 0115 exit criterion for the Relay/Split arms satisfiable by any
  option here *without* CV-8 piece 2 landing first? If not, the series
  overview's sequencing picture should say so.

## 6. Verdict

**NOT READY** — narrowly, and for reasons one revision can clear. The
factual base, provenance discipline, and decision hygiene are all at or
above the bar; the document falls short of "thought through as much as we
can without writing code" only in C1 (its own maturity-terminus finding is
not applied to its two leading options, leaving a load-bearing
cost/sequencing interaction unstated and an independence claim in
§Relationship unsupported) and C2 (the cheapest composition variant is
never separately assessed). Both are pre-empirical gaps, not empirical
questions, so the bar's NOT-READY exclusions do not shield them.

## 7. Recommended next step

One targeted revision: add the maturity-route paragraph to options 1 and 5
(naming the 0113 route versus the 0080 precedent and correcting or
defending §Relationship's pieces-1-and-2 independence claim), assess or
explicitly collapse the flat snapshot-batch variant, and sweep the DETAIL
items (C3–C8, each a sentence). No structural rework is needed; the option
space, findings, and confidence grading should survive intact. Re-review of
the delta alone would suffice.
