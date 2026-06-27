# LLP 0018: App and instance boundaries

**Type:** RFC
**Status:** Draft
**Systems:** Deployment, Runtime, Storage, Auth, Sync, Realtime, Security, Developer experience
**Author:** Charlie Cheever / Codex
**Date:** 2026-06-26
**Revised:** 2026-06-26
**Related:** LLP 0000, LLP 0002, LLP 0003, LLP 0004, LLP 0007, LLP 0008, LLP 0009, LLP 0010, LLP 0011, LLP 0012, LLP 0013, LLP 0014, LLP 0017

## Summary

Snapback should distinguish a **physical Snapback instance** from a **logical
Snapback app**.

The paved path should stay simple: one logical Snapback app per product backend.
That app owns one schema, function bundle, auth namespace, storage/version stream,
secret namespace, realtime namespace, migration history, backup/restore unit, and
admin scope. A mobile app, web app, Contract/Exact surface, React surface, and
admin tool can all point at that same logical app when they are surfaces of the
same product.

At the same time, Snapback should not require one physical process, deployment,
or hosting account per logical app. A physical Snapback instance may eventually
host multiple isolated logical apps, and related tools may intentionally share
selected data through an explicit app-suite model. The rule is **default
isolation with explicit sharing**, not ambient shared state.

This matches the project philosophy in LLP 0000: paved path, not a cage. People
will build strange suites of small tools, internal consoles, companion apps,
and multi-surface products. Snapback should let them do that, but the system
must make blast radius, data ownership, auth, migrations, and diagnostics legible.

## Motivation

The product question is whether every app should always get its own Snapback
instance, or whether multiple apps should be allowed to share one. The answer is
not one-dimensional because "app" and "instance" can mean different things:

- a native iOS app and a web app may be two client surfaces of the same backend;
- an admin console may be a privileged surface for the same product data;
- a suite of small internal tools may intentionally share users, tables, and
  workflows;
- a hosted provider may run many unrelated customer apps on the same physical
  fleet;
- a single company may want isolated production, staging, and preview apps under
  one account.

Forcing a separate physical deployment for each of those cases adds needless
friction. Letting everything share one unnamespaced database, runtime, and auth
surface creates worse problems: schema collisions, accidental data leaks,
ambiguous migrations, unsafe admin tools, noisy neighbors, and unclear export or
deletion semantics.

Snapback therefore needs a vocabulary and contract that separates physical
placement from logical ownership.

## Terms

**Physical Snapback instance** means the running deployment boundary: a local
process, Cloudflare profile, hosted cluster, VM service, or similar operational
unit. It owns compute, listeners, runtime workers, adapters, and target-specific
infrastructure.

**Logical Snapback app** means the application backend boundary Snapback exposes
to generated code and clients. It is the unit of schema, functions, storage
versioning, sync, auth, secrets, migrations, backups, diagnostics, and admin
authorization.

**Client surface** means a frontend or tool that uses a logical Snapback app:
Contract/Exact, React, Expo, web, native, tests, or agent tooling. Multiple client
surfaces commonly use one logical app. An admin console is also scoped to a logical
app, but per LLP 0017 it is a *privileged system surface over the admin API*, not a
consumer of the app's generated functions; treat it as scoped to the app rather
than as an ordinary client surface.

**App suite** means an explicit group of related logical apps that share selected
capabilities or data. A suite is not the default; it is a declared relationship
with named ownership and sharing rules.

**Tenant inside an app** means app-level product tenancy such as organizations,
teams, workspaces, schools, or customer accounts. It is ordinary application data
and authorization unless a deployment profile deliberately maps it to physical
storage isolation. Do not confuse app tenants with logical Snapback apps.

## Decision

Snapback should support three different shapes, in this order:

1. **Single logical app per physical instance** is the canonical local and v0
   shape. It remains the default mental model and the easiest thing to run.
2. **Multiple isolated logical apps per physical instance** should be supported
   by hosted, Cloudflare, and future local orchestration profiles once isolation
   is specified and tested.
