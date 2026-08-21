# LLP 0282: Provider-composable hosting profiles

**Type:** RFC
**Status:** Draft
**Systems:** Hosted execution, Deployment, Control plane, Autoscaling, Storage,
Realtime, Background work, Provider adapters, Capability claims, Testing
**Author:** Seth Webster / Codex
**Date:** 2026-08-21
**Revised:** 2026-08-21 (initial draft for human review)
**Related:** LLP 0000, LLP 0007, LLP 0009, LLP 0014, LLP 0036, LLP 0047,
LLP 0060, LLP 0070, LLP 0072, LLP 0098, LLP 0103, LLP 0104, LLP 0189,
LLP 0217, LLP 0225, LLP 0269, LLP 0276

## Summary

Snapback should let one hosted environment compose infrastructure from several
providers. For example, Cloudflare may run functions and own live connection
coordination while Supabase provides the authoritative Postgres database.
Another environment may use a container runtime, a different Postgres host,
and S3-compatible object storage without changing application schema,
functions, clients, or observable data semantics.

The composition unit is a versioned **hosting profile**. A hosting profile
selects one Adapter for each required Interface, pins their identities and
capabilities, and passes one end-to-end conformance corpus. Snapback supports a
combination only after the combination passes. Passing the compute Adapter and
the database Adapter separately is not enough.

This RFC proposes capability-specific Interfaces for function compute,
placement, ingress, the authority store, realtime coordination, durable work,
object storage, secret custody, telemetry, and external control authority. It
rejects both a single large provider Interface and an arbitrary cross-product
of unqualified Adapters.

The first proposed proof profile is Cloudflare Workers for function compute,
Cloudflare Hyperdrive for database transport, Supabase Postgres as the
authority store, Cloudflare Durable Objects for live connection coordination,
Cloudflare Queues for durable wakeup, and Cloudflare R2 for object storage.
That profile is a proposal and carries no capability claim.

## Review posture

This document is a design draft for human review. It does not amend an Accepted
LLP, authorize implementation, or advertise a hosted capability.

The proposal is directionally sound, but the initial formulation needed five
constraints before it was safe to implement:

1. "Provider agnostic" means stable Snapback semantics across qualified
   profiles. It does not mean that provider internals are interchangeable.
2. A profile is selected for an environment or transactional cell. A request
   does not choose its providers dynamically.
3. The complete provider tuple is the unit of qualification, support, billing,
   and incident diagnosis.
4. Stateful scale-out needs declared transactional cells and connection
   ownership. Stateless function fanout alone does not scale Snapback.
5. One control authority must fence mutations across every provider in the
   profile. Independent provider success responses cannot form a distributed
   transaction by assertion.

The recommendation is to ship curated composed profiles first. The control
plane may expose the underlying capability choices, but it should refuse an
untested combination.

## Motivation

LLP 0072 defines a provider-neutral control-plane contract, but its target
Adapter maps the whole hosted profile to one provider-specific implementation.
Its first profile deliberately excludes autoscaling, horizontal realtime,
zero-downtime deployment, and managed-platform economics.

LLP 0014 defines Cloudflare-specific seams for connection ownership, durable
state, runtime isolation, secrets, assets, cron, and background work. LLP 0269
separately proposes an authority-store Interface for SQLite and Postgres. LLP
0276 gives JavaScript execution its own Module and keeps target-local
implementations outside the Rust crate graph.

Those documents leave one decision open: whether a hosted target is one
provider Adapter or a composition of capability Adapters. This RFC chooses the
second model, with qualification at the composed-profile level.

The choice matters for common deployments. A team may want Cloudflare Workers
for serverless compute but prefer managed Postgres from Supabase, Neon, or an
existing cloud account. A single-provider target model either forbids that
deployment or hides the composition inside one large Adapter. Hiding it loses
provider identity, failure, cost, region, and recovery facts that the control
plane needs.

## Goals

