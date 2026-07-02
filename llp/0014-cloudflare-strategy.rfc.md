# LLP 0014: Cloudflare strategy

**Type:** RFC
**Status:** Draft
**Systems:** Deployment, Runtime, Storage, Sync, Realtime, Security, Assets, Cron, Developer experience
**Author:** Charlie Cheever / Codex
**Date:** 2026-06-26
**Revised:** 2026-07-02 (LLP 0032 X1: DK-2 commit-version answer recorded — per-app stream, one version authority per app, Durable Object counter; Profile C intra-app sharding named as the constraint that reopens LLP 0007's note)
**Related:** LLP 0000, LLP 0001, LLP 0002, LLP 0003, LLP 0004, LLP 0007, LLP 0008, LLP 0009, LLP 0010, LLP 0011, LLP 0012, LLP 0013, LLP 0018, LLP 0032, https://developers.cloudflare.com/workers/platform/storage-options/, https://developers.cloudflare.com/durable-objects/, https://developers.cloudflare.com/durable-objects/best-practices/websockets/, https://developers.cloudflare.com/d1/platform/limits/, https://developers.cloudflare.com/r2/, https://developers.cloudflare.com/queues/, https://developers.cloudflare.com/workers/configuration/cron-triggers/

## Summary

Cloudflare is Snapback's intended second standard target after the canonical
local Ibex + SQLite server. It should not be treated as a port of the local
process. Cloudflare's model is event-driven, V8-based, isolate-oriented, and
built around products such as Workers, Durable Objects, D1, R2, Queues, and
Cron Triggers. Snapback should use those seams deliberately instead of trying to
smuggle a long-running local server into an environment that is designed to sleep
when idle.

This RFC sets the strategy before the local core hardens around unportable
assumptions. The first Cloudflare proof should preserve the app-facing Snapback
contract from LLP 0004 and the capability-reporting contract from LLP 0012, but
it may adapt the implementation of connection ownership, change notification,
durable state, scheduling, realtime delivery, runtime isolation, secrets, asset
storage, and storage-engine choice.

## Scope

This RFC owns the Cloudflare target strategy:

- target profiles and what each profile is allowed to claim;
- connection and session ownership;
- durable state placement;
- realtime and change-notification mechanics;
- storage-engine choice and the portability boundary;
- runtime isolation and secrets on Workers;
- asset, cron, and background-work mapping;
- local/CI validation expectations before Cloudflare is called supported.

It does not implement Cloudflare support, select final pricing tiers, or replace
the canonical local target from LLP 0002. It also does not approve hosted
multi-tenant Snapback by itself; LLP 0009 still gates untrusted code on an
enforceable runtime/resource boundary.

## Product Goals

Cloudflare support should earn these claims:

- **Scale-to-zero behavior:** an idle deployed app should stop doing steady
  compute work. WebSocket and realtime designs should take advantage of
  hibernation or event wakeups when possible.
- **Same app-facing model:** schemas, handlers, generated clients,
  diagnostics, and capability reports should look like Snapback, not like a
  one-off Cloudflare SDK.
- **Explicit capability gaps:** if a Cloudflare profile lacks offline replay,
  Postgres graduation, a query form, a resource limit, or a realtime guarantee,
  the capability manifest says so.
- **No polling assumption:** the local tailer's fixed interval is a local
  placeholder. Cloudflare profiles should wake from writes, messages, alarms, or
  platform events.
- **Benchmark before claims:** the first profile must measure write latency,
  subscription fan-out, hibernation behavior, storage contention, queue depth,
  and reconnect behavior before it is used as evidence for scale.

## Platform Facts To Design Around

These facts were checked against official Cloudflare documentation on
2026-06-26 and should be rechecked before implementation because Cloudflare's
platform changes quickly:

- Durable Objects combine compute with storage, are globally unique by object id,
  and can shut down when idle. They are the natural place to coordinate
  per-app, per-project, per-room, or per-session state.
- Durable Objects support WebSocket Hibernation, where connections can remain
  attached while the object is no longer in memory. That is directly relevant to
  Snapback's idle-cost and realtime goals.
- Durable Object alarms wake an object in the future and are a better fit for
  per-object scheduled maintenance than a local polling loop.
- D1 is Cloudflare's native serverless SQL database. It is attractive for a
  SQL-shaped Snapback store, but its concurrency, limits, and overload behavior
  must be measured against Snapback's single-writer/versioning contract.
- R2 is Cloudflare's object store and is the natural Cloudflare target for
  asset bytes once Snapback's asset subsystem exists.
- Queues provide Worker-integrated asynchronous delivery and should be evaluated
  for durable background work, media processing handoff, notification fan-out,
  and outbox-style retries.
- Cron Triggers can invoke Workers on a schedule; Durable Object alarms can
  handle object-local wakeups. Snapback cron needs a profile that chooses which
  layer owns which scheduled work.

## Target Profiles

The strategy should define at least three Cloudflare profiles before any one is
called supported.

### Profile A: D1 Store + Durable Object Realtime Coordinator

The app's durable SQL data lives in D1. Durable Objects own connected clients,
subscriptions, room/session state, and realtime delivery. Workers route HTTP and
WebSocket traffic to the right object.

This profile is closest to "SQLite-shaped storage plus event-driven realtime,"
but it has hard questions:

- how the D1 write path allocates one commit version per mutation;
- whether D1 triggers/change tables are sufficient for Snapback changesets;
- how a Durable Object learns about writes without polling D1;
- how many subscriptions a coordinator can match before fan-out bends;
- whether D1 overload behavior produces recoverable Snapback diagnostics.

### Profile B: Durable Object As App Shard

A Durable Object owns a project, app shard, room, or tenant partition and keeps
the serial write boundary, live subscriptions, connection state, and local
durable storage together. Workers route all reads, writes, and sockets through
that object or object family.

This profile is closest to Snapback's local "one owner process" mental model and
may fit small apps well. It may also bottleneck early if one object owns too much.
It must define shard boundaries, cross-shard queries, export/import, and what
"SQLite to Postgres graduation" means from a Cloudflare object-backed profile.

### Profile C: Hybrid Edge Router + Sharded Durable Objects + D1/R2/Queues

Workers own routing and auth/session ingress. Durable Objects own per-room,
per-subscription, or per-shard coordination. D1 stores app rows where SQL is the
right tool. R2 stores assets. Queues handle background jobs and outbox work.

This is likely the long-term production profile, but it should not be the first
prototype unless Profiles A and B make the seams clear. The danger is designing
a distributed system before Snapback has measured its local matcher, changeset,
and conformance costs.

## Architecture Seams

### Connection Ownership

Cloudflare WebSocket sessions should be owned by Durable Objects, not by ordinary
Workers pretending to be long-lived servers. The first design question is the
object key:

- one object per app;
- one object per app shard;
- one object per authenticated user/session;
- one object per subscription room;
- a two-level model, such as app object plus room objects.

The key must be visible in diagnostics. Reconnect behavior must tell the client
whether it resumed the same object, moved to a replacement object, or needs a
fresh snapshot.

### Change Notification

Cloudflare support must not depend on fixed-interval polling. Local polling is a
bring-up mechanism in LLP 0003; Cloudflare should use one of:

- mutation commit path directly notifying the relevant Durable Object;
- Durable Object-local writes emitting deltas before the object sleeps;
- queue/outbox messages from the write owner to realtime owners;
- alarms only for bounded maintenance, not for normal live delivery.

Every mechanism must preserve the LLP 0007 changeset rule: one logical mutation
commits one version and subscribers observe one atomic changeset.

### Durable State

The storage choice must be made against Snapback's portable storage contract:

- Can the profile implement opaque string ids, system fields, exact timestamps,
  commit versions, tombstones/deletes, and query semantics?
- Can it export a logical portable bundle for SQLite/Postgres graduation?
- Can it provide deterministic reset/seed for the acceptance suite?
- Can it report non-portable behavior as capability gaps?

D1 is the obvious SQL candidate, but not automatically the only Cloudflare
store. Durable Object storage may be better for object-local state; R2 is the
asset-byte store; Queues are not a database.

**Commit-version answer (DK-2, 2026-07-02).** The graduation design note in
[LLP 0007](./0007-storage-portability.spec.md) §Commit-version graduation
settles the version-spine question this section inherits: the stream is
per logical app, gap-free in commit-visibility order, and **one app stream
requires one version authority**. On Cloudflare that authority is the
write-owning Durable Object allocating a per-app counter from its own
storage — single-threaded execution reproduces the local SQLite semantics
exactly. The named constraint for Profile C: sharding one app's data across
multiple objects requires either a coordinator-allocated stream or a
multi-stream client cursor model, neither of which is designed — so the
first prototype must keep one app's writes owned by one object, and any
intra-app sharding proposal reopens LLP 0007's note.

### Runtime Isolation

Cloudflare uses V8 isolates, so it is the natural second runtime profile for
Snapback's app code. That does not by itself approve untrusted multi-tenant code.
The Cloudflare profile must still report:

- invocation timeout and whether it is enforced;
- CPU and memory limits as enforced by the target;
- per-invocation global-state isolation policy;
- whether handler code can access network, secrets, environment bindings, or
  storage except through explicit Snapback capabilities;
- how bundle hashes, schema hashes, and capability manifests are validated.

The first Cloudflare prototype should run trusted app code until LLP 0009's
hosted/untrusted requirements are satisfied for the chosen profile.

### Secrets

Cloudflare bindings and secrets are deployment-owned inputs. Snapback handlers
should still see secret handles through the same explicit capability model as
other targets. Query and mutation handlers should not receive ambient access to
Worker bindings, environment variables, or unrestricted network APIs.

Diagnostics must show which secret capability is present without exposing the
secret value or a stable hash of it.

### Assets

Cloudflare assets should map to R2 for bytes and Snapback tables for metadata,
ownership, permissions, references, and processing state. The asset subsystem is
not in the first local slice, so the Cloudflare profile should initially report
asset upload and processing as missing capabilities unless the asset LLP exists.

### Cron and Background Work

Cron Triggers are appropriate for deployment-wide schedules. Durable Object
alarms are appropriate for object-local wakeups. Queues are appropriate for
durable async work and retries. Snapback cron needs a profile-specific split:

- global schedules route through Worker `scheduled` handlers;
- app- or shard-local scheduled work routes to the owning Durable Object;
- long-running or retryable work goes through Queues;
- every scheduled invocation records structured diagnostics and capability
  gaps.

## First Prototype

The first Cloudflare prototype should be narrower than "Snapback on
Cloudflare." It should prove:

1. one generated Snapback app bundle deployed to Workers;
2. one schema/function manifest loaded with a stable bundle hash;
3. one mutation executed in V8 through the same app-facing handler API;
4. one durable SQL or object-backed commit with a Snapback commit version;
5. one live subscription through a Durable Object-owned WebSocket;
6. an authoritative initial snapshot plus online deltas;
7. a capability manifest that marks unsupported local-first features honestly;
8. deterministic reset/seed or a documented CI surrogate;
9. idle behavior showing no steady polling or needless billable work;
10. a todo acceptance fixture shared with the local target where possible.

It should not claim offline replay, assets, notifications, production auth,
Postgres graduation, hosted multi-tenant isolation, or high-frequency whiteboard
fan-out until those capabilities have their own validation.

## Validation Requirements

Before a Cloudflare profile moves beyond Draft, the acceptance suite should
prove:

- the same generated schema/function artifacts are accepted locally and on
  Cloudflare, or the capability report explains every divergence;
- an async handler runs to completion under V8 and does not expose ambient
  Worker powers;
- one mutation produces one commit version and one changeset;
- a cold-start subscription returns the current authorized result before deltas;
- reconnect either resumes from a retained version or forces a structured
  resnapshot;
- no realtime path depends on fixed-interval polling;
- WebSocket hibernation or the chosen idle behavior is measured;
- D1/Durable Object contention and overload cases produce recoverable
  diagnostics;
- reset/seed works in CI or the profile declares the exact unsupported gap;
- cost and usage counters are visible enough to support the scale-to-zero claim.

## Open Questions

- Which target profile should be prototyped first: D1 store + Durable Object
  coordinator, Durable Object app shard, or a hybrid?
- What is the Cloudflare project/app/shard identity model?
- Can D1 implement the exact changeset/version/tombstone contract Snapback needs
  without polling or non-portable SQL behavior?
- How should Durable Object hibernation interact with subscription membership,
  pending mutation acknowledgements, and reconnect cursors?
- What is the maximum useful fan-out for one Durable Object room before sharding
  is required?
- Does Cloudflare's local development tooling provide enough deterministic
  state setup for the same acceptance suite, or does Snapback need a separate
  Cloudflare CI surrogate?
- Which Cloudflare resource limits are enforceable versus advisory from
  Snapback's point of view?
- What is the migration story from local SQLite to the first Cloudflare profile,
  and from that profile to Postgres or another larger-scale deployment?

## Status

Draft. This is a strategy document to prevent local-core assumptions from
hardening around an always-on process, a polling tailer, or SQLite-only storage
mechanics. It should be revised after a focused Cloudflare prototype measures
the target seams above.
