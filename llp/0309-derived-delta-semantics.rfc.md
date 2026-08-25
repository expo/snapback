# LLP 0309: Derived delta semantics for the closed query algebra

**Type:** RFC
**Status:** Review
**Systems:** Live queries, Offline sync, Storage, Code generation
**Author:** Claude Fable / Charlie Cheever
**Date:** 2026-08-25
**Related:** LLP 0008, LLP 0051, LLP 0056, LLP 0067, LLP 0080, LLP 0190,
LLP 0191, LLP 0200, LLP 0209, LLP 0270, LLP 0308

## Summary

This RFC proposes that the incremental-maintenance rules for Snapback's
closed query surface — the delta rules that let a live result be patched
instead of re-evaluated, today specified per node kind in LLP 0209 §7 and
implemented lane by lane (G3 rung 1 landed 2026-08-25) — be **derived
from a single per-operator incremental semantics** rather than designed
independently per node kind, and that the same derivation serve both of
its eventual consumers: the server matcher's delta lanes and LLP 0190
D3's local maintained materializations.

One sentence: **specify how a change flows through each operator of the
closed algebra once, and every plan's delta rule — server-side or
local — follows by composition instead of by separate authorship.**

The proposal deliberately changes *where rule content comes from*, not
*how rules are admitted*. LLP 0209 §7's safety posture — eligibility
grows node kind by node kind, each admitted rule ships with its own
convergence assertion and conformance rows, one ineligible node pins the
whole graph to replace, `live_replace` stays the honest fallback — is
preserved unchanged. This is "generic derivation, per-kind admission."

Provenance: this graduates import I1 of LLP 0308 (Research, Shelved),
as sharpened by that document's two-family super-refine loop, on the
author's request (2026-08-25). The external formalism is DBSP /
differential-dataflow-style incremental view maintenance.

## Motivation

### The current method is per-kind hand-design, and it is expensive

LLP 0209 §7 specifies delta behavior separately for each node kind:
boundary-aware classification for root windows, row-keyed patches for
equality to-one, parent-indexed ops for bounded to-many, fail-closed
pins for semi-joins pending a certified evaluator, and so on. Each rule
is individually designed, individually reviewed, and individually
proven. G3 rung 1 — the first delta lanes plus convergence sampling and
delivery negotiation — landed 2026-08-25 after a multi-commit,
multi-round-review lane. That cost is per node kind, and the ladder has
more rungs: window shapes, to-many, semi-joins behind their evaluator
condition, plus every future node kind the profile admits.

Hand-design also has no structural guarantee of cross-rule consistency.
Each rule independently re-answers the same underlying question — "what
does this operator do to a small change in its input?" — and nothing but
reviewer vigilance keeps two rules' answers coherent where operators
compose.

### A second consumer is coming, and drift between consumers is the failure mode that matters

LLP 0209 §8 requires a local evaluator that produces byte-identical
results under the same IR ("one IR, two evaluators"), and rung 5 — a
retained fact plus an ordered delta stream as the local replica — is
D3's to build on top of §7's delta frames. When local maintenance
arrives, every delta rule exists twice: once in the server matcher, once
in the local evaluator. Two hand-written copies of per-kind rules is
precisely the drift shape LLP 0051 eliminated for expression semantics
by ruling "one evaluator serves every consumer... so semantics cannot
drift per call site." This RFC applies the same ruling one level up: one
*derivation* serves every delta consumer, so maintenance semantics
cannot drift per runtime.

### The auxiliary state a derivation needs is already captured

Incremental maintenance for non-linear operators needs bounded state:
window boundaries, result counts, support counts, row-key sets. The
profile already captures almost all of it — `CapturedReadDependency`
records carry the serialized predicate, exact row-id lists, pinned
versions, order, limit, `result_count`, and a window `boundary`; graph
nodes declare their captured-dependency vocabulary as part of the
profile. The derivation makes the correspondence explicit instead of
incidental: per operator, **maintenance state = the captures**, and the
delta rule is a function of (captures, change batch). Nothing new is
captured; what is captured acquires a second, principled consumer.

## Design

### D1. The algebra and its delta forms

