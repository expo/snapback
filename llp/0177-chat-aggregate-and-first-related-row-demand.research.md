# LLP 0177: Chat aggregate and first-related-row demand

**Type:** Research
**Status:** Review
**Systems:** Query planning, Application data API, Storage portability,
Developer experience, Code generation, Competitive evaluation
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-05
**Revised:** 2026-08-05 (d) — Super-refine round 2 (delta): round 1's fix
relocated a workload-count misreading from SD-2's profile-choice branch to
its trigger condition instead of removing it — "3a has usage evidence" is
(as best this document can tell) a fact about the 3a mechanism's own
deployment, not a synonym for aggregate demand, and this document has no
evidence on the former. Reworded to state demand evidence and the trigger
condition as two distinct, not-conflated facts, and to stop claiming three
workloads "satisfies" or "clears" anything about the trigger. Also
synchronized the header `Status:` field with the closing `## Status`
section, which a reviewer found still said "Draft research" after the
header had already moved to Review. 2026-08-05 (c) — Super-refine round 1: rewrote the aggregation
recommendation against LLP 0130 SD-2's actual branch structure — SD-2 decides
by whether snapshot-batch composition (3a) plus sequence allocation already
express the demonstrated shapes within their ceilings, not by a count of
demonstrated workloads — and relabeled the maintained-exact lean as a
hypothesis that does not satisfy SD-2's stated contention-evidence
precondition, rather than a strong candidate. 2026-08-05 (b) — Corrected the
self-join baseline from an open question to an explicit v1 refusal;
separated the small self-relation demand from bounded aggregation; and made
this document a non-blocking evidence sidecar to LLP 0176 rather than a
delivery dependency.
**Related:** LLP 0080, LLP 0110, LLP 0115, LLP 0120, LLP 0130, LLP 0135, LLP
0157, LLP 0176; Diaries 0058–0060

## Summary

All three messaging bakeoffs behind LLP 0176 dropped from declarative query
profiles to a JavaScript live-query handler for the same two result shapes:

1. reactions grouped and counted per message and emoji; and
2. the one message referenced by a reply's `replyToId`.

They are useful evidence, but they are not one missing feature. The first is
the bounded-aggregation gap already analyzed by LLP 0120. The second is a
bounded self-relation that current `defineRelationalQuery` deliberately
refuses.

This document therefore proposes no new query syntax. It contributes the chat
evidence to the existing decision owners and recommends evaluating the two
shapes separately. Neither is on LLP 0176's critical path: a generated
application surface can bind today's JavaScript live query without waiting for
a more declarative implementation.

## Authority and scope

This Research document does not own or amend:

- LLP 0080's `RelationalQueryPlanV1` grammar;
- LLP 0110's bounded-child vocabulary;
- LLP 0120's aggregation option space and result semantics;
- LLP 0130 standing decision SD-2, which decides when evidence justifies
  selecting a bounded-aggregation direction; or
- LLP 0135/0157 completeness and admitted-algebra rules.

It owns only the evidence statement, the classification of the two chat
shapes, and a recommendation to the governing documents. A future syntax or
shipping proposal must amend the appropriate owner instead of treating this
Research document as authority.

## Evidence

The independent 2026-08-05 Tandem, Relay Room, and Snapback Messenger
implementations each needed a conversation message list enriched with:

- a grouped reaction summary for every message; and
- a preview of the message referenced by a reply, when present.

Each implementation used an opaque JavaScript live-query handler for the
enrichment. The shared outcome matters more than any one implementation:
three separate builders, working from the same product brief without sharing
backend code, selected the same escape hatch at the same point.

The experiments do not prove which aggregate design should ship, that either
shape is safe without a bound and visibility proof, or that the opaque handler
is currently incorrect. They show repeated demand and a discoverability/
expressiveness boundary.

## Finding 1: grouped reaction counts are bounded-aggregation demand

The requested result is a per-message map or list of `emoji -> count`. It
groups related reaction rows by one declared field and reduces each group to a
count. That is aggregation, not an ordinary two-source join.

LLP 0120 already enumerates the design choices: application-maintained rows,
bounded reduction, snapshot-batch composition, materialized aggregate views,
and their result-semantics/noninterference variants. This evidence should not
spawn a competing “chat sugar” grammar.

