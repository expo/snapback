# LLP 0190: Zerobugs retained facts and local evaluation

**Type:** Spec
**Status:** Draft
**Systems:** Zerobugs, Local sync, Offline sync, Query retention, Relational queries, Client SDK, React, Auth, Testing
**Author:** Codex (gpt-5.6-sol) / Claude Fable 5 (supervision) — owner-Spec author naming per the 2026-08-07 ruling
**Date:** 2026-08-07
**Revised:** 2026-08-07 (evidence addendum, Claude Fable 5: zb5-hot v10
closed the hot profile with two facts this Spec must design against —
mutation settle latency under six concurrent 1,000-row streaming observers
at the 5.5M-row store measured 111 ms–148 s with a median near 74 s
(`snapback-control-hot.zb5.v10.json`), making local facts the only path to
interactive reads under write fan-out until D2/D4 land incremental deltas
(`issues/shelved/20260808-live-query-reevaluation-cost-at-scale.md`); and a
quarantined-or-lapsed stream now has a proven fail-closed client posture
whose user-visible rendering is exactly the retained-fact degradation
story in §6)
**Related:** LLP 0008, LLP 0043, LLP 0053, LLP 0090, LLP 0129, LLP 0130, LLP 0135, LLP 0155, LLP 0157, LLP 0166, LLP 0183, LLP 0189

## Summary

The Zerobugs control has a precise missing carrier, not a general wish for
"more offline." Its 19 live queries are opaque JavaScript handlers with no
schema-derived plan identity. None can therefore enter an owner-admitted
retention class, produce locally reusable projected facts, or support local
query evaluation. The control correctly retains zero query payloads and makes
every offline read unavailable. Separately, all 16 mutation adapters submit
with `queue:false`, so the application has zero durable queued intent.

Those two facts account for the 37 GAP rows in the latest ZB2 receipt and the
overlapping retained/queued GAPs in ZB3 and ZB4 — about 43 GAP rows across the
three gates. They also prevent the ratified durable-disconnected-intent
improvement from being attempted. The live-scale finding adds a second
consumer: when a stream lapses under fan-out, the server remains authoritative
and polled results remain correct, but an admitted retained result would let the
client degrade to a truthfully stale view instead of losing all useful data.
Retention does not repair the stream and must not be claimed as doing so.

This Spec owns the D3 investigation and admission envelope. It does **not yet
choose** among four candidate mechanisms:

1. promote declared projections/read models into owner-normalized facts;
2. derive a sufficient plan identity from a provable subset of opaque handlers;
3. add a retained successor to the currently volatile snapshot-batch carriers;
4. admit exact whole-result retention without claiming projected-fact reuse or
   local graph evaluation.

Each candidate must pass the same identity, authority, completeness, retention,
invalidation, carrier, and custody gates. Candidates may be admitted per query
and per LLP 0183 risk class; there need not be one winner for all 19 queries.
Failure to admit a candidate leaves the corresponding receipt row honestly GAP.

The server remains the only authority. Stored bytes, a handler digest, a local
evaluation, a speculative overlay, or a freshness label never authorizes a
row. Missing proof yields `unknown` or a typed refusal, never absence or
plausible completeness. Logout and principal transitions synchronously blank
predecessor facts before successor work can inspect them, and protected
retention remains subject to LLP 0053's quarantine/delete fences and exact
`AuthorizedLease` deadline.

## Status and authority

This is the first owner-Spec commissioned by [LLP
0183](./0183-zerobugs-quality-surface.rfc.md) after Charlie's 2026-08-07
ruling. The ruling names D3 as the first workstream and ratifies durable
disconnected intent as the primary improvement candidate, contingent on the
D3–D5 family landing an offline queue. The ruling is recorded in
[`ratification-13.v1.md`](../demos/zerobugs/manifest/ratification-13.v1.md)
and LLP 0183 §Status.

"D3 starts first" does not erase the dependency order in
[`program-plan.v1.md`](../demos/zerobugs/stage0/program-plan.v1.md). D3 can
freeze evidence, discriminate carriers, and specify admission before D2 and
D4 land. A capability that consumes D2 graph identity or D4 window state
cannot publish before those owners supply it. Likewise, D3 does not acquire
LLP 0129's mutation-admission authority merely because durable intent depends
on a retained read base.

This Draft makes no capability available. Under [LLP
0130](./0130-program-standing-decisions.decision.md) SD-4 it may advance from
Review to Accepted only after the commissioned dual-family review converges
READY with zero unresolved MATERIAL concerns and no weakened evidence
boundary. ER-2 still escalates any proposed weakening. Acceptance of this
document would accept the investigation, seams, invariants, and receipt gates;
it would not select a candidate, change a wire format, add a store layout, or
publish retention for any query.

## 1. Problem statement from receipts

### 1.1 The control has no retained query carrier

The immutable
[`snapback-control.zb2.v3.json`](../demos/zerobugs/evidence/snapback-control.zb2.v3.json)
receipt reports:

- `queryMatrixRows: 19` and `admittedRetainableQueries: 0`;
- `retainedQueryPayloads: 0` and `browserFactsRetained: 0`;
- `adapter-retained-label` as GAP because the adapter can preserve a retained
  label but has no admitted retained bytes to label;
- every `retained-query.*` row as GAP because the corresponding function is an
  opaque JavaScript query with no `rqsEligible`, relational-retainable, or
  snapshot-batch carrier; and
