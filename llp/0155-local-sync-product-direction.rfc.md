# LLP 0155: Local sync product direction

**Type:** RFC
**Status:** Draft
**Systems:** Application data API, Client SDK, Client integration, Realtime, Local sync, Offline sync, Relational queries, Optimistic updates, Storage, Auth, Conflict handling, Developer experience, Testing, Competitive analysis
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-02
**Revised:** 2026-08-02 (initial draft — synthesizes the implemented LLP 0138 Zero/Replicache bakeoff and the current Snapback client into a six-move product direction: copy Zero's authoring outcomes without copying its weaker authority boundaries; preserves LLP 0129 as sequencing and option-admission authority)
**Related:** LLP 0000, LLP 0003, LLP 0004, LLP 0007, LLP 0008, LLP 0012, LLP 0034, LLP 0043, LLP 0051, LLP 0053, LLP 0059, LLP 0064, LLP 0074, LLP 0080, LLP 0090, LLP 0093, LLP 0107, LLP 0110, LLP 0114, LLP 0119, LLP 0120, LLP 0125, LLP 0126, LLP 0127, LLP 0129, LLP 0130, LLP 0133, LLP 0138, LLP 0144, LLP 0145, LLP 0147, https://zero.rocicorp.dev/docs, https://doc.replicache.dev

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

1. make a composable, bounded relational query graph plus completeness and
   inspection the primary read-authoring surface;
2. make query-scoped local materialization the ordinary client read path;
3. run one content-addressed mutation IR locally for prediction and on the
   server for authority before admitting duplicated app-authored mutators;
4. add typed optimistic creation through intent identity and explicit
   provisional-to-canonical reconciliation, subject to LLP 0129's evidence
   gate;
5. admit Replicache-class app-authored client mutators only if the frozen
   LLP 0129 decision lab proves the IR and constrained extensions
   insufficient; and
6. preserve Snapback's server authority, revocation, settlement, explicit
   conflicts, bounded custody, target portability, and small local operation
   throughout.

The first three moves close the largest daily product gap and are authorized
for owning-document design if this RFC is accepted. Move 4 may be prototyped
inside LLP 0129's decision evidence but does not become a public capability
until that program admits the relevant constrained extension. Move 5 remains
unadmitted under LLP 0129. Move 6 is a constraint on every phase, not a final
cleanup step.

## Decision requested

Accept the six-move direction above as the product architecture for Snapback's
local-data experience, with these exact consequences:

- **Start now:** richer closed relational plans, query completeness and
  custody inspection, a first-class local query materialization, and the
  browser-safe shared mutation-IR evaluator.
- **Prototype behind evidence:** typed intent identity,
  provisional/canonical mapping, and semantic conflict presentation.
- **Do not admit yet:** arbitrary app-authored client mutators or a generic
  client-side write transaction API.
- **Do not import merely for parity:** PostgreSQL logical replication,
  `zero-cache`-shaped infrastructure, full-table replication, raw local SQL,
  client-owned authorization, or same-by-convention client/server business
  logic.
- **Amend owners rather than centralize implementation here:** this RFC owns
  the product direction and cross-cutting gates. Query grammar belongs in the
  LLP 0080/0110/0120 family; local execution and settlement remain governed by
  LLP 0051/0129/0133; retention and replay remain governed by LLP 0043/0053/
  0090; React projection remains governed by LLP 0107/0114; wire additions
  remain governed by LLP 0034/0093.

Acceptance of this RFC does not by itself promote a capability, change a wire
shape, or authorize Option C from LLP 0129. Each shipping mechanism still
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

If this RFC is accepted, LLP 0129 should receive a dated cross-reference that
identifies moves 1–3 as the chosen product-direction consumers of its program
and records whether its open sequencing questions need amendment. Until then,
this RFC is a proposal subordinate to the Accepted Plan.

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
- the analyzable single-table subset can receive row-level `live_delta`
  operations, while ordered, relational, opaque, or otherwise ineligible
  queries take the conservative re-query plus `live_replace` path;
- reconnect/resume has fail-closed snapshot-digest and version-stream
  handling, with a full-resnapshot fallback;
- the JS/React client resolves a persistent RQS store by default, retaining
  eligible snapshots and exposing `retained` versus `current` freshness;
- the JS/React client has a durable, ordered outbox, client-minted mutation
  identity, exactly-once server settlement, retained settlement recovery, and
  authority-scoped acknowledgement custody;
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
- there is no normalized local relational query store over which application
  queries and mutations share one ordinary client transaction model.

The focused 2026-08-02 verification run supporting this draft passed:

- 26 `@expo/snapback-client` outbox/settlement tests;
- 20 persisted-resume tests, including non-eligible and auth-scoped refusal;
- the framework-neutral optimistic external-store suite;
- the React offline projection suite; and
- the Contract offline replay suite.

This is useful code evidence, not a browser or hosted product claim.

### Current Zero model

Zero is generally available as of March 2026. Its author-facing center is a
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

Replicache's repository was archived by Rocicorp on 2026-06-10 and is not the
recommended current Rocicorp product. It remains the clearest published
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

## Move 1 — Composable relational query graph, completeness, and inspection

### Outcome

An author can express the Triage Graph inbox and Fleet Observatory route as
one generated, bounded, server-approved query graph without manual collection
joins, whole-table client filtering, or application-side sorting of an
implicitly incomplete prefix.

The client receives a materialization plan plus a small public completeness
state, and the inspector explains the plan, admitted bounds, active query
membership, retained rows, hydration work, and authorization partition.

### Proposed query shape

The next relational grammar should extend, not bypass, LLP 0080's closed plan.
It should admit a composable graph with:

- one bounded root window with declared index, filters, stable ordering, and
  keyset pagination;
- typed to-one and bounded to-many relationships;
- nested projection over admitted relationship nodes;
- relationship refinements with their own filters, ordering, and limits;
- membership/semi-join predicates where visibility and invalidation can be
  proved;
- a deliberately small aggregate set: count first, then only aggregates with
  bounded and portable evaluation semantics;
- canonical args and a stable plan hash shared by codegen, server admission,
  live matching, result contracts, client materialization, and inspection;
- explicit capability classification for incremental delta, replace-only,
  retained, and online-only execution; and
- a closed reason whenever a graph exceeds the admitted subset.

The authoring altitude should approach Zero's ordinary query composition:
declare a query graph and use it. Stronger guarantees may require additional
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

### Inspector

The inspector must answer, for every active or retained query:

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
- No aggregate ships without a bounded-work and invalidation story.
- No relationship plan widens visibility relative to any source.

### Acceptance gate

Move 1 exits only when fresh provider-native implementations of Triage Graph
and Fleet Observatory prove:

- the required screens use generated query graphs rather than JS collection
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

All first-party clients expose one normalized local materialization as the
ordinary read substrate. Reactive hooks subscribe to queries over that store;
network hydration and server push update it in the background. Retained reads
and optimistic layers compose with the same rows instead of living in
application-owned parallel arrays.

### Store model

The local store should contain:

- canonical authoritative rows keyed by table and canonical id;
- query membership keyed by plan hash, canonical args, authority partition,
  and query instance/generation;
- per-query completeness, freshness, version, resume, and retention facts;
- provisional rows keyed by typed intent identity, never by forged canonical
  id;
- ordered optimistic layers with their producing mutation identity;
- durable outbox and retained settlement records through the existing store
  contract; and
- authorization/custody metadata sufficient to execute existing deletion,
  quarantine, expiry, and user-switch barriers.

A canonical row shared by two queries should have one stored value and two
membership reasons. Removing one query does not remove the row while another
membership or pending intent owns it. Removing the last authorized membership
does not override an LLP 0053 deletion obligation or lease deadline.

### Query execution

Generated query plans should run over the local store when the required data
is present. The same plan evaluator, or two evaluators under a conformance
corpus, must produce the same canonical result ordering and projection as the
server. A local result reports `unknown` until completeness is proved; local
execution is never permitted to infer missing relationship rows are absent
when they may simply be unhydrated.

### Storage profile

The contract remains store-agnostic under LLP 0008 DK-9:

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
- bounded custody under query churn; and
- byte/row footprint and hydration measurements on Triage and Fleet fixtures.

## Move 3 — Shared mutation IR for local prediction and server authority

### Outcome

An ordinary mutation is authored once. A browser-safe evaluator runs its
closed, content-addressed IR against the bounded local materialization to
derive an optimistic layer. The authoritative server independently executes
the same operation identity against current server state and settles through
LLP 0133. Authors do not write a second reducer for the common path.

This is the Snapback-native route to Zero's best authoring outcome.

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

## Move 4 — Typed optimistic creation and intent reconciliation

### Outcome

An optimistic create participates in ordinary query-derived filtering,
ordering, counts, relationships, and React rendering before the server mints
its canonical id. Settlement maps the intent exactly once to the canonical row
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

This is Candidate-B-shaped work under LLP 0129. It may be prototyped only in
the decision evidence until that Plan's lab reports and an owning design admits
the extension. LLP 0133's already-required lane-L logical-mint mapping remains
shared substrate and is not blocked; the new public authoring and query
composition surface is what requires admission.

### Acceptance gate

Contention Calendar must prove:

- the provisional reservation appears in the same typed query as canonical
  reservations;
- filters, ordering, availability counts, and relationships include it under
  explicit provisional semantics;
- two clients contend for the last slot and exactly one canonical transaction
  commits;
- the winner maps once, the loser corrects visibly, and neither duplicates;
- ambiguous redelivery is idempotent; and
- every observer converges on authoritative capacity and order.

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

Candidate C may be recommended only if:

- at least one required product fact is inexpressible through both A and B;
- two independent attempts attribute the failure to the same missing
  primitive rather than incomplete implementation, harness failure, an owned
  policy pin, or environment;
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

The moves are not six independent projects.

### Stage 0 — Freeze the baseline

- retain LLP 0138's immutable receipts;
- record current client/store bundle, carrier, and target identities;
- freeze Triage, Kanban, Calendar, Incident, Notebook, and Fleet manifests for
  successor evidence; and
- establish standards-real browser automation before making new restart
  claims.

### Stage 1 — Read-path foundation

Run Move 1's query-graph design and Move 2's local-store contract together.
The graph defines what can be materialized; the store proves how membership,
completeness, and custody compose. The inspector is part of this stage, not a
later debugging accessory, because its data model forces hidden state to become
explicit.

Triage and Fleet are the exit applications.

### Stage 2 — Shared local execution

Implement Move 3 only over the bounded query/store substrate and the existing
LLP 0133 settlement machinery. Start with point and indexed-set operations
needed by Kanban; refuse missing local inputs rather than adding unbounded
client reads.

Kanban is the exit application.

### Stage 3 — Optimistic identity evidence

Prototype Move 4 inside LLP 0129's decision lab after Candidate A is qualified.
Do not ship the public extension merely because its substrate mapping exists.

Calendar is the exit application.

### Stage 4 — Offline/rebase decision

Run Move 5's A→B→C protocol only when LLP 0129's prerequisites, owner, and
timebox are satisfied. A result can be “no recommendation”; the program is not
required to admit app-authored mutators.

Notebook is the discriminator. Incident Room re-runs as the authority safety
control for every candidate.

### Stage 5 — Hosted and carrier graduation

Only after local/browser correctness:

- qualify Expo/native and desktop carriers;
- run reconnect-storm and fan-out measurements;
- bind hosted topology and multi-instance delivery to their own target
  capability facts; and
- measure whether the generated microclient of LLP 0147 can select only the
  query/store/mutation features the app uses without semantic drift.

## Measurement and evidence

No composite score decides this RFC. Each stage reports:

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

### The query grammar becomes a second database language

Counterweight: keep it closed, small, capability-classified, and driven by the
six frozen applications. Prefer composable primitives with shared evaluators
over one builder per diary pattern. Require a plan inspector so semantics do
not become opaque codegen magic.

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

Counterweight: moves 1–3 can proceed now under their owning documents. Only the
authority-expanding or app-extensible surfaces in moves 4–5 wait for the full
decision lab. Correctness, inspection, stable errors, and read-side relational
work do not wait.

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

1. Which document owns the composable graph grammar: an LLP 0080 amendment or
   a successor Spec under LLP 0120's research? This RFC recommends a successor
   Spec with a dated LLP 0080 boundary note because the graph is materially
   broader than the stable two-source contract.
2. Is the canonical local representation row-normalized, result-fragment
   normalized, or a hybrid? The answer must preserve exact nested projection,
   query membership, and protected-source non-custody.
3. Which aggregates enter the first graph grammar? This RFC recommends count
   only, and only where the plan can prove a bounded or maintained source.
4. Does `prefix` ship with Move 1 or remain reserved until a real application
   requires it? No implementation-cap prefix may acquire the label by default.
5. Which physical browser store owns atomic canonical rows, memberships,
   optimistic layers, outbox, and settlements: the existing RQS IndexedDB
   schema, a new shared store version, or SQLite/WASM? Semantics precede engine
   choice.
6. Which mutation IR operations constitute Candidate A's first useful class?
   This RFC recommends the Kanban point/indexed operations, not a broad grammar
   chosen without workload evidence.
7. Can Candidate A express a typed provisional reference entirely from LLP
   0133's existing logical-mint mapping, or is Move 4 necessarily a Candidate B
   extension? The LLP 0129 lab owns the answer.
8. What semantic conflict payload is the minimum useful Notebook result without
   embedding a general merge framework? LLP 0144's declared refusal unions
   should carry the transport shape.
9. What are the first fixed custody and hydration budgets for Triage and Fleet?
   Freeze them from the first controlled run before optimization.
10. Which hosted topology is the first graduation target? No local choice in
    this RFC implies a cacheable HTTP lane, Postgres logical decoding, or one
    cache service per app.

## Status

Draft. This RFC records the recommended product direction and its evidence
base. It makes no implementation or capability claim and does not supersede
LLP 0129's Accepted sequencing and admission decisions.

Proposed next steps after author review:

1. accept, revise, or reject the six-move direction;
2. if accepted, add a dated LLP 0129 cross-reference and commission the Move 1
   query-graph owning Spec;
3. freeze Stage 0's browser and large-query evidence manifests; and
4. run an LLP 0005 review loop scaled to this RFC's cross-subsystem stakes
   before status promotion.
