# LLP 0166: The local persistent store

**Type:** Spec
**Status:** Draft
**Systems:** Client SDK, Client integration, Local sync, Offline sync, Storage,
Live queries, Relational queries, Optimistic updates, Auth, Testing
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-08-03
**Revised:** 2026-08-03 (v0.1, initial draft — the Move-2 owning Spec
commissioned by Accepted LLP 0155 and the wave-3 Track A program
(`issues/20260803-0155-move2-spec-commission.md`, ruled spec-first). Consumes
Accepted LLP 0157's identity stack, completeness witness, and §D7 store
interface; carries the LLP 0008 DK-9 and LLP 0080 retention-class amendment
texts those owners' dated 2026-08-02 notes commission, landing at this Spec's
acceptance; answers LLP 0155 OQ5 (the physical store) and LLP 0161 OQ5 (the
agent-safe client seam).)
**Related:** LLP 0000, LLP 0004, LLP 0007, LLP 0008, LLP 0012, LLP 0034,
LLP 0039, LLP 0043, LLP 0048, LLP 0051, LLP 0053, LLP 0055, LLP 0059,
LLP 0080, LLP 0081, LLP 0088, LLP 0090, LLP 0091, LLP 0093, LLP 0094,
LLP 0095, LLP 0097, LLP 0107, LLP 0110, LLP 0112, LLP 0114, LLP 0126,
LLP 0129, LLP 0130, LLP 0131, LLP 0133, LLP 0134, LLP 0135, LLP 0145,
LLP 0147, LLP 0155, LLP 0157, LLP 0158, LLP 0161, LLP 0162, LLP 0163,
LLP 0164, LLP 0165

## Summary

LLP 0155 Move 2 commissions one owning Spec for first-class query-scoped
local materialization. Accepted LLP 0157 supplied the semantic substrate:
plan identity (`PlanHashV1`, `QueryMaterializationKeyV1`), the completeness
witness (`CompletenessStatusV1`/`CompletenessProofV1`), and the §D7 store
interface (materialization records, fenced atomic operations, observation,
storage profiles). This Spec adds no second identity, witness, or interface;
it owns the **store as a product** — everything that turns those records into
the ordinary client read substrate:

1. **One store domain** (§D1) — the physical composition answering LLP 0155
   OQ5: the shipped client store family evolves in place; materializations,
   page sets, memberships, legacy resume entries, and the LLP 0043 outbox
   share one versioned, single-writer, atomic transaction domain.
2. **The sync specification** (§D2) — registered and preloaded queries *are*
   the replica definition. There is no separate replica schema, table list,
   or sync manifest; the store hydrates, syncs, and retains exactly the
   registration set.
3. **Retention keyed by plan identity** (§D3) — what persists, under which
   owner-issued retention authority, with explicit address families for the
   populations that predate LLP 0157.
4. **Completeness-honest local answers** (§D4) — a query answers locally
   with authority only when its held witness and capability class prove it;
   everything else is honestly `unknown`.
5. **Query lifecycle, TTL, and eviction** (§D5) — registration states,
   custody budgets, idle grace, and an eviction order that can never
   override an authorization obligation or evict pending intent.
6. **The resume/delta relationship to shipped RQS** (§D6) — the LLP 0090
   machinery is consumed unchanged as the sync engine; this store is the
   declared successor of its Channel-B persistence and the staged
   convergence path for the legacy address families.
7. **The gated evaluation profile** (§D7) — the local-plan-evaluation
   contract, plus the exact LLP 0008 DK-9 and LLP 0080 amendment texts this
   Spec carries; evaluation stays refused until the amendments land and the
   conformance corpus passes.
8. **The agent-safe seam** (§D8) — the LLP 0161 OQ5 answer: which of the
   agent-ideal properties P1–P9 the client store needs natively, which it
   consumes as server-issued artifacts, and which it never takes; no
   LLP 0162-family sequencing is pulled forward.

## Scope and authority

This Spec owns the eight items above. It does **not** own:

- **Identity, witness, and interface semantics.** `NodePlanHashV1` →
  `PlanHashV1` → `QueryMaterializationKeyV1` → contextual addresses, the
  completeness status/proof, the §D3 product state, and the §D7 operation
  contract are LLP 0157's. This Spec consumes them byte-for-byte and mints
  no parallel identity or state.
- **Carrier custody, leases, and the outbox.** LLP 0043 owns retained-entry
  custody rules, the `AuthorizedLease` machinery, the durable
  pending-mutation outbox, settlement publication, and acknowledgement GC.
  This Spec composes those records into one transaction domain; it changes
  none of their lifecycles.
- **Authorization invalidation.** LLP 0053 owns witnesses, dispositions,
  fences, tombstones, obligations, terminal retirement, and the LLP 0059
  barrier. Every destructive transition in this store is an LLP 0053
  operation, never a parallel mechanism.
- **Resume admission and token identity.** LLP 0090 owns the replay
  admission ladder, token/digest identity, arbitration, and the Channel
  model. LLP 0091 owns the digest/token byte formats.
- **The client-store carrier decision.** LLP 0008 DK-9 owns the
  store-agnostic interface mandate and its durable-state rules. This Spec
  stays inside DK-9's envelope except where the carried amendment (§D7)
  explicitly widens the *semantic* contract.
- **Retention classes.** LLP 0080 owns `opaque-authorized-snapshot-v1` and
  the closed retention set; §D7 carries its commissioned extension.
- **Settlement semantics and optimistic layers.** LLP 0133 and the
  LLP 0107/0114 seam own payload semantics; this store owns their durable
  composition only, exactly as LLP 0157 §D7 already records.
- **Wire shapes.** Any new frame or envelope is a dated LLP 0093/0094
  amendment; conformance is LLP 0012/0095's.
- **Agent-safe host primitives.** Commit envelopes, forks/promotion, and
  proof domains/checkpoints are LLP 0163/0164/0165's; §D8 classifies the
  seam and duplicates none of their contracts.

