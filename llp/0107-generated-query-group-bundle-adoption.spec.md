# LLP 0107: Generated query-group bundle adoption

**Type:** Spec
**Status:** Review
**Systems:** Code generation, Client integration, React, Live Queries, RQS, Auth, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-28
**Revised:** 2026-07-28 (unreviewed post-round-3 reconciliation: string-target
register eligibility and provider-custody opacity; three-round review budget
exhausted)
**Related:** LLP 0012, LLP 0034, LLP 0053, LLP 0058, LLP 0059, LLP 0064, LLP 0090, LLP 0092, LLP 0101, LLP 0102

## Summary

Snapback code generation should turn each finite `defineRoutes` entry into one
typed query-group reference. A prepared client binding should use that
reference to request one LLP 0090 register-mode bundle and hand the resulting
closed group to the React provider. All children begin at the bundle's single
durable commit and adopt the subscriptions the server created at that cut.

This Spec is a narrow additive profile over the owners above. It registers one
experimental target capability and the two additive LLP 0092 bundle-request
fields `authInvalidationProtocol` and `authorizationNamespaces`; it does not
otherwise change bundle, transport, authorization, query, result-contract, or
React external-store semantics. It exists because this generated-reference and
register-mode composition was added after LLP 0102's terminal review and needs
its own reviewable contract and evidence. This document supersedes LLP 0102's
"Bundle-primed generated query groups" extension only where that section
previously allowed a broad `SNAPBACK_BUNDLE_*` fallback or left preparation
ownership implicit. LLP 0102 continues to own provider stores, lazy child
demand, and React lifecycle.

## Goals and non-goals

V1 must:

- generate group identity and exact child reference types from route source;
- refuse stale, forged, cross-app, non-live-query, duplicate, empty, and
  oversized groups before a bundle request;
- bind the group to the prepared app and exact generated manifest;
- perform at most one register-mode bundle request for one preparation;
- preserve the response's one commit, connection, generation, stream,
  attach deadline, subscription ids, nullable resume values, authorization
  projections, and rows while keeping its grant in client custody;
- transfer one preparation to one provider, which lazily consumes each child
  registration exactly once without an ordinary snapshot-with-subscribe race;
- make registered, deliberate live fallback, and refusal outcomes observable;
- fence late preparation across authority replacement and disposal; and
- prove the real generated Signal Desk adapter starts through the
  registered-bundle path.

V1 does not:

- make independent post-boot deltas transactionally atomic;
- make route strings, function-name strings, or caller-authored references the
  application API;
- add a React cache, transport, credential carrier, or authority source;
- persist register-mode responses;
- silently claim registered boot where the target lacks the capability; or
- broaden LLP 0090's bundle bounds, expiry, idempotency, or auth contract.

## Generated reference

For every admitted route, codegen emits:

```ts
type QueryGroupReference<
  Route extends string,
  Queries extends readonly QueryGroupEntry[]
> = Readonly<{
  artifactKind: "queryGroupReference"
  formatVersion: 1
  schemaVersion: string
  appId: string
  id: string
  route: Route
  definitionHash: `sha256:${string}`
  queries: Queries
  persist?: false
}>
```

Only a route containing one through 32 `LiveQuery` children is
register-eligible and receives a generated group. In addition, every authored
`$param` mapping in the route must target a `string` function argument.
Codegen records this derived fact as `registerGroupEligible:true` on the served
route entry; the client admits only entries carrying that fact. Ordinary
`Query` children, mixed routes, and routes whose parameters require numeric or
boolean decoding remain valid for the LLP 0092 read-bundle surface but do not
generate this register-adoption reference. Literal numeric and boolean args
remain eligible because they require no client coercion.

Each child has a deterministic generated name, the complete generated live
query reference, and canonical literal/parameter-mapping args. Names are
allocated in route order from a route-local used-name set: try the exported
function name, then append decimal integers beginning at `2` until the first
unused name. Thus `foo, foo2, foo` becomes `foo, foo2, foo3`. Names are
JavaScript property strings and no later implementation may reinterpret them.