Model row sets as Z-sets (rows with signed multiplicities: an update is
a remove plus an add; a batch of changes is a small Z-set `ΔS`). For
each operator `O` of the closed surface, specify an incremental form
`∂O` with the defining property `O(S + ΔS) = O(S) + ∂O(S, ΔS)`, where
any dependence on `S` is restricted to the operator's declared
maintenance state (its captures). The operator inventory and its
expected classification:

| Operator | Delta character | Maintenance state |
|---|---|---|
| Authority-scoped source (`TableVisibilityV1`) | linear; change rows classified by visibility arms | none (policy + row) |
| Filter (`FilterExpr` / `ValueExpr`) | linear; per-row predicate evaluation | none |
| Closed projection | linear | none |
| Principal-bound scope | linear; partitions `ΔS` by principal (partition-of-one) | none |
| Equality to-one | per-parent keyed patch | parent→row keys (captured) |
| Bounded to-many | parent-indexed add/remove/update under the fanout bound; overflow ⇒ fallback | per-parent counts (captured) |
| Exists semi-join (incl. through-tables, repeated existence) | support counting: a row's visibility flips only on 0↔1 support transitions | per-row support counts |
| Ordered / limited window (top-N) | boundary classification: inside, displaces boundary, or outside; displacement without a provable replacement ⇒ fallback | boundary sort keys + completeness bit + result count (captured) |
| Search-membership | **excluded** — D6's writer owns its invalidation facts (LLP 0209 OQ-4) | — |

Linear operators need no state and their delta forms are one-liners.
The three non-linear rows are the hard 20% and the reason this RFC
exists: their rules are exactly the ones LLP 0209 §7 describes in prose,
and deriving them from one semantics is what guarantees the server and
local copies agree. Where an operator's delta form requires state the
captures do not yet carry (candidate: semi-join support counts), the
gap is named in the operator's spec and either added to the capture
vocabulary through LLP 0209's ordinary amendment path or the operator
stays fallback-pinned — never silently approximated.

Predicate evaluation inside delta rules reuses the LLP 0051 `ValueExpr`
evaluator unchanged, inheriting the matcher/SQL agreement invariant
(three-valued logic included) and `Unanalyzable` ⇒ fallback.

### D2. Composition and eligibility

A plan's delta rule is the composition of its operators' delta forms in
plan order. Eligibility remains a *conjunction with per-kind admission*:
an operator kind participates only once its delta form is admitted
(conformance vectors + convergence assertion, §D4), and any
not-yet-admitted or state-gapped operator in a plan pins that plan to
`live_replace` — LLP 0209 §7's rule, unchanged, including semi-joins
staying fail-closed pending the certified evaluator condition (LLP 0056;
LLP 0067 §F2a) and one ineligible node pinning the whole graph.