- `widened-retention` as an explicit refusal, preventing the harness from
  converting stored or online-fetched bytes into an unsupported offline claim.

The existing function envelope is not enough. LLP 0157 can reconstruct an
`exported_query_v1` identity from the served function manifest, but explicitly
does not normalize an opaque handler body into a plan or liveness oracle. The
19 current queries therefore have exported function identity and validated
result contracts without the schema-derived plan/projection identity required
for an owner to classify reusable facts or local evaluation. A content hash of
opaque code says which code ran; it does not prove which rows, fields,
relationships, authority inputs, absences, ranges, or completeness statements
the code's output represents.

The practical chain is:

```
opaque handler body
  -> no owner-normalized plan/projection identity
  -> no retention classification or completeness proof for that identity
  -> no admitted retained facts
  -> no local evaluation or disconnected read
```

This is also why the control's `W-READMODEL` workaround matters. The control
maintains bounded denormalized projections for all-label membership,
project-user existence, wide list ordering, and comment-derived search, then
hydrates source-shaped results in application code. Those rows are correct and
receipted, but their schemas, writers, rebuilds, and custody are application
workarounds. They are not automatically owner-declared facts, and D3 may not
retain or locally combine them merely because their shape looks promising.

### 1.2 The control has no queued intent

The same ZB2 receipt reports `queuedIntentMatrixRows: 16`,
`admittedQueuedMutations: 0`, and `durableQueuedIntents: 0`. Every current
adapter calls `client.mutate` with `queue:false`. That is an honest control
boundary: no disconnected success is fabricated.

ZB3 consequently keeps its durable restart and revocation-crossing queued-write
rows GAP. ZB4 keeps retained/queued negative-delivery rows GAP where no carrier
exists. Together with ZB2 v3's PASS 5 / GAP 37 result, the control ledger
records roughly 43 GAP rows across ZB2–ZB4 whose common roots are missing
retained reads and queued intent rather than 43 independent platform features.

D3 can remove the read-side root and provide the retained base against which a
later queued overlay is presented. It cannot flip `queue:false`, admit a
mutation verb, define speculative mutation semantics, or prove exactly-once
settlement. Those are D5 and LLP 0129 responsibilities.

### 1.3 Retained facts are also a live-degradation carrier

[`issues/20260807-hot-cycle-live-stream-stale-at-settle.md`](../issues/20260807-hot-cycle-live-stream-stale-at-settle.md)
records a separate live-scale failure. Six `issueListV2` observers establish
exact initial windows over the 5.5M-row fixture, then 16 mutations can create
up to roughly 96 expensive opaque-handler re-evaluations in a 400 ms burst.
The ordinary user's stream becomes `stale` and does not regain `live` within a
bounded 30-second recovery window, while independent authoritative polls return
the exact expected rows and protected-visibility facts.

This finding creates a second acceptance consumer for D3:

- when live continuity is lost, `current` must clear immediately;
- if an admitted retained answer still passes its proof, authority, and lease
  checks, the UI may continue with an exact retained/stale label;
- otherwise it renders `unknown`/unavailable and hydrates or refuses; and
- reconnect or resubscribe still requires the live owner's recovery path and,
  for auth-scoped data, a fresh authorized snapshot.

A retained answer is graceful degradation, not evidence that live delivery is
healthy. The hot-stream ticket remains open until its server-starvation versus
client-retry cause is discriminated and repaired.

## 2. Governing invariants

Every candidate and every stage obeys these constraints.

1. **Server-authoritative truth.** The server authorizes, establishes
   completeness, orders, commits, settles, and issues retention custody.
   Clients may evaluate an admitted plan over admitted facts, but cannot mint or
   extend plan identity, authorization, a completeness proof, a lease, a
   canonical version, or settlement.
2. **No authority from bytes.** Presence in IndexedDB, a file carrier, memory,
   an opaque result fragment, or a snapshot batch is not renderability. The
   existing LLP 0166 answer-class checks remain the floor.
3. **Refusal union, not plausible data.** A missing fact is unhydrated, not
   absent. A bound hit, skewed projection, missing proof, unsupported query
   node, expired lease, or unknown authority returns `unknown` or a stable
   refusal. No local count coincidence or last-known array becomes
   `complete`.
4. **Orthogonal labels.** Authority/completeness, freshness, connection, and
   settlement remain distinct axes. `retained` means neither `current` nor
   globally complete. `stale` means neither unauthorized nor authorized. A D5
   optimistic overlay, if later supplied, remains provisional and separately
   labeled.
5. **Query-scoped custody.** Queries and admitted memberships, not tables,
   define default custody. Whole-table replication and undisclosed broad source
   sets are outside this Spec.
6. **Projection is an authority boundary.** Two queries over the same canonical
   row id may authorize disjoint fields, versions, memberships, or existence
   facts. No implementation unions them across queries, principals, grants, or
   policy partitions unless the exact projected-fact risk class has separately
   passed its adversarial gate.
7. **Synchronous predecessor blanking.** Logout, user switch, auth-mode change,
   and session-authority transition publish a blank successor view at the cut.
   Predecessor facts and overlays are hidden or destroyed before any successor
   query, evaluator, callback, replay, or inspection can observe them. Durable
   deletion may finish behind the barrier; visible predecessor state may not.
8. **LLP 0053 dispositions win.** Query-scoped `quarantine` hides and blocks
   reads immediately; `delete` destroys payload and leaves the fence/tombstone;
   neither registration, demand, compaction, local evaluation, nor a new
   snapshot can lower an unresolved disposition. Protected offline retention
   requires the exact owner-issued lease and treats equality as expiry.