This RFC has the following goals:

- Preserve one Snapback application model across qualified provider
  combinations.
- Let an environment select different providers for compute, data, queues,
  objects, secrets, and telemetry.
- Keep provider credentials and provider-specific objects out of application
  code and the contract types leaf.
- Give every hosted capability an exact provider, Adapter version, region,
  limit, and conformance identity.
- Scale stateless function execution independently from stateful authority
  cells.
- Preserve scale-to-zero where a target has a qualified wake path.
- Refuse combinations that cannot preserve Snapback transactions, live
  invalidation, authorization, recovery, and capability honesty.

## Non-goals

This RFC does not propose:

- a universal infrastructure-as-code language;
- arbitrary provider combinations without profile-level proof;
- provider selection per request;
- distributed transactions across providers;
- automatic failover from one database provider to another;
- live migration between providers;
- one lowest-common-denominator feature set;
- automatic adoption of Supabase Auth, Realtime, Storage, or Edge Functions
  when a profile selects Supabase Postgres;
- a claim that Cloudflare plus Supabase is implemented;
- multi-region write authority before LLP 0269 defines and proves cells; or
- a replacement for the target-specific designs in LLP 0014, LLP 0072, LLP
  0103, or LLP 0269.

## Governing constraints

Every implementation of this RFC must preserve these constraints:

1. **The storage kernel owns transactions.** Only the authority-store Adapter
   may implement the canonical application-store commit operation. Domain
   Modules and provider Adapters cannot open a second application transaction.
2. **Application semantics remain target-neutral.** A profile may refuse an
   unsupported function, migration, query, or execution class. It cannot
   change ordering, null behavior, authorization, commit results, cursors, or
   error meaning.
3. **External work stays outside database transactions.** Function execution
   may prepare work before the commit fence, but provider calls, object
   transforms, queue delivery, and network waits cannot hold the authoritative
   transaction open.
4. **The contract corpus is the cross-language authority.** Target-local
   implementations bind generated schemas, wire fixtures, and conformance
   records. They do not link Rust implementation modules.
5. **Capabilities are tuple-scoped.** A capability claim names the complete
   hosting profile, every Adapter and version, every provider and region, and
   the exact conformance receipt.
6. **No silent fallback exists.** If an Adapter or provider is unavailable,
   stale, incompatible, or over budget, the operation returns a classified
   refusal or degraded result. The control plane does not switch providers
   without an explicit reviewed transition.
7. **One external control authority fences lifecycle changes.** Deployment,
   activation, rollback, restore, routing, worker admission, and effect
   admission bind one monotonic profile generation and operation fence.

## Proposed architecture

### One profile composes several Modules

A hosted environment binds one immutable hosting-profile generation:

```text
Developer control plane
          |
Release and environment controller
          |
Versioned hosting profile
          |
 +--------+-----------+------------+-------------+
 |        |           |            |             |
Ingress  Compute   Placement   Authority store  Durable work
                     |              |
                Realtime cells   Commit journal
```

The profile contains the configuration and identity for each Adapter. The
profile does not expose provider credentials to application code.

The exact source schema is an implementation design output. This example is
illustrative and is not an existing authoring interface:

```json
{
  "profile": "composed-hosted-v1",
  "compute": {
    "adapter": "cloudflare-workers",
    "runtime": "workerd"
  },
  "placement": {
    "adapter": "cloudflare-placement"
  },
  "authorityStore": {
    "adapter": "snapback-postgres",
    "provider": "supabase",
    "transport": "cloudflare-hyperdrive"
  },
  "realtime": {
    "adapter": "cloudflare-durable-objects"
  },
  "durableWork": {
    "adapter": "cloudflare-queues"
  },
  "objects": {
    "adapter": "cloudflare-r2"
  }
}
```

### Function compute Module

The function compute Module owns staged runtime generations and bounded
invocation. Its Interface must cover:

- stage and verify one content-addressed runtime generation;
- invoke a declared function under an exact authority and limit profile;
- cancel or time out one invocation;
- drain one generation before retirement;
- report structured resource use and a classified outcome; and
- prove that stale generations cannot commit or publish effects.

The Interface hides isolate creation, warm pools, provider script ids, runtime
bindings, and process lifecycle. Local Ibex, local or hosted V8, workerd, and a
deterministic in-memory Adapter are expected implementations.

Function compute does not own routing, placement, durable transactions,
realtime connection state, or provider lifecycle operations.

### Placement and autoscaling Module

The placement Module decides where admitted work runs. Its Interface owns:

- desired capacity or provider-managed capacity policy by environment,
  generation, and transactional cell;
- admission and concurrency ceilings;
- scale-to-zero and wake-on-demand state;
- warm-capacity policy;
- health replacement and overload refusal;
- generation-aware drain and rollout; and
- region and cell placement decisions.

The scale unit is not always one function. Stateless actions may run on many
workers. A transactional cell owns one stream, commit order, journal, replay
floor, and invalidation domain under LLP 0269. Live connections also need a
declared owner or routing path.

An Adapter may delegate instance counts to a provider-managed autoscaler. It
must still report the admitted concurrency, placement, drain, overload, and
wake behavior. Snapback does not require every provider to expose an instance
count control.

Scale-to-zero is supported only when every source of future work has a proved
wake path. HTTP ingress, live connection demand, queue messages, cron, delayed
jobs, provider webhooks, and restore work each need an explicit disposition.
An idle compute pool with an unwakeable durable job is not scale-to-zero.

### Ingress and connection Module

The ingress Module owns:

- TLS and the canonical public origin;
- routing by app, environment, release, and transactional cell;
- request and WebSocket admission;
- connection ownership and reconnect routing;
- health-aware traffic movement;
- old-generation drain; and
- authenticated transport to function compute and realtime coordinators.

Ingress cannot infer application authority from routing data. It passes the
closed request envelope to Auth and the engine.

### Authority-store Module

The authority-store Interface is the one proposed by LLP 0269. It owns:

- snapshot reads;
- mutation preparation and commit;
- read-set validation;
- schema and migration operations;
- stream identity, commit versions, the journal, and the replay floor;
- reset, import, backup cut, and restore cut;
- settlement and commit envelopes; and
- typed system commits that share application atomicity.

SQLite and Postgres are distinct Adapters at this seam. Supabase, Neon, RDS,
and self-hosted Postgres are provider configurations of the Postgres Adapter,
not separate application semantics.

The request-time database transport and the control-plane management transport
are separate facts. A serverless request path may use a connection-pooling
transport. Migrations, backup, replication, and restore may require a direct or
provider-management connection with different credentials and limits.

### Realtime coordination Module

The realtime Module owns live connection state, subscription demand,
invalidation delivery, cursor state, fanout, and resnapshot decisions. It does
not own the authoritative application transaction.

A remote Postgres profile cannot assume that the request-time connection
transport provides a durable notification channel. The profile must provide a
proved commit-journal delivery path to the realtime coordinator. The path may
use a queue, an owned relay, polling with a bound, or a provider-native feed
that passes the same corpus.

### Durable-work Module

The durable-work Module owns transactional enqueue, claims, leases, retry,
fencing, idempotency, terminal outcomes, and dead-letter inspection under LLP
0070. A provider queue may supply wakeup and delivery, but Snapback's job and
attempt records remain the authority unless a future profile proves a stronger
equivalent contract.

Cron, notification delivery, payment commands, asset processing, webhook
reconciliation, and application jobs consume this Module. They do not each
define a provider retry loop.

### Object, secret, and telemetry Modules

Object storage owns immutable object identity, read-back verification,
retention, deletion, and scoped delivery. Asset policy and metadata remain in
Snapback data.

