# LLP 0157: The composition algebra, plan identity, and the completeness witness

**Type:** Spec
**Status:** Draft
**Systems:** Relational queries, Query planning, Client integration,
Client SDK, Live queries, Wire Protocol, Codegen, Admin console, Testing
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-08-02
**Revised:** 2026-08-02 (consumer-status reconciliation: §D8's existing
division of labor is applied to the tracking prose — LLP 0135 Part 2 and its
cursor grammar are implementable without waiting for this Spec's identity,
completeness, inspection, and store layers); 2026-08-02 (v0.1, initial draft — the Move-1 owning Spec
commissioned by LLP 0155's acceptance (fc19d8ec) and assigned to a Fable
authoring session by the 2026-08-02 decision sitting, ruling 11
(`issues/20260802-author-decision-packet.md`).) 2026-08-02 (v0.2,
round-1 fixes: Codex round 1 returned NOT READY — 5 BLOCKING,
4 MATERIAL, 1 NIT (`reviews/0157-composition-algebra-and-completeness.codex.md`);
the author-family session verified the four load-bearing substrate
citations before applying. Applied: C1 — the LLP 0135 §2.3 sealed
`absent` envelope is preserved verbatim and a sealed absence at a common
snapshot is `complete` (the admitted result *is* the sealed absence);
`refused` is reserved for plan/admission/runtime refusal and discloses
no sealed cause. C2 — plan identity split into `PlanHashV1`
(domain-separated SHA-256 over a closed, versioned JCS preimage, host
recompute + exact-compare) and `QueryMaterializationKeyV1` (activation,
exported function identity, contract identities, plan hash,
LLP 0114-canonical args); cross-function dedup is explicitly not
identity. C3 — `CompletenessProofV1` is a closed binding including the
version stream, activation, the LLP 0053 authorization witness
reference, the page identity (input continuation or per-node
boundary/terminal vector), and a batch identity, with atomic
whole-set installation. C4 — `CompletenessStatusV1` (client-visible,
locally producible `unknown`) separated from the server-issued proof,
with a total transition table; cursor language rewritten around the
single composite continuation (0135 removes per-node public cursors).
C5 — §D4 no longer re-decides LLP 0135 §2.5: v1 `snapshot-batch.v1`
facts are restated exactly (cursor-free-first-page `live_replace`, no
`live_delta`, `retention:"none"`); the meet algebra moves to an
explicit successor profile and the retained-composite acceptance case
is removed. C6 — §D7 integrates LLP 0053's fences: the
generation-triple compare-and-commit on every fragment write and
render, fence state excluded from the materialization key,
tombstone/quarantine/lease/user-switch/terminal-retirement behavior by
its rules, and the authorization `CompositeWitness` named as distinct
from the completeness proof. C7 — a normative commission crosswalk
added; the Triage/Fleet exit gates restored verbatim; Move-1 exit
recorded as blocked on LLP 0135 OQ5's relational-node successor where
Fleet requires it. C8 — acceptance sketches rewritten as
fixture-oriented oracles: same-version different-page mixing,
crash-mid-install atomicity, auth-fence race, paired sealed worlds,
and a positive inspector oracle; the impossible retained-composite and
per-node-cursor cases removed. C9 — §D6 gains audience and redaction
rules: ordinary inspection preserves LLP 0080 §3's
missing-versus-invisible indistinguishability, sensitive per-row facts
ride the separately authorized audit channel, and the client artifact
binds to its own authority partition. C10 — diagnostics are labeled
placeholder-until-registered, and the LLP 0080 boundary note folds into
its existing Revised field.)
**Related:** LLP 0000, LLP 0004, LLP 0007, LLP 0008, LLP 0010, LLP 0012,
LLP 0017, LLP 0051, LLP 0053, LLP 0073, LLP 0080, LLP 0090, LLP 0093,
LLP 0094, LLP 0100, LLP 0107, LLP 0110, LLP 0114, LLP 0115, LLP 0120,
LLP 0127, LLP 0129, LLP 0130, LLP 0131, LLP 0135, LLP 0145, LLP 0155

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
2. **Plan identity** — `PlanHashV1` plus `QueryMaterializationKeyV1`,
   one identity discipline shared by codegen, server admission, live
   matching, result contracts, client materialization, and inspection.