9. **Fresh authorization on non-live resume.** Process restart, page reload,
   second-tab adoption, socket regain from non-live state, and service-worker
   resumption do not use retained bytes or equal epochs as authority for a live
   result. Auth-scoped results fresh-snapshot before becoming current.
10. **Carrier-specific evidence.** Browser IndexedDB, Node/file, native, memory,
    local target, and hosted targets are separate facts. Evidence on one is not
    promoted to another.
11. **Immutable attempts.** Failed and GAP receipts remain. A later attempt
    appends evidence and never rewrites or semantically upgrades the control's
    v3 receipt.

## 3. Scope and seams

### 3.1 D3 owns

D3 owns the following read-side contract for the Zerobugs workstream:

- the criteria by which a current opaque Zerobugs query, a successor declared
  query, or a projected-fact source can be admitted to a retention carrier;
- the staged authority/projection risk classes from LLP 0183 §D3;
- the identity and proof requirements that distinguish a retained answer from
  merely stored bytes;
- local evaluation admission, including same-plan or cross-runtime
  conformance, `unknown` behavior, and exact freshness/completeness labels;
- per-fact or per-fragment retaining reasons, budgets, retirement, quarantine,
  inspection, and custody accounting;
- the retained-render behavior during disconnection, browser restart, and a
  live-stream lapse; and
- integration of retained facts with LLP 0053's logout, user-switch,
  revocation, artifact/policy change, lease-expiry, and predecessor-retirement
  barriers.

D3 may define requirements another owner must satisfy. It does not silently
amend that owner's grammar, wire, storage format, or capability registry. A
selected mechanism that needs such a change produces an explicit dated
amendment or successor owner Spec before implementation.

### 3.2 D5 seam — queued mutation intent

D5 and LLP 0129 retain sole authority over:

- lowering the 16 Zerobugs mutations to generated IR;
- per-verb admission to offline queueing or local execution;
- speculative ids, optimistic layers, rebase, rejection, settlement, and
  exactly-once replay;
- the change from `queue:false` for any adapter; and
- the revocation-crossing queued-write behavior required by the ratified §13
  improvement.

D3 supplies only an admitted retained base and a fenced materialization seam.
If D5 later supplies an overlay, D3 composes it only through the already
admitted settlement/overlay owner; D3 never derives a reducer from mutation
names. Until D5 lands, all 16 `queued-intent.*` rows, ZB3's durable queued
restart/revocation rows, and the whole-product "better" candidate remain GAP.

### 3.3 D2 seam — graph and query shape

D2 owns the bounded relational graph vocabulary, normalized node plans,
projection, relationships, search membership, filters, ordering, cursor
semantics, bounds, and server execution. D3 consumes an owner-issued D2 plan
identity; it cannot infer one from result bytes or add a graph node to make a
retention experiment pass.

The declared-projection candidate may show that a control read model should be
promoted, but D2/D6 own the query/maintained-data design and the actual
`W-READMODEL` retirement. D3 owns only how an admitted projection becomes a
retained fact and which local evaluations it can safely answer.

### 3.4 D4 seam — windows and lifecycle

D4 owns active ranges, forward/backward demand, prefetch, cancellation,
deduplication, eviction policy, query replacement, permalink loading, scroll
anchors, and restart restoration. D3 records plan/args/window identity and may
retain an owner-approved complete window or range proof. It does not decide
which windows the UI demands or claim a retained window is the whole query.

D4's server-backed mode remains independently useful and must ship without D3.
A later D4 local mode can consume D3 answers through the same lifecycle, with
`unknown`, hydrating, retained, current, and refused states preserved.

### 3.5 D6 and live-delivery seams

D6 owns portable maintained derived fields and search documents. D3 may retain
them only after D6 supplies a versioned projection identity, writer/rebuild
contract, bounds, authority posture, and invalidation facts.

The live-query owner retains responsibility for preventing stream starvation,
socket loss, and failed resubscribe. D3 owns only the data-correct degraded
render when continuity is absent. A D3 receipt can prove "retained rows stayed
truthful while live was stale"; it cannot close a live-liveness receipt.

## 4. The design question

The question is not "which cache should Zerobugs use?" It is:

> What is the smallest owner-verifiable identity and carrier that lets one or
> more of the 19 Zerobugs queries render useful retained data and, where
> separately admitted, evaluate locally — without widening custody,
> completeness, or authority beyond the server-approved result?

The answer may be a portfolio. Exact whole-result retention can be useful
before projected facts are safe. Public exact projections can land before
private overlays. A declared successor query can coexist with an online-only
opaque predecessor. A candidate that closes one risk class does not authorize
the next.

### 4.1 Common admission record

Every candidate must be able to produce, from trusted owner/host artifacts
rather than client assertion, the semantic equivalent of this record. This is
an investigation schema, not a promised wire or stored JSON type:

```
RetentionAdmissionCandidate {
  app / database / target profile
  exported function and exact activation identity
  owner-normalized plan or exact-result identity
  canonical args and, where applicable, window/range identity
  projected fields / relationships or "opaque whole result"
  result contract identity
  authority classification and partition identity
  authorization / policy inputs and invalidation class
  completeness-proof class
  retention class and carrier profile
  local-evaluation class, or "none"
  bounds: rows / facts / bytes / windows / work / lease
  predecessor identity and retirement rule
  required capability ids and evidence receipt
}
```

