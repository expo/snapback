# LLP 0127 review — Fable family


## Round 1 — 2026-07-30

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh general-purpose subagent
**Effort:** session-inherited
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh non-author subagent context, read-only review of the
working tree at commit 2fb51bdb, mutually blind (no llp/reviews/
artifacts for LLP 0127 read)
**Target SHA-256:** `e7c17fdeb93b68452bb680ae40fad4359e32fb2fff27de14c7b28bb294cdf4f7`
**Instruction SHA-256:** `d9c98b1fb05479a4ac22e10821ec527aeee3bb6b980129d798fdb115f7f6f8c7`
**Status:** completed

I read the target and the full post-review corpus it synthesizes —
LLP 0115 (v0.4), 0116 (v0.3), 0117 (v0.3), 0118 (v0.5), 0119 (v0.2),
0120 (v0.2), 0121 (v0.2), 0122 (v0.3), 0123 (v0.3), 0124 (v0.2),
0125 (v0.2), 0126 (v0.4) — end to end this session, and spot-checked
every move's source claims, every composition-map row, the exclusions,
the six absorption items, the measurement gates, and the ten forced
decisions against those texts.

## 1. Overall assessment

This is a strong synthesis that is close to the bar and not yet at it.
Corpus fidelity is very high: across several dozen spot-checks, the
RFC's representations of the reviewed texts were verbatim-faithful,
including the subtle post-review corrections that would have been easy
to lose — `argsContractHash` as identity witness rather than carrier
(0117 v0.3), the 2a-versus-2b enforcement split with 2b named a
constraint-1 failure as a tier (0120), the strict-Host handoff hazard
gating the boot witness (0123 v0.3), the retainability-invariant
attribution (0126), option F's viable-carrier narrowing (0117 v0.3),
and option 5's exact-versus-near-identical detection grades (0118).
Hypothesis discipline is genuinely maintained — the live-search
"mostly composition" claim stays the option's hypothesis, the
E-compressible fraction stays an empirical gate, the burst numbers stay
stale-and-confounded — and no move weakens an evidence boundary; move
5's posture-neutral-first gating of the boot witness and move 6's
noninterference requirement are exactly right.

What keeps it short of "no flaws" is a cluster of sentence-to-
paragraph-level defects in precisely the dimensions the capsule
weights: one fidelity distortion of a review-applied correction (the
0126 option-D ladder), one pre-registration rationale asserting
properties its source does not establish (1a), two decision-hygiene
slips where a contested adjudication or a labeled lean rides an
absorption item as if settled (exact-k-NN-first; sequence-primitive-
first filed under "verified findings"), two silent coverage drops
(0125's 409-taxonomy remainder; 0126's option F), and a closing
blocked/unblocked accounting that does not survive checking against
the sources' own statements. Every one of these is fixable in a single
revision pass with no empirical work. None undermines the six-move
architecture, the tranche mapping, or the two-program separation,
which I checked and found sound.

## 2. Strengths

- **Corpus fidelity at the sentence level** (§The six moves,
  throughout). Move 1's rendering of 0117 — per-boundary cost (finding
  2), ingress as evidence addition (finding 4), the CV-5
  reference-not-respell shape with the extended-descriptor/witness
  distinction (§CV-5), the A+E-before-G ordering dependency — is
  exact. Move 2 carries 0118's hardest-won corrections intact:
  context-capability-freedom not purity (finding 11), splice-dominates-
  group-bundle under the shipped lifecycle (finding 7), storage-in-
  generated-tier under constraint 4, the v2 hash as named helper-content
  hashes. Move 6 preserves 0120's conditionality precisely ("exact-or-
  refuse or maintained-exact are the ones that fit an exact current
  ledger" mirrors the OQ8 conditional rather than resolving it).