Secret custody owns provider credential handles, retrieval authority,
rotation generations, redaction, and audit. A composed profile can hold
credentials in more than one provider, but the external control authority
must bind every handle and generation.

Telemetry records operation and resource facts for diagnosis and metering. It
is not payment, audit, or authorization authority.

## Cloudflare compute with Supabase Postgres

### Proposed request path

The first proof profile uses this request path:

```text
Mobile client
    |
Cloudflare ingress and Worker
    |
Snapback function runtime
    |
Cloudflare Hyperdrive
    |
Supabase Postgres
```

Cloudflare documents Hyperdrive support for Supabase Postgres and recommends a
direct Supabase connection rather than a Supabase pooled connection because
Hyperdrive performs connection pooling. The profile should use a dedicated
least-privilege database role. External source consulted 2026-08-21:
<https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/>.

Supabase documents direct, session-pooled, and transaction-pooled connection
modes. Direct connections are intended for long-lived and management work,
while transaction pooling is intended for serverless clients. A Snapback
profile that uses Hyperdrive must follow Cloudflare's provider-specific direct
connection guidance rather than layering two transaction poolers. External
source consulted 2026-08-21:
<https://supabase.com/docs/guides/database/connecting-to-postgres>.

### Transaction and cache posture

The authoritative write and read path must preserve Snapback's freshness and
commit semantics. Hyperdrive read caching does not automatically invalidate
cached results after a write. The first proof profile must disable caching for
authority-sensitive queries unless a later design proves an exact cache
admission and invalidation rule.

Hyperdrive uses transaction pooling. Snapback must keep transactions short and
must not depend on connection-local state outside the transaction. The
Postgres Adapter qualification must cover prepared statements, session state,
transaction isolation, timeouts, pool exhaustion, and connection replacement.

External source consulted 2026-08-21:
<https://developers.cloudflare.com/hyperdrive/concepts/how-hyperdrive-works/>.

### Realtime path

Hyperdrive does not support PostgreSQL `LISTEN` and `NOTIFY`. The first proof
profile therefore cannot use them as Snapback's invalidation authority. A
successful Postgres commit must publish through the Snapback journal and a
proved wake path to the Durable Object that owns affected subscriptions.

The initial candidates are:

1. commit a durable outbox row with the application write, then have a
   Cloudflare Queue consumer advance delivery to the Durable Object;
2. run a bounded journal reader that publishes committed versions to the
   Durable Object; or
3. adopt a provider change feed only after it passes transaction grouping,
   duplicate delivery, retention loss, failover, and resnapshot tests from LLP
   0269.

The profile must select one path. A best-effort notification after commit is
not enough.

External source consulted 2026-08-21:
<https://developers.cloudflare.com/hyperdrive/reference/supported-databases-and-features/>.

### Management path

The control plane needs a separate management path for:

- schema migration;
- backup and restore;
- replication configuration;
- role creation and rotation;
- provider health and capacity inspection; and
- destructive environment lifecycle operations.

Request-time function credentials cannot perform those operations. The
control plane records the exact management Adapter, provider project, database
identity, credential handle, and operation receipt.

### Failure domains

This profile has at least four independent failure domains:

- Cloudflare ingress and Worker execution;
- Hyperdrive connectivity and pool state;
- Supabase Postgres availability and capacity; and
- the realtime or queue coordination path.

The profile must classify each failure and its combinations. A healthy Worker
does not imply a healthy application. A successful database commit with a
failed invalidation handoff is a recoverable delivery condition, not a failed
transaction and not a completed live update.

## Capability admission

### Adapter qualification

Each Adapter publishes a closed qualification record with:

- Interface and Adapter version;
- provider, account, region, and resource identity;
- supported operations and limits;
- credential and secret-custody class;
- failure and retry behavior;
- data residency and network path;
- cost-meter identity;
- retained conformance evidence; and
- explicit unsupported operations.

Adapter qualification proves the Adapter in isolation. It does not qualify a
hosting profile.

### Profile qualification

