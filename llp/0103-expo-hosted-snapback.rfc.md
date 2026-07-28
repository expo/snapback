# LLP 0103: Expo-hosted Snapback

**Type:** RFC
**Status:** Accepted
**Systems:** Product, Deployment, Runtime, Storage, Realtime, Auth, Security, Developer experience, EAS Hosting
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-28
**Revised:** 2026-07-28 (initial draft after source review of Snapback, `eas-hosting`, and Universe); 2026-07-28 (/llp-super-refine round 1 revision: owner-independent durable identity with time-versioned ownership attribution; release-pinning cutover fence and repair invariant; interim per-environment scale envelope and at-ceiling behavior; hosted-lifecycle operation contract narrowing the LLP 0089 claim; create-time region placement and backup-security assertions); 2026-07-28 (/llp-super-refine round 2 revision: coordinator-issued release-epoch fence with drain-and-revoke, enforced max socket lifetime/re-pin deadline, and concrete admission compatibility check; scale-envelope storage/write-rate ceilings as Gate-0 outputs of named derivation formulas with pin-before-beta ratification; LLP 0089 retained as contract authority with Universe as hosted implementation authority and an exact operation mapping including rollback; action-isolation mechanism flagged as a 0105 open decision); 2026-07-28 (/llp-super-refine round 3 revision: compatibility window admissible only under a machine-checkable sufficient-by-construction rule with hard drain-and-revoke as default fallback (replay is supplemental evidence, not proof); transfer made an atomic coordinator boundary with admission-bound attribution carried through commit and an open-connection execution fence; hosted operations given distinct stable ids — `environment.create` ≠ 0089 `app.create`, `environment.inspect` ≠ LLP 0024 `app.inspect`); 2026-07-28 (/llp-super-refine round 4 revision: compatibility window admissible only for strictly additive backward-safe schema changes with all constraint/permission/trigger/default/semantic changes forcing hard drain-and-revoke and replay supplemental only; new two-phase app-wide multi-coordinator transfer protocol with atomic ownership publication after all-coordinator ack and abort-on-unavailable; storage ceiling and billed quantity reconciled to the same allocated-non-freelist basis so index/system-table pages are in-band not headroom); 2026-07-28 (/llp-super-refine round 5 revision: app-wide transfer protocol freezes the participant set — global epoch snapshots participants and serializes environment-lifecycle mutations, publication re-validates the set — and adds a durable per-coordinator prepare/commit/abort state machine where prepare freezes old-owner leases, commit revokes/epochs them, abort restores them; "no partial transfer" narrowed to ownership attribution); 2026-07-28 (/llp-super-refine post-convergence touch-up: r6 detail items folded in); 2026-07-28 (Accepted by author Charlie Cheever after /llp-super-refine dual-READY convergence on r6; r6 detail items folded in)
**Related:** LLP 0000, LLP 0007, LLP 0009, LLP 0011, LLP 0012, LLP 0014, LLP 0018, LLP 0036, LLP 0040, LLP 0043, LLP 0044, LLP 0045, LLP 0046, LLP 0047, LLP 0057, LLP 0060, LLP 0070, LLP 0071, LLP 0072, LLP 0087, LLP 0089, LLP 0098, LLP 0104, LLP 0105, https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/, https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/bindings/, https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/pricing/, https://developers.cloudflare.com/durable-objects/, https://developers.cloudflare.com/dynamic-workers/

## Summary

Build **Expo-hosted Snapback** as a first-party EAS product backed by
Cloudflare. Expo owns developer identity, organization and project ownership,
deployment authorization, entitlements, billing, dashboard UX, support, and
the public service contract. Cloudflare owns the edge execution and storage
substrate. Snapback owns the app-facing backend semantics and portable
artifacts.

This is reasonable and materially less work than building a standalone hosted
control plane. EAS Hosting already has the difficult horizontal pieces:

- Expo-authenticated project ownership and plan state in Universe;
- signed, short-lived deployment URLs and signed completion webhooks;
- a Workers for Platforms dispatch namespace for isolated user code;
- immutable deployments, aliases, custom domains, R2 assets, and rollback;
- request, crash, and log inspection in the Expo dashboard;
- request, CPU, and storage usage pipelines through BigQuery and Stripe.

The missing work is not “put the proof Worker behind an Expo domain.” It is a
stateful product plane: stable app/environment identities, per-app Durable
Object data, isolated handler execution, hosted app-user auth, lifecycle and
backup operations, bill-grade attribution for Snapback-specific resources,
and a dashboard/CLI experience that presents one coherent backend.

The recommended launch topology reuses **Workers for Platforms (WfP)** for
untrusted per-release Snapback handler code and keeps durable application data
in a platform-owned SQLite-backed Durable Object. Worker Loader and Durable
Object Facets remain an evidence-gated future optimization under LLP 0087, not
a launch dependency.

