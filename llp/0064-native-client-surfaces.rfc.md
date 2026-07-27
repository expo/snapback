# LLP 0064 — Native Client Surfaces

**Type:** RFC
**Status:** Draft
**Systems:** Client integration, React/Expo, Exact Native, Code generation, Auth, Live Queries, Offline, Packaging, Testing
**Author:** Snapback maintainers
**Date:** 2026-07-20
**Revised:** 2026-07-26 — Adds the protocol-native surface implemented by the
Swift proving client, explicit host lifecycle hooks, and the framework-binding
value boundary. 2026-07-20 — Initial native carrier and client-surface contract
**Related:** LLP 0008 (local-first sync), LLP 0012 (headless integration and capability classes), LLP 0016 (multi-surface evaluation), LLP 0034 (provider lifecycle), LLP 0043 (offline replay), LLP 0053 (authorization invalidation), LLP 0063 (Partitime roadmap); Exact LLP 0331/0332 (Exact Native platforms), Exact LLP 0373 (Partitime counterpart)

## Summary

Snapback supports native applications through three explicit, non-equivalent
client surfaces:

1. React Native/Expo consumes the shipped framework-neutral external-store
   protocol and the same generated JavaScript function references used on the
   web. It may claim `Online` when its device evidence proves network-backed
   query, mutation, lifecycle, authority, and reconnect behavior.
2. Exact Native consumes generated Rust plans and a retained native provider.
   It may claim `Parity` only when deterministic local handler execution,
   retained reads, durable queued mutations, replay/rebase, and authorization
   fencing are composed into the shipped OS carrier.
3. A protocol-native client consumes the versioned wire contract and
   language-neutral fixture corpus directly. It may claim only the exact
   arm × lane × auth-profile tuples its implementation and live evidence
   prove; it executes no handlers locally and therefore cannot claim `Parity`.

Neither surface embeds the Snapback server. Evidence is per operating system;
an iOS receipt never establishes Android behavior or the reverse. A carrier
that omits local handler execution cannot claim local-first or `Parity`, even
if its UI and online protocol otherwise match.

## Motivation

The first Partitime native proof used a hand-written polling gateway. It proved
that native hosts could build and reach Contract UI, but it did not establish a
generated Snapback client, push transport, offline or authorization resume, or
the lifecycle obligations in LLP 0012. LLP 0063 therefore made a native client
surface an entry prerequisite for its Step 2 deliverable.

The native boundary must preserve the advantage of Snapback's generated
contract without pretending that all carriers have the same runtime. React
Native can reuse the JavaScript client and an idiomatic external store. Exact
Native has a Rust evaluator and durable owner and should not route through a
second JavaScript cache merely to look like the web implementation.

## Design

### 1. Shared generated contract

Every native surface names operations through generated function references.
Direct table writes, parallel app-authored caches, and stringly operation
mirrors are outside the supported surface.

Generated artifacts carry their existing app, schema, function-bundle, and
inputs identities. A native adapter must refuse an incompatible artifact or
provider before publishing application data. Compatibility refusal is a
structured client diagnostic, not an empty render or a best-effort warning.

### 2. Framework-neutral external store

The JavaScript client surface is `snapback.external-store.v1`. A compatible
provider exposes:

- `externalStoreProtocol: "snapback.external-store.v1"`;
- `subscribe(name, args, userId, observer)`, returning the initial rows,
  connection state, and a disposal handle; observer metadata distinguishes an
  authoritative row delivery from connection-only and error transitions;
- `mutate(name, args, userId)` for generated mutations.

The shipped store owns canonical argument identity, initial pending state,
late handle resolution, stale data and error fencing, ref-counted subscribers,
connection/error snapshots, optimistic presentation, authoritative settlement,
rollback, and disposal. `ExternalQueryScope` owns replaceable bindings for
framework-free hosts. React's adapter is a thin `useSyncExternalStore`
projection over this object; React Native/Expo uses the same adapter and does
not introduce a second cache.

The protocol string is an exact compatibility token. Unknown or missing
versions refuse synchronously. A later incompatible change requires a new
token and a migration path; silently accepting a shape superset is forbidden.

A framework binding over this store earns its keep through identity
replacement, connection re-grant, background/foreground, structured error
state, typed retry, and scope-dispose teardown. Query-hook syntax alone is a
thin community projection and does not justify a second cache or transport
owner.

### 2.1 Protocol-native clients

The shared contract is LLP 0093–0096 plus the committed JSON Schemas and
fixture corpus. The proving implementation is
`clients/swift/SnapbackClient`, a SwiftPM package for iOS and macOS claiming
`poll/local` and `live/local`. Its session profile repeats exact offers, creates
authorization namespaces, applies version-guarded invalidation snapshots
before acknowledgement, and exposes explicit background/foreground methods.

Swift is the only committed maintained protocol-native artifact. Kotlin and
Dart clean-room implementations are reference evidence until their packaging,
ownership, and CI surfaces land. Neither a reference implementation nor one OS
receipt establishes a supported distribution.

### 3. React Native/Expo Online surface

The Expo carrier packages:

- the generated public function API and its function/artifact identities;
- `@snapback/client`;
- the shipped React adapter;
- app code and normal React Native dependencies.

It excludes server crates, server JavaScript, local handler executors, and
system/admin authority. Loopback development may use simulator/emulator port
bridging, but that does not weaken the server's non-loopback development-auth
posture.

React Native WebSocket implementations may report failed upgrades differently
from browsers. The managed stream therefore treats `error`, `close`, and a
bounded still-connecting interval as loss. Reconnect obtains a fresh connection
grant and re-enters through snapshot-with-subscribe before returning to `live`.
The carrier retains the prior rows as `stale` during that interval.