The identity protocol is exact:

1. `definition` is the closed authored object `{route,queries}` plus
   `persist:false` only when authored false. Each `queries` member is exactly
   the authored `{function,args}` object; generated `name` and `ref`
   projections are not hash input. It preserves query array order.
2. Its bytes are UTF-8 of
   `snapback:query-group-reference:v1\n` followed by
   `canonicalizeClientValueV1(definition)` — compact RFC 8785/JCS JSON.
3. `definitionHash` is lowercase SHA-256 over those bytes, prefixed
   `sha256:`.
4. `id` is the literal UTF-8-safe string
   `${appId}:query-group:${route}`.

Codegen and the prepared client consume one shared parity-vector suite for
these bytes. The group id, route, definition hash, route-manifest identity, and
ordered child identities are all checked; none is trusted merely because its
object shape looks generated.

The generated `api.mjs` exports both `groups` and `api.groups`. Its declaration
exports the matching finite `GeneratedQueryGroups` map, so an entry's result
keys and child results remain exact without casts or row generics.

## Preparation and admission

`prepareReactBinding({ generatedManifest })` constructs a binding from an
exact schema, function, capability, and route manifest set. It verifies their
shared app/schema/function identities before returning.

The binding exposes:

```ts
prepareQueryGroup(
  group: GeneratedQueryGroupReference,
  params: QueryGroupParams<typeof group>,
  options?: {
    fallbackToLive?: boolean
    userId?: string
  },
): Promise<PreparedReactQueryGroup>
```

`QueryGroupParams<Ref>` is the exact generated object of route parameters.
Every parameter is a required `string`, each appears once, extra parameters
refuse, and the request sends those strings unchanged. `/` therefore accepts
only `{}`. The server remains authoritative for schema-driven substitution and
typed argument decoding under LLP 0092. Because generated register groups
permit `$param` only at string-typed targets, the client can materialize exact
pre-I/O identity, duplicate checks, namespaces, and fallback entries by direct
string substitution. Numeric and boolean parameter decoding is never mirrored
by the V1 register-group client.

`userId` is the existing asserted-user development seam. It is admitted only
when the connected target reports `local-dev-sqlite-ibex` and the settled auth
mode is `dev`; sessions, hosted, custody transition, and any other target
refuse it before the request. Its exact value is part of the preparation's
authority/adoption identity even though it is not cache identity or hosted
authorization evidence.

Before network work, preparation verifies:

1. exact artifact kind and format;
2. the binding's app and schema version;
3. the exact route-bearing manifest identity plus an entry with the same route
   and persistence policy;
4. the recomputed definition hash and deterministic group id;
5. one through 32 ordered `LiveQuery` children;
6. unique child names;
7. a complete generated query reference for each route child;
8. exact child function, args, and result-contract identities; and
9. exact generated string route parameters and canonical materialized args;
   and
10. no two children with the same canonical `(function-reference id,args)`.
    Repeated functions with different canonical args remain valid. Exact
    duplicates refuse `SNAPBACK_REACT_GROUP_DUPLICATE_CHILD` before I/O so
    LLP 0102's canonical-store sharing never strands surplus positional
    registrations.

`prepareQueryGroup` returns a promise. Admission failures reject that promise
with a stable `SNAPBACK_REACT_GROUP_*` code before any request; implementations
must not differ between throw-before-return and asynchronous rejection.

## Registered boot