The exact owner Specs may reuse LLP 0157/0166 identities instead of creating a
new record. The mandatory property is closed, content-addressed, host-recomputed
identity across the axes above. The client may request retention or query
demand; it cannot author the admission.

### 4.2 Candidate A — declared projections and read-model promotion

This candidate replaces opacity with declaration. A query compiles to an
owner-normalized D2 graph and/or an owner-maintained D6 projection whose
projected fields, relationship edges, membership/absence proofs, authority
inputs, bounds, and invalidation are explicit. The current `W-READMODEL` rows
are workload evidence, not pre-admitted definitions.

Potential benefit:

- strongest path to true projected facts and same-IR local graph evaluation;
- schema-derived plan identity can be shared by server execution, proof,
  retention, local evaluation, inspection, and live invalidation;
- may retire application joins and parts of `W-READMODEL` once D2/D6 also pass;
  and
- can isolate public project/label facts from private per-user overlays, which
  matches LLP 0183's staged risk classes.

Trust and authority cost:

- the declaration/compiler becomes load-bearing and must refuse every dynamic
  handler behavior it cannot normalize;
- maintained projections need transactional writer, rebuild, migration,
  authority, and bounded-work owners before their rows are trusted;
- source-row custody cannot exceed the declared projection merely to make local
  evaluation convenient; and
- D3 cannot claim this route until D2/D6 owner amendments exist.

Decision evidence: compile the chosen Zerobugs query and its independent oracle
to the same result across all relevant actors/fixtures; show closed plan and
projection identities; show `unknown` on incomplete inputs; show no hidden
field/existence oracle; and account for every retained fact and membership.

### 4.3 Candidate B — plan-identity extraction from opaque handlers

This candidate asks whether a strict subset of current JavaScript handlers can
be normalized without rewriting their authoring surface. Static analysis,
host-generated IR, or another owner-defined extraction may qualify only if it
proves the handler's complete inputs, projection, ordering, bounds, authority
dependencies, and result identity.

The existing `exported_query_v1` function envelope is not that proof. Neither a
handler-source digest nor one runtime trace proves unexecuted branches,
data-dependent reads, ambient state, projection shape, absence, or authority
inputs. Trace-only identity may aid diagnostics but cannot admit retention or
local evaluation.

Potential benefit:

- preserves more of the current 19-query authoring surface;
- could reduce the D2 rewrite needed for simple opaque handlers; and
- makes a useful refusal frontier visible: provable handlers graduate while
  dynamic ones remain online-only.

Trust and authority cost:

- the extractor becomes a compiler/security boundary with conservative
  semantics across JavaScript constructs and runtime versions;
- any unsupported construct, dynamic table/field access, ambient input,
  application-authored authority assertion, or incomplete dependency result
  must refuse;
- host reconstruction, not emitted client metadata, must determine the plan;
  and
- evaluator parity must be proved against the extracted closed IR, not the
  original arbitrary JavaScript body.

Decision evidence: a closed grammar and refusal corpus; host-recomputed
identity stable across equivalent builds and rotating on semantic change;
adversarial handlers that conceal reads/fields/authority must refuse; and the
admitted subset must match full server execution byte-for-byte at the declared
result boundary.

### 4.4 Candidate C — retained snapshot-batch successor

LLP 0135 `snapshot-batch.v1` and `snapshot-batch.v2` provide static,
owner-admitted nodes, one-snapshot execution, explicit plan identity, bounded
work, and coordinated completeness. They deliberately publish
`retention: "none"`. Stored payload presence therefore cannot be interpreted as
retention today.

This candidate would design a versioned successor retention profile for an
exact snapshot-batch result. It could preserve a coherent list/detail bundle or
window without normalizing facts across queries.

Potential benefit:

- builds on strong plan, snapshot, bound, authority-partition, and completeness
  identities;
- can close useful retained whole-screen results before cross-query projected
  facts are admitted; and
- avoids presenting independently captured fragments from skewed versions as
  one coherent graph.

Trust and authority cost:

- requires explicit owner amendments to LLP 0135, LLP 0157, and LLP 0166; no
  client or D3 adapter may reinterpret the existing `retention: "none"` row;
- a retained batch is still an opaque exact result for local purposes unless a
  separate evaluator class is designed and admitted;
- window/cursor identity and release remain D4-owned; and
- protected batches require exact LLP 0053 witness/lease custody for the whole
  retained result and fail closed if any sealed authority component cannot be
  revalidated.

Decision evidence: successor identity and predecessor retirement; retained
browser restart with the server unreachable; common-snapshot proof survives
storage round trip; tampered/skewed/mixed-authority batches render nothing; and
custody remains bounded under window churn.

### 4.5 Candidate D — exact-result retention admission

This candidate separates the useful first step from the larger projected-fact
goal. An owner may admit the exact, contract-validated output of a named query
and args/window at a named authoritative snapshot as a retained fragment. It
does not expose source facts, permit cross-query reuse, or re-run the query
locally. At most, an already admitted LLP 0166 `result-transform.v1` may operate
over its own exact established result; no source-row pipeline or cross-address
evaluation appears through this route.

Potential benefit:

- smallest path to a truthful offline/restart render for opaque or
  hard-to-declare queries;
- provides graceful degradation for a lapsed live stream without claiming to
  fix live delivery; and
- preserves query-result-scoped custody.

Trust and authority cost:

- the owner must still issue exact function/args/result/activation/authority
  identity, completeness proof, retention class, and bounds; an adapter
  assertion is not admission;
- protected exact results require composite witness, durable client fences,
  and `AuthorizedLease` custody; and
- this route leaves local graph evaluation, projected-fact reuse,
  `W-READMODEL` retirement, and fan-out compute unchanged.

Decision evidence: exact-result proof and contract round trip; server-offline
browser restart; stored-byte-without-proof refusal; auth/lease transitions;
artifact/args rotation; and inspection of every retained fragment and reason.

## 5. Decision gates

No candidate wins by architectural preference or by closing the most rows in a
mock store. A candidate is eligible for a named query and risk class only after
all applicable gates pass.

| Gate | Required evidence | Failure outcome |
| --- | --- | --- |
| G0 — control identity | Receipt binds the current control release, exact query, args/window, actors, fixture, carrier, and existing GAP/refusal rows. | Investigation result is not comparable; no decision. |
| G1 — normalized identity | Host/owner reconstructs a closed, content-addressed function + plan/exact-result + projection + result-contract + activation identity. Semantic changes rotate it. | Online-only; an opaque digest alone is insufficient. |
| G2 — authority inputs | Owner identifies authority independence or the exact principal/policy partition and complete authorization-event inputs. Client assertions are excluded. | Protected/unknown; no retention. |
| G3 — completeness | Server issues a proof for the exact plan/result, args/window, authority, version, and bounds. Missing, mixed, tampered, or cap-hit inputs become `unknown`/refused. | Render nothing locally; hydrate or use online fallback. |
| G4 — retention admission | Owner-issued retention class, durable carrier, demand/membership reason, custody budget, artifact rotation, and predecessor retirement all pass. Existing `retention: none` never changes in place. | Bytes may be transient but are not renderable after loss of live continuity. |
| G5 — local evaluation | Same owner IR runs on server/client or a pinned dual-runtime conformance corpus agrees exactly on canonical values, order, nulls, relations, bounds, cursors, search membership, and completeness. | Exact-result retention only, or online-only; no local-evaluation fact. |
| G6 — invalidation | LLP 0053 fences survive callback races, tabs, restart, revocation, lease expiry, artifact/policy change, logout, and principal switch. Predecessor render blanks synchronously. | The authority/projection class refuses; public evidence cannot be borrowed. |
| G7 — carrier reality | Real Chrome IndexedDB process kill/relaunch and two-tab writer handoff pass; every other claimed carrier has its own process evidence. Server is unreachable during the retained-render leg. | No browser/native/file durability claim from fake or same-process evidence. |
| G8 — custody and scale | Normal, large, and hot receipts account for facts/fragments, memberships, bytes, hydration, churn residue, evictions, quarantine/delete, and bound refusals. | No ZB5 or custody advantage claim. |
| G9 — adversarial projection | Required before even proposing risk classes 2 or 4: disjoint projections of one id, skewed versions, one revoked membership, and paired missing/invisible worlds expose no field, existence, order, count, completeness, or timing oracle. | Exact per-query fragments remain the ceiling. |

Decision rules:

1. Admission is per named query, carrier, target, authority posture, and risk
   class. A PASS does not generalize.
2. Risk classes advance in LLP 0183's order: public exact; public compatible;
   per-principal private exact; protected/projection-subsuming.
3. A later class cannot borrow an earlier class's receipt. Failure at a later
   class does not invalidate a safe earlier class.
4. Candidate D may land exact-result retention without selecting projected
   facts. That is a useful result but does not answer local graph evaluation.
5. Candidates A–C may coexist if each owns disjoint, inspectable identities.
   One logical result may never be renderable under two uncoordinated address
   families.
6. If no candidate passes, D3 records the refusal and the corresponding
   Zerobugs rows remain GAP. The program does not substitute whole-table
   custody, application-side authority, or hidden online fetches.

## 6. Local answers, freshness, and refusal discipline

D3 introduces no "locally true" authority tier. Candidate APIs must project
the existing answer vocabulary and keep these axes separate:

| Axis | Required states / rule |
| --- | --- |
| Answer authority | `authoritative` only from an exact owner proof/witness; otherwise existing labeled-retained/lease-retained class, `unknown`, or `refused` as governed by LLP 0166. |
| Completeness | `complete`, proved `prefix`, proved `window`, `unknown`, or `refused`; never inferred from byte/row count or a cap. |
| Freshness | `current` only with live-confirmed continuity; `retained` for an admitted as-of answer after continuity is absent. |
| Connection | live/current transport versus stale/offline; transport state never authorizes data. |
| Settlement | authoritative base, provisional D5 overlay, rejected, settled; D3 does not collapse this into freshness. |

The local evaluator follows these rules:

- It reads only facts/fragments admitted for the exact plan, args/window,
  projection, authority partition, and proof version.
- It cannot combine individually valid facts into a version-coherent result
  unless the owner proof says they share the required snapshot/version
  semantics.
- Missing relationship edges, membership, search facts, absence/range proof,
  or projection fields return `unknown` for every result property that depends
  on them.
- A protected hidden row cannot influence output, order, length, existence,
  completeness, hydration visibility, timing label, or inspection projection.
- Evaluation never persists a wider projection than the server admitted.
- On stream lapse, page reload, or restart, `current` clears before the
  retained check. A passing retained check may publish `retained`/stale; a
  failing check publishes no rows.
