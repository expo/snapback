# LLP 0103: Expo-hosted Snapback

**Type:** RFC
**Status:** Draft
**Systems:** Product, Deployment, Runtime, Storage, Realtime, Auth, Security, Developer experience, EAS Hosting
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-28
**Revised:** 2026-07-28 (initial draft after source review of Snapback, `eas-hosting`, and Universe)
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

The stable key is:

`(expoAccountId, expoAppId, snapbackEnvironmentId)`

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
   runtime compatibility, size, and required capabilities.
5. A preview release is deployed without changing production.
6. Promotion changes the web alias and Snapback active code release as one
   operation, or changes neither.
7. The CLI prints the URL, dashboard link, environment, release hash, schema
   hash, migration result, and current usage/free-tier status.

LLP 0089's provisioning operations remain the target-neutral authority. EAS
CLI, Expo dashboard, Workflows, HTTP, and MCP are projections of them.

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
   blocking transactional handlers.
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

### Transfer and deletion

App transfer changes control and billing ownership at a recorded timestamp but
does not change the durable id. Historical usage stays with its owner when the
usage occurred.

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
| Backup/export | PITR primitive only | User-visible restore/export and drills | Yes | Snapback + Hosting |
| Postgres | Missing | Not beta blocker if 10 GB ceiling is explicit | Yes, other profile | Snapback |
| Observability | Strong HTTP UI | Function/live/job correlation | Yes | Universe + Hosting |
| Billing | Hosting meters | Stable-id stateful ledger and budgets | Yes; LLP 0104 | Universe + Hosting |
| Abuse | Basic limits | Admission, suspend, evidence, appeal | Yes | Universe |
| SLA/regions | Provider defaults | Published residency/support/SLA | Yes; policy | Expo |

The gap most likely to change substrates is popular-app scale. One coordinator
is a deliberate ceiling, closeable through LLP 0046 Postgres graduation or
later sharding—not by hiding the ceiling.

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
   are not deferrable. Other gaps may stage only when explicitly visible.
5. Production web alias and Snapback activation form one fenced operation.

## Status

Draft. This recommends a direction from source inspection; it does not claim
the current proof is a hosted product. Ratify with LLP 0104 and LLP 0105's
Phase 0 evidence in view.
