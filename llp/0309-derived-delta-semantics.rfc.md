# LLP 0309: Derived delta semantics for the closed query algebra

**Type:** RFC
**Status:** Review
**Systems:** Live queries, Offline sync, Storage
**Author:** Claude Fable / Charlie Cheever
**Date:** 2026-08-25
**Revised:** 2026-08-25
**Related:** LLP 0008, LLP 0051, LLP 0056, LLP 0067, LLP 0080, LLP 0190,
LLP 0191, LLP 0200, LLP 0209, LLP 0270, LLP 0308

## Summary

This RFC proposes that the incremental-maintenance rules for Snapback's
closed query surface — the delta rules that let a live result be patched
instead of re-evaluated, today specified per node kind in LLP 0209 §7
and implemented lane by lane in the graph delta evaluator (G3 rung 1
landed 2026-08-25) — be **derived from a single per-operator incremental
semantics** rather than designed independently per node kind.

One sentence: **specify how a change flows through each operator of the
closed algebra once — as a typed, executable reference semantics — and
every admitted plan's delta rule follows by composition instead of by
separate authorship.**

What this RFC decides is the **methodology and its acceptance
criteria**: that a per-operator semantics document plus an executable
reference evaluator is the artifact delta rules derive from, what type
contract that semantics must satisfy (§D1), what its state contract
must account for (§D1.3), how it is validated against shipped behavior
before authoring anything new (§D4), and what it explicitly does not
change (§Boundaries). The operator semantics itself is Stage A's
deliverable; §D1.2's table is the **classification hypothesis set**
Stage A must confirm or correct operator by operator — it is not
settled design.

The proposal changes *where rule content comes from*, not *how rules
are admitted*. LLP 0209 §7's safety posture — eligibility grows node
kind by node kind, each admitted rule ships with its own convergence
checks and conformance rows, one ineligible node pins the whole graph
to replace, `live_replace` stays the honest fallback — is preserved
unchanged. This is "generic derivation, per-kind admission."

Consumers: the server graph delta evaluator (the G3 ladder) is the
established consumer. Local maintenance of retained facts (LLP 0190
D3) is a **conditional future consumer**: if and when it is built, it
must instantiate the same semantics under D3's custody restrictions
(§D3.2) — this RFC does not claim 0190 already requires it.

Provenance: this graduates import I1 of LLP 0308 (Research, Shelved),
as sharpened by that document's super-refine loop, on the author's
request (2026-08-25). The external formalism is DBSP /
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
does this operator do to a small change in its input?" — and nothing
but reviewer vigilance keeps two rules' answers coherent where
operators compose.

### The state a derivation needs already has precedents — in two places

Incremental maintenance needs per-operator state. Some of it lives in
the captured-dependency vocabulary (`CapturedReadDependency`: serialized
predicate, row-id lists, pinned versions, order, limit, result counts,
window boundary data). But the landed G3 lanes retain substantially
more: the graph evaluator's retained state carries complete row
instances, per-node rows, child indexes, exists results, continuation
state, proofs, and query outputs, and the delta lanes additionally
perform authorized storage reads and compare full old and new rows —
change events deliver post-images, not remove-plus-add pairs. Stage A's
job is to make the state contract explicit per operator (§D1.3), with
both precedents as input — not to pretend captures alone suffice. What
the derivation buys is that state requirements become *derived
properties of operators* instead of incidental implementation choices.

### Consistency across consumers is the failure mode worth designing against

Within the server, rule content today is authored per lane; a second
instantiation arrives if LLP 0190 D3 ever maintains retained facts
locally (LLP 0209 §8 already requires local evaluation to be
byte-identical under the same IR). LLP 0051's precedent is
instructive but must be claimed honestly: 0051 prevents drift with one
shared *executable evaluator*, not with prose. This RFC therefore makes
an executable reference semantics the derivation artifact (§D4.1), so
that agreement between instantiations is "shared forms, one oracle,
same corpus" — not "two readings of the same document."

## Design

### D1. The algebra: type contract, hypotheses, state contract

#### D1.1 The carrier contract Stage A must satisfy

For each operator `O` of the closed surface, Stage A defines an
incremental form `∂O` with an explicit type:

```text
∂O : (state_O, Δin) → (Δout, state_O') | FALLBACK(reason)
```

