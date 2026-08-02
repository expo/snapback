# LLP 0157: The composition algebra, plan identity, and the completeness witness

**Type:** Spec
**Status:** Draft
**Systems:** Relational queries, Query planning, Client integration,
Client SDK, Live queries, Wire Protocol, Codegen, Admin console, Testing
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-08-02
**Revised:** 2026-08-02 (v0.1, initial draft — the Move-1 owning Spec
commissioned by LLP 0155's acceptance (fc19d8ed) and assigned to a Fable
authoring session by the 2026-08-02 decision sitting, ruling 11
(`issues/20260802-author-decision-packet.md`). Layers the composition
algebra, plan identity, compositional completeness witness, capability
classification, authoring-sugar rule, inspection data model, and the
Move-2 store interface **over** LLP 0135 Part 2's execution substrate,
which it adopts and does not reopen.)
**Related:** LLP 0000, LLP 0004, LLP 0007, LLP 0008, LLP 0010, LLP 0012,
LLP 0017, LLP 0051, LLP 0053, LLP 0073, LLP 0080, LLP 0090, LLP 0093,
LLP 0094, LLP 0100, LLP 0107, LLP 0110, LLP 0114, LLP 0115, LLP 0120,
LLP 0127, LLP 0129, LLP 0130, LLP 0131, LLP 0135, LLP 0155

## Summary

LLP 0155 Move 1 commissions one owning Spec for the composable read
surface: LLP 0120 option 3a's shape, grown deliberately. The execution
substrate for that shape already exists on paper — LLP 0135 Part 2
specifies `snapshot-batch.v1`: the static node tuple, one-snapshot
execution, canonical parent-authorization dedup, seal-entirely partial
refusal, the `sbsb1` coordinated cursor, summed work ceilings, and the
experimental-dependency acknowledgment. This Spec deliberately adds no
second execution path and re-decides none of that.

What was commissioned and remains unowned is everything *around* that
substrate, and this Spec owns exactly it:

1. **The node algebra** — what a node class is, which classes are
   admitted, how the vocabulary grows, and the closed refusal when a
   requested composition exceeds it.
2. **Plan identity** — one canonical-args + normalized-plan hash shared
   by codegen, server admission, live matching, result contracts, client
   materialization, and inspection.
3. **The completeness witness** — the public
   `unknown | complete | prefix | refused` state, bound compositionally
   to one authoritative snapshot, fail-closed everywhere.
4. **Capability classification** — the composite's delivery/retention
   class derived from its nodes', never asserted.
5. **The authoring-sugar rule** — any author-facing syntax compiles to
   admitted nodes or refuses with a closed reason.
6. **The inspection data model** — one model, two projections (server
   console, client artifact), answering LLP 0155 OQ11.
7. **The Move-2 store interface** — how fragments are keyed and ingested,
   with cross-query normalization registered as a gated upgrade this
   Spec does not admit.

## Scope and authority

This Spec owns the seven items above, as the owning document LLP 0155
Move 1 names. It does **not** own:

- **Node-class internals.** `relational_query_v1` stays LLP 0080's;
  `bounded-children.v1` stays LLP 0110's; membership-addressed and
  search-adjacent shapes stay LLP 0100's and LLP 0073's. A new node
  class is a proposal to its owning document, never a side effect here.
- **Composite execution.** One-snapshot semantics, parent-auth dedup,
  seal-entirely refusal, the `sbsb1` cursor grammar and its AEAD
  protocol, ceilings, and the maturity/acknowledgment route are
  LLP 0135 Part 2's, adopted verbatim (§D8). Admitting
  `relational_query_v1` nodes *inside* a composite is 0135's open
  question 5 successor decision, not this Spec's to make.
- **Wire encodings.** The witness and inspection facts get wire shapes
  as dated amendments with LLP 0093/0094, like every other frame.
- **Store carriers and custody barriers.** LLP 0008 DK-9 and LLP 0053
  govern; §D7 defines the interface, not the carrier.
- **Settlement and optimistic layers.** LLP 0133 and the LLP 0114/0107
  seam; §D7 only names where their facts sit beside fragments.
