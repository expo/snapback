# LLP 0155: Local sync product direction

**Type:** RFC
**Status:** Accepted
**Systems:** Application data API, Client SDK, Client integration, Realtime, Local sync, Offline sync, Relational queries, Optimistic updates, Storage, Auth, Conflict handling, Developer experience, Testing, Competitive analysis
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-02
**Revised:** 2026-08-10 (Move 4 implementation record: Candidate A generated
`Insert` IR plus LLP 0133 logical-mint mapping proved sufficient for the
first-class React provider surface; no Candidate B authoring extension was
needed. See the dated record under Move 4). 2026-08-04 (Move 3's generated-mutation-IR exit deliberately
evolves the shipped Full/root bundle workload. LLP 0063's immutable-baseline
rule therefore applies through a prospective workload-version rollover of the
exact affected profiles, retaining the local-read-admission receipt as the
hashed predecessor; no historical ceiling is loosened.) 2026-08-03 (§Move 2 Query-execution dated note landed with
Accepted LLP 0166, the Move-2 owning Spec: v1 local evaluation is the
closed `result-transform.v1` profile; same-plan source-row evaluation is
deliberately deferred behind this RFC's OQ2 gate.) 2026-08-02 (Accepted by Charlie Cheever at v0.4 after the
three-round dual-family super-refine loop converged dual-READY/dual-ENDORSE;
Stage 0 reconciliation notes landed in LLP 0129/0008/0080 in the same
change. 2026-08-02 implementation note — Stage 0's retained-profile hard-kill
runner moved under the repository's shared Chrome lifecycle owner. v0.4 —
super-refine round 3 closure: Incident
Room's freeze home corrected — it is this RFC's named product-direction
safety-control manifest frozen in Stage 0, not an LLP 0129 lab manifest
(0129 freezes exactly Kanban/Calendar/Notebook), with the cross-reference
to propose registering it there; the Candidate-A-substrate alternative for
Move 4 surfaced in the summary and authority table; the pin-collision
digest clause regained 0129's relaxed-policy condition; the conservative
prototype/implement reading marked as this RFC's deliberate choice; the
read-lane amendment condition rescoped to plan evaluation only; the
Calendar count-lifecycle compatibility made citable.
v0.3 — super-refine round 2: Candidate-B/Move-4
prototyping gate corrected everywhere to require a retained, owner-validated
A inexpressibility result (not merely a qualified A); LLP 0129's four gate
states separated (phase start / evidence gate / advancement / lab
scheduling); Stage 0 manifest freeze split into read-lane successor
manifests vs LLP 0129 lab manifests; the DK-9 amendment reframed as a
deliberate new author decision (LLP 0051 already answered the SQL-specific
revisit trigger); Calendar counts defined as client-derived cardinalities
under LLP 0130 SD-2's standing branch; the first-party materialization
claim weakened to a shared vocabulary with arm-specific profiles pending
OQ16; the proof-protocol digest marked non-exhaustive with LLP 0129 as sole
normative text; the delta-egress ticket closure (2026-08-02, lane refusal)
recorded as a worked example with a standing regression obligation.
v0.2 — super-refine round 1: Move 1 recast as
composition of admitted bounded plan nodes per LLP 0120 option 3a with
aggregates deferred to a separately admitted node; Move 2 rebased on opaque
query-result fragments with canonical-row normalization gated behind a
projection-aware authority Spec and named as an explicit LLP 0008 DK-9
amendment; sequencing restructured into two lanes under a Stage 0 authority
reconciliation with LLP 0129; the exact A/B inexpressibility protocol
incorporated; LLP 0147 Micro relationship corrected. Initial draft
2026-08-02 — synthesizes the implemented LLP 0138 Zero/Replicache bakeoff
and the current Snapback client into a six-move product direction: copy
Zero's authoring outcomes without copying its weaker authority boundaries;
preserves LLP 0129 as sequencing and option-admission authority)
**Related:** LLP 0000, LLP 0003, LLP 0004, LLP 0007, LLP 0008, LLP 0012, LLP 0017, LLP 0034, LLP 0043, LLP 0051, LLP 0053, LLP 0059, LLP 0064, LLP 0073, LLP 0074, LLP 0080, LLP 0090, LLP 0093, LLP 0094, LLP 0095, LLP 0100, LLP 0107, LLP 0110, LLP 0114, LLP 0119, LLP 0120, LLP 0125, LLP 0126, LLP 0127, LLP 0129, LLP 0130, LLP 0133, LLP 0138, LLP 0144, LLP 0145, LLP 0147, https://zero.rocicorp.dev/docs, https://doc.replicache.dev

## Summary

Snapback should become substantially more like Zero in the local-data
experience an application author touches every day, without becoming Zero in
its authority model or deployment architecture.

The 2026-08-01 provider-native bakeoff recorded the distinction clearly. Zero
was better at composable relational queries, query-driven partial
materialization, a useful local row store, shared optimistic mutators, query
completeness, and inspection. Snapback was better at the authority boundary:
stable conflict diagnostics, explicit prediction-versus-settlement state,
durable ordered intent, protected-result retirement, authority transitions,
and a much smaller local operating surface. Replicache remained the stronger
reference for durable offline mutation and rebase, while requiring a
substantial application-owned push/pull protocol and carrying a duplicated
client/server semantics risk.

The product direction is therefore:

> **Copy Zero's outcomes, not its architecture.**

Concretely, Snapback should execute six moves:

1. make **composition of admitted bounded plan nodes** — plus completeness
   and inspection — the primary read-authoring surface, with any
   author-facing graph syntax compiling only to admitted nodes (LLP 0120
   option 3a's shape), and aggregates deferred to a separately admitted
   node class;
2. make query-scoped local materialization the ordinary client read path,
   with **opaque query-result fragments plus per-query membership and
   completeness witnesses as the admitted baseline** and cross-query
   canonical-row normalization gated behind a projection-aware authority
   design;
3. run one content-addressed mutation IR locally for prediction and on the
   server for authority before admitting duplicated app-authored mutators;
4. add typed optimistic creation through intent identity and explicit
   provisional-to-canonical reconciliation — as Candidate A substrate where
   LLP 0133's logical-mint mapping already expresses it, otherwise only as
   Candidate-B-shaped work inside LLP 0129's evidence gates;
5. admit Replicache-class app-authored client mutators only if the frozen
   LLP 0129 decision lab proves the IR and constrained extensions
   insufficient under that Plan's exact two-attempt proof protocol; and
6. preserve Snapback's server authority, revocation, settlement, explicit
   conflicts, bounded custody, target portability, and small local operation
   throughout.

The moves run as **two bounded lanes under one authority reconciliation**
(§Sequencing): a read lane (moves 1–2) that LLP 0129 explicitly permits to
proceed while its decision lab is pending, and a write lane (moves 3–5)
that keeps LLP 0129's IR-rung-first resourcing and phase machinery. Move 4
may be prototyped inside LLP 0129's decision evidence but does not become a
public capability until that program admits the relevant constrained
extension. Move 5 remains unadmitted under LLP 0129. Move 6 is a constraint
on every phase, not a final cleanup step.

## Decision requested

Accept the six-move direction above as the product architecture for Snapback's
local-data experience, with these exact consequences:

- **Start now (read lane, permitted by LLP 0129 while its lab is pending):**
  composition of admitted bounded plan nodes, query completeness and
  custody inspection, and a first-class local query-result materialization
  on the fragment baseline. The first two are named in LLP 0129's standing
  permission ("relational query planning and custody inspection, query
  completeness … do not wait for this decision"); the fragment-baseline
  materialization proceeds under the same paragraph's governing rule —
  work that does not change browser-write expressiveness; the commissioned
  DK-9/LLP 0080 amendments must land before any local plan evaluation over
  those fragments ships (the fragment baseline itself stays inside the
  owners' current envelope, §Move 2).
- **Start under LLP 0129's own phase machinery (write lane):** the
  browser-safe shared mutation-IR evaluator is LLP 0129 Phase 1 work, and
  this RFC does not create a second authorization path around that phase's
  machinery, whose gate states LLP 0129 keeps distinct: a named owner and
  timebox before the phase starts (OQ5); the IR-evaluator sizing spike plus
  the LLP 0051 D5 corpus as its evidence gate; automatic advancement
  suspended while the OQ8 scope-change escalation is pending (a passing
  gate is presented to the author, not auto-advanced); and OQ8's answer
  required before the decision lab may be scheduled.
- **Prototype behind evidence:** typed intent identity,
  provisional/canonical mapping, and semantic conflict presentation. Where
  these exceed Candidate A substrate they are Candidate-B-shaped, and
  B-shaped prototyping requires both a retained, owner-validated Candidate A
  inexpressibility result (a merely qualified A does not open B) and
  LLP 0129 OQ10's frozen Candidate-B boundary and owner.
- **Do not admit yet:** arbitrary app-authored client mutators, a generic
  client-side write transaction API, cross-query canonical-row
  normalization (until its projection-aware authority design exists), or
  any aggregate node (until its result and noninterference semantics are
  decided).
- **Do not import merely for parity:** PostgreSQL logical replication,
  `zero-cache`-shaped infrastructure, full-table replication, raw local SQL,
  client-owned authorization, or same-by-convention client/server business
  logic.
- **Amend owners rather than centralize implementation here:** this RFC owns
  the product direction and cross-cutting gates. Query grammar belongs in the
  LLP 0080/0110/0120 family; membership/semi-join visibility machinery in
  LLP 0100 (and LLP 0073 for search-adjacent shapes); local execution and
  settlement remain governed by LLP 0051/0129/0133; retention and replay
  remain governed by LLP 0043/0053/0090; React projection remains governed
  by LLP 0107/0114; wire additions remain governed by the LLP 0093 family's
  delegated Specs — LLP 0094 owns envelope shapes, LLP 0095 owns client
  lifecycle/conformance — with LLP 0034 owning the Contract provider seam
  specifically.

Acceptance of this RFC does not by itself promote a capability, change a wire
shape, or authorize Option C from LLP 0129. It also does not itself amend
LLP 0008 DK-9 or LLP 0129's phase order: it **commissions** the dated
amendments §Sequencing names, and until those land in their owning
documents, the owners' current text governs. Each shipping mechanism still
needs its owning Spec or RFC, implementation, capability facts, and acceptance
evidence.

## Authority and relationship to existing LLPs

This document exists because the evidence, program, and desired product
architecture currently live at different altitudes:

- **LLP 0138 is the evidence record.** Its immutable app receipts and diaries
  establish where Zero, Snapback, and the Replicache control did or did not
  perform well. This RFC does not rewrite its totals or upgrade GAPs to PASS.
- **LLP 0126 is the wider local-first research base.** It establishes the
  field's movement toward server-authoritative materialized state and the
  option space Snapback could pursue.
- **LLP 0127 is the parity/local-first synthesis.** Its move 3 identifies
  local re-execution as one use of Snapback's closed deterministic substrate.
- **LLP 0129 is the execution and admission authority.** Its phases, owner
  ledger, safety gates, and Option-C decision lab remain binding. In
  particular, this RFC does not convert LLP 0138's expressiveness pressure
  into an admission decision.
- **LLP 0133 owns settle-time trust.** Server re-derivation remains the
  default for locally produced application-visible values; client-captured
  values are labeled claims, not authority.
- **LLP 0008 and LLP 0053 own the durable sync and authorization posture.**
  Server authority, authorization-aware result sets, negative-delivery
  obligations, leases, and fail-closed retention are not reopened here.
  One named exception is proposed, not smuggled: Move 2 commissions a dated
  amendment to LLP 0008 DK-9's client-store semantic contract (and an
  LLP 0080 retention-class extension) as a deliberate new author decision —
  not as DK-9's SQL-specific revisit trigger firing, which LLP 0051 already
  answered without SQL (§Move 2, §Sequencing Stage 0).

Per-move authority at a glance (normative detail lives in each move and in
§Sequencing):

| Move | Design home | May start today? | Before it ships |
| --- | --- | --- | --- |
| 1 | LLP 0080/0110/0120-family successor Spec (OQ1) | Yes — read lane, LLP 0129's standing permission | Spec admitted; compositional completeness witness; Triage+Fleet gate |
| 2 | Same Spec + dated LLP 0008 DK-9 / LLP 0080 amendments | Yes — fragment baseline only | Amendments landed; standards-real carrier evidence; delta-egress guardrail held (defect closed 2026-08-02, lane refusal) |
| 3 | LLP 0051/0133 under LLP 0129 Phase 1 | Phase start needs its OQ5 owner/timebox; sizing spike + D5 are the evidence gate; advancement is author-presented while OQ8 pends | D5 both sides; lane-L landed via owner ledger; Kanban gate |
| 4 | LLP 0129 lab; Candidate A substrate where LLP 0133's mapping expresses it, else Candidate-B-shaped | A-substrate work under row 3's authority; B-shaped prototyping requires a retained, owner-validated A inexpressibility result under the exact protocol, plus OQ10's frozen boundary/owner | Lab report + owning design admits the extension; Calendar gate |
| 5 | LLP 0129 Option-C protocol | Not admitted | Exact A→B→C proof protocol; ER-1 dated author decision |
| 6 | LLP 0053/0133/0043 and peers | Standing constraint | Every stage's acceptance envelope |

With this RFC's acceptance (2026-08-02), Stage 0's reconciliation half
executed in the owning documents: LLP 0129 carries a dated cross-reference
that identifies moves 1–3 as the chosen product-direction consumers of its
program, records the read/write lane split against its existing
permissions, and records that its open sequencing questions
(OQ5/OQ7/OQ8/OQ10) remain the author's to answer under its own machinery —
no 0129 phase, gate, or standing decision is amended. This RFC remains
subordinate to the Accepted Plan on any conflict (§Sequencing).

## Vocabulary: realtime is not one capability

The phrase “realtime/local-first” hides distinct capabilities that must stay
separate in claims and tests:

- **Online realtime:** an authoritative initial result plus server-pushed
  changes while connected.
- **Local materialization:** query results represented in a client store that
  the UI reads reactively, whether or not those rows persist across restart.
- **Retained reads:** previously authoritative rows available after reconnect
  or restart, labeled with non-current freshness.
- **Optimistic presentation:** a tentative UI state layered over an
  authoritative base.
- **Local execution:** application mutation semantics run against bounded
  local data to derive the optimistic state.
- **Durable intent:** a mutation invocation persists across transport loss or
  restart until settlement or explicit terminal failure.
- **Rebase:** pending local mutation semantics re-run over a newer
  authoritative base before the combined state is revealed.
- **Offline authority:** the ability to make a final authoritative decision
  without a server. Snapback does not propose this for shared application
  data.

A product may be strong in one row and weak in another. Current Zero is strong
at local materialization and connected optimistic execution while explicitly
not supporting long-disconnected writes. Current Snapback has durable intent
and a narrower retained-read path but no JS-arm local mutation execution.
Replicache has durable local execution and rebase but leaves more protocol and
semantic duplication to the application.

## Background and evidence

### Current Snapback implementation

As of 2026-08-02, the relevant shipped local-target substrate is substantial:

- every commit advances a monotonic application version and writes the
  changes journal used for resume and live matching;
- live subscriptions return an authoritative initial snapshot and then
  receive ordered durable changes;
- the analyzable single-table subset with a schema-exact document contract
  can receive row-level `live_delta` operations (narrowed 2026-08-02 by the
  delta-egress fix), while ordered, relational, opaque, narrowed-contract,
  or otherwise ineligible queries take the conservative re-query plus
  `live_replace` path;
- reconnect/resume has fail-closed snapshot-digest and version-stream
  handling, with a full-resnapshot fallback;
- the JS/React client resolves a persistent RQS store by default, retaining
  eligible snapshots and exposing `retained` versus `current` freshness;
- the JS/React client has a durable, ordered outbox, exactly-once server
  settlement, retained settlement recovery, and authority-scoped
  acknowledgement custody; mutation identity is minted by the React
  optimistic path, while the raw JS `mutate` preserves and queues a
  caller-supplied `clientMutationId` and creates no durable outbox record
  without one;
- optimistic layers already recompute over the newest authoritative base and
  remove only the rejected layer; and
- protected retention, authority loss, revocation, and user switching have a
  stricter Contract-arm path built around leases and custody barriers.

The limitations are equally important:

- the JS/React arm retains only the `rqsEligible` subset: declarative,
  closed-input, authority-independent public queries; opaque JS queries never
  qualify, and ordinary protected JS-arm results do not cold-retain;
- a restart with queued intent renders verified retained rows in their
  **pre-intent** state. The queue is visible, but Snapback does not locally
  execute the mutation to reconstruct its speculative row effect;
- the browser/IndexedDB implementation exists, but the retained acceptance
  evidence does not yet certify a standards-real full browser-process crash
  and restart;
- the stable relational surface is a closed, exactly two-source equi-join
  with a unique joined side, bounded root window, and deliberately limited
  filter/projection grammar; and
- there is no first-class local query store over which application queries
  and optimistic mutations share one ordinary client read model (whether
  fragment-based or normalized).

The focused 2026-08-02 verification run supporting this draft — an
author-reported local run, not a retained receipt — passed:

- 26 `@expo/snapback-client` outbox/settlement tests
  (`node --test outbox-store.test.mjs`);
- 20 persisted-resume tests (`rqs-resume.test.mjs` over
  `rqs-resume-suite.mjs`), including non-eligible and auth-scoped refusal;
- the framework-neutral optimistic external-store suite
  (`external-store.test.mjs`);
- the React offline projection suite (`snapback-react/offline.test.mjs`);
  and
- the Contract offline replay suite
  (`snapback-contract/offline-replay.test.mjs`).

Both round-1 reviewers independently re-ran subsets of these suites (one
reproduced 26/26 and 20/20 exactly; the other's read-only sandbox blocked
the file-backed cases). This is useful code evidence, not a browser or
hosted product claim, and it carries no durable receipt.

### Current Zero model

Zero is generally available as of March 2026 (an externally sourced
as-of-date claim resting on the cited status page, not on any
corpus-recorded fact). Its author-facing center is a
normalized local client datastore reached by named, server-approved ZQL query
definitions. A query runs against local state immediately, obtains missing
authorized results from the server, reacts as materialized rows change, and
exposes whether the result is `unknown` or `complete`. Relationships,
filtering, ordering, limits, and nested result graphs compose in the query
language.

Zero mutators run first against the local datastore. The invocation then runs
through an application-owned server mutation endpoint against the
authoritative database; logical replication returns canonical row changes;
the client rolls back confirmed speculative effects and rebases remaining
pending mutations. Client and server implementations are often shared, but
the product permits them to differ.

The result is excellent connected interaction and authoring economy. It also
has boundaries Snapback should not erase:

- current Zero explicitly does not support offline writes after the client
  becomes disconnected/error/needs-auth; it is designed to bridge short
  connection interruptions, not long-disconnected authoring;
- query and mutation authorization is application code in the server
  endpoints rather than a Snapback-style first-class revocation/custody
  contract;
- client/server mutator equivalence is convention or shared source, not an
  execution identity proved by the platform; and
- self-hosting requires PostgreSQL logical replication, `zero-cache`, the app
  API, cache state, replication-slot identity, and their lifecycle.

Primary references at this draft's date:

- <https://zero.rocicorp.dev/docs/status>
- <https://zero.rocicorp.dev/docs/queries>
- <https://zero.rocicorp.dev/docs/mutators>
- <https://zero.rocicorp.dev/docs/connection>
- <https://zero.rocicorp.dev/docs/auth>

### Replicache as a design control

Replicache's repository was archived by Rocicorp on 2026-06-10 (verified
against the cited repository page during this document's 2026-08-02 review
loop) and is not the recommended current Rocicorp product. It remains the clearest published
reference for durable optimistic mutation and rebase:

- the application reads and writes an in-browser persistent key-value view;
- named client mutators apply immediately and persist pending mutation
  records;
- the server push endpoint executes corresponding authoritative mutations in
  client sequence order and advances last-mutation ids;
- pull supplies a canonical patch and confirmed mutation frontier; and
- the client rewinds to canonical state, applies the patch, re-runs remaining
  mutators, and atomically reveals the rebased view.

The model preserves server authority and supports application-specific
conflict behavior. Its cost is application ownership of push, pull, cookies,
poke, idempotence, server mutators, and the risk that client and server
implementations drift. Snapback should learn from its rebase lifecycle, not
adopt its protocol burden or arbitrary-JavaScript surface by default.

Primary references:

- <https://github.com/rocicorp/replicache>
- <https://doc.replicache.dev/concepts/how-it-works>

### The provider-native bakeoff

LLP 0138 implemented six paired React applications over Snapback and Zero,
plus a separate Replicache Field Notebook control. The retained primary totals
were Snapback 47 PASS / 3 GAP / 1 FAIL and Zero 46 PASS / 5 GAP / 0 FAIL; the
Replicache control retained 8 PASS / 3 GAP / 0 FAIL. Those counts are coverage
facts, never a composite score.

The application-level result was consistent:

| Application | Result that matters to this RFC |
| --- | --- |
| Triage Graph | Both were correct; Zero clearly won relational authoring and query-scoped custody. |
| Latency Kanban | Observable behavior tied; Zero's shared mutator removed duplicated optimistic transform code. |
| Contention Calendar | Zero made speculative creation natural; Snapback made the authoritative invariant and stable conflict clearer. |
| Private Incident Room | Both passed; Snapback made protected-result retirement and authority transitions more explicit. |
| Field Notebook | Snapback preserved disconnected intent better than Zero; Replicache retained the richest queue/rebase model. |
| Fleet Observatory | Zero made bounded partial materialization ordinary; Snapback's historical handler treated an implicit 1,024-row prefix as complete before application-side ordering. Snapback later fixed this fail-closed and passed the remediated receipt. |

The evidence supports a directional conclusion, not an architectural copy:

| Dimension | Current judgment |
| --- | --- |
| Composable relational local reads | Zero clear win |
| Connected optimistic authoring | Zero clear win |
| Completeness and custody inspection | Zero clear win |
| Online realtime correctness in the paired apps | Approximately tied |
| Authority, conflict, revocation, and settlement vocabulary | Snapback advantage |
| Durable disconnected intent | Snapback advantage over current Zero, with browser-proof and speculative-reconstruction gaps |
| Full durable local execution and rebase | Replicache reference advantage |
| Local operational simplicity | Snapback advantage |
| Current production maturity | Zero advantage; the bakeoff makes no hosted Snapback claim |

## Design principles

### P1. The UI reads one local materialization

Once hydrated, React should not care whether a row arrived through an initial
snapshot, live delta, retained boot, authoritative replacement, optimistic
execution, or rebase. Those origins change metadata and authority, not the
ordinary data-reading API.

This does not mean the states are equivalent. The same materialization must
carry explicit completeness, freshness, connection, authority, and settlement
facts so the application can distinguish them without maintaining parallel
row collections.

### P2. Queries, not tables, define custody

Snapback's replication unit remains the authorized query result, not a whole
table or arbitrary local database. A row is locally present because at least
one admitted materialized query requires it, an optimistic intent owns a
provisional value, or a bounded retention policy permits it. The inspector
must be able to explain that reason.

### P3. One authored operation before two

The default optimistic path derives client behavior from the same closed,
content-addressed mutation operation the server executes. Snapback should
exhaust the shared IR and narrowly typed subordinate extensions before asking
authors to maintain separate client and server mutation semantics.

### P4. Prediction is never authority

Immediate paint, local mutation completion, server mutation settlement, and
independent-observer convergence are separate states. A local result may be
useful without being canonical. The API and inspector must never collapse
these events into one “done” boolean.

### P5. Negative authorization changes are obligations

Revocation and query shrink remain durable obligations governed by LLP 0053,
not best-effort cache invalidation. A local store cannot make protected data
retainable merely because it is convenient to query locally. Authority change,
logout, user switch, expiry, and reconnect retain their existing barriers.

### P6. Stronger claims require stronger evidence

Memory-only or same-process tests do not prove crash/restart. Fake IndexedDB
does not prove a real browser carrier. Local correctness does not prove hosted
topology. A reconnecting client does not prove offline mutation. Every
capability fact must name the carrier, authority posture, target, and evidence
class it actually covers.

## Proposal: the six moves

## Move 1 — Bounded-node composition, completeness, and inspection

### Outcome

An author can express the Triage Graph inbox and Fleet Observatory route as
one generated, bounded, server-approved composite without manual collection
joins, whole-table client filtering, or application-side sorting of an
implicitly incomplete prefix.

The client receives a materialization plan plus a small public completeness
state, and the inspector explains the plan, admitted bounds, active query
membership, retained rows, hydration work, and authorization partition.

### Proposed query shape: composition of admitted bounded nodes

The read surface is **LLP 0120 option 3a's shape, grown deliberately**: a
generated composite statically invokes N admitted bounded plan nodes inside
one authoritative transaction at one snapshot. Each node keeps its own
declared bounds, visibility contract, refusal behavior, cursor, and
examined-entry ceiling; the composite carries a summed work ceiling, one
snapshot identity, and a result contract that is the tuple of its nodes'.
The admitted node vocabulary starts from what exists — `relational_query_v1`
(LLP 0080's closed two-source plan) and `bounded-children.v1` (LLP 0110) —
and grows node classes only through their owning documents:

- one bounded root window with declared index, filters, stable ordering, and
  keyset pagination (the existing admitted shapes);
- typed to-one and bounded to-many relationship nodes;
- nested projection over admitted relationship nodes;
- relationship refinements with their own filters, ordering, and limits,
  expressed as node parameters, not free predicates;
- membership/semi-join predicates only as admitted node classes whose
  visibility and invalidation are proved by their owners (LLP 0100's
  membership-addressed operations are the shipped ancestor; LLP 0073 for
  search-adjacent shapes);
- canonical args and a stable plan hash shared by codegen, server admission,
  live matching, result contracts, client materialization, and inspection;
- explicit capability classification for incremental delta, replace-only,
  retained, and online-only execution; and
- a closed reason whenever a requested composition exceeds the admitted
  vocabulary.

Any author-facing graph syntax is **compilation sugar over this algebra**:
it compiles to admitted nodes or refuses with a closed reason. No new
predicate or traversal vocabulary, and no data-dependent node invocation,
enters through the syntax layer — a shape the algebra cannot express is a
new node-class proposal to the owning document, not a composite.

**Aggregates are deferred — including `count`.** LLP 0120 records five
distinct aggregate result semantics (with overflow, empty-group, and
admitted-range behavior) and an unresolved noninterference obligation for
aggregates over protected rows. Zero itself ships no aggregates today (its
documentation lists count/min/max/group-by as non-committed future work;
externally sourced, verified against the cited queries page 2026-08-02),
so no aggregate is a "copied Zero outcome" this RFC can claim. Aggregates
enter, if at all, as a separately admitted node class after their result
semantics, invalidation story, and protected-source noninterference are
decided by the LLP 0080/0110/0120 family.

The composition semantics LLP 0120 names as open are design obligations of
the owning Spec, not silently inherited defaults: cursor coordination
across nodes (independent per-node resume undermines the one-snapshot
read), partial refusal (this RFC recommends 0120's evidence-clean answer —
one sealed node seals the composite), shared-parent authorization
deduplication, and the composite's own result identity and live
classification.

The authoring altitude should approach Zero's ordinary query composition:
declare a query shape and use it. Stronger guarantees may require additional
facts, but ordinary analyzable queries should not require authors to restate
dependency summaries the compiler can derive.

### Completeness model

The public query result state should be small:

- `unknown`: useful local rows may be present, but the client has no proof the
  query is complete at the requested authority/version;
- `complete`: the server has established the full admitted result for this
  query plan and args at a named version;
- `prefix`: reserved until a plan proves the local rows are the stable prefix
  of the full result; never inferred from hitting an implementation cap;
- `refused`: the query cannot establish its promised class, with a stable
  reason and safe fallback where one exists.

Completeness is orthogonal to `freshness: retained | current`, connection
state, and settlement. A retained complete result from version V is complete
*as of V* but is not current while disconnected.

**The witness must be compositional.** `complete` for a composite binds to
at least the plan hash, canonical args, authority partition, query
instance/generation, snapshot version, and the full set of nodes the plan
declares. A composite is `complete` only when every declared node was
established at **one common authoritative snapshot**; independently
hydrated nodes at skewed versions may not be assembled into an apparently
complete result — that state is `unknown`, however individually
authoritative the fragments are. Advancing one nested cursor, changing one
node's args, or invalidating one node's membership returns the composite to
`unknown` until re-established. If a weaker per-node completeness state is
ever wanted, it ships as its own labeled state, never as `complete`.

### Inspector

The inspector's owning surface is an open design question (this RFC's OQ11):
it overlaps LLP 0017's admin console inspection surface on the server side
and requires a client-side artifact for local materialization state; the
Move 1 owning Spec must name whether it is one surface or two. Whatever the
split, the inspector must answer, for every active or retained query:

- which generated query, args, plan hash, app/deployment, and authority
  partition own it;
- whether it is unknown, prefix, complete, or refused and why;
- which rows are materialized and which query memberships retain each row;
- which indexes, bounds, joins, and aggregate ceilings the plan uses;
- the snapshot/current version, resume state, and hydration byte/row counts;
- whether updates use delta, replacement, or forced resnapshot;
- which authorization dependencies and negative-delivery obligations apply;
  and
- which pending intents currently affect its presentation.

### Guardrails

- No arbitrary SQL or arbitrary client-supplied query AST reaches storage.
- No implicit implementation cap can be presented as complete.
- No client-side join may require custody of source rows the query result is
  not authorized to expose.
- No aggregate node exists until its result semantics, invalidation story,
  and protected-source noninterference contract are decided by the owning
  family; no aggregate ships without all three.
- No relationship plan widens visibility relative to any source.
- No author-facing syntax admits a predicate, traversal, or data-dependent
  invocation the node algebra cannot express.

### Acceptance gate

Move 1 has an explicit interim milestone: the fail-closed completeness half
(`unknown`/`complete`/`refused`, no implicit-cap prefix — partially landed
already as `SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED`) ships on the existing
LLP 0080 grammar before the composition Spec lands, so the Fleet lesson's
protection does not wait for the long pole.

Move 1 exits only when fresh provider-native implementations of Triage Graph
and Fleet Observatory prove:

- the required screens use generated composites rather than JS collection
  joins;
- the client retains only the desired bounded query results;
- pagination has no duplicate or skipped untouched root;
- 20 query changes leak no predecessor rows;
- the 250,000-event fixture converges exactly the 100 active matches from the
  1,000-update burst;
- an implicit incomplete prefix is impossible to consume as complete;
- Mallory receives no protected source or result rows; and
- the inspector explains every retained row and every completeness transition.

## Move 2 — First-class query-scoped local materialization

### Outcome

First-party clients share one **query-result materialization vocabulary**
— the same store contract, witness states, and inspection facts — as the
ordinary read substrate, with arm-specific admitted authority and retention
profiles: whether the stricter Contract-arm custody path exposes an
identical materialization contract or a deliberately narrower one is open
(OQ16), and this move does not promise identical first-party semantics
before that is reconciled. Reactive hooks subscribe to queries over the
store; network hydration and server push update it in the background.
Retained reads and optimistic layers compose with the same materialization
instead of living in application-owned parallel arrays.

### Store model: fragments first, normalization gated

The **admitted baseline** is opaque query-result fragments plus witnesses —
a deliberate extension of what LLP 0008 DK-9 and LLP 0080 already admit,
not a silent replacement of them:

- opaque authorized result fragments keyed by plan hash, canonical args,
  authority partition, and query instance/generation;
- per-query membership, completeness, freshness, version, resume, and
  retention facts;
- provisional entities keyed by typed intent identity, never by forged
  canonical id;
- ordered optimistic layers with their producing mutation identity;
- durable outbox and retained settlement records through the existing store
  contract; and
- authorization/custody metadata sufficient to execute existing deletion,
  quarantine, expiry, and user-switch barriers.

**Cross-query canonical-row normalization — one stored row value shared by
every query that projects it — is a gated upgrade, not the baseline.** It
requires an authority model this RFC deliberately does not settle: two
queries may authorize disjoint projections of the same row, sit at
different versions, or lose one membership to revocation while the other
survives. A single whole-row value therefore needs field/projection
provenance, merge and version-reconciliation rules, per-membership deletion
and quarantine behavior, and proof that the shared row creates no local
existence or field oracle across authority partitions. Those semantics
belong to the Move 1/2 owning Spec (OQ2 names the decision); until it
admits them with adversarial-projection evidence, no cross-query row
sharing ships. Under normalization, if admitted, a canonical row shared by
two queries has one stored value and two membership reasons; removing one
query does not remove the row while another membership or pending intent
owns it, and removing the last authorized membership never overrides an
LLP 0053 deletion obligation or lease deadline.

**This move commissions dated amendments to LLP 0008 DK-9 and LLP 0080's
retention class, and says so.** DK-9 pinned the client store as "a
document/result cache plus an outbox, not a relational replica," and
LLP 0080 v1 admits only `opaque-authorized-snapshot-v1` retention — never
local re-execution over retained rows, never custody of unprojected joined
rows. The fragment baseline stays inside that envelope; local plan
evaluation over fragments (§Query execution) and any normalization upgrade
do not, and both require dated amendments to their owners.

The amendments are a **deliberate new author decision, not DK-9's revisit
trigger firing.** The trigger's exact text is SQL-specific — "if
parity-class offline execution (local handler replay) ever requires query
capabilities the interface cannot express without SQL — reopen with that
evidence rather than mandating SQLite pre-emptively" — and LLP 0051 has
already adjudicated it in the other direction: parity-class execution
arrives via the IR, so the store interface needs no SQL semantics, and
0051 itself commits to one narrow client-side query-evaluation site (IR
filters/order over cached rows for widget refresh). This RFC affirms both:
it proposes no SQL, and it asks the owners to widen the store's *semantic*
contract (fragment plan evaluation; possibly normalization) as new policy
justified by the bakeoff's read-path evidence, not by the old trigger.
Until those amendments land, the owners' current text governs.

### Query execution

Generated query plans should run over the local store when the required data
is present. The same plan evaluator, or two evaluators under a conformance
corpus, must produce the same canonical result ordering and projection as the
server. A local result reports `unknown` until completeness is proved; local
execution is never permitted to infer missing relationship rows are absent
when they may simply be unhydrated.

> **Dated note (2026-08-03, with LLP 0166's acceptance):** the Move-2
> owning Spec revises this section's commissioned outcome as a
> deliberate scope ruling. V1 local evaluation is LLP 0166 §D7's closed
> `result-transform.v1` profile: the plan's own established result,
> transformed (filter/order/limit over projected fields under a frozen
> total comparator, with optimistic-overlay composition as a client-side
> step), with a dual-runtime reference implementation of the pure
> transform as the parity target. This section's "generated query plans
> should run over the local store … the same plan evaluator, or two
> evaluators under a conformance corpus" is deliberately deferred, not
> implemented: a retained fragment is post-projection output, and
> evaluating plans over source rows locally requires the cross-query
> normalization and projection-aware authority design this RFC's OQ2
> gates. That fuller outcome remains reachable through OQ2's gate as a
> successor amendment; the "same canonical result ordering and
> projection" obligation applies to the transform's reference
> implementation in the meantime. Nothing else in Move 2 changes.

### Storage profile

Move 2 is also the largest client-architecture commitment since the
LLP 0145 client-bundle research; its owning Spec must state how the
materialization lands within (or revises) 0145's bundle conclusions so the
two documents do not fork.

The physical carrier remains store-agnostic under LLP 0008 DK-9's carrier
decision (the *semantic* extensions are the dated amendments named above):

- browser: IndexedDB or a successor browser-native durable implementation;
- Expo/native: the registered filesystem/SQLite-capable carrier once its
  durability and locking facts are qualified;
- Node/desktop: file or SQLite-backed carrier;
- memory: explicit volatile degradation for tests and unsupported platforms.

The public semantics must not depend on a particular store engine. A target
that lacks durable storage may still provide online local materialization, but
must report that retained rows and durable intent are unavailable.

### Guardrails

- Query-scoped custody, not whole-table replication, remains the default.
- The client cannot broaden a server-approved query.
- A local query never upgrades `unknown` to `complete` from row-count
  coincidence.
- Store ingestion admits only contract-validated frames. The delta-lane
  egress defect that motivated this guardrail (`live_delta` fan-out
  bypassing the result-contract validation the re-query path performs) was
  closed on 2026-08-02 by lane refusal — delta candidacy now admits only a
  schema-exact `documents(table)` contract, with every other contract shape
  taking the validated re-query + `live_replace` path
  (`issues/closed/20260801-live-delta-frames-bypass-result-contract-validation.md`,
  regression in `crates/snapback/tests/live_delta_v0.rs`). That resolution is a worked
  example of exactly this guardrail's fail-closed posture — refuse the
  lane rather than trust the frame. The obligation survives the ticket: if
  delta candidacy is ever re-widened (e.g., per-operation validation), the
  Move 1/2 owning Spec carries the adversarial ingestion case and it must
  re-run before frames from the widened lane may be durably retained.
- Auth/artifact/authority identity mismatch quarantines or deletes before the
  new identity can observe predecessor state.
- Client-store migrations preserve pending intent or fail closed; they never
  silently acknowledge it.

### Acceptance gate

Move 2 requires standards-real carrier evidence, not only fake stores:

- browser process terminate/relaunch over real IndexedDB;
- two tabs sharing and contending over one browser profile;
- file/native process terminate/relaunch;
- retained render while the server is unreachable;
- logout, user switch, revocation, lease expiry, artifact change, and corrupt
  store recovery;
- bounded custody under query churn;
- if canonical-row normalization is admitted: the adversarial projection
  case — two queries authorize disjoint fields of one canonical id, one
  authority is revoked while the other remains, and the surviving query
  observes no revoked field and no existence oracle; and
- byte/row footprint and hydration measurements on Triage and Fleet fixtures.

## Move 3 — Shared mutation IR for local prediction and server authority

### Outcome

An ordinary mutation is authored once. A browser-safe evaluator runs its
closed, content-addressed IR against the bounded local materialization to
derive an optimistic layer. The authoritative server independently executes
the same operation identity against current server state and settles through
LLP 0133. Authors do not write a second reducer for the common path.

This is the Snapback-native route to Zero's best authoring outcome. It is
also the write lane's entry point: this move is LLP 0129 Phase 1 work and
starts under that phase's own machinery (§Sequencing), never on this RFC's
authority alone.

A payoff independent of the Move 5 decision: IR replay at boot over the
Move 2 durable store — pure Candidate A machinery — is expected to close
the known restart-renders-pre-intent-state gap (§Background), because a
restarted client can re-derive the speculative row effect of queued intent
instead of rendering verified retained rows in their pre-intent state.

### Execution contract

Candidate A from LLP 0129 is the required first implementation:

- the generated mutation IR is the only authored write operation;
- codegen emits the exact operation hash, schema identity, effect ceiling,
  local-read requirements, and capability class;
- the local evaluator can read only the materialized rows admitted by the
  operation and write only a private optimistic layer;
- deterministic host answers are recorded as labeled claims; the server
  re-derives application-visible values under LLP 0133;
- the server executes against current authoritative state with all ordinary
  authorization, constraint, OCC, and settlement rules;
- authoritative delivery replaces the base, confirmed effects bridge until
  matched, rejected effects splice out, and remaining pending operations
  replay in sequence; and
- unsupported IR operations refuse at build/admission with a closed reason,
  never silently fall back to a handwritten optimistic reducer while claiming
  same-operation parity.

### Local-read admission

A locally executable mutation must declare or derive the exact data it may
need. The candidate should distinguish:

- `ready`: every required local read is complete for the operation;
- `predictable-with-partial-input`: the operation has an explicitly admitted
  conservative prediction that does not mistake missing for absent;
- `server-only`: local data is insufficient or the operation uses a
  non-local capability; and
- `refused`: the operation's declared local class and actual plan disagree.

Server-only is a valid degradation. The client may show pending intent without
fabricating a row effect. The authoring API should make that result ordinary
and inspectable.

### Rebase

When a new authoritative base arrives:

1. atomically install the authoritative rows and memberships;
2. retire confirmed layers according to settlement/delivery identity;
3. re-run remaining IR mutations in local sequence order against the new
   visible base;
4. record any changed prediction or local refusal as an explicit rebase
   outcome; and
5. reveal the recomputed view atomically to subscribers.

Rebase is presentation and conflict discovery, not server settlement. A local
branch can never commit authority.

### Guardrails

- Phase 1's browser evaluator must pass LLP 0051 D5 on both server and browser
  at pinned identities before it can make a same-code claim.
- The local runtime has no network, filesystem, secrets, arbitrary timers,
  actions, or ambient auth authority.
- Schema/artifact/execution-identity mismatch refuses or quarantines; it never
  runs “close enough” code.
- Local latency is measured separately from server acknowledgement and
  independent-observer convergence.

### Acceptance gate

Latency Kanban is the common-path witness:

- create, edit, assign, archive, and reorder paint from generated IR with no
  application-authored duplicate transform;
- 20 rapid moves preserve unrelated layers and lose or duplicate no card;
- a locked-card rejection removes only its own prediction and carries a stable
  app error;
- concurrent moves converge deterministically;
- reload during pending settlement is loss-free; and
- source identity, local evaluation, server settlement, and observer
  convergence are separately receipted.

The generated-mutation-IR exit is also a deliberate bundle workload-version
change under LLP 0063 and LLP 0145. Its first attributed run freezes a new
prospective ceiling for exactly the Full/root profiles whose closure now
contains generated mutation execution; every unaffected profile remains
bound to its prior ceiling, and the predecessor receipt remains immutable.

## Move 4 — Typed optimistic creation and intent reconciliation

### Outcome

An optimistic create participates in ordinary query-derived filtering,
ordering, counts, relationships, and React rendering before the server mints
its canonical id. "Counts" here — including the Calendar gate's availability
counts — means a client-derived cardinality over an already-complete bounded
local result (a presentation over Move 1/2 state), **not** an admitted
aggregate node — which is also what lets LLP 0129's frozen Calendar
count-lifecycle fact be satisfied without one; if a workload ever
demonstrates a shape that needs a real aggregate, that decision belongs to
LLP 0130 SD-2's standing branch, not to this move. Settlement maps the intent exactly once to the canonical row
or removes it with an actionable typed refusal. The application does not
maintain a parallel pending collection and does not forge a canonical id.

### Identity model

The model requires two distinct identities:

- **intent identity:** client-minted, durable, authority/artifact-scoped, and
  stable across replay and restart; and
- **canonical row identity:** server-authoritative, typed, and never claimed
  by the provisional row before settlement.

The local store represents a provisional reference as its own type. Query
projection may include it wherever the UI can safely render an unsettled
entity, but code requiring a canonical reference cannot consume it. Server
settlement returns the logical-mint mapping governed by LLP 0133; equal counts
or call order are never enough to guess a mapping.

On settlement:

- one successful intent maps to at most one canonical row;
- duplicate delivery returns the same mapping;
- a mapping mismatch or collision fails closed;
- related pending operations retarget through the typed mapping only where
  their contracts permit it;
- authoritative delivery retires the bridge without duplicate rendering; and
- rejection removes the provisional row and exposes the declared error and
  conflict payload.

### Admission boundary

This is Candidate-B-shaped work under LLP 0129 — an experiment inside that
Plan's lab, not an independent product move. LLP 0129 permits implementing
Candidate B **only after Candidate A has a retained, owner-validated
inexpressibility result** under the exact proof protocol (Move 5) — a
merely conformant or "qualified" A does not open B — and the lab cannot
adjudicate B before LLP 0129 OQ10 is answered: Candidate B currently has no
frozen semantic boundary (typed inputs/outputs, allowed computation and
effects, composition rules, the duplicated-mutation-semantics prohibition)
and no adjudicating owner. Both gates precede any B-shaped Move 4
prototyping as lab evidence — this RFC deliberately adopts the
conservative reading of LLP 0129's prototype/implement distinction,
treating any B-shaped prototype as B implementation. If Candidate A plus LLP 0133's logical-mint mapping can express
the typed provisional reference (this RFC's OQ7), Move 4 arrives as
Candidate A substrate and no B extension is involved. LLP 0133's
already-required lane-L logical-mint mapping remains shared substrate and
is not blocked; the new public authoring and query composition surface is
what requires admission.

### Acceptance gate

Contention Calendar must prove:

- the provisional reservation appears in the same typed query as canonical
  reservations;
- filters, ordering, availability counts (client-derived cardinalities over
  complete bounded results, per §Outcome), and relationships include it
  under explicit provisional semantics;
- two clients contend for the last slot and exactly one canonical transaction
  commits;
- the winner maps once, the loser corrects visibly, and neither duplicates;
- ambiguous redelivery is idempotent; and
- every observer converges on authoritative capacity and order.

### Dated implementation record — 2026-08-10

Move 4's first-class local-target React surface shipped as
`useSnapbackOptimisticCreate` over the existing Candidate A generated
local-executable `Insert` carrier and LLP 0133 settlement map. This answers OQ7
for the admitted single-insert shape: the public provisional identity is the
durable `clientMutationId` under a distinct generated `ProvisionalId<Table>`;
the speculative row mint remains private, and the server's logical-mint
`idMap` retires the bridge. No Candidate B computation or second authored
mutation transform was added.

The package proof covers shared filter/order/count/relation projection,
response-before-query and query-before-response settlement, overlapping
rejection, authority cuts, Strict Mode/HMR sharing, and cleanup. The existing
real-server provider conformance gate drops a response after authoritative
commit, replays the exact protocol identity, recovers the identical `idMap`,
and renders one canonical entity. The capability claim is therefore the
narrow local React provider shape only; related-operation retargeting and
broader generated IR shapes remain outside this landing.

## Move 5 — Replicache-class app-authored mutators only after proof

### Outcome

Snapback makes an evidence-backed decision about app-authored client mutators
instead of importing them because Zero or Replicache has them.

The current answer remains **not admitted**.

### Decision order

The LLP 0129 lab runs candidates in increasing authority and drift surface:

1. **Candidate A:** shared IR only;
2. **Candidate B:** IR plus narrowly typed subordinate extensions; and
3. **Candidate C:** app-authored client mutator over a bounded local query
   store, with independent server execution.

One valid A implementation that passes every frozen workload defeats the
claim that app-authored mutators are necessary. Candidate B begins only after
retained, owner-validated proof that A lacks a required primitive. Candidate C
begins only after B has the same class of retained inexpressibility result.

### Admission bar

LLP 0129's proof protocol applies exactly as that Plan states it, and
**LLP 0129 remains the sole normative protocol text** — the bullets below
are an illustrative digest of its controlling rules, applied separately for
Candidate A and Candidate B, and never substitute for it. The Plan's rules
this digest does not restate remain equally binding: the minimum
builder-role assignment and diary blindness, Candidate B's preregistered
coherence ceilings, ordering-bias handling, and the complete eight-class
misattribution log ({IR-inherent, pin-collision, missing shared mechanism,
candidate-implementation defect, harness/evidence defect, environmental,
ambiguous frozen fact, unresolved} — "unresolved" is an allowed terminal
state never resolved toward detection by default, and a correctly
classified pin collision — where the lab records that Candidate A could
express the fact under a relaxed presentation policy — disposes as a
proposed dated amendment to the owning document, not as trigger
detection). The digest:

- **One valid implementation defeats the claim.** If either builder
  produces a candidate that passes the fact within the gates, the fact is
  expressible — full stop, regardless of the other builder's failure or its
  difficulty.
- **Both independent attempts must fail the same fact**, in separate source
  trees, with per-builder × per-workload × per-attempt evidence sealed
  before the diaries are compared. A single failure is a builder result,
  not a language result.
- **The failure must name the missing primitive** — which admitted IR or
  profile capability would have expressed the fact — and the relevant owner
  (LLP 0051 for IR/conformance, LLP 0080/0110 for profiles) must validate
  that classification. An unnamed "we couldn't find a way" is not a
  finding.
- **Candidate B receives the same two-attempt standard** before Outcome 3
  may be recommended — which also requires OQ10's frozen B boundary and
  owner to exist first.
- **Outcome 0 — no recommendation — is a real outcome.** A gap classified
  into any non-IR-inherent class of the misattribution log above is not
  trigger detection; the lab records Outcome 0, the current authority
  decision stands, and a rerun requires the named change plus a fresh
  dated owner/timebox record. If evidence is mixed, retain the current
  decision; uncertainty never defaults to the more powerful authority
  surface.

Candidate C may then be recommended only if additionally:

- C passes every common safety gate, not only the workload that blocked B;
- the improvement is material in product behavior or authoring, not merely a
  small line-count or micro-latency win;
- its deterministic inputs, local powers, rebase lifecycle, schema/version
  fencing, diagnostics, custody ceiling, and claim vocabulary are closed; and
- the author records a dated admission decision under LLP 0130 ER-1.

### Required discriminator

Field Notebook supplies the discriminator:

- queue create and update while authority is unreachable;
- terminate the real browser process;
- restart from durable state and show retained plus speculative state with
  distinct labels;
- receive a concurrent remote edit;
- rebase or surface a typed semantic conflict with enough application data to
  resolve it; and
- settle exactly once without losing or duplicating intent.

A same-session memory demonstration, fake-store-only run, application-owned
draft sidecar, or server-only retry does not satisfy this fact.

## Move 6 — Preserve Snapback's stronger boundaries

Move 6 is the cross-cutting acceptance envelope for moves 1–5.

### Preserve server authority

- Clients predict; servers accept, reject, order, and commit.
- Local queries cannot widen server-approved results.
- Local mutation code cannot declare settlement or bypass server invariants.
- Trusted time, canonical identity, permissions, uniqueness, OCC, and external
  effects remain server decisions.

### Preserve authorization and custody

- Query materialization remains authority-partitioned.
- Negative authorization changes remain durable obligations.
- Protected retention requires the declared dependence and lease machinery
  its owning LLPs demand.
- Logout, user switch, revocation, lease expiry, and artifact change retain
  fail-closed deletion/quarantine barriers.
- No local-store feature claims hostile-device byte erasure.

### Preserve settlement and conflicts

- Client mutation identity remains durable and exactly-once at the server.
- Local paint, call settlement, authoritative delivery, and observer
  convergence remain separate facts.
- Stable platform conflict codes and declared application refusal unions
  survive the local path without message parsing.
- A receipt-less ambiguous result stays pending unless application idempotency
  proves another safe disposition.

### Preserve bounded work and portability

- Every query and locally executable mutation has an admitted work/custody
  ceiling or an explicit weaker class.
- No design depends semantically on PostgreSQL logical replication, browser
  IndexedDB, SQLite extensions, or one React runtime.
- Target capability artifacts say which query, store, execution, retention,
  and conflict classes exist.

### Preserve the small operating model

Snapback should not add a mandatory cache service, replication slot, or second
application API tier merely to reproduce Zero's client API. Hosted targets may
choose different physical machinery, but the local target keeps one small
Snapback server and generated client artifacts as the paved path.

## Sequencing

The moves are not six independent projects, and this RFC does not own a
global schedule: **LLP 0129's Accepted phase machinery is the write lane's
schedule, and this section maps onto it rather than replacing it.** On any
conflict between a stage below and LLP 0129's phases, gates, or standing
decisions, LLP 0129 wins until a dated amendment lands there.

### Stage 0 — Authority reconciliation and baseline freeze

The reconciliation half (the part this RFC's acceptance commissions as
dated amendments in their owners):

- add the dated LLP 0129 cross-reference naming moves 1–3 as the chosen
  product-direction consumers of its program, and record there whether its
  open sequencing questions need amendment;
- put the read/write lane split on LLP 0129's record: the read lane
  proceeds under its existing "does not wait for this decision" permission;
  the write lane keeps IR-rung-first resourcing, the Phase 1 sizing-spike
  and D5 gates, the pending OQ8 scope-change escalation, and OQ5's named
  owner and timebox;
- commission the LLP 0008 DK-9 amendment and LLP 0080 retention-class
  extension that Move 2's fragment evaluation requires (§Move 2) — as a
  deliberate new author decision; DK-9's SQL-specific revisit trigger was
  already answered by LLP 0051 without SQL and is not claimed here; and
- record the Candidate-B boundary/owner requirement (LLP 0129 OQ10) as a
  prerequisite to Move 4 prototyping.

The freeze half:

- retain LLP 0138's immutable receipts;
- record current client/store bundle, carrier, and target identities;
- freeze the **read-lane successor manifests** — Triage and Fleet — for
  moves 1–2 evidence, and freeze **Incident Room as this RFC's own named
  product-direction safety-control manifest** alongside them: LLP 0129's
  lab freezes exactly three workload manifests (Kanban, Calendar, Notebook)
  and does not name Incident Room; it is this RFC that elects the bakeoff's
  protected-retirement/authority-transition witness as the safety control
  for every candidate (write rung 3), so its freeze home is here, and the
  dated LLP 0129 cross-reference should propose registering it as a named
  safety-control artifact there. The three write-lane workloads (Kanban,
  Calendar, Notebook) are **LLP 0129 lab manifests**: they freeze under
  that Plan's own protocol (owner/timebox before its manifests freeze;
  baseline changes only through its dated refreeze/rerun rule), not here.
  If product-direction evidence ever wants its own copies of those
  workloads, they are separate named artifacts that cannot substitute for
  lab manifests; and
- establish standards-real browser automation before making new restart
  claims (which also bears on LLP 0129 OQ7's browser-witness half; the
  cross-reference should say whether it answers it).

Implementation note (2026-08-02): the Stage 0 evidence runner uses the
repository's shared Chrome/CDP process owner. That owner accepts an explicit
caller-retained profile for exact-profile relaunch and an explicit `SIGKILL`
first leg, but it continues to own the debugging port, process-tree
attestation, and signal delivery. A retained profile is removed only by the
evidence runner after both attested process exits; ordinary acceptance callers
keep the launcher's create-and-remove profile lifecycle.

### The read lane (moves 1–2) — may run now

Run Move 1's composition-algebra design and Move 2's fragment-store
contract together. The algebra defines what can be materialized; the store
proves how membership, completeness, and custody compose. The inspector is
part of this lane from the start, not a later debugging accessory, because
its data model forces hidden state to become explicit. The delta-egress
guardrail's standing regression obligation (§Move 2 guardrails; the
motivating defect closed 2026-08-02) lives in this lane.

This lane is also deliberate substrate-bounding for the write lane: it
lands the browser store and presentation slice of the substrate LLP 0129
OQ8 names, so that an eventual Candidate A failure can be attributed to
the IR rung rather than to missing implementation; the write lane's rung 1
items (lane-L settlement and id mapping, partial-read admission,
schema/identity fencing, receipt projection) remain OQ8's other half. The
Stage 0 cross-reference should offer the read-lane slice as evidence
toward closing OQ8.

Triage and Fleet are the exit applications.

### The write lane (moves 3–5) — LLP 0129's phases, unmodified

**Write rung 1 (= LLP 0129 Phase 1).** Implement Move 3 over the bounded
query/store substrate and the settlement design LLP 0133 owns — an
Accepted Spec, not landed machinery; landing its lane-L receipt/mapping
mechanics under the LLP 0129 owner ledger is part of this rung's work, not
its precondition. Start with point and indexed-set operations needed by
Kanban; refuse missing local inputs rather than adding unbounded client
reads. Kanban is the exit application; the rung starts and exits under
Phase 1's own gates.

**Write rung 2 (= lab prototyping under the freeze).** Prototype Move 4
inside LLP 0129's decision lab. If it is expressible as Candidate A
substrate (OQ7), it proceeds under rung 1's authority; as a Candidate-B
extension it begins only after Candidate A has a retained, owner-validated
inexpressibility result and OQ10's Candidate-B boundary and owner are
frozen. Do not ship the public extension merely because its substrate
mapping exists. Calendar is the exit application.

**Write rung 3 (= the Option-C decision protocol).** Run Move 5's A→B→C
protocol only when LLP 0129's prerequisites, owner, and timebox are
satisfied. Outcome 0 — no recommendation — is a real result; the program
is not required to admit app-authored mutators. Notebook is the
discriminator. Incident Room — frozen in Stage 0 as this RFC's named
product-direction safety-control manifest — re-runs as the authority
safety control for every candidate.

### Graduation — hosted, carriers, packaging

Only after local/browser correctness:

- qualify Expo/native and desktop carriers;
- run reconnect-storm and fan-out measurements;
- bind hosted topology and multi-instance delivery to their own target
  capability facts; and
- measure the **Full** client's local-sync feature and bundle attribution.
  LLP 0147's Micro v1 explicitly excludes RQS, retained reads, the durable
  outbox, offline replay, optimistic settlement, and local execution;
  applications needing them select Full until a separate local-sync Micro
  module is proposed and graduated through an LLP 0147 amendment or
  successor design with its own evidence. The current Micro profile is not
  this direction's packaging vehicle.

## Measurement and evidence

No composite score decides this RFC. Product-outcome measurements and
mechanism measurements are reported separately: "authors write one query
and one mutation" is testable independently of whether the client stores
fragments or normalized rows, and a mechanism change must not silently
launder a product-outcome claim (or vice versa). Each stage reports:

- capability support and explicit GAPs;
- correctness and security witnesses;
- authored source/touch count;
- input-to-local-paint latency;
- local evaluation time;
- server acknowledgement time;
- authoritative client convergence time;
- independent-observer convergence time;
- hydration rows/bytes and time to first useful rows;
- time to authoritative completeness;
- retained-store and outbox bytes;
- query churn and predecessor leakage;
- server matcher/re-execution/fan-out work;
- browser memory and bundle attribution; and
- setup, cleanup, and owned runtime resources.

Minimum evidence classes:

- deterministic headless unit/conformance for evaluators and state machines;
- real local server integration for wire, settlement, auth, and live delivery;
- real browser process crash/restart over standards-real storage;
- multi-tab browser coordination;
- Expo/native process restart on a qualified carrier;
- adversarial authority transitions and protected-result retirement; and
- exact-fixture large-query evidence for Fleet-scale claims.

Every immediate-paint scenario also proves acceptance or rejection, rollback
or rebase, and final observer convergence. Every protected scenario proves
non-delivery at the store/wire boundary rather than React-only hiding.

## Alternatives considered

### Copy Zero wholesale

Rejected. Zero's normalized local query experience and shared mutator outcome
are desirable; mandatory PostgreSQL logical replication, app-owned query/
mutation endpoints, and same-by-convention semantics are not required to
achieve them and would weaken Snapback's target portability and operating
model.

### Adopt Replicache's arbitrary client mutators now

Rejected pending LLP 0129's lab. It would buy expressiveness before measuring
whether Snapback's shared IR can cover the required workloads, introducing a
second authored authority surface and permanent drift cost prematurely.

### Keep current server-result cache plus application optimistic reducers

Rejected as the strategic endpoint. It preserves the safety model but retains
the exact daily gaps the bakeoff exposed: manual relational assembly,
duplicated optimistic transforms, pending sidecars, weak completeness
visibility, and no durable speculative reconstruction.

### Replicate whole tables or the whole SQLite database

Rejected as the default. It broadens custody beyond the query result, does not
solve protected partial replication, makes completeness deceptively easy to
claim, and bypasses the declared query artifact shared by authorization,
matching, OCC, and inspection.

### CRDT core

Rejected for ordinary application data. It does not remove application
invariants or authorization conflicts and weakens the server-authoritative
posture the broader research supports. A separately specified collaborative
text lane remains compatible with this RFC.

### Do nothing

Rejected as the recommended direction. Snapback's existing substrate would
remain inaccessible through the client experience agents and React authors
actually score, while Zero's clearest advantages sit exactly in that daily
surface.

## Risks and counterweights

### The composition algebra becomes a second database language

Counterweight: keep it closed, small, capability-classified, and driven by the
six frozen applications. Prefer composable primitives with shared evaluators
over one builder per diary pattern. Require a plan inspector so semantics do
not become opaque codegen magic. Adopt an explicit stop rule: the owning
Spec pins a maximum admitted node vocabulary and a cumulative
design/work budget, and exceeding either forces the program to reconsider
the composition thesis rather than growing the language by increments.

### The local store becomes an accidental full replica

Counterweight: query-membership ownership, TTL/retention policy, custody
ceilings, per-row explanation, and large-fixture tests that inspect bytes and
rows rather than trusting request syntax.

### Two evaluators drift

Counterweight: one canonical plan encoding, shared canonical comparison and
ordering semantics, cross-runtime D5-style conformance, corpus-generated cases,
and debug/test assertions comparing local application against fresh server
execution.

### Optimistic APIs obscure authority

Counterweight: distinct local/server/delivery/observer states, typed intent
identity, stable settlement records, and UI examples that display pending and
conflict states rather than treating promise fulfillment as canonicality.

### Protected data persists too broadly

Counterweight: preserve LLP 0053's retainability implication and lease/barrier
machinery; require adversarial logout, revocation, expiry, and user-switch
evidence for every new carrier and store profile.

### The evidence program blocks ordinary progress

Counterweight: the read lane (moves 1–2) proceeds now under LLP 0129's
standing permission, and move 3 proceeds under Phase 1's own machinery
rather than waiting for the decision lab. Only the authority-expanding or
app-extensible surfaces in moves 4–5 wait for the full lab. Correctness,
inspection, stable errors, and read-side relational work do not wait.

### The full client becomes too large

Counterweight: keep capability modules and plan/evaluator contracts compatible
with LLP 0147's generated microclient. Size is a measured gate, never a reason
to remove authority or result validation from a profile that needs it.

## Migration and compatibility

- Existing `liveQuery` and React hooks remain valid; the local materialization
  becomes their substrate rather than a replacement API forced on all apps.
- Existing opaque JS live queries remain online/replace-only unless an owning
  design proves a richer class. No migration silently upgrades retainability
  or completeness.
- Existing application optimistic reducers remain supported as an explicitly
  weaker/custom presentation layer during migration. They do not receive a
  same-operation parity claim.
- Generated query references gain additive plan/completeness metadata under
  the wire-version rules; older clients continue on replace/resnapshot paths.
- Durable store migration is versioned and crash-safe. A client that cannot
  prove compatibility falls back to fresh sync without exposing predecessor
  protected data or dropping pending intent.
- Capability manifests distinguish implementation presence, carrier evidence,
  and product maturity so source-build prototypes do not become public claims.

## Open questions

1. Which document owns the composition algebra: an LLP 0080 amendment or a
   successor Spec under LLP 0120's research? This RFC recommends a successor
   Spec with a dated LLP 0080 boundary note because the composite semantics
   (cursor coordination, partial refusal, composite identity) are materially
   broader than the stable two-source contract.
2. Does cross-query canonical-row normalization ever get admitted, and in
   what form (row, hybrid, or never — fragments indefinitely)? The baseline
   is fragments (§Move 2); admission requires the projection-aware
   authority model, the adversarial-projection evidence, and the dated
   DK-9 amendment. If normalization is rejected by its authority tests, the
   fragment baseline is the conservative migration endpoint, not a
   temporary state.
3. What is the first admitted aggregate node, if any? LLP 0130 SD-2 already
   constrains the answer: the decision fires on option-3a usage evidence,
   an inexpressible demonstrated shape gets a contracted aggregate profile
   with exact-or-refuse as the default result-semantics variant per
   LLP 0120, and maintained-exact requires measured contention evidence.
   Aggregates — including `count` — are outside Move 1 until that standing
   decision fires; the open half is only which demonstrated shape, if any,
   triggers it and its noninterference posture.
4. Does `prefix` ship with Move 1 or remain reserved until a real application
   requires it? No implementation-cap prefix may acquire the label by
   default. (Zero's own documentation lists `prefix`-style partial results
   as future work — externally sourced, verified against the cited queries
   page 2026-08-02 — so no parity pressure exists today.)
5. Which physical browser store owns atomic fragments, memberships,
   optimistic layers, outbox, and settlements: the existing RQS IndexedDB
   schema, a new shared store version, or SQLite/WASM? Semantics precede engine
   choice.
6. Which mutation IR operations constitute Candidate A's first useful class?
   This RFC recommends the Kanban point/indexed operations, not a broad grammar
   chosen without workload evidence.
7. **Answered for the shipped single-Insert React shape on 2026-08-10:**
   Candidate A plus LLP 0133 expresses the provisional reference without a
   Candidate B extension; see Move 4's dated implementation record. Broader IR
   shapes and related-operation retargeting are not inferred.
8. What semantic conflict payload is the minimum useful Notebook result without
   embedding a general merge framework? LLP 0144's declared refusal unions
   should carry the transport shape.
9. What are the first fixed custody and hydration budgets for Triage and Fleet?
   Freeze them from the first controlled run before optimization.
10. Which hosted topology is the first graduation target? No local choice in
    this RFC implies a cacheable HTTP lane, Postgres logical decoding, or one
    cache service per app.
11. Who owns the inspector — LLP 0017's admin console surface, a client-side
    artifact, or both — and is it one surface or two?
12. Who owns the cross-runtime evaluator conformance corpus (Move 2's "same
    plan evaluator, or two evaluators under a conformance corpus"): the
    Move 1 successor Spec, LLP 0051 D5, or a new artifact? This is the
    drift-risk keystone and is currently unowned.
13. Are the read-lane successor manifests (Triage, Fleet) reused verbatim
    from LLP 0138 or re-frozen for moves 1–2? The Move 1 gate's "fresh
    provider-native implementations" means fresh code; whether it also
    means fresh manifests must be pinned before the first successor run.
    (Kanban, Calendar, and Notebook are LLP 0129 lab manifests and freeze
    under that Plan's protocol; Incident Room freezes here as this RFC's
    safety-control manifest — §Sequencing Stage 0.)
14. When Move 3 ships publicly (Kanban gate passed) before the LLP 0129
    lab's manifests freeze, LLP 0129's baseline-change rule already freezes
    the lab against the landed version; the half that remains open is
    artifact identity — whether the lab measures the shipped build itself
    or a lab-grade Candidate A built at the same baseline. The choice
    belongs to LLP 0129's owner record.
15. Does Stage 0's standards-real browser automation requirement answer
    LLP 0129 OQ7's browser-witness half? If yes, the dated cross-reference
    should say so; if no, the two must cross-reference each other.
16. What does "all first-party clients" require of the protected
    Contract-arm custody path — must every client surface expose identical
    local-store semantics, or may the Contract arm keep its stricter
    lease/barrier profile with a narrower materialization contract?

## Status

**Accepted — 2026-08-02, by Charlie Cheever**, at v0.4 after a three-round
dual-family super-refine loop (Fable and GPT-5.6 as author-mandated design
partners; both closed READY with direction verdict ENDORSE; artifacts in
`llp/reviews/0155-local-sync-product-direction.{fable,codex,super-refine}.md`).
This RFC records the accepted product direction and its evidence base. It
makes no implementation or capability claim and does not supersede
LLP 0129's Accepted sequencing and admission decisions (§Sequencing's
conflict rule stands: LLP 0129 wins until dated amendments land there).

Stage 0's reconciliation half executes with this acceptance: the dated
product-direction cross-reference in LLP 0129 (moves 1–3 as consumers, the
lane split against its permissions, the Incident Room safety-control
registration proposal, the read-lane substrate slice offered toward OQ8,
and the Candidate-B boundary prerequisite record) and the dated
commissioning notes in LLP 0008 DK-9 and LLP 0080's retention section land
in the same change. Next steps:

1. author the Move 1 composition-algebra owning Spec (OQ1 recommends a
   successor Spec with a dated LLP 0080 boundary note);
2. freeze Stage 0's remaining evidence prerequisites — the read-lane
   successor manifests (Triage, Fleet), the Incident Room safety-control
   manifest, and standards-real browser automation — before any new
   restart claims; and
3. adjudicate the remaining author-gated open questions (OQ2–OQ5,
   OQ11–OQ16) as their owning designs come up.