- **Evidence-model discipline** (§The six moves; §What this
  deliberately does not do). Each move's evidence claim checks out:
  move 1 adds a boundary (ingress), move 3's speculative/settlement
  receipt discipline is 0126's composed contract verbatim, move 4
  refuses to smooth the fail-closed blank (0119 finding 7), move 5
  refuses the naive boot probe until a posture-neutral shape is
  ratified with 0009's owners (0123's highest-value catch, correctly
  credited), move 6 adopts 2a-never-2b and requires a noninterference
  contract before any protected-source aggregate.
- **The exclusions read as decisions, as intended** (§What this
  deliberately does not do). All ten entries trace to real
  least-promising verdicts (0116 finding 5; 0117 finding 7's
  score-against-H rule; 0120 option 3's "worse Convex"; 0121's barred
  case 2; 0126's B1/B2 split), and the hermetic-variant and
  text-CRDT-sidecar hedges preserve their sources' bounded-not-
  dismissed status.
- **Decision hygiene, mostly** (§Open questions; per-move "Decisions
  forced"). Ten genuinely forced decisions are enumerated with correct
  source OQ pointers; proposals are labeled "this RFC proposes" at
  nearly every occurrence; option C is kept off the ladder as an
  author decision, not a rung — a textbook handling of 0126's
  conditions-favoring structure.
- **The two-program separation** (§Sequencing 5). Keeping local-first
  out of 0115's board, with a successor Plan cross-gated on the shared
  substrate (moves 2/5/6), is faithful to 0115's exit criterion,
  0126 OQ7, and 0074's graduation-path claim, and is the structurally
  correct answer to the coupling risk.
- **Measurement inherits the gates rather than asserting past them**
  (§Measurement). The per-move gate lists are complete against their
  sources — 0122's eight empirical questions appear as eight, 0121
  OQ6/OQ9, 0119 OQ5/OQ7, 0120 OQ3, 0125 OQ6, 0124 OQ3 — and the two
  rerun preconditions (burst benchmark; option A's diary-grade
  acceptance) are the right ones.

## 3. Concerns

**C1 — MATERIAL (corpus fidelity).** Move 3, the composition map's
0126 row, and §Sequencing 5 all present local-first as a linear ladder
— "option A → IR rung → desktop sidecar" — attributed to "LLP 0126's
staged program." 0126 v0.3 deliberately restaged option D as **two
parallel platform ladders with no cross-dependency** (its own Revised
header records this as a review-applied fix: "option D restaged as
parallel browser and desktop ladders"), with the IR evaluator as the
shared first rung and the desktop ladder explicitly independent of the
browser rungs. The RFC's serialization re-introduces the shape the
source's review removed, and attributes it to the source. *Resolution:*
present the parallel structure; if the RFC intends to serialize the
desktop rung behind the IR rung as a resourcing choice, label that as
this RFC's proposal, not 0126's staging.

**C2 — MATERIAL (corpus fidelity / analytic overreach).** The move-4
pre-registration rationale claims option 1a comes "with no inference"
and is "the only decomposed variant that costs no evidence." 0119
ranks nothing among the decomposed variants, leaves *how the
subscribable capability fact is minted* unspecified for 1a (if the
authored kind is erased, the fact must come from a declaration —
1b's shape — or from plan-shape classification — option 2's
inference), and offers 1b as an alternative that preserves an authored
non-live fact "without any static inference." The superlative and the
no-inference property are not derivable from the source. Pre-
registering 1a is within this RFC's remit; the unsupported rationale
is not. *Resolution:* state the mechanism assumption behind "no
inference" (or soften to "the variant this RFC judges cheapest in
evidence terms"), and name 1b as the unchosen alternative.

**C3 — MATERIAL (decision hygiene).** §Sequencing 4 proposes the
vector owner start "exact-k-NN-first with the float-pinning question
named." 0124 OQ3 explicitly reserves the exact-first-versus-
engine-native-ANN-first adjudication ("for vectors the opposite order
is a live candidate… nothing in the diaries adjudicates which order is
right. That adjudication is exactly the substance of OQ3"), yet the
RFC's forced-decision list (item 8) routes only revive-vs-supersede,
design placement, and parallel start — not the base-profile order. A
contested adjudication rides the absorption item without being routed.
*Resolution:* add the exact-vs-ANN base decision (0124 OQ3's
non-empirical half) to forced decision 8, keeping exact-first as the
labeled proposal.

**C4 — MATERIAL (decision hygiene / classification).** §Sequencing 2
files "the sequence primitive ships first" under "Refinements to
standing items, from the series' **verified findings**," citing 0120
finding 4 — which labels exactly that ordering "this document's
visible lean, labeled as such for the OQ1 decision-maker." The same
ordering then reappears in forced decision 3 as an author call. A lean
misfiled among verified refinements risks 0115 absorbing it as
settled. *Resolution:* move the clause into item 1's proposal layer or
forced decision 3; leave item 2 to the genuinely verified refinements
(graph-scope-then-emission, piece-2-gates-piece-3, the CV-9 riders,
CV-6 ordering).

**C5 — MATERIAL (sequencing coherence / internal consistency).** The
closing claims — "None of these blocks the first slices of moves 1,
2, or 5, and only items 1 and 4 block a move's exit" — do not hold as
stated. (a) 0118 places the helper-class decision *inside* the 1a
slice ("meeting both diary instances needs at least context-reader
helpers **even in this slice**"), and move 2's own idea paragraph
folds context-reader admission in — so forced decision 6 blocks move
2's first slice as the move describes it (a capability-free-only
first slice would evade this, but the RFC does not say that). (b) Move
5's stated first slice includes the CV-1 external rebuild "once the
custody decisions land" — i.e., a component blocked by item 4. (c)
Item 2 gates move 3's displaced-in-space half from start through exit
(the arm, the ladder, and the successor-Plan shape are all inside it),
and item 3 gates when anything in move 6 stops being bypassable —
CV-8's exit path on the 0113 route — so "only items 1 and 4 block a
move's exit" undercounts. *Resolution:* restate precisely — name the
decision-free slice components (CV-4a+CV-5; a capability-free-only 1a
if that is the intent; CV-2 plus the types sweep) and enumerate exit
blockers per move.

**C6 — MATERIAL (coverage honesty).** 0125's remainder is four items
by its own summary — the failure-shape split, the missing closed typed
rejection channel, "a wide 409 code family whose app-facing contract
is taught rather than enforced," and the burst path. The RFC's
composition-map row and §Sequencing 3 cover three (unions → CV item;
wire shape → 0094/0095 delegation; burst → rerun precondition); the
409-taxonomy / unified app-visible conflict contract (0125 option 1,
its OQ1) has no move, no exclusion entry, and no delegation — silently
dropped. (0115 OQ6(a) shares the omission, but this RFC's map claims
to state the post-review headline gap, which is 0125's text.)
*Resolution:* fold it into the 0094/0095 delegation explicitly (0125
OQ1 already names those owners) or add a residual entry.

**C7 — MATERIAL, low (coverage honesty).** 0126 option F — the
explicit-sync minimal lane (paved backup/export/restore, honest
single-authority language) — is silently dropped: no move, no
exclusion, no residual. Its source scores it as composing with every
other option, foreclosing none, and evidence-positive; it is not a
least-promising option whose absence can read as an implied rejection.
*Resolution:* adopt it as a cheap rider (move 5 or the successor
Plan), or give it an explicit disposition with a reason.

**Details (all DETAIL severity):**

- **D1.** Move 3 routes schema-at-capture "(LLP 0081)" as if owned;
  0126 finding 9 says it is "unowned at capture." Label 0081 as the
  proposed owner.
- **D2.** Move 4's "what lands where" says the 1a pre-registration is
  recorded "in 0115's watch item," but no §Sequencing v0.5 item
  carries that watch-item amendment — the absorption list omits it.
- **D3.** "The ambient form is the clearest constraint-1 violation in
  the corpus" drops 0118's own hedge ("clearest **candidate**
  violation").
- **D4.** "LLP 0125 confirmed the retry contract held" drops the
  absence-of-regression caveat (the rerun ran few direct contention
  exercises) that 0125 v0.2 was specifically revised to carry.
- **D5.** §Sequencing 1's "move 5 is … Tranche E's polish" implicitly
  sweeps CV-14 into move 5, which move 5's fronts do not claim; CV-14
  is covered by no move (defensible — it is not a series front — but
  the tranche mapping should say so).
- **D6.** Forced decision 1's "Every move-5 exit … wait[s] on it"
  overstates: CV-2/CV-3/CV-13/CV-15 exits do not wait on the npm gate.
- **D7.** 0126's §Wire-protocol implications names the version-based
  delta-resume consumer (designed in 0008, unbuilt) as part of the
  lane's minimum; move 3 claims "0126 in full" but never mentions it.
- **D8.** The composition map's 0124 row bakes "per-request-authorized"
  into the admission pattern while 0124 OQ7 deliberately holds the
  delivery-authorization axis open (it is S1/S3's natural model, not
  the pattern's settled property).
- **D9.** Move 3 gives 0121 OQ4's owner as "0070 or the 0108 family,"
  dropping the source's third option ("a new owned Spec").
- **D10.** 0122 option 3 (meta-package) receives no disposition —
  neither adopted, excluded, nor residual — though its gating registry
  probe appears in §Measurement.

## 4. Suggestions (non-blocking)

- Move 3's "first slice" is really two owner-designated slices (CV-9
  jobs; option A) that are each M-to-L programs; a sentence saying
  which leads under resource contention would make the slice claim
  more honest than "two independent slices."
- Cross-reference 0121 finding 9 (the keep-two-primitives posture)
  where move 3 places jobs beside cron — it is the standing answer to
  a unification question a reader will otherwise ask.
- Consider a one-line evidence-delta ("adds / preserves") per move;
  the material is all present but scattered.
- The composition map could gain a footnote for the board items no
  move claims (CV-10, CV-12a, CV-14 ride their tranches as specified)
  so §Sequencing 1's mapping claim is checkable from the map alone.

## 5. Open questions

1. Is move 2's first slice capability-free-only (unblocked, satisfies
   CV-7's exit via Streak Lab) or context-reader-admitting (blocked on
   forced decision 6)? C5(a) turns on this and the text supports both
   readings.
2. Does the intended v0.5 absorption include the 1a pre-registration
   text in 0115's watch item (per move 4's "what lands where"), and if
   so, under which §Sequencing item?
3. Should 0126 options F and G receive their dispositions here or in
   the proposed successor Plan? Either is defensible; silence in both
   is not.
4. Does the 0094/0095 wire-shape delegation intend to carry 0125
   option 1's unified-conflict-contract question with it (0125 OQ1
   names the same owners), or is that a separate later decision?

## 6. Verdict

**NOT READY** — strictly against the stated bar. The document's
architecture, coverage structure, evidence discipline, and decision
routing are substantially sound, and nothing here objects to its
making proposals, to absent implementation detail, or to named
empirical questions. But "as much as there are no flaws in this" is
not yet true: one review-applied source correction is re-distorted
(C1), one pre-registration rests on an underived rationale (C2), two
author adjudications ride absorption items without being routed or are
misfiled as verified findings (C3, C4), the closing blocked/unblocked
accounting is wrong in three places (C5), and two named source
remainders are silently dropped (C6, C7). All are one-revision-pass
fixes requiring no empirical work — which is exactly why they should
be fixed before the author adjudicates the proposals.

## 7. Recommended next step

Apply C1–C7 and the details in a single v0.2 pass (no re-research is
needed; every fix is a named sentence or list edit), reconcile the
closing claims with the per-move slice definitions, then run a
delta-only round 2 on the changed text. The forced-decision list
(amended per C3) is then fit to put in front of the author.