- A fresh authoritative snapshot may replace or release retained state only
  after all identity and LLP 0053 barriers commit. A late callback from the
  predecessor generation cannot repopulate it.

Stable refusal reasons are designed by the selected owner. At minimum the
closed refusal union must distinguish:

- no normalized plan/exact-result identity;
- retention not owner-admitted;
- local evaluation not owner-admitted;
- missing or invalid completeness proof;
- incomplete facts / hydration required;
- authority-scoped retention without valid lease custody;
- predecessor authority/artifact/policy identity;
- lease expired or clock rollback;
- carrier unavailable/not durable/not writer;
- custody or work bound exceeded; and
- corrupt or future store format.

The refusal codes may reuse existing Snapback diagnostics. This Spec does not
promise their spelling until the selected owner amendment defines them.

## 7. Authorization transition contract

The D3 carrier is a participant in the existing auth barrier, not a parallel
cache cleared later by UI effects.

### 7.1 Logout and principal/user switch

At the authority cut:

1. publish the successor as blank/loading with no predecessor facts;
2. increment the authority generation and fence all reads, writes, evaluator
   commits, live callbacks, hydration, inspection, and D5 overlay application;
3. apply the LLP 0053 client-wide `delete` to predecessor retained facts and
   relevant queue custody before successor publication can settle;
4. preserve tombstone/frontier state needed to reject delayed predecessor
   work; and
5. only then establish fresh successor identity and hydrate.

Crash during the barrier resumes deletion before retained publication. A
second tab or service worker sharing the store observes the same barrier; it
cannot retain a predecessor view behind a new session.

### 7.2 Permission and policy transition

A coarse permission or out-of-band policy event applies query-scoped
`quarantine` before read/render and before resnapshot. A satisfying fresh
authorized snapshot may release it; proof of lost access escalates to
`delete`. A live result shrink, denial, or potentially shrinking replacement
continues to use LLP 0053's durable obligation and generation-fenced ACK rules.

The client cannot determine that a revocation is irrelevant by inspecting only
its retained facts. Projection sharing, if ever proposed, must show that
revoking one membership or projection cannot leave a field/existence oracle in
another membership.

### 7.3 Offline lease expiry

Protected retained facts render only strictly before the exact owner-issued
deadline. Equality is expiry. Missing/malformed/substituted custody, rollback
taint, unknown authority history, or instance/stream mismatch follows the
owner's quarantine/delete-before-read rule. No heartbeat, cached token, local
evaluation, mutation success, or reconnect extends the lease.

This is a bounded honest-client exposure, not a hostile-client revocation
mechanism. An unreachable hostile device cannot be made to erase bytes. D3 must
retain that nonclaim in every protected-retention capability fact.

## 8. Zerobugs acceptance hooks

### 8.1 Rows D3 can change

A selected and implemented D3 mechanism must append new immutable receipts that
address these exact ZB2 rows:

- `adapter-retained-label`;
- `retained-query.allLabels`;
- `retained-query.allUsers`;
- `retained-query.allProjects`;
- `retained-query.user`;
- `retained-query.crewUser`;
- `retained-query.labels`;
- `retained-query.labelsOrderByName`;
- `retained-query.issuePreloadV2`;
- `retained-query.userPref`;
- `retained-query.usersForProject`;
- `retained-query.commentsPage`;
- `retained-query.comment`;
- `retained-query.issueDetail`;
- `retained-query.issueListV2`;
- `retained-query.listIssueByID`;
- `retained-query.emojiChange`;
- `retained-query.prevNext`;
- `retained-query.issueList`; and
- `retained-query.userPicker`.

The list is an accounting obligation, not a promise that one mechanism flips
all 19. Each row must independently name the admitted carrier, plan/exact-result
identity, authority class, bounds, carrier, target, freshness/completeness
behavior, and receipt. Unadmitted rows remain GAP.

`browser-restart-retained-render` currently passes only as an authenticated
**online server-backed** render after process restart, with
`retainedQueryPayloads: 0`. D3 does not rewrite that PASS. A successor attempt
must add a true retained leg: full owned Chrome process-tree termination,
same-profile reconstruction, backend unreachable before navigation, nonzero
admitted retained payload/fact accounting, useful rows painted, and exact
retained/stale/authority/completeness labels. Reconnection then fresh-snapshots
before `current` returns.

If D3 admits any protected query, the existing
`authorized-lease-expiry-retirement` GAP must also get a real-browser receipt
showing equality-is-expiry, render blanking, durable deletion/tombstone, and no
late callback resurrection. ZB4's retained negative-delivery rows change only
for the exact protected classes whose revocation and policy-transition receipts
pass.

### 8.2 ZB5 custody counters

The ordinary, large, and hot ZB5 receipts must stop treating auth-custody bytes
as query retention and separately account for the D3 carrier. The named rows
are:

- `custody-counters-account-for-browser-storage`;
- `large-custody-counters`; and
- `hot-cycle-custody-counters`.

Their evidence must include, per query and authority partition where safe to
report:

- retained query payloads/fragments and projected fact counts;
- membership/registration/lease/safety-blocker retaining reasons;
- logical retained bytes and physical carrier usage, separately;
- completeness/range proof counts and freshness distribution;
- hydration rows/bytes/work;
- query/window churn residue, release grace, eviction, quarantine, deletion,
  and tombstones;
- pending D5 overlay/intent ownership as a separate counter when it exists;
  and
- bound/refusal counts.

