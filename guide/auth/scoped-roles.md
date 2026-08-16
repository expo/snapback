---
title: Scoped roles and memberships
id: auth.scoped-roles
order: 5
audience: agent-first
capabilities: [auth.scoped-roles, authority.profile.v1]
authorities: [llp/0056-scoped-roles-and-memberships.rfc.md, llp/0100-membership-addressed-operations-and-pages.rfc.md, llp/0240-application-authority-profiles.rfc.md, packages/snapback-codegen/define.mjs, packages/snapback-codegen/index.mjs, src/manifest.rs, src/membership_rules.rs, src/runtime.rs, src/storage.rs, demos/rbac/tests/acceptance/rbac.mjs, demos/shindig/snapback/schema.mjs, demos/shindig/snapback/functions.mjs, tests/membership_principal_addressed_v0.rs]
examples: [demos/rbac, demos/shindig, packages/snapback-codegen/rbac-authoring.test.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-15
reviewed-authorities-digest: sha256:97ba8713efaf5213c8c01268a709db104f16f61aa95b4f1e7fc00096fcc838e3
---

# Scoped roles and memberships

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](./targets.md).

Snapback models authorization roles as rows with a system-recognized shape:
principal, optional resource, and role. The roster stays live app data, while
the host owns the transition checks, query semi-join, denial, invalidation, and
provenance. Roles are not copied into session claims.

The shipped v1 lane is for online queries, live queries, and mutations. It does
not yet make membership-gated results retainable offline, emit incremental
semi-join deltas, or support hosted targets.

## Privacy posture and reachable operations

Membership backing rows are fully private in v1: application code cannot list
them, ask whether one exists, or obtain their row ids, and `insert` returns
`null`. That posture deliberately forecloses administrator-driven
id-addressed `setRole`, `remove`, and `patch` in ordinary app handlers. The
methods exist for trusted migration/import contexts that already possess a
row id; the private app surface does not mint one. Do not source-dive for an
escape hatch—the absence is the security contract. The one other-targeted
write an app can reach is the explicit `principalAddressedWrites` removal
opt-in below, which addresses a principal, never a row.

| Operation under the private v1 posture | Reachable app path |
| --- | --- |
| create a resource plus its first holder | `bootstrap(...)` (resource scope) |
| add self or another principal | declared `insert` transition; returns no row id |
| accept/decline/change/remove the caller's own seat | `setSelfRole`, `removeSelf`, or `patchSelf` |
| remove another principal (kick) | `removePrincipal(resource, principal)` — requires the explicit `principalAddressedWrites` opt-in (below) |
| administrator changes/patches another existing seat | foreclosed: requires a private row id |
| read/list/sync the roster or test another seat's existence | foreclosed: use `memberOf`/`hasRole` semi-joins, `requireRole`, or the caller's own `_snapback.myMemberships` |

For invitations, keep the pending invitation in an ordinary app-data table
whose privacy policy fits the product. The invitee consumes that record and
performs a declaration-authorized self `insert` into the final membership
role. Alternatively, use a membership `pendingRole` only when the invitee can
finish through a self-addressed transition, as the app-wide example below
does. Do not imply that the inviter can promote the private row later: it
cannot obtain that row's id.

## Declare an app-wide role set

An app-scoped declaration omits the resource axis. This demo supports open
self-join plus member-issued invitations that only the invited principal can
accept or decline:

```js source=demos/rbac/snapback/schema.mjs
export const appMembers = defineTable({
  userId: v.principal(),
  role: v.string(),
}).membership({
  principal: 'userId',
  role: 'role',
  roles: ['member', 'admin'],
  pendingRoles: ['invited'],
  scope: 'app',
  provenance: 'full',
  transitions: [
    { op: 'insert', by: ['none'], target: 'self', to: ['member'] },
    { op: 'insert', by: ['member'], target: 'other', to: ['invited'] },
    { op: 'setRole', by: ['self'], target: 'self', from: ['invited'], to: ['member'] },
    { op: 'remove', by: ['self'], target: 'self', from: ['invited', 'member'] },
  ],
});
```

The transition grammar is closed. Each operation declares its allowed caller
class, self/other target, old/new roles, and—for inserts or patches—extra
fields. Unknown keys, undeclared roles, unreachable combinations, and empty
role sets fail artifact generation or activation. Runtime evaluation derives
the principal and current membership inside the write transaction; the caller
cannot supply either fact as authority.