Acceptance path: commissioned by an Accepted RFC; LLP 0130 SD-4's standing
rule applies if the dual-family loop converges READY within this
commission's scope; the author decides otherwise. Acceptance additionally
lands the two dated amendments §D7 carries in their owning documents
(LLP 0008 DK-9, LLP 0080) and dated boundary notes in LLP 0043, LLP 0053,
and LLP 0090 for the successor-store and address-family seams. Acceptance is
semantic only: no implementation or capability fact is promoted by this
document's status.

## Vocabulary

- **Materialization.** LLP 0157's unit: one `MaterializationRecordV1` at one
  `ClientMaterializationAddressV1` and current `query_instance_id`.
- **Registration.** A durable client-side declaration that one generated
  query reference plus canonical args belongs to the sync set (§D2). The
  registration, not the row, is the unit of intent.
- **Sync set.** The union of current registrations. The store hydrates,
  syncs, and retains exactly this set — the sync set *is* the replica
  definition.
- **Hydration.** Establishing a registered materialization's requested scope
  from the server (LLP 0157 §D7 `beginEstablishment`/`commitPage`).
- **Authoritative local answer.** A locally served result whose derived
  `CompletenessStatusV1` is `complete` (freshness `current` or `retained`),
  served through `readRenderable` under the exact fence. Not a new state —
  a projection of LLP 0157's product state (§D4).