The hosting profile runs a composed corpus that covers:

- deploy, activate, drain, rollback, and restore;
- schema and function compatibility;
- request routing and authority propagation;
- query and mutation semantics;
- transaction ambiguity and retry;
- live initial snapshot, invalidation, reconnect, and resnapshot;
- queue, cron, and delayed-job wakeup;
- Auth revocation and authorization invalidation;
- asset upload and delivery when claimed;
- provider and network partial failures;
- scale-to-zero and cold wake;
- autoscaling admission, replacement, and drain;
- secret isolation and rotation;
- usage attribution and spending limits; and
- backup, restore, and stream-incarnation changes.

The retained receipt binds the complete Adapter tuple. Replacing only the
database transport, region, queue, or secret store creates a new profile
generation and requires the affected composed corpus.

### Curated profiles

The initial control plane should expose named profiles, not an arbitrary
provider matrix. Examples may include:

- `local-sqlite-ibex-v1`;
- `single-instance-container-vm-v1`;
- `cloudflare-durable-object-v1`; and
- a future `cloudflare-supabase-postgres-v1`.

Profile names are illustrative until the owning schemas freeze them. A custom
profile may exist for development or research, but it cannot inherit a support
or production capability claim from its individual Adapters.

## Control authority and lifecycle

The external control authority from LLP 0072 remains the lifecycle
linearization authority. This RFC extends the state it must bind to include:

- the complete hosting-profile identity and generation;
- every Adapter, provider account, region, and resource identity;
- compute, placement, ingress, database, realtime, queue, object, secret, and
  telemetry generations;
- the active and staged release;
- serving, write, worker, queue, webhook, notification, and payment-effect
  admission state;
- backup, restore, replication, and retention generations; and
- the last completed composed operation receipt.

One provider cannot silently become the authority for another provider's
state. The control authority records observations and fences, then drives a
reviewed state machine. A lifecycle operation that crosses providers must
define its last durable fact and deterministic recovery for every interruption
point.

Activation is not a distributed transaction. The control plane stages all
provider resources while traffic and effects remain fenced. It advances one
external control head only after all required observations match. It then
opens traffic under the new profile generation. If the final routing change is
ambiguous, recovery rereads both the control head and provider routing state
before it acts.

## Placement, latency, and data residency

Provider composition makes network placement part of correctness and product
quality. Every profile must declare:

- the authority-store region and jurisdiction;
- the compute execution region or placement policy;
- the realtime coordinator region and ownership rule;
- the expected network path between each pair;
- latency and timeout budgets for reads, commit, and invalidation;
- data classes that cross provider or jurisdiction boundaries; and
- the behavior when the preferred placement is unavailable.

"Edge compute" does not make a regional database local. A profile whose
compute runs far from its authority store may remain correct but miss latency,
connection, or cost limits. Qualification must measure the composed path.

Autoscaling cannot outrun database capacity. The placement Module consumes
authority-store connection and commit-fence budgets before it admits more
function concurrency. When the database reaches its admitted limit, compute
returns overload or queues work according to the declared policy. It does not
add workers that increase contention.

## Security model

A composed profile increases credential and trust relationships. The design
must keep these authorities separate:

- developer and operator identity;
- application end-user identity;
- function runtime authority;
- request-time database authority;
- database management authority;
- queue publish and consume authority;
- realtime coordination authority;
- object read and write authority; and
- external control authority.

Each Adapter receives only the credentials it needs. A Cloudflare Worker that
can read and write application rows cannot migrate the database, restore a
backup, change the hosting profile, or read control-plane credentials.

Every provider-to-provider request uses an authenticated channel and binds the
environment, profile generation, release, operation or request identity, and
expiry where the provider permits it. Long-lived static database credentials
remain a tolerated provider constraint only when rotation, revocation, scope,
and leak response pass the profile's security review.

## Alternatives

### One Adapter owns the whole target