- **Aggregates.** Deferred whole to LLP 0130 SD-2's evidence branch
  (LLP 0155's acceptance) — no aggregate node class exists here,
  including `count`.

Acceptance path: commissioned by an Accepted RFC; LLP 0130 SD-4's
standing rule applies if the dual-family loop converges READY within
this commission's scope; the author decides otherwise.

## Vocabulary

- **Node class.** An admitted, owner-governed bounded plan shape with
  its own declared bounds, visibility contract, refusal behavior,
  cursor identity, and examined-entry ceiling. V1 classes:
  `relational_query_v1` (LLP 0080), `bounded-children.v1` (LLP 0110).
- **Node.** One complete, individually valid plan of an admitted class,
  with bound arguments.
- **Composite.** A static tuple of nodes executed at one authoritative
  snapshot under LLP 0135 Part 2. A **single-node read** is the
  degenerate composite: every generated read query participates in this
  Spec's identity, witness, classification, and inspection contracts,
  whether or not it composes.
- **Plan identity.** The `(normalized plan hash, canonical args)` pair
  of §D2.
- **Witness.** The server-issued completeness fact of §D3.
- **Fragment.** An opaque authorized result for one plan identity,
  stored client-side with its witness (§D7; LLP 0155 Move 2's admitted
  baseline).

## D1 — The node algebra

A composite declares a **static tuple** of nodes. The algebra admits:

- one bounded root window per node with declared index, filters, stable
  ordering, and keyset pagination — exactly the owning class's admitted
  shape, unchanged;
- typed to-one reads where an admitted class provides them (LLP 0080's
  unique joined side is the shipped to-one form; a free-standing to-one
  node class is OQ3, owned by the 0080/0110 family);
- bounded to-many relationship nodes (`bounded-children.v1`);
- nested projection only as composition of admitted nodes' own
  projections — the algebra invents no projection vocabulary;
- relationship refinements (filters, ordering, limits on a related
  node) expressed as that node's **own parameters**, never as free
  predicates attached from outside;
- membership/semi-join predicates only as future admitted node classes
  whose visibility and invalidation their owners prove (OQ6).

Closure rules, normative:

1. **The tuple is static.** No node's arguments may reference another
   node's output; data-dependent invocation is LLP 0120 option 3, not
   3a, and refuses (`SNAPBACK_COMPOSITE_DYNAMIC_NODE`, working code).
2. **Vocabulary grows only through owners.** A shape the algebra cannot
   express is a node-class proposal to its owning document. This Spec's
   admitted-class registry is the single place a new class is recorded,
   with a dated note citing the owner's admitting decision.
3. **Substrate admission is the substrate's.** Which classes may appear
   in a *multi-node* composite is LLP 0135's admission question (v1:
   `bounded-children.v1` only, 2–8 nodes, summed `take` ≤ 1,024). The
   algebra is defined over all admitted classes so that 0135's OQ5
   successor — admitting `relational_query_v1` nodes — changes no
   contract here, only the substrate's admission list.
4. **Refusal is closed.** Every rejection names a stable reason: the
   unadmitted class, the dynamic reference, the exceeded ceiling, or
   the sugar construct that failed to compile (§D5). Silent narrowing
   is not a refusal mode.

## D2 — Plan identity

One identity serves every surface. For each generated read:

- **Canonical args** follow LLP 0131's canonical-form rules (including
  its explicit-null projection ruling); merged composite arguments obey
  LLP 0135 §2.1 (same name ⇒ identical declared type).
- **The normalized plan** is the closed record of the composite: the
  ordered node tuple, each node's class, plan, and argument bindings,
  and the derived parent-authorization grouping (LLP 0135 §2.2's
  `ParentAuthorizationKeyV1` classes, which already enter the hash).
- **The plan hash** is the canonical bytes (RFC 8785 JCS, as 0135
  pins for the dedup key) of the normalized plan. It is
  generation-scoped: a codegen output that changes any admitted fact
  changes the hash.

Normative sharing rule: codegen emits the hash; server admission admits
by it; live matching, result contracts, client materialization
(fragment keys, §D7), and inspection (§D6) all key by the same
`(plan hash, canonical args)` pair. No surface derives a second
identity for the same plan; an implementation that needs an internal
key derives it *from* this one. Golden vectors freeze hash stability
across Rust, JS, and codegen (acceptance sketch 3).