3. **Explicit app suites** should allow related logical apps to share selected
   auth, data, secrets, or realtime capabilities without collapsing into one
   unstructured database.

The default generated client and app authoring experience should assume one
logical app. Sharing is opt-in and visible in generated manifests, diagnostics,
admin surfaces, and deployment configuration.

## Default App Boundary

A logical Snapback app owns:

- schema manifest and migration history;
- function manifest, handler bundle, and bundle hash;
- durable storage namespace or database;
- one logical commit-version stream;
- durable changesets, tombstones, and sync cursors;
- realtime subscriptions and durable outboxes;
- ephemeral realtime room namespace;
- auth user/session/provider namespace, unless suite sharing declares otherwise;
- secret namespace and granted capability handles;
- admin permissions, audit logs, diagnostics, and resource limits;
- backup, restore, export, import, reset, and seed operations.

This boundary should be true even when two logical apps are hosted by the same
physical instance. If app A loads a schema, invokes a mutation, advances a
version, publishes ephemeral presence, rotates a secret, resets data, or grants an
admin permission, app B must not change unless a declared suite relationship says
so.

The commit-version stream is per logical app, not per physical instance. A global
instance-wide version number may exist for hosting internals, but it is not the
observable app data version used by sync and realtime. LLP 0008 currently speaks of
*the* database version for a single-app-per-instance deployment; under a multi-app
instance that contract must be read as per logical app, and 0008 should be revised
to say so explicitly when multi-app support lands.

## Sharing Models

### Multiple surfaces, one logical app

This is the common path. A mobile app, web app, Contract/Exact surface, React
surface, and test harness that operate on the same product data should usually
share one logical Snapback app. An admin console is scoped to that same logical
app, but per LLP 0017 it consumes the privileged admin API rather than the app's
generated functions, so it shares the app's *scope* without being one of its
function-consuming surfaces.

The generated artifacts from LLP 0012 should make this natural: different
surfaces consume the same schema, function references, capability manifest, and
runtime diagnostics rather than maintaining separate stores.

### Isolated apps on one instance

A physical instance may host many unrelated logical apps. This is the hosted
provider and local-supervisor case.

The isolation contract is the same regardless of physical implementation:

- code bundles are loaded per app and cannot observe another app's code;
- database reads and writes are scoped to one app;
- secrets and secret handles are scoped to one app;
- auth sessions and provider identities are scoped to one app unless explicitly
  shared;
- logs, diagnostics, admin views, and metrics are scoped by app;
- resource limits have both per-app and per-instance enforcement;
- backup, restore, reset, seed, and export operations require an app scope;
- realtime and ephemeral channels cannot collide across apps.

The physical storage strategy is target-specific. A profile may choose
database-per-app, schema-per-app, table-prefix-per-app, row-level app ids, Durable
Object-per-app, or another layout. That choice is an implementation detail only
if the observable isolation contract above holds and the capability report names
the isolation mechanism.

This contract, and the acceptance suite that proves it, establish isolation against
**bugs and accidents between cooperating apps**: colliding names, a load that bleeds
across apps, a query that reads the wrong scope. They do **not**, by themselves,
establish isolation against **adversarial code**. Hosting apps that do not trust
each other on one runtime is a stronger claim that additionally requires the runtime
isolation, resource enforcement, and admin authorization gated by LLP 0009. Passing
this contract is therefore necessary but not sufficient for untrusted multi-tenancy:
it shows the boundary holds under honest mistakes, not under attack.

### Explicit app suites

Some products are better modeled as a suite: many small tools under one larger
workspace, sharing users and selected data. Snapback should allow this, but the
sharing must be declared.

A suite should name:

- member logical apps;
- shared auth namespace, if any;
- shared tables or data APIs, with one owning app or suite-owned store;
- shared secrets or provider integrations, with explicit grants;
- cross-app function calls, if allowed;
- migration ordering for shared schema;
- export/import behavior for the suite and each member app;
- deletion and retention behavior when one member app leaves the suite.