This is LLP 0072's current model. It keeps the control-plane Interface small and
makes one implementation responsible for coherence. It becomes shallow when a
single Adapter exposes unrelated compute, database, queue, object, secret, and
routing choices. It also hides real cross-provider failure and identity facts.

Keep this model for profiles that are physically one provider, but implement
the Adapter as a named composition behind the same profile contract.

### Arbitrary capability selection

This option lets a user choose any compute, database, queue, and object Adapter.
It maximizes choice but creates an unbounded qualification matrix. It also
invites combinations with no valid invalidation, backup, placement, or fencing
story.

Reject this option for supported production profiles. Permit it only as an
unclaimed research mode with explicit gaps.

### Lowest-common-denominator portability

This option admits only behavior every provider supports. It would make
Snapback easier to describe but would discard provider strengths and still
fail to remove operational differences.

Reject this option. Snapback should keep a portable semantic core and expose
capability-conditioned extensions with exact target claims.

### Provider-specific application code

This option lets app functions import provider SDKs directly for database,
queue, or object work. It is useful as an escape route under the root LLP's
"paved path, not a cage" principle, but it trades away portability and
Snapback's conformance evidence.

Keep it as an explicit opt-out. Provider-specific code cannot satisfy a
portable capability claim.

## Proposed implementation sequence

### Phase 0: decide the profile contract

Before implementation, human review must settle the open questions below and
accept or amend the capability-specific Interface list. The accepted design
must amend LLP 0072's one-target-Adapter wording and record its relationship to
LLP 0269 and LLP 0276.

### Phase 1: freeze the composed-profile artifacts

Define closed schemas for:

- hosting-profile identity and generation;
- Adapter identity and qualification;
- composed capability and limit reports;
- provider resource and credential-handle references;
- placement and residency declarations;
- composed lifecycle observations and receipts; and
- profile-level conformance receipts.

Implement deterministic in-memory Adapters and a two-provider fault simulator
before connecting a real provider.

### Phase 2: qualify the authority-store Interface

Execute LLP 0269 Phase 1. Parameterize the SQLite behavior corpus, extract the
async authority-store Interface, and qualify one Postgres Adapter without
changing application semantics.

### Phase 3: build the Cloudflare and Supabase proof

Build a non-production profile with:

- Cloudflare Worker function execution;
- Hyperdrive connected directly to a dedicated Supabase Postgres role;
- cache-disabled authoritative queries;
- a separate database management path;
- Durable Object connection ownership;
- one selected journal-to-realtime delivery mechanism;
- queue-backed durable wakeup;
- profile-level secret custody and redaction; and
- retained cross-provider failure receipts.

This phase proves composition. It does not claim autoscaling, production Auth,
backup, or public hosting unless their own owners and acceptance gates pass.

### Phase 4: add placement and autoscaling

Define stateless execution concurrency, transactional-cell placement, database
capacity feedback, scale-to-zero wake sources, generation drain, overload
behavior, and cost ceilings. Run the profile corpus under burst, provider
degradation, cold wake, replacement, and rollback.

### Phase 5: add another Adapter in each varied class

A seam becomes convincing when more than one production Adapter uses it. Add
at least one second Postgres provider or compute provider and run the same
profile corpus. Do not add a new Interface only to wrap one provider call.

## Acceptance

This RFC can advance from Draft only after human review answers the decisions
below and scaled technical review checks the storage, distributed-systems,
security, and cost assumptions.

An implementation may claim one composed profile only when retained evidence
proves:

- application schema, function, Auth, and client behavior match the portable
  oracle;
- every Adapter and provider identity matches the reviewed profile;
- request-time and management credentials cannot substitute for each other;
- commit ambiguity, connection loss, pool exhaustion, and retry preserve one
  authoritative outcome;
- live invalidation survives duplicate, delayed, missing, and reordered
  delivery through resnapshot or a proved retry path;
