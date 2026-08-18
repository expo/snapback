# LLP 0157: The composition algebra, plan identity, and the completeness witness

**Type:** Spec
**Status:** Accepted
**Systems:** Relational queries, Query planning, Client integration,
Client SDK, Live queries, Wire Protocol, Codegen, Admin console, Testing
**Author:** Charlie Cheever / Claude (Fable 5) / Codex
**Date:** 2026-08-02
**Revised:** 2026-08-10 (author RULING: composition-activation.v2 adopted — authored-byte admission, audited generation drift; implementation commissioned. Earlier same day: amendment drafted, re-routing the design question off parked LLP 0087)
**Revised:** 2026-08-06, Move-1 closure (the retained qualified Fleet
Observatory receipt at
`tests/acceptance/fixtures/fleet-observatory/move1-exit.2026-08-06.v1.json`
passes all 8 workload gates with 0 blocked; the refreshed carrier exit passes
17/17 legs with 0 GAP, closing Move 1 without changing Experimental maturity
or making a remote/hosted claim); 2026-08-06, later (v0.11.1, residual-review disposition: the
§D8 `sbsb2` restart biconditional is conditioned on decode validity —
well-formed, unexpired, non-future-issued, current
`formatVersion`/`keyGeneration` — with decode-validity failures collapsing
to `SNAPBACK_SNAPSHOT_BATCH_CURSOR_INVALID` before any epoch or parent
comparison per the implemented v1 decode-first rule, and the
expired-plus-changed-epoch overlap near-miss added to the §D8(d) and A14
vector obligations; applies the recorded supplementary round-2
Claude-family review's R2-1 (MATERIAL) left undispositioned by the v0.11
close-out, plus its R2-4 (LLP 0080 gate phrasing de-circularized) and
R2-6's LLP 0135 §2.4 residue (stream/restore-epoch folded into the v1
restart side, `expired` into the collapse list); one dated amendment,
labeled unreviewed per the close-out's re-entry rule); 2026-08-06 (v0.11,
`snapshot-batch.v2` / `sbsb2` reviewed
profile registration: the fourth and final plan profile is registered — a
static tuple of 2–8 `bounded_children_v1@1` / `relational_query_v1@1` nodes
with at least one relational node and summed `take` ≤ 1,024 — with the exact
`sbsb2` cursor record and budget, the §D3 assignment rows, the §D4
classification, and the sealing/resume/work-accounting pins fixed by
LLP 0135's 2026-08-05 ruling, plus the required cross-language parity-vector
obligations. Registration is semantic only and consumes the profile-registry
growth budget; implementation, frozen vectors, and capability publication
remain separately gated); 2026-08-05 (Charlie owner ruling: narrow relational-composite
direction accepted; `snapshot-batch.v2` / `sbsb2` is reserved as the fourth
profile, reusing `relational_query_v1@1` and §D2–§D7, with activation still
gated on the exact reviewed registry/cursor amendment and executable evidence);
2026-08-02 (v0.1, initial draft — the Move-1 owning Spec
commissioned by LLP 0155's acceptance (fc19d8ed) and assigned to a Fable
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
added; the Triage/Fleet exit gates restored, including their numeric
fixtures; Move-1 exit
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
its existing Revised field.) 2026-08-03 (v0.3, round-2 and commission
reconciliation: Codex round 2 returned NOT READY with four precision-class
BLOCKING findings and four lesser findings. The identity stack is now closed
byte-for-byte: `NodePlanHashV1`, `NormalizedCompositePlanV1`, explicit
per-node capability/liveness bindings, `PlanHashV1`, the fixed-width global
`QueryMaterializationKeyV1`, and distinct client-store/provider namespaces.
`CompletenessProofV1` now binds closed `PageIdentityV1`,
`BatchIdentityV1`, node identities, a result digest, and an offline-verifiable
signature over an authorization-witness digest without exposing credentials
or boundaries;
page proofs compose into a same-stream, same-version, first-to-terminal
`PageSetIdentityV1`. The state protocol is a total product of lifecycle,
LLP 0053 disposition, freshness, requested scope, attempt state, and held
proof, with quarantine preserving hidden bytes and delete/retirement applying
their owner's destructive rules. Inspection now freezes exact ordinary
server/client fields and redactions. The Move-2 seam now specifies records,
atomic operations, observation, membership and adjacent-layer references,
and carrier gates rather than deferring them to implementation. The normative
LLP 0155 Triage/Fleet and carrier exits are transcribed. Finally, the
commission's queued-consumer rule is restored: on acceptance this Spec owns
the shared `sbbc1`/`sbsb1` cursor-family grammar, including the full `sbsb1`
body and budget, while Accepted LLP 0110/0135 remain current authority until
that transition; the plan preimage carries explicit per-child liveness so
LLP 0090's versioned mixed-route successor never infers liveness from plan
shape.) 2026-08-03 (v0.4, dual-family round-3/round-1 reconciliation:
Codex and Claude both returned NOT READY on v0.3. Applied every BLOCKING and
MATERIAL finding: the admitted-node and cursor-profile registries, registry
growth stop rule, conditional parent groups, merged-argument contract,
activation/trust binding, generated-reference and authority-partition records,
authorization witness and boundary/result encodings, disposition ownership and
store-wide authority barrier, inspection digest grammars, occurrence-level
membership, first-party/degraded-store contracts, exact retained-corruption
outcomes, complete `sbsb1` size accounting, and 0043/0053/0114 migration seams.
Review artifacts preserve both actual responses.) 2026-08-03 (v0.5,
dual-family delta reconciliation: Claude Round 2 returned NOT READY with one
BLOCKING version-axis defect; Codex Round 4 independently found that defect
plus four BLOCKING and three MATERIAL exactness/security gaps. Applied all:
distinct generated-reference version axes; per-binding contract descriptors;
the complete principal/data authority partition; proof-versus-witness floor
validation; total cursor-profile and node-boundary registries; pre-read cursor
budget widths; ordered compact-JSON/timestamp grammar; and reachable
snapshot/current-version and authorization-dependency inspection facts. The
small parent-group, React-key, coordinator-owner, sort/base64, and stale-ticket
nits are also closed. Fresh focused confirmation from both families is
required; neither prior NOT READY is reclassified.) 2026-08-03 (v0.6,
dual-family focused confirmation: Codex Round 5 returned READY at 0.97
confidence with no findings; Claude Round 3 returned READY at high confidence
with two NITs. Applied both nits by defining zero-based dense `groupIndex` and
scoping A9's authorization-dependency handles to the server projection. The
LLP 0005 loop is concluded and the Spec enters Review; acceptance remains
Charlie's.) 2026-08-03 (v0.7, Accepted by Charlie Cheever's explicit
"accept and promote" direction after the dual-family loop converged READY.
The §D8 ownership transition is active, with dated boundary notes landed in
LLP 0043, LLP 0053, LLP 0080, LLP 0110, LLP 0114, and LLP 0135. Acceptance is
semantic only: implementation and capability-publication gates remain.)
2026-08-03 (v0.8, mixed-route implementation amendment: the registry admits
exactly one new node class, `exported_query_v1`, and one new composite profile,
`mixed-route.v2`. The class normalizes served exported Query/LiveQuery facts;
the capability binding alone distinguishes registered-live from read-only.
The profile reuses the v1 node/plan hash grammar, binds the route argument
mapping, requires one pinned snapshot, and gives the aggregate the honest
non-live meet. LLP 0090 owns the artifact/wire/execution amendment; LLP 0112
format 1 remains unchanged.)
2026-08-03 (dated amendment landed with Accepted LLP 0166: both §D2
closed retention unions gain `result-transform-snapshot-v1` (per-plan
opt-in; reclassification rotates node/plan identity and QMK; manifests
emit it only for reclassified plans), and §D3's closed event vocabulary
gains the payload-compaction event (dated row in the transition table).
No other semantics change.)
2026-08-03 (v0.9, `single_table_v1@1` owner amendment accepted by Charlie:
registry class 4 of 6 is single-node-only through `single-node.v1`, activates
`none.v1` for exactly this class, reuses `established-result-jcs.v1`, adds
`rqs-authority-independent-snapshot-v1` to both retention unions, and pins
its no-lease proof/witness/fence/trusted-activation custody and staged
legacy-to-QMK adoption. Semantic acceptance only; no implementation or
capability claim.) 2026-08-04 (v0.10 activation/publication amendment:
`single_table_v1` is registered at experimental maturity and activated on the
source-qualified local target; see the dated status amendment.)
**Related:** LLP 0000, LLP 0004, LLP 0007, LLP 0008, LLP 0010, LLP 0012,
LLP 0017, LLP 0039, LLP 0043, LLP 0048, LLP 0051, LLP 0053, LLP 0059,
LLP 0073, LLP 0080,
LLP 0090, LLP 0093, LLP 0094, LLP 0100, LLP 0107, LLP 0108, LLP 0110,
LLP 0112, LLP 0114, LLP 0115, LLP 0120, LLP 0127, LLP 0129, LLP 0130,
LLP 0131, LLP 0133, LLP 0134, LLP 0135, LLP 0145, LLP 0155

## Summary

LLP 0155 Move 1 commissions one owning Spec for the composable read
surface: LLP 0120 option 3a's shape, grown deliberately. Accepted LLP 0135
Part 2 supplied the execution precursor: `snapshot-batch.v1`'s static node
tuple, one-snapshot execution, canonical parent-authorization dedup,
seal-entirely partial refusal, coordinated resume, summed work ceilings,
and experimental-dependency acknowledgment. This Spec adds no second
execution path and changes none of those semantics.

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
4. **Capability classification** — explicit plan-bound facts, including
   per-child liveness; v1 behavior restated from the owners and any meet
   algebra reserved for a versioned successor.
5. **The authoring-sugar rule** — any author-facing syntax compiles to
   admitted nodes or refuses with a closed reason.
6. **The inspection data model** — one model, two projections, with an
   authorization boundary (answers LLP 0155 OQ11).
7. **The Move-2 store interface** — fragment/page-set identity, fenced
   atomic operations, observation, membership and adjacent-layer references,
   with cross-query normalization registered as a gated upgrade this Spec
   does not admit.
8. **The coordinated cursor-family grammar** — on this Spec's acceptance,
   the common `sbbc1`/`sbsb1`/`sbsb2` AEAD envelope registry and the
   complete `sbsb1` and `sbsb2` bodies/budgets live here. Existing `sbbc1`
   bytes do not change.

## Scope and authority

This Spec owns the eight items above, as the owning document LLP 0155
Move 1 names, and §Commission crosswalk maps every Move 1/2 obligation
to its section, owner, or blocking dependency. It does **not** own:

- **Node-class internals.** `relational_query_v1` stays LLP 0080's;
  `bounded_children_v1` stays LLP 0110's; membership-addressed and
  search-adjacent shapes stay LLP 0100's and LLP 0073's;
  `single_table_v1` stays LLP 0004/0007's. A new node
  class is a proposal to its owning document, never a side effect here.
- **Composite execution.** One-snapshot semantics, parent-auth dedup,
  the sealed `absent` envelope, ceilings, v1 classification, and the
  maturity/acknowledgment route remain LLP 0135 Part 2's. This Spec owns
  only the cross-family cursor grammar and the identity/witness/store layers
  around that execution (§D8). LLP 0135's 2026-08-05 OQ5 ruling directed
  narrow `relational_query_v1@1` admission through `snapshot-batch.v2`; this
  Spec's 2026-08-06 v0.11 amendment lands that exact reviewed registry/cursor
  registration (§D1, §D3, §D4, §D8), not the product decision itself.
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
  examined-entry ceiling. The exact registry is in §D1.
- **Node.** One complete, individually valid plan of an admitted class,
  with bound arguments.
- **Composite.** A static tuple of registered nodes executed at one
  authoritative snapshot under LLP 0135 Part 2. A **single-node read** of a
  registered class is the degenerate composite and participates in this
  Spec's identity, witness, classification, and inspection contracts.
  Ordinary LLP 0004/0007 single-table plans and imperative/inline handlers are
  not silently reclassified: only a served function that passes the exact
  host-derived `single_table_v1@1` predicate enters that registered class;
  every other plan retains its current identity and refuses composition. The
  current imperative cap refusal remains §D3's fail-closed floor, not evidence
  that an opaque handler is a composable node.
- **Page.** One established composite result: the node-tuple output for
  one input continuation (or the first page, with no continuation), at
  one snapshot. The unit of establishment, proof, and installation.
- **Fragment.** The stored client-side representation of one page for
  one materialization key, opaque and authorized, stored with its
  proof. V1 fragment granularity is exactly one page — never a
  row-level slice, never a partial tuple.
- **Page set.** An ordered first-page-to-terminal chain of whole-page
  fragments. Individual pages may be complete at different versions while
  the set is `unknown`; the set is `complete` only under §D3's common-version
  chain proof.
- **Identity stack.** `NodePlanHashV1` → `PlanHashV1` →
  `QueryMaterializationKeyV1` → client-store/provider namespace →
  LLP 0053 `query_instance_id` → `PageIdentityV1` → `BatchIdentityV1`.
  Each layer has one job; no broader layer is silently collapsed into a
  narrower hash.
- **`CompletenessStatusV1` / `CompletenessProofV1`.** §D3's public state
  and server-issued proof. LLP 0053's authorization `CompositeWitness` is a
  distinct pre-existing record; this Spec binds its digest and never renames
  or absorbs it.

## D1 — The node algebra

The active node-class registry is exact:

| `classId` | `classVersion` | Owner-normalized record | Single node | Multi-node profile | Parent group |
| --- | ---: | --- | --- | --- | --- |
| `relational_query_v1` | 1 | LLP 0080 `RelationalQueryPlanV1` | admitted | `snapshot-batch.v2` (registered 2026-08-06, below) | none |
| `bounded_children_v1` | 1 | LLP 0110 `BoundedChildrenQueryPlanV1` | admitted | `snapshot-batch.v1`; `snapshot-batch.v2` | required |
| `exported_query_v1` | 1 | `ExportedQueryPlanV1` below, reconstructed from the served function manifest | not admitted as an algebra single-node API | `mixed-route.v2` | none |
| `single_table_v1` | 1 | LLP 0004/0007 `SingleTablePlanV1` | admitted through `single-node.v1` | not admitted | none |

These are the only active classes. An LLP 0004/0007 single-table plan that
does not pass the exact owner-derived `single_table_v1@1` predicate, a
maintained projection, search, aggregate, or unknown class refuses as a
composition node; its existing non-composed API remains unchanged. JS/inline
query implementations participate only through the exported function fact of
`exported_query_v1`; their opaque handler body never becomes a normalized plan
or liveness oracle. A future class enters only by dated amendment citing its
owner-normalized closed record, version, bounds, cursor profile, result
encoding, capability binding, and single/multi admission.

`ExportedQueryPlanV1` is the following closed record, rebuilt by the host from
the served `FunctionDefinition` rather than trusted from the generated route:

```ts
{
  format: "snapback.exported-query-plan.v1",
  runtime: FunctionDefinition["runtime"],
  argsContractHash: FunctionDefinition["argsContractHash"],
  resultContractHash: FunctionDefinition["resultContractHash"],
  authRequirement: FunctionDefinition["authRequirement"],
  authorityIndependent: boolean,
  authorizationDependence: FunctionDefinition["authorizationDependence"],
  readSetSummary: FunctionDefinition["readSetSummary"],
  effectCeiling: FunctionDefinition["effectCeiling"] | null
}
```

Its argument bindings are the ordinary §D2 projections of the served function
argument contract. Its result encoding is that function's validated row array;
it has no cursor. Its bounded multi-node admission is LLP 0090
`mixed-route.v2`: 1–32 route children under the existing bundle row/byte/time
ceilings, with eligibility requiring at least one `Query` and one `LiveQuery`.
The capability binding carries the served export kind, whole-result
`live_replace` only for `LiveQuery`, `live:{kind:"none"}` for `Query`, the
served retention fact, and the sorted unique required capability ids.