Authority transitions are never delta-maintained; the LLP 0200 fence and
restoration own them, and delta frames carry the same resolution-ticket
and watermark obligations as any frame. Opaque handlers stay re-run
(LLP 0209 §7's categorical, unchanged). Wire kinds are untouched:
`live_delta` remains additive, `live_replace` remains the honest
fallback, and this RFC adds no wire surface.

### D3. Two consumers, one derivation

- **Server matcher (the G3 ladder).** Landed and future delta lanes
  keep their delivery machinery (negotiation, convergence sampling,
  deferral-aware bounds — G3 rung 1). What changes is the provenance of
  rule content: each lane's classification logic is an instantiation of
  the operator table's delta forms, checked against the algebra's
  vectors, instead of free-standing prose realized ad hoc.
- **Local maintained materializations (LLP 0190 D3).** The local
  evaluator instantiates the *same* delta forms over the same captures
  to maintain retained query facts. §8's byte-agreement obligation then
  holds for maintenance by construction rather than by parallel
  authorship; conformance is the same corpus evaluated in both runtimes.

Explicitly **not** a consumer: the replica continuity contract (base /
predecessor stamping, cumulative-vs-compositional semantics,
gap-to-replace — LLP 0209 §8 / OQ-6, the LLP 0191 §2 replica-needs
list). That is a distribution protocol designed jointly at the D2–D3
seam when D3 takes up rung 5. This RFC's deltas feed it; they do not
define it, and nothing here claims replica applicability for delta
frames.

### D4. Verification: vectors, re-derivation, and the live comparator

1. **Per-operator delta vectors.** Each operator's `∂O` ships conformance
   vectors (input state, change batch, expected output delta, expected
   fallback verdicts) under `tests/conformance/` in the house pattern,
   including the three-valued-logic and boundary edge cases.
2. **Re-derivation check (the strongest early test).** Before any new
   rule lands, re-derive the *already-shipped* lanes — DK-3's
   single-table `live_delta` classification and G3 rung 1's rules —
   from the operator table and diff against shipped behavior on the
   existing corpora. The algebra must reproduce what ships or the
   discrepancy must be explained and ruled on. This validates the
   semantics against reality before it authors anything new.
3. **Runtime comparator, unchanged.** The shipped convergence
   discipline — DK-3's convergence assertion, G3 rung 1's default-on
   sampling (delta-maintained result vs fresh evaluation) — remains the
   live guard. A divergence is a content failure handled in the LLP 0270
   posture: disable the lane via rotation or kill switch, never fall
   back silently. Wrong deltas are live-data correctness failures, and
   the comparator is the reason derivation can be adopted incrementally
   without a leap of faith.

### D5. Staging

- **Stage A (docs + vectors only).** Author the operator table with
  delta forms and state requirements as an LLP 0209-adjacent normative
  document (see OQ-1: amendment vs. sub-Spec), plus the per-operator
  vector corpus. No runtime change.
- **Stage B (re-derivation).** Mechanically check shipped lanes against
  Stage A (D4.2). Any divergence is ruled on before Stage C.
- **Stage C (new rules from the algebra).** The next ladder rungs —
  window shapes first, per LLP 0209 §7's ordering — land with rule
  content instantiated from Stage A, keeping per-kind admission,
  vectors, and sampling. Effort shifts from rule design to rule
  instantiation.
- **Stage D (local consumer).** When LLP 0190 D3 builds local
  maintenance, it instantiates Stage A rather than re-authoring rules;
  cross-runtime conformance reuses the same corpus.

Sequencing note: Stage A/B are cheap and independently valuable (B is a
correctness audit of shipped lanes on its own). Stage C is demand-gated
exactly as LLP 0209 §7 gates the expensive rung — where the ledger shows
an admitted shape's re-run cost × wake rate still dominating.

## What this RFC does not change

- LLP 0209 §7's admission posture, fallback conjunction, authorization-
  lane rules, opaque-handler categorical, and search-membership
  exclusion.
- Wire kinds, delivery negotiation, sampling, and the LLP 0200
  fence/watermark obligations.
- The capture vocabulary, except through 0209's ordinary amendment path
  where an operator's state needs are shown to exceed it.
- The replica continuity contract (stays OQ-6, joint D2–D3 design).
- Anything about opaque JavaScript: derivation applies to the closed
  algebra only.

## Open questions

1. **Home for the normative operator table.** A sub-Spec of this RFC, a
   new section of LLP 0209, or a standalone Spec that 0209 §7 and 0190
   D3 both cite? LLP 0308's review concluded "two consumers" argues for
   a document neither consumer owns; 0209's editors may prefer
   containment. (The RFC proposes standalone; the author rules.)
2. **Semi-join support counts.** Confirm whether existing membership
   captures suffice to maintain 0↔1 support transitions in both
   directions (the empty→visible direction is already matcher-visible),
   or whether a support-count capture must be added via amendment — and
   whether that lands before or with the certified-evaluator condition
   LLP 0056 names.
3. **Boundary displacement without replacement.** §7 falls back when a
   window boundary is displaced and no replacement row is provable.
   Should Stage A specify the provable-replacement condition once (it is
   an operator property), or leave it per-lane? Proposed: once.
4. **How much of Stage B is automatable?** Re-deriving DK-3's
   classification is straightforward; re-deriving G3 rung 1's landed
   rules requires reading their behavior out of the matcher — worth a
   small harness, or a one-time manual audit?