The chat access pattern does add a useful lean, offered as input to LLP
0120's open question 1 and no further:

- summaries are read on every render and written only when a participant
  changes a reaction;
- source and result visibility naturally share the conversation-membership
  partition; and
- a per-message/per-emoji materialization key is small and direct.

That access pattern is *consistent with* a maintained exact aggregate being a
good eventual fit for this workload — but it is not, by itself, the evidence
LLP 0130 SD-2 requires to authorize one. SD-2 states plainly: "Maintained-
exact aggregates are authored only on measured contention evidence." A
read-heavy/write-rare access-pattern argument is not a contention
measurement; no contention measurement exists for this workload. This
document therefore does not recommend a maintained-exact profile — it
records the access-pattern lean as a hypothesis worth testing if and when
someone runs the measurement SD-2 actually asks for, and separately notes
what SD-2's other branches would require: an *exact-or-refuse* callable
aggregate (SD-2's stated default variant if a shape proves inexpressible
under 3a) needs no contention evidence at all. See §Recommendation below for
how this maps onto SD-2's real decision procedure, and LLP 0120's harder open
questions this does not resolve regardless of branch: moves between groups
require decrement plus increment, deletes require a preimage, replay must be
idempotent, protected sources require a general noninterference rule, and
financial totals may not tolerate chat-shaped caps.

## Finding 2: reply preview is a refused self-relation

A reply preview needs at most one row: join each message's optional
`replyToId` to the message whose id it names. It does not group or reduce.

The current baseline is not ambiguous:

- `packages/snapback-codegen/define.mjs` asserts that relational root and
  joined table names differ; and
- `crates/snapback/src/manifest.rs` rejects a relational plan whose root and joined table
  are equal with `SNAPBACK_RELATIONAL_PLAN_INVALID`.

So `defineRelationalQuery` does **not** admit this self-join in v1. The
distinct-table join profile remains shipped and was also undiscovered by the
bakeoffs; that separate guide failure is tracked by
`issues/closed/20260805-relational-query-undiscovered-by-messaging-bakeoffs.md`.

Reply preview is concrete evidence for a narrow LLP 0080 follow-up: determine
whether its existing bounded two-source proof can safely admit distinct
aliases over one table while retaining the joined-side uniqueness proof,
visibility noninterference, optional-left semantics, and portable target
admission. It should not be bundled with aggregation merely because both
currently use a JavaScript handler.

## Recommendation

### For bounded aggregation

A reviewer round correctly found the previous text here misstated SD-2's own
test: SD-2 does not fire on a count of demonstrated workloads. Its decision
procedure is precise, and this document's recommendation now follows it
exactly rather than approximating it:

1. **Test expressibility first.** Evaluate whether snapshot-batch
   composition (3a) plus the sequence-allocation primitive can express
   grouped per-message/per-emoji reaction counts within their declared
   ceilings, with acceptance green — the same test SD-2 already specifies
   for Relay Board's `boardSummary` and Split Ledger's derivation. This
   document does not perform that test; it is a concrete, scoped ask to
   whoever runs LLP 0130's decision procedure, not evidence this Research
   document can substitute for.
2. **If expressible:** no third profile is authored for the reaction-count
   shape. 3a plus the sequence primitive are the paved answer, exactly as
   SD-2 states for that branch.
3. **If inexpressible:** SD-2's own default applies — a contracted-aggregate
   profile scoped to the inexpressible shape, with **exact-or-refuse** as the
   default result-semantics variant (LLP 0120 §Result semantics variant 2),
   not maintained-exact. Maintained-exact only enters consideration later,
   and only "on measured contention evidence" per SD-2's explicit text —
   which chat's read-heavy access pattern (§Finding 1) is a candidate
   *hypothesis* for, not a substitute measurement.