When the headless client negotiated LLP 0053 protocol 1, an admitted
preparation allocates one never-reused `QueryNamespace` per auth-scoped ordered
child from the client's real `clientStoreId`, canonical function-plus-args key,
and live-query instance allocator. It sends `null` at authority-independent
positions. It then requests the route through the existing LLP 0090 bundle
endpoint with `mode: "register"`, a fresh bundle-boot idempotency key,
`authInvalidationProtocol:1`, and that exact positional
`authorizationNamespaces` array. The server refuses namespaces without
protocol 1 and refuses a nonempty array whose length differs from the served
route. An empty array is the legacy absent form, not a positional assertion;
the generated client sends either no array or one exact-length array. The
server uses each position only for that child's subscription admission;
authority-independent children return no authorization projection.

A sessions-mode binding without protocol 1 refuses
`SNAPBACK_REACT_GROUP_AUTH_INVALIDATION_REQUIRED` before the request; it may
not register a protected child without a namespace. The protocol-free legacy
form is confined to settled local-dev `dev` authority, sends no namespace
array, and receives no authorization projection. Read mode refuses both
fields. They are connection/register semantics and are part of the LLP 0092
idempotency replay scope.

The client verifies the returned bundle against the prepared group:

- exactly one response entry per child in manifest order, with the exact
  function and canonical materialized args at each position;
- one common safe-integer `commitVersion` in the inclusive portable range
  `0..PORTABLE_STORAGE_VERSION_MAX`;
- one complete registered connection, nonempty grant, safe-integer
  `attachDeadline`, and—when any child is auth-scoped—the negotiated
  authorization-invalidation connection descriptor;
- complete generation and version-stream identity;
- a distinct nonempty subscription id and result-contract-valid rows per
  child;
- the closed LLP 0092 `resume` value: an exact resume object when eligible and
  literal `null` otherwise; every non-null receipt must equal the bundle's
  app, commit, generation, and version-stream identities, the generated query
  artifact and returned args hash, and the returned rows' digest;
- for each auth-scoped entry, the closed
  `{scope,invalidation}` authorization projection required by LLP 0092/0053,
  with scope subscription id and generated query namespace matching that
  child, while an explicitly `authorityIndependent` child carries none; and
- no unknown field, structurally invalid deadline, incompatible registration,
  or partial authorization projection.

The prepared result is an immutable opaque capability over a private
preparation owner. The owner holds the admitted group, verified bundle
metadata, connection handle, client-custodied grant, authorization state,
resume receipts, rows, and one registration per child. None of those
data-bearing or authority-bearing values crosses the public capability.
Its public fields are limited to safe generated identity and boot provenance:

```ts
{
  artifactKind: "preparedReactQueryGroup",
  source: "registered-bundle",
  reference: QueryGroupReference,
  params: QueryGroupParams,
  boot: {
    source: "registered-bundle",
    commitVersion: number,
    generation: string,
    versionStream: string,
    attachDeadline: number
  },
  entries: readonly [{
    name: string,
    ref: FunctionReference,
    args: unknown
  }],
  dispose(): Promise<void>
}
```

The other exact public variant is
`{source:"live-fallback",reason:"registered_bundle_boot_v1-unavailable",
boot:null,...safeIdentity}`. `live-recovery` is provider-owned state, exposed
only as `source:"live-recovery"`, one stable reason from
`"attach-deadline-expired" | "unadopted-delta" |
"authority-replaced"`, and `boot:null` in provider/group inspection. Secrets,
connection handles, grants, bearer material, subscription ids, rows, resume
state, namespaces, authorization projections, and raw response bodies are
not properties of the public capability, exposed by inspection, or serialized
into diagnostics. They are also not reachable from any public provider
property after transfer; the provider's internal owner lookup is
module-private. Retaining a prepared object across an authority transition
therefore retains no application data.