The first suite mechanism should prefer sharing through generated functions,
declared tables, or a suite-owned shared store over arbitrary cross-app SQL. Raw
cross-app database access should be a portability and isolation opt-out.

## Auth and Identity

Default auth is app-scoped. The same human using two isolated logical apps should
not automatically be the same Snapback principal just because an email address or
provider subject matches.

Suite-shared auth may create a suite-scoped principal that member apps reference.
That relationship must be visible in `ctx.auth`, diagnostics, local stores, and
admin surfaces. Cross-app or cross-suite account linking follows the caution in
LLP 0011: automatic cross-provider or cross-scope linking is a security risk and
should be opt-in.

Local-first clients must treat app and suite identity as part of the local-store
scope. Switching app, suite, or user must clear retained data and mutation queues
where required by LLP 0011's user-switch rule.

## Storage and Migration

LLP 0007's logical portable bundle should be app-scoped by default. Exporting a
logical app exports that app's schema, functions, declared rows, and portable
metadata, excluding ephemeral sessions, verification codes, secret values, and
other non-portable or sensitive runtime state.

Suite export/import is harder because shared data may be owned by the suite or by
one member app. A suite export must say whether it includes:

- each member app's logical portable bundle;
- suite-owned shared tables;
- shared auth identity state;
- cross-app references and their referential integrity policy;
- secrets as names/grants only, not secret values;
- migration ordering and target compatibility requirements.

Schema migrations are app-scoped unless they modify suite-owned state. A migration
for app A must not block, rewrite, or invalidate app B unless the suite contract
declares a dependency.

## Realtime, Sync, and Ephemeral State

Durable sync and realtime state are app-scoped by default:

- subscription ids are scoped to one logical app;
- changesets and resume cursors refer to one app's version stream;
- reconnect/resume must include or imply the app scope;
- authorization epochs are scoped to the app or suite auth scope they depend on;
- connection outboxes and durable realtime lanes cannot mix unrelated apps.

Ephemeral rooms are also app-scoped by default. A room named `cursor:doc_123` in
app A is distinct from the same room name in app B. Suite-shared ephemeral rooms
are allowed only with an explicit suite scope, because presence, cursor, and
selection state can leak sensitive information even when it is not durable data.

## Admin and Diagnostics

LLP 0017's admin surface should treat app scope as mandatory once a physical
instance can host more than one logical app.

Local v0 routes may remain unscoped because the canonical local server hosts one
logical app. Multi-app profiles should expose scoped admin routes, capability
reports, and diagnostics. The concrete route shape can be decided later, but the
observable behavior must be:

- every mutating admin operation names one app or suite;
- every diagnostic says which app or suite it describes;
- instance-wide health and metrics are separated from app-owned data;
- hosted admin traffic cannot inspect another app without explicit authorization;
- destructive controls such as reset, seed, import, export, raw SQL, function
  invocation with impersonation, and secret inspection require app-scoped
  permissions.

## Target Profiles

### Local v0

The current local server remains one logical app per process and one SQLite
database path. This keeps the first implementation slice aligned with LLP 0002
and LLP 0003.

Running two apps locally means running two local Snapback instances with
different ports and database paths. That is sufficient for the v0 canonical
target and should remain easy.

### Local multi-app supervisor

A future local tool may supervise multiple logical apps from one command, but it
should still preserve app-scoped databases, ports, logs, and admin operations.
It is a development convenience, not proof that one runtime/store can safely host
untrusted apps together.

### Cloudflare

LLP 0014 should choose object keys and storage placement with this RFC in mind.
Durable Objects may be keyed by app, app shard, room, session, or suite, but the
capability report must state the app boundary and the isolation mechanism.

### Hosted multi-tenant

Hosted multi-app Snapback remains gated by LLP 0009. This RFC allows multiple
logical apps per physical instance, but it does not approve running untrusted
customer code together until runtime isolation, resource limits, and admin
authorization are enforced.