## D3 — The completeness witness

The public state is small, exactly LLP 0155's:

- `unknown` — useful local rows may exist; no proof of completeness at
  the requested authority/version.
- `complete` — the server established the full admitted result for this
  plan identity at a named snapshot version.
- `prefix` — **reserved.** Pinned per LLP 0155 OQ4's lean: no plan may
  claim it in v1, and hitting any implementation cap can never produce
  it. Unreserving requires a real application need and a plan-proved
  stable-prefix rule, as a dated amendment here (OQ8).
- `refused` — the query cannot establish its promised class; carries a
  stable closed reason and the safe fallback where one exists.

Binding, normative: `complete` binds to at least the plan hash,
canonical args, authority partition, query instance/generation,
snapshot version, and the full declared node set. **One common
snapshot:** a composite is `complete` only when every declared node was
established at one authoritative snapshot — independently hydrated
fragments at skewed versions assemble to `unknown`, however
individually authoritative each fragment is. Advancing any nested
cursor, changing any node's args, or invalidating any node's
membership returns the composite to `unknown` until re-established.

Fail-closed floor: the interim milestone LLP 0155 names — refusing
implicit-cap results on the existing LLP 0080 grammar
(`SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED`, partially landed) — is this
witness's floor, not a separate mechanism. Under this Spec that refusal
is the `refused` state with that reason; no code path may translate a
cap hit into `complete` or into silence.

Authority: the witness is a **server-issued fact**. A client may cache
and display it; it may never mint, upgrade, or extend one — not from
row counts, not from cap coincidence, not from replaying deltas. A
weaker per-node state, if ever wanted, ships as its own labeled state
under a dated amendment; it is never spelled `complete`.

## D4 — Capability classification

Every plan identity carries a generated classification over four axes:
incremental-delta eligibility, replace-only delivery, retained
eligibility, and online-only execution. Rules:

1. **Single-node reads keep their owners' classes.** Nothing here
   reclassifies an existing `relational_query_v1` or
   `bounded-children.v1` plan.
2. **Composites classify by meet.** A composite's class on each axis is
   the weakest of its nodes' — and for incremental delta, v1 pins the
   meet to **replace-only**: no composite receives row-level
   `live_delta` operations until a successor defines composite delta
   semantics (OQ7). This inherits the shipped conservative posture
   (delta candidacy admits only the schema-exact `documents(table)`
   contract; everything else re-queries and replaces).
3. **Retention is per LLP 0080's retention class** and the LLP 0008
   DK-9 envelope: `opaque-authorized-snapshot-v1` fragments plus
   witness (§D7). A composite is retained-eligible only if every node
   is.
4. **Live classification and result identity of the composite** are
   LLP 0135 §2.5's; this Spec consumes them as facts.

Classification is a generated artifact fact, visible to the inspector
and the capability machinery; a target that cannot honor a class
refuses at admission, never degrades silently.

## D5 — The authoring surface

The authoring altitude should approach ordinary query composition:
declare a shape, use it. The rule that keeps that safe:

**Any author-facing syntax is compilation sugar over the algebra.** A
graph/builder/fluent spelling compiles to a static tuple of admitted
nodes — or refuses with a closed reason naming the construct that does
not compile. The sugar layer admits no predicate, traversal, aggregate,
or data-dependent invocation the algebra lacks; a desired shape beyond
the algebra is a node-class proposal to the owning document, and the
refusal says so.

The concrete generated spelling (builder names, file placement,
generated types) lands with the codegen owners under LLP 0004/0131
conventions; G-02's interior-type work
(`issues/20260802-convex-erg-02-move1-type-flow-remainder.md`) consumes
this Spec's result shapes and must not invent parallel ones.

## D6 — Inspection: one data model, two projections

Answering LLP 0155 OQ11: **one inspection data model, two projections.**
The model is defined here; the server projection rides LLP 0017's admin
console / host-ops surface, and the client projection is a
store-adjacent read-only artifact for local materialization state
(format: OQ5). Neither projection introduces facts of its own.