For a role per resource, add a required resource field typed with the nominal
table id. `v.id('events')` is not interchangeable with another string-shaped
id:

```js source=packages/snapback-codegen/rbac-authoring.test.mjs
export const eventMembers = defineTable({
  eventId: v.id('events'),
  userId: v.principal(),
  role: v.string(),
  joinedAt: v.integer(),
}).membership({
  id: 'eventMembers',
  principal: 'userId',
  resource: 'eventId',
  role: 'role',
  roles: ['host', 'guest'],
  pendingRoles: ['invited'],
  bootstrapRole: 'host',
  lastHolder: { protect: 'host' },
  incidental: ['joinedAt'],
  provenance: 'full',
  transitions: [],
});
```

Codegen derives `resourceTable` from that validator and carries the nominal
type into the function artifact. An argument or row-field helper bound to
`Id<'organizations'>` is rejected before publication when the declaration
requires `Id<'events'>`.

<!-- since: 0.1.21 -->

## Reuse one role hierarchy in queries and table visibility

Decorate an existing resource-scoped membership with
`.authorityProfile(...)` when product roles form a finite hierarchy. The
profile is a codegen facade: the membership table remains the only roster and
authority store, and every write still uses the LLP 0056 transition seam.

```js fragment reason="AuthorityProfileV1 authoring shape; lowering, refusal codes, projection identity, and generation rotation are exercised in packages/snapback-codegen/rbac-authoring.test.mjs"
export const roomMembers = defineTable({
  roomId: v.id('rooms'),
  userId: v.principal(),
  role: v.string(),
  displayName: v.string(),
}).membership({
  id: 'roomAccess',
  principal: 'userId',
  resource: 'roomId',
  role: 'role',
  roles: ['owner', 'admin', 'member'],
  pendingRoles: ['invited'],
  bootstrapRole: 'owner',
  lastHolder: { protect: 'owner' },
  provenance: 'full',
  transitions: [],
}).authorityProfile({
  name: 'roomAccess',
  hierarchy: {
    owner: ['admin', 'member'],
    admin: ['member'],
    member: [],
  },
  roster: { visible: ['userId', 'role', 'displayName'] },
});
```

Chain the profile after `membership()`. Its `name` must equal the explicitly
pinned membership `id`. The scope must be a required `v.id(resourceTable)`,
the principal a required `v.principal()`, and the role a required `v.string()`
whose active and pending values are the closed `roles`/`pendingRoles`
vocabularies. `owner` must be an active role and the exact
`bootstrapRole`/`lastHolder.protect` role. Do not author the reserved
`_membership_pk` or `_membership_reverse` indexes; membership owns their
true-unique principal/scope and resource-leading holder lookup shapes.

The hierarchy names active roles only. Codegen computes its transitive closure
and writes literal role sets into the existing membership predicate and table
visibility IR. In the example, a predicate asking for `member` admits
`member`, `admin`, and `owner`; `invited` remains pending and gains no active
role implication. The resulting `AuthorityProfileV1` references the canonical
membership-predicate and table-visibility identities and records the scope,
lattice, owner invariant, authorization-event fields, bounded indexes,
subject derivation, and conservative coarse-global wake universe.

Functions with profile-backed membership predicates, profile-backed table
visibility, or declared writes to the membership table carry that profile's
`{ id, generation }` authorization dependence. Changing the role field,
hierarchy, or transition matrix rotates the generation and dependent function
identity; unrelated functions keep their existing identity. A broadening or
incomparable visibility edit still requires LLP 0234's remotely-prior,
content-bound approval and exact-set ratchet—generation rotation records the
change but does not approve it.

<!-- since: 0.1.23 -->

The qualified local, app-table-owned profile now composes with ordinary table
visibility, named handler admission, and two generated read references:
`api.roomAccess.list` and `api.roomAccess.myRole`. The first returns at most 100
rows projected to exactly `roster.visible`; the second returns zero or one
caller row and includes the role. Both take `{ scopeId }`, return `[]` to an
unauthorized caller, and capture the negative membership lookup so joining,
removal, or a role change wakes the live result. The initial list is bounded,
not paginated; applications needing more than 100 visible seats still need a
separately designed bounded page surface.

