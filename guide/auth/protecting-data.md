---
title: Protecting live and retained data
id: auth.protecting-data
order: 4
audience: agent-first
capabilities: [auth.table-visibility, auth.invalidation-barrier, auth.authorized-leases]
authorities: [llp/0053-authorization-invalidation.rfc.md, llp/0059-session-projection-and-client-barrier.spec.md, llp/0231-entity-and-permissioning-recommendation.rfc.md, src/auth/invalidation.rs, src/auth/mode.rs, src/auth/service_fence.rs, src/local.rs, src/local/authorization_acceptance.rs, src/manifest.rs, src/runtime.rs, src/server.rs, demos/_kit/tests/auth-invalidation-client.mjs, packages/snapback-codegen/define.mjs, packages/snapback-codegen/index.mjs, packages/snapback-codegen/codegen-summary.mjs, packages/snapback-client/index.mjs, packages/snapback-contract/authorized-lease.mjs]
examples: [demos/card-game, demos/card-game/snapback/schema.mjs, demos/pointing-room, demos/pointing-room/snapback/functions.mjs, demos/pointing-room/tests/acceptance/disclosure-invariant.mjs, demos/_kit/tests/auth-invalidation-client.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-11
reviewed-authorities-digest: sha256:6f285172fd891ad1129baff8ae24a825bb3e36c8d5668cb02bfdcae34874edeb
---

# Protecting live and retained data

> **Local target only.** These guarantees are witnessed on the canonical
> Ibex/SQLite target. Hosted auth is not available; see
> [target honesty](./targets.md).

Start with [sessions and principals](./sessions-and-principals.md) to sign in
and scope a query, or the [hidden-hands recipe](../recipes/hidden-hands.md) for
the shortest end-to-end example. This page is the systematic reference for
what happens after private data becomes live or retained.

<!-- since: 0.1.19 -->

## Declare who can read each table

Add one `.visibility(...)` declaration to each `defineTable(...)` chain. The
closed choices are `{ kind: 'public-read' }`, `{ kind: 'owner', field }`,
`{ kind: 'membership', declaration, resourceField, roles }`, and one bounded
top-level `anyOf([...])` over owner and membership arms. There is no
`public()` helper: use the literal public-read record so intentionally public
data stays explicit and greppable.

Card-game declares the hidden-hand boundary on the table itself:

```js source=demos/card-game/snapback/schema.mjs
    .visibility({ kind: 'owner', field: 'ownerId' })
```

The owner field must exist. A membership declaration must resolve to a
`.membership(...)` declaration. On a child governed table,
`resourceField` must exist as a required `v.id(...)` of that membership's
resource table. On that resource table itself, use `resourceField: '_id'` so
the row's system id is the membership resource. Every named role must be in
that declaration's non-pending role vocabulary.
Public-read is a policy decision, not a development fallback.

Use `anyOf` for the common “owner or relationship” row boundary:

```js fragment reason="bounded relationship visibility declaration"
followingFeedEntries: defineTable({
  authorPrincipalId: v.principal(),
  authorProfileId: v.id('profiles'),
  body: v.string(),
}).visibility(anyOf([
  owner('authorPrincipalId'),
  {
    kind: 'membership',
    declaration: followings,
    resourceField: 'authorProfileId',
    roles: ['following'],
  },
]))
```

The disjunction has 2–8 distinct arms, preserves authored order, and cannot
nest. `public-read` is not an arm: it would make the entire boundary public.
The compiler carries this exact predicate into generated query plans. Storage
evaluates the arms as one grouped OR, then ANDs authored query filters. A
membership-containing policy records all membership dependencies and uses the
conservative live-replace lane on relationship insert or delete. Anonymous
callers satisfy neither arm. All restricted table policies are deliberately
ineligible for authority-independent RQS digests.

Model a follow graph as a dedicated resource-scoped membership projection,
for example `(follower principal, followed profile, 'following')`. The owner
arm includes an author's own rows without inventing a persisted self-follow
edge. Keep the projection focused on authorization facts; do not use a public
roster query as the feed boundary.

This release is the warn phase. A table without the declaration still
generates, but codegen reports `SNAPBACK_AUTH_TABLE_VISIBILITY_IMPLICIT` with
one reviewer-gated remediation per policy kind and a guide pointer. Invalid
declared policies fail generation with stable `SNAPBACK_TABLE_VISIBILITY_*`
codes. The reference registry lists the complete family; the cross-reference
checks most useful while adopting it are
`SNAPBACK_TABLE_VISIBILITY_OWNER_FIELD_UNKNOWN`,
`SNAPBACK_TABLE_VISIBILITY_MEMBERSHIP_DECLARATION_UNKNOWN`,
`SNAPBACK_TABLE_VISIBILITY_MEMBERSHIP_ROLE_UNKNOWN`, and
`SNAPBACK_TABLE_VISIBILITY_RESOURCE_FIELD_UNKNOWN`. The generated schema
manifest and `artifacts.json` summary project declared and implicit tables for
review.

`.visibility(...)` and `.assetSharing(...)` are independent declarations.
Declaring one does not declare, infer, or conflict with the other. Table policy
composes into generated direct query/live-query plans and ordinary handler
`ctx.db` reads. Search, relational queries, class-M field masking, writes, and
egress remain separate boundaries.

### Authorize first, then elevate the exact handler read

Named JavaScript queries and mutations are trusted server code, but ordinary
`ctx.db` is intentionally caller-scoped. If a handler forgets an authorization
check, owner or membership visibility still hides the row. When the handler
must inspect protected rows on behalf of its own authorization logic, first use
the host-owned permission declaration, then select `ctx.db.elevated` at the
read that requires trusted authority:

```js fragment reason="permission check before explicit elevated handler reads"
export const getMessageWithQuote = defineJsQuery({
  args: { conversationId: v.id('conversations'), messageId: v.id('messages') },
  reads: ['conversationMembers', 'messages'],
  async handler(ctx, args) {
    await ctx.permissions.conversationMembers.requireRole(
      args.conversationId,
      'member',
      'admin',
    );

    const message = await ctx.db.elevated.get('messages', args.messageId);
    if (!message || message.conversationId !== args.conversationId) return null;

    const quoted = message.quotedMessageId
      ? await ctx.db.elevated.get('messages', message.quotedMessageId)
      : null;
    return { message, quoted };
  },
});
```

Both checks are load-bearing. `requireRole` derives the effective principal on
the host and returns no roster data. The post-read resource comparison prevents
an authorized conversation id plus an unrelated message id from becoming an
object-reference bypass. Caller arguments never select elevated authority.

Elevated reads bypass only table row visibility. They keep the same bounds,
snapshot captures, OCC validation, and media deprojection as `ctx.db`; they do
not bypass field masking, write policy, membership writer rules, asset access,
or result/egress checks. The surface is available only to named queries and
mutations. Actions and generated/direct query plans cannot use it.

Use declarative membership visibility whenever the governed row directly names
the membership resource, including the resource table's `_id` self-resource
case. Multi-hop authorization is still deliberately undeclarable: for example,
a receipt that names a message while membership is keyed by the message's
conversation cannot express that join in the visibility grammar. Either
denormalize the conversation id onto the receipt and maintain that invariant,
or repeat the sanctioned handler pattern in **every** named function:

1. Resolve and validate the resource relationship with a bounded elevated read.
2. Call the declaration-bound `ctx.permissions` check for that resource.
3. Perform only the remaining bounded elevated reads, validating every supplied
   id belongs to the authorized resource.
4. Add a negative identity test proving a non-member or cross-resource id is
   refused or hidden.

Do not centralize only the happy path while leaving one live query, receipt
mutation, or quote lookup unchecked. This repetition is intentional because it
is where otherwise-correct realtime code goes subtly unsafe.

## Declare field masking that still lives in a JS handler

An opaque `defineJsQuery` or `defineJsLiveQuery` that returns every row but
conceals selected result fields can add `fieldBoundary: { fields: ['value'],
condition: 'round is revealed or the caller owns the vote' }`. `fields` must
be a non-empty unique list, `condition` must be a non-empty free-text claim,
and codegen refuses a named field absent from a checkable effective result
contract. The stable refusal family is `SNAPBACK_FIELD_BOUNDARY_SPEC_INVALID`,
`SNAPBACK_FIELD_BOUNDARY_FIELDS_INVALID`,
`SNAPBACK_FIELD_BOUNDARY_CONDITION_INVALID`, and
`SNAPBACK_FIELD_BOUNDARY_FIELD_UNKNOWN`.

This is explicitly **handler-enforced, not proven**. It does not compose a
field policy into the data plan, withhold raw values from the handler, prove
noninterference, or detect masking code that omitted the declaration. The
generated `artifacts.json` summary lists every declaration under
`fieldBoundaries`, and codegen's text summary labels each one
`handler-enforced (not proven)`. Keep a two-principal acceptance test beside
the declaration: one principal must observe the concealed form while the
entitled principal observes the value, then both must observe the value after
the disclosure condition changes. Pointing Room's `liveTally` is the worked
case. This residual exists until LLP 0231's class-M sibling supplies an
enforced field-masking grammar.

## Check the negotiated capability, not route existence

`authProgramReadiness` in inspect reports separate build/runtime facts:
provider core, the shared invocation gate, staged mode, connection binding,
two-phase revocation, `AuthCoordinator`, authorization invalidation, authority
descriptors, authorized leases, and derived session-activation readiness.

The authenticated `client.authSession()` projection then reports what this
exact connection may use:

- `availability.onlineRequestResponse`;
- `availability.authScopedLive`, including the required invalidation protocol;
- `availability.retainedReads`, requiring invalidation **and** authorized
  leases; and
- `availability.queuedReplay`, requiring authority descriptors.

In sessions mode, an auth-scoped live subscription is admitted only when both
server and client negotiate `authInvalidationProtocol: 1`. Retained reads also
require `authorizedLeaseProtocol: 1`. A route present behind an unavailable
facet is not a supported capability.

Configure `SnapbackClient` with `authInvalidationProtocol: 1`; the client then
offers `x-snapback-auth-invalidation-protocol: 1` on finite live requests and
includes `authInvalidationProtocol: 1` when it opens a connection. A clean-room
HTTP client must send those same values itself. If Snapback answers
`SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED`, add the missing offer or
reopen a stale connection with it before retrying.

## Connection grants bind live work to authority

The string your app supplies as `connectionId` is a logical sharing label. On
open, Snapback returns a granted id, a secret connection token, and the exact
authorization-invalidation expectation. The snippet below is the kit test's
**mock server fixture** answering an open — it models the wire shape a real
server returns, not application code you write:

```js source=demos/_kit/tests/auth-invalidation-client.mjs
      return response({
        connectionId: 'granted-auth',
        connectionToken: 'sct_auth',
        ephemeralExpiryProtocol: 1,
        wireVersion: 'snapback.v1',
        authorizationInvalidation: {
          protocolVersion: 1,
          issuerId,
          connectionGeneration: 2,
          authorization,
          versionStream: 'stream-A',
        },
      });
```

That grant is authority, not a bearer-shaped routing convenience. It is bound
to one anonymous authorization stream, one exact session generation, or one
scoped service-principal authority plus its exact token/deadline carrier. The
service form keeps the durable resolved authority separate from the token and
its service-publication fence, so ending one token cannot widen or silently
rebind the grant. Every live subscribe/resume, outbox drain, ephemeral act, and
publication validates the grant token and binding at its final effect fence.
HTTP sends the token in `x-snapback-connection-token`; browser WebSockets use
the negotiated `snapback.connection-token.*` subprotocol.

Every auth-scoped live subscribe also carries this closed
`authorizationNamespace` identity:

```js fragment reason="closed wire shape for clean-room client authors"
{
  clientStoreId: 'durable-store-id',
  queryKey: 'canonical-query-and-arguments',
  queryInstanceId: 1,
}
```

`clientStoreId` identifies the durable client store, `queryKey` is the
client's canonical query-plus-arguments key, and `queryInstanceId` is a
positive counter distinguishing successive materializations of that key.
`SnapbackClient` creates this object for its live-query path. Clean-room
clients must persist and advance the identity with their store rather than
minting all three fields per request. Omitting it is refused as
`SNAPBACK_AUTH_INVALIDATION_NAMESPACE_REQUIRED`.

An auth transition clears cached grants and reconnects under a fresh grant.
Never persist, copy between clients, log, or manually reuse a connection
token. Let one `SnapbackClient` multiplex consumers that intentionally share a
logical connection label.

## Authorization change is a persistent obligation

Logout is one visible case, but the barrier also covers permission or
membership changes, coarse authorization-version advances, activation/reset
boundaries, and protected ephemeral-room authority changes. A change that may
shrink a result raises a revisioned obligation against the exact live/query
scope.

The reachable-client sequence is:

1. The client receives the obligation and synchronously applies its maximum
   disposition—normally `quarantine`, sometimes terminal `delete`.
2. Live rows blank; retained reads block; optimistic/outbox custody for that
   scope suspends. Ordinary live frames cannot repopulate it.
3. The server resolves with a fresh satisfying snapshot or trusted terminal
   denial tied to the same scope/revision/witness.
4. The client atomically commits the disposition, snapshot or tombstone,
   queue/store resolution, and local boundary.
5. Only after that commit does it acknowledge the opaque resolution token.

Within one authenticated authorization-stream incarnation, a strictly greater
authorization epoch is the current obligation, not a stale subscribe
expectation. The client advances that exact fence before applying the
resolution. A lower epoch or different incarnation/version stream remains
stale and requires the normal replacement bootstrap.

The kit test pins the order:

```js source=demos/_kit/tests/auth-invalidation-client.mjs
  assert.deepEqual(order.slice(0, 3), [
    'queue-apply:1',
    'queue-resolve:1',
    'ack:ack_1',
  ]);
```

A lost delivery is safe because obligations are level-triggered state, not
one-shot events: connection open, subscribe/resume, drains, and heartbeats
re-project unresolved work. A stale acknowledgement re-quarantines; a duplicate
successful acknowledgement is idempotent. A queue/store failure leaves the
boundary blank and stale until the exact obligation re-fires with valid proof.

Protected ephemeral rooms use the same principle: affected sinks quiesce before
the authorization-changing commit becomes visible, then fresh room
reauthorization either admits the successor generation or revokes it.

## Retry is bounded and explicit

Automatic satisfying resnapshot attempts are bounded. Exhaustion leaves the
scope quarantined; reconnect or subscribe does not reset the episode. The
`POST /live/authorization-invalidation/manual-retry` operation is an
authority-checked recovery control that requires the current connection,
scope, and a fresh idempotency id. It is not an ordinary UI retry button and
cannot replace an episode before automatic attempts are exhausted.

Use normal client/barrier recovery first. Operator or acceptance tooling should
invoke manual retry only for a surfaced unresolved episode, keep the same
current authority, and treat capacity, clock-rollback, stale-scope, and denial
diagnostics as fail-closed outcomes.

## Authorized leases bound unreachable honest clients

An offline client cannot receive an obligation. Therefore every readable
auth-scoped retained snapshot needs a server-issued `AuthorizedLease`, bound to
the exact principal, authorization version, app/data version stream, active
artifacts, client store, query key, and query-instance id.

`authorizedLeaseProtocol: 1` advertises that the session can use this optional
protocol; it does not make every query retainable. The canonical client calls
the lease endpoint only when the generated live-query reference carries its
explicit protected-retention class. A non-retainable query remains an ordinary
online live query even when the same client offers lease support.

Lease acquisition is one full revalidation, not a heartbeat:

1. The client durably reserves a fresh `leaseRequestId` and records the request
   start against its clock high-water.
2. `authorizedLeaseQuery` performs the full query. At one server commit-order
   boundary, Snapback proves the app-data head, authority, active artifacts,
   and absence of a pending invalidation obligation.
3. The response carries the snapshot and lease together. The client validates
   its closed shape/bindings and atomically commits rows, witness, exact lease
   bytes/hash, and derived deadline before render.

```js source=packages/snapback-client/index.mjs
    return this.#req('POST', `/query/${encodeURIComponent(name)}/authorized-lease`, {
      args,
      auth: SnapbackClient.auth(userId),
      read_set: readSet,
      leaseRequestId,
      clientStoreId: namespace.clientStoreId,
      queryKey: namespace.queryKey,
      queryInstanceId: namespace.queryInstanceId,
      ...(generation === null ? {} : { expectedGeneration: generation }),
    }, undefined, { expectedAuthorityCapture: authorityCapture });
```

V1 defaults to 24 hours and has a 24-hour hard maximum; configuration may only
shorten it. Session/provider expiries clamp the server deadline. The client
derives its deadline from the request-start clock plus the server-issued
duration, so network delay shortens validity rather than extending it.

Heartbeat, delta delivery, reconnect, acknowledgement, mutation, session
refresh, or presenting an old lease never renews it. Renewal is another full
query and atomic proof. At or beyond the exact client deadline—or on clock
rollback, malformed/missing lease, mismatched identity/witness/instance, stale
activation, or invalid request reservation—the store commits delete-before-read
for that query instance.

The server verifies the lease MAC because only it owns the key. The client
validates structure and bindings and hashes the exact bytes for custody
corruption detection; it cannot cryptographically authenticate a server MAC.

## Understand the threat boundary

The lease bounds an honest device that is temporarily unreachable. It is not
anti-tamper: a hostile client can alter its clock or read bytes it already owns.
If adversarial-client access to retained private bytes is in scope, do not
enable retained reads. A legitimate revocation may remain visible to an honest
offline device until its lease deadline; that is the explicit local-first
product tradeoff.

## Anti-patterns

- **Do not handle invalidation as an edge event.** Preserve the obligation
  until committed resolution and acknowledgement.
- **Do not ACK before the boundary/store commit.** Delivery is not discharge.
- **Do not render quarantined rows or allow ordinary frames to refill them.**
- **Do not treat reconnect as manual retry or lease renewal.**
- **Do not cache authorized rows outside the lease-enforcing client store.**
- **Do not infer hosted guarantees from the local readiness projection.**
- **Do not treat `.assetSharing(...)` as a table visibility declaration.**
- **Do not use public-read merely to silence the implicit-visibility warning.**