For every active or retained plan identity the model answers: the
generated query, canonical args, plan hash, app/deployment, and
authority partition; the witness state and its reason; which fragments
are materialized and which plan identities retain each; the indexes,
bounds, and ceilings the plan uses (including the dedup grouping); the
snapshot/current version, resume state, and hydration byte/row counts;
whether updates arrive by delta, replacement, or forced resnapshot;
the authorization dependencies and negative-delivery obligations in
force; and which pending intents currently affect presentation.

Facts derive exclusively from the plan identity (§D2), the witness
(§D3), the classification (§D4), the store metadata (§D7), and the
existing authorization/settlement records. The inspector holds no
authority; a fact it cannot derive is displayed as absent, never
guessed.

## D7 — The Move-2 store interface

The client store consumes this Spec through one interface, inside the
LLP 0155 Move 2 admitted baseline (fragments first):

- **Keying.** Fragments key by `(plan hash, canonical args, authority
  partition, query instance/generation)` — §D2's identity, nothing
  parallel.
- **Witness storage.** Each fragment stores its witness; rendering a
  fragment without its witness state is outside the paved path.
- **Ingestion admits only contract-validated frames.** The delta-lane
  egress defect closed by lane refusal (eda8f231; regression in
  `tests/live_delta_v0.rs`) is the worked example of this guardrail's
  posture: refuse the lane rather than trust the frame. If delta
  candidacy is ever re-widened, the adversarial ingestion case re-runs
  before widened frames may be durably retained (LLP 0155 Move 2's
  standing obligation, carried here).
- **Membership and retention.** Removing a plan identity's last
  membership never overrides an LLP 0053 deletion obligation or lease
  deadline; quarantine/expiry/user-switch barriers apply to fragments
  exactly as to today's RQS snapshots.
- **Normalization is a gated upgrade this Spec does not admit.**
  Cross-query canonical-row sharing requires field/projection
  provenance, merge and version reconciliation, per-membership deletion
  behavior, and proof of no cross-partition existence or field oracle —
  LLP 0155 OQ2's bar, registered here as OQ2 with its evidence class
  (adversarial-projection fixtures), to be admitted only by a dated
  amendment to this section after that evidence exists. The dated
  LLP 0008 DK-9 and LLP 0080 retention-class amendments LLP 0155 Move 2
  commissions land with their owners before any local plan evaluation
  over fragments ships.

## D8 — Relationship to LLP 0135 Part 2

Adopted verbatim, cited as facts, not re-specified: the
`SnapshotBatchPlanV1` manifest shape and static-tuple rule (§2.1);
one-snapshot execution and canonical parent-auth dedup (§2.2);
seal-entirely partial refusal (§2.3) — which this Spec surfaces as
witness state `refused` with 0135's sealed reason; the `sbsb1`
composite cursor and coordinated resume (§2.4); work ceilings, result
identity, and live classification (§2.5); the experimental-dependency
acknowledgment (§2.6); and the capability ids and diagnostics (§3).

Division of labor with the implementation ticket
(`issues/20260802-wave1-0135-sequences-snapshot-batch.md`): 0135
Part 2 is implementable as written; this Spec's layers (identity,
witness, classification, inspection, store interface) attach to it and
to single-node plans without changing its semantics. The cursor
grammar is 0135's; this Spec pins nothing about it beyond adoption.

## Guardrails

- No arbitrary SQL or client-supplied query AST reaches storage.
- No implicit implementation cap is ever presented as `complete`.
- No client-side composition requires custody of source rows the
  result is not authorized to expose.
- No aggregate node class exists until the owning family decides result
  semantics, invalidation, and protected-source noninterference —
  after SD-2's evidence branch.
- No relationship plan widens visibility relative to any source.
- No author-facing syntax admits what the algebra cannot express.
- No client mints or upgrades a witness.

## Acceptance sketches

Falsifiable; each lands with its implementing slice.

1. **Fail-closed cap.** A query hitting the 1,024 frame on the existing
   grammar yields `refused` with the implicit-limit reason; no path
   yields `complete` or silent truncation. Falsified by a cap presented
   as complete.
