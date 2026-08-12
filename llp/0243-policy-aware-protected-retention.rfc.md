# LLP 0243: Policy-aware protected retention

**Type:** RFC
**Status:** Accepted
**Systems:** Client integration, Offline sync, Auth, Authorization, Live
Queries, React, Expo, Client storage, Assets, Code generation, Diagnostics,
Guide, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-12
**Revised:** 2026-08-12 (entered Review for the author-directed single-family
`llp-super-refine` loop: Codex GPT-5.6-sol xhigh only; Claude intentionally
skipped). 2026-08-12 (mechanically renumbered from LLP 0241 to LLP 0243 after
origin assigned LLPs 0234–0235). 2026-08-12 (author-directed acceptance after
Round-3 same-revision Codex GPT-5.6-sol xhigh convergence). 2026-08-12 (round-1 revision: made v1 a generated-plan-only extension
of the existing LLP 0053/0043 query-instance lease carrier, restored server-only
MAC verification, and froze key/eviction/backup custody). 2026-08-12 (initial
Draft synthesized from LLP 0236 P8 and the authorization/retention boundaries
in LLP 0043 and LLP 0053)
**Related:** LLP 0008, LLP 0011, LLP 0012, LLP 0043, LLP 0053, LLP 0059,
LLP 0061, LLP 0090, LLP 0107, LLP 0114, LLP 0126, LLP 0155, LLP 0166,
LLP 0218, LLP 0219, LLP 0221, LLP 0229, LLP 0236, LLP 0238, LLP 0239,
LLP 0240, LLP 0241, LLP 0242, Diary 0058
(relay-room-expo-backend-bakeoff), Diary 0067, Diary 0073

## Summary

Snapback should ship a bounded protected-read retention profile for first-party
clients. It allows an authenticated app to render an explicitly declared query
projection during cold offline startup, while preserving user-switch wipe,
authorization invalidation, expiry, view-once exclusion, artifact binding, and
fresh-snapshot-before-live-release.

This is not a generic persistent query cache. Only a generated query whose
result contract, authority inputs, invalidation profile, persistence policy,
and excluded fields are all known may opt in. The stored value is a
query-scoped authorized projection with a server-issued lease and purge
obligations. Offline UI always labels it `retained`, never current.

The RFC turns Snapback’s asymmetric offline advantage into a coherent one:
LLP 0218 already owns durable offline writes and settlement; this proposal adds
the narrow read profile conventional private messaging needs without pretending
that arbitrary protected queries are safe to persist.

## Motivation

Across Clique and the messaging bakeoffs, Snapback won offline writes but apps
hand-built private snapshots for chats, messages, search, and selected media.
The JS arm cold-retains public/authority-independent results but ordinary
protected chat reads remain an application responsibility. This prevents a
broad, truthful offline story for the most common authenticated app shape.

The hard part is not storing JSON. It is knowing when old bytes are still
displayable and destroying or quarantining them before the wrong principal or
new authority generation can observe them. LLP 0053 already defines the core
physics and mechanisms: user/authority partition, authorization witnesses,
quarantine/delete-before-read, server-signed lease, hard maximum, and fresh
snapshot on resume. The missing product surface is an admitted generated view,
real browser/Expo store implementation, and first-party hook projection.

## Constraints