- `Δin`/`Δout` are typed per operator. Unordered relational operators
  use Z-set batches (rows with signed multiplicities; an update is a
  paired remove+add, and a batch is atomic — a boundary swap is one
  batch, never one row at a time). Ordered/windowed operators emit into
  a ranked-sequence carrier whose order is recovered from sort keys;
  their output composition is sequence splicing, not Z-set addition.
  The wire encoding of the result (the existing additive
  `add`/`update`/`remove` op vocabulary) is unchanged; Stage A defines
  the mapping from delta carriers onto it.
- **Joins are bilinear.** Equality to-one, principal-bound relations,
  and semi-joins take two inputs; `∂O` must specify the form for a
  change on either input, each using retained state of the other side,
  and the composed both-change term.
- `∂O` is **partial by design**: the defining property
  `O(S + ΔS) = O(S) + ∂O(S, ΔS)` (in each carrier's composition) is
  required only on maintain verdicts; `FALLBACK(reason)` is a
  first-class outcome and maps to `live_replace` — the honest default,
  unchanged.
- Change events as delivered carry post-images. Where a form needs a
  pre-image (an interior ordered row's prior sort key, for example),
  the state contract must supply it — retained state or an authorized
  point read — or the form returns `FALLBACK`.

#### D1.2 Classification hypotheses (Stage A confirms or corrects)

| Operator | Hypothesis | State (per D1.3) |
|---|---|---|
| Row-local visibility arms (`public-read`, `Owner{field}`) | linear, state-free | none |
| Membership visibility arms (`Membership`, `AnyOf` with membership) | **not** linear — a membership-table write changes other rows' visibility; support-transition class, with DK-3's replace-pin as the shipped stance | support state (gap: OQ-2) |
| Filter (`FilterExpr`/`ValueExpr`) | linear, state-free (three-valued logic per the shipped evaluator) | none |
| Flat closed projection (row-identity preserving) | linear, state-free | none |
| Nested result assembly (objects/arrays/exists structure of the projection) | output-assembly stage, specified separately — not assumed relational projection | derived from child operators |
| Equality to-one | bilinear join; per-parent keyed patch | parent→row keys + retained other side |
| Principal-bound relation | bilinear keyed join (parent join + target lookup + visibility + filters per LLP 0209 §2); its principal partition-of-one property partitions `Δin`, it does not make the operator state-free | join state per side |
| Bounded to-many | stateful; parent-indexed ops under fanout bound; always carries ordering/paging | per-parent window state (predicate, order, window, limit, result count, boundary, completeness, row ids) |
| Ordered / limited root window (top-N) | stateful; inside / displaces-boundary / outside classification; displacement without a provable replacement ⇒ FALLBACK (the provable-replacement condition is specified once, as an operator property) | boundary sort keys, completeness, result count, row ids |
| Exists semi-join (incl. through-tables, repeated existence) | stateful; 0↔1 support transitions | per-row support counts (gap: OQ-2) |
| Search-membership | **excluded** — D6's writer owns its invalidation facts (LLP 0209 OQ-4) | — |

Stateful rows number **five** (both join kinds, to-many, window,
semi-join/membership-visibility), not three; the linear rows are the
one-liners. Stage A must additionally run a **closure check**: every
`GraphNodeV1` variant and every `TableVisibilityV1` arm maps to exactly
one row (or a named refusal), so the table provably covers the closed
surface rather than sampling it.

#### D1.3 The state contract

Per operator, Stage A publishes a state ledger with columns
**have / missing / wrong grain**, judged against *both* existing
precedents — the capture vocabulary and the G3 retained state — and
declaring for each entry: source (capture, retained relation/index
data, authorized point read), pre-image vs post-image needs, and
custody class (**server-internal** — like the evaluator's retained
state, which is deliberately non-serialized — vs **eligible to cross
the client custody boundary**, which is a separate, stricter claim
gated by LLP 0190's authority/projection restrictions). A missing or
wrong-grain entry is resolved by a 0209-path amendment or the operator
stays `FALLBACK`-pinned — never silently approximated.

Predicate evaluation inside delta forms reuses the LLP 0051 `ValueExpr`
evaluator unchanged, inheriting the matcher/SQL agreement invariant and
`Unanalyzable` ⇒ fallback.

### D2. Composition and eligibility

A plan's delta rule is the composition of its operators' forms along
the plan's dataflow (bilinear operators compose over both inputs; this
is dataflow composition, not a linear pipeline). Eligibility remains a
*conjunction with per-kind admission*: an operator kind participates
only once its form is admitted (vectors + convergence checks, §D4),
and any not-yet-admitted, state-gapped, or `FALLBACK`-returning
operator pins the plan to `live_replace` — LLP 0209 §7's rule
unchanged, including semi-joins fail-closed pending the certified
evaluator condition (LLP 0056; LLP 0067 §F2a) and one ineligible node
pinning the whole graph.

Two distinct operations stay distinct: **ineligibility** (declared
unmaintainable change ⇒ replace, normal and expected) and **comparator
divergence** (a maintained result disagreeing with fresh evaluation ⇒
§D4.3). Unifying them would either hide wrong deltas behind replace or
punish honest ineligibility.

Authority transitions are never delta-maintained; the LLP 0200 fence
and restoration own them, and delta frames carry the same
resolution-ticket and watermark obligations as any frame. Opaque
handlers stay re-run (LLP 0209 §7's categorical). Wire kinds are
untouched.

### D3. Consumers

#### D3.1 The server graph delta evaluator (established)

The G3 ladder keeps its delivery machinery (negotiation, convergence
sampling, deferral-aware bounds). What changes is the provenance of
rule content: each lane's classification and patch logic is an
instantiation of Stage A's forms, checked against the reference
evaluator and vectors, instead of free-standing prose realized ad hoc.
(Terminology: the *matcher* identifies affected nodes; the *graph
delta evaluator* computes the patch. Derivation governs the latter;
the matcher's affected-read machinery is unchanged.)

#### D3.2 Local maintenance (conditional future consumer)

LLP 0190 D3 owns local evaluation admission, conformance, and
retained-fact custody; LLP 0209 §8 separates "one IR, two evaluators"
from the undesigned replica continuity protocol. Neither document today
requires client-side delta derivation, and this RFC does not claim
otherwise. The claim is conditional: **if** local maintenance of
retained facts is built, it instantiates Stage A's forms rather than
re-authoring rules — under D3's restrictions, which make the local
state contract a *restriction* of the server's (only facts authorized
for the exact plan, projection, window, authority, and proof; protected
hidden rows must not influence output; the server's retained state is
server-internal and does not ship). What the client would maintain —
authorized base facts with local derivation, or only server-produced
patches — is the rung-5-adjacent seam decision (OQ-4), not this RFC's.

Explicitly not a consumer: the replica continuity contract
(base/predecessor stamping, cumulative-vs-compositional semantics,
gap-to-replace — LLP 0209 §8 / OQ-6). This RFC's deltas feed it; they
do not define it, and nothing here claims replica applicability.

### D4. Verification

1. **Reference evaluator + vectors (the derivation artifact).** Stage A
   ships the operator semantics as an executable reference evaluator
   over the delta carriers, plus per-operator conformance vectors
   (state, change batch, expected delta or FALLBACK) under
   `tests/conformance/` in the house pattern — three-valued-logic and
   boundary edge cases included. The reference evaluator is the
   drift-prevention mechanism (the honest analogue of LLP 0051's
   one-evaluator ruling); agreement between instantiations is "shared
   forms, one oracle, same corpus," never "by construction" from prose.
2. **Re-derivation audit with a decision rule.** Before any new rule
   lands, shipped lanes — DK-3's single-table classification and G3
   rung 1's — are compared against the reference evaluator on the
   existing corpora and replay fixtures, across eligibility decisions,
   fallback verdicts, retained-state transitions, and emitted ops (not
   only success bytes). The decision rule: **shipped behavior is the
   deployed contract and presumed correct**; each divergence is
   classified by the 0209 owners as (a) reference-semantics error —
   fix Stage A; (b) shipped defect — filed as a fix-forward ticket per
   LLP 0189, never patched by Stage B itself; or (c) intentional
   conservative approximation — recorded, with the reference noting
   the shipped lane as a sound approximation. An unclassified
   divergence blocks Stage C. Stage B changes no runtime code.
3. **Runtime comparator, described accurately.** The shipped
   discipline is DK-3's debug convergence assertion and G3 rung 1's
   default-on sampling, whose landed mismatch response is: record the
   convergence failure and **force replace for that event** — an
   honest per-event fallback, not a lane disable. This RFC keeps that
   response and does not extend LLP 0270's disable/refuse posture to
   the server-internal lane; whether *persistent* divergence should
   latch a lane off (thresholds, recovery, advertisement) is a policy
   decision left to the 0209 owners (OQ-5). LLP 0270's posture applies
   to the conditional local consumer of §D3.2, where a locally
   executable advertised profile genuinely is at stake.

### D5. Staging

- **Stage A (semantics + reference evaluator + vectors).** The typed
  operator document (D1.1 contract, D1.2 confirmed classifications,
  D1.3 state ledgers, closure check), the reference evaluator, and the
  vector corpus. No production runtime change.
- **Stage B (re-derivation audit).** §D4.2 against shipped lanes, with
  its decision rule. Blocks Stage C on unclassified divergence.
- **Stage C (new rules from the semantics).** Next ladder rungs land
  with rule content instantiated from Stage A — per-kind admission,
  vectors, and sampling unchanged; effort shifts from rule design to
  rule instantiation. Demand-gated exactly as LLP 0209 §7 gates the
  expensive rung.
- **Stage D (conditional local consumer).** Only if/when 0190 D3 takes
  up local maintenance, under §D3.2's restrictions.

Stage A/B are independently valuable: B is a correctness audit of
shipped lanes on its own, with the reference evaluator as its oracle.

## Boundaries (unchanged by this RFC)

- LLP 0209 §7's admission posture, fallback conjunction,
  authorization-lane rules, opaque-handler categorical, and
  search-membership exclusion.
- Wire kinds, delivery negotiation, sampling, and the shipped
  per-event force-replace mismatch response (§D4.3).
- The capture vocabulary and retained-state shapes, except through
  0209's ordinary amendment path where a state ledger shows a gap.
- The replica continuity contract (stays LLP 0209 OQ-6).
- Anything about opaque JavaScript: derivation applies to the closed
  algebra only.

## Open questions

1. **Home for the normative operator semantics.** A sub-Spec of this
   RFC, a new LLP 0209 section, or a standalone Spec both consumers
   cite? (Proposed: standalone; the author rules.)
2. **Membership/semi-join support state.** The current membership
   capture's matched count is not a demonstrated per-row
   support-multiplicity representation; confirm whether existing
   captures suffice for 0↔1 transitions in both directions or an
   amendment is needed — and how that sequences with the certified-
   evaluator condition LLP 0056 names.
3. **Instantiation mechanism for Stage C.** Hand-instantiation checked
   against the reference evaluator, interpreted forms, or generated
   code? (Stage A chooses; the reference-evaluator oracle is required
   either way.)
4. **Client-side state contract.** If Stage D proceeds: does the
   client maintain authorized base facts with local derivation, or
   apply server-produced patches only? (Joint 0190/0209 seam decision,
   rung-5 adjacent.)
5. **Persistent-divergence policy.** Should repeated convergence
   failures latch a server lane off (scope, thresholds, recovery,
   advertisement), or is per-event force-replace plus counting the
   permanent posture? (0209 owners.)

## Revision history

- **r2 (2026-08-25).** Response to round-1 super-refine reviews (codex,
  grok — both NOT READY). Recast the RFC as methodology + acceptance
  criteria with Stage A owning the semantics; added the D1.1 carrier
  contract (typed partial forms, bilinear joins, ordered-carrier
  composition, batch atomicity, post-image reality); corrected the
  classification table (five stateful rows; membership visibility arms
  non-linear; principal-bound as a join; projection split into flat
  vs. assembly) and made it explicitly hypotheses plus a closure
  check; replaced "state = the captures" with the D1.3 state ledger
  against both precedents (captures and G3 retained state, custody
  classes included); made the reference evaluator the derivation
  artifact and dropped "by construction"; added the Stage B decision
  rule and oracle; reframed local maintenance as a conditional future
  consumer under 0190 custody restrictions; corrected the comparator
  description to the shipped per-event force-replace and withdrew the
  LLP 0270 misapplication (persistent-divergence policy → OQ-5);
  matcher/graph-delta-evaluator terminology fixed.
- **r1 (2026-08-25).** Initial version; entered Review at loop start.