Creating the React provider performs one atomic owner transfer. Reuse or use
with another binding/provider refuses; failure during provider construction
rolls the transfer back into terminal disposal, not a reusable capability.
The provider uses the bundle connection as its single connection. Before any
registered row is published, it installs its barrier participant and obtains
positive server confirmation that the shared socket attached to the pending
owner. For the V1 transport, successful HTTP `101` upgrade under the unexpired
one-use grant is the minimum confirming signal because the server marks the
owner attached after all pre-upgrade refusal checks and before emitting that
upgrade. A client-clock comparison may skip an obviously stale attempt but is
never positive attach proof. After confirmation, the provider passes a child
registration to the headless `liveQuery` owner only when that canonical store
first gains demand. That owner installs the authorization fence before
publishing auth-scoped rows and publishes the bundle snapshot as authoritative
registered state without a second snapshot-with-subscribe.

Unused children remain provider-owned pending registrations until later demand
or provider disposal. The provider installs a connection-level guard before
attach: if any frame addressed to a child arrives before that child's store
actually adopts its registration, the bundled rows for that child are
permanently dirty. Its first demand opens a fresh subscription that explicitly
supersedes the dirty registration, and conservative group-level inspection
becomes
`source:"live-recovery", reason:"unadopted-delta", boot:null`; stale bundle
rows never become visible. This group-level demotion does not rewrite the
capture-time receipt for siblings that already adopted at the registered cut.

Before transfer, `prepared.dispose()` is idempotent and releases the acquired
connection owner. Transfer after terminal disposal refuses as already
consumed. After transfer, the provider exclusively owns disposal.
Inspection never exposes grant, bearer, scope payload, invalidation payload,
raw response, or idempotency key.

## Fallback and capability honesty

`registered_bundle_boot_v1` is an experimental LLP 0058 target-capability id.
Its positive predicate is the complete served route/register endpoint, pending
owner, client grant-custody, authorization-adoption, and cleanup suite for that
exact target instance. It appears in the target-authored
`capabilityManifest.supportedCapabilities`; codegen or app artifacts cannot
assert it. Its maturity remains `experimental` while this Spec remains
`Review`.

If the prepared target manifest lacks that exact id, preparation behaves as
follows before any bundle request:

- absent `fallbackToLive: true`, it refuses
  `SNAPBACK_REACT_GROUP_REGISTER_UNAVAILABLE`;
- with `fallbackToLive: true`, it returns an immutable
  `source: "live-fallback"` group with no fabricated commit or registration,
  and the provider starts ordinary live subscriptions for all children.

Authentication, authorization, integrity, malformed-response, timeout,
idempotency, limit, rate, and partial-registration failures never downgrade
to live fallback. Every existing `SNAPBACK_BUNDLE_*` refusal propagates. A
target that advertises support but fails registration also never downgrades.
The fallback is a visible author choice for one target-authored capability
absence, not a catch-all retry path.

LLP 0092 separately owns attach-deadline recovery. A well-formed bundle whose
deadline appears elapsed on the client can therefore become an opaque prepared
capability, but its rows cannot become visible. At provider transfer, an
already-elapsed local comparison takes the negative recovery shortcut.
Otherwise the provider attempts attach and waits for positive server
confirmation; server refusal or failure to confirm before the local remaining
window ends also recovers. The server's attach decision is authoritative
because `attachDeadline` is server-clock time; `Date.now()` can prove only
"do not attempt," never "attach succeeded."

Recovery disposes the pending owner and starts ordinary fresh subscriptions
with visible `source:"live-recovery"`,
`reason:"attach-deadline-expired"`, and `boot:null`. It never reports
registered boot and does not reuse the expired rows, grant, or registrations.

Neither path upgrades the target's LLP 0064 capability class. Registered boot
is a startup-consistency fact, not offline or local-first support.

## Authority, races, and cleanup

Preparation captures the headless client's authority before the request and
passes that capture through the request owner's compare-before-publication
gate. It compares again before returning and at provider transfer. App
binding, client lifecycle, settled auth mode, and admitted dev identity are
part of the same fence. The prepared `userId` is forwarded unchanged through
registered adoption, reconnect, expiry/delta recovery, and ordinary fallback;
the provider may not substitute another development principal. A late response
that became client-owned is disconnected immediately; a response refused
inside the transport publication gate was never granted to client custody and
is removed by LLP 0092's bounded pending-owner reaper. A successor authority
never adopts predecessor rows, subscriptions, grants, authorization
projections, or resume coordinates. Authority replacement invalidates every
unadopted registration before the barrier resumes.

