---
title: Scoped roles and memberships
id: auth.scoped-roles
order: 3
audience: agent-first
capabilities: [auth.scoped-roles]
authorities: [llp/0056-scoped-roles-and-memberships.rfc.md, packages/snapback-codegen/define.mjs, packages/snapback-codegen/index.mjs, src/manifest.rs, src/membership_rules.rs, src/storage.rs, demos/rbac/tests/acceptance/rbac.mjs]
examples: [demos/rbac, packages/snapback-codegen/rbac-authoring.test.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-07-17
reviewed-commit: 8a6bbd1ec980a49010aa67269ee908433a257c9a
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
escape hatch—the absence is the security contract.

| Operation under the private v1 posture | Reachable app path |
| --- | --- |
| create a resource plus its first holder | `bootstrap(...)` (resource scope) |
| add self or another principal | declared `insert` transition; returns no row id |
| accept/decline/change/remove the caller's own seat | `setSelfRole`, `removeSelf`, or `patchSelf` |
| administrator changes/removes/patches another existing seat | foreclosed: requires a private row id |
| read/list/sync the roster or test another seat's existence | foreclosed: use `memberOf`/`hasRole` semi-joins or `requireRole` |

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
- **Do not design administrator promotion/removal around private membership
  row ids.** V1 intentionally does not make those ids reachable; use app-data
  invitations plus a self transition, or choose a product flow that does not
  require administrator mutation of an existing private seat.
- **Do not create an app-data roster-id mirror just to leave or accept.** Use
  the declaration's self-addressed write methods.
- **Do not write membership rows through `ctx.db` or a generic HostPlan.** Use
  mutation-only generated membership methods and declare every transition.
- **Do not create a `lastHolder`-protected resource with `ctx.db.insert`.** Use
  the declaration's atomic `bootstrap()` method.
- **Do not use `ctx.permissions` in an action or retain a role-gated result
  offline.** Neither has the transactional/lease proof required by v1.