## Implementation Implications

LLP 0012 already pins `appId` in its ratified v0 schema manifest and a target
profile id in its capability manifest, so the stable logical app identifier is not
a new field to invent — it exists in the ratified artifacts. What this RFC adds is
its **meaning**: that identifier must scope schema/function loading, storage, the
version stream, auth, realtime, diagnostics, and admin authorization, and any
further per-app facts must be registered into 0012's shared artifacts under its
evolution policy rather than forked into a parallel schema. The first local target
may leave the id implicit, but any multi-app profile needs it threaded through:

- generated client configuration;
- schema and function load calls;
- admin API calls;
- logs and diagnostics;
- realtime subscribe/resume messages;
- local-store scope keys;
- backup/export/import metadata;
- capability reports.

The identifier should be opaque; display names are not identifiers. Its uniqueness
and stability scope must be defined together with LLP 0012 and LLP 0007: it must be
stable within a deployment, and a logical export must state whether the id travels
with the bundle. Where it does not — for example a cross-app reference inside a
suite that is later imported elsewhere — the reference must carry its own stable key
rather than assuming the app id is globally unique.

The local implementation should continue to report missing multi-app support as a
capability gap until scoped loading, routing, diagnostics, and tests exist. A
multi-app physical instance must not be introduced by simply putting multiple
schemas into the same unscoped `LocalSnapback`.

Accepting this RFC also obliges reconciling edits in neighboring Draft documents,
landed with the work that introduces multi-app support: LLP 0008's single "the
database version" must be expressed per logical app; LLP 0013's room key
(`collection + normalized scope values`) must gain an app dimension; LLP 0007's
logical portable bundle must be scoped to one app; and LLP 0017's admin routes and
diagnostics must carry app scope. None of those documents carries the app boundary
yet.

## Non-Goals

This RFC does not:

- implement the hosted control plane;
- settle billing or account hierarchy;
- choose a final manifest/config file format;
- approve untrusted multi-tenant execution;
- require suite sharing in v1;
- require cross-app joins or cross-app raw SQL;
- change the v0 local server away from one logical app per process.

## Validation Requirements

Before any profile claims multi-app support, the acceptance suite should prove:

- two logical apps with the same table names and function names do not collide;
- loading schema or functions for app A does not affect app B;
- mutations in app A advance only app A's version stream;
- subscriptions, outboxes, and ephemeral rooms do not leak between apps;
- app-scoped auth denial in one app does not authorize another app;
- secrets and secret diagnostics are app-scoped;
- reset, seed, export, import, and raw SQL require an explicit app scope;
- resource limits report per-app and instance-wide enforcement;
- admin inspection as app A cannot see app B without explicit permission;
- suite-shared data, if supported, works only through declared sharing rules and
  appears in diagnostics as shared rather than accidental.

These requirements prove the isolation contract under honest, cooperating apps.
They are correctness and leak tests, not an adversarial security audit;
demonstrating isolation against untrusted code is gated by LLP 0009 and is not
established by passing this suite alone.

## Open Questions

- What is the first configuration shape for logical app ids and suite ids,
  including their uniqueness scope and whether a logical app id travels with an
  exported bundle?
- Should a local multi-app supervisor exist before hosted multi-app support?
- How should generated clients discover app scope in local, hosted, and
  Cloudflare profiles?
- Are suite-shared tables owned by one member app, by a suite-level store, or by
  a separate shared logical app?
- What app-id or suite-id shape should appear in local-store keys and offline
  mutation queues?
- How should logical app export/import handle cross-app references inside a
  suite?
- Should raw SQL ever be allowed across app boundaries, or only inside a
  declared suite with a portability opt-out?
- Which Cloudflare object-key strategy best preserves the logical app boundary?

## Status

Draft. The v0 implementation remains one trusted local logical app per process.
This RFC should constrain future hosted, Cloudflare, local-supervisor, admin, and
suite-sharing work before any physical Snapback instance claims to host multiple
logical apps.
