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
reviewed: 2026-07-16
reviewed-commit: HEAD
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

## Declare an app-wide role set

An app-scoped declaration omits the resource axis. This demo lets an
authenticated non-member seat only themselves as `member`:

```js source=demos/rbac/snapback/schema.mjs
export const appMembers = defineTable({
  userId: v.principal(),
  role: v.string(),
}).membership({
  principal: 'userId',
  role: 'role',
  roles: ['member', 'admin'],
  scope: 'app',
  provenance: 'full',
  transitions: [
    { op: 'insert', by: ['none'], target: 'self', to: ['member'] },
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

Only mutation handlers receive `ctx.membership`. Its `insert`, `setRole`,
`remove`, and `patch` methods submit a host-owned command evaluated against the
declaration:

```js source=demos/rbac/snapback/handlers.mjs
  async joinApp(ctx) {
    await ctx.membership.appMembers.insert({
      userId: ctx.auth.userId,
      role: 'member',
    });
    return null;
  },
```

Generic `ctx.db` and HostPlan writes to a membership table fail with
`SNAPBACK_MEMBERSHIP_RAW_WRITE_DENIED`; handler convention is not the security
boundary. Mark any function that can create durable authority with
`authorityCreating: true`. That marker becomes part of delegated-agent consent
and requires full membership provenance.

The generated TypeScript surface brands principals and resource ids, emits
closed role unions and insert/patch values, exposes `GeneratedPermissions` to
queries and mutations, and exposes `GeneratedMembership` only to mutations.

## Anti-patterns

- **Do not store roles in session claims.** Membership rows are the current
  authority; copying them creates stale credentials.
- **Do not accept a plain string where `v.id(table)` is required.** Preserve
  the nominal resource binding through arguments and row fields.
- **Do not query or sync the roster to make an authorization decision.** Use a
  declaration-bound predicate or `ctx.permissions.requireRole`.
- **Do not write membership rows through `ctx.db` or a generic HostPlan.** Use
  mutation-only generated membership methods and declare every transition.
- **Do not use `ctx.permissions` in an action or retain a role-gated result
  offline.** Neither has the transactional/lease proof required by v1.