The membership table remains private under the operations table above. The
profile does not yet create invitation, role-change, owner-transfer, or client
hook surfaces. Composition with membership-visible search or asset sharing
fails generation with
`SNAPBACK_AUTHORITY_PROFILE_UNSUPPORTED_COMPOSITION_CLASS`; hosted targets fail
with `SNAPBACK_AUTHORITY_PROFILE_UNSUPPORTED_TARGET`.

### Admit a named handler once

When a named query or mutation already receives the membership resource as a
nominally typed argument, attach the same declaration-bound predicate to its
definition. This is available in both the Explicit and Familiar profiles:

```js fragment reason="authority-profile handler admission over a direct resource argument"
export const messages = defineJsLiveQuery({
  auth: 'authenticated',
  args: { roomId: v.id('rooms') },
  reads: ['messages'],
  membership: [
    roomMembers.hasRole(membershipResource.arg('roomId'), 'member'),
  ],
  handler: async (ctx, args) =>
    ctx.db.query('messages').withIndex('byRoom').eq('roomId', args.roomId).take(50).collect(),
});
```

Codegen closes `member` through the profile hierarchy, adds the membership
table to the captured read set, and emits the role check before the opaque
handler. A denied row-set query or live query returns `[]`; codegen refuses
scalar/document results and `results.records(...)` contracts whose `minItems`
is greater than zero because those shapes cannot represent a blank denial. A
denied mutation is a terminal `SNAPBACK_AUTH_PERMISSION_DENIED` and cannot be
caught by handler code. Multiple predicates are an AND. Authored handlers
therefore do not call `requireRole` for this direct-argument group pattern.

The predicate must name an `authorityProfile()`, must use
`membershipResource.arg(...)` with the declaration's exact resource-id type,
and cannot use a row-field reference. Multi-hop authorization still uses the
sanctioned permission-check plus bounded `ctx.db.elevated` sequence described
in [Protecting live and retained data](./protecting-data.md).

## Gate a query with the declaration

Use helpers on the exported membership table, never a global role string.
`memberOf()` admits any non-pending role; `hasRole(resource, ...roles)` admits
only the named roles, including a pending role when explicitly named.

For app scope, omit the resource. Snapback binds the host-owned app singleton:

```js source=demos/rbac/snapback/functions.mjs
export const listAnnouncements = defineLiveQuery({
  auth: 'authenticated',
  table: 'announcements',
  args: {},
  membership: [appMembers.memberOf()],
  order: [asc('_createdAt')],
});
```

For resource scope, pass exactly one of
`membershipResource.arg('eventId')` or
`membershipResource.rowField('eventId')`. The predicate is an authoritative
membership semi-join, not an optimistic client expression. It records an
ordinary captured database dependency even when no membership row exists, so
joining can wake a previously empty live result.

That dependency also means a membership-filtered query cannot declare
`authorityIndependent: true`. Codegen rejects the combination before writing
artifacts; public routing does not make a roster-dependent result invariant
across principals.

Membership tables are private authorization backing in v1. There is no
application-returning `ctx.permissions.*.get()` and a normal query cannot use
the roster as an existence oracle.

### Build a per-user resource feed

For a home screen such as “my events,” prefer table visibility on the resource
itself when active members should see the resource rows:

```js fragment reason="resource and membership fields vary by application"
events: defineTable({ title: v.string() }).visibility({
  kind: 'membership',
  declaration: eventMembers,
  resourceField: '_id',
  roles: ['host', 'cohost', 'guest'],
}),
```

The `_id` spelling belongs to table `.visibility(...)`; it is still not a
valid `membershipResource.rowField('_id')` query operand. Ordinary direct/live
plans and ordinary handler `ctx.db` reads compose the table policy, so the
resource table can now be the active-member feed without exposing the private
roster.

Keep a separate ordinary app-data feed row when the UI must also represent
pending invitations, non-member discovery, or a denormalized card shape that
is intentionally different from the protected resource. Key that row by both
the resource id and user id, copy only the display fields the card needs, and
query it by the server-derived `authUserId()`.

Shindig uses this shape for its `invites` table. The same row represents the
host's own feed entry, a pending invitation, or an RSVP, while the private
`eventMembers` table remains the authority source:

```js source=demos/shindig/snapback/functions.mjs
export const myFeed = defineLiveQuery({
  table: 'invites',
  args: {},
  filter: [eq('userId', authUserId())],
  order: [asc('eventStartsAt')],
  index: 'by_user',
});
```

Create or update the feed row in the same mutation workflow that changes the
product-visible invitation or membership state. Ordinary `ctx.db` writes may
accompany the mutation's one generated membership command, so the feed and
authority transition can commit atomically. Treat the copied fields as a
maintained projection for presentation, never as an authorization decision;
all protected reads still use the membership declaration.

## Check a role inside a transaction

Query and mutation handlers receive declaration-qualified permission helpers.
App scope uses `null` as the imperative resource value:

```js source=demos/rbac/snapback/handlers.mjs
  async postAnnouncement(ctx, args) {
    await ctx.permissions.appMembers.requireRole(null, 'member', 'admin');
    return await ctx.db.insert('announcements', {
      authorId: ctx.auth.userId,
      message: args.message,
    });
  },
```

A failed check is always `SNAPBACK_AUTH_PERMISSION_DENIED` with invariant
public details `{ kind: 'role' }`. It reveals neither whether the resource nor
membership exists. The denial is host-owned and remains terminal even if app
JavaScript catches the thrown error. Actions have no transactional read set,
so `ctx.permissions` is deliberately unavailable there.

## Choose between filtering and denying

The two gates above give an outsider **different observable outcomes**, and
the choice is a product decision, not an implementation detail:

| Idiom | Outsider sees | Use when |
| --- | --- | --- |
| Declarative `membership:` on a query (see [Gate a query with the declaration](#gate-a-query-with-the-declaration)) | an empty result, indistinguishable from "nothing here yet" | the surface is a list or feed that should simply be empty for non-members |
| `ctx.permissions.<declaration>.requireRole(...)` in a handler | `SNAPBACK_AUTH_PERMISSION_DENIED` | the caller is acting on a specific resource and a silent no-op would be a lie |

Neither discloses data: the declarative filter never returns rows the caller
may not see, and the denial carries invariant public details. What differs is
what a probing outsider can *confirm* — a denial confirms the operation
exists and was refused, an empty result confirms nothing — and what the UI
must do: an empty list renders naturally, whereas a swallowed denial on a
write path silently loses the user's work.

Pick per surface, and be deliberate when converting one to the other: moving
a read from a declarative query into a handler that calls `requireRole`
changes the outsider contract even though both are secure.

## Change membership through generated methods

Only mutation handlers receive `ctx.membership`. Its `insert`, id-addressed
`setRole`/`remove`/`patch`, and self-addressed
`setSelfRole`/`removeSelf`/`patchSelf` methods submit a host-owned command
evaluated against the declaration:

```js source=demos/rbac/snapback/handlers.mjs
  async joinApp(ctx) {
    await ctx.membership.appMembers.insert({
      userId: ctx.auth.userId,
      role: 'member',
    });
    return null;
  },
```

App code does not need the private roster row id for its own transitions. App
scope omits the resource argument; resource scope passes its branded resource
id:

```js source=demos/rbac/snapback/handlers.mjs
  async acceptInvite(ctx) {
    await ctx.membership.appMembers.setSelfRole('member');
    return null;
  },

  async leaveApp(ctx) {
    await ctx.membership.appMembers.removeSelf();
    return null;
  },
```

The host resolves only the effective principal's row, returns no id, and then
runs the same declared transition matrix. A missing own row is
`SNAPBACK_MEMBERSHIP_SELF_NOT_FOUND`; no helper reveals whether anyone else has
a row. The id-addressed forms are not an administrator authoring path for the
private v1 roster; only a trusted migration/import context outside the normal
app surface can already hold such an id.

Generic `ctx.db` and HostPlan writes to a membership table fail with
`SNAPBACK_MEMBERSHIP_RAW_WRITE_DENIED`; handler convention is not the security
boundary. Mark any function that can create durable authority with
`authorityCreating: true`. That marker becomes part of delegated-agent consent
and requires full membership provenance.

A resource declaration with `bootstrapRole` also gets
`ctx.membership.<declaration>.bootstrap(resourceValues, initialMembers?)`. It
returns the fresh, branded resource id and atomically inserts the resource and a
membership that seats the server-derived effective principal in the bootstrap
role. The optional list creates up to 64 additional seats in that same commit.
Omit the resource field from each list item; the host injects the fresh id. A
`lastHolder` declaration relies on this path: creating the protected resource
without its initial eligible holder is refused.

```js fragment reason="atomic resource and initial membership roster creation"
const conversationId = await ctx.membership.conversationMembers.bootstrap(
  { title: args.title },
  args.invitees.map((userId) => ({ userId, role: 'member' })),
);
```

The creator seat is not caller-selectable. Every additional principal must be
unique, differ from the creator, use a declared role, and match an ordinary
`insert` transition with the creator's bootstrap role as caller and the new
seat as `other`. The host checks every row before committing. One unauthorized
role, duplicate principal, ineligible protected holder, uncovered field, or
65th initial member refuses the entire resource and roster; nothing commits.
Seats in the list never authorize later seats in the same list.
Malformed or over-limit lists report
`SNAPBACK_MEMBERSHIP_BOOTSTRAP_INITIAL_MEMBERS_INVALID`; a repeated creator or
member reports `SNAPBACK_MEMBERSHIP_BOOTSTRAP_DUPLICATE_PRINCIPAL`; supplying
the host-bound resource field reports
`SNAPBACK_MEMBERSHIP_BOOTSTRAP_RESOURCE_UNEXPECTED`. Transition and vocabulary
failures retain their ordinary membership refusal codes.

A JavaScript mutation dedicated to creator-only bootstrap may set
`authorityCreating: false` even though its declared writes include the resource
and membership tables. Without an initial roster bootstrap cannot name a
different principal, so a delegated agent seats its effective user rather than
itself. Supplying any initial member names another principal and requires
`authorityCreating: true`; generation derives that marker and an author cannot
clear it. The runtime still rejects every ordinary membership operation from an
unconsented wrapper.

The generated TypeScript surface brands principals and resource ids, emits
closed role unions and insert/patch values, exposes `GeneratedPermissions` to
queries and mutations, and exposes `GeneratedMembership` only to mutations.

### One generated membership command per mutation

V1 admits exactly one generated membership command in a mutation. A single
`bootstrap()` counts as that command even when the host atomically creates the
resource, creator seat, and a bounded transition-checked initial roster.
Calling another
`bootstrap()`, `insert()`, `setRole()`, self-addressed transition, or other
generated membership method in the same handler fails the whole mutation with
`SNAPBACK_MEMBERSHIP_BATCH_UNSUPPORTED`; none of its buffered writes commit.

Ordinary `ctx.db` writes may accompany that one command. Use the optional
initial roster when creating one group and all initial seats must be atomic. A
setup flow that creates several membership-backed resources still uses
separately authorized mutations with application-visible setup state or stable
business keys for idempotence. Do not catch the batch refusal and pretend an
earlier command committed.

## Remove another principal with `removePrincipal` (explicit opt-in)

Principal-addressed removal (LLP 0100) is the one other-targeted membership
write reachable from app code, and it is closed by default. A declaration
opts in explicitly, and activation requires at least one **total**
other-principal removal transition — `from` omitted, so the transition
covers every declared and pending target role (per-role coverage would let
removal success/refusal read back a hidden role):

```js fragment reason="authoring shape; runtime witnesses live in tests/membership_principal_addressed_v0.rs"
.membership({
  // existing fields...
  principalAddressedWrites: { remove: true },
  transitions: [
    // Total: `from` omitted covers every declared and pending role.
    { op: 'remove', by: ['owner'], target: 'other' },
  ],
})
```

Generation refuses `remove: false`, unknown option fields, a declaration
with only partial (`from`-bearing) other-removes, pending or `none` carrier
caller classes, and — under `lastHolder` — any carrier caller class other
than the protected role (an admitted caller is then itself a protected
holder, so removing the target can never empty the protected set; the
commit-stage `lastHolder` check still runs but cannot become an oracle).

The generated command takes the public address, never a roster id:

```js fragment reason="handler shape; the same call is exercised end to end by tests/membership_principal_addressed_v0.rs"
async ownerRemove(ctx, args) {
  const result = await ctx.membership.roomMembers.removePrincipal(
    args.roomId, args.targetPrincipal);
  // Companion writes commit on BOTH branches — see the obligation below.
  await ctx.db.insert('auditTrail', { roomId: args.roomId, kind: 'kick' });
  return result; // always null
}
```

What the command discloses is deliberately narrow:

- The result is **always `null`** — present target removed or absent pair
  proved, byte-identically. It never returns `removed`, `missing`, a role,
  a row id, or a count. A well-formed principal that names no user takes
  the absent branch: argument validation is shape-only.
- An unauthorized caller gets the invariant
  `SNAPBACK_MEMBERSHIP_TRANSITION_DENIED` **before any target lookup**, and
  the denial is identical whether the target exists or not.
- Targeting yourself is the typed misuse
  `SNAPBACK_MEMBERSHIP_TARGET_SELF`; self-removal remains `removeSelf`.
- The one accepted observable for **authorized** callers: a present-target
  removal is an authorization event (the global version advances; the
  removed member's protected queries blank and their
  `_snapback.myMemberships` seat drops at that cut), while the absent
  no-op advances nothing.

**Companion writes must be branch-insensitive.** The mutation's ordinary
`ctx.db` writes commit on both the present and the absent branch — the
application cannot observe which branch ran. A companion write that
decrements a member count or appends a "removed" feed event on the
assumption the target was present corrupts product state on the no-op.
Write companions that are correct in both branches (an attempt log, an
idempotent display patch), or derive display state from a query instead.

## Keep the authorization composition seams aligned

An authorized live effect is valid only while all of these captured facts
still describe the same operation:

- **coordinator epoch** — which authenticated authority generation owns the client;
- **queue generation** — which durable outbox generation may replay;
- **artifact identity** — the schema/function bundle whose declarations were checked;
- **principal scope** — effective user or scoped service-principal tuple;
- **descriptor** — the exact query/mutation plus args and authorization dependence;
- **query lease** — the live subscription generation allowed to receive rows.

Treat the set as one composition boundary. A principal/token/grant transition
must close or blank the old query lease before a successor publishes; queued
work must compare both its authority capture and store generation; generated
descriptors must match the active artifact hashes. The Contract adapter and
packaged client perform these comparisons. App code should not cache a roster
answer, splice a new bearer into an old client, or reuse a live handle across a
coordinator transition.

## Anti-patterns

- **Do not store roles in session claims.** Membership rows are the current
  authority; copying them creates stale credentials.
- **Do not accept a plain string where `v.id(table)` is required.** Preserve
  the nominal resource binding through arguments and row fields.
- **Do not query or sync the roster to make an authorization decision.** Use a
  declaration-bound predicate or `ctx.permissions.requireRole`.
- **Do not use the private roster as a “my resources” feed.** Put membership
  visibility on the resource table with `resourceField: '_id'`; maintain a
  separate per-user app-data feed only when the product needs pending or
  denormalized rows that are not the protected resource itself.
- **Do not design administrator promotion/removal around private membership
  row ids.** V1 intentionally does not make those ids reachable; use app-data
  invitations plus a self transition, or choose a product flow that does not
  require administrator mutation of an existing private seat.
- **Do not create an app-data roster-id mirror just to leave or accept.** Use
  the declaration's self-addressed write methods.
- **Do not write membership rows through `ctx.db` or a generic HostPlan.** Use
  mutation-only generated membership methods and declare every transition.
- **Do not issue multiple generated membership commands in one mutation.** V1
  permits one. For one new resource, pass a bounded initial roster to
  `bootstrap(resourceValues, initialMembers?)`; for multiple resources or
  post-creation transitions, use idempotent separately authorized mutations.
- **Do not create a `lastHolder`-protected resource with `ctx.db.insert`.** Use
  the declaration's atomic `bootstrap()` method.
- **Do not use `ctx.permissions` in an action or retain a role-gated result
  offline.** Neither has the transactional/lease proof required by v1.
- **Do not mirror a profiled membership into a second product roster.** The
  app-owned membership table is both product roster and authority relation.
- **Do not infer generated transition mutations, hooks, search sharing, or
  asset sharing from `authorityProfile()`.** The current generated surface is
  the bounded `list`/`myRole` pair plus handler/table admission described above.