3. **The completeness witness** — the client-visible
   `CompletenessStatusV1` and the server-issued `CompletenessProofV1`,
   fail-closed everywhere.
4. **Capability classification** — v1 facts restated from the owners;
   any composite meet algebra as an explicit successor profile.
5. **The authoring-sugar rule** — any author-facing syntax compiles to
   admitted nodes or refuses with a closed reason.
6. **The inspection data model** — one model, two projections, with an
   authorization boundary (answers LLP 0155 OQ11).
7. **The Move-2 store interface** — fragment identity, ingestion, and
   the LLP 0053 fence integration, with cross-query normalization
   registered as a gated upgrade this Spec does not admit.

## Scope and authority

This Spec owns the seven items above, as the owning document LLP 0155
Move 1 names, and §Commission crosswalk maps every Move 1/2 obligation
to its section, owner, or blocking dependency. It does **not** own:

- **Node-class internals.** `relational_query_v1` stays LLP 0080's;
  `bounded-children.v1` stays LLP 0110's; membership-addressed and
  search-adjacent shapes stay LLP 0100's and LLP 0073's. A new node
  class is a proposal to its owning document, never a side effect here.
- **Composite execution.** One-snapshot semantics, parent-auth dedup,
  the sealed `absent` envelope, the `sbsb1` cursor grammar and its AEAD
  protocol, ceilings, v1 classification, and the
  maturity/acknowledgment route are LLP 0135 Part 2's, adopted verbatim
  (§D8). Admitting `relational_query_v1` nodes *inside* a composite is
  LLP 0135 OQ5's successor decision, not this Spec's.
- **Wire encodings.** The status, proof, and inspection facts get wire
  shapes as dated amendments with LLP 0093/0094.
- **Store carriers and the authorization fence machinery.** LLP 0008
  DK-9 and LLP 0053 govern; §D7 binds to LLP 0053's obligations and
  invents no parallel fence.
- **Settlement and optimistic layers.** LLP 0133 and the LLP 0114/0107
  seam; §D7 names where their facts sit beside fragments.
- **Aggregates.** Deferred whole to LLP 0130 SD-2's evidence branch
  (LLP 0155's acceptance) — no aggregate node class exists here,
  including `count`.

Acceptance path: commissioned by an Accepted RFC; LLP 0130 SD-4's
standing rule applies if the dual-family loop converges READY within
this commission's scope; the author decides otherwise.

## Vocabulary

- **Node class.** An admitted, owner-governed bounded plan shape with
  its own declared bounds, visibility contract, refusal behavior, and
  examined-entry ceiling. V1 classes: `relational_query_v1`
  (LLP 0080), `bounded-children.v1` (LLP 0110).
- **Node.** One complete, individually valid plan of an admitted class,
  with bound arguments.
- **Composite.** A static tuple of nodes executed at one authoritative
  snapshot under LLP 0135 Part 2. A **single-node read** is the
  degenerate composite: every generated read query participates in this
  Spec's identity, witness, classification, and inspection contracts.
- **Page.** One established composite result: the node-tuple output for
  one input continuation (or the first page, with no continuation), at
  one snapshot. The unit of establishment, proof, and installation.
- **Fragment.** The stored client-side representation of one page for
  one materialization key, opaque and authorized, stored with its
  proof. V1 fragment granularity is exactly one page — never a
  row-level slice, never a partial tuple.
- **`PlanHashV1` / `QueryMaterializationKeyV1` /
  `CompletenessStatusV1` / `CompletenessProofV1`.** §D2/§D3's four
  distinct schemas. LLP 0053's authorization `CompositeWitness` is a
  fifth, pre-existing thing; nothing here renames or absorbs it.

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
   3a, and refuses. (Diagnostic spelling: placeholder
   `SNAPBACK_COMPOSITE_DYNAMIC_NODE` until registered in the LLP 0048
   corpus with the implementing slice; every code this Spec names is a
   placeholder under the same rule.)
2. **Vocabulary grows only through owners.** A shape the algebra cannot
   express is a node-class proposal to its owning document. This Spec's
   admitted-class registry is the single place a new class is recorded,
   with a dated note citing the owner's admitting decision.
3. **Substrate admission is the substrate's.** Which classes may appear
   in a *multi-node* composite is LLP 0135's admission question (v1:
   `bounded-children.v1` only, 2–8 nodes, summed `take` ≤ 1,024). The
   algebra is defined over all admitted classes so that LLP 0135 OQ5's
   successor — admitting `relational_query_v1` nodes — changes no
   contract here, only the substrate's admission list.