- scale-to-zero preserves every wake source;
- autoscaling respects authority-store and queue capacity;
- release activation and rollback fence stale compute and effects;
- backup and restore cover database, objects, queues, Auth, and stream identity
  with explicit provider dispositions;
- provider partial failures return classified states and retain recovery facts;
- secrets and private data do not enter logs, receipts, build artifacts, or the
  wrong provider; and
- usage, cost, and data residency match the declared profile.

## Decisions for human review

1. **Composition policy.** Accept curated provider-composed profiles as the
   supported product model, with arbitrary combinations restricted to
   unclaimed research mode?
2. **First proof tuple.** Use Cloudflare compute plus Supabase Postgres as the
   first composition proof, or use a locally controlled Postgres provider
   first and keep Supabase as the second Adapter?
3. **External control authority.** Which provider or owned system stores the
   control head for a multi-provider profile, and what prevents either data
   plane provider from bypassing it?
4. **Realtime delivery.** Which commit-journal delivery path should the first
   Cloudflare and Supabase profile prove?
5. **Database transport.** Require a cache-disabled Hyperdrive binding for all
   authoritative reads in v1, or admit a narrowly proved cacheable read class?
6. **Profile granularity.** Bind one profile per environment, or permit distinct
   profiles per transactional cell after LLP 0269 Phase 2?
7. **Placement authority.** Does Snapback own placement decisions, or may a
   provider placement system decide within source-declared region and capacity
   limits?
8. **Supported combinations.** What minimum second Adapter proves that each
   Interface is real rather than an abstraction around the first provider?
9. **Commercial ownership.** Does Snapback bill one combined hosted product,
   or does the user bring provider accounts and pay each provider directly?
10. **Recovery objective.** What recovery time and recovery point objectives
    must the first supported composed profile prove?

## Relationship to existing LLPs

- **LLP 0000:** preserves scale-to-zero, scale-up, multi-target deployment,
  and the paved-path escape.
- **LLP 0007 and LLP 0269:** remain authoritative for portable storage
  semantics, the authority-store Interface, Postgres graduation, and
  transactional cells.
- **LLP 0014:** remains authoritative for Cloudflare-specific topology and
  capability evidence. This RFC permits the Cloudflare target to compose an
  external authority store.
- **LLP 0047:** remains authoritative for hosted function limits and runtime
  failure behavior.
- **LLP 0070:** remains authoritative for durable job semantics. Provider
  queues supply wakeup and delivery only under that contract.
- **LLP 0072:** remains authoritative for lifecycle identities, external
  control authority, fencing, release, backup, restore, logs, and inspection.
  Acceptance of this RFC would amend its whole-target Adapter into a composed
  hosting-profile Adapter.
- **LLP 0103 and LLP 0104:** remain authoritative for the Expo-hosted product
  contract, metering, quotas, and hosted entitlements.
- **LLP 0189:** remains authoritative for scoped claims and proof cadence.
- **LLP 0225:** remains authoritative for commit ownership and dependency
  direction.
- **LLP 0276:** remains authoritative for repository layout and the Rust crate
  graph. Any new Rust crate or rank caused by this design requires a separate
  amendment. Target-local provider Adapters remain under `targets/` and bind
  generated contract artifacts rather than Rust implementation crates.

## Confidence

High that provider composition is a real product seam. The proposed profile
already has at least two plausible compute Adapters, several Postgres provider
configurations, and target-specific queue, object, secret, and realtime
implementations.

High that qualification must bind the complete provider tuple. Cross-provider
latency, credentials, lifecycle, partial failure, and recovery do not compose
safely from independent green checks.

Medium on the exact Interface list. Human review may combine ingress with
placement or separate database transport from the authority store. The first
fault simulator and Cloudflare plus Supabase proof should test whether those
Interfaces are deep enough.

Low on production economics, multi-region behavior, and the first profile's
recovery objectives. This RFC deliberately leaves those as human decisions
and evidence requirements rather than inventing values.