The normal receipt currently reports `retainedQueryPayloadsClaimed: 0`; the
large receipt reports `browserFacts: 0` and
`retainedQueryPayloadsClaimed: 0`. A D3 landing replaces neither historical
value. New receipts report the measured nonzero carrier where the chosen query
actually has rows, while zero-row results remain valid only with their exact
proof and membership accounting. No custody win is claimed until the frozen
ZB5 comparison rules permit it.

### 8.3 What remains GAP until D5 or another owner lands

All 16 rows remain GAP under D3 alone:

```
queued-intent.issue.create
queued-intent.issue.update
queued-intent.issue.delete
queued-intent.issue.addLabel
queued-intent.issue.removeLabel
queued-intent.notification.update
queued-intent.emoji.addToIssue
queued-intent.emoji.addToComment
queued-intent.emoji.remove
queued-intent.comment.add
queued-intent.comment.edit
queued-intent.comment.remove
queued-intent.label.create
queued-intent.label.createAndAddToIssue
queued-intent.viewState.set
queued-intent.userPref.set
```

The ratified improvement specifically requires `issue.create` and
`comment.add` to survive termination-before-send and
termination-after-enqueue/before-result, reconstruct the same declared
speculative presentation, settle exactly once, converge an independent
observer, and reject safely across revocation. D3 can make the retained base
available to that presentation. Only D5/LLP 0129 can admit the operations and
close these rows.

Also unchanged by D3 alone: D2 relational/query-shape GAPs, D4 window-lifecycle
GAPs, D6 derived/search admission, and the live stream's recovery/liveness GAP.

## 9. Staged execution and receipt exits

Stages are ordered by evidence dependency, not by a presumption that projected
facts will win. Every exit is an immutable receipt or an explicit refusal
artifact. A prose declaration or passing unit test alone is not an exit.

### Stage D3.0 — freeze the 19-query admission baseline

Run against the existing control without platform changes. Produce one receipt
row per query containing current exported function identity, args/result
contract identity, opacity reason, authority dependence, control read-model
inputs, current retention/local-evaluation class, current carrier facts, and
the exact ZB2 v3 row it preserves. Include all 16 `queue:false` facts as a
read-only seam record.

**Exit receipt:** exact 19/19 query and 16/16 mutation accounting; zero
unclassified rows; digests bind the existing control and ZB2 v3; every current
retention/evaluation result remains refusal/GAP. This stage is provable now and
does not wait for D2, D4, or a chosen carrier.

### Stage D3.1 — candidate discrimination

For each candidate worth pursuing, select the smallest representative
Zerobugs query shape and run the applicable G1–G5 proofs. Include negative
fixtures that must refuse. Do not publish a capability. Compare authoring
delta, owner amendments, query coverage, authority class, retained custody,
and whether the route can ever retire `W-READMODEL`.

**Exit receipts:** one versioned candidate receipt per mechanism attempted,
including rejected attempts; a decision packet maps evidence to G1–G5 without
choosing by prose. If every candidate refuses, the D3 result is an explicit
program GAP.

### Stage D3.2 — first public exact retention admission

After Charlie/owner review selects a candidate, admit at most LLP 0183 risk
class 1: authority-independent public, exact projection/result. Use a query
selected by the D3.1 evidence; this Spec does not preselect one by name. Rotate
identity, retain no predecessor by relabeling, and keep every other query
unchanged.

**Exit receipt:** real Chrome whole-process kill/relaunch, backend unreachable,
useful retained paint with exact labels, tamper/artifact/args/bound refusals,
two-tab writer behavior, and inspection/custody accounting for the one admitted
query. The corresponding `retained-query.*` row and
`adapter-retained-label` may pass; no other row borrows the result.

### Stage D3.3 — local evaluation for the admitted exact class

If the selected route proposes evaluation, run the owner IR on both sides or a
pinned dual-runtime corpus. Exercise values, nulls, ordering, bounds, windows,
relationships, missing facts, absence proofs, search membership, and mixed
versions. If the selected route is exact-result-only, record local evaluation
as refused and skip this stage without weakening D3.2.

**Exit receipt:** exact canonical outcome agreement on the full corpus plus
real-carrier `unknown`/hydrate/refusal behavior. Only then may a local-evaluation
capability fact name the query/profile.

### Stage D3.4 — public compatible-projection decision

Take up LLP 0183 risk class 2 only after public exact retention passes. Before
even proposing compatible-projection reuse, run G9's adversarial disjoint-
projection and version-skew cases. Prove field-level provenance, merge/version
rules, per-membership retirement, and that a wider public projection cannot
invent version coherence, completeness, or an existence/field oracle for a
narrower request. If the proof fails or the benefit is insufficient, remain
exact-fragment scoped and record the class-2 refusal before proceeding.

**Exit receipt:** one immutable class-2 admission or refusal receipt. Admission
rotates only the exact affected identities; refusal creates no capability
widening and does not weaken the safe class-1 result.

### Stage D3.5 — private exact retention and invalidation

Admit LLP 0183 risk class 3 separately for one per-principal exact projection
only after class 2 has a decision receipt and the full LLP 0053 carrier exists.
Run ordinary, creator, assignee, crew/admin, removed-member, and attacker
worlds; logout, user switch, out-of-band policy change, revocation while
disconnected, lease expiry, artifact change, callback races, restart, and two
tabs.

**Exit receipt:** synchronous predecessor blanking; query quarantine/delete;
strict lease deadline; fresh-snapshot-on-resume; no revoked field, existence,
membership, ordering, completeness, hydration, or timing oracle; and exact
retained-byte retirement accounting. Public-class receipts are not evidence for
this exit.