**Dated registry amendment (2026-08-03, Charlie's owner ruling):**
`single_table_v1@1` is class 4 of the six-class ceiling. Its
`SingleTablePlanV1` is the exact closed LLP 0004/0007 normalization of the
host-derived `rqsEligible` predicate, including the new class-only 1,024
examined-entry establishment refusal. It is admitted only through
`single-node.v1`; `snapshot-batch.v1`, `mixed-route.v2`, and every implicit
successor remain closed. Its application result is the complete HostPlan
Query document array with no projection. Class membership and the normalized
record are host-reconstructed; authors and clients cannot assert either. A
future multi-node admission must name a reviewed versioned plan/cursor profile
and is not inferred from this row. This amendment is semantic acceptance only:
the separately commissioned implementation must satisfy the existing
proof/wire/store gates before any target publishes support or a capability.

**Dated profile registration (2026-08-06, per the 2026-08-05 LLP 0135
relational-composite owner ruling):** `snapshot-batch.v2` is the fourth plan
profile. It admits a static tuple of two through eight nodes, each one
complete, individually valid, owner-admitted `bounded_children_v1@1` or
`relational_query_v1@1` plan under its own governing document unchanged, with
**at least one relational node** and the sum of node `take` values at most
1,024. It consumes no class slot: `relational_query_v1@1` remains LLP 0080's
existing class. Every §D2–§D7 field layout and hash grammar is reused
unchanged — the only schema change is the enumerated addition of
`"snapshot-batch.v2"` to `NormalizedCompositePlanV1.profileId` and
`CursorProfileIdV1`, and every predecessor record instance's bytes are
unchanged. The profile adds its registry rows, the §D3 cursor-profile
assignment, and the §D8 `sbsb2` cursor family, and no algebra-wide identity,
completeness, authorization, or liveness axis. The tuple is static: no node
argument may reference another node's output, and no predicate, aggregate,
traversal, maintained projection, or data-dependent invocation enters through
the composite. Its capability id is `snapshot_batch_v2`, which will enter the
registry at `experimental` through LLP 0134 §1's same-commit introduction
record when the implementation lands, under LLP 0135 §2.6's
admission-acknowledgment gate restated exactly: an ordinary artifact claiming
the composite must acknowledge `snapshot_batch_v2` and every composed
**experimental** capability id — for a tuple containing a bounded-child node,
exactly `snapshot_batch_v2` plus `bounded_children_v1`; `relational_query_v1`
is Stable, so its acknowledgment is a no-op and is never required, and an
all-relational tuple acknowledges `snapshot_batch_v2` alone. Admission
refusals reuse LLP 0135 §3's registered diagnostics; any v2-specific
admission code (for example, the no-relational-node profile refusal) is
registered there with the implementing slice under §D1 rule 1's placeholder
rule. LLP 0135 Part 2 remains the execution owner; its one-snapshot,
seal-entirely, coordinated-resume, and ceiling semantics extend to this
profile exactly as pinned in §D4 and §D8. Registration is semantic only, and
the gate distinguishes landing work from claims: the separately commissioned
executor, admission path, and vector generation may land as ordinary
implementation work, but until the executor, the frozen cross-language parity
vectors §D8 specifies, and the target's own capability publication authority
are all green, no target may admit or require the profile at runtime, no
shipped generated artifact may require the capability (acceptance-corpus
fixtures may), and no support, capability, or implementation claim may be
published.

**Dated implementation checkpoint (2026-08-06):** the `sbsb2` codec,
class-tagged plan admission, local composite executor, mixed-node authoring and
identity mirror, and local-only `snapshot_batch_v2` experimental capability
registration have landed together with the required same-commit introduction
record, the §D8 frozen Rust/JavaScript parity vectors, and the A14 local oracle.
Remote-service and Cloudflare targets retain explicit GAP rows. This checkpoint
makes no Move-1 exit claim: a fresh Fleet workload receipt remains the gate
before any guide capability-row promotion or hosted claim.

**Growth stop rule.** The active registry has exactly four node classes and
four plan profiles (`single-node.v1`, `snapshot-batch.v1`, `mixed-route.v2`,
`snapshot-batch.v2`). The 2026-08-06 registration above consumed the fourth
and final plan-profile slot. A successor may still grow to at most six active
classes, one class per reviewed amendment, but **no further plan profile may
arrive as an incremental amendment**: a proposal for a fifth profile, a
seventh class or anything else exceeding either ceiling, a new
algebra-wide identity/completeness/authorization axis instead of reusing
§D2–D7, or more than one new class in one workload slice must stop and
commission an RFC that reconsiders the composition thesis. This is LLP 0155's
cumulative vocabulary/design-work budget, now exhausted on the profile axis.

A composite declares a **static tuple** of nodes. The algebra admits:

- one bounded root window per node with declared index, filters, stable
  ordering, and keyset pagination — exactly the owning class's admitted
  shape, unchanged;
- typed to-one reads where an admitted class provides them (LLP 0080's
  unique joined side is the shipped to-one form; a free-standing to-one
  node class is OQ3, owned by the 0080/0110 family);
- bounded to-many relationship nodes (`bounded_children_v1`);
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
   in a *multi-node* composite is LLP 0135's admission question
   (`snapshot-batch.v1`: `bounded_children_v1` only, 2–8 nodes, summed
   `take` ≤ 1,024; `snapshot-batch.v2`, per the 2026-08-05 owner ruling:
   `bounded_children_v1@1` and/or `relational_query_v1@1`, 2–8 nodes, at
   least one relational node, summed `take` ≤ 1,024). The algebra is defined
   over all registered classes. The v2 profile's exact registration is the
   2026-08-06 dated amendment above; it reuses the record shapes in §D2–D7
   and extends the profile registry and admission list, not the node
   vocabulary or liveness inference rules.
4. **Refusal is closed.** Every rejection names a stable reason: the
   unadmitted class, the dynamic reference, the exceeded ceiling, or
   the sugar construct that failed to compile (§D5). Silent narrowing
   is not a refusal mode.

## D2 — Plan identity

The identity stack is closed. Every digest this Spec defines is lowercase
64-digit hexadecimal with the literal `sha256:` prefix. Owner-carried
`ExpectedGenerationV1` hash strings preserve their current generated spelling
byte-for-byte and are not relabeled as this Spec's digests. Except for the
positive safe-integer `queryInstanceId`, every `*Id` string is nonempty UTF-8,
at most 256 bytes, and contains no control character. Every record is closed
(unknown fields refuse), every array order below is normative, and every
hash preimage is the ASCII domain string shown followed immediately by the
RFC 8785 JCS bytes of the named record.
Unless a field says otherwise, an “ascending” string array is ordered by
lexicographic comparison of unsigned UTF-8 bytes; numeric arrays are ordered
numerically. Identity-bearing base64url spellings are RFC 4648 URL-safe,
canonical, and unpadded.

### Node identity and explicit capability binding

`NodeCapabilityBindingV1` is an owner-issued, host-recomputed record:

```ts
type NodeCapabilityBindingV1 = Readonly<{
  exportKind: "internal" | "Query" | "LiveQuery"
  live:
    | { kind: "none" }
    | {
        kind: "admitted"
        delivery: "live_replace" | "live_delta"
        pageDomain: "cursor-free-first-page" | "whole-result"
      }
  retention:
    | "none"
    | "opaque-authorized-snapshot-v1"
    | "result-transform-snapshot-v1"   // dated 2026-08-03 amendment, below
    | "rqs-authority-independent-snapshot-v1" // dated 2026-08-03 amendment, below
  requiredCapabilityIds: readonly string[] // sorted, unique
}>
```

The plan-level classification uses the same explicit axes:

```ts
type PlanCapabilityClassificationV1 = Readonly<{
  callable: true
  live:
    | { kind: "none", delivery: "none", pageDomain: "none" }
    | {
        kind: "admitted"
        delivery: "live_replace" | "live_delta"
        pageDomain: "cursor-free-first-page" | "whole-result"
      }
  invalidation: "none" | "table-granular-resnapshot" | "proved-disjoint"
  retention:
    | "none"
    | "opaque-authorized-snapshot-v1"
    | "result-transform-snapshot-v1"   // dated 2026-08-03 amendment, below
    | "rqs-authority-independent-snapshot-v1" // dated 2026-08-03 amendment, below
}>
```

> **Dated amendment (2026-08-03, with LLP 0166's acceptance):** both
> closed retention unions above gain `result-transform-snapshot-v1`
> (LLP 0080's concurrently amended class). The value is owner-issued
> like its peers and enters the same hash preimages: reclassifying a
> plan therefore rotates its `NodePlanHashV1`, `PlanHashV1`, and
> `QueryMaterializationKeyV1`. Adoption is per-plan opt-in — an
> unreclassified plan's identity, addresses, and retained state are
> byte-unchanged, and the served function/capability manifests (this
> section's producers) emit the new value only for owner-reclassified
> plans — and a reclassified plan derives a fresh materialization
> address whose predecessor retires through ordinary lifecycle (fresh
> establishment at the new address; the predecessor is never relabeled
> in place). §D2's golden and near-miss vectors gain the new value; §D4
> continues to treat classification as a restated owner fact; §D7's
> storage profiles treat the class as `durable-fragments-v1`-eligible
> under `opaque-authorized-snapshot-v1`'s custody rules; §D7's "local
> plan evaluation over fragments" gate sentence reads on the revised
> Move-2 profile (LLP 0155's dated §Move 2 note) — the gate itself is
> unchanged; and §D3's closed event vocabulary gains the payload-
> compaction event recorded in its transition table (dated row). No
> other semantics change.

> **Dated amendment (2026-08-03, `single_table_v1@1` owner
> acceptance):** both closed retention unions additionally gain
> `rqs-authority-independent-snapshot-v1`. The value is owner-issued if and
> only if the function passes the exact derived `rqsEligible` predicate and
> is registered as `single_table_v1@1`; it is not a general anonymous or
> public-data retention class. For each admitted node the exact capability
> binding is:
>
> ```ts
> {
>   exportKind: "LiveQuery",
>   live: {
>     kind: "admitted",
>     delivery: "live_delta" | "live_replace",
>     pageDomain: "whole-result"
>   },
>   retention: "rqs-authority-independent-snapshot-v1",
>   requiredCapabilityIds: /* served function ids, UTF-8 sorted and unique */
> }
> ```
>
> `seq1` binds `live_replace`. `mset1` binds `live_delta` only when the
> served function carries the exact schema-derived `documents(table)` result
> contract and no other shipped delta exclusion applies; otherwise it binds
> `live_replace`. A `live_delta` binding names the strongest admitted delivery
> and preserves DK-3's honest `live_replace` fallback when the current result
> reaches the implicit cap or another per-delivery proof cannot be made.
> `requiredCapabilityIds` is the served function's existing required-
> capability set, UTF-8 sorted and deduplicated; target support remains a
> separate explicit admission fact.
>
> The degenerate single-node plan classification is the same owner fact:
>
> ```ts
> {
>   callable: true,
>   live: /* the exact node live binding above */,
>   invalidation: "proved-disjoint",
>   retention: "rqs-authority-independent-snapshot-v1"
> }
> ```
>
> `proved-disjoint` remains subordinate to the captured affected verdict: when
> the captured facts cannot prove a skip, the target re-queries or replaces.
> These fields enter the existing node and plan hash preimages; no new identity
> axis or hash is introduced. Semantic acceptance grants no implementation or
> capability-publication claim.

The served function/capability manifests produce this record; an author does
not assert it. A nested node uses `exportKind: "internal"`; a plan admitted as
an exported child binds the generated `Query` or `LiveQuery` declaration into
the otherwise identical node record. `internal` alone grants no liveness.
The record is valid only when `internal` and `Query` pair with
`live:{kind:"none"}`, while `LiveQuery` pairs with `live:{kind:"admitted",…}`;
an unsupported requested delivery refuses rather than emitting an inconsistent
pair. Retention remains its independent owner-issued axis.
Plan shape, node class, table set, and the presence of a cursor do **not** imply
liveness. Two exported children with byte-identical storage plans but different
`Query`/`LiveQuery` declarations therefore carry different bindings. This is
the fact LLP 0090's versioned mixed-route successor consumes: given a child
position and its plan identity, it creates a pending registration only when
`live.kind === "admitted"`; `live.kind === "none"` is ordinary read-only
output. No mixed profile may rediscover that distinction from shape.

`NodePlanRecordV1` is:

For each declared node argument, codegen projects the corresponding LLP 0131
`FunctionArgsContractV1.fields[]` entry into this exact record:

```ts
type ArgumentBindingContractV1 = Readonly<{
  format: "snapback.argument-binding-contract.v1"
  required: boolean
  value: FunctionArgsContractV1["fields"][number]["value"]
}>
```

`value` is byte-for-byte LLP 0131's frozen closed value-node representation,
including all materialized bounds. `ArgumentBindingContractHashV1` is SHA-256
over `snapback:argument-binding-contract:v1:` plus the record's JCS. The name
lives in the containing binding and is deliberately outside this semantic
contract hash; renaming still rotates `NodePlanHashV1`.

```ts
{
  format: "snapback.node-plan.v1",
  classId: string,
  classVersion: number,
  normalizedPlan: object,              // the owner's closed normalized record
  argumentBindings: readonly {
    name: string,
    contract: ArgumentBindingContractV1,
    contractHash: `sha256:${string}`
  }[],
  capability: NodeCapabilityBindingV1
}
```

`argumentBindings` preserves the node owner's declaration order. Each
`contractHash` must reproduce its adjacent `contract`; a supplied mismatch
refuses. This per-binding hash is distinct from the generated function's
whole-root LLP 0131 `argsContractHash`.
`NodePlanHashV1` is SHA-256 over
`snapback:node-plan:v1:` plus the JCS bytes of that record. The node owner and
host both recompute it; a supplied mismatch refuses.

### `PlanHashV1`

`MergedArgsContractV1` is the closed record:

```ts
{
  format: "snapback.merged-args-contract.v1",
  bindings: readonly {
    name: string,
    contract: ArgumentBindingContractV1,
    contractHash: `sha256:${string}`,
    sourcePositions: readonly number[]
  }[]
}
```

Codegen walks node position and then owner declaration order. The first
occurrence fixes each binding's position; later occurrences append their node
position and must carry byte-identical `contract` and `contractHash`, otherwise generation
refuses. `sourcePositions` is ascending and unique. `MergedArgsContractHashV1`
is SHA-256 over `snapback:merged-args-contract:v1:` plus this record's JCS.

`NormalizedCompositePlanV1` is exactly:

```ts
{
  format: "snapback.normalized-composite-plan.v1",
  profileId:
    | "single-node.v1" | "snapshot-batch.v1"
    | "mixed-route.v2" | "snapshot-batch.v2",
  nodes: readonly {
    position: number,                  // dense 0..N-1
    nodePlan: NodePlanRecordV1,
    nodePlanHash: `sha256:${string}`
  }[],
  mergedArgsContractHash: `sha256:${string}`,
  classification: PlanCapabilityClassificationV1,
  parentAuthorizationGroups: readonly {
    members: readonly number[],        // ascending node positions
    keyJcsBase64url: string             // no-pad canonical key bytes
  }[]
}
```

For `single-node.v1`, `nodes` has one entry and
`parentAuthorizationGroups` is exactly empty, including for a standalone
`bounded_children_v1` plan. The registry's `required` parent-group column
governs only a multi-node profile.
For `snapshot-batch.v1` and `snapshot-batch.v2`, each `keyJcsBase64url` is the
base64url-no-pad encoding of LLP 0135 §2.2's exact `ParentAuthorizationKeyV1`
JCS bytes. Groups are ordered by their smallest member; every node whose §D1
registry row says `required` appears in exactly one group, every `none` node
appears in no group, and each member list is ascending. `snapshot-batch.v1`
contains only required `bounded_children_v1` nodes. In `snapshot-batch.v2`,
exactly the `bounded_children_v1` positions appear in groups; a
`relational_query_v1` node appears in no group and no substitute parent is
invented, so an all-relational tuple carries `parentAuthorizationGroups: []`.
Encoding bytes rather than a JSON reparse preserves the grouping identity
exactly.

For `mixed-route.v2`, nodes are the route-manifest order of
`exported_query_v1` children and `parentAuthorizationGroups` is exactly empty.
The merged binding is deliberately route-specific rather than
`MergedArgsContractV1`: it is the JCS hash over domain
`snapback:mixed-route-args:v2:` of the closed record
`{format:"snapback.mixed-route-args.v2",route,queries}`, where `queries` is the
route manifest's ordered `{function,args}` array. The host reconstructs and
exact-compares this hash before execution. The composite classification is
exactly `{callable:true,live:{kind:"none"},invalidation:"none",retention:"none"}`:
the aggregate is honestly non-live because at least one child is read-only;
per-child capability bindings retain their distinct liveness. This profile
has no cursor, completeness proof, retention, parent group, or delta claim.

`PlanHashV1` is SHA-256 over `snapback:plan-hash:v1:` plus this record's JCS
bytes. Runtime argument values and provider/store/query-instance identities
are absent. Codegen emits the record and hash; the host rebuilds both from its
admitted manifests and exact-compares before execution. Any class, normalized
plan, argument binding, capability/liveness fact, dedup group, or node-order
change rotates the hash.
`mergedArgsContractHash` MUST equal the `MergedArgsContractHashV1` derived
from the same ordered nodes; it is not a caller-provided opaque hash.

### `QueryMaterializationKeyV1` and contextual namespaces

The generated-reference generation record is exact:

```ts
type ExpectedGenerationV1 = Readonly<{
  schemaVersion: string,
  appId: string,
  schemaHash: string,
  bundleHash: string,
  inputsHash: string
}>
```

`CompositionActivationIdentityV1` is:

```ts
{
  format: "snapback.composition-activation.v1",
  databaseId: string,
  deploymentId: string,
  targetProfileId: string,
  authMode: "dev" | "sessions",
  expectedGeneration: ExpectedGenerationV1,
  proofKeyManifestDigest: `sha256:${string}`
}
```

`CompositionActivationHashV1` is SHA-256 over
`snapback:composition-activation:v1:` plus that record's JCS. The generated
client and server each exact-recompute it from the same expected-generation
and proof-key artifact; no caller supplies an activation claim.

`QueryMaterializationPreimageV1` is exactly:

```ts
{
  format: "snapback.query-materialization.v1",
  appId: string,
  databaseId: string,
  deploymentId: string,
  targetProfileId: string,
  activationHash: `sha256:${string}`,
  function: {
    artifactKind: "functionReference",
    schemaVersion: string,
    appId: string,
    id: string,
    name: string,
    kind: "Query" | "LiveQuery",
    implementationHash: `sha256:${string}`,
    argsContractHash: `sha256:${string}`,
    resultContractHash: `sha256:${string}`,
    expectedGeneration: ExpectedGenerationV1
  },
  planHash: `sha256:${string}`,
  canonicalArgs: unknown,
  authorityPartitionDigest: `sha256:${string}`
}
```

The outer `appId`, `function.appId`, and
`function.expectedGeneration.appId` must be equal; mismatch refuses before
hashing. `function.schemaVersion` is the generated-reference artifact-format
axis, while `function.expectedGeneration.schemaVersion` is the generation-
artifact axis. Each preserves and validates its owner's current spelling;
they are intentionally distinct (`snapback.v0` / `snapback.v1` in current
sessions artifacts) and are never compared to each other. The function's
complete `expectedGeneration` must instead byte-equal the activation's
`expectedGeneration`.
`activationHash` is exactly `CompositionActivationHashV1` for the surrounding
database/deployment/target.

`canonicalArgs` is one value admitted and serialized by LLP 0114's
`CanonicalClientValueV1`, including its quantitative limits. LLP 0131 governs
the carried contract-descriptor hashes, not these runtime values.
`ArgsDigestV1` is SHA-256 over `snapback:materialization-args:v1:` plus the
same canonical argument JCS bytes.

`AuthorityPartitionV1` is the complete owner-issued **data and invocation
partition**, not the mutation queue's three-field authority descriptor:

```ts
{
  format: "snapback.authority-partition.v1",
  principalDataScope: {
    authMode: "dev" | "sessions",
    userId: string | null,              // null is the explicit anonymous scope
    authorizationStreamIncarnation: string
  },
  authorityInstanceId: string,
  authFingerprint: string | null,
  tenantId: string | null,
  providerId: string | null,
  delegation: null | {
    grantId: string,
    actorPrincipalId: string,
    effectivePrincipalId: string
  }
}
```

The bound headless client produces this record from its authenticated
authority snapshot. `principalDataScope` matches the current
`currentAuthorizationScope()` separation and prevents two dev impersonations
sharing a stream-wide authority instance from sharing data. `authFingerprint`,
tenant/provider, and delegation are null only when the authority owner asserts
that axis is absent; a client cannot author them. `authorityInstanceId` is the
queue/continuity axis imported from the descriptor, not the whole partition.
The descriptor's `sessionGeneration` is observability, not equality, and is
therefore deliberately absent: an ordinary session-generation change does not
by itself rotate QMK. The LLP 0114 acceptance note makes this exact record the
headless `getAuthoritySnapshot`/`subscribeAuthority` projection; absence of
that complete capability refuses before any materialization address is made.

`AuthorityPartitionDigestV1` is SHA-256 over
`snapback:authority-partition:v1:` plus that record's JCS. Raw authority facts
do not enter ordinary inspection or a filename.

The preimage hash is SHA-256 over
`snapback:query-materialization:v1:` plus its JCS bytes.
`QueryMaterializationKeyV1` is the fixed 48-byte ASCII spelling
`qmk1.` followed by base64url-no-pad of those 32 digest bytes. It is a global
portable **subkey**, not a provider registry address and not a client-store
scope. Two exported functions with the same `PlanHashV1` have distinct keys;
cross-function deduplication is never observable query identity.

Context is added without mutating that global subkey:

```ts
type ClientMaterializationAddressV1 = readonly [
  "snapback:client-materialization-address:v1", clientStoreId, qmk1
]
type ProviderMaterializationAddressV1 = readonly [
  "snapback:provider-materialization-address:v1", providerInstanceId, qmk1
]
```

The first is the LLP 0053 durable store/namespace address; the second is the
LLP 0114 in-memory provider registry address. Providers borrowing one client
remain isolated even when their global subkey matches. The store allocates a
never-reused `query_instance_id` under the first address (§D7); that id is
instance identity, not part of the reusable materialization key.

LLP 0114's implemented
`["snapback:react-store-key:v1", providerInstanceId, functionReference,
canonicalArgs]` remains the unchanged UI-level lookup within one provider
lifetime. Its existing bytes are unchanged and its owner retains the assembled-
key vector obligation. Resolving that lookup yields this
Spec's `ProviderMaterializationAddressV1`, the semantic identity beneath it;
the UI key is an index, not a competing materialization identity. Acceptance
therefore carries a dated LLP 0114 boundary note but no react-store-key byte
migration.

Codegen, server admission, live matching, result contracts, client storage,
and inspection consume these exact layers. An implementation may index a
digest of a contextual tuple, but may not derive a parallel semantic identity.
Golden and near-miss vectors freeze every preimage and final spelling.

**Dated derivation note (2026-08-03, `single_table_v1@1` owner
acceptance):** once a current served function passes the exact class predicate,
the existing QMK preimage is fully derivable from the current trusted
activation, generated LiveQuery reference, derived `PlanHashV1`, LLP 0114
canonical runtime args, and current owner-issued authority partition. Authority
independence does not remove that partition from the preimage and does not
permit cross-provider or cross-store deduplication. A legacy RQS entry alone
still cannot derive a QMK: it has no registered node/plan hash or completeness
proof. A connected client may derive the address from current owner artifacts
and then follow the prove-or-fresh adoption rule; no legacy key or token is
reinterpreted as materialization identity.

Identity rotation is deliberately layered:

| Change | Lowest identity that rotates |
| --- | --- |
| node normalized plan, argument contract, or node liveness | `NodePlanHashV1` |
| node order, parent groups, merged contract, plan classification/profile | `PlanHashV1` |
| function, activation, runtime args, or authority partition | `QueryMaterializationKeyV1` |
| provider or client store only | corresponding contextual address |
| terminal recreation | `query_instance_id` |
| input/output cursor or boundary vector | `PageIdentityDigestV1` |
| establishment retry only | `BatchIdentityV1` |

## D3 — The completeness witness

The witness separates an authenticated page fact, an optional composed page
set, and the client's product state. Completeness always answers a scoped
question: “is this requested page or page set established at this exact
materialization/authority/version?” It never means “some useful rows exist.”

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

### Closed proof identities

An `OpaqueCredentialDigestV1` is SHA-256 over
`snapback:opaque-credential:v1:` plus the exact credential wire bytes. Every
`CursorEndV1.digest` is this digest; no cursor profile chooses another domain.

`AuthorizationWitnessRecordV1` is the exact JSON projection of LLP 0053's
instance-bound witness:

```ts
{
  format: "snapback.authorization-witness.v1",
  queryInstanceId: number,             // positive portable safe integer
  compositeWitness: {
    authorization: { incarnation: string, epoch: number },
    data: null | { versionStream: string, minCommitVersion: number }
  }
}
```

Both numbers are portable nonnegative safe integers (`queryInstanceId` is
positive); `null`, never omission, represents LLP 0053 `data: None`.
`AuthorizationWitnessDigestV1` is SHA-256 over
`snapback:authorization-witness:v1:` plus this record's JCS.

V1 has one proof-result encoding id, `established-result-jcs.v1`. The
contract-validated result is first mapped through LLP 0114's canonical client
value representation and then encoded as RFC 8785 JCS UTF-8.
`ResultDigestV1` is SHA-256 over `snapback:established-result:v1:` plus JCS of
`{encodingId:"established-result-jcs.v1",bytesBase64url}`, where the latter is
base64url-no-pad of those exact UTF-8 bytes. A new result encoding requires a
registry amendment here. Ordinary inspection sees these digests, never raw
credentials, protected boundary values, or the authorization witness.

**Dated encoding assignment (2026-08-03):** `single_table_v1@1` reuses
`established-result-jcs.v1` for its complete validated full-document row array.
Its separate `mset1`/`seq1` content digest remains legacy resume/corruption
identity and never replaces `ResultDigestV1`.

`BatchIdentityV1` is `sbbi1.` plus base64url-no-pad of 16 CSPRNG bytes,
fresh for every establishment attempt. It is uniqueness, not authorization.

`PageIdentityV1` is this closed union:

```ts
type CursorEndV1 =
  | { kind: "first" }
  | { kind: "cursor", profileId: CursorProfileIdV1, digest: `sha256:${string}` }

type PageIdentityV1 =
  | {
      kind: "sealed-terminal"
      input: CursorEndV1
      output: { kind: "terminal" }
    }
  | {
      kind: "visible"
      input: CursorEndV1
      boundaryVectorDigest: `sha256:${string}`
      output:
        | { kind: "terminal" }
        | { kind: "cursor", profileId: CursorProfileIdV1, digest: `sha256:${string}` }
    }
```

`PageIdentityDigestV1` is SHA-256 over `snapback:page-identity:v1:` followed
immediately by the `PageIdentityV1` JCS bytes.

This Spec owns the cursor-profile identity registry, which is distinct from
§D8's credential-prefix registry:

```ts
type CursorProfileIdV1 =
  | "none.v1"
  | "relational-query.v1"
  | "bounded-children.v1"
  | "snapshot-batch.v1"
  | "snapshot-batch.v2"
```

The total cursor-profile assignment registry is (`mixed-route.v2` has no
cursor and therefore no row, per §D2):

| Plan profile | Node class(es) | `CursorProfileIdV1` | Node boundary variant |
| --- | --- | --- | --- |
| `single-node.v1` | `relational_query_v1` | `relational-query.v1` | `relational-query.v1` |
| `single-node.v1` | `bounded_children_v1` | `bounded-children.v1` | `bounded-children.v1` |
| `single-node.v1` | `single_table_v1` | `none.v1` | none; canonical empty vector |
| `snapshot-batch.v1` | all `bounded_children_v1` | `snapshot-batch.v1` | one `bounded-children.v1` variant per nonterminal node |
| `snapshot-batch.v2` | `bounded_children_v1` and/or `relational_query_v1`, at least one relational | `snapshot-batch.v2` | per nonterminal node, the class-selected `bounded-children.v1` or `relational-query.v1` variant |

`none.v1` is active for exactly the owner-proved, unpaginated
`single_table_v1@1` row above. The class has no public input or output cursor:
one establishment moves from `{kind:"first"}` to `{kind:"terminal"}` and its
visible boundary vector is the canonical empty vector. A class/profile pair
absent from the table, any attempted `none.v1` cursor credential, or a
profile/boundary mismatch refuses.
`relational-query.v1` names LLP 0080's cursor; `bounded-children.v1` names LLP
0110's standalone cursor; `snapshot-batch.v1` names §D8's coordinated
cursor; and `snapshot-batch.v2` names §D8's `sbsb2` coordinated cursor
(registered 2026-08-06). These names are minted here and enter proof bytes.
Acceptance carries the naming concurrence in the LLP 0080/0110/0135 boundary
notes.

The complete nonterminal node boundary is:

```ts
type NodePageBoundaryV1 =
  | {
      kind: "relational-query.v1"
      orderFields: readonly string[]
      boundary: readonly unknown[]
      rowId: string
    }
  | {
      kind: "bounded-children.v1"
      orderFields: readonly string[]
      boundary: readonly unknown[]
      rowId: string
    }
```

`orderFields` is the exact owner-plan declaration order. `boundary` has equal
length and contains the last consumed row's corresponding LLP 0051 canonical
scalar values; `rowId` is the separate `_id` tie-break and therefore never
appears a second time in `boundary`. The relational variant is the explicit
proof projection of current `RelationalCursorBody.boundary` plus its separate
`id`; the bounded variant is the explicit projection of LLP 0110/§D8
`orderFields`, `boundary`, and `rowId`. A value that fails the owner order-
schema validator refuses rather than hashing.

A visible page's internal boundary vector has this one encoding:

```ts
{
  format: "snapback.page-boundary-vector.v1",
  profileId: CursorProfileIdV1,
  nodes: readonly {
    position: number,
    state:
      | { kind: "terminal" }
      | { kind: "boundary", boundaryDigest: `sha256:${string}` }
  }[]
}
```

Positions are dense and ascending. A node `boundaryDigest` is SHA-256 over
`snapback:node-page-boundary:v1:` plus JCS of
`{position,classId,classVersion,boundary}`, where `boundary` is the exact
`NodePageBoundaryV1` selected by the assignment registry. `BoundaryVectorDigestV1` is SHA-256 over
`snapback:page-boundary-vector:v1:` plus the vector JCS. For the active
`single-node.v1`/`single_table_v1`/`none.v1` assignment, `nodes:[]` is the only
canonical empty vector; every other class/profile use of that vector refuses.

The client requests an input, not an unknowable output boundary:

```ts
type RequestedCompletenessScopeV1 =
  | { kind: "page", input: CursorEndV1 }
  | { kind: "page-set", from: "first", through: "terminal" }
```

The input/output cursor digests are `OpaqueCredentialDigestV1` values;
`boundaryVectorDigest` is `BoundaryVectorDigestV1`. No raw boundary enters the
proof. For `none.v1`, the empty vector's digest is still present, so the
visible variant has one encoding rather than a nullable field; it is admitted
only for the exact assignment row above.
Every sealed outcome uses the one `sealed-terminal` variant: it carries no
sealing position or boundary vector, whether one or several nodes sealed.

`CompletenessProofV1` is exactly:

```ts
{
  format: "snapback.completeness-proof.v1",
  materializationKey: string,
  queryInstanceId: number,
  activationHash: `sha256:${string}`,
  planHash: `sha256:${string}`,
  version: { stream: string, commit: number },
  authorizationWitnessDigest: `sha256:${string}`,
  page: PageIdentityV1,
  nodes: readonly {
    position: number,
    classId: string,
    classVersion: number,
    nodePlanHash: `sha256:${string}`
  }[],
  batchIdentity: string,
  resultDigest: `sha256:${string}`,
  proofKeyId: string,
  signature: string
}
```

`nodes` is dense and ordered by position. `commit` is a portable safe integer.
`signature` is base64url-no-pad of exactly 64 Ed25519 signature bytes over the ASCII domain
`snapback:completeness-proof:v1:` followed immediately by JCS of the record
with `signature` omitted. `proofKeyId` selects a verification key from the
activation's authenticated key manifest. That closed manifest is:

```ts
type ProofKeyManifestV1 = Readonly<{
  format: "snapback.completeness-proof-keys.v1",
  keys: readonly {
    proofKeyId: string,
    algorithm: "Ed25519",
    publicKeyBase64url: string          // canonical no-pad; exactly 32 decoded bytes
  }[]                                  // ascending proofKeyId, unique
}>
```

`ProofKeyManifestDigestV1` is SHA-256 over
`snapback:completeness-proof-keys:v1:` followed by the manifest JCS bytes.
The activation preimage MUST carry that digest, so `activationHash` binds the
exact key set as well as the admitted plan; admission refuses an activation
missing that binding. The server alone holds the signing key.

The trust anchor is the closed record:

```ts
{
  format: "snapback.trusted-composition-activation.v1",
  activation: CompositionActivationIdentityV1,
  activationHash: `sha256:${string}`,
  proofKeys: ProofKeyManifestV1
}
```

`activationHash` and `proofKeys` must reproduce the embedded activation's hash
and `proofKeyManifestDigest`. This read-only generated application artifact is delivered with
the application bundle, not read from the mutable materialization store. The
client accepts a proof only when that trusted artifact's activation hash and
manifest digest exact-match the proof and stored manifest; the server exact-
compares the same artifact at admission. The client may persist the manifest
beside fragments for diagnostics, but persistence grants no trust. An
application/activation change makes predecessor proofs ineligible and takes
the artifact-change delete-before-read path below. Server signing and
verification-only custody lasts at least as long as the longest admitted
retained lease for that activation and, for a no-lease class, while any
same-activation retained record can still render. A missing, retired, or unverifiable key
degrades to `unknown` and fresh sync when activation is otherwise current.
Activation preparation selects the proof-key manifest and emits this immutable
artifact through the same trusted generated/deployment-output path before the
server may issue a proof. A client without that exact delivered artifact cannot
retain, boot, install, or render the result; no first proof can bootstrap its
own verifier.
The LLP 0093/0094 amendments may choose an envelope carrier, but may not alter
this semantic preimage.

A client validates the signature, every identity binding, the authorization-
witness digest against the current LLP 0053 state, and the exact result digest
before installation. The witness relationship is also mandatory: its
`queryInstanceId` and current authorization `incarnation`/`epoch` exact-match
the proof's active instance/state; when `compositeWitness.data` is non-null,
`proof.version.stream` equals `versionStream` and `proof.version.commit` is at
least `minCommitVersion`. `data:null` contributes no version floor and is
admitted only when the LLP 0053 owner produces that exact current witness; it
never authorizes a client to omit a data floor. Installation, retained boot,
and every render revalidation apply the same comparisons. A client can persist
or revalidate a proof but cannot mint, extend, or rewrite one.

> **Dated D3 teaching note (2026-08-03,
> `rqs-authority-independent-snapshot-v1`):** an admitted
> `single_table_v1@1` materialization carries
> `authorizedLeaseHash: null`; no `AuthorizedLease` is minted or implied. The
> null is not relaxed custody. Before install and on every retained boot/render,
> the client must still validate the current `CompletenessProofV1`, exact result
> bytes, current authorization witness and `query_instance_id` fence, class
> binding, and exact trusted activation/proof-key artifact. A current activation
> mismatch, corrupt proof/result, wrong instance/witness, or destructive owner
> transition remains fail-closed. Stored proof material can never bootstrap its
> own verification key.

The `nodes` array deliberately repeats identity already committed by
`planHash`: an offline verifier exact-compares both, so plan-hash substitution
does not turn the proof into an opaque assertion. Instance binding is likewise
load-bearing anti-replay: terminal recreation intentionally invalidates every
predecessor proof even when the reusable materialization key matches.

`CompletenessProofDigestV1` is SHA-256 over
`snapback:completeness-proof-digest:v1:` plus the exact UTF-8 JCS bytes of the
complete proof, including its signature.

### Page and page-set completeness

A valid proof establishes exactly one whole page. Every node contribution was
read at the proof's one `(stream, commit)`; fragments differing in any proof
field never form one page. The page result and proof install atomically, so a
crash leaves the prior page or the complete successor, never a partial tuple.

An accumulated set is optional and stricter. `PageSetIdentityV1` is SHA-256
over `snapback:page-set:v1:` plus JCS of:

```ts
{
  format: "snapback.page-set.v1",
  materializationKey: string,
  activationHash: `sha256:${string}`,
  planHash: `sha256:${string}`,
  version: { stream: string, commit: number },
  authorizationWitnessDigest: `sha256:${string}`,
  orderedProofDigests: readonly `sha256:${string}`[]
}
```

The set is `complete` only if all proofs match every shared field above and
each listed digest is the corresponding `CompletenessProofDigestV1`; the same
ordered node identities match; the first proof's input is `first`; each
nonterminal output's complete `{profileId,digest}` pair equals the next proof's
input pair;
the last output is terminal; every result digest verifies; and the store
commits the ordered set manifest atomically. A first-to-nonterminal chain is
`unknown`, never `prefix`. Pages established across different commit versions
remain individually complete as-of their versions but their set is
`unknown`; no cross-page snapshot is invented. The owner cursor corpora supply
the no-skip/no-duplicate oracle for the contiguous chain. Destroying any
referenced fragment immediately makes the derived set `unknown`; a manifest
never keeps a deleted page logically present.

### Total product state and derivation

The stored state is a product, not a fifth completeness enum:

```ts
{
  lifecycle: "active" | "retiring",       // read-only projection of LLP 0053; retired = absent
  effectiveDisposition: "retain" | "quarantine" | "delete", // read-only LLP 0053 projection
  freshness: null | "current" | "retained",
  requestedScope: RequestedCompletenessScopeV1,
  requestedVersion: { stream: string, commit: number } | "as-of-proof",
  attempt: "idle" | "pending" | { refused: { code: string, fallback: string | null } },
  heldProofs: readonly CompletenessProofV1[]
}
```

`CompletenessStatusV1` is derived. It is `complete` only while lifecycle is
`active`, disposition is `retain`, and valid held proof(s) exactly satisfy the
requested scope/version. It is `refused` only when the current attempt has a
server refusal and no matching valid proof remains. Otherwise it is `unknown`.
`prefix` has no producer. Quarantine may preserve valid proofs and bytes but
always derives `unknown` and renders nothing; delete destroys payload/proofs
and leaves LLP 0053's fence tombstone; a retired instance has no status object.

The admitted event vocabulary is closed and every event is listed below.
An unknown event is rejected before transition, not treated as “leave complete
unchanged.” LLP 0053 disposition/lifecycle transitions take precedence over
completeness installation.

| Event | Exact state effect |
| --- | --- |
| initialize new address/instance | `active`, `retain`, freshness `null`, requested `{kind:"page",input:{kind:"first"}}`/as-of-proof, `idle`, no proofs → `unknown` |
| begin same-scope retry | set `pending`; a still-valid matching proof remains renderable and `complete` |
| begin changed page or requested version at the same address | set the new requested scope/version, `pending`; predecessor proofs become historical and status is `unknown` |
| args/plan/function/activation/authority change | derive a different QMK and initialize a different address; do not mutate identity fields in place; authority changes additionally require §D7's store-wide barrier |
| install valid current page proof | fence-CAS the whole page/proof, preserve LLP 0053's disposition, set `current`, `idle`; matching page is `complete` only if disposition was already `retain` |
| install valid retained page proof | fence-CAS after lease/witness verification, preserve LLP 0053's disposition, set `retained`, `idle`; matching page is `complete` as-of its proof only if disposition was already `retain` |
| commit valid page set | atomically install its manifest; the matching set is `complete` only under active/`retain`, otherwise hidden `unknown` |
| timeout, cancellation, transport failure | set `idle`; preserve a matching prior valid proof, otherwise `unknown` |
| server admission/runtime/classification refusal | store the closed refusal; matching prior proof may remain historical, but the unsatisfied requested scope is `refused` |
| authoritative version advance or membership invalidation without re-establishment | raise requested version, mark held proofs historical, freshness `retained`, status `unknown` |
| retained boot with missing/invalid completeness proof or ineligible retention profile | render nothing; discard that fragment/proof without lowering or inventing an LLP 0053 disposition; status `unknown` |
| LLP 0053 quarantine | advance generations, preserve payload/proofs hidden, set `quarantine`; status `unknown` |
| satisfying superseding snapshot | atomically CAS-install the new proof plus LLP 0053's exact per-scope resolution proofs and acknowledgement tokens; discharge only those scopes, recompute the maximum over every unresolved scope, and render `complete` only if the owner-derived result is `retain` |
| LLP 0053 delete (including expiry/stream-incarnation mismatch or user-switch scope) | destroy fragments/proofs/overlays as the owner requires, persist tombstone, set `delete`; status `unknown` and non-renderable |
| forced resnapshot / stream reset | apply any owner disposition first, request the fresh first page, `pending`; `unknown` until valid install |
| terminal retirement begins | `active → retiring`; reject render/write/proof inputs and perform LLP 0053's destructive transition |
| terminal retirement finalizes | remove the record while preserving allocator/frontier high-water; no status exists |
| explicit reinitialization after retirement | allocate a new `query_instance_id`; follow `initialize`, never reuse a predecessor proof |
| payload compaction (LLP 0166 §D5 — dated 2026-08-03 amendment) | discard the record's held fragments, proofs, page-set manifests, and memberships without lowering or releasing any LLP 0053 disposition; derived status `unknown`; instance identity, fences, and frontiers preserved; a later establishment loads the same instance |

Retained-boot failures are not a catch-all. Their exact v1 outcomes are:

| Failed check | Store mutation | Derived status/render |
| --- | --- | --- |
| completeness signature, plan/node/page/result binding, or result-contract bytes | discard the corrupt fragment/proof; never lower or release an LLP 0053 disposition | `unknown`; render nothing; fresh sync |
| current activation, trusted proof-key manifest, or retention classification absent but not contradicted | keep no renderable proof; preserve any stronger owner disposition | `unknown`; render nothing; fresh sync |
| stored activation differs from the trusted current application artifact | LLP 0053 artifact-change `delete` before read | `unknown`; render nothing |
| authorized lease missing, malformed, mismatched, expired, or rollback-tainted for the current instance | LLP 0053 `delete` before read | `unknown`; render nothing |
| authorization witness has the same incarnation/stream and a newer epoch is expected | LLP 0053 `quarantine` before read | `unknown`; render nothing; resnapshot may release |
| authorization witness missing, wrong incarnation/stream/instance, or history unprovable | LLP 0053 `delete` before read | `unknown`; render nothing |

Fail-closed floor: the interim milestone LLP 0155 names is this witness's
floor. Current main has not implemented that public relational witness; its
shipped evidence is the narrower imperative invocation-error refusal
(`SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED`, landed at the
inline `collect()` seam). LLP 0080 plans already carry explicit `take` and
keyset continuation. Conversion of the current seam into a public refusal and
landing the admitted-node witness are pending implementation of this Spec; no code
path may translate a cap hit into `complete` or into silence in the
meantime.

Authority: the proof is server-issued; a client may hold, persist, and
revalidate one, and may derive `unknown` locally — it may never mint,
upgrade, or extend a proof: not from row counts, not from cap
coincidence, not from replaying deltas.

## D4 — Capability classification

1. **Classification is explicit identity input.** Every node carries the
   host-recomputed `NodeCapabilityBindingV1` in its node and composite plan
   hashes; the composite carries `PlanCapabilityClassificationV1` in
   `PlanHashV1`. No consumer infers liveness, delivery, invalidation, or
   retention from shape. A mismatched binding refuses activation/admission.
2. **Single-node reads keep their owners' classes, verbatim.** Nothing
   here reclassifies an existing `relational_query_v1` or
   `bounded_children_v1` plan; this Spec merely makes the owner fact explicit
   and identity-bound.
3. **`snapshot-batch.v1` composites carry LLP 0135 §2.5's fixed
   classification, restated exactly:** live delivery is cursor-free
   first-page `live_replace` re-execution; no `live_delta`; no
   proved-disjoint skip; `retention: "none"` is the only v1 value.
   Its exact record is `{callable:true, live:{kind:"admitted",
   delivery:"live_replace",pageDomain:"cursor-free-first-page"},
   invalidation:"table-granular-resnapshot",retention:"none"}`. This Spec
   changes no owner value and admits **no retained composite** in v1.
   **A `snapshot-batch.v2` composite carries the byte-identical fixed
   record** (2026-08-06 registration): cursor-free first-page
   `live_replace` only, table-granular resnapshot over the union of every
   node's declared dependency set — including each relational node's
   complete conservative set (LLP 0080 §3) under LLP 0080 §4's
   table-granular invalidation rule — and `retention:"none"`. No
   `live_delta`, no proved-disjoint skip, no retained composite, no local
   relational re-evaluation over fragments, and no retained-relational
   claim; LLP 0080's opaque-snapshot-only retention rule is untouched.
4. **The meet algebra is a successor profile, not a v1 fact.** When a
   successor profile wants richer classification (retained composites,
   composite delta), it must define each axis as an explicit ordered
   lattice — delivery (`live_delta` > `live_replace` > online-only),
   retention (per LLP 0080's retention classes), and their side
   conditions — with the composite taking the meet of its nodes on
   each axis, and land as a dated amendment here plus whatever the
   owners require. Until then the classification of every plan is a
   restated owner fact, and the inspector shows it as such.
5. **Mixed route is a distinct profile.** LLP 0090's implemented versioned
   mixed route preserves one `PlanHashV1`/capability binding per ordered
   child and computes its weakest aggregate boot state separately. It may
   register only explicit live children and must return `live.kind:"none"`
   children as read-only results. Changing a child's liveness rotates its
   node/plan identity even if its storage plan bytes are unchanged; plan
   shape never becomes a liveness oracle. Every child, including
   `live.kind:"none"`, receives its own read-only QMK-addressed
   materialization record; only explicit live children receive subscription
   registration.
6. **`single_table_v1@1` is a single-node owner fact.** Its plan
   classification is `{callable:true,live:<the exact whole-result node live
   binding>,invalidation:"proved-disjoint",retention:
   "rqs-authority-independent-snapshot-v1"}`. `proved-disjoint` is independent
   of delta-versus-replace delivery and never overrides the captured affected
   verdict. This class has no multi-node classification or meet; a future
   multi-node admission requires a reviewed successor profile.
7. Classification is a generated artifact fact; a target that cannot
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
(`issues/closed/20260802-convex-erg-02-move1-type-flow-remainder.md`) closed
with the no-parallel-shapes boundary and records that its successor consumers
must use this Spec's result shapes.

## D6 — Inspection: one data model, two projections, one boundary

Answering LLP 0155 OQ11: **one inspection data model, two projections.**
The server projection rides LLP 0017's authorized admin/host-ops surface. The
client projection is a store-adjacent read-only artifact bound to one exact
`clientStoreId` and authority-partition digest; it cannot enumerate another
store or partition. Neither projection creates evidence.

The underlying model contains the §D2 identities; the §D3 product state,
proof/page/page-set identities and transition cause; node plan explanations,
indexes, bounds, work ceilings and parent-dedup groups; fragment and row-
membership facts; snapshot/current versions and resume state; hydration rows
and bytes; §D4 classification; authorization dependencies and pending
negative-delivery obligations; and adjacent optimistic/outbox/settlement
references.

`StreamDigestV1` is SHA-256 over `snapback:version-stream:v1:` followed by
the exact UTF-8 stream id. `LocalRowHandleV1` is `lrh1.` plus base64url-no-pad
of HMAC-SHA-256 under one 32-byte CSPRNG store-local handle key over the ASCII
domain `snapback:local-row-handle:v1:` followed by JCS of
`{materializationKey,pageIdentityDigest,rowPosition}`. `rowPosition` is a
nonnegative safe integer in the contract-validated result. The handle key is
created once per `clientStoreId`, never exported, survives that store's normal
restart, and is destroyed with the store; handles therefore cannot be compared
across stores or authority partitions. `ArgsDigestV1`,
`AuthorityPartitionDigestV1`, `PageIdentityDigestV1`, `ResultDigestV1`, and
`OpaqueCredentialDigestV1` use their §D2/§D3 formulas unchanged.

The served manifest also projects each plan's closed authorization dependency
into:

```ts
type AuthorizationDependencyDescriptorV1 = Readonly<{
  format: "snapback.authorization-dependency.v1"
  sourcePosition: number | null
  kind:
    | "authority" | "permission" | "membership"
    | "grant" | "policy" | "relationship-visibility"
  ownerId: string
}>
```

`sourcePosition` is the dense node position, or null for a function-wide
dependency. `ownerId` is the stable served-artifact identifier assigned by the
dependency's existing owner, never an argument, principal, row id, policy
value, or obligation scope. The host recomputes the descriptor from the
admitted plan/protected-input manifest. `AuthorizationDependencyDigestV1` is
SHA-256 over `snapback:authorization-dependency:v1:` plus its JCS. Ordinary
inspection exposes only the sorted unique digests, classification, and count;
the separately authorized served-artifact/audit path resolves a digest to its
descriptor. This makes “which dependencies apply” reachable without widening
the ordinary information boundary.

The two **ordinary** projections are closed now, not deferred:

```ts
type ServerCompositionInspectionV1 = Readonly<{
  format: "snapback.server-composition-inspection.v1"
  appId: string
  deploymentId: string
  targetProfileId: string
  functionId: string
  planHash: `sha256:${string}`
  materializationKey: string
  argsDigest: `sha256:${string}`
  authorityPartitionDigest: `sha256:${string}`
  storageProfile: "volatile-online-v1" | "durable-fragments-v1"
  classification: PlanCapabilityClassificationV1
  plan: {
    nodeCount: number
    nodes: readonly {
      position: number, classId: string, classVersion: number,
      nodePlanHash: `sha256:${string}`, examinedEntryCeiling: number,
      indexIds: readonly string[],
      declaredBounds: readonly { name: string, ceiling: number }[],
      joinKinds: readonly ("inner" | "left")[],
      aggregateCeilings: readonly []
    }[]
    parentAuthorizationGroupCount: number
  }
  state: {
    lifecycle: "active" | "retiring"
    disposition: "retain" | "quarantine" | "delete"
    freshness: null | "current" | "retained"
    completeness: "unknown" | "complete" | "prefix" | "refused"
    refusalCode: string | null
    lastTransition:
      | "initialized" | "request-began"
      | "proof-installed-current" | "proof-installed-retained"
      | "page-set-installed" | "attempt-ended" | "request-refused"
      | "version-advanced" | "retained-proof-rejected"
      | "authorization-quarantined" | "authorization-resolved"
      | "authorization-deleted" | "resnapshot-forced"
      | "retirement-began"
    scopeKind: "page" | "page-set"
    requestedVersion:
      | { kind: "as-of-proof" }
      | { kind: "exact", streamDigest: `sha256:${string}`, commit: number }
    establishedSnapshot:
      | { streamDigest: `sha256:${string}`, commit: number }
      | null
    currentVersion:
      | { streamDigest: `sha256:${string}`, commit: number }
      | null
  }
  storage: {
    fragmentCount: number, visibleRowCount: number,
    hydrationRows: number, hydrationBytes: number,
    retainingMembershipCount: number
  }
  delivery: {
    mode: "none" | "live_replace" | "live_delta" | "forced-resnapshot"
    continuation: "none" | "present"
    cursorProfileId: CursorProfileIdV1 | null
    credentialDigest: `sha256:${string}` | null
  }
  obligations: {
    pendingCount: number,
    maxDisposition: "retain" | "quarantine" | "delete" | null
  }
  authorizationDependencies: {
    classification: "authority-independent" | "authority-scoped"
    digests: readonly `sha256:${string}`[]
    count: number
  }
  pendingIntentCount: number
}>
```

`establishedSnapshot` is the version of the proof(s) satisfying the requested
scope, or null. `currentVersion` is the latest authoritative version the
materialization has actually observed, or null while no such fact is held; it
is never inferred from connection state or wall time. `requestedVersion`
projects §D3's exact request. A non-null snapshot/current commit is a portable
safe integer. Authorization dependency digests use unsigned-UTF-8 ascending
order and `count === digests.length`.

The server projection exposes digests/counts only: never canonical argument
values, raw authority facts, query-instance ids, raw cursors/boundaries,
authorization witnesses, row/source ids, retaining query identities, sealing
cause/position, obligation scope ids, leases, pending-intent ids, proof
signatures, or verification keys.
The plan arrays expose served-artifact facts, not runtime source rows:
`indexIds` and `joinKinds` preserve owner-plan declaration order;
`declaredBounds` sorts by UTF-8 `name`; `aggregateCeilings` is exactly empty in
v1. A `refusalCode`
is present only for the public closed refusal already returned to the caller;
sealing never populates it.

```ts
type ClientCompositionInspectionV1 = Readonly<{
  format: "snapback.client-composition-inspection.v1"
  clientStoreId: string
  providerInstanceId: string | null
  functionId: string
  materializationKey: string
  planHash: `sha256:${string}`
  argsDigest: `sha256:${string}`
  authorityPartitionDigest: `sha256:${string}`
  storageProfile: ServerCompositionInspectionV1["storageProfile"]
  classification: PlanCapabilityClassificationV1
  state: ServerCompositionInspectionV1["state"]
  fragments: readonly {
    pageIdentityDigest: `sha256:${string}`
    resultDigest: `sha256:${string}`
    freshness: "current" | "retained"
    rowCount: number
    byteCount: number
  }[]
  visibleRows: readonly {
    localRowHandle: string
    retainingMaterializationKeys: readonly [string]
  }[]
  delivery: ServerCompositionInspectionV1["delivery"]
  authorizationDependencies: {
    classification: "authority-independent" | "authority-scoped"
    count: number
  }
  pendingIntentCount: number
}>
```

The client projection contains only fragments currently readable by its own
partition. `localRowHandle` follows the formula above; it is not an
application/source id. With v1's unnormalized whole-page fragments each row
occurrence has exactly one retaining materialization, hence the singleton
tuple. The plural field is the explicit normalization-upgrade seam and may not
be widened before §D7's gate. Quarantined/deleted/retiring records report
aggregate state and authorization dependency count but no fragment or row
entries. `batchIdentity` is deliberately
absent from ordinary inspection: it adds no author-facing explanation and
would make paired sealed worlds differ by fresh public randomness.

**The authorization boundary is normative.** Missing and invisible remain
indistinguishable across result, status, proof shape, both ordinary inspection
projections, and transport. Sealed composites disclose no cause or node. Raw
canonical args, authority partitions, source/contribution rows, visibility
decisions, sealing causes, and obligation/lease details are available only on
LLP 0080 §3's separately authorized, scoped, redacted audit channel. The
audit channel is not a third projection defined here; it is its owner's
existing exception boundary.

All ordinary fields derive from §D2–D4, §D7, and existing authorization/
settlement records. Pending-intent identities remain redacted; the ordinary
answer is the count, while the separately authorized owner surface may resolve
which exact intents contribute. A derivable required field may not be silently omitted;
an underivable nullable field is `null`, never guessed. The positive golden
oracle in Acceptance requires every non-null fixture fact, so an inspector
that returns empty objects fails.

## D7 — The Move-2 store interface

The admitted baseline is whole-page opaque fragments, not normalized rows.
One `MaterializationRecordV1` exists per `ClientMaterializationAddressV1` and
current `query_instance_id`:

```ts
{
  format: "snapback.materialization-record.v1",
  address: ClientMaterializationAddressV1,
  queryInstanceId: number,
  planHash: `sha256:${string}`,
  activationHash: `sha256:${string}`,
  argsDigest: `sha256:${string}`,
  authorityPartitionDigest: `sha256:${string}`,
  storageProfile: "volatile-online-v1" | "durable-fragments-v1",
  productState: /* §D3 exact product */,
  authorityState: /* LLP 0053 QueryAuthorizationState, referenced */,
  fragments: readonly {
    pageIdentityDigest: `sha256:${string}`,
    resultContractHash: string,
    bytes: Uint8Array,
    proof: CompletenessProofV1,
    authorizedLeaseHash: string | null
  }[],
  pageSets: readonly {
    identity: `sha256:${string}`,
    orderedProofDigests: readonly `sha256:${string}`[]
  }[],
  memberships: readonly {
    localRowHandle: string,
    materializationKey: string,
    pageIdentityDigest: string
  }[],
  subscription: {
    delivery: "none" | "live_replace" | "live_delta",
    connectionState:
      | "inactive" | "connecting" | "live" | "offline"
      | "resync-required" | "retiring",
    resumeCredentialDigest: `sha256:${string}` | null
  },
  optimisticLayerIds: readonly string[],
  outboxEntryIds: readonly string[],
  settlementIds: readonly string[]
}
```

The last three arrays are references into LLP 0107/0114, LLP 0043, and
LLP 0133 ownership; this Spec defines composition and atomic visibility, not
their payload semantics. A provisional entity remains keyed by typed intent
identity inside its optimistic layer. It is never inserted as a canonical
server row or shared across query results before settlement supplies the
owner-defined mapping. Outbox and retained settlement records keep their
existing custody and replay rules.

`authorityState` is the sole mutable owner of lifecycle and effective
disposition. The like-named members in `productState` and inspection are
read-only projections checked in the same transaction; a carrier cannot write
them independently. A v1 membership names one **row occurrence in one page**
and its one owning materialization. It is not a canonical source-row identity
and cannot join occurrences across queries while normalization is unadmitted.

The store interface has these semantic operations; carrier method names may
differ, but there is no weaker implementation:

1. `initialize(address, identities, authorityBarrierReceipt)` allocates or loads the current
   never-reused `query_instance_id` and minimal LLP 0053 fence. A network
   frame can never allocate it implicitly. A rotated authority partition
   requires the store-wide barrier receipt from operation 7 first.
2. `beginEstablishment(address, requestedScope, expectedFence)` applies the
   §D3 request transition without discarding a still-valid same-scope page.
3. `commitPage(address, fragment, proof, resolutionBundle, expectedFence)`
   validates the result contract, proof signature and every binding, then
   atomically writes the whole fragment/proof/memberships/product state and
   compare-and-commits the exact `(query_instance_id, authority_generation,
   query_generation)`. It never lowers disposition. A non-null
   `resolutionBundle` contains LLP 0053's exact satisfied scope ids, resolution
   proofs, and acknowledgement tokens; the same transaction applies only those
   resolutions and recomputes the maximum over every unresolved scope.
4. `commitPageSet(address, set, expectedFence)` validates the complete chain
   and atomically publishes its manifest; no partial set is observable.
5. `recordAttemptOutcome(address, outcome, expectedFence)` applies only a
   §D3 transient/refusal transition; it cannot weaken a disposition.
6. `applyAuthorizationTransition(address, obligationOrResolution)` delegates
   to LLP 0053, advances the generations before render/write, hides on
   quarantine, destroys on delete, and preserves tombstones/frontiers.
7. `applyStoreAuthorityBarrier(clientStoreId, predecessor, successor,
   transition)` runs under LLP 0059's per-app-id, cross-context
   `AuthCoordinator`, with the LLP 0039/0053 stores registered as participants.
   “Store-wide” describes this operation's coverage, not the coordinator's
   ownership scope. It
   advances the authority generation and applies the owner-required client-
   wide or grant-scoped quarantine/delete to every predecessor authority-
   partition address before it issues a receipt permitting any successor QMK
   to initialize or render. Address rotation can therefore never strand a
   predecessor behind a new lookup key. A carrier may process a large
   predecessor set in bounded transactions, but the coordinator's publication
   gate stays closed and no receipt exists until every chunk and the durable
   barrier high-water commit; a crash resumes the barrier before any successor
   publication.
8. `readRenderable(address, expectedFence)` returns bytes only for an active,
   `retain` record after rechecking the exact triple, witness, any
   owner-required lease, and
   requested completeness scope. No check-then-read gap is allowed.
9. `observeMaterialization(address, listener)` publishes one immutable
   observable snapshot after each committed transition. Initial delivery is
   synchronous with the current committed state; callbacks are serialized,
   generation-tagged, and never run for a torn transaction. Unsubscribe is
   idempotent.
10. `retire(address)` runs LLP 0053's `active → retiring → removed` protocol;
   a later explicit initialization allocates a new instance.

`query_instance_id` is mandatory instance/scope identity stored and compared
on every operation. It is not part of `QueryMaterializationKeyV1`. Only
`authority_generation` and `query_generation` are mutable fence counters;
none of the triple belongs in the reusable global key. A generation change
must find and quarantine/destroy predecessor fragments, never strand them
under an unreachable lookup key.

For materializations under this Spec, `QueryMaterializationKeyV1` is the
canonical LLP 0053 `query_key`, and `clientStoreId` remains its separate
namespace member. Acceptance carries the dated LLP 0053 boundary note and an
LLP 0043 note for lease-backed stored entries; server wire structs continue to
treat `query_key` as opaque, so this is a producer migration rather than a wire
shape change.

The LLP 0053 authorization `CompositeWitness` (may these bytes be shown?) and
`CompletenessProofV1` (what exact page was established?) remain distinct.
Retained payload, both witness bindings, any owner-required authorized lease,
and the generation triple commit atomically.

> **Dated D7 teaching note (2026-08-03,
> `rqs-authority-independent-snapshot-v1`):** for exactly
> `single_table_v1@1`, the fragment's `authorizedLeaseHash` is `null` and no
> anonymous lease is minted. Install and every `readRenderable` call still
> require the exact proof/result, current witness and instance fence, trusted
> activation/proof-key artifact, and class binding. `retentionRequest:
> "durable"` remains necessary. The generated Channel-B mapping from
> `persistResume: true` fixes `idleTtlClass: "pinned"`; after release the
> payload is exempt from grace GC but remains budget-compactable and subject
> to every owner transition and store reset. Offline output remains labeled
> retained, never current. Pending outbox intent withholds legacy token resume
> and takes full resync then replay, but does not blank an otherwise verified
> retained display.

Ingestion admits only contract-validated frames. Current main's delta lane
enters only when the result contract exactly equals the schema-derived
`documents(table)` descriptor; narrowed contracts take the validated
`live_replace` path, with regressions in `crates/snapback/tests/live_delta_v0.rs`. Any future
widening reruns the adversarial ingestion cases before the widened frame may be
retained.

Removing the last membership never overrides an LLP 0053 disposition, lease
deadline, pending intent, or retained settlement. The final authorized
membership may evict a fragment only after those independent reasons are
resolved.

Storage capability is explicit. `volatile-online-v1` implements the same
identity, proof, fence, observation, and inspection semantics in memory but
advertises `retention:"none"`; restart begins `unknown`, and a durable or
retained request refuses with a structured `durable_fragments_v1` GAP.
`durable-fragments-v1` additionally implements crash-safe fragments, leases,
and the Move-2 carrier gate. Every first-party arm consumes the same semantic
records. An arm such as Contract may honestly expose only the volatile profile
until its stricter custody path qualifies durable retention; it may not emulate
durability or silently omit the capability distinction.

Cross-query canonical-row normalization is **not admitted**. It requires
field/projection provenance, merge/version rules, per-membership deletion and
quarantine, and proof of no cross-partition field or existence oracle under
LLP 0155 OQ2's adversarial fixture. It enters only by dated amendment. The
LLP 0008 DK-9 and LLP 0080 retention-class amendments must land before any
local plan evaluation over fragments ships; until then a retained fragment is
decoded as its owner's opaque snapshot only. When evaluation is admitted, its
cross-runtime corpus extends LLP 0051 D5 unless that owner rejects the
extension (OQ9), and LLP 0145's Full-client attribution is recorded in the
same slice.

## D8 — Coordinated cursor-family grammar and the LLP 0135 seam

LLP 0135 Part 2 remains the execution owner for static admission,
one-snapshot evaluation, parent-auth dedup, seal-entirely results, ceilings,
live classification, maturity, and diagnostics. This section owns the shared
cursor grammar commissioned for the queued LLP 0135 implementation half.

### Common `sbbc1` / `sbsb1` / `sbsb2` envelope

All three families use:

```text
PREFIX "." BASE64URL_NO_PAD(
  nonce[24] || XChaCha20Poly1305(key, nonce, plaintext, aad)
)
```

`PREFIX` is exactly `sbbc1`, `sbsb1`, or `sbsb2`; the prefixes are mutually
exclusive and mutually prefix-free.
The 32-byte `key` is HKDF-SHA-256 with the resume root as input key material,
the family's purpose bytes as salt, and UTF-8 `keyGeneration` as info. `aad`
is the purpose bytes followed by, in order, app id, database id, and target
profile id, each encoded as a four-byte unsigned big-endian byte length and
its UTF-8 bytes. The nonce is freshly random per mint. Decode rejects bad
prefix/base64/length, authentication failure, unknown fields, wrong format or
key generation, app/database/target mismatch, future issuance, expiry, and an
expiry interval other than exactly 1,209,600,000 milliseconds (14 days).
`issuedAt`/`expiresAt` are Unix-epoch milliseconds as portable nonnegative
safe integers. Mint failure refuses the page; it never converts a nonterminal
page into terminal.

Family registry:

| Prefix | Purpose | Wire cap | Plaintext encoding | Body owner |
| --- | --- | ---: | --- | --- |
| `sbbc1` | `snapback:bounded-children-cursor:xchacha20:v1` | 1,024 bytes | compact UTF-8 JSON in the existing field order | LLP 0110 body semantics; this section owns the shared envelope registration |
| `sbsb1` | `snapback:snapshot-batch-cursor:xchacha20:v1` | 8,192 bytes | ordered compact UTF-8 JSON defined below | this Spec |
| `sbsb2` | `snapback:snapshot-batch-cursor:xchacha20:v2` | 8,192 bytes | ordered compact UTF-8 JSON defined below | this Spec |

The existing `sbbc1` body field order is frozen unchanged:
`formatVersion`, `keyGeneration`, `appId`, `databaseId`,
`targetProfileId`, `streamEpoch`, `function`, `planHash`, `parentId`,
`parentIncarnation`, `parentVersion`, `authorityPartition`, `orderFields`,
`boundary`, `rowId`, `issuedAt`, `expiresAt`. The committed fixed-nonce
cross-language vector under LLP 0110 must remain byte-identical; this ownership
move is not a migration.

### `sbsb1` plaintext and budget

`sbsb1` plaintext is the following closed record in this exact field order:

```ts
{
  formatVersion: 1,
  keyGeneration: string,
  appId: string,
  databaseId: string,
  targetProfileId: string,
  streamEpoch: string,
  function: string,                  // exact exported function id
  planHash: `sha256:${string}`,      // recomputed PlanHashV1
  args: unknown,                     // complete merged non-cursor CanonicalClientValueV1
  parentGroups: readonly {
    groupIndex: number,
    parentAuthorizationKeyDigest: `sha256:${string}`,
    parentId: string,
    parentIncarnation: string,
    parentVersion: number
  }[],
  nodes: readonly {
    position: number,
    nodePlanHash: `sha256:${string}`,
    state:
      | { kind: "terminal" }
      | {
          kind: "boundary",
          orderFields: readonly string[],
          boundary: readonly unknown[],
          rowId: string
        }
  }[],
  authorityPartition: `sha256:${string}`, // AuthorityPartitionDigestV1
  issuedAt: number,
  expiresAt: number
}
```

`parentGroups` follows §D2 group order and binds each deduplicated parent once.
`groupIndex` is the zero-based index of the group in §D2's
`parentAuthorizationGroups` order; entries are dense and ascending.
`parentAuthorizationKeyDigest` is SHA-256 over
`snapback:parent-authorization-key:v1:` plus the group's exact JCS bytes.
`nodes` is dense position order. V1 nodes are `bounded_children_v1`; each
nonterminal state carries that owner's complete boundary, including `_id`,
and each terminal state carries no boundary. The body binds complete args,
function, plan, authority, stream/restore epoch, parent incarnation/version,
and every node state. No `sbbc1` credential appears inside it or in a result.
`args` is the exact canonical JSON value used as §D2 `canonicalArgs`, not a
cursor-local re-encoding.
For a nonterminal node, §D3's `NodePageBoundaryV1`
`bounded-children.v1` variant maps one-to-one: its fixed variant tag becomes
the enclosing state tag `kind:"boundary"`, followed by the same
`orderFields`, `boundary`, and `rowId` bytes in that order. No other boundary
projection is admitted.

**Ordered compact JSON is exact.** Objects emit members in the declaration
order shown above; `parentGroups`, node entries, and each state variant emit
members in their shown order. Arrays preserve their normative order. No
whitespace is emitted. Strings use RFC 8785's UTF-8 JSON string escaping with
no Unicode normalization; lone surrogates refuse. Numbers use RFC 8785 number
spelling and every protocol number here is additionally a portable safe
integer. The already-canonical `args` bytes are embedded verbatim as the value
after `"args":`; nested boundary values use their §D3
`NodePageBoundaryV1` canonical scalar spellings. `issuedAt` and `expiresAt` are
Unix-epoch milliseconds and satisfy
`expiresAt - issuedAt === 1_209_600_000`. Independent Rust/JS fixed-nonce
vectors freeze these exact plaintext bytes. This serializer applies only to
new `sbsb1` and `sbsb2`; existing `sbbc1` serialization and vector bytes
remain unchanged.

The 8,192-byte wire cap leaves 8,186 base64url characters after `sbsb1.`, at
most 6,139 decoded bytes, and 6,099 plaintext bytes after the 24-byte nonce and
16-byte tag. Before any first-page storage read, establishment constructs the
maximum compact-JSON plaintext for this invocation and counts **every** body
member. `formatVersion`; the key-generation manifest's maximum spelling; the
actual app/database/target/stream/function/plan; the actual complete `args`
serialization; the actual authority partition; every deduplicated parent's
actual argument-bound `parentId`; the fixed digest/group framing; the owner-
maximum parent incarnation and version widths; both timestamps at
portable safe-integer width; and all JSON punctuation/escaping are counted.
For each node, terminal framing and the owner-declared worst-case boundary
state are compared and the larger is used. String order fields require LLP
0135/0110's schema-level, write-enforced `maxEncodedBytes`; the calculation
uses their maximum **JSON-serialized** bytes including escaping and framing.

The pre-read parent template uses 36 ASCII bytes for LLP 0110's UUIDv7
`parentIncarnation` and 16 decimal digits for the maximum portable-safe-integer
`parentVersion`, including their JSON quotes/member framing. Those are storage-
derived after the parent point-read and are never called invocation constants
or read merely to size the cursor. If an owner widens either representation,
it must first amend this budget and vector. The maximum-size refusal completes
before visibility evaluation or any storage access; the later actual value can
only be smaller than or equal to its admitted template.

`args` and the other invocation constants do not change across pages, so using
their actual establishment bytes is not a mid-flight data dependency. Owner-
enforced boundary maxima make every later state no larger than the template.
Missing bounds, an unbounded key-generation spelling, or a maximum over 6,099
refuses before the first page with
`SNAPBACK_SNAPSHOT_BATCH_CURSOR_BUDGET_EXCEEDED`. Mint still checks the
8,192-byte wire cap as defense in depth; disagreement is an invariant failure,
never a terminal result or a data-dependent pagination cliff.

On every resume, all deduplicated parents—including groups whose nodes are
terminal—are point-read and visibility-checked at the new snapshot. Nonterminal
nodes resume from their bound state; terminal nodes examine zero child-range
entries. The continuation is present iff at least one node is nonterminal.
Visibility and sealing precede cursor validation, preserving byte-identical
missing/invisible results even for malformed input. Authenticated
stream/restore-epoch or parent incarnation/version change yields
`SNAPBACK_SNAPSHOT_BATCH_RESTART_REQUIRED`, under the same
cross-authority-first precedence the `sbsb2` section pins for the
`sbsb1`/`sbsb2` families (LLP 0110's `sbbc1` keeps its own owner binding
and restart outcomes):
the authority-partition comparison is evaluated before the epoch
comparison, so a genuine rotation (which changes both) collapses to
`SNAPBACK_SNAPSHOT_BATCH_CURSOR_INVALID` and the restart-on-epoch outcome
is the tamper-only case — the implemented v1 order; malformed, expired,
cross-app, cross-plan, cross-parent, cross-authority, or boundary-invalid
credentials collapse to `SNAPBACK_SNAPSHOT_BATCH_CURSOR_INVALID`. `sbbc1`
refuses in a batch and `sbsb1` refuses in a standalone node; the complete
both-direction cross-profile refusal rule, which also covers `sbsb2` and
each surface's precheck precedence, is stated once in the `sbsb2` section
below and applies to this family too.

The same JSON field name `planHash` deliberately carries two owner-specific
identities: existing `sbbc1` preserves LLP 0110's current serialized
`BoundedChildrenPlan` identity and fixed vector; `sbsb1` and `sbsb2` carry §D2
`PlanHashV1`. No family refactor may replace one with the other.

### `sbsb2` plaintext and budget

Registered 2026-08-06, per the 2026-08-05 LLP 0135 relational-composite owner
ruling (§D1's dated registration). `sbsb2` is `snapshot-batch.v2`'s only
resume credential. It reuses `sbsb1`'s envelope, ordered-compact-JSON
serializer, 8,192-byte wire cap, and therefore the identical arithmetic:
8,186 base64url characters after `sbsb2.`, at most 6,139 decoded bytes, and a
6,099-byte plaintext budget after the 24-byte nonce and 16-byte tag. Every
body member with the same name as an `sbsb1` member carries its `sbsb1`
semantics unchanged — `groupIndex` zero-based dense in §D2 group order,
`parentAuthorizationKeyDigest` under the
`snapback:parent-authorization-key:v1:` domain, `nodes` dense in position
order, verbatim canonical `args` bytes, and the millisecond timestamps with
the exact 1,209,600,000 delta — with only `formatVersion: 2` and the widened
node state union differing. Its plaintext is the following closed record in
this exact field order:

```ts
{
  formatVersion: 2,
  keyGeneration: string,
  appId: string,
  databaseId: string,
  targetProfileId: string,
  streamEpoch: string,
  function: string,                  // exact exported function id
  planHash: `sha256:${string}`,      // recomputed PlanHashV1
  args: unknown,                     // complete merged non-cursor CanonicalClientValueV1
  parentGroups: readonly {
    groupIndex: number,
    parentAuthorizationKeyDigest: `sha256:${string}`,
    parentId: string,
    parentIncarnation: string,
    parentVersion: number
  }[],
  nodes: readonly {
    position: number,
    nodePlanHash: `sha256:${string}`,
    state:
      | { kind: "terminal" }
      | {
          kind: "boundary",             // bounded_children_v1 nodes only
          orderFields: readonly string[],
          boundary: readonly unknown[],
          rowId: string
        }
      | {
          kind: "relational-boundary",  // relational_query_v1 nodes only
          orderFields: readonly string[],
          boundary: readonly unknown[],
          rowId: string
        }
  }[],
  authorityPartition: `sha256:${string}`, // AuthorityPartitionDigestV1
  issuedAt: number,
  expiresAt: number
}
```

**Cursor binding.** The body binds the complete merged normalized arguments
once: `args` is the exact §D2 `canonicalArgs` JSON bytes embedded verbatim,
as in `sbsb1`, never a cursor-local re-encoding. The per-node state union is
closed. A `bounded_children_v1` node keeps `sbsb1`'s boundary/terminal
mapping byte-for-byte: its nonterminal state is the same `kind:"boundary"`
projection of §D3's `bounded-children.v1` `NodePageBoundaryV1` variant
(`orderFields`, `boundary`, child-`_id` `rowId`, in that member order). A
`relational_query_v1` node's state is either terminal or
`kind:"relational-boundary"`: the one-to-one projection of §D3's
`relational-query.v1` variant — LLP 0080's complete root-window boundary,
with the plan's ordered root `orderFields`, the last consumed root's aligned
`boundary` values, and the separate root-`_id` tie-break as `rowId`, in that
member order. No other boundary projection is admitted; a state tag that does
not match the node's registered class refuses with
`SNAPBACK_SNAPSHOT_BATCH_CURSOR_INVALID`. `parentGroups` binds exactly the
`bounded_children_v1` dedup groups in §D2 group order, dense and ascending; a
relational node appears in no group, carries no substitute parent binding,
and an all-relational tuple emits `parentGroups:[]` — the empty array, never
an omitted member. No `sbbc1` credential and no LLP 0080 standalone
relational cursor appears inside the body or in any composite result;
per-node cursor identity does not survive composition.

**Budget.** The pre-read maximum-template computation is `sbsb1`'s, extended
per class. Every body member is counted at its serialized worst case. Each
bounded-child node compares terminal framing against its owner-declared
worst-case `kind:"boundary"` state under the unchanged parent template
widths, which apply only to bounded-child groups. Each relational node
compares terminal framing against its worst-case
`kind:"relational-boundary"` state, computable because this profile closes
the admitted order-field type set: a v2 relational node's declared root
order fields must each be a portable string carrying the schema-level,
write-enforced `maxEncodedBytes` bound, a table-scoped id, a
JavaScript-safe integer, or a boolean — the same closed template types the
v1 budget uses — and a relational plan declaring any other order-field type
(notably float, `v.real()`, whose RFC 8785 spelling width no owner closes
though LLP 0080 admits it for standalone ordering, and equally the
string-shaped `principal` and `assetRef` declarations, which carry no
`maxEncodedBytes` bound; `relationIncarnation` is framework-owned, never an
application order axis, and likewise outside the closed set) refuses
composition under this profile at establishment with
`SNAPBACK_SNAPSHOT_BATCH_CURSOR_BUDGET_EXCEEDED`, its standalone admission
unchanged. The template widths are pinned to the digit, and they govern the
`sbsb1` template's order values identically — one family template, not two:
a string order value counts its declared `maxEncodedBytes` at the maximum
JSON escape expansion of six characters per bounded byte plus the two
framing quotes; an id-typed **order field** is application data with no
inherent length bound, so it must carry the same schema-level,
write-enforced `maxEncodedBytes` bound a string order field requires and
counts it at the same six-character expansion plus quotes; the
framework-minted root-`_id` tie-break needs no declaration and counts 256
unescaped bytes plus the two framing quotes, a deliberate ceiling above
LLP 0148's 20–38-character minted spelling, sound because `_id` is a
system field no write may supply; a JavaScript-safe integer order value
counts 17 characters (`-9007199254740991`); and a boolean order value
counts 5 (`false`). The nonnegative `parentVersion` keeps its 16-digit pin
above. The shipped v1 template's reconciliations — the one-character
boolean/integer under-counts and its hard 256-byte substitution for
id-typed order fields in place of the required declaration — are tracked
as an implementation ticket, not a license to under-count. Missing bounds,
an unbounded key-generation
spelling, or a maximum over 6,099 refuses before the first page with
`SNAPBACK_SNAPSHOT_BATCH_CURSOR_BUDGET_EXCEEDED`; mint still checks the
8,192-byte wire cap as defense in depth, and disagreement is an invariant
failure, never a terminal result or a data-dependent pagination cliff.

**Resume and restart.** One continuation resumes all nodes together at a new
single snapshot. On every resume, all deduplicated bounded-child parents —
groups whose nodes are terminal included — are point-read and
visibility-checked at the new snapshot; an authenticated parent incarnation
or `_version` change yields `SNAPBACK_SNAPSHOT_BATCH_RESTART_REQUIRED` and
restarts the whole composite. A relational node has no parent point-read and
**no substitute parent `_version`**: its revalidation is exactly the
fail-closed plan, argument, authority-partition, stream/restore-epoch, and
order-schema boundary validation, and its resumed root window carries LLP
0080 §2's guarantee — no skipped and no duplicated untouched root, with the
stated tolerance for concurrently moved roots — through the composite
unchanged. Nonterminal nodes resume from their bound state; a terminal
bounded-child node examines zero child-range entries, and a terminal
relational node examines zero root-range entries and performs zero
joined-side lookups. The continuation is present iff at least one node is
nonterminal. Visibility and sealing precede cursor validation, preserving
byte-identical missing/invisible results even for malformed input.

The public outcomes of **validating a continuation presented to a
`snapshot-batch.v2` composite** are total and exactly two, following the
implemented v1 rule, and the partition is reached only after the sealing
precheck: every deduplicated bounded-child parent is point-read and
visibility-checked first, and a parent that is absent or invisible seals the
whole tuple with the byte-identical `absent` envelope **before** cursor
validation, even when the presented credential also carries that parent's
changed incarnation or `_version`. After every parent is present and
visible, `SNAPBACK_SNAPSHOT_BATCH_RESTART_REQUIRED` is returned exactly when
a credential that authenticated under the current app/database/target AAD
**and decoded validly — well-formed, unexpired, non-future-issued, current
`formatVersion` and `keyGeneration`; decode-validity failures collapse to
`SNAPBACK_SNAPSHOT_BATCH_CURSOR_INVALID` before any epoch or parent
comparison, following the implemented v1 decode-first rule —** carries a
changed stream/restore epoch or a changed incarnation or `_version` for a
still-visible bounded-child parent. The epoch axis is
exact: `streamEpoch` is the same authorization-stream/restore incarnation
the bound partition carries as
`AuthorityPartitionV1.principalDataScope.authorizationStreamIncarnation`,
so a genuine rotation changes both members; the cross-authority collapse is
evaluated **before** the epoch comparison and wins, making the
restart-on-epoch outcome reachable only for a credential whose bound
authority partition still matches the current one (a tampered or
inconsistently minted epoch) — the same order the shipped v1 validator
applies. **Every** other credential-validation failure — malformed bytes,
authentication failure (which cross-app, cross-database, and cross-target
mismatches become, since all three ride the AAD and the `…:v2` purpose
bytes), expiry, wrong `formatVersion` or `keyGeneration`, cross-function,
cross-plan, cross-`args`, cross-parent, cross-authority,
node/group-binding mismatch, state-tag/class mismatch,
order-schema-invalid boundary, and cross-profile presentation to this
composite — collapses to `SNAPBACK_SNAPSHOT_BATCH_CURSOR_INVALID`. Restart
precedence follows LLP 0110's rule: only a credential authenticated for the
current app/database/target may select the more specific restart outcome;
unauthenticated bytes never do. Failures outside credential validation keep
their own owners' outcomes and are not in this partition: a cursor-bearing
subscribe refuses with `SNAPBACK_SNAPSHOT_BATCH_LIVE_CURSOR_UNSUPPORTED`
before any storage work and therefore before the sealing precheck; a
custody-ground mint failure refuses the page under the envelope rule above
with the distinct public custody diagnostic
`SNAPBACK_SNAPSHOT_BATCH_CURSOR_MINT_UNAVAILABLE` (LLP 0135 §2.4; it is
never `SNAPBACK_SNAPSHOT_BATCH_CURSOR_INVALID` and never a terminal page);
and a result-contract mismatch refuses at load. Cross-profile refusal is
total in both directions, scoped by each surface's own precedence: a
receiving surface's visibility/sealing prechecks remain authoritative and
may seal (or return the standalone owner's indistinguishable absent result)
before any cursor validation occurs; once a surface reaches cursor
validation, a foreign-family credential refuses under that surface's
owner code — `sbsb1` in a `snapshot-batch.v2` composite and `sbsb2` in a
`snapshot-batch.v1` composite (both `SNAPBACK_SNAPSHOT_BATCH_CURSOR_INVALID`),
`sbsb2` at a standalone node under that node owner's cursor-invalid code
(`SNAPBACK_RELATIONAL_CURSOR_INVALID`,
`SNAPBACK_BOUNDED_CHILDREN_CURSOR_INVALID`), and `sbbc1` and LLP 0080's
standalone relational credential each in any batch.

**Sealing.** LLP 0135 §2.3's seal-entirely rule extends unchanged and seals
only through bounded-child parents: a bounded-child parent's absence or
invisibility seals the entire mixed tuple with the byte-identical
`{kind:"absent", nodes:null, continuation:null}` envelope, disclosing no
sealing node, count, or cause. An authorized relational node that emits zero
rows is a **visible empty page**, never `absent`; missing or invisible joined
rows keep LLP 0080's `inner`/`left` semantics and never seal.
Invocation-level authorization refusal of a relational plan refuses the whole
composite with its closed refusal (§D3 `refused`); it is never recoded as
parent absence. An all-relational tuple has no parent and therefore no
reachable sealed envelope; its declared result contract nevertheless carries
LLP 0135 §2.3's unnarrowed two-arm `SnapshotBatchRow` envelope — every
`snapshot-batch.v2` composite does — with the `absent` arm statically
unreachable but never removed. The envelope **arm set** is therefore never a
function of the tuple's class mix or of `absent`'s static reachability, and
no `resultContractHash` or `QueryMaterializationKeyV1` difference arises
from the arm set; the visible-arm payload still varies normally with the
declaration-ordered node classes and projections, so class mix rotates
`PlanHashV1`, the authored `resultContractHash`, and therefore
`QueryMaterializationKeyV1` through §D2's ordinary rotation table.
In the `visible` row, a bounded-child node
contributes its own cursor-free `{parent, children}` page unchanged and a
relational node contributes its own cursor-free `RelationalResultEncodingV1`
row array; the declared result contract must exactly match the
declaration-ordered tuple under that two-arm envelope, else
`SNAPBACK_SNAPSHOT_BATCH_RESULT_CONTRACT_INVALID` refuses at load.

**Work accounting.** The composite ceiling is a static fact of the normalized
plan, encoded in `PlanHashV1`, summing every owner's per-node ceiling, each
pinned to the digit here: for each bounded-child node, `take + 1` examined
child-range entries, and exactly `0` when `take` is `0` (LLP 0110 §1.2),
plus one point-read per deduplicated parent declaration; for each relational
node, exactly `take` examined root-range entries, and `0` when `take` is
`0` — LLP 0080 §2's pipeline consumes at most `take` authorized roots with
no lookahead entry (a page consuming fewer than `take` roots is terminal),
under §1's index-served admission with no residual post-index predicate and
the owner-field-leading index that keeps invisible roots out of the
examined range — plus **exactly one joined-side unique-index lookup per
relational root consumed**, including a root later omitted by an `inner`
join, at most `take` lookups per relational node per page. The §D6 unit is
exact: a node's `examinedEntryCeiling` is exactly its examined
index-entry count — `takeᵢ + 1` for a bounded-child node (`0` at
`take: 0`), `takeᵢ` for a relational node; parent point-reads are projected
separately through §D6's `parentAuthorizationGroupCount`; and the
per-relational-node joined-lookup ceiling (`takeᵢ`) is deliberately not a
v1 §D6 field — A14's work instrumentation covers it. LLP 0135 §2.5's v1
`Σ (takeᵢ + 1)` remains that profile's honest upper bound over the same
per-node declarations. No target
may replace those indexed operations with an unbounded scan; acceptance
instruments the ceiling exactly as LLP 0080 §Acceptance's index-served root
bound instruments examined entries. Summed node `take` stays at most 1,024.

**Cross-language acceptance vectors — specified here, frozen by the
implementation.** Before any target may admit or require the profile at
runtime, and before any support, capability, or implementation claim is
published, the committed `sbsb1` parity pattern (oracle A4's shared
fixture with independent consumers) must be reproduced for `sbsb2`: the Rust
reference emits fixed-nonce golden vectors into one committed shared fixture;
the Rust test consumes that fixture with plaintext byte-equality, wire
equality, and an in-module drift guard; and at least one independent
client-language consumer, registered in the local proof, re-derives the HKDF
key, length-framed AAD, and XChaCha20-Poly1305 envelope from primitives to
byte-identical wire and round-tripped plaintext. The vector set must contain
at least: (a) a mixed tuple with a nonterminal bounded-child state, a
nonterminal relational state, one terminal node of each class, and non-empty
`parentGroups`; (b) an all-relational tuple with `parentGroups:[]`; (c) a
maximum-width template vector at exactly 6,099 plaintext bytes plus the
6,100-byte establishment-time refusal, exercising every closed template
type at its pinned width — a bounded string and a bounded id order field at
maximum escape expansion, the root-`_id` at the 256-byte ceiling, the
17-character safe-integer extreme, and both boolean spellings; and (d) decode
near-misses covering the total outcome rule — `sbsb1`/`sbsb2` cross-prefix
in both directions, a state tag mismatching the node's registered class,
the cross-app/database/target/function/plan/args/parent/authority/expiry/
boundary-invalid collapse cases, the two authenticated restart cases
(tampered `streamEpoch` with the bound authority partition intact; changed
parent incarnation/`_version` on a still-visible parent), the
decode-validity overlap near-miss (an authenticated credential that is
expired and also carries a changed epoch or changed parent facts →
`SNAPBACK_SNAPSHOT_BATCH_CURSOR_INVALID`, proving decode-validity collapse
precedes the restart comparison), the
genuine-rotation case (both members changed) collapsing to cursor-invalid,
and cross-family presentations both ways — a foreign credential at a
visible-parent surface refusing under that surface's owner code, and the
same credential at an absent/invisible-parent surface sealing (or
returning the standalone owner's absent result) before cursor validation.
This amendment authors those vector
obligations; generating and freezing the vectors, like the executor itself,
is the separately commissioned implementation, and no support or capability
fact exists until both languages are green.

### Ownership transition

Charlie accepted this Spec on 2026-08-03. This section is therefore the
canonical cursor-family registry and `sbsb1`/`sbsb2` grammar; LLP 0110
continues to own bounded-child body semantics, LLP 0080 continues to own the
relational grammar and standalone cursor, and LLP 0135 continues to own
execution semantics. The acceptance landing records dated boundary notes in LLP 0080, LLP 0110,
LLP 0135, LLP 0114, LLP 0053, and LLP 0043 for profile names, cursor
ownership, provider/query-key seams, and store migration, so no future editor
changes one copy alone. The held
`issues/20260802-wave1-0135-sequences-snapshot-batch.md` implementation
consumes this exact grammar and the §D2–D7 layers without inventing another
cursor, identity, liveness rule, proof, or store key.

## Commission crosswalk

Every LLP 0155 Move 1/2 obligation is normative here, delegated to an owner,
or explicitly blocked. “Implementing slice” alone is not a disposition.

| Source obligation | Normative owner / dependency | Executable oracle |
| --- | --- | --- |
| Option-3a static composition; owner-governed vocabulary | §D1; LLP 0135 execution | A4, A11; Triage/Fleet exit |
| Vocabulary/design-work stop rule | §D1: 4 classes of 6, 4 profiles of 4 (profile axis exhausted 2026-08-06), one class per reviewed amendment, no further profile except by RFC escalation | registry/refusal corpus |
| Cursor coordination, partial seal, parent dedup, result identity | LLP 0135 execution + §D2 identity + §D8 cursor grammar | A2, A4–A6 |
| Canonical args and one plan/materialization identity | §D2 | A2–A3 |
| Per-child liveness without shape inference; LLP 0090 mixed successor seam | §D2/D4; the successor owns its new artifact/wire profile | A3 |
| `unknown/complete/prefix/refused`; compositional proof | §D3 | A1, A5–A8 |
| `prefix` never inferred from an implementation cap | §D3, producerless | A1, A6 |
| Capability classification | §D2/D4; current owner facts, successor meet later | A3, A11 |
| Authoring sugar only over admitted nodes | §D5 | A10 |
| One inspection model, server/client projections, ordinary/audit boundary | §D6; static indexes/bounds are ordinary, exact pending-intent identities remain owner-authorized | A9 |
| Every retained row has a retaining reason | §D6 client row handles + §D7 memberships | A9; Move-2 churn gate |
| Fragments, membership, completeness, freshness, version, resume, retention | §D3/D7 record and operations | A5–A9 |
| Reactive store observation and materialization plan | §D7 operations 2–10 | A5–A8 |
| Provisional identity, optimistic layers, outbox, settlement composition | §D7 references; payload semantics remain LLP 0107/0043/0133 | A8 plus owners' suites |
| Contract-valid ingestion; delta re-widening regression | §D7 | A12 |
| Same local/server plan evaluation | blocked on dated LLP 0008 DK-9 + LLP 0080 amendment; corpus proposed into LLP 0051 D5 (OQ9) | Move-2 carrier gate after owners land |
| Store carrier neutrality | LLP 0008 DK-9 plus §D7 semantics | Move-2 carrier gate below |
| Volatile-only/degraded targets | §D7 `volatile-online-v1` with durable GAP and retention none | capability/refusal fixture |
| All first-party arms, including narrower Contract custody | §D7 same semantic records; each arm advertises its qualified storage profile | per-arm capability matrix; LLP 0155 OQ16 transport remains open |
| LLP 0053/0043 query-key and retained-store reconciliation | §D7 + §Migration; dated acceptance boundary notes | key migration/crash fixture |
| LLP 0145 bundle reconciliation | Full-client attribution in the first shipping Move-2 slice | measured artifact, not a prose claim |
| Cross-query normalization | not admitted; §D7/OQ2 evidence gate | adversarial projection only if proposed |
| Aggregates including `count` | out; LLP 0130 SD-2 | none here |
| Interim fail-closed cap milestone | §D3 rule; current tree proves only imperative `collect()` refusal, not the public witness or an LLP 0080 composition milestone | A1 |
| Move-1 Triage/Fleet exit | satisfied by the fresh Triage 8/8 receipt and qualified Fleet 8/8 receipt (both retained 2026-08-06); Move 1 is closed | workload receipts |

The current tree's `SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED` is specifically the
inline-handler `collect()` 1,024-row seam in
`packages/snapback-harness/ctx-bootstrap.js`, with local/workerd regressions.
That is useful fail-closed evidence, but it does **not** by itself land
`CompletenessStatusV1` on `relational_query_v1`; the public witness milestone
remains unimplemented.

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
- No liveness or retention fact is inferred from a node's plan shape.
- No raw cursor, boundary, authorization witness, or protected argument
  appears in ordinary inspection.

## Executable acceptance

Each oracle names an admitted current or proposed profile, exact operation,
required output, and forbidden output.

1. **A1 — fail-closed cap, inline query plus public projection.** Run the
   existing inline `collect()` fixture at 1,023, exactly 1,024, and 1,025
   matching rows. The first returns complete authored output; the latter two
   take `SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED` under today's conservative
   ambiguity. Once the public witness ships, the exact refusal maps to
   `refused`, never `complete`, `prefix`, or truncated success.
2. **A2 — identity parity.** For one `snapshot-batch.v1` two-node manifest,
   codegen, Rust admission, and JS client reproduce every §D2 preimage and
   output byte, including the current five-field `ExpectedGenerationV1`,
   per-binding and merged-argument contracts, activation, and complete
   authority partition. Outer/function/generation app mismatch refuses;
   current sessions fixtures preserve the distinct `snapback.v0` generated-
   reference and `snapback.v1` generation-artifact schema axes without
   comparing them. Reordered nodes, renamed bindings, changed visibility,
   changed parent group, changed capability/liveness, changed contract,
   changed activation, changed args, and changed authority partition each
   rotate exactly the owning layer. A tampered supplied hash refuses.
3. **A3 — liveness near-miss and mixed successor.** Generate one
   `Query` and one `LiveQuery` over byte-identical normalized storage plans.
   Their explicit capability records and `NodePlanHashV1` differ. A mixed
   profile planning fixture and the executable local bundle select only the
   latter position for registration from the bound fact while both positions
   are evaluated at one pinned commit and the plain child receives explicit
   read-only delivery. The prepared React provider starts no ordinary
   subscription for that child, reports it as snapshot/idle, and keeps the
   live sibling live; a classifier using node shape fails the fixture.
4. **A4 — cursor grammar.** The committed `sbbc1` fixed-nonce vector remains
   byte-identical. Independent Rust/JS encoders reproduce one fixed-nonce
   maximum-width `sbsb1` vector. Cross-prefix, tamper, app, plan, authority,
   expiry, parent-restart, boundary, a large-but-valid `args` value, and
   6,099/6,100-byte maximum-template cases produce exactly §D8's outcomes
   before storage where specified.
5. **A5 — one-page proof and atomicity.** Establish a visible and a sealed
   `snapshot-batch.v1` page. The trusted generated activation, proof-key
   manifest, signature/result/boundary bindings verify and the
   whole tuple installs with one proof. Crash at every carrier write boundary
   yields prior state or complete successor. No node fragment, partial tuple,
   unverified proof, or sealing position is observable. A wrong current query
   instance, authorization incarnation or epoch, version stream, or a commit
   below a non-null witness's `minCommitVersion` rejects installation, retained
   boot, and render; a client-authored `data:null` witness rejects likewise.
6. **A6 — page-set composition.** Over `bounded-children.v1` and
   `snapshot-batch.v1`, create a first→middle→terminal chain at one stream/
   version and atomically obtain `complete`; independently re-run the owner's
   no-skip/no-duplicate oracle. Delete a page, substitute a validly signed
   same-version proof whose page/result identity breaks the chain, break
   credential-digest continuity, stop before terminal, or advance one page's
   version: each set is `unknown`, never `prefix` or `complete`. Distinct batch
   ids across legitimate page establishments are allowed; tampering a proof's
   batch id fails its signature, and batch continuity is not a page-set rule.
7. **A7 — retained single-node boot.** Use an admitted
   `relational_query_v1` `opaque-authorized-snapshot-v1` result (not a
   non-retainable composite). Valid proof+witness+lease boots
   `complete/retained`. Run every row of §D3's retained-boot failure table and
   exact-compare its store mutation, derived status, and zero-render result.
8. **A8 — fence and lifecycle races.** For the same retained single-node
   profile, race every page write/render with query-generation bump,
   quarantine/release, delete, lease expiry, user switch, grant end, and terminal
   retirement. Quarantine preserves hidden bytes; delete destroys them and
   leaves a tombstone; retirement rejects late work and recreation allocates a
   new instance. User/grant authority rotation runs the store-wide barrier over
   every predecessor QMK before successor initialization. A stale CAS never
   renders or strands an unreachable fragment.
9. **A9 — inspection positive and noninterference oracle.** A golden trace
   exercises current, retained, refused, quarantine, delete, singleton
   occurrence membership, hydration, resume, plan indexes/bounds, and
   optimistic/outbox reference counts. Every required ordinary field and
   domain-separated digest matches, including distinct requested,
   established-snapshot, and current versions and the authorization-dependency
   classification and count on both projections and digest handles on the
   server projection. Across paired missing/invisible worlds, every
   sealing position and multi-seal combination yields byte-identical ordinary
   projections; only the separately authorized audit trace differs.
10. **A10 — sugar refusal.** A generated spelling containing a
    data-dependent node, free predicate, traversal, or aggregate refuses with
    the registered construct-specific code; zero partial nodes/artifacts are
    emitted. Attempts to compose an LLP 0004/0007 single-table plan, inline
    handler, or unknown class likewise take the §D1 unregistered-class refusal.
11. **A11 — current composite classification.** A cursor-free
    `snapshot-batch.v1` first page admits whole-composite `live_replace`;
    cursor-bearing subscribe refuses before storage; `live_delta`, retained,
    and proved-disjoint claims are absent. Removing a node's experimental
    acknowledgment or target support refuses admission rather than degrading.
12. **A12 — ingestion.** The current schema-exact `documents(table)` delta
    fixture retains contract-valid adds/updates. A narrowed document or record
    contract takes validated `live_replace`; invalid stored data yields
    `resync_required` and no application payload. Any widened delta candidate
    must pass both directions before persistence.
13. **A13 — mixed-route v2 version and cleanup.** A format-2 generated
    reference round-trips its exact profile/plan/node hashes through codegen,
    server admission, response delivery, and client installation. Removing or
    changing any hash, export-kind binding, route argument mapping, or wire
    discriminator refuses before publication. A child failure and attach
    abandonment purge every live-child registration and grant while leaving
    no state for the read-only child. Re-running the LLP 0112 format-1
    acceptance yields byte-identical request/response shapes.
14. **A14 — `snapshot-batch.v2` grammar and admission.** Independent Rust/JS
    encoders reproduce §D8's complete `sbsb2` vector set: the mixed and
    all-relational fixed-nonce goldens, the 6,099/6,100 maximum-template
    boundary, and every §D8 total-outcome near-miss — cross-prefix in both
    directions, a state tag mismatching the node's registered class, the
    cross-app/database/target/function/plan/args/parent/authority/expiry/
    boundary-invalid collapses to `SNAPBACK_SNAPSHOT_BATCH_CURSOR_INVALID`,
    the tamper-only epoch restart, the still-visible parent
    incarnation/`_version` restart, the expired-plus-changed-epoch overlap
    collapsing to `SNAPBACK_SNAPSHOT_BATCH_CURSOR_INVALID` before the
    restart comparison, the genuine stream-rotation collapse,
    and the cross-family visible-parent (owner code) versus
    absent/invisible-parent (seals first) presentations. A mixed tuple whose
    bounded-child parent disappears or becomes invisible seals
    byte-identically to v1's envelope — including when the presented
    credential also carries that parent's changed `_version`, proving the
    sealing precheck precedes the restart partition; an authorized zero-row
    relational node returns a visible empty page; an invocation-level relational
    authorization refusal refuses the composite and is never recoded as
    absence; an all-relational tuple never produces the sealed envelope
    while its generated result contract still carries the unnarrowed
    two-arm envelope, and a contract narrowed to the visible arm refuses at
    load with `SNAPBACK_SNAPSHOT_BATCH_RESULT_CONTRACT_INVALID`. A
    cursor-bearing subscribe refuses with
    `SNAPBACK_SNAPSHOT_BATCH_LIVE_CURSOR_UNSUPPORTED` before storage,
    exactly as in A11. A one-node tuple, a nine-node tuple, a tuple with no
    relational node declared under `snapshot-batch.v2`, and a summed `take`
    of 1,025 each refuse at admission with LLP 0135 §3's closed codes; an
    artifact missing the `snapshot_batch_v2` acknowledgment — or missing
    `bounded_children_v1`'s when a bounded-child node is composed — refuses
    at admission, while the all-relational golden case (b) admits with
    `snapshot_batch_v2` acknowledged alone. A relational node whose string
    root order field carries no schema-level write-enforced
    `maxEncodedBytes`, or whose declared order-field type is outside §D8's
    closed template set, refuses before the first page with
    `SNAPBACK_SNAPSHOT_BATCH_CURSOR_BUDGET_EXCEEDED`. A bounded-child
    `take: 0` node derives a ceiling of exactly `0` examined child-range
    entries while its deduplicated parent point-read still occurs, and a
    relational `take: 0` node derives `0` examined root-range entries and
    `0` joined lookups. Work instrumentation
    proves each page performs at most the summed declared ceilings —
    examined child-range entries, parent point-reads, examined root-range
    entries, and exactly one joined-side unique lookup per consumed
    relational root — and no unbounded scan on any target.

### Move-1 workload exit (LLP 0155 normative transcription)

Fresh provider-native Triage Graph and Fleet Observatory implementations must
prove all of the following. The retained Triage receipt passes 8/8, and the
qualified 2026-08-06 Fleet receipt passes 8/8 with 0 blocked after the local
`snapshot-batch.v2` implementation, frozen cross-language vectors, and A14
oracle landed. These receipts satisfy the workload exit and close Move 1:

- required screens use generated composites, not JS collection joins;
- the client retains only the desired bounded query results;
- pagination has no duplicate or skipped untouched root;
- 20 query changes leak no predecessor rows;
- the 250,000-event fixture converges exactly the 100 active matches from the
  1,000-update burst;
- an implicit incomplete prefix is impossible to consume as complete;
- Mallory receives no protected source or result rows; and
- inspection explains every retained row and every completeness transition.

### Move-2 carrier exit (LLP 0155 normative transcription)

The fragment store additionally requires:

- browser process terminate/relaunch over real IndexedDB;
- two tabs sharing and contending over one browser profile;
- file/native process terminate/relaunch;
- retained render while the server is unreachable;
- logout, user switch, revocation, lease expiry, artifact change, and corrupt
  store recovery;
- bounded custody under query churn;
- if normalization is ever proposed, the adversarial disjoint-projection/
  one-revoked-authority/no-field-or-existence-oracle case; and
- byte/row footprint and hydration measurements on Triage and Fleet.

The normalization case deliberately strengthens LLP 0155's “if admitted” to
“if proposed”: adversarial authority evidence precedes admission rather than
following it. Other wording is normalized to this Spec's vocabulary without
claiming byte-verbatim transcription.

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

**Dated `single_table_v1@1` migration rule (2026-08-03):** adoption of a
legacy `rqsEntryKey(name,args)` entry is connected-only. The current served
function must pass the class predicate; the target must advertise the class,
proof, and store capabilities; current generated/trusted activation artifacts
must exact-match; and no pending outbox intent may depend on the predecessor.
The client derives the node/plan hashes, QMK, and contextual address from those
current owner artifacts and validates the legacy key, args hash, generation,
function artifact, version stream, digest kind/content digest, rows, and token
under LLP 0090's rules. The unchanged ladder may establish current exact bytes,
after which the server issues an ordinary proof over the derived QMK; a token
or content digest alone never is that proof. If identity cannot be proved, the
token is stale, the ladder falls through, the examined-entry guard refuses, or
any binding differs, fresh `single-node.v1` establishment is required. A
still-valid legacy entry remains under its legacy label/rules when fresh
establishment cannot succeed; a corrupt entry is discarded before fresh sync.
Only after a valid QMK fragment/proof exists may one same-domain store
transaction install it and remove or terminally retire the legacy entry. A
crash exposes only the pre-switch legacy record or the post-switch QMK record
(except delete-before-fresh after corruption), never a relabel-in-place or two
renderable identities. The legacy token never becomes a QMK resume credential.
The adoption implementation remains a separately commissioned follow-on.

Existing LLP 0043/0053 lease-backed records use the legacy
`retainedQueryKey(name,args)` producer. They adopt `qmk1` only when migration
can recompute the exact registered plan, function reference, activation,
canonical args, and authority partition and can atomically move payload,
lease, fence high-waters, obligations, and pending-intent references. Otherwise
the legacy record coexists non-renderably until fresh sync creates the new
address, then retires under its old fence; it is never relabeled in place.
The LLP 0114 UI-level react-store key remains unchanged and resolves to the
new semantic address after admission.

`sbbc1` does not migrate: its existing wire and fixed-nonce vector remain
exact. No credential migrates into `sbsb2`: `snapshot-batch.v1`, `sbsb1`,
and `snapshot_batch_v1` remain byte-compatible, bounded-children-only, and
independently supported where already qualified (the contributor local
target per LLP 0135's 2026-08-03 implementation record; support-false
elsewhere); registering the v2 profile reinterprets no v1 composite,
credential, or capability fact. LLP 0090's implemented mixed-route
profile uses a new artifact/wire version as its amendment requires; it consumes this
Spec's per-child identity/capability facts and does not reinterpret LLP 0112
format 1.

## Non-goals

No aggregates (including count); no free predicate or traversal
language; no data-dependent composition; no client-side authority over
completeness; no second execution substrate beside LLP 0135 Part 2; no
change to its sealed-envelope, coordinated-resume, or classification
semantics; no status/proof/inspection **transport envelope** (owners' dated
0093/0094 amendments); no normalization admission (§D7's gate); no change to
LLP 0080's or LLP 0110's admitted query shapes; no parallel authorization
fence beside LLP 0053's. §D8 deliberately does own the cursor wire grammar.

## Open questions

1. **Resolved 2026-08-06: the reviewed amendment landed.** Charlie's
   2026-08-05 ruling admitted `relational_query_v1@1` narrowly through
   `snapshot-batch.v2` / `sbsb2`; the v0.11 amendment registers the exact
   profile row, `sbsb2` cursor record and budget, cursor-profile assignment,
   classification, sealing/resume/work-accounting pins, and required
   parity-vector obligations (§D1, §D3, §D4, §D8), reusing the existing
   class and §D2–D7 record shapes unchanged. LLP 0135's successor ruling
   continues to govern the closed execution semantics. **Resolved
   2026-08-06:** the implementation, frozen cross-language vectors, and fresh
   Fleet 8/8 workload receipt landed; §Commission crosswalk records Move 1
   closed.
2. The normalization evidence bar (§D7): the adversarial-projection
   fixture corpus and who owns its review — with LLP 0155 OQ2.
3. A free-standing typed to-one node class: needed, or does LLP 0080's
   unique joined side suffice for the Stage-1 applications? Owner:
   the 0080/0110 family.
4. Status/proof and inspection transport envelopes — dated LLP 0093/0094
   amendments over §D3/§D6's frozen semantic schemas.
5. The client inspection artifact's transport/discovery mechanism — with
   LLP 0114's seam owners and LLP 0017 for the server side. Field schemas and
   ordinary audiences are no longer open.
6. Membership/semi-join node classes — with LLP 0100/0073, including
   how their invalidation composes with the page-scoped proof.
7. Composite incremental-delta and retained classification (the
   successor profile's meet lattices, §D4) — deliberately unowned
   until a real application needs it.
8. The `prefix` unreserve trigger: which application, and what
   plan-proved stable-prefix rule.
9. Does the evaluator conformance corpus extend LLP 0051 D5's corpus
   (proposed) or stand alone — with LLP 0051's owners.

   > **Ruled (2026-08-03, Charlie Cheever, as LLP 0051's owner): extend
   > D5.** The result-transform conformance corpus lands as an LLP 0051
   > D5 extension — the same corpus discipline, pinned evaluator
   > identities, and cross-runtime exactness bar the 2026-08-03 Phase-1
   > D5 evidence proved out at 37/37 — not a standalone artifact. The
   > dated note in LLP 0051 records the same ruling; LLP 0166 §D7's
   > conformance gate binds here.

## Status

Accepted, v0.7 — Charlie Cheever accepted and promoted the Spec on 2026-08-03
after the LLP 0005 dual-family super-refine loop concluded.
Codex Round 5 returned READY at 0.97 confidence with no new findings. Claude
Round 3 returned READY at high confidence with two NITs, both applied in v0.6.
All actual responses, including every earlier NOT READY verdict, remain in the
two provenance-tracked artifacts under `reviews/`; no prior verdict is
rewritten or counted as READY.

The acceptance-gated §D8 ownership transition is now effective. The v0.8
dated amendment registers `exported_query_v1` and `mixed-route.v2`; the
contributor local implementation advertises the separate Experimental
`mixed_bundle_boot_v2` capability. LLP 0155
Stage 1, the held snapshot-batch half of
`issues/20260802-wave1-0135-sequences-snapshot-batch.md`, and LLP 0090's
versioned mixed-route successor may consume this Spec without inventing
parallel identity, cursor, completeness, or liveness rules. G-02 is closed and
records its generated-result-type owner boundary. No implementation or
capability is promoted by this document-status change alone.

The v0.9 dated amendment records Charlie's semantic acceptance of
`single_table_v1@1` and Arm A. It does not claim that any target implements or
advertises the class, proof path, retention authority, or staged adoption;
those remain gated by the separately commissioned implementation program and
the existing proof/wire/store conformance requirements.

The 2026-08-05 LLP 0135 OQ5 owner ruling accepts the narrow relational-
composite direction and reserves `snapshot-batch.v2` / `sbsb2` as this
registry's fourth profile. It consumes no class slot:
`relational_query_v1@1` remains LLP 0080's existing class. The ruling is not
profile activation. The exact cursor record, registry row, vectors, and
acceptance corpus must land as a reviewed amendment before codegen or any
target may admit, require, implement, or advertise `snapshot_batch_v2`.

The v0.11 dated amendment (2026-08-06) is that reviewed registration:
`snapshot-batch.v2` is the fourth and final plan profile, with the exact
`sbsb2` cursor record and budget, the §D3 assignment rows, the §D4
classification, the §D8 sealing/resume/work-accounting pins, and the
required cross-language parity-vector obligations. The profile-registry
growth budget is now consumed (§D1's growth stop rule). Registration is
semantic only and authorizes the separately commissioned implementation work
to proceed; until the executor, the frozen vectors, and each target's own
capability publication authority are all green, no target may admit or
require the profile at runtime, no shipped generated artifact may require
the capability (acceptance-corpus fixtures may), and no support,
capability, or implementation claim may be published. The Fleet Observatory
carrier-exit row remained an honest GAP until the post-implementation fresh
workload receipt existed. That qualified 2026-08-06 receipt is now retained;
the refreshed carrier exit is 17 PASS / 0 GAP / 0 skipped, so Move 1 is
closed. This closure does not promote Experimental maturity and does not add
public-package, remote-service, Cloudflare, or hosted support.

## `single_table_v1` activation and local publication — 2026-08-04

The dormant class is now active. The closed target registry contains
`single_table_v1` at `experimental` maturity with its same-commit introduction
record; codegen adds the id to `requiredCapabilities` exactly when the
host-derived predicate selects class 4, and the contributor-source
`local-dev-sqlite-ibex` target derives support only through LLP 0110's exact
store/class `LocalCapabilityPublicationV1` carrier. Public packages,
remote/hosted targets, and the Fleet footprint leg remain false/GAP under
their own publication authorities.

Activation changes no class semantics. Membership remains host-derived and
never author-assertable; admission remains `single-node.v1` only; ordered or
limited results remain `live_replace`; the 1,024 examined-entry refusal is
scoped to QMK establishment. Arm A continues to carry
`rqs-authority-independent-snapshot-v1`, `authorizedLeaseHash: null`, and no
`AuthorizedLease`. Legacy adoption remains connected-only prove-or-fresh, one
atomic same-domain transaction, never relabel-in-place, and never drops
pending outbox intent. Existing result/cursor wire encodings stay unchanged;
the newly required capability id is part of the plan's declared capability
classification and therefore rotates the plan identity consistently in
codegen and host reconstruction.

## Amendment — 2026-08-10: toolchain-stable activation identity (RULED)

**Author ruling — 2026-08-10 (Charlie Cheever): v2 adopted as specified
below. The signing ceremony vouches for authored bytes; frozen-artifact
custody lives in the acceptance receipts. The `activationGenerationAdvanced`
audit marker is a MUST. Implementation commissioned as a single lane
(dual-version validation, mint path, rotation-survival regression, one
final ceremony re-minting the four demos to v2, discharging the standing
remint ticket). The knowingly-accepted tradeoff: a v2 activation alone no
longer freezes emitted artifact bytes — any future design that admits a
deployment on an activation WITHOUT receipts (e.g. if LLP 0087 un-parks)
must revisit this binding first.**

### Problem

`CompositionActivationIdentityV1` binds `expectedGeneration =
{schemaHash, bundleHash, inputsHash}` and
`validateTrustedCompositionActivationV1` requires exact JCS equality
(`packages/snapback-codegen/index.mjs`, the
`trusted composition activation does not bind this generated deployment`
refusal). All three hashes incorporate the *isolated evaluation* of the
authored modules — the canonical meaning of the source under the current
AST transformer and evaluator — so a routine toolchain change (a manifest
schema field, an evaluator fix) rotates the identity of every committed
backend even when the app's authored bytes are untouched.

Consequence, measured on 2026-08-09/10: the four signed demo activations
were invalidated three times in two days by unrelated landings
(S0 codegen rotation, `whereApplicable` on `IndexManifest`,
structured-stored-values). Each invalidation blocks demo regeneration,
which blocks the triage/fleet Move-1 and local-store carrier-exit receipt
re-mints, which forced five recorded `SNAPBACK_DRIFT_GATES_BYPASS`
landings (dated notes in
`issues/20260809-signed-composition-activations-need-remint-after-s0-toolchain-rotation.md`).
The signing ceremony re-runs at most days apart while vouching for demos
whose authored sources did not change. The remint ticket routed this
design question to LLP 0087, but 0087 is a parked hosted-adoption Plan;
the activation format is owned here.

### Proposed design: `snapback.composition-activation.v2`

Add one field to the activation identity and split the validation rule:

```ts
{
  format: "snapback.composition-activation.v2",
  databaseId: string,
  deploymentId: string,
  targetProfileId: string,
  authMode: "dev" | "sessions",
  authoredSourceHash: `sha256:${string}`,   // NEW — see below
  mintedGeneration: ExpectedGenerationV1,    // renamed from expectedGeneration; provenance record
  proofKeyManifestDigest: `sha256:${string}`
}
```

`authoredSourceHash` is SHA-256 over a new framed domain
(`snapback-codegen/authored-source-hash/v1`) covering exactly the
byte-level identity items that already exist inside today's `inputs`
list: the schema/functions/routes module-graph path+bytes pairs, the
handler path+bytes pairs, and the seed/demo-metadata/codegen-policy/
contract-capability sources — **excluding** the `*-isolated-evaluation`
items and any artifact-schema-version framing. It answers one question:
"are these the authored bytes the ceremony ran against?", independent of
what the current toolchain thinks those bytes mean.

Validation under v2:

1. `authoredSourceHash` must exact-match the freshly derived value —
   fail closed as today (`TRUSTED_COMPOSITION_ACTIVATION_INVALID`).
2. `mintedGeneration` no longer gates admission. When it differs from
   the current generation, codegen MUST emit a dated
   `activationGenerationAdvanced` marker into `artifacts.json`
   (minted vs. current triple, timestamp) so the drift is auditable and
   the acceptance layer can see it.
3. Everything else (closed roots, proof-key manifest canonicality,
   target profile, auth mode, database/deployment identity) is unchanged.

v1 activations remain valid under v1 rules until their next re-mint;
re-mints emit v2. No flag day.

### Why this is sound (the custody argument)

The signature's vouching surface becomes "this app's authored bytes
passed the acceptance ceremony", not "…and the then-current toolchain's
opinion of them". The end-to-end trust chain does not thin: the
Move-1/carrier-exit acceptance receipts independently pin the full
generated-source shas and re-mint under LLP 0189's cadence, the
completeness proofs still verify against the proof keys at runtime, and
the toolchain that re-derives the generation is repo-owned, reviewed
code — the same code v1 already trusts to *compute* the hashes it
compares. What is given up: a signed activation no longer freezes the
emitted artifact bytes, only the authored input bytes; the frozen-artifact
property moves wholly to the receipts, where it already lives.

### The one ruling needed

**Does the signing ceremony vouch for authored bytes (adopt v2 as
specified), or must it also freeze the toolchain's semantic evaluation
(keep v1 equality, accept the re-mint treadmill as a deliberate cost)?**
There is no useful middle: binding the evaluation while tolerating
"non-semantic" toolchain drift re-creates exactly today's rotations,
since the rotating changes (manifest fields, evaluator behavior) are the
semantic ones.

If accepted: implementation is one lane — the v2 identity + framed
domain and dual-version validation in `packages/snapback-codegen`, the
mint path in the server keyring, a regression proving a v2 activation
survives a simulated toolchain rotation while refusing an authored-byte
edit, and one final ceremony re-minting the four demos to v2 (which also
discharges the standing remint ticket).