4. **Refusal is closed.** Every rejection names a stable reason: the
   unadmitted class, the dynamic reference, the exceeded ceiling, or
   the sugar construct that failed to compile (§D5). Silent narrowing
   is not a refusal mode.

## D2 — Plan identity

Two distinct schemas, both closed and versioned.

**`PlanHashV1` — the plan's structural identity.** The preimage is
`NormalizedCompositePlanV1`: a closed, versioned record of the ordered
node tuple; each node's class id and class version, normalized plan,
and argument-binding names and declared types; the composite's merged
argument declaration; and the derived parent-authorization grouping
(LLP 0135 §2.2's `ParentAuthorizationKeyV1` equivalence classes,
serialized as the ordered list of group keys' canonical bytes). The
hash is **SHA-256 over the RFC 8785 JCS bytes of that record, domain-
separated** by the prefix string `snapback:plan-hash:v1:`. The host
recomputes the hash from its own normalization and **exact-compares**
at admission; a mismatch refuses — the client's spelling is never
trusted. Runtime argument *values* are not part of the preimage.

**`QueryMaterializationKeyV1` — the observable query identity.** Plan
structure alone is not identity: two exported functions with the same
normalized plan are distinct observable surfaces (LLP 0135 §2.5 gives
the composite the exported function's identity), and existing
generated references already bind function, contract, and activation
identities. The materialization key binds, at minimum:

- app/deployment and schema/artifact activation identity;
- the exported function/reference identity;
- the argument-contract and result-contract identities (LLP 0131);
- `PlanHashV1`;
- canonical runtime arguments under LLP 0114's
  `CanonicalClientValueV1` (the shipped runtime-value canonicalizer;
  LLP 0131's canonical form governs contract descriptors, not runtime
  values, and this Spec does not conflate them);
- the authority partition.

Cross-function deduplication of identical plans is **not** identity:
`PlanHashV1` may be shared (and is useful for caching plan analysis);
the materialization key never is.

Normative sharing rule: codegen emits both; server admission admits by
recomputed `PlanHashV1` under the reference's declared identity; live
matching, result contracts, client materialization (fragment identity,
§D7), and inspection (§D6) key by `QueryMaterializationKeyV1`. No
surface derives a parallel identity; an implementation-internal key
derives *from* these. Golden and near-miss vectors freeze both schemas
(sketch 3).

## D3 — The completeness witness

Two schemas, one public state vocabulary.

**`CompletenessStatusV1` — the client-visible state.** Exactly four
values, LLP 0155's:

- `unknown` — no proof of completeness at the requested
  authority/version. **Locally producible**: absence of a valid proof
  is itself `unknown`; a client needs no server round-trip to be
  honestly ignorant.
- `complete` — a valid `CompletenessProofV1` is held for this
  materialization key and page. Server-derived only. A **sealed
  composite is `complete`**: LLP 0135 §2.3's byte-identical
  `{kind:"absent", nodes:null, continuation:null}` envelope *is* the
  full admitted result at its snapshot, preserved verbatim — no sealed
  cause, no sealing node, no missing-versus-invisible signal is
  disclosed through this Spec, its status, its proof, or its
  inspection projections.
- `prefix` — **reserved: present in the vocabulary, producerless in
  v1.** No producer exists; no cap hit, count coincidence, or partial
  hydration may mint it. Unreserving requires a real application and a
  plan-proved stable-prefix rule, by dated amendment here (OQ8).
- `refused` — the request could not establish its promised class:
  plan/admission refusal (§D1 rule 4), runtime refusal, or a
  classification the target cannot honor. Carries a stable closed
  reason and the safe fallback where one exists. Sealing is **not**
  refusal.

**`CompletenessProofV1` — the server-issued proof.** A closed record
binding, in full (nothing "at least" about it):

- the `QueryMaterializationKeyV1`;
- the version-stream identity and snapshot version (`(stream,
  version)` per LLP 0012's opaque-cursor discipline);
- the activation identity the page executed under;
- a reference to the LLP 0053 authorization witness
  (`CompositeWitness`) in force for the query instance at
  establishment — referenced, not duplicated;
- the **page identity**: the input composite continuation (`sbsb1`
  token identity, or "first page"), and the per-node
  boundary/terminal vector the page established;
- the declared node set (by position, class, and node plan hash); and
- a batch identity unique to this establishment, so two pages from
  one key at one version cannot be confused.

**One common snapshot, page-scoped.** `complete` attaches to exactly
one page. Every node's contribution to that page was established at
the proof's single snapshot version; fragments holding proofs that
differ in *any* bound field — including page identity and batch
identity at the *same* snapshot version — never assemble into one
apparently-complete result. Supplying a continuation establishes a new
page with its own proof; it does not touch the prior page's proof.
(LLP 0135 removes per-node public cursors — nodes resume together
through the one `sbsb1` token — so there is no per-node cursor
transition to define.)

**Atomic installation.** A page installs atomically: the whole
established node-tuple result and its proof commit together, or
nothing does. A crash mid-install leaves either the prior state or the
complete new page — never a torn assembly a later read could mistake
for established (sketch 5).

**Transition table, total.** Producer authority in brackets; any
event not listed leaves the status unchanged.

| From | Event | To |
| --- | --- | --- |
| — | materialization created, no proof [client] | `unknown` |
| `unknown` | page established, valid proof installed [server] | `complete` |
| `unknown` | request fails, times out, or is cancelled [client] | `unknown` |
| `unknown` | admission/runtime/classification refusal [server] | `refused` |
| `complete` | authoritative delivery advances the stream past the proof's version without re-establishment [client, from server facts] | `unknown` |
| `complete` | any node's args change; a continuation is supplied (new page); membership invalidation; activation change [client] | `unknown` (for the new/affected page) |
| `complete` | LLP 0053 fence fires: quarantine, deletion, lease expiry, user switch, terminal retirement [store, per LLP 0053] | status destroyed with the fragment (not a fourth state) |
| `refused` | the author or runtime retries with a changed plan/args/activation | `unknown` (a fresh materialization) |
| any | retained boot: fragment + proof reload and revalidate bindings [client] | `complete` as-of the proof's version, `freshness: retained` |
| any | resnapshot forced (retention floor, stream reset) [server] | `unknown` until re-established |

Fail-closed floor: the interim milestone LLP 0155 names — refusing
implicit-cap results on the existing LLP 0080 grammar — is this
witness's floor. The shipped behavior is an invocation-error refusal
(`SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED`, landed at the
invocation-error seam); conversion of that seam into the public
`refused` state is pending implementation of this Spec, and no code
path may translate a cap hit into `complete` or into silence in the
meantime.

Authority: the proof is server-issued; a client may hold, persist, and
revalidate one, and may derive `unknown` locally — it may never mint,
upgrade, or extend a proof: not from row counts, not from cap
coincidence, not from replaying deltas.

## D4 — Capability classification

1. **Single-node reads keep their owners' classes, verbatim.** Nothing
   here reclassifies an existing `relational_query_v1` or
   `bounded-children.v1` plan.
2. **`snapshot-batch.v1` composites carry LLP 0135 §2.5's fixed
   classification, restated exactly:** live delivery is cursor-free
   first-page `live_replace` re-execution; no `live_delta`; no
   proved-disjoint skip; `retention: "none"` is the only v1 value.
   This Spec adds no axis, changes no value, and admits **no retained
   composite** in v1.
3. **The meet algebra is a successor profile, not a v1 fact.** When a
   successor profile wants richer classification (retained composites,
   composite delta), it must define each axis as an explicit ordered
   lattice — delivery (`live_delta` > `live_replace` > online-only),
   retention (per LLP 0080's retention classes), and their side
   conditions — with the composite taking the meet of its nodes on
   each axis, and land as a dated amendment here plus whatever the
   owners require. Until then the classification of every plan is a
   restated owner fact, and the inspector shows it as such.
4. Classification is a generated artifact fact; a target that cannot
   honor a class refuses at admission, never degrades silently.

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

## D6 — Inspection: one data model, two projections, one boundary

Answering LLP 0155 OQ11: **one inspection data model, two projections.**
The model is defined here; the server projection rides LLP 0017's admin
console / host-ops surface under that surface's existing authorization;
the client projection is a store-adjacent read-only artifact
(format: OQ5) **bound to its own store and authority partition** — it
never projects another partition's materializations. Neither projection
introduces facts of its own.

For every active or retained materialization the model answers: the
generated query, canonical args, plan hash, materialization key,
app/deployment, and authority partition; the `CompletenessStatusV1`
and, where held, the proof's bound facts; which fragments are
materialized and which materialization keys retain each; the indexes,
bounds, ceilings, and dedup grouping the plan uses; the
snapshot/current version, resume state, and hydration byte/row counts;
whether updates arrive by replacement or forced resnapshot (and by
delta, for single-node plans classified for it); the authorization
dependencies and negative-delivery obligations in force; and which
pending intents currently affect presentation.

**The authorization boundary is normative.** Ordinary inspection
preserves LLP 0080 §3's discipline: missing and invisible rows remain
indistinguishable, sealed composites disclose no cause or sealing
node, and no per-row protected fact appears. Row-level and
cause-level facts live only on the separately authorized audit
channel LLP 0080 §3 already defines, under its rules. The two
projections' concrete schemas and their audience rules are frozen
with the implementing slice (OQ5) and carry paired-world
noninterference fixtures (sketch 7).

Facts derive exclusively from the identities (§D2), the witness
(§D3), the classification (§D4), the store metadata (§D7), and the
existing authorization/settlement records. The inspector holds no
authority; a fact it cannot derive renders as absent — and the
acceptance oracle for that rule is positive (sketch 6 requires named
facts present and correct), so an inspector that omits everything
fails.

## D7 — The Move-2 store interface

The client store consumes this Spec through one interface, inside the
LLP 0155 Move 2 admitted baseline (fragments first) and **under
LLP 0053's fence machinery, which this section binds to rather than
restates**:

- **Identity.** Fragments are identified by
  `QueryMaterializationKeyV1` plus the proof's page identity. The
  LLP 0053 generation triple
  `(query_instance_id, authority_generation, query_generation)` is
  **fence state, not identity**: it guards writes and renders and is
  stored with the fragment, but it is never a key component — a
  generation bump must find, then destroy or quarantine, predecessor
  fragments, never strand them under an unreachable key.
- **The fence CAS is mandatory.** Every fragment write (initial
  install, page replacement, retained-boot revalidation) and every
  render from a fragment runs LLP 0053's capture and
  compare-and-commit on the generation triple, honors the effective
  disposition, and preserves tombstone/frontier state, exactly as that
  RFC requires for snapshots, live callbacks, and optimistic
  reconciliation today. Quarantine, deletion, lease expiry, user
  switch, and terminal retirement destroy or quarantine the fragment
  *and its proof* under LLP 0053's rules; §D3's transition table row
  for fence events is a restatement, not a second mechanism.
- **Witnesses are distinct.** The LLP 0053 authorization
  `CompositeWitness` (what may be shown, to whom, under which lease)
  and this Spec's `CompletenessProofV1` (what was established, at
  which snapshot) are separate records; the proof references the
  witness and neither substitutes for the other. Retained payload
  binds atomically to both, per LLP 0053's retained-payload rule.
- **Ingestion admits only contract-validated frames.** The delta-lane
  egress defect closed by lane refusal (eda8f231; regression in
  `tests/live_delta_v0.rs`) is the worked example of this guardrail's
  posture: refuse the lane rather than trust the frame. If delta
  candidacy is ever re-widened, the adversarial ingestion case re-runs
  before widened frames may be durably retained (LLP 0155 Move 2's
  standing obligation, carried here).
- **Membership and retention.** Removing a materialization's last
  membership never overrides an LLP 0053 deletion obligation or lease
  deadline.
- **Normalization is a gated upgrade this Spec does not admit.**
  Cross-query canonical-row sharing requires field/projection
  provenance, merge and version reconciliation, per-membership
  deletion behavior, and proof of no cross-partition existence or
  field oracle — LLP 0155 OQ2's bar, registered here as OQ2 with its
  evidence class (adversarial-projection fixtures), admitted only by
  dated amendment after that evidence exists. The dated LLP 0008 DK-9
  and LLP 0080 retention-class amendments LLP 0155 Move 2 commissions
  land with their owners before any local plan evaluation over
  fragments ships.

The remaining Move-2 store contracts — the reactive-subscription
surface, the observable store-state facts, and the materialization
plan the client executes on hydration — are owned by this Spec and
specified with the implementing slice against this interface; the
evaluator conformance corpus is proposed to extend LLP 0051 D5's
corpus rather than mint a second one (OQ9), and the LLP 0145 bundle
reconciliation is a named obligation of the same slice (§Commission
crosswalk).

## D8 — Relationship to LLP 0135 Part 2

Adopted verbatim, cited as facts, not re-specified: the
`SnapshotBatchPlanV1` manifest shape and static-tuple rule (§2.1);
one-snapshot execution and canonical parent-auth dedup (§2.2); the
seal-entirely rule and its byte-identical
`{kind:"absent", nodes:null, continuation:null}` envelope (§2.3) —
which this Spec classifies as `complete` at its snapshot, never as
`refused`, and through which it discloses nothing; the `sbsb1`
composite cursor and coordinated resume (§2.4); work ceilings, the
composite's result identity under its exported function, and the fixed
v1 live classification (§2.5); the experimental-dependency
acknowledgment (§2.6); and the capability ids and diagnostics (§3).

Division of labor with the implementation ticket
(`issues/20260802-wave1-0135-sequences-snapshot-batch.md`): LLP 0135
Part 2 is implementable as written; this Spec's layers (identity,
witness, classification restatement, inspection, store interface)
attach to it and to single-node plans without changing its semantics.
The cursor grammar is 0135's; this Spec pins nothing about it beyond
adoption.

## Commission crosswalk

Every LLP 0155 Move 1/2 obligation, mapped (C7):

| 0155 obligation | Where it lands |
| --- | --- |
| Option-3a shape, grown deliberately | §D1 over LLP 0135 Part 2 (§D8) |
| Node vocabulary growth via owners | §D1 rule 2; OQ3/OQ6 |
| Canonical args + stable plan hash across surfaces | §D2 |
| Completeness states + compositional witness | §D3 |
| `prefix` never cap-inferred | §D3 (reserved, producerless) |
| Capability classification | §D4 (v1 restated; meet = successor) |
| Composition semantics 0120 names open (cursor coordination, partial refusal, dedup, result identity) | LLP 0135 §2.2–2.5, adopted (§D8) |
| Authoring altitude / sugar rule | §D5 |
| Inspector (OQ11: one surface or two) | §D6 — one model, two projections |
| Inspector explains every retained row | §D6 facts + sketch 6 (positive oracle) |
| Move-2 store model: fragments, witnesses, keys | §D7 |
| Move-2 reactive-subscription / store-state / materialization-plan contracts | §D7 final paragraph — this Spec, with the implementing slice |
| Evaluator conformance (same result as server) | OQ9 — proposed extension of LLP 0051 D5's corpus |
| LLP 0008 DK-9 + LLP 0080 retention amendments | Owners', commissioned by 0155; §D7 waits on them |
| LLP 0145 bundle reconciliation | Named obligation of the Move-2 implementing slice |
| Normalization (0155 OQ2) | §D7 gate; OQ2 |
| Aggregates | Out — SD-2's branch (§Scope) |
| Interim milestone (fail-closed cap on 0080 grammar) | §D3 floor; partially landed |
| **Move-1 exit gate (Triage + Fleet)** | §Acceptance, restated verbatim below — and **blocked in part on LLP 0135 OQ5's relational-node successor**: Fleet's route requires relational nodes in composites; Move 1 cannot exit on `bounded-children.v1`-only composition |

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
- No client mints or upgrades a proof.
- No inspection projection distinguishes missing from invisible or
  discloses a sealed cause.

## Acceptance sketches

Fixture-oriented oracles; each lands with its implementing slice, and
the identity sketches run only after `NormalizedCompositePlanV1`,
`PlanHashV1`, `QueryMaterializationKeyV1`, and `CompletenessProofV1`
are frozen as schemas.

1. **Fail-closed cap.** A query hitting the 1,024 frame yields the
   refusal seam today and public `refused` with the implicit-limit
   reason once this Spec's status ships; fixture asserts no path yields
   `complete` or silent truncation. Falsified by a cap presented as
   complete.
2. **Page and snapshot mixing.** (a) Two nodes' fragments at skewed
   snapshot versions assemble to `unknown`. (b) Two pages of the same
   materialization at the **same** version (first page and a
   continuation page, distinct batch identities) never cross-assemble
   into one apparently-complete result. Falsified by any assembly
   presenting `complete` without one matching proof.
3. **Identity vectors.** Golden vectors freeze `PlanHashV1` bytes
   across codegen, Rust admission, and the JS client; near-miss
   vectors (reordered nodes, renamed argument, changed visibility
   declaration, changed dedup grouping) produce distinct hashes; two
   exported functions sharing one plan hash produce distinct
   materialization keys, and the host's recomputed hash rejects a
   client-tampered spelling. Falsified by any surface deriving a
   divergent identity or accepting an unrecomputed hash.
4. **Sugar refusal.** An author spelling with a data-dependent node
   reference refuses with the registered dynamic-node reason naming
   the construct; nothing partially compiles. Falsified by silent
   narrowing.
5. **Atomic install.** Crash injected mid-page-install: on relaunch
   the store holds either the prior state or the complete new page
   with its proof — a torn assembly is unobservable, and retained boot
   revalidates proof bindings before rendering `complete`/`retained`.
   Falsified by a partially installed page rendering as established.
6. **Inspector positive oracle.** For a scripted churn sequence over a
   retained materialization, the client projection reports the named
   facts — materialization key, witness state and transition cause,
   each fragment's retaining key, hydration counts — matching a golden
   trace; absent-fact rendering is exercised on exactly one derivable
   fact withheld by fixture. Falsified by a wrong fact, a guessed
   fact, or an all-absent pass.
7. **Paired sealed worlds.** Two worlds — parent missing vs. parent
   invisible to this viewer — produce byte-identical sealed envelopes,
   byte-identical statuses and proofs (modulo batch identity), and
   byte-identical ordinary-inspection output, for both the composite
   and the audit-channel-less viewer. The separately authorized audit
   channel distinguishes them under LLP 0080 §3's rules. Falsified by
   any ordinary-surface distinguisher — including timing-free
   inspection fields.
8. **Fence race.** An LLP 0053 generation bump (revocation) lands
   between page establishment and fragment install: the CAS refuses
   the install, predecessor fragments are destroyed or quarantined
   (never stranded), and no render occurs from the refused page.
   Falsified by a render or retained fragment that outlives its
   fence.
9. **Continuation re-establishment.** Supplying the `sbsb1`
   continuation establishes a new page with its own proof; the prior
   page's status is unaffected; a stream-advancing write between the
   pages leaves both pages' proofs valid *as of their versions* while
   the live materialization reports `unknown` until re-established.
   Falsified by a stale page presenting as the current complete
   result.

## Migration and compatibility

Existing generated queries, `liveQuery`, and React hooks are unchanged;
they gain identity and witness facts additively under the wire-version
rules (dated 0093/0094 amendments). Older clients continue on
replace/resnapshot paths, per the opaque-cursor contract (LLP 0012).
Existing RQS retained snapshots migrate to materialization-key identity
where their recorded plan/args/activation facts prove it, or fall back
to fresh sync; a migration that cannot prove identity discards retained
state rather than mislabeling it, and never drops pending intent
(LLP 0155 Move 2's migration guardrail).

## Non-goals

No aggregates (including count); no free predicate or traversal
language; no data-dependent composition; no client-side authority over
completeness; no second execution substrate beside LLP 0135 Part 2; no
change to its sealed-envelope, cursor, or classification semantics; no
wire encodings (owners' amendments); no normalization admission (§D7's
gate); no change to LLP 0080's or LLP 0110's own admitted shapes; no
parallel authorization fence beside LLP 0053's.

## Open questions

1. Admission of `relational_query_v1` nodes into multi-node composites —
   LLP 0135 OQ5's successor list governs; **Move 1's Fleet exit
   depends on it** (§Commission crosswalk); this Spec needs only the
   admitted-class registry note when it lands.
2. The normalization evidence bar (§D7): the adversarial-projection
   fixture corpus and who owns its review — with LLP 0155 OQ2.
3. A free-standing typed to-one node class: needed, or does LLP 0080's
   unique joined side suffice for the Stage-1 applications? Owner:
   the 0080/0110 family.
4. Status/proof and inspection wire shapes — dated LLP 0093/0094
   amendments.
5. The two inspection projections' frozen schemas, audience rules, and
   the client artifact's transport — with LLP 0114's seam owners and
   LLP 0017 for the server side.
6. Membership/semi-join node classes — with LLP 0100/0073, including
   how their invalidation composes with the page-scoped proof.
7. Composite incremental-delta and retained classification (the
   successor profile's meet lattices, §D4) — deliberately unowned
   until a real application needs it.
8. The `prefix` unreserve trigger: which application, and what
   plan-proved stable-prefix rule.
9. Does the evaluator conformance corpus extend LLP 0051 D5's corpus
   (proposed) or stand alone — with LLP 0051's owners.

## Status

Draft, v0.2 — **round-2 review received, v0.3 revision pending.** Codex
round 2 (2026-08-02, same artifact file): NOT READY; C1/C5/C10 RESOLVED,
C4 fix-introduced-defect, the rest partial; four fresh BLOCKINGs, all
precision-class: (1) the transition table must become a total product
of materialization lifecycle × LLP 0053 disposition × freshness × page
completeness, with quarantine preserving (not destroying) state per
LLP 0053; (2) `QueryMaterializationKeyV1` needs a closed byte grammar
and the LLP 0114 provider-instance/store namespace distinguished from
the global subkey; (3) the proof needs frozen cursor-profile-tagged
`PageIdentityV1`/`NodePlanHashV1`/`BatchIdentityV1` schemas with opaque
digests (never raw cursor credentials or protected boundary values, and
a uniform sealed-page variant); (4) page completeness must compose into
a defined materialization-level state (one-current-page vs accumulated
page set, with the no-skip/no-duplicate oracle). Plus: repair the
crosswalk's "verbatim" overstatement by reproducing LLP 0155's exact
numeric gates or mapping them as dependencies; give every sketch an
executable oracle on an admitted profile; freeze the ordinary
inspection projections' field-level redactions now;
`query_instance_id` is instance identity stored/compared per fragment
operation while only the generations are fence counters. The v0.3
worklist is this paragraph.

Draft, v0.2. Commissioned by LLP 0155's acceptance (Status step 2) and
authored under the 2026-08-02 decision sitting's ruling 11. Round 1 of
the LLP 0005 loop returned Codex NOT READY (5 BLOCKING / 4 MATERIAL /
1 NIT); v0.2 applies all ten findings — see the Revised header and
`reviews/0157-composition-algebra-and-completeness.codex.md`. Next:
round 2 against v0.2; LLP 0130 SD-4's standing acceptance applies if
the loop converges within the commission's scope. Consumers waiting on this
Spec's own layers: LLP 0155 Stage 1 and G-02's generated result types. The
snapshot-batch execution lane in
`issues/20260802-wave1-0135-sequences-snapshot-batch.md` is not waiting: per
§D8, LLP 0135 Part 2 is implementable as written and its cursor grammar was
already pinned there. This Spec's layers attach later without changing those
semantics.