## Scope and ownership

This RFC owns:

- the Expo/EAS product boundary for hosted Snapback;
- the Cloudflare service topology and trust boundaries;
- the identity and environment model;
- deployment, activation, rollback, transfer, and deletion semantics;
- the product-completeness boundary for a public hosted beta;
- the division of responsibility among Snapback, `eas-hosting`, and Universe.

It does not set final prices or free quotas; LLP 0104 owns that contract. It
does not authorize implementation phases; LLP 0105 owns the gates. It does not
replace LLP 0014's Cloudflare storage decisions, LLP 0009's untrusted-code
security floor, LLP 0060's hosted-auth security contract, or LLP 0089's
provisioning operation table.

## Evidence from the existing Expo stack

This source review was performed on 2026-07-28. Paths are evidence anchors, not
new authority over the repositories that contain them.

### `eas-hosting`

The repository already provides:

- WfP upload and dispatch under
  `workers/deployment-api/src/services/workerUpload.ts` and
  `workers/dispatcher/src/index.ts`;
- immutable script names derived from development-domain name plus deployment
  identifier;
- R2 asset storage, KV routing/configuration, deployment-state Durable
  Objects, deletion queues, custom domains, and cache invalidation;
- free/paid per-request limits selected by the dispatcher;
- Analytics Engine request/log/crash views and Cloudflare Logpush ingestion;
- R2 storage snapshots delivered to the Expo usage-metrics dataset.

The upload implementation currently attaches only plaintext environment
bindings and preserves only plaintext bindings. Cloudflare's current WfP API
supports service, Durable Object, R2, KV, D1, Queue, Workflow, and other
bindings, but EAS Hosting does not yet expose a safe product contract for
them. Snapback needs a dedicated generated handler Worker with a narrow
platform `HOST` service binding; it must not give ordinary Expo Router code
ambient access to a shared Durable Object namespace.

The dispatcher currently resolves a route to a development-domain name and
deployment identifier. Its route object does not carry stable Expo account,
app, or Snapback-environment ids. Those ids must be added before the route can
be a billing or authorization boundary.

### Universe

Universe already provides:

- `AppEntity`, owner accounts, roles/privacy policies, app transfer history,
  account disable state, and EAS subscription plans;
- `PendingWorkerDeploymentEntity`, `WorkerEntity`, aliases, custom domains,
  immutable deployment records, and signed deployment URLs;
- a `FREE | PAID` Hosting tier derived from the account's EAS plan;
- Hosting billing metric definitions for requests, CPU, and storage;
- Cloudflare Logpush → BigQuery request/CPU rollups, R2 storage snapshots,
  account-period attribution, Stripe usage updates, and invoice descriptions;
- project Hosting pages for overview, deployments, metrics, crashes, requests,
  logs, aliases, and settings.

The current deployment token contains only tier, pending deployment id,
development-domain name, and deployment identifier. Snapback requires stable
account, app, environment, and release ids in the signed claim. Current
request/CPU attribution recovers app/account identity later from hostnames,
development-domain mappings, custom domains, and transfer records. That is
useful compatibility machinery but too indirect to be the only identity path
for a stateful billed backend.

The current Hosting entitlement is intentionally coarse. Every non-Free EAS
plan maps to `PAID`; plan changes fan out over every app development-domain
row. Snapback needs a versioned entitlement object and quota policy, not more
branches on that enum.

## Product contract

### Developer control plane

The Expo account is the developer/control-plane identity:

- an Expo account or organization owns the project and its Snapback service;
- existing Expo project roles authorize create, deploy, promote, rollback,
  inspect, export, restore, and delete operations;
- service principals and Workflows use scoped Expo credentials;
- usage is aggregated and billed to the owning Expo account;
- app transfers move future usage and control authority at an explicit,
  auditable cutover time.

An Expo account is **not** the default identity of an app's end users. Hosted
Snapback still needs the LLP 0057 provider protocol and LLP 0060 security
contract for application sessions. Conflating developer identity with app-user
identity would make the product look easy while leaving its most important
security boundary undefined.

### Project and environment identity

The durable data-plane key is owner-independent:

`(expoAppId, snapbackEnvironmentId)` — or an opaque service/environment id
minted at create time that never changes for the life of the environment.

`expoAccountId` is **not** part of this key. It is a time-versioned ownership
attribution fact: at any instant the environment has exactly one owning account,
but ownership can change (transfer) without changing the durable id. Every
metering event and control-plane record carries the ownership interval in force
when it occurred (see LLP 0104 §Metering identity and event contract), so
attribution follows the owner-at-the-time while identity stays stable.