- **Address family.** One of the three coexisting keying regimes for
  retained client state (§D3): `qmk1` materializations (LLP 0157-admitted),
  legacy resume entries (`rqsEntryKey`), and legacy lease records
  (`retainedQueryKey`, the Contract arm's separate artifact).
- **Idle grace.** The bounded custody window a released (no longer
  registered) materialization survives before eviction (§D5).
- **Channel B store.** The shipped RQS persisted resume store
  (`snapback-rqs-store.v1` and its file/memory/Expo carriers) this Spec
  succeeds (§D6).

## D1 — One store domain

### The physical answer (LLP 0155 OQ5)

LLP 0155 OQ5 asked which physical browser store owns atomic fragments,
memberships, optimistic layers, outbox, and settlements: the existing RQS
IndexedDB schema, a new shared store version, or SQLite/WASM. The answer is
the middle option, executed as an in-place evolution of the shipped store
family:

- **Browser:** the existing IndexedDB database `snapback-rqs-store.v1`
  advances its schema version (shipped `DATABASE_VERSION = 2`; the successor
  version adds object stores) rather than creating a parallel database. New
  object stores: `materializations`, `pageSets`, `memberships`, and
  `storeMeta`, beside the existing `entries` (legacy resume) and `outbox`
  stores. IndexedDB transactions span object stores within one database, so
  the fenced atomic operations LLP 0157 §D7 requires — and their
  composition with outbox writes — commit in one transaction.
- **File (Node, and Expo/native via the registered files adapter):** the
  shipped blob format (`snapback-rqs-store-file.v2`) advances to a v3 that
  adds the same sections; the whole-blob atomic replace already provides the
  single transaction domain.
- **Memory:** the volatile carrier mirrors the same sections with
  `durable: false`, unchanged honesty rules.
- **SQLite** remains permitted behind LLP 0008 DK-9's store-agnostic seam
  (the file carrier's own comment records that SQLite could swap in behind
  the same adapter without observable change) and required nowhere.
  Semantics precede engine choice; this Spec's contract must hold
  identically on every carrier.

A parallel second database is rejected because the load-bearing atomicity
obligations — settlement publication before result exposure (LLP 0043),
wipe clearing retained state and outbox in one transaction, fenced
compare-and-commit across fragments and product state (LLP 0157 §D7) —
cannot span IndexedDB databases, and because the shipped budget, lock, and
GC machinery already operate on this domain.

### Domain composition

One store domain exists per `clientStoreId` (LLP 0053's store/namespace
axis). It contains:

| Section | Contents | Payload owner |
| --- | --- | --- |
| `materializations` | `MaterializationRecordV1` per address (fragments, proofs, product state, subscription state, references) | LLP 0157 §D7 |
| `pageSets` | ordered page-set manifests | LLP 0157 §D3 |
| `memberships` | row-occurrence membership records | LLP 0157 §D7 |
| `entries` (legacy) | Channel B resume entries `{rows, meta, token, …}` | LLP 0090 |
| `outbox` | durable pending-mutation queue, settlement + acknowledgement ledger, React binding receipt | LLP 0043 |
| `storeMeta` | `query_instance_id` allocator high-water, generation counters, the LLP 0157 §D6 handle key, budget/eviction facts, store format version | this Spec / LLP 0053 (allocator) |

The LLP 0043 Contract-arm lease store (`retainedQueryKey`-keyed retained
records plus `AuthorizedLease` custody) is **deliberately not absorbed in
v1**: LLP 0090's step-5 amendment requires it to remain a separate,
untouched artifact, and its records adopt `qmk1` addresses only under the
dated LLP 0043/0053 migration rules (§D6). This Spec declares the one-domain
target and stages that merge behind those rules and LLP 0155 OQ16.

### Writer discipline and format versioning

- **Single writer, consumed unchanged:** the browser carrier's long-held Web
  Locks exclusive lock (non-holders read and adopt, never write); the file
  carrier's exclusively created lock file with liveness-verdict staleness.
  Independently constructed same-origin clients serialize per LLP 0008
  DK-9's rule, failing closed with the shipped lock-unavailable diagnostic.
- **Format versioning:** every store format change is a numbered, one-way,
  crash-safe migration. A migration preserves pending intent and unresolved
  acknowledgements or refuses to run (LLP 0155's migration guardrail;
  LLP 0043's custody rules). Corrupt, future, or legacy bytes are typed
  invalid-state diagnostics preserved in place — never an empty-success
  parse fallback (DK-9), and only an explicit `wipe` — which clears retained
  state *and* outbox atomically, because another identity must never replay
  this one's queued mutations — resets them.
- **Version-skew fail-closed:** an older client opening a newer store fails
  closed (the shipped v1-code-on-v2-database VersionError posture),
  reporting a stable diagnostic rather than downgrading the store.

## D2 — The sync specification: registered queries

### The rule

**The sync set is the registration set.** There is no separate replica
definition — no table list, no collection manifest, no sync schema. A
materialization is hydrated, kept current, or retained because at least one
registration names it (or because §D5's idle grace has not yet elapsed since
the last registration released it); the inspector can name that reason for
every retained byte (LLP 0157 §D6). A query nothing registers is never
hydrated and never retained.

This is LLP 0155 Move 2's copied-Zero outcome with Snapback's authority
model kept: the *client* declares interest; the *server* still admits the
plan, authorizes every result, and issues every witness. A registration
never widens a server-approved query, never mints retention the owner's
classification refuses, and never converts interest into authority.

### The registration record

```ts
type QueryRegistrationV1 = Readonly<{
  format: "snapback.query-registration.v1"
  source: "active" | "preload" | "programmatic"
  functionReference: object      // the generated reference, byte-preserved
  canonicalArgs: unknown         // LLP 0114 CanonicalClientValueV1
  requestedScope: RequestedCompletenessScopeV1   // LLP 0157 §D3
  retentionRequest: "none" | "durable"
  idleTtlClass: "none" | "default" | "pinned"
  priorityClass: "active" | "preload" | "background"
}>
```

- The registration resolves to an address: a
  `ClientMaterializationAddressV1` where the reference names an
  LLP 0157-admitted plan, otherwise the legacy alias key its arm already
  uses (§D3's address families; a legacy-family registration's
  `requestedScope` is the whole-result semantics its arm already implies —
  the field constrains only `qmk1` establishment). Registration is
  idempotent at the address; the store keeps a registration count per
  address, and `source` facts for inspection.
- `retentionRequest: "durable"` is a *request*: it is honored only when the
  owner-issued capability classification and retention authority admit it
  (§D3). The mismatch is reported honestly through the shipped
  retention-classification surface (retainable / not-retainable with a
  stable code), never silently dropped.
- Unknown fields refuse; every `*Class` value outside the closed sets
  refuses.

### Registration sources, mapped to shipped machinery

| Source | v1 producer | Notes |
| --- | --- | --- |
| `active` | a live `liveQuery`/provider subscription (the mounted-UI path) | exists while the subscription does; its release begins §D5 lifecycle |
| `preload` | the routes manifest (`defineRoutes` → `routes.manifest.json`) and its Channel A/C boot bundles and register groups | boot-scoped hydration; LLP 0090 owns bundle admission |
| `programmatic` | an explicit client registration API (the successor of the per-call `persistResume` option and the routes-manifest `persist: false` opt-out) | the authoring shape is OQ8 |

### Sync obligations per capability class

The owner-issued classification (LLP 0157 §D2/D4) is the *only* input; the
store infers nothing from plan shape:

- **Live-admitted plans** (`live.kind: "admitted"`): while at least one
  `active` registration exists and the client is connected, the store holds
  the live subscription and ingests `live_replace`/`live_delta` per the
  owners' rules (LLP 0157 §D7 ingestion; LLP 0034's lane). Establishment
  runs at registration; re-establishment on reconnect enters through the
  shipped state machine (§D6).
- **Non-live plans** (`live.kind: "none"`, including `Query`-kind exports):
  establishment at registration and on explicit refresh; no subscription is
  invented for them.
- **`idle` registrations** (`preload`/`programmatic` with no active use):
  hydrated at registration and re-validated when they next become active or
  at boot preload; v1 deliberately holds **no** standing live subscription
  for idle registrations (the fan-out cost of a warm class is OQ3).
- **Retention-ineligible plans** (owner retention `"none"`, e.g. v1
  `snapshot-batch.v1` composites): registration governs presence and
  priority only; their materializations live in the `volatile-online-v1`
  profile and restart `unknown`.

### Hydration scheduling

Hydration is bounded and inspectable, never an unbounded fan-out:

- priority order `active` > `preload` > `background`; within a class,
  least-recently-established first;
- a per-store establishment concurrency bound (v1 default: 4 concurrent
  establishment attempts), with remaining registrations queued and their
  attempt state honestly `pending`/`idle` per LLP 0157 §D3;
- a registration that cannot hydrate (offline, refused, over budget)
  reports `unknown` plus its attempt/refusal state — registration never
  fabricates rows;
- hydration work (rows, bytes, attempts) is an inspection fact per
  materialization (LLP 0157 §D6) and per store (§D5 budget facts).

## D3 — Retention keyed by plan identity

### The retention unit

The unit of durable retention is the whole materialization record at its
address — fragments with their proofs, page-set manifests, memberships,
product state, and authority state — committed and evicted atomically. V1
has no partial-fragment eviction: a record is present whole or absent whole
(its interior page lifecycle belongs to LLP 0157 §D3's transitions).

Persistence requires **all** of:

1. the store's `durable-fragments-v1` profile (LLP 0157 §D7) on a carrier
   whose durability facts are qualified (§D9);
2. an owner-issued retention authority for the plan — the store never
   widens a classification:
   - `opaque-authorized-snapshot-v1` (LLP 0080) with the complete LLP 0043
     lease/witness custody for auth-scoped plans;
   - the LLP 0090 Channel-B rules for the legacy `rqsEligible` population
     (below);
   - `retention: "none"` never persists;
3. a registration or unexpired idle grace (§D2/§D5); and
4. the LLP 0053 state admitting it (disposition `retain`, no blocking
   fence).

### Address families and their staged convergence

Three keying regimes coexist, deliberately and visibly:

| Family | Key | Population | Witness | Status under this Spec |
| --- | --- | --- | --- | --- |
| `qmk1` materializations | `ClientMaterializationAddressV1` | LLP 0157-admitted plans (`relational_query_v1`, `bounded_children_v1` singles; composites volatile-only in v1) | `CompletenessProofV1` | the target family; new establishment lands here |
| legacy resume | `rqsEntryKey(name, args)` | the shipped `rqsEligible` set — public, authority-independent, single-table, plan-based LiveQueries (LLP 0004/0007 plans; server-derived predicate, never authored) | server-MACed resume token + content digest (no completeness proof) | continues under LLP 0090's rules in the same store domain; converges only if a single-table node class registers (OQ1) |
| legacy lease | `retainedQueryKey(name, args)` | auth-scoped retained records (Contract arm) | `CompositeWitness` + `AuthorizedLease` | separate LLP 0043 artifact, unchanged; adopts `qmk1` only under the dated prove-or-fresh-sync rules (§D6) |

The middle row records a fact LLP 0157 makes explicit: ordinary LLP
0004/0007 single-table plans are not silently reclassified as composition
nodes, so the shipped retained population has no `PlanHashV1` and no
completeness proof today. This Spec does not pretend otherwise: the legacy
family keeps its shipped verification (digest + token identity,
fail-closed) and its shipped rules, inside the same store domain, budget,
and lifecycle. Registering a `single_table_v1` node class with the owners —
which would give this population plan identity, proofs, and `qmk1`
addresses — is OQ1, an owner proposal under LLP 0157 §D1's growth stop
rule, not an inference this Spec may make.

### Identity rotation and predecessors

Args, plan, function, activation, or authority-partition change derives a
different address (LLP 0157 §D2's rotation table, consumed). The store
initializes the new address and never mutates identity in place. Predecessor
state is handled exclusively by LLP 0053 machinery — the store-wide
authority barrier for authority rotation, artifact-change delete-before-read
for activation change, quarantine/delete dispositions otherwise. **Eviction
is never a substitute for a barrier:** budget pressure may reclaim custody
(§D5), but a rotated identity's predecessors are destroyed or quarantined
through their owner's operations before any successor renders, regardless
of budget state.

### Custody budgets

The store inherits the shipped budget discipline, applied across all
sections of the domain:

- v1 budget constants: 32 MiB total payload bytes and 256 retained records
  per store (the shipped `RQS_STORE_MAX_BYTES`/`RQS_STORE_MAX_ENTRIES`
  values, now covering materializations plus legacy entries), and at most
  1,024 stored fragments across all materializations (matching the
  substrate's summed-`take` ceiling class). Values are dated-amendable;
  LLP 0155 OQ9's Triage/Fleet budget freeze supplies the first measured
  revision (OQ4).
- Budget enforcement runs inside the committing transaction (consumed
  shipped rule): an over-budget commit evicts per §D5's order or refuses;
  a single entry exceeding the budget refuses with its stale predecessor
  deleted, never half-written.
- The outbox and acknowledgement ledger have their own owner-set caps
  (LLP 0043: 1,024 records / 4,096 pending acknowledgements) and **refuse
  at capacity rather than evict** — pending intent and unacknowledged
  settlement recovery state are never budget-evicted, and their caps are
  not fungible with the retention budget.

## D4 — Completeness-honest local answers

### The rule

**A plan answers locally with authority only when its witness and
capability class permit.** Concretely, an authoritative local answer
exists at an address exactly when `readRenderable` (LLP 0157 §D7) succeeds
under the exact fence triple and the derived `CompletenessStatusV1` for the
requested scope is `complete` — meaning: lifecycle `active`, disposition
`retain`, valid held proof(s) exactly satisfying the requested scope at the
requested version, witness bindings revalidated against current LLP 0053
state, and (auth-scoped) an unexpired lease. Freshness labels the answer
`current` or `retained`; a retained answer is complete *as of* its proof
version and is never presented as current.

Everything else is `unknown` — honestly ignorant, locally derivable,
requiring no round-trip (LLP 0157 §D3). The store adds no fifth state and
no local upgrade path:

- no completeness from row counts, cap coincidence, or replayed deltas
  (consumed);
- no absence inference: rows not held are unhydrated, not proven absent;
- partial hydration of a page set answers `unknown` for the set scope even
  while individual pages are complete as-of their own versions (consumed);
- a `refused` establishment surfaces its closed reason and safe fallback;
  it never silently degrades to stale rows presented as fresh.

### Per-family answer regimes

- **`qmk1` materializations:** proof-or-nothing. Retained boot runs
  LLP 0157 §D3's retained-boot validation table exactly; a fragment whose
  proof fails any check renders nothing and takes the table's prescribed
  store mutation. There is no digest-only render for this family.
- **Legacy resume entries:** the shipped regime continues — digest-verified
  rows render labeled `retained` with `pendingIntentsAtSeed` when the
  outbox is non-empty, per LLP 0090; the first authoritative answer
  restores `current`. This family's answers are *labeled retained data*,
  not completeness-witnessed authority, and the React projection's
  `'live'` status correctly excludes them.
- **Legacy lease records:** LLP 0043 M1's conditions, unchanged (exact
  composite-witness match, complete MACed lease custody, strictly before
  deadline, delete-before-read on every defect).

### Offline posture

- Authority-independent retained state displays indefinitely while
  disconnected, always labeled non-current (LLP 0043's never-current rule).
- Auth-scoped retained answers are lease-bounded: at most the LLP 0053
  24-hour ceiling, equality-is-expiry, clock-rollback and custody defects
  delete before read, and no ambient renewal — heartbeat, delta, reconnect,
  and mutation success never extend authority (consumed).
- Reconnect always re-enters the owners' state machine (fresh
  authorization revalidation and snapshot, or the §D6 resume ladder)
  before retained labels clear.
- A `volatile-online-v1` store restarts `unknown` with a structured
  durable-profile GAP (LLP 0157 §D7); it never emulates durability.

## D5 — Query lifecycle, TTL, and eviction

### Lifecycle states

Per materialization (a projection over registration state plus LLP 0157's
product state — not a new stored enum axis beyond the registration facts):

| State | Definition | Sync behavior | Eviction exposure |
| --- | --- | --- | --- |
| `active` | ≥ 1 `active`-source registration | live subscription per class; ingestion | never budget-evicted; over-budget establishment refuses commit |
| `idle` | registered by `preload`/`programmatic` only | hydrated at registration/boot; no standing subscription (v1) | evictable after `released` records are exhausted |
| `released` | zero registrations, idle grace running | none | first in eviction order |
| `retired` | LLP 0053 terminal retirement | rejected inputs | owner-destroyed, not evicted |

### TTL

- **Idle grace (release TTL):** a released materialization survives
  eviction eligibility for its registration's `idleTtlClass`:
  - `"none"` — evictable immediately on release;
  - `"default"` — 14 days from last authoritative establishment. The value
    deliberately equals the coordinated cursor-credential expiry
    (1,209,600,000 ms, LLP 0157 §D8), so released state never outlives the
    credential family that could resume it;
  - `"pinned"` — held until explicitly unregistered; still inside the
    budget, still subordinate to every owner obligation.
- **TTL is custody policy, never authority.** It only shortens custody. It
  cannot extend a lease, a proof's validity, or a retained label's
  authority; auth-scoped custody ends at lease expiry through LLP 0053's
  `delete` regardless of any TTL class, and an owner disposition executes
  on its own schedule regardless of grace.
- The legacy directory GC (30-day dead-origin blob sweep on the Node
  default path) is unchanged and out of scope: it reclaims abandoned
  *stores*, not entries within a live one.

### Eviction

Under budget pressure, within the committing transaction:

1. `released` records, oldest last-authoritative-establishment first (the
   successor of the shipped `resumedAt`-then-`savedAt` order, applied at
   record granularity);
2. then `idle` records, least-recently-established first;
3. `active` records are never evicted; if evicting every `released` and
   `idle` record cannot fit the commit, the commit refuses with a stable
   over-budget diagnostic.

Eviction blockers — a record is skipped (and the order proceeds past it)
while any of these hold:

- pending outbox intent references the materialization (LLP 0157 §D7's
  independent-reasons rule; pending intent is never evicted with it);
- unresolved LLP 0053 obligations, or tombstone/fence state a barrier still
  needs, attach to it — eviction reclaims *renderable custody*; it never
  deletes owner bookkeeping, and destructive cleanup runs through
  `applyAuthorizationTransition`, preserving tombstones and frontiers;
- retained settlement or unconfirmed acknowledgement records depend on it
  (LLP 0043's refuse-at-capacity posture governs those, not this budget).

Eviction is atomic per record (fragments, page sets, memberships, and
registration bookkeeping in one transaction — a page-set manifest never
outlives its fragments), and inspectable: the store keeps eviction
counts/last-eviction facts in `storeMeta`, and every still-present record's
retaining reason remains answerable (LLP 0157 §D6).

`wipe` is not eviction: it is the identity barrier's tool, clearing
retained state and outbox atomically (§D1), invoked through LLP 0053/0059
transitions.

## D6 — Resume, delta, and the shipped RQS machinery

### What is consumed unchanged

The LLP 0090 machinery is this store's sync engine, not a competitor:

- the replay admission ladder — `CurrentAsOf` unchanged-proof, delta replay
  with the membership witness, fresh `LiveReplace` fallback;
- token/digest identity (`mset1`/`seq1`, opaque server-MACed tokens),
  A-versus-B arbitration (matching identity, higher version; any identity
  mismatch discards both), and token adoption by non-writer tabs;
- **the pending-outbox protocol rule:** a client with non-empty outbox
  never sends `resumeFromToken`; it takes the LLP 0043 path (full resync,
  then replay), while still rendering verified retained rows labeled
  `retained` with `pendingIntentsAtSeed`;
- the persistence cadence (bounded debounce, flush on
  pagehide/visibility-hidden, explicit flush hook), the `inProgress`
  crash marker refusing partially applied delta sequences, and
  `markResumed` recency;
- purge on `AuthorizationInvalidation` and `resync_required` with
  `clear_retained` — the persisted copy, not just memory;
- fail-closed handling of corrupt, truncated, or digest-mismatched
  persisted state (untrusted input; fresh subscribe).

### The three sync lanes, honestly

V1 has three re-entry lanes, one per address family; this Spec unifies
their *custody domain and lifecycle*, not their admission protocols:

1. **Legacy token resume** (`rqsEligible` entries): the full LLP 0090
   ladder, unchanged.
2. **Lease revalidation** (auth-scoped lease records): no persisted resume
   token exists for this population (LLP 0090 pins that v1 persists no
   auth-scoped RQS resume state); reconnect is full authorization
   revalidation plus fresh snapshot or admitted delta under LLP 0043/0053.
3. **Fresh establishment** (`qmk1` materializations): re-establishment
   through LLP 0157 §D7 with proofs; live delivery per the plan's
   classification (v1 composites: cursor-free first-page `live_replace`
   re-execution; no composite resume credential exists). A proof-backed
   resume credential that lets a `qmk1` materialization enter the ladder's
   rung 1/2 — binding token identity to the materialization key and held
   proof — is a successor amendment with LLP 0090/0093/0094 (OQ2), not a
   v1 claim.

### Successor and migration rules

This store is the declared successor of the Channel B store. Convergence is
staged and fail-closed:

- **Legacy resume entries** stay in their section under their own rules.
  They never adopt `qmk1` in v1 (their plans have no registered node
  class); if OQ1 registers one, adoption follows the same
  prove-or-fresh-sync discipline as the lease family.
- **Legacy lease records** adopt `qmk1` only when the exact registered
  plan, function reference, activation, canonical arguments, and authority
  partition are recomputable and payload, lease, fence high-waters,
  obligations, and pending-intent references move atomically; otherwise the
  legacy record remains non-renderable under its old fence until fresh sync
  creates the new address, then retires. It is never relabeled in place
  (LLP 0043/0053's dated boundary notes, consumed verbatim).
- **No dual identity:** one logical retained result is never simultaneously
  renderable under two families; migration either moves it atomically or
  leaves exactly one renderable copy (the other non-renderable until
  retirement).
- **Pending intent is sacred:** no migration, format change, or family
  convergence drops, reorders, or double-replays outbox records; a
  migration that cannot preserve them refuses (§D1).

## D7 — The gated evaluation profile and the carried amendments

### Current law, restated

Until the amendments below land, LLP 0008 DK-9's text and LLP 0080's
opaque-snapshot-only retention govern unchanged: a retained fragment is
decoded and served as its owner's opaque snapshot only; no admitted plan is
locally re-evaluated over retained rows; no dependency closure is locally
re-authorized; no unprojected joined rows are retained for local
recomputation. LLP 0157 §D7 independently gates shipping on the amendments
landing. Any evaluation attempt in the meantime refuses with a stable
closed reason (placeholder `SNAPBACK_LOCAL_EVALUATION_UNADMITTED` until
registered in the LLP 0048 corpus with the implementing slice — every code
this Spec names is a placeholder under the same rule).

### The carried amendments

Per the owners' dated 2026-08-02 commissioning notes ("the amendment lands
here, dated, alongside the Move 1/2 owning Spec"), this Spec carries the
texts; they land in the owning documents, dated, at this Spec's acceptance.

**Proposed LLP 0008 DK-9 amendment:**

> **Dated amendment (with LLP 0166's acceptance):** the client-store
> semantic contract is widened by deliberate new author policy (LLP 0155's
> commission; not the SQL revisit trigger, which LLP 0051 answered without
> SQL): in addition to the document/result cache plus outbox, the store may
> hold LLP 0157 materialization records — opaque authorized query-result
> fragments with completeness proofs — and an admitted plan evaluator may
> evaluate that plan over the fragments of a single materialization address
> under LLP 0166 §D7's evaluation contract. The contract remains the
> observable-state list, not SQL; nothing in the wire contract may require
> SQL semantics client-side; cross-query canonical-row normalization
> remains unadmitted (LLP 0157 §D7's gate).

**Proposed LLP 0080 retention-class amendment:**

> **Dated amendment (with LLP 0166's acceptance):** the closed retention
> set gains `fragment-evaluated-snapshot-v1`: an admitted plan whose result
> is retained as opaque authorized fragments with completeness witnesses
> under LLP 0157 may be locally re-evaluated **over its own retained
> fragments only**, for the local materialization LLP 0155 Move 2
> describes, under LLP 0166 §D7's evaluation contract and conformance
> gate. The class inherits every `opaque-authorized-snapshot-v1` custody
> rule (lease, principal, reconnect); it still never retains unprojected
> joined rows, never re-authorizes a dependency closure locally, and never
> permits cross-query evaluation. Plans without this class keep
> opaque-snapshot-only semantics unchanged.

### The evaluation contract (post-amendment, evidence-gated)

When admitted, local plan evaluation is narrow by construction:

- **Scope:** the evaluator reads only the fragments (and the adjacent
  optimistic overlay, per its owners) of the single materialization address
  being answered. Cross-address reads, cross-query row sharing, and any
  join over rows the result is not authorized to expose are refused —
  normalization stays behind LLP 0157 §D7's unamended gate.
- **Parity:** the same plan evaluator as the server, or two evaluators
  under a conformance corpus, must produce the server's canonical result
  ordering and projection; the corpus is proposed as an LLP 0051 D5
  extension (LLP 0157 OQ9 — that owner decides; if declined, a standalone
  corpus with the same pinned-identity discipline).
- **Honesty:** evaluation output is presentation over the base fragments'
  completeness and freshness facts; it never upgrades `unknown`, never
  proves absence from unhydrated rows, and never mints or extends a proof.
- **Uses:** re-projection/filter/order refresh within a retained result
  (LLP 0051's committed narrow site), optimistic-overlay recomputation over
  the retained base, and — with Move 3's IR machinery, owned elsewhere —
  boot-time replay reading this store.
- **Ship gate:** amendments landed (at acceptance) **plus** the conformance
  corpus passing on every claiming carrier **plus** the §Acceptance
  evaluation oracles. Document acceptance alone ships nothing.

## D8 — The agent-safe seam (LLP 0161 OQ5)

LLP 0161 OQ5 asks which agent-ideal properties the LLP 0155 local-sync
direction needs natively on the *client* store, and whether that pulls any
sequencing forward. LLP 0162's Non-goals keep the client store outside the
host-side profile (owned by LLP 0043/0053/0090 and LLP 0155's client arm).
The answer, per property:

| | Property (LLP 0161) | Client store disposition | How |
| --- | --- | --- | --- |
| P1 | fork | **never native** | Client speculation is the optimistic-layer stack (LLP 0107/0114/0133): presentation-only layers, rebase not promotion, no storage fork, no merge. Host forks reach the client as different activations/streams — an LLP 0158 derived deployment has its own identity, so its materializations derive different `QueryMaterializationKeyV1` addresses and its outbox is fenced by the LLP 0053/0059 barriers; fork isolation falls out of addressing, not new machinery. |
| P2 | maintained digests | **consumed** | The store verifies server-issued digests and signatures (`ResultDigestV1`, proof signatures, `mset1`/`seq1` content digests) at commit, boot, and render; it maintains no Merkle structure and derives no digest authority. |
| P3 | provenance | **consumed via identity binding** | Every record binds its authority partition, activation, and (outbox/layers) producing mutation identity — LLP 0157/0043/0053 obligations already. No per-commit principal journal exists client-side, and none is needed: the client is not an audit substrate. |
| P4 | history | **never native** | The only temporal fact is `retained` freshness at a proof/version — as-of labeling, not as-of reads. Bounded record history is host-side (LLP 0088, LLP 0162 §6); the client never synthesizes historical states. |
| P5 | read/write sets | **never in v1; narrow at the evaluation seam** | Local-read admission classes belong to Move 3's owners (LLP 0129/0051/0133). The store stores references; post-amendment, the evaluator's read scope is statically the single address (§D7) — a declaration, not captured-set machinery. |
| P6 | replay | **split: ingestion consumed, intent replay native and shipped** | Journal-delta ingestion is the consumed LLP 0090/0034 lane (the sync engine already replays the server journal — the prior art OQ5 itself cites). Durable *intent* replay is the outbox: native, shipped, exactly-once (LLP 0043). Boot-time IR replay over this store arrives with Move 3, reading the store, not implemented by it. |
| P7 | evolution | **native, narrow** | Versioned store formats with fail-closed compatibility refusal and pending-intent-preserving migration (§D1) — LLP 0126's Triplit-style compatibility-refusal prior art. Opaque fragments are the schemaless-view move from the same survey: application schema changes rotate identity (activation → new address → fresh sync) instead of migrating client rows; the store needs no client-side schema migrator for application data. |
| P8 | settlement | **native and shipped — the strongest row** | The durable ordered outbox, exactly-once settlement, acknowledgement ledger, and refuse-at-capacity custody are this store's obligations (LLP 0043). The LLP 0163-family client contracts land here too: client-minted `operationId` reuse across retries, atomic persistence of server-preallocated identity ranges before use, uncovered-queueing on range exhaustion, and honest handling of `result-expired` / `identity-horizon-passed` (outcome-unknown, never recorded terminal `failed`) — all already landed as dated LLP 0043/0012/0095 amendments (2026-08-03). |
| P9 | admission | **enforcement native, policy consumed** | Fenced compare-and-commit on every operation, the store-wide authority barrier, single-writer locks, and delete/quarantine-before-read enforce LLP 0053/0059 policy the store never sets. The §D3/§D5 custody budgets are the client-side resource-bound half of P9. |

**Sequencing answer:** nothing is pulled forward. The client store consumes
only landed contracts (LLP 0157's records; the 2026-08-03 identity/retention
amendments) and requires no LLP 0163/0164/0165 implementation, no commit
envelope, no fork substrate, and no proof-domain machinery to ship. The
Track B specs owe this store nothing new, and this store claims none of
their surface — coordination is complete when both sides keep citing the
same landed amendment set.

## D9 — Carriers, storage profiles, arms, and the bundle

### Carrier matrix

| Carrier | Profile ceiling | Notes |
| --- | --- | --- |
| Browser IndexedDB + Web Locks | `durable-fragments-v1` | the §D1 successor schema; multi-tab per shipped lock discipline |
| File (Node) | `durable-fragments-v1` | v3 blob format; lock-file liveness discipline |
| Expo/native registered files | `durable-fragments-v1` once LLP 0043's durability qualification holds (the shipped adapter is `durable: false` for settlement custody today) | rides the same file format |
| Memory | `volatile-online-v1` | honest degradation; restart `unknown`; durable requests refuse with the structured GAP |
| SQLite (any target) | `durable-fragments-v1` | permitted behind the DK-9 seam, required nowhere |

Every carrier implements the same semantic operations; capability reports
name the implementation, durability, profile, and reason (the shipped
`rqsStoreInfo` surface generalized to the store domain). A target that
cannot honor a requested profile refuses at registration, never silently
degrades.

### Arms

- **JS/React (Full client):** the primary consumer; hooks project
  freshness/completeness/retention facts per LLP 0107/0114.
- **Contract arm:** keeps its stricter lease/barrier custody path and its
  separate LLP 0043 store in v1, honestly advertising its narrower profile
  (LLP 0157 §D7 permits exactly this); whether it converges on an identical
  materialization contract or a deliberately narrower one is LLP 0155
  OQ16, staged behind §D6's migration rules (OQ5).
- **Micro (LLP 0147):** excluded — Micro v1 explicitly omits RQS, retained
  reads, the durable outbox, and local execution; this store is a
  Full-profile capability (LLP 0145's packaging classes), and any
  local-sync Micro module is a separate LLP 0147-family proposal.

### Bundle accounting

Per LLP 0155's commission, the first shipping slice records its measured
Full-client attribution (module-own bytes for the store sections, against
LLP 0145's F2 module rows for the shipped store family — RQS core and
stores 16.5 kB, RQS file store 7.8 kB, shared canonical-value/outbox code
6.7 kB, minified module-own) as a measured artifact, not a prose claim;
rollout stays additive under LLP 0145's rule (new capability surface,
never a narrowing of a published entry point).

## Guardrails

- The sync set is the registration set: no unregistered materialization is
  hydrated or retained; every retained byte has a nameable reason.
- The store never widens an owner classification — not retention, not
  liveness, not authorization; a registration is interest, never authority.
- No local answer claims authority without a valid witness for its exact
  scope, version, and authority partition; `unknown` is the honest default;
  nothing local mints, extends, or upgrades a proof.
- Eviction never overrides an LLP 0053 disposition, obligation, lease
  deadline, or tombstone; never evicts pending intent, unacknowledged
  settlement state, or an `active` registration; and is never a substitute
  for an identity barrier.
- Migrations preserve pending intent and acknowledgement custody or refuse;
  corrupt/future bytes are typed diagnostics preserved in place; only
  `wipe` (retained state + outbox, atomically) resets a store.
- One logical result is never renderable under two address families;
  legacy records are never relabeled in place.
- No SQL semantics in the client contract; no cross-query normalization;
  no cross-address evaluation; no client-side authority over completeness.
- Single writer per store; non-writers adopt, never write.

## Executable acceptance

LLP 0157's oracles A5–A9 and its transcribed Move-2 carrier exit (browser
terminate/relaunch over real IndexedDB, two contending tabs, file/native
relaunch, retained render while unreachable, the authority-transition
matrix, bounded custody under churn, footprint/hydration measurements)
gate the shared substrate and are consumed, not duplicated. This Spec adds
store-policy oracles:

1. **S1 — sync-set fidelity.** Register/unregister across all three
   sources; the hydrated and retained set equals the registration set plus
   in-grace releases at every step; an unregistered query never hydrates;
   inspection names each record's retaining registrations; release starts
   grace; grace expiry evicts.
2. **S2 — completeness-honest answer matrix.** For each address family ×
   {proof/token/lease valid, absent, expired, wrong-scope} × {outbox empty,
   pending} × {connected, offline}: the answer class (authoritative-current
   / authoritative-retained / labeled-retained-legacy / `unknown` /
   `refused`) matches this Spec's tables exactly; no cell fabricates
   authority; auth-scoped expiry deletes before read; pending outbox
   withholds `resumeFromToken` while rendering `retained` +
   `pendingIntentsAtSeed`.
3. **S3 — TTL and eviction under pressure.** Fill past budget with mixed
   `active`/`idle`/`released` records, pending intent on some, unresolved
   obligations on others: eviction follows §D5's order, skips every
   blocker, refuses rather than evicting `active`, keeps page-set manifests
   and fragments atomic, and leaves obligations/tombstones intact for their
   barriers; over-budget single entries refuse.
4. **S4 — successor-store parity.** The shipped store-parameterized resume
   suite (`rqs-resume-suite.mjs`) passes unmodified against the successor
   store format on every carrier; the D3 outbox rule, arbitration,
   multi-tab adoption, `inProgress` refusal, and purge-on-invalidation
   behaviors are byte-compatible for the legacy section.
5. **S5 — migration and coexistence.** A store with legacy resume entries,
   legacy lease records, and pending outbox intent migrates formats: intent
   preserved exactly (order, identity, acknowledgements); lease records
   adopt `qmk1` only when every identity fact recomputes, atomically, else
   remain non-renderable under the old fence; no logical result renders
   under two families; crash at every migration write boundary leaves the
   prior or successor state, never a hybrid.
6. **S6 — evaluation gate.** Before the amendments/corpus: any local
   evaluation attempt refuses with the registered closed reason and serves
   opaque-snapshot semantics only. After: the conformance corpus passes at
   pinned identities on every claiming carrier; evaluation output over a
   known fragment set byte-matches fresh server execution of the same plan
   at the same version; cross-address evaluation refuses.
7. **S7 — rotation versus eviction.** Rotate authority (user switch) and
   activation (deploy) with the store at budget pressure: predecessors are
   destroyed/quarantined via the barriers before any successor renders,
   regardless of eviction state; eviction alone never stands in for a
   barrier (probe: a barrier-pending record is not evictable-to-skip the
   barrier).
8. **S8 — capability honesty.** Each carrier reports implementation/
   durability/profile truthfully; a durable request on a volatile carrier
   refuses with the structured GAP; version-skewed store opening fails
   closed with its stable diagnostic.

## Migration and compatibility

- Existing `liveQuery`, generated references, hooks, and the Contract arm
  are unchanged; registration is additive (active use already registers;
  routes manifests already preload).
- The Channel B store's contents migrate by format version under §D1's
  rules; its public behaviors (S4) are preserved for the legacy section.
- The LLP 0043 lease store remains a separate artifact until its records
  individually adopt `qmk1` under the dated rules; nothing here amends its
  custody semantics.
- Wire compatibility: this Spec adds no frame; the proof-backed resume
  credential (OQ2) and any registration wire surface are dated
  LLP 0093/0094 amendments when proposed.
- Capability manifests distinguish implementation presence, carrier
  evidence, and product maturity (LLP 0155 P6); no capability advances on
  this document's acceptance.

## Non-goals

No whole-table or whole-database replication; no client-owned
authorization; no offline authority over shared data; no cross-query
canonical-row normalization (LLP 0157 §D7's gate, untouched); no aggregate
nodes (LLP 0130 SD-2); no second sync engine beside LLP 0090's; no client
mutation execution semantics (Move 3, LLP 0129/0133); no host-side
agent-safe primitives (LLP 0163/0164/0165); no encryption-at-rest claim
(LLP 0090 Q4's baseline stands); no Micro-profile packaging; no change to
outbox/settlement custody semantics (LLP 0043's, composed not amended).

## Open questions

1. **A `single_table_v1` node class** — registering the shipped
   `rqsEligible` population's plan shape as an owner-governed node class
   (LLP 0004/0007 family proposing into LLP 0157 §D1's registry, inside its
   growth stop rule) would give the legacy resume family plan identity,
   proofs, and `qmk1` addresses. Owners' decision; this Spec only stages
   the adoption path (§D6).
2. **A proof-backed resume credential** for `qmk1` materializations —
   binding resume-token identity to the materialization key and held proof
   so fresh establishment can use ladder rungs 1–2; dated
   LLP 0090/0093/0094 amendments.
3. **A `warm` sync class for idle registrations** — standing subscriptions
   for preloaded-but-unmounted queries; needs fan-out cost evidence before
   any obligation is created.
4. **Budget and TTL values** — §D3/§D5's v1 constants await LLP 0155 OQ9's
   frozen Triage/Fleet custody and hydration budgets for their first
   measured revision.
5. **Contract-arm convergence** (LLP 0155 OQ16) — identical materialization
   contract or deliberately narrower profile; staged behind §D6's
   migration rules either way.
6. **Encryption at rest** (LLP 0090 Q4) — unchanged baseline (OS-level
   protection); any change is that owner's.
7. **Conformance-corpus ownership** (LLP 0157 OQ9) — proposed as an
   LLP 0051 D5 extension; that owner decides; §D7's gate binds to
   whichever home results.
8. **The registration authoring surface** — the concrete generated API for
   `programmatic` registration and per-registration TTL/priority (successor
   of `persistResume`/`persist: false`), landed with the codegen owners
   under LLP 0004/0131 conventions.
9. **Mixed-route register groups** — the LLP 0090 mixed-route successor's
   versioned profile; when it lands, its per-child liveness facts flow into
   §D2's obligations without new inference here.

## Status

Draft, v0.1 — authored 2026-08-03 by the wave-3 Track A session under the
commission in `issues/20260803-0155-move2-spec-commission.md`. The
dual-family super-refine loop (LLP 0005) has not yet run; the document
should not be consumed as a stable contract until the loop concludes and
Charlie accepts. On acceptance: the §D7 amendments land dated in LLP 0008
and LLP 0080; boundary notes land in LLP 0043, LLP 0053, and LLP 0090; and
the implementation program is commissioned separately (wave-3 Track A's
exit rule).