- Offline revocation cannot erase a disconnected device. The product bounds
  exposure through a server-issued lease and must say so plainly
  (LLP 0053#retained-and-offline-authorization).
- Retained output is never presented as authoritative current state. Freshness
  remains a first-class value (LLP 0155#p4-prediction-is-never-authority).
- User switch, authority-instance mismatch, missing/corrupt witness, and known
  negative authorization change quarantine/delete before application read.
- Persistence is query/projection-scoped, not whole-table replication or
  cross-query row normalization (LLP 0155#move-2-first-class-query-scoped-local-materialization).
- View-once, expiring secret, and other no-persistence data must be
  categorically excludable even when present in an online result.
- Real IndexedDB and native/file carriers, including process termination and
  corruption, are acceptance requirements; fake-store green is insufficient.
- Outbox/optimistic state remains separate. A retained server snapshot may
  compose with pending presentation, but never absorbs queued intent into its
  authority claim (LLP 0218).

## Decision

### D1. Retention is declared on a generated projection

An eligible query declares:

```js
export const conversationPreview = defineLiveQuery({
  args: { conversationId: v.id("conversations") },
  result: results.records(conversationPreviewContract),
  authorization: authorization.authorityProfile("conversationAccess", {
    scopeArg: "conversationId",
  }),
  retention: retention.protectedView({
    profile: "private-preview-v1",
    maxOfflineMs: 6 * HOUR,
    exclude: ["messages.viewOnceAsset", "conversations.secretKey"],
  }),
  plan: projection.children(...),
});
```

The declaration does not itself prove eligibility. V1 admits only a generated
host/relational/LLP 0242 projection plan with an exact result contract,
compositional completeness witness, generated exclusion provenance, and a
closed owner/userId or strict LLP 0240 membership-backed policy. Opaque or exact
JavaScript handlers, arbitrary custom authorization, and the coarse-global
custom-policy lane all refuse with `SNAPBACK_RETENTION_POLICY_UNPROVABLE`,
naming the missing proof and the online-only fallback. They may graduate only
under a future capability version after result, dependency, invalidation, and
derived-field exclusion completeness are independently proved.

`maxOfflineMs` is required to opt in; omission means no protected persistence,
not an ambient default. The authored duration may narrow but never exceed LLP
0053’s target clamp and 24-hour hard maximum. Guide examples use six hours, but
that example is not a hidden platform default.

### D2. The retained-view descriptor is complete and content-addressed

`RetainedProtectedViewV1` is an eligibility/projection descriptor installed
inside the existing LLP 0053 `AuthorizedLease` and LLP 0043 JS
`authorizedQueryRetention` state machine. It is not a new lease, coordinator,
or store owner. It binds:

- app, query, canonical-args hash, collision-check canonical args bytes,
  result-contract, semantic, and executable activation compatibility identities;
- exact projected fields and redaction/exclusion transform;
- user id and authority-instance partition;
- authority dependency/profile identity and scope;
- invalidation stream/incarnation/epoch witnesses;
- lease protocol, authored duration, clamp, and hard-expiry profile;
- store schema/encoding generation;
- data snapshot/version and resume disposition;
- asset/media retention classes contained in the projection; and
- maximum rows/bytes and eviction priority.

The semantic `descriptorContractHash` is part of the generated ref and stored
fragment key. A
change to result fields, exclusions, authority inputs, retention duration, or
encoding produces a successor descriptor; predecessor bytes do not slide under
the new contract. Each emitted/stored descriptor instance also records LLP
0241’s unique producing `generationId`, so immutable cuts never alias. An
evidence-only successor rotates that provenance address but, by explicit
per-consumer disposition, preserves `descriptorContractHash` and retained
compatibility; a semantic/executable/retention change rotates both.

Every lease, fragment, invalidation, and tombstone preserves the existing exact
`(clientStoreId, queryKey, queryInstanceId)`, generations/frontiers, composite
witness, request reservation, derived deadline, and clock high-water.
`queryInstanceId` is allocated before subscribe and never reused, so stale A
cannot affect equal-key successor B; terminal retirement destroys A before B
allocates.

Before LLP 0241’s `generationId` capability is present, the existing LLP 0053
`activation_hash` remains the exact binding. During dual emission the descriptor
records both and refuses semantic/executable disagreement. Protected retention
never depends on automatic generation reload; an incompatible generation change
follows the ordinary query-instance quarantine/delete and fresh-snapshot path.

### D3. Server leases bound offline display authority

An authorized online snapshot may carry the existing LLP 0053
`AuthorizedLease` v1 only after the server evaluates the exact retained-view
descriptor and current principal. The `descriptorContractHash` is an additional
activation/query binding inside that envelope; all existing client-store,
query-instance, principal, issuer, authorization, data, activation, request,
time-clamp, key-id, and MAC fields remain mandatory.

Rules:

- authored `maxOfflineMs` may only narrow the target default;
- no lease exceeds 24 hours, preserving LLP 0053’s hard maximum;
- the client cannot refresh or extend while offline;
- refresh reauthorizes and produces a new snapshot/witness before extending;
- logout/user switch invalidates the entire predecessor authority partition
  synchronously;
- a known negative authorization event quarantines immediately even if the old
  wall-clock lease remains; and
- unknown/pruned disposition, incarnation mismatch, stream mismatch,
  descriptor/issued-byte-hash mismatch, malformed envelope, clock rollback, or
  expiry deletes before read.

Cryptographic verification remains exactly at LLP 0053’s locus. The offline
client validates the closed envelope/canonical MAC shape, exact binding and
stored-byte hash, clamps/duration, derived deadline, and durable clock
high-water; it has no verifier secret and does not authenticate `key_id` or the
MAC. Keyed MAC and unknown-key refusal occur only when the server keyring sees
the lease. A canonically shaped forged MAC may pass client custody validation by
design and grants no capability beyond bytes already on that device; this RFC
makes no client-side signature-verification claim.

A principal may retain multiple view descriptors/scopes, each with independent
lease and eviction. Lease existence is not permission to execute arbitrary
local queries over the fragment.

### D4. Exclusion happens before bytes enter the durable store

The server/result normalizer constructs a retention projection from the exact
online result contract. Excluded fields are removed or replaced with a declared
closed placeholder before the client-store write. They are not stored encrypted
beside the visible fragment, logged, indexed, or left for the renderer to hide.

V1’s non-retainable registry includes at least:

- view-once/pending-recipient asset delivery refs and URLs;
- single-use credential/recovery/challenge material;
- server-marked `retention: "never"` fields;
- values whose expiry precedes the requested lease unless their field contract
  defines expiry-aware omission; and
- raw signed delivery URLs or bearer material.

Typed ordinary asset ids may be retained only when the asset intent/policy
permits metadata/reference retention. Delivery URLs are always reissued after
fresh online authorization; retained media projection shows an offline-safe
placeholder/local app-owned thumbnail only if explicitly declared.

Codegen computes field paths and derived-field provenance from the generated
plan, schema, result, and asset contracts. Every output field records all source
fields/transforms that can contribute to it; a derived value is non-retainable
if any source class is non-retainable unless an approved irreversible
declassification transform says otherwise. Free-form path strings are validated
to exact contract members and cannot omit or rename away a required
non-retainable class.

### D5. Client storage is partitioned, bounded, and fail-closed

The framework-neutral client store gains a retained-view namespace keyed by:

```text
(app, data identity, user, authority instance, descriptor,
 canonical-args hash, query key, query instance)
```

Canonical argument bytes remain inside the opaque encrypted/controlled record
for collision-safe equality and are never plaintext index keys. It stores
opaque projected fragments plus witnesses, never source tables. It
enforces declared per-view row/byte limits and target-wide quotas with
deterministic LRU/priority eviction. Eviction affects offline availability only;
it never acknowledges outbox intent or settlement.

One durable store writer owns eviction across IndexedDB tabs or native
processes. Access commits a monotone store-local recency sequence in the same
transaction as the record operation; victims order by declared priority, then
that sequence, then descriptor/key bytes. Wall-clock order is never the
determinism source. Crash/reopen and writer takeover resume from the durable
high-water.

On open, before exposing any fragment to observers, the store validates:

- physical/schema generation;
- integrity/checksum and complete transaction marker;
- authority partition and current custody;
- descriptor/artifact compatibility;
- lease structure/issued-byte hash/binding/deadline/clock high-water (server
  MAC verification is not available offline);
- invalidation/disposition witnesses; and
- exclusion-transform version.

Validation returns `renderable-retained`, `quarantined`, or `deleted` with a
typed reason. Partial/corrupt records delete atomically. Migration either
preserves the full descriptor/witness contract or drops the fragment; it never
best-effort decodes protected bytes.

Browser IndexedDB and Expo/native durable carriers implement the same logical
contract. A volatile/memory store may advertise online materialization but not
protected cold retention.

V1 logical export/backup omits this namespace with a typed manifest entry.
Physical device backup may preserve it only when the existing carrier custody
contract preserves the complete opaque store, keys, query-instance state, and
rollback high-waters; no best-effort logical restore is admitted.

### D6. The first-party client uses the ordinary query lifecycle

No separate cache hook is introduced. Under LLP 0238:

```ts
const view = useSnapbackLiveQuery(api.conversationPreview, args);
```

may return:

```ts
{
  data,
  status: "ready" | "connecting" | "offline" | "blocked",
  freshness: "current" | "retained" | "optimistic" | "unknown",
  retained: {
    expiresAt,
    capturedAt,
    authorityProfile,
    exclusions,
  } | null,
  diagnostic,
}
```

Cold offline boot can expose `data` only with `freshness: "retained"` after
D5 validation. Pending optimistic layers may project over it but remain
separately inspectable and cannot change `freshness` to current. Reconnect
fresh-snapshots and reauthorizes before releasing `current`; resume tokens do
not bypass the barrier.

Headless clients observe the same fragment through the shared watch handle and
retention facts. Server-rendered/web-static paths must opt in separately and may
not serialize protected retained data into public HTML.

### D7. Invalidation is an obligation with coarse-safe v1

Every eligible view declares authorization-event dependencies. On a connected
client, negative events force immediate quarantine and a fresh authorization
snapshot. On disconnected clients, the lease bounds the unobserved window.

Two causes remain distinct. Ordinary data-plane changes that shrink a composed
result or policy fact ride LLP 0053’s captured result-dependence/matcher
obligations and exact query-instance fence. The global authorization epoch is
the coarse v1 answer only for LLP 0053’s enumerated authorization-event class;
it is not a substitute for matcher-path row/removal obligations.

Subject/scope-targeted invalidation is an optimization only after completeness
proof. V1 may use the global authorization epoch and conservatively quarantine
all protected views for the user/app when any relevant event is observed.
Coarse eviction is acceptable; a missed revocation is not.

Positive permission changes do not make an offline-denied/absent view appear.
They are discovered by the next online snapshot.

### D8. Diagnostics and capability truth are visible before authoring

The capability index and generated ref state whether a view is:

- online only;
- public-retainable;
- protected-retainable on this target/store;
- protected-retainable with coarse invalidation; or
- refused, with the exact missing proof/capability.

Dev diagnostics report first retained render, lease near expiry, quarantine,
deletion reason, quota eviction, carrier degradation, and an app attempt to
persist an ineligible query. Payloads contain view/descriptor ids and safe
counts, never retained values.

The guide’s first example is a private conversation preview with offline boot,
explicit retained UI, reconnect, user switch, and view-once exclusion. A cold
agent must reach it from “cache private query,” “offline chat,” and every
retention refusal code.

## Compatibility and migration

Public/authority-independent retention and outbox storage continue unchanged.
The protected-view descriptor is a new capability/storage generation inside
the existing LLP 0043 `authorizedQueryRetention` slot and LLP 0053 query
instance; it does not import a second coordinator. Predecessor protected slot
records migrate deletion-only unless every old identity/witness field maps
exactly. Existing app-owned caches are not imported automatically because
Snapback cannot prove their authority, exclusion, or freshness metadata.

The migration path is app-controlled:

1. declare/qualify a retained view;
2. switch UI reads to the ordinary Snapback query hook;
3. clear the app-owned cache under the app’s own version migration; and
4. verify cold boot/user switch/revocation before removing fallback code.

A target/client without the capability refuses the retention declaration or
reports online-only according to a declared compatibility policy; it never
persists protected results as plain public cache.

## Alternatives considered

### Ship a generic persistent query cache

Declined. Query identity is not authorization, and a generic cache cannot infer
user-switch purge, negative permission changes, view-once exclusion, or lease
authority safely.

### Leave private snapshots to applications

Declined as the product destination. Every messaging builder recreated the same
state without the framework’s authority/artifact knowledge, weakening both DX
and safety.

### Encrypt retained data and skip purge/invalidation semantics

Declined. Encryption at rest does not answer which logged-in principal may
render the bytes, whether a permission expired, or how keys are revoked while
offline. It may complement carrier security, not replace policy.

### Retain whole authorized tables and query locally

Declined. It broadens custody, creates projection/existence oracles, and exceeds
the observed need. V1 retains exact query projections.

### Require live connectivity for all protected data

Safe but leaves the documented product gap intact and squanders Snapback’s
already-shipped lease/invalidation foundation.

## Rollout

1. Freeze the generated-plan descriptor as an extension of the existing
   `AuthorizedLease`/query-instance schemas and the non-retainable field and
   provenance registry; ship eligibility/explain with capability still false.
2. Implement real IndexedDB protected namespace, cold boot, partition wipe,
   corruption handling, monotone-writer eviction, matcher obligations, and
   coarse authorization-event invalidation.
3. Implement Expo/native carrier with process-kill/relaunch and device-level
   storage tests.
4. Add hook/headless projection, retained UI example, and diagnostics.
5. Qualify generated plans over owner/userId and strict LLP 0240 scoped-role
   profiles; keep every JS/custom/coarse-global policy refused.
6. Rebuild the Clique private chat cache and Relay Room offline preview from a
   published npm closure, alongside the existing outbox witness.

Capability support flips independently per carrier/target only after its full
adversarial matrix passes. The guide keeps the GAP visible elsewhere.

## Acceptance

- A private conversation preview renders after process termination/relaunch
  with the server unreachable and is visibly `retained` with expiry.
- The same fixture fresh-snapshots before `current` or live release on
  reconnect; an outbox replays only after its existing resync barrier.
- Logout/user switch exposes zero predecessor bytes synchronously.
- Known revocation, role downgrade, global epoch advance, lease expiry,
  descriptor/profile/generation rotation, missing/pruned witness, malformed or
  issued-byte-hash-mismatched lease, clock rollback, and corrupt/partial store
  each quarantine/delete before application read. A one-bit MAC change is
  refused by the server keyring; the offline client claims only structural and
  stored-hash substitution detection.
- A disconnected device cannot display beyond the hard lease maximum or extend
  it locally.
- View-once media, signed URLs, challenges, secrets, and every registry-marked
  non-retainable field are absent from durable bytes under direct store
  inspection.
- Quota eviction is deterministic, observable, and independent of outbox/
  settlement custody, including crash/reopen and competing-writer takeover.
- IndexedDB two-tab writer/follower behavior and Expo process-death behavior
  pass on real carriers.
- An ineligible JS/custom/coarse-global query and a target without durable
  protected retention refuse before storing bytes with a point-of-need
  alternative.
- A logical backup explicitly omits protected retained bytes; no restore can
  import them without preserving the complete physical carrier custody.
- A fresh npm-only agent builds offline private chat without an app-owned cache
  and without describing retained data as current.

## Risks

- The lease formalizes bounded offline disclosure, which some apps may find too
  permissive. Apps can narrow to zero/online-only or a shorter duration.
- Coarse invalidation can wipe much more than necessary. V1 prefers lost offline
  convenience to stale authorization; subject targeting graduates later.
- Exclusion registries can drift. They are generated/gated from field/asset/auth
  contracts and every new sensitive class must declare a retention disposition.
- Real-store migrations can strand protected bytes. Unknown generations delete
  fail-closed; backup/export custody must include or explicitly omit the
  namespace with a typed manifest.
- UI authors may hide the retained label. First-party hooks expose freshness;
  product presentation remains app-owned, so acceptance verifies the reference
  template and diagnostics rather than claiming universal UI honesty.

## Open questions

1. Should authorized local thumbnails be a Snapback-managed derivative class or
   remain app-owned in v1 while all signed URLs/view-once assets are excluded?

## Status

Accepted. This RFC requests an author decision on shipping a bounded protected
retained-view profile. V1 is generated-plan-only, extends the existing
never-reused query-instance/`AuthorizedLease` carrier, and keeps MAC verification
server-only. Until accepted and qualified per carrier, the current guide GAP and
application-owned-cache responsibility remain honest.
