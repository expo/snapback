---
title: Scoped roles and memberships
id: auth.scoped-roles
order: 5
audience: agent-first
capabilities: [auth.scoped-roles]
authorities: [llp/0056-scoped-roles-and-memberships.rfc.md, llp/0100-membership-addressed-operations-and-pages.rfc.md, packages/snapback-codegen/define.mjs, packages/snapback-codegen/index.mjs, src/manifest.rs, src/membership_rules.rs, src/runtime.rs, src/storage.rs, demos/rbac/tests/acceptance/rbac.mjs, demos/shindig/snapback/schema.mjs, demos/shindig/snapback/functions.mjs, tests/membership_principal_addressed_v0.rs]
examples: [demos/rbac, demos/shindig, packages/snapback-codegen/rbac-authoring.test.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-03
reviewed-authorities-digest: sha256:9053759777a36adc8b8c86db01260743da262bfc7dedd0e312310f908e0e2abb
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

For a home screen such as “my events,” do not try to membership-gate the
resource table with `membershipResource.rowField('_id')`. System fields are
not valid `rowField` operands, and the private membership table is not a UI
feed. Keep a separate ordinary app-data feed row keyed by both the resource id
and user id, copy the small display fields the card needs, and query that table
by the server-derived `authUserId()`.

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
`ctx.membership.<declaration>.bootstrap(resourceValues)`. It returns the fresh,
branded resource id and atomically inserts both the resource and a membership
that seats the server-derived effective principal in the bootstrap role. A
`lastHolder` declaration relies on this path: creating the protected resource
without its initial eligible holder is refused.

A JavaScript mutation dedicated to that one bootstrap operation may set
`authorityCreating: false` even though its declared writes include the resource
and membership tables. Bootstrap cannot name a different principal, so a
delegated agent seats its effective user rather than itself. The runtime still
rejects every non-bootstrap membership operation from such an unconsented
wrapper; a mutation that can perform bootstrap *and* ordinary membership
changes must use `authorityCreating: true`.

The generated TypeScript surface brands principals and resource ids, emits
closed role unions and insert/patch values, exposes `GeneratedPermissions` to
queries and mutations, and exposes `GeneratedMembership` only to mutations.

### One generated membership command per mutation

V1 admits exactly one generated membership command in a mutation. A single
`bootstrap()` counts as that command even though the host atomically creates
both the resource and its initial membership row. Calling another
`bootstrap()`, `insert()`, `setRole()`, self-addressed transition, or other
generated membership method in the same handler fails the whole mutation with
`SNAPBACK_MEMBERSHIP_BATCH_UNSUPPORTED`; none of its buffered writes commit.

Ordinary `ctx.db` writes may accompany that one command. For a setup flow that
creates several membership-backed resources or seats several principals, use
separately authorized mutations and keep application-visible setup state or
stable business keys so each step is idempotent. Each mutation remains atomic;
the multi-call workflow is not one transaction. Do not catch the batch refusal
and pretend the earlier commands committed.

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
- **Do not use the private roster as a “my resources” feed.** Maintain an
  ordinary per-user app-data feed and keep authorization on the membership
  declaration.
- **Do not design administrator promotion/removal around private membership
  row ids.** V1 intentionally does not make those ids reachable; use app-data
  invitations plus a self transition, or choose a product flow that does not
  require administrator mutation of an existing private seat.
- **Do not create an app-data roster-id mirror just to leave or accept.** Use
  the declaration's self-addressed write methods.
- **Do not write membership rows through `ctx.db` or a generic HostPlan.** Use
  mutation-only generated membership methods and declare every transition.
- **Do not batch generated membership commands in one mutation.** V1 permits
  one; decompose a multi-seat or multi-resource workflow into idempotent,
  separately authorized mutations.
- **Do not create a `lastHolder`-protected resource with `ctx.db.insert`.** Use
  the declaration's atomic `bootstrap()` method.
- **Do not use `ctx.permissions` in an action or retain a role-gated result
  offline.** Neither has the transactional/lease proof required by v1.