`devDomainName`, custom hostname, deployment identifier, and alias are mutable
routing attributes, never data-plane identity.

V1 environments are:

- `production`: stable data, explicit promotion, protected deletion;
- `development`: stable non-production data for local/preview clients;
- named preview environments: explicit and TTL-governed, never created merely
  because an immutable web preview URL exists.

An immutable EAS Hosting deployment is a **release**, not a database. Promoting
or rolling back a web deployment selects a Snapback code release for an
environment while retaining that environment's data. Unaliased web previews
default to the development environment unless the deploy explicitly names a
preview environment. This avoids silently creating one paid Durable Object
database for every preview deployment.

### Paved path

The intended first-run experience is:

1. The developer logs into EAS as usual and links or creates an Expo project.
2. `eas deploy` or the Snapback CLI detects a Snapback manifest and offers to
   enable the project service. No Cloudflare account or credential is needed.
3. The CLI uploads web assets/server code and content-addressed Snapback
   schema, permissions, handler, and action artifacts under one signed Expo
   deployment authorization.
4. Admission validates hashes, schema/code compatibility, permissions,
   runtime compatibility, size, and required capabilities. Schema/code
   compatibility is verified by a machine-checkable, sufficient-by-construction
   rule — a declared forward-compatibility contract plus a schema-superset check
   — that authorizes the compatibility-window cutover path; when the rule does
   not hold the cutover falls back to hard drain-and-revoke (representative replay
   is supplemental evidence only; see §Release pinning and cutover fence) — so the
   cutover fence cannot silently degrade.
5. A preview release is deployed without changing production.
6. Promotion changes the web alias and Snapback active code release as one
   operation, or changes neither.
7. The CLI prints the URL, dashboard link, environment, release hash, schema
   hash, migration result, and current usage/free-tier status.

**LLP 0089 remains the contract authority** for the operations it defines —
`app.create` (creating an **app**, with fail-closed defaults),
`code.activate` (active-version selection **including rollback** and the
anti-rollback policy), `code.push`/`schema.push`/`permissions.push`, and artifact
identity/provenance. This RFC does **not** narrow 0089 to artifact provisioning;
0089's `provisioning.v0` table owns app creation, activation, and rollback policy,
and this RFC honors that. Universe is the **hosted implementation authority** for
those operations (authorization with Expo project roles, durable record, and the
Cloudflare-side execution), but the operation contract stays LLP 0089's.

Distinct hosted operations 0089 does not define are owned by this RFC as a
**hosted-lifecycle operation contract**, each with its own stable id, with
Universe owning authorization and the durable record:

- **`environment.create`** — creating an *additional environment* under an
  existing app. This is DISTINCT from 0089's `app.create` (creating an app);
  only genuine app creation maps to `app.create`. `environment.create`'s stable
  id is owned here.
- **`environment.inspect`** — a scoped inspection of a hosted environment's
  state. This is DISTINCT from `app.inspect`, which LLP 0089 reserves to
  LLP 0024's host-ops surface; this RFC does not claim `app.inspect`.
- the hosted **tenant/billing lifecycle** 0089 explicitly omits: named preview
  environment TTL governance, `export`, `restore`, `transfer`, `suspend`, and
  two-stage `delete` (0089's `provisioning.v0` explicitly omits `app.delete` and
  billing/tenant lifecycle).

Each such operation carries an Expo request id and idempotency key (see
§Deployment and lifecycle state machine and §Transfer and deletion).

Exact authority mapping:

| Operation | Contract authority | Hosted implementation authority |
| --- | --- | --- |
| `app.create` (create an **app**) | LLP 0089 | Universe |
| `code.push` / `schema.push` / `permissions.push` | LLP 0089 | Universe + `eas-hosting` |
| `code.activate` (promote) | LLP 0089 | Universe |
| `code.activate` (**rollback**, subject to anti-rollback policy) | LLP 0089 | Universe |
| `environment.create` (additional environment) | LLP 0103 (this RFC) | Universe |
| `environment.inspect` (`app.inspect` stays LLP 0024) | LLP 0103 (this RFC) | Universe |
| export / restore | LLP 0103 (this RFC) | Universe |
| transfer / suspend / two-stage delete | LLP 0103 (this RFC) | Universe |
| preview-environment TTL governance | LLP 0103 (this RFC) | Universe |

If the hosted product needs 0089's own surface to grow — an operation
`provisioning.v0` does not yet express (for example an `app.delete`/lifecycle-v1
surface, which 0089 leaves as a deliberate open question), or a first-class
`environment.create` id ratified into 0089 rather than owned here — that is a
**required amendment to LLP 0089**, noted here as a follow-up rather than silently
contradicted. EAS CLI, Expo dashboard,
Workflows, HTTP, and MCP are projections of LLP 0089 for the operations it owns
and of this RFC's hosted-lifecycle contract for the rest. LLP 0105 §Work
ownership assigns the build.

