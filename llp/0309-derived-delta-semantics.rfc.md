# LLP 0309: Derived delta semantics for the closed query algebra

**Type:** RFC
**Status:** Accepted
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
and image direction is carrier-dependent (D1.1 is the carrier rule),
not the remove-plus-add pairing a Z-set assumes. Stage A's
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
- **Composite nodes decompose; every input gets a change term.** The
  elementary operators are unary or binary; binary forms type `Δin` as
  a product (or two unary arms plus a both-change arm) — the unary
  arms use retained state of the other side, the both-change arm uses
  both deltas, and directly typed n-ary forms likewise owe their
  interaction terms (the defining equivalence property enforces this). Composite node kinds are covered by
  **syntax-directed decomposition into elementary operators** — a
  principal-bound relation may consume parent, optional binding, and
  target relations; a through-edge semi-join consumes parent, through,
  and target relations — or, where Stage A instead types an n-ary form
  directly, it must give the change term for every input. No composite
  is treated as two-input by fiat.
- `∂O` is **partial by design**: the defining property
  `O(S + ΔS) = O(S) + ∂O(S, ΔS)` (in each carrier's composition) is
  required only on maintain verdicts; `FALLBACK(reason)` is a
  first-class outcome. For the server consumer it maps to
  `live_replace` — the honest default, unchanged; other consumers
  handle it per §D3.2.
- Image direction is carrier-dependent, and the rule is scoped to the
  admitted application-row carriers: inserts and updates deliver
  post-images; deletes may deliver the pre-image or no row at all
  (other production change kinds can carry no row and are out of
  scope for maintain verdicts).
  Where a form needs an image the carrier does not supply (an interior
  ordered row's prior sort key, for example), the state contract must
  supply it — retained state or an authorized point read — or the form
  returns `FALLBACK`.

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

Stateful rows number **six** (membership visibility arms, both join
kinds, to-many, window, exists semi-join), with nested result assembly
a separate derived bucket; the linear rows are the one-liners. Stage A
must additionally run a **closure check**: every `GraphNodeV1` variant
and every `TableVisibilityV1` arm maps to a **decomposition** into
table rows (or a named refusal) that covers all of its semantic
components. "Elementary" describes Stage A's corrected inventory, not
today's hypothesis rows (some of which are still composite); a
directly typed n-ary row that supplies every input's change term is an
admissible decomposition target — what is inadmissible is treating a
composite as covered without accounting for each component.

#### D1.3 The state contract

Per operator, Stage A publishes a state ledger with columns
**have / missing / wrong grain**, judged against *both* existing
precedents — the capture vocabulary and the G3 retained state — and
declaring for each entry: source (capture, retained relation/index
data, authorized point read), pre-image vs post-image needs, and
custody class (**server-internal** — like the evaluator's retained
state, which is deliberately non-serialized — vs **eligible to cross
the client custody boundary**, which is a separate, stricter claim
gated by LLP 0190's authority/projection restrictions). The ledger's
scope includes the **outer serving state** the shipped lanes maintain —
window ledgers and capture-freshness/replacement transitions — not only
per-operator relation state. A missing or wrong-grain entry is resolved
by a capture amendment through 0209's path, by an **evaluator-internal
retained-state addition** (internal state is not profile surface and
needs no capture amendment), or the operator stays `FALLBACK`-pinned —
never silently approximated.

Predicate evaluation inside delta forms reuses the LLP 0051 `ValueExpr`
evaluator unchanged, inheriting the matcher/SQL agreement invariant and
`Unanalyzable` ⇒ fallback.

### D2. Composition and eligibility

A plan's delta rule is the composition of its operators' forms along
the plan's dataflow (bilinear operators compose over both inputs; this
is dataflow composition, not a linear pipeline). Eligibility remains a
*conjunction with per-kind admission*: an operator kind participates
only once its form is admitted (vectors + convergence checks, §D4),
and any not-yet-admitted or state-gapped operator — or a `FALLBACK`
*verdict* from an admitted form on the change at hand (every form is
partial; the verdict, not the operator class, is what pins) — pins the
plan to `live_replace` — LLP 0209 §7's rule
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
The conditional mandate is scoped to client-side **derivation**:
applying server-produced patches is not operator-level derivation and
carries no Stage A obligation. `FALLBACK` handling is
consumer-specific — server-side, replace; locally, the honest response
is the profile's (`unknown`, hydrate, or refusal per LLP 0190), never
a silent local approximation.

Explicitly not a consumer: the replica continuity contract
(base/predecessor stamping, cumulative-vs-compositional semantics,
gap-to-replace — LLP 0209 §8 / OQ-6). This RFC's deltas feed it; they
do not define it, and nothing here claims replica applicability.

### D4. Verification

1. **Reference evaluator + vectors (the derivation artifact).** Stage A
   ships the operator semantics as an executable reference evaluator
   over the delta carriers, plus per-operator conformance vectors
   (state, change batch, expected delta or FALLBACK; maintain vectors
   additionally pin **expected next state**, since forms return
   `state_O'` only on maintain — a FALLBACK vector pins the verdict
   and reason, with state rebuilt by the replace path) under
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
   only success bytes), **and** the shipped maintenance obligations
   beyond them: bounded/authorized read effects, proof updates and
   composition, window-ledger transitions, and stale-capture
   replacement/continuity (capture freshness — not the replica
   continuity protocol, which stays OQ-6 and outside Stage B). Each of
   those axes is either inside the
   derivation/equivalence contract or explicitly excluded and
   protected by its own mandatory acceptance gate — never silently out
   of scope. The decision rule: **shipped behavior is the
   deployed contract and presumed correct**; each divergence is
   classified by the 0209 owners as (a) reference-semantics error —
   fix Stage A; (b) shipped defect — filed as a fix-forward ticket per
   LLP 0189, never patched by Stage B itself; or (c) intentional
   conservative approximation — recorded, with the reference noting
   the shipped lane as a sound approximation; class (c) records are
   **shipped-lane-only** and never become per-kind exceptions
   instantiated into new rungs. An unclassified divergence blocks
   Stage C. Stage B changes no runtime code.
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

**Commissioning gate (author ruling, 2026-08-25) — FIRED same day.**
The gate as ruled: Stage A is not commissioned until a trigger fires —
**(a)** the next G3 ladder rungs are commissioned (the semantics then
amortizes across rungs 2..n instead of competing with a single
hand-written rung, and Stage A is a candidate path to the
certified-evaluator condition, LLP 0056, that pins the semi-join rung
to replace), or **(b)** LLP 0190 D3 takes up local maintenance of
retained facts (the cross-runtime drift argument stops being
hypothetical).

**Trigger (a) fired by author direction later the same day
(2026-08-25):** the author commissioned Stage A with declared intent
to continue the delta-lane ladder past rung 1 — the remaining §7
shapes (window boundary displacement, bounded to-many, semi-joins
behind their evaluator condition) are the intended Stage C
beneficiaries. Commission ticket:
`issues/shelved/20260825-llp0309-stage-a-commission.md`. Each Stage C rung
individually remains demand-gated exactly as LLP 0209 §7 gates the
expensive rung; firing the trigger commissions Stages A and B, not
any particular rung.

## Boundaries (unchanged by this RFC)

- LLP 0209 §7's admission posture, fallback conjunction,
  authorization-lane rules, opaque-handler categorical, and
  search-membership exclusion.
- Wire kinds, delivery negotiation, sampling, and the shipped
  per-event force-replace mismatch response (§D4.3).
- The capture vocabulary, except through 0209's ordinary amendment
  path where a state ledger shows a gap. (Evaluator-internal
  retained-state additions are not profile surface and follow D1.3's
  third path — ordinary landing discipline, no capture amendment; this
  boundary does not forbid them.)
- The replica continuity contract (stays LLP 0209 OQ-6).
- Anything about opaque JavaScript: derivation applies to the closed
  algebra only.

## Open questions

1. **Home for the normative operator semantics.** RULED (author,
   2026-08-25): a sub-Spec of this RFC —
   `llp/0309.000-operator-delta-semantics.spec.md`. Both consumers
   cite it by its LLP number; sub-numbering keeps the derivation
   methodology (this RFC) and the semantics it commissions in one
   lineage.
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

- **Accepted (2026-08-25, author ruling).** Status `Review` →
  `Accepted`, with the close-out's proposed trim applied: the r1–r5
  per-round entries below are compressed here; full round-by-round
  detail is the sealed loop record
  (`llp/reviews/0309-derived-delta-semantics.run.md` and the
  per-family artifacts beside it). Same ruling resolved OQ-1 (home =
  sub-Spec `0309.000`) and fired commissioning trigger (a) — see §D5.
- **r1–r5 (2026-08-25, compressed at acceptance).** r1 entered Review
  at super-refine loop start. r2/r3 folded two rounds of dual-family
  reviews (both families NOT READY on r1; codex NOT READY on r2;
  **dual-READY on r3**, target sha256/16 `9afb39a63b380c41`): the RFC
  was recast as methodology + acceptance criteria with Stage A owning
  the semantics; the D1.1 carrier contract, D1.2
  hypotheses-plus-closure-check framing, D1.3 dual-precedent state
  ledger with custody classes, the executable reference evaluator as
  the derivation artifact, the Stage B decision rule and multi-axis
  oracle, the conditional-consumer reframing of local maintenance,
  and the accurate per-event force-replace comparator description all
  date from those rounds. r4 (UNREVIEWED) folded round-3 non-material
  observations. r5 (UNREVIEWED, author-directed) added the D5
  commissioning gate and archived the `current/` link; the link was
  restored by author direction the same day, gate standing, and the
  gate fired later that day (§D5).