Provider construction registers LLP 0059's `AuthBarrierParticipant` before
making group state observable. LLP 0053 separately owns each auth-scoped
child's namespace, authorization fence, invalidation projection, and
generation-fenced publication. Disposal stops child handles, releases
unconsumed registrations and the shared connection, waits for existing
headless settlement, and joins barrier unregistration; the list is an
obligation set rather than a requirement to unregister the barrier before
blanking. Late callbacks are fenced by provider/store generation.

Malformed post-response validation, authority replacement, abandoned
preparation, provider-construction failure, deadline recovery, and ordinary
provider disposal each have an idempotent terminal cleanup path. A prepared
owner not transferred by its attach deadline automatically starts best-effort
connection cleanup; this client timer bounds normal abandonment while the
server's LLP 0092 reaper remains authoritative under clock skew, process
death, or network loss. Explicit `dispose()` may clean earlier and is
idempotent with the timer. HMR replacement follows complete predecessor
disposal plus new binding and preparation; it does not mutate or transfer a
prepared group in place.

## Evidence and acceptance

Implementation is complete only when all of the following pass:

1. codegen fixtures prove deterministic runtime and declaration output,
   suffix-collision naming, Unicode/key-order/parameter/persistence golden
   hashes shared with the client, route-manifest identity binding, mixed-query
   and non-string-parameter ineligibility, exact duplicate emission followed
   by pre-I/O preparation refusal, and stale/forged refusal;
2. client tests prove one register request, exact response validation,
   authority and dev-identity replacement fencing, commit zero, exact
   positional response validation, auth-scoped adoption, malformed-response
   rollback, automatic abandoned-preparation cleanup, server-confirmed attach
   before publication, tamper refusal, opaque public preparation and provider
   custody, and zero ordinary snapshot requests after registered adoption;
3. React tests prove one shared connection, one-shot child consumption,
   same-commit initial snapshots, lazy child adoption, post-boot independent
   deltas, unadopted-delta superseding recovery, one-shot transfer, cleanup,
   HMR replacement, capability-only fallback, authority replacement, and
   attach-expiry live recovery;
4. the generated Signal Desk adapter is exercised end to end and its retained
   receipt records `source: "registered-bundle"`, the non-null commit, live
   delivery after boot, mutation settlement, and cleanup;
5. a packed cold install imports the generated group declarations and builds
   the React consumer without repository-local paths; and
6. a target conformance suite proves the closed request/response DTOs,
   sender-bound grant mint/replay, protocol/namespace replay scope,
   preflight-before-pending-owner attach, expiry/reaping, and live delivery
   before that exact instance advertises `registered_bundle_boot_v1`;
7. the guide and capability index describe the generated registered path and
   its exact fallback/recovery boundaries; and
8. `./ref-check --verbose` validates the governing references.

The receipt must distinguish generated source, binding preparation,
register-mode adoption, and real adapter consumption. A lower-level package
fixture alone cannot satisfy item 4.

## Rollout and rollback

Rollout is additive:

1. retain name-based React and independent live-query compatibility paths;
2. emit `groups` only when `defineRoutes` is present;
3. migrate one maintained demo and its real adapter receipt;
4. keep deliberate live fallback visible in diagnostics; and
5. graduate the generated path only after clean-install and real-adapter
   evidence pass.

Rollback removes route-group generation and preparation from new examples
while preserving the existing LLP 0090 bundle endpoint and LLP 0102 React
surface. Generated group artifacts carry a format version, so incompatible
future changes require a new version rather than reinterpretation.