## Recommended Cloudflare topology

1. **EAS dispatcher.** It retains hostname, alias, cache, custom-domain, abuse,
   and observability duties. Reserved Snapback HTTP/WebSocket paths route to
   the Snapback gateway with signed/stable project and environment context.
2. **Snapback gateway Worker.** It verifies Expo-issued route context, resolves
   the environment registry entry, and obtains the app coordinator Durable
   Object. It never accepts a caller-supplied object id.
3. **Environment coordinator Durable Object.** One SQLite-backed object owns
   rows, version counter, journal, subscriptions, outbox, cron state, config
   descriptors, usage counters, and backup bookmarks. This preserves LLP
   0014's one-`transactionSync` invariant.
4. **Snapback handler WfP namespace.** Each content-addressed code release is
   uploaded as a generated WfP user Worker. Query/mutation code receives only
   the Snapback harness and a narrow `HOST` service binding. It receives no
   database binding and no ambient platform secret. A separate action role or
   demonstrably equivalent kill domain prevents slow/egress work from
   blocking transactional handlers. **That isolation is not deferrable
   (Decision 4); the *mechanism* — two handler/action scripts versus a proven
   independent kill domain — is a 0105 open decision (§Open decisions #3)
   feeding Gate 0, not settled here.**
5. **Host bridge.** The `HOST` service verifies a short-lived,
   invocation-bound capability minted by the coordinator and exposes only the
   generated host-operation table. Calls without a live capability fail
   closed. App code cannot select another app or environment.
6. **R2.** It holds asset bytes, release archives, logical exports, and
   scheduled backup artifacts. Snapback tables retain metadata, ownership,
   permissions, and processing state.
7. **Queues, alarms, and scheduled Workers.** Durable Object alarms own local
   wakeups; Queues own durable retryable work; deployment-wide scheduled
   Workers own platform maintenance. LLP 0070 remains the job contract.

### Why a dedicated handler Worker

Reusing the public Expo Router Worker as the Snapback handler would mix
bindings and trust domains, couple database execution to web routing, and make
coordinator-to-handler invocation depend on a public entrypoint. A second
generated user Worker gives an explicit untrusted boundary, minimal bindings,
independent query/action limits, no public handler route, content-hash
identity, and safe rollback.

It is an internal release component, not a second human-visible deployment.

### Relationship to Facets

Facets should not gate the product. EAS Hosting already operates WfP in
production and its billing/observability pipelines understand WfP Workers. WfP
also matches LLP 0014's assignment for untrusted hosted code.

If LLP 0087's gates pass, stable-id Dynamic Workers or Facets may later replace
the handler namespace. Registry, artifact, host-operation, environment,
deployment, and product contracts stay unchanged.

## Deployment and lifecycle state machine

Each environment records desired, admitted, active, and previous releases.
Every transition has an Expo request id and idempotency key:

`ABSENT → PROVISIONING → READY → UPDATING → READY`

Exceptional states are `DEGRADED`, `SUSPENDED`, `RESTORING`, `DELETING`, and
`DELETED`. A partial Cloudflare upload never becomes active. A completion
webhook reports component-level results, not one boolean.

Activation:

1. persist and verify content-addressed artifacts;
2. upload handler/action Workers with exact bindings and limits;
3. run schema compatibility and migration preflight;
4. stage the registry release;
5. execute the migration under the coordinator's fence;
6. select the release in the environment registry;
7. update the corresponding EAS alias;
8. expose success in Universe.

If steps 5–7 cannot be one distributed transaction, use a fenced saga with a
durable desired-state record, compensating alias rollback, and repair loop.
The public result stays pending until convergence is known.

Code rollback selects a prior admitted, non-denied release. Data rollback is a
separate restore; code rollback never claims to reverse data migrations.

#### Release pinning and cutover fence

The environment registry entry in the coordinator, not the EAS alias, is the
single source of truth for which release is active. The **coordinator is the
ordering authority**: it issues a monotonic **release epoch** and every request
and connection is bound to an epoch by the coordinator itself, not by a pre-read
at the gateway. A gateway pre-read of the alias or registry is only a routing
hint; admission and execution both participate in the coordinator-issued epoch,
so a request cannot pin an old release at the gateway, stall, and then execute
against post-migration state. The alias update in step 7 is therefore a routing
convenience, not the consistency mechanism. This is what makes Decision 5's "one
fenced operation" well-defined even though alias propagation is not instantaneous:

- **Cutover fence (drain-and-revoke).** Step 5's migration runs under the
  coordinator fence; step 6 advances the active release and increments the epoch
  atomically inside the coordinator. Before applying the migration the coordinator
  **drains and revokes the old epoch**: it stops admitting new work under the old
  epoch, lets already-admitted in-flight requests complete within a bounded drain
  deadline, and terminates any that exceed it. A request is bound to an epoch at
  the coordinator when it is admitted for execution; a request bound to the old
  epoch executes against pre-migration data, and one bound to the new epoch
  executes against post-migration data. There is no interval in which new
  frontend code executes against old backend schema or vice versa, because the
  coordinator — not the gateway — decides which epoch a request executes under at
  the moment of execution.
- **Compatibility window is admissible only under a machine-checkable rule.**
  Hard drain-and-revoke is the **default and always-safe path**. The
  compatibility window (accept-old-and-new while the outgoing epoch drains) is an
  **opt-in alternative admissible only when a machine-checkable, sufficient-by-
  construction rule holds**: a **declared forward-compatibility contract** plus a
  **schema-superset check** that is sufficient by construction (the post-migration
  schema is a superset the prior handler can still read/write for the window's
  duration). This rule alone decides admissibility. **Representative replay is
  supplemental evidence, not proof** — it can catch a violation but cannot
  establish safety generally, so it never authorizes the window on its own. **If
  the machine-checkable rule does not hold, the fence falls back to hard drain-
  and-revoke**; there is no "insufficient superset check, so replay decides"
  branch that could silently degrade. Even when the window is admitted it is
  bounded by an **enforced maximum socket lifetime / re-pin deadline**: after the
  window closes, any request or socket still bound to the old epoch is terminated
  and forced to re-admit under the current epoch. A release that can satisfy
  neither the drain deadline nor the machine-checkable compatibility rule is cut
  over under hard drain-and-revoke (its default), not accepted unsafely.
- **Admission compatibility check.** Admission (§Paved path step 4) evaluates the
  machine-checkable rule above: the new release must present a **declared forward-
  compatibility contract** against the immediately prior release, validated by the
  **schema-superset check** that is sufficient by construction. The contract must
  guarantee, by construction, that every old-epoch read and write remains valid
  against the post-migration schema for the window's duration; it admits the window
  **only for strictly additive, backward-safe schema changes** — added nullable or
  defaulted columns, added tables, added indexes — that provably leave every
  old-epoch read and write valid. **Any change to constraints, permissions,
  triggers, existing column defaults, data invariants, or any semantic or data
  migration is NOT window-admissible and forces hard drain-and-revoke.** Passing
  this rule authorizes the compatibility window; failing it does not reject the
  release — it routes the cutover to hard drain-and-revoke. Representative replay of
  the prior release's in-flight request shapes may run as **supplemental evidence
  only** — it never authorizes the window — so the fence cannot degrade to "accept
  unsafely" or silently pick the window path.
- **Open subscriptions.** Already-open WebSocket subscriptions keep their bound
  epoch until they reconnect or until the enforced maximum socket lifetime /
  re-pin deadline elapses, whichever comes first; the coordinator marks
  superseded releases and signals affected connections to re-subscribe, at which
  point they re-bind to the active epoch. A socket that neither reconnects nor
  re-subscribes before the re-pin deadline is closed by the coordinator. No live
  connection silently migrates across a schema boundary mid-stream, and none
  outlives the bounded compatibility window.
- **Non-alias traffic.** Preview-URL and custom-domain traffic that does not
  pass through the promoted EAS alias is pinned identically, because pinning is
  keyed on the registry entry the gateway resolves from stable ids, not on which
  hostname or alias delivered the request. There is no route shape that can
  observe a different active release than the fence selected.

**Repair invariant.** At convergence, every request and connection is pinned to
exactly one admitted release, and the release the coordinator reports active is
the release the alias, previews, and custom domains all resolve to. The fenced
saga's repair loop re-drives alias/preview/domain routing toward the registry
entry; it never advances the registry to match a partially-applied route.

### Transfer and deletion

App transfer opens a new ownership interval at a recorded timestamp: it changes
the owning `expoAccountId` that control and billing attribute to, but never the
durable `(expoAppId, snapbackEnvironmentId)` id. Because identity is
owner-independent, no data-plane object, coordinator, registry row, or open
connection is rekeyed on transfer. Historical usage stays attributed to the
owner whose interval was in force when the usage occurred.

Transfer is an **atomic coordinator boundary**, not merely a recorded timestamp.
Each operation's ownership attribution and budget reservation are **bound at
admission and carried through commit**, so `occurredAt` — the admission-bound
attribution timestamp (LLP 0104 §Metering identity and event contract) — fixes
the owner even for an operation that commits after cutover. At cutover the
coordinator runs an **execution fence for open connections**: it stops admitting
new work, lets admission-bound in-flight requests and open-connection work finish
(or terminates it) under its bound attribution, advances the ownership/lease
epoch, and requires a new-owner lease (LLP 0104 §Authoritative account-budget
protocol) before any newly-admitted work. An operation admitted under the old
owner therefore attributes and charges to the old owner even if it commits after
cutover; nothing newly admitted runs before the new-owner lease exists.

#### App-wide multi-coordinator transfer protocol

The atomic coordinator boundary above is the **per-environment** mechanism, but an
app contains multiple environments (production, development, named previews), each
with its own coordinator Durable Object. An **app-level** ownership transfer is
therefore a distributed operation across every environment coordinator, not a
single-coordinator boundary. It runs as a **two-phase app-wide protocol** driven by
a **durable per-coordinator participant state machine with idempotent prepare /
commit / abort**, so that no partial ownership attribution is ever observable:

1. **Global transfer epoch and frozen participant set.** The app-level
   owner-of-record (Universe / control plane) issues a monotonic **global transfer
   epoch** for the app, enumerates every environment coordinator that must
   participate, and **durably snapshots that participant set** at epoch issuance.
   **The control-plane owner-of-record (Universe) is the serialization authority
   that gates `environment.create`/`delete`/`restore` against the app's active
   transfer epoch**: Universe's lifecycle admission path must consult the app's
   active transfer epoch before admitting any such mutation, so
   **environment-lifecycle mutations for the app (`environment.create`, two-stage
   `delete`, `restore`) are serialized against the epoch: they are blocked or
   queued until the transfer commits or aborts**, and the participant set cannot
   change between enumeration and publication. An `environment.create` **already
   admitted at Universe but whose coordinator does not yet exist at snapshot time**
   is caught by **publication-time re-validation** (step 3) and **aborts the
   transfer** rather than escaping the fence.
2. **Prepare / fence (freeze).** Each participant coordinator, on receiving the
   global transfer epoch, idempotently runs its per-environment fence and records a
   durable `PREPARED` participant state: it **stops admission**, drains/terminates
   admission-bound in-flight work under its **bound attribution** (an operation
   admitted under the old owner settles to the old owner even if it commits after
   cutover; §Metering identity and event contract of LLP 0104), and **freezes**
   old-owner leases (pauses admission and new-lease issuance) **without destroying
   them** — revocation happens at commit — then **acknowledges** prepared.
3. **Ownership publication point (commit).** The app's ownership interval advances
   **atomically only after ALL coordinators in the durable snapshot acknowledge**
   prepared **and the live participant set is re-validated equal to the snapshot**;
   if the set changed, the transfer aborts. Publication is the app-wide cutover:
   each coordinator idempotently **commits** (revokes/epochs its now-superseded
   old-owner leases and admits new-owner work only under a fresh new-owner lease).
   Before publication the old owner is authoritative everywhere; after it the new
   owner is authoritative everywhere. No environment publishes new ownership
   independently. **Partial prepare-time admission pause IS observable and
   expected** across environments during prepare; what the protocol forbids is any
   **partial ownership attribution** — no environment attributes to the new owner
   before the single publication point.
4. **Failure recovery (abort).** If any coordinator fails or is unavailable during
   prepare, or the participant set no longer matches the snapshot, the transfer
   **aborts**: old ownership is **retained** for the whole app, every prepared
   coordinator idempotently **aborts** — it **restores or re-issues its frozen
   old-owner leases** and **requires abort acknowledgements before admission
   resumes** under the old owner. An unavailable coordinator **blocks the
   publication point** and is retried within a bounded window; if it does not
   acknowledge within that window the control plane **explicitly aborts** rather
   than publishing partial new ownership.
5. **Post-publication commit recovery.** A coordinator that acknowledged
   `PREPARED` and then becomes **unavailable after ownership publication but
   before processing `commit`** must **durably redeliver/reconcile the commit**.
   Safety holds because admission stays paused and the global ownership interval
   has already advanced, but the coordinator remains **fail-closed (admission
   paused)** until it **records the committed epoch and obtains a new-owner
   lease** (LLP 0104 §Authoritative account-budget protocol). Commit is
   idempotently redelivered until acknowledged; the coordinator never resumes
   admission under either owner until it has recorded the committed epoch and
   holds a new-owner lease.

The single-coordinator admission-bound attribution (above) remains the
per-environment mechanism; this protocol composes those per-environment fences into
one app-wide atomic ownership publication. New-owner leases (LLP 0104
§Authoritative account-budget protocol) are required per environment before any
post-publication admission.

Deletion is two-stage: disable routing and create a recoverable tombstone;
after a visible retention window, delete Workers, R2 artifacts, secrets,
registry rows, and Durable Object storage. Users can export a portable bundle
before final deletion. Provider deletion is enumerated and retried.

## Security model

Public beta requires:

- WfP user Workers in Cloudflare's untrusted mode;
- a generated, allowlisted, receipt-checked binding list;
- no ambient network for query/mutation Workers;
- separate action execution with declared destinations and secret placement;
- host capabilities bound to app, environment, release, operation, deadline,
  and request id;
- enforced CPU, memory, subrequest, response, concurrency, and queue limits;
- scoped Expo service principals and durable control-plane audit;
- LLP 0060 hosted app-user auth, never dev auth in production;
- adversarial cross-app, identifier, alias, transfer, and stale-release tests;
- suspension of one app without redeploying or impairing others.

Cloudflare isolation is necessary but does not alone satisfy LLP 0009. The host
bridge and attached resources are part of the sandbox.

## Completeness gap matrix

“Closeable” means no known platform impossibility; it does not mean small.

| Area | Current proof | Public hosted beta requirement | Closeable? | Primary owner |
| --- | --- | --- | --- | --- |
| Developer auth | None | Expo account/org roles and service principals | Yes; mostly present | Universe |
| App-user auth | Dev only | External provider, revoke, throttle, invalidate | Yes; substantial | Snapback + Universe |
| Multi-app control | One app/deploy | Stable app/environment registry, suspension | Yes | Universe + Hosting |
| Untrusted code | Explicit gap | WfP handlers, narrow bindings, limits | Yes; security gate | Hosting + Snapback |
| Provisioning | Deploy-time | Content-addressed LLP 0089 operations | Yes | All three |
| Durable data/live | Working proof | Per-environment DO, hibernation, recovery | Yes; core exists | Snapback |
| Offline replay | Missing | Complete-mobile requirement; label if staged | Yes; large | Snapback |
| Retained resume | Missing | Fresh snapshot acceptable in beta if explicit | Yes | Snapback |
| Ephemeral realtime | Missing | Presence/typing or explicit beta gap | Yes | Snapback |
| Assets | Static only | Authorized upload, R2 bytes, processing | Yes | Snapback + Hosting |
| Notifications | Missing | Outbox/providers or explicit beta gap | Yes | Snapback + Universe |
| Cron/jobs | Narrow alarm | Calendar, retries, inspection, dead letters | Yes | Snapback + Hosting |
| Config/secrets | Narrow deploy-time | EAS environments, rotation, audit | Yes | Universe + Snapback |
| Actions/egress | Two shapes | Destination policy, quotas, settlement | Yes | Snapback |
| Query profile | Narrow | Published floor; joins/search may stage | Yes | Snapback |
| Backup/export | PITR primitive only | User-visible restore/export, drills, encryption/key ownership, access logging, deletion propagation, cross-tenant restore-negative tests | Yes; substantial | Snapback + Hosting |
| Postgres | Missing | Not beta blocker if 10 GB ceiling is explicit | Yes, other profile | Snapback |
| Observability | Strong HTTP UI | Function/live/job correlation | Yes | Universe + Hosting |
| Billing | Hosting meters | Stable-id stateful ledger and budgets | Yes; LLP 0104 | Universe + Hosting |
| Abuse | Basic limits | Admission, suspend, evidence, appeal | Yes | Universe |
| SLA/regions | Provider defaults | Published residency/support/SLA; region is a **create-time placement** choice | Yes; policy plus create-time constraint | Expo |

The gap most likely to change substrates is popular-app scale. One coordinator
is a deliberate ceiling, closeable through LLP 0046 Postgres graduation or
later sharding—not by hiding the ceiling.

#### Interim per-environment scale envelope

At launch, before LLP 0046 Postgres graduation exists, every paid environment
has a published, enforced envelope, not merely a distant GA promise. The two
ceilings are **Gate-0 outputs produced by explicit derivation formulas**, so the
number is checkable once produced and 0103 and 0104 pin the same dated value:

- a per-environment **storage ceiling** derived as
  `storage ceiling = 10 GB (LLP 0014 SQLite-backed DO hard limit) − reserved
  headroom`. Both the billed quantity and this ceiling are defined on the **same
  basis: allocated non-freelist SQLite page bytes, with index and system-table
  pages counted in-band** (LLP 0104 §Defining billable "logical SQLite bytes").
  Index/system-table overhead is therefore part of the metered/ceiling quantity,
  not a meter-excluded reserve. `reserved headroom` covers only capacity **not
  already in that quantity**: PITR history depth, compaction/allocation slack, and
  a safety margin so the object never reaches provider exhaustion mid-operation. It
  must **not** double-count index/system-table overhead as headroom. Gate 0
  measures each headroom component against the five-app corpus and produces the
  dated numeric ceiling; the formula and the reserved-headroom basis are named here
  so the value is auditable once Gate 0 runs. The numeric ceiling comes from the
  **same Gate-0 measurement that proves write amplification and reconciles logical
  storage** (0105 P0.4), so a reader does not expect it pinned in this document.
- a per-environment **write-rate ceiling** derived from one coordinator's
  single-`transactionSync` version authority (LLP 0014): Gate 0 measures the
  sustained committed-mutation rate the single writer holds under the row-write
  amplification proven in P0.4 (application rows plus version/journal/subscription/
  outbox rows per mutation), and sets the ceiling below it so sustained write
  fan-out cannot outrun the single writer. It is produced by the same Gate-0
  measurement, not pinned here.

**Pin before beta.** 0103 and 0104 ratification must pin **identical dated
numeric values** for both ceilings, produced by Gate 0, before private paid beta
(0105 Phase 2). Until pinned, both documents carry the formula, the
reserved-headroom basis, and this ratification step rather than a number.

**At-ceiling behavior** is defined and honest: as the environment approaches the
storage ceiling it warns, then refuses new writes with a structured reversible
error while reads, live queries, export, and deletion continue; it never
silently drops a successful write and never fails open into unmetered growth.
The supported exit is user-visible export/graduation, not "pay more to keep
growing on one object." This interim envelope is distinct from the eventual LLP
0046 graduation; 0104 §8 publishes the same ceiling as a paid service limit and
0104's quota section owns the near-cap commercial behavior.

A Durable Object does not relocate after creation (it is placed near its first
`get()`, LLP 0014). Region selection is therefore a **create-time placement**
decision for an environment, not a later toggle: jurisdiction cannot be
retrofitted onto an existing coordinator without a data migration. Phase 4
residency work (LLP 0105) must treat region as chosen at environment creation.
Backup and export artifacts in R2 (§Recommended Cloudflare topology) carry
encryption with declared key ownership, access logging, deletion propagation on
tombstone, and transfer-following ownership; lifecycle receipts assert these and
a cross-tenant restore-negative test.

## Product surfaces required for “slick”

### CLI and Workflows

- one enable/deploy/promote/rollback path using EAS login;
- noninteractive flags and structured JSON for agents/CI;
- preflight for plan, environment, migration, and estimated impact;
- local emulator parity;
- Workflows protections/approvals;
- structured repair diagnostics, never Cloudflare internals.

### Dashboard

- environments and active release;
- schema/data browser with permissions;
- functions, actions, cron, queues, and invocations;
- live connections/subscriptions and ephemeral rooms;
- correlated logs, crashes, traces, and request ids;
- included usage, projected bill, budgets, and limit events;
- secret/config readiness without values;
- backups, restore/export, transfer, suspend, and delete;
- capability/non-claim view.

### Support and trust

- status component and incident correlation;
- pricing docs that agree with invoices;
- migration/export docs before production data;
- privacy/retention inventory across Cloudflare, BigQuery, logs, and backups;
- metadata-only support tooling by default;
- audit for deploy, promote, rollback, secret, export, restore, transfer,
  suspend, and delete.

## Alternatives considered

- **Standalone accounts/billing:** rejected initially; duplicates Expo
  identity, roles, tax, payments, support, transfer, and usage UX.
- **Fly.io first:** remains useful for LLP 0072/Postgres escape hatches but
  does not reuse EAS Hosting's isolation, routing, domains, and metering.
- **Per-app Wrangler services:** useful proofs, rejected as public control
  plane because service configuration scales with app count.
- **App code inside the data-owning DO:** rejected for arbitrary Expo users
  until an untrusted pooling boundary earns LLP 0009/0047 claims.
- **Facets as launch dependency:** rejected; optimize behind a working contract
  later.

## Decisions requiring ratification

1. Expo-hosted Snapback is first-party EAS, not a separate account system.
2. WfP is the launch boundary for untrusted handlers; Facets are optional.
3. Stable identity is Expo app plus explicit Snapback environment; web
   deployments are releases, not databases.
4. Hosted auth, isolation, lifecycle recovery, metering, export, and deletion
   are not deferrable. Other gaps may stage only when explicitly visible. The
   action-isolation *property* is not deferrable; its *mechanism* (separate
   action role vs. proven equivalent kill domain) is a 0105 open decision feeding
   Gate 0.
5. Production web alias and Snapback activation form one fenced operation.

## Status

Draft. This recommends a direction from source inspection; it does not claim
the current proof is a hosted product. Ratify with LLP 0104 and LLP 0105's
Phase 0 evidence in view.