### Stage D3.6 — protected/projection-subsuming reuse

Risk class 4 is a separately reviewed expansion after private exact retention.
Re-run G9 with protected fields and memberships, one revoked authority while an
otherwise compatible membership survives, missing/invisible paired worlds,
and skewed versions. Prove field-level provenance, merge/version rules,
per-membership quarantine/deletion, and no cross-partition oracle. If the proof
fails, retain the exact per-query class-3 ceiling.

**Exit receipt:** one immutable class-4 admission or refusal receipt. A rejected
class produces no identity/capability widening and cannot be restated as a
partial admission.

### Stage D3.7 — whole-control coverage and stream degradation

Apply admitted mechanisms query by query. Run ZB2, relevant ZB4 negative
delivery, and the normal/large/hot ZB5 custody rows. During the hot live cycle,
deliberately observe or inject a continuity lapse and prove that data rendering
degrades to the last admitted retained answer with non-current labels, or to
`unknown` when proof/lease is unavailable.

**Exit receipts:** new immutable ZB2/ZB4/ZB5 attempts with per-query PASS/GAP,
real custody counters, and a separate statement that stream recovery remains
owned by its live ticket. D3 completes only to the exact set of queries and
risk classes those receipts prove.

### Stage D3.8 — D3–D5 offline-intent integration

After D5 admits `issue.create` and `comment.add`, compose their provisional
presentation over the D3 retained base using the settlement owner's API. Run
the ratified normal/large/hot termination and revocation scenarios without
changing D3 authority or freshness semantics.

**Exit receipt:** the §13 scenario matrix plus ZB3/ZB4/ZB5 integration facts.
Only the complete D3–D5 family can flip the relevant `queued-intent.*` rows or
support the "better" claim; D3 completion alone cannot.

## 10. Compatibility, migration, and nonclaims

- Existing opaque query refs and online behavior continue unchanged.
- Existing LLP 0090 entries, LLP 0166 materializations, and snapshot-batch
  v1/v2 records retain their exact classifications. A successor gets a new
  identity and address; no stored predecessor is relabeled.
- Adoption is prove-or-fresh behind the auth/artifact barrier. Offline adoption
  from a weaker identity is forbidden.
- Pending intent, once D5 exists, is preserved through owner-approved migration
  or the migration refuses. D3 never silently acknowledges or discards it.
- Memory fallback may provide online materialization but cannot claim durable
  retention or browser-restart survival.
- No whole-table replication, client SQL requirement, arbitrary client query
  AST, arbitrary JavaScript execution in the browser, client-authored
  authorization, or client-authored completeness enters through this Spec.
- No cross-query canonical-row normalization is admitted by this Draft.
- No snapshot-batch retention is admitted by this Draft.
- No current opaque handler becomes plan-based or retainable by this Draft.
- No new wire kind, store schema, public API, package capability, hosted target,
  or stable maturity is promised until its selected owner designs and receipts
  it.
- No D3 result repairs the live-stream lapse, removes D4's need for a window
  controller, retires `W-READMODEL` without D2/D6, or admits a queued mutation.

## 11. Open questions for Charlie

1. **First decision branch:** after Stage D3.1 receipts, should the first
   admission optimize for the smallest true retained render (Candidate D), the
   strongest path to projected facts (Candidate A), preservation of opaque
   authoring (Candidate B), or one-snapshot screen coherence (Candidate C)?
2. **First query and sufficiency:** which named Zerobugs query must be the first
   class-1 witness, and is one useful retained query sufficient to publish an
   initial D3 capability, or must a complete route graph render offline first?
3. **Projected-fact ambition:** should cross-query compatible public projection
   reuse (risk class 2) remain in this workstream after exact retention lands,
   or become a separately commissioned successor before D3 proceeds to private
   exact retention?
4. **Opaque-handler policy:** may a rigorously refusing static extractor become
   an owner plan producer, or should current opaque handlers categorically
   migrate to declared D2/D6 shapes before any retention admission?
5. **Snapshot-batch direction:** is a new retained snapshot-batch successor
   worth designing as an intermediate whole-screen carrier even though it does
   not itself provide projected-fact reuse or local graph evaluation?
6. **`W-READMODEL` disposition:** which control read models, if any, should be
   proposed for first-class D6 maintained-projection ownership, and which must
   instead disappear behind D2 query shapes?
7. **Protected-retention threshold:** must the first public D3 publication wait
   for the private exact/lease class, or may public exact retention publish
   independently with protected Zerobugs rows remaining explicit GAPs?
8. **Graceful-degradation claim:** should a receipted retained render during a
   hot stream lapse publish as a distinct capability fact, or remain only an
   acceptance behavior until the underlying live-stream ticket is repaired?
9. **Whole-workstream stopping rule:** if exact-result retention closes useful
   Zerobugs offline reads but projected-fact/local-graph candidates fail G1–G9,
   should D3 close with an explicit local-evaluation refusal, or continue as a
   foundational research program beyond the Zerobugs claim?

## 12. Draft disposition

Draft. Stage D3.0 is authorized as read-only evidence work against the existing
control because it changes no capability or owner contract. Candidate
implementation begins only after the applicable open-question ruling and owner
amendment path are recorded. Every unselected or unproved mechanism remains an
explicit GAP/refusal fact under LLP 0183's claim discipline.