An Expo tuple may claim `Online` only when one receipt for that OS proves:

1. release carrier build and device/simulator launch;
2. generated-function initial data;
3. optimistic pending followed by confirmed or rejected settlement;
4. authority rotation followed by a fresh authorized query;
5. background and foreground lifecycle events;
6. offline retention and reconnect to authoritative rows; and
7. release-artifact exclusion of Snapback server code.

The witness must record the immutable profile ID (`react-expo/ios` or
`react-expo/android`), capability class, source/artifact digests, and every
transition used by the assertions.

### 4. Exact Native Parity surface

The Exact Native carrier links generated Rust Snapback bindings, the
deterministic data-tier evaluator, a normalized durable store, and the retained
provider owner. Enqueue executes the generated mutation plan locally, records
deterministic inputs and authority, and persists the ordered mutation request.
Visible state is the authoritative base with every eligible pending mutation
replayed in sequence.

Partitime's three product mutations are all in that portable plan tier. The
last gap was RSVP: it previously used an Ibex-only JavaScript handler. The
native-parity implementation replaces the actor's `(eventId, userId)` RSVP
and inserts the selected status through one declarative plan, preserving the
declared unique product identity while making server and native replay consume
the same generated operation. A server-only handler is not admissible evidence
for deterministic local execution.

On reconnect, the provider replaces the authoritative base and deterministically
replays the remaining queue. Confirmed mutations leave the queue; rejected
mutations roll back through the same replay operation. A lost response retains
the mutation identifier and is redelivered idempotently. An authority-instance
mismatch suspends the predecessor queue; it never replays under successor
authority merely because the user identifier happens to match.

An Exact Native tuple may claim `Parity` only when one receipt for that OS
proves all seven carrier facts above plus:

- retained reads while offline;
- deterministic local handler execution from generated plans;
- durable ordered queued mutations across process or carrier lifecycle;
- authoritative reconnect, replay/rebase, and convergence;
- predecessor-authority queue suspension; and
- release dependency/symbol exclusion of Snapback server implementation.

The qualifying profile IDs are `exact-native/ios` and
`exact-native/android`. Contract-on-Hermes remains an instrument and cannot
stand in for either profile.

### 5. Host lifecycle

Lifecycle is provider policy, not view glue. Backgrounding quiesces transports
without deleting authorized retained rows or durable queued work. Foregrounding
first reconciles current authority, then reconnects and resubscribes. A terminal
authorization transition applies LLP 0053's synchronous publication fence
before predecessor rows, optimistic overlays, callbacks, or receipts can reach
the resumed UI.

OS-specific hosts translate their lifecycle callbacks into this shared policy.
Recording a lifecycle fact without changing provider behavior is useful
instrumentation but is insufficient for `Parity`.

The JavaScript live-query handle realizes this policy as `pause()` / `resume()`;
the Swift proving client realizes it as `pauseForBackground()` /
`resumeAfterForeground()`. Both preserve desired query identity while
re-entering through fresh snapshot-with-subscribe. A first-party binding maps
host lifecycle to these provider methods once; view code never owns socket
freshness.

### 6. Build graph and artifact integrity

Native build systems must declare generated artifacts and workspace client
sources as inputs. A successful release command that reuses a bundle compiled
from older aliased sources is a failed proof. Receipts hash the sources named
by the claim, and the release artifact must be rebuilt whenever any of those
inputs changes.

Generated platform projects may be checked in when that makes release builds
deterministic. Package-manager caches, Pods, derived data, Gradle state, and
compiled products are never evidence inputs and remain untracked.

### 7. Capability honesty

Capability class is attached to the immutable surface/OS profile and receipt,
not inferred from product appearance:

- `Online`: generated remote query/mutation behavior with honest connection,
  settlement, lifecycle, auth-resume, and reconnect evidence.
- `Parity`: every `Online` obligation plus local execution, retention, durable
  queueing, replay/rebase, and authorization-safe convergence.

An unavailable tuple remains a machine-readable GAP. Passing React/Expo on an
OS does not establish Exact Native on that OS, and passing either carrier on
one OS does not establish the other OS.

## Security and privacy

Native packages contain public generated client facts only. They never contain
admin tokens, provider credentials, test witness secrets, server source, or
server executables. Authentication custody follows LLP 0059 and LLP 0060;
profile receipts may record opaque authority identifiers and transition facts
but must not record bearer material.

Simulator/emulator bridge setup is acceptance infrastructure. It cannot be
compiled into production endpoint selection or used to claim a non-loopback
deployment is secure.

## Verification

The reference gates are:

- framework-neutral external-store package tests;
- React Strict Mode, replacement, optimistic, and incompatibility tests;
- per-OS React Expo release/device receipts;
- provider-level Exact Native local execution/replay/rebase corpus; and
- per-OS Exact Native release/device receipts.

Every per-OS receipt is independently content-addressed. Aggregate roadmap
claims join those receipts but never replace them.

## Rollout

1. Ship the external store and React adapter; replace Partitime's app-local
   React and Vanilla lifecycle glue.
2. Establish React Expo `Online` independently on iOS and Android.
3. Compose Exact's evaluator and retained provider, then establish
   `exact-native/ios` and `exact-native/android` at `Parity`.
4. Keep incomplete tuples visible as GAP rows until their exact commands and
   receipts pass in the cumulative manifest.

## Open questions

1. Should the existing pure-Swift transport remain hand-maintained against the
   fixture corpus, or should future DTOs be generated from the committed
   Schemas?
2. Which physical-device checks must supplement simulator/emulator evidence
   before a native profile can be called production-supported rather than a
   roadmap graduation proof?
3. Should native transport budgets be generated from a declared host profile,
   or remain explicit adapter configuration with conformance limits?