2. **One common snapshot.** Two nodes hydrated at skewed versions
   assemble to `unknown`; re-establishment at one snapshot yields
   `complete` bound to that version. Falsified by an
   apparently-complete skewed assembly.
3. **Identity stability.** Golden vectors: the same declaration
   produces byte-identical plan hashes from codegen, Rust admission,
   and the JS client; near-miss vectors (reordered nodes, renamed
   argument, changed visibility declaration) produce distinct hashes.
   Falsified by any surface deriving a divergent identity.
4. **Sugar refusal.** An author spelling with a data-dependent node
   reference refuses with `SNAPBACK_COMPOSITE_DYNAMIC_NODE`-class
   reason naming the construct; nothing partially compiles. Falsified
   by silent narrowing.
5. **Classification meet.** A composite containing one
   non-retained-eligible node is not retained-eligible; every v1
   multi-node composite is replace-only on the live axis. Falsified by
   a composite outclassing its weakest node.
6. **Inspector honesty.** For a retained composite, the client
   projection explains every fragment's retaining identity and every
   witness transition in a scripted churn sequence; a fact the model
   cannot derive renders as absent. Falsified by a guessed fact.
7. **Mallory.** A composite whose nodes span visibility declarations
   delivers no protected source or result row to an unauthorized
   subscriber, at the store/wire boundary, under the same adversarial
   fixtures the node classes already carry. Falsified by any leak the
   single-node fixtures would have caught.
8. **Cursor perturbation.** Advancing one nested cursor returns the
   composite witness to `unknown` until re-established at a new common
   snapshot; the `sbsb1` protocol semantics themselves are asserted by
   0135's own suite, not duplicated here.

## Migration and compatibility

Existing generated queries, `liveQuery`, and React hooks are unchanged;
they gain plan identity and witness facts additively under the
wire-version rules (dated 0093/0094 amendments). Older clients continue
on replace/resnapshot paths, per the opaque-cursor contract (LLP 0012).
Existing RQS retained snapshots migrate to fragment keying by their
already-recorded plan/args identity or fall back to fresh sync; a
migration that cannot prove identity discards retained state rather
than mislabeling it, and never drops pending intent (LLP 0155 Move 2's
migration guardrail).

## Non-goals

No aggregates (including count); no free predicate or traversal
language; no data-dependent composition; no client-side authority over
completeness; no second execution substrate beside LLP 0135 Part 2; no
wire encodings (owners' amendments); no normalization admission (§D7's
gate); no change to LLP 0080's or LLP 0110's own admitted shapes.

## Open questions

1. Admission of `relational_query_v1` nodes into multi-node composites —
   LLP 0135 OQ5's successor list governs; this Spec needs only the
   admitted-class registry note when it lands.
2. The normalization evidence bar (§D7): the adversarial-projection
   fixture corpus and who owns its review — with LLP 0155 OQ2.
3. A free-standing typed to-one node class: needed, or does LLP 0080's
   unique joined side suffice for the Stage-1 applications? Owner:
   the 0080/0110 family.
4. Witness and inspection wire shapes — dated LLP 0093/0094 amendments.
5. The client inspection artifact's concrete format and transport
   (store-adjacent file? dev-server route? both?), with LLP 0114's
   seam owners.
6. Membership/semi-join node classes — with LLP 0100/0073, including
   how their invalidation composes with the one-snapshot witness.
7. Composite incremental-delta semantics (lifting the v1 replace-only
   meet) — requires per-node delta provenance inside one witness;
   deliberately unowned until a real application needs it.
8. The `prefix` unreserve trigger: which application, and what
   plan-proved stable-prefix rule.

## Status

Draft, v0.1. Commissioned by LLP 0155's acceptance (Status step 2) and
authored under the 2026-08-02 decision sitting's ruling 11. Next: the
LLP 0005 dual-family review loop scaled to cross-subsystem stakes;
LLP 0130 SD-4's standing acceptance applies if the loop converges
within the commission's scope. Consumers waiting: LLP 0155 Stage 1,
the snapshot-batch half of
`issues/20260802-wave1-0135-sequences-snapshot-batch.md` (cursor
grammar already pinned by 0135 — no wait needed there), and G-02's
generated result types.