What this document *does* contribute, precisely bounded: a third,
independent, unrelated-domain **demand** signal (chat, alongside Relay Board
and Split Ledger) for a bounded-aggregation capability. A round-2 delta
review correctly found the previous text here relocated the same
workload-count misreading round 1 fixed at the profile-choice level up to
the trigger level instead — SD-2's phrase "fires when 3a has usage evidence"
reads as a fact about whether snapshot-batch composition (3a) is itself in
active use, not as a synonym for "demand for aggregation exists." This
document has no evidence about 3a's own usage and does not claim any. Demand
for the aggregation *capability* and evidence that the *3a mechanism* is
being exercised are two different facts, and only the decision-maker who
actually tracks 3a's deployment can say whether the second is true. This
document's contribution is bounded to the first: recording that three
independent, unrelated product domains now want a bounded-aggregation
shape. A round-3 review correctly found the previous wording here stated
the shape as already excluded ("3a's Non-goals already exclude") — which
both attributes Non-goals to the wrong owner (LLP 0080 and LLP 0110's
Non-goals exclude aggregation; 3a's own expressibility is exactly what
§Recommendation's step 1 says still needs testing, not an already-settled
fact) and presupposes the expressibility test's answer before it has run.
Corrected: three independent, unrelated product domains now want the
bounded-aggregation capability neither LLP 0080 nor LLP 0110 admits today,
as input whenever the decision-maker judges — by whatever evidence actually
establishes it — that the SD-2 procedure should run. Whether 3a specifically
can express it is §Recommendation's unresolved step 1, not assumed here.

If the decision remains deferred, the open item is whichever of SD-2's own
inputs the decision-maker judges missing (3a usage evidence itself, the
ceiling check, the contention measurement, the noninterference shape) —
this document does not know which, and does not guess.

### For first-related-row lookup

Open a narrowly scoped LLP 0080 amendment or research item for self-relation.
The first candidate should be the smallest extension of the existing admitted
profile:

- root and joined aliases must remain distinct;
- the joined side still requires a proven-unique index;
- the join remains 1–4 equality pairs and one bounded root window;
- visibility is declared for both aliases and output;
- recursion and transitive traversal remain impossible; and
- generated/runtime admission must agree.

If those proofs do not survive same-table aliases, retain the refusal and
document why. Do not introduce a general graph traversal to solve a one-row
lookup.

### For LLP 0176

Neither decision gates the golden path. LLP 0179 surfaces compose references,
not query ASTs, so `app.surfaces.conversation` can bind a JavaScript live
query today and later point at a generated relational/aggregate profile
without changing screen vocabulary.

## Acceptance for a future governing decision

This document itself ships no capability. The downstream decision should not
claim completion until it includes:

- an explicit bound and result semantics;
- visibility/noninterference proofs for every contributing row;
- implementation and manifest admission that agree;
- negative tests for unbounded scans, non-unique joined sides, cross-partition
  leakage, and unsupported targets;
- a generated type that distinguishes absent, capped, partial, or exact
  results where applicable; and
- a worked messaging example discoverable from the guide.

## Open questions

1. What does SD-2's "3a has usage evidence" trigger actually measure — 3a's
   own deployment/exercise, or demand for the aggregation shapes it cannot
   express? A round-2 review correctly found this document's prior answer
   conflated the two. Chat, Relay Board, and Split Ledger are demand
   evidence regardless of which reading is correct; whether that demand
   evidence is what the trigger phrase means, or a separate fact about 3a
   itself is also required, is for SD-2's owner to say. Once the trigger is
   judged met by whatever it actually requires, what is the result of
   testing grouped reaction counts against 3a plus sequence allocation's
   ceilings?
2. Can maintained aggregates serve both capped chat counts and exact financial
   totals through one result algebra, or should the first admitted profile be
   narrower?
3. Can LLP 0080 admit same-table aliases without changing its visibility proof
   or retained-query portability?
4. Should “first related row” become a generated relationship handle rather
   than a visible self-join spelling, provided it compiles to the same admitted
   plan?

## Status

Review. The factual question about current self-join support is
closed: v1 explicitly refuses it, cited against `define.mjs` and
`crates/snapback/src/manifest.rs`. The aggregation recommendation now follows LLP 0130
SD-2's actual expressibility-first decision procedure rather than a
workload-count approximation of it, and no longer leans toward
maintained-exact without the contention evidence SD-2 requires for that
branch. The remaining work belongs to LLP 0080 for the self-relation and
LLP 0120/0130 for aggregation. LLP 0176 may proceed without either.
