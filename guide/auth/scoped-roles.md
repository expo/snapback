---
title: Scoped roles and memberships
id: auth.scoped-roles
order: 5
audience: agent-first
capabilities: [auth.scoped-roles, authority.profile.v1, authority.custom.coarse-global, authority.inspection.v1]
authorities: [llp/0056-scoped-roles-and-memberships.rfc.md, llp/0100-membership-addressed-operations-and-pages.rfc.md, llp/0146-agentic-authoring-affordances.rfc.md, llp/0173-authorization-review-projection.rfc.md, llp/0200-live-evaluation-scheduling-and-settlement.spec.md, llp/0240-application-authority-profiles.rfc.md, llp/0274-explicit-write-authority-postures.spec.md, packages/snapback-codegen/authorization-review.mjs, packages/snapback-codegen/define.mjs, packages/snapback-codegen/index.mjs, packages/snapback-codegen/write-policy.mjs, crates/snapback-server/src/admin.rs, crates/snapback-engine/src/manifest.rs, crates/snapback-kernel/src/membership_rules.rs, crates/snapback-engine/src/runtime.rs, crates/snapback-kernel/src/storage.rs, demos/rbac/tests/acceptance/rbac.mjs, demos/shindig/snapback/schema.mjs, demos/shindig/snapback/functions.mjs, crates/snapback/tests/membership_principal_addressed_v0.rs, tests/acceptance/familiar-removed-member-live-cutoff.mjs]
examples: [demos/rbac, demos/shindig, demos/team-chat, packages/snapback-codegen/custom-authorization.test.mjs, packages/snapback-codegen/rbac-authoring.test.mjs, tests/acceptance/familiar-removed-member-live-cutoff.mjs]
status: current
targets: [local]
maturity: shipped
authoring-profiles: [explicit, familiar]
reviewed: 2026-08-25
reviewed-authorities-digest: sha256:780bb9188d0955c89abf025ee2ea4cb21aeb08e760bce76b3e78efd19fffafc7
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

Membership backing rows are private to ordinary handlers and synchronization:
application code cannot query them, ask whether one exists, or obtain their
row ids, and `insert` returns `null`. A qualified `authorityProfile()` adds a
different, narrow surface: active members may use its generated bounded roster
projection and principal-addressed transition operations. The host reveals
only `roster.visible` fields and returns typed transition receipts, never a
membership row id or generic table access.

| Operation under the private v1 posture | Reachable app path |
| --- | --- |
| create a resource plus its first holder | `bootstrap(...)` (resource scope) |
| add self or another principal | declared `insert` transition; returns no row id |
| accept/decline/change/remove the caller's own seat | `setSelfRole`, `removeSelf`, or `patchSelf` |
| remove another principal (kick) | `removePrincipal(resource, principal)` — requires the explicit `principalAddressedWrites` opt-in (below) |
| administrator changes/patches another existing seat | foreclosed: requires a private row id |
| read/list/sync the roster or test another seat's existence | foreclosed: use `memberOf`/`hasRole` semi-joins, `requireRole`, or the caller's own `_snapback.myMemberships` |
| profile-backed invite/change/remove | generated `api.<profile>.invite`, `changeRole`, or `remove`, when the transition matrix admits it |
| profile-backed owner change | generated `transferOwner`; atomic promotion plus caller demotion |
| profile-backed roster read | generated paginated `list` and caller-only `myRole`; no generic roster read |

Without an authority profile, keep invitations in an ordinary app-data table
whose privacy policy fits the product, or use a membership `pendingRole` that
the invitee can finish through a self-addressed transition. A profiled
membership instead generates `invite` and `join` when those exact other-insert
and pending-to-active self transitions exist. Neither path exposes a private
membership row id.

## Declare one roster for an application resource

This roster is private authorization backing. If the product must render
handles, avatars, join time, or historical recipients, follow the
[private membership and product roster recipe](../recipes/membership-roster-projection.md)
rather than exposing the backing rows.

The RBAC demo uses one application row as the resource scope. Its membership
table is simultaneously the product roster and the authority relation:

```js source=demos/rbac/snapback/schema.mjs
export const appMembers = defineTable({
  appId: v.id('applications'),
  userId: v.principal(),
  role: v.string(),
}).visibility({ kind: 'owner', field: 'userId' }).membership({
  id: 'appAccess',
  principal: 'userId',
  resource: 'appId',
  role: 'role',
  roles: ['owner', 'admin', 'member'],
  pendingRoles: ['invited'],
  bootstrapRole: 'owner',
  lastHolder: { protect: 'owner' },
  provenance: 'full',
  transitions: [
    { op: 'insert', by: ['owner', 'admin'], target: 'other', to: ['invited'] },
    { op: 'setRole', by: ['self'], target: 'self', from: ['invited'], to: ['member'] },
    { op: 'remove', by: ['self'], target: 'self', from: ['invited', 'admin', 'member'] },
    { op: 'setRole', by: ['owner'], target: 'other', from: ['admin', 'member'], to: ['admin', 'member'] },
    { op: 'remove', by: ['owner'], target: 'other', from: ['invited', 'admin', 'member'] },
    { op: 'remove', by: ['admin'], target: 'other', from: ['invited', 'member'] },
  ],
}).authorityProfile({
  name: 'appAccess',
  hierarchy: {
    owner: ['admin', 'member'],
    admin: ['member'],
    member: [],
  },
  roster: { visible: ['userId', 'role'] },
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
}).visibility({ kind: 'owner', field: 'userId' });
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
  displayName: v.optional(v.string()),
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
  transitions: [
    { op: 'insert', by: ['owner'], target: 'other', to: ['invited'] },
    { op: 'setRole', by: ['self'], target: 'self', from: ['invited'], to: ['member'] },
    { op: 'remove', by: ['self'], target: 'self', from: ['admin', 'member', 'invited'] },
    { op: 'setRole', by: ['owner'], target: 'other', from: ['admin', 'member'], to: ['admin', 'member'] },
    { op: 'remove', by: ['owner'], target: 'other', from: ['admin', 'member', 'invited'] },
  ],
}).authorityProfile({
  name: 'roomAccess',
  hierarchy: {
    owner: ['admin', 'member'],
    admin: ['member'],
    member: [],
  },
  roster: { visible: ['userId', 'role', 'displayName'] },
}).visibility({ kind: 'owner', field: 'userId' });
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

The qualified local, app-table-owned profile composes with ordinary table
visibility, named handler admission, and a transition-derived generated
namespace. Every profile has the live references `api.roomAccess.list` and
`api.roomAccess.myRole`. Depending on the closed membership transitions,
codegen also emits only the supported subset of `invite`, `join`, `leave`,
`changeRole`, and `remove`. `transferOwner` is present whenever the profile has
an active non-owner role and demotes the caller to active `admin` when present,
otherwise to the first active non-owner role in declared hierarchy order, so a
`lastHolder`-protected owner cannot be stranded merely because the lattice
lacks `admin`; owner-only profiles omit it because no valid caller successor
exists. It is the only generated operation that can change an owner.

`list` takes `{ scopeId, page?: { after?, limit? } }`. It returns a bounded
page projected to exactly `roster.visible`; the normal query response carries
the next AEAD-sealed `sbpc2` cursor. The encrypted cursor keeps the private
role/principal/row boundary unreadable while binding the app, declaration,
scope, ordering, profile generation, caller authority, and active artifacts.
It cannot be moved between scopes, callers, orderings, generations, or
deployments. `myRole` takes `{ scopeId }`
and returns the caller's `{ role, status }` row. Admission happens before
cursor parsing: an outsider receives the invariant role denial and cannot use
malformed or copied cursors as an existence oracle.

Generated mutations take public scope/principal/role values and resolve any
private row identity in the host-owned transaction. They return `null` as the
handler value. Once the transaction commits, the mutation settlement includes
`authorityTransitions`: one receipt per changed subject with public
predecessor/successor role and status, subject, scope, and invalidation
disposition. `transferOwner` produces two receipts from one atomic commit.
Preview and failed/refused attempts never fabricate committed receipts.

The `generatedAuthorityOperation` marker is currently trusted as deployment
content; activation does not yet recompute it from the synthesized operation
implementation. That verification is the open
[marker-activation hardening ticket](repo:issues/shelved/20260816-generated-authority-op-marker-activation-verification.md).

The generated profile facade never projects a raw membership row or its `_id`.
That is a boundary of the generated operations, not a blanket `ctx.db` denial:
authored reads remain governed by the table's required explicit visibility
policy. Team Chat's reconciled post-LLP-0264 witness declares it on the new,
restricted `roomMembersV2` table while retaining installed v1 policy records
inert; the RBAC demo composes membership visibility from the same profile IR.

These generated references still ride the ordinary client surface, so
`useSnapbackQuery(api.roomAccess.list, { scopeId, page })` and
`useSnapbackMutation(api.roomAccess.invite)` remain valid. React also ships a
dedicated package-generic convenience layer inferred from the generated
profile object; Expo re-exports the same hooks:

```tsx fragment reason="generated authority profile names and component state vary by application"
import {
  useSnapbackAuthorityMutation,
  useSnapbackAuthorityMutationStatus,
  useSnapbackAuthorityMyRole,
  useSnapbackAuthorityRoster,
} from '@expo/snapback-react';

const roster = useSnapbackAuthorityRoster(api.roomAccess, roomId, { limit: 50 });
const myRole = useSnapbackAuthorityMyRole(api.roomAccess, roomId);
const changeRole = useSnapbackAuthorityMutation(api.roomAccess.changeRole);
const queued = useSnapbackAuthorityMutationStatus(queuedMutationId);

const loadNextPage = () => roster.loadMore();
const makeMember = async () => {
  const dispatch = await changeRole({ scopeId: roomId, principal, role: 'member' });
  if (dispatch.status === 'settled') console.log(dispatch.authorityTransitions);
};

return <Roster rows={roster.data ?? []} onLoadMore={loadNextPage} onMakeMember={makeMember} />;
```

The roster retains the LLP 0238 query-state arms and adds `cursor`, `hasMore`,
`loadingInitial`, `loadingMore`, `pageError`, `loadMore()`, and `reset()`. Calls
belong in event handlers, never render. A continuation failure leaves loaded
rows visible and appears in `pageError`; only first-page failure uses the query
error arm. The hook never parses a continuation. A scope, current-principal,
session-generation, generated-reference-generation, or live first-page publish
drops all retained pages before the next request.
`SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID` also returns
`{ status: 'reset', reason: 'cursor-invalid' }` from `loadMore()` and reacquires
page one instead of entering the query error arm. `myRole` projects the live
zero-or-one row as a nullable value while preserving the generated closed role
union.

Authority mutation dispatch follows the ordinary `settled | queued`
vocabulary. The settled arm retains `authorityTransitions`; queued work is
observed through `useSnapbackAuthorityMutationStatus`, whose `settled`
disposition carries the same receipts and whose `failed.failure.code` is the
stable refusal code. Immediate refusals reject as `SnapbackDiagnosticError`.

Composition with membership-visible search or asset sharing fails generation with
`SNAPBACK_AUTHORITY_PROFILE_UNSUPPORTED_COMPOSITION_CLASS`; hosted targets fail
with `SNAPBACK_AUTHORITY_PROFILE_UNSUPPORTED_TARGET`.

### Search one profile scope

A membership-visible search index may name the profile's declaration and
minimum role. Codegen closes that role through the canonical profile lattice
and lowers it directly into the existing membership search plan—there is no
second generated visibility policy to keep in sync.

```js source=demos/rbac/snapback/functions.mjs
export const searchAnnouncements = defineSearchQuery({
  auth: 'authenticated',
  table: announcements,
  index: 'search_announcements',
  resourceArg: 'appId',
});
```

The corresponding index on `announcements` declares
`visibility: { kind: 'membership', declaration: 'appAccess', resourceField:
'appId', roles: ['member'] }`. Each call supplies exactly one `appId`. Active
members search that partition; an outsider gets the same empty page as a
missing scope, and a membership revocation stops subsequent results under the
ordinary authorization invalidation semantics. Roster visibility is not
widened: stored search fields come only from the index's explicit
`storedFields`, never from the private membership row.

See [Portable indexed text search](../backend/text-search.md) for query syntax,
cursor behavior, and bounded refusals. Search remains online-only and is not a
live-query or retained/offline claim.

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

When table visibility already references the profile, an ordinary query needs
only its resource filter; codegen composes the membership semi-join from the
same profile IR:

```js source=demos/rbac/snapback/functions.mjs
export const listAnnouncements = defineLiveQuery({
  auth: 'authenticated',
  table: 'announcements',
  args: { appId: v.id('applications') },
  filter: [eq('appId', arg('appId'))],
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

For a direct resource argument, prefer named handler admission. Codegen emits
the terminal role prelude from the profile's closed lattice before app code:

```js source=demos/rbac/snapback/functions.mjs
export const postAnnouncement = defineJsMutation({
  auth: 'authenticated',
  args: { appId: v.id('applications'), message: v.string() },
  source: 'handlers.mjs',
  exportName: 'postAnnouncement',
  membership: [appMembers.hasRole(membershipResource.arg('appId'), 'member')],
  writes: ['announcements'],
  result: results.value(v.id('announcements')),
});
```

A failed check is always `SNAPBACK_AUTH_PERMISSION_DENIED` with invariant
public details `{ kind: 'role' }`. It reveals neither whether the resource nor
membership exists. The denial is host-owned and remains terminal even if app
JavaScript catches the thrown error. Multi-hop cases may still call
`ctx.permissions.<declaration>.requireRole(resource, ...roles)` inside a query
or mutation transaction. Actions have no transactional read set, so
`ctx.permissions` is deliberately unavailable there.

### Declare an online-only custom evaluator

Use custom authorization when a finite role predicate cannot express the
operation's policy. The shipped lane is deliberately conservative:

```js fragment reason="Executable generation, refusal, wake, and authorization-review coverage lives in packages/snapback-codegen/custom-authorization.test.mjs"
authorization: authorization.custom({
  inputs: [policyInput.table('documentAccess', {
    subject: 'ctx.auth.userId',
    key: ['documentId', 'userId'],
  })],
  evaluate: canReadDocument,
  offline: 'none',
  sync: 'coarse-global',
})
```

The evaluator is source-closed with its inline handler. Its direct
`ctx.db.elevated` read sites must name the declared input tables, and every
input needs a witnessed site. Returning false invokes the same trusted terminal
`SNAPBACK_AUTH_PERMISSION_DENIED` seam as a declared role check, before the
handler runs.

Generation keeps
`SNAPBACK_CUSTOM_AUTHORIZATION_INPUT_COMPLETENESS_UNPROVEN` visible and writes
the operation's input, evaluator identity, offline/sync, pushdown, retention,
and invalidation facts into `authorization-review.json`. Coarse-global means
every relevant application or authorization change reauthorizes. It makes no
pushdown, retention, protected-local-execution, or precise-invalidation claim.
The local target supplies that conservative wake; an incapable target refuses
with `SNAPBACK_CUSTOM_AUTHORIZATION_COARSE_WAKE_UNAVAILABLE`.

`sync: 'reauthorize-on-change'` is not a spelling for the same behavior. It
fails generation with
`SNAPBACK_CUSTOM_AUTHORIZATION_PRECISE_COMPLETENESS_UNAVAILABLE` because LLP
0146 does not yet provide enforceable strict input completeness. Do not replace
the refusal with a free-form declaration or assume that the coarse warning is
a completeness proof.

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

```js fragment reason="base membership declaration and product fields vary by application"
await ctx.membership.roomMembers.insert({
  roomId: args.roomId,
  userId: ctx.auth.userId,
  role: 'member',
});
```

App code does not need the private roster row id for its own transitions. App
scope omits the resource argument; resource scope passes its branded resource
id:

```js fragment reason="base membership declaration and resource names vary by application"
await ctx.membership.roomMembers.setSelfRole(args.roomId, 'member');
await ctx.membership.roomMembers.removeSelf(args.roomId);
```

The host resolves only the effective principal's row, returns no id, and then
runs the same declared transition matrix. A missing own row is
`SNAPBACK_MEMBERSHIP_SELF_NOT_FOUND`; no helper reveals whether anyone else has
a row. The base id-addressed forms are not an administrator authoring path for
the private v1 roster; only a trusted migration/import context can already hold
such an id. For a profiled roster, use the generated principal-addressed
`changeRole` and `remove` references described above—the host resolves the row
privately and the same transition planner remains authoritative.

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
For authority profiles it additionally types the nested operation references,
projected `ctx.authority.<profile>.list`/`myRole` reads, profile mutation
helpers, and durable `AuthorityTransitionReceiptV1` settlements.

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

<!-- since: 0.1.28 -->

## Keep pre-removal history without live delivery

Search vocabulary: removed member; already-open subscription; post-removal
message; live cutoff; retain pre-removal history; Familiar group roster.

An ordinary `public-read` + `sync()` roster is public application data. Patching
an `active` boolean or `removedAt` timestamp on it is a data commit, not an
authorization event. A query may rerun and shrink, but that commit does not
install LLP 0200's fail-closed revocation fence. A second membership query,
`BroadcastChannel`, local-storage signal, or browser-clock comparison cannot
turn it into one. In particular, an already-open subscription must not depend
on cross-subscription delivery order to learn that its caller was removed.

The packed characterization exercises the split application graph directly.
Its authenticated messages-only query reads only the `public-read` messages
table, so the removed client's raw stream receives the post-removal sentinel.
An independently delivered membership query also reaches `active: false`.
Those are the only per-stream guarantees: Snapback supplies no ordering between
the two ordinary data subscriptions, so whether browser-clock composition ever
paints and later removes the sentinel is application-owned.

Codegen warns with `SNAPBACK_ORDINARY_ROSTER_AUTHORITY_UNDECLARED` only for a
narrower, statically provable same-handler shape: a public synced ordinary
table has principal, resource, and lifecycle axes; an exact patch/delete
changes that lifecycle field; and one exact authenticated multi-table handler
scopes that exact roster read to the current principal and uses its lifecycle
field to gate another table's result. The warning does **not** claim to detect
independent client-side subscriptions because the backend artifact contains no
client composition graph. This is an advisory, not inferred authority. A
principal-scoped roster read that merely decorates a legitimate multi-table
display does not match, even when the handler also filters its result. If the
relation is product data, keep it ordinary; if it controls delivery authority,
declare the membership profile and use generated transitions.

Use the generated membership authority surface for the fence. If removal
should also erase all old history, the generated `api.<profile>.remove`
operation is the simpler terminal path: the caller no longer passes membership
admission and the live result blanks. If a former member should retain rows
from before removal, keep a non-delivery `former` role in the active role
vocabulary and pair it with an ordinary persisted access-window row:

```ts fragment reason="application table names and history fields vary; the complete generated Familiar witness is tests/acceptance/familiar-removed-member-live-cutoff.mjs"
.membership({
  roles: ['owner', 'member', 'former'],
  transitions: [
    { op: 'setRole', by: ['owner'], target: 'other', from: ['member'], to: ['former'] },
  ],
  // principal/resource/role/bootstrap/lastHolder/provenance omitted here
})
.authorityProfile({
  name: 'roomMemberships',
  hierarchy: { owner: ['member', 'former'], member: [], former: [] },
  roster: { visible: ['userId', 'role'] },
});
```

`former` is an active membership role in Snapback's vocabulary, even when the
product calls the person “removed.” That lets a retained-history query use
`memberOf(resource)` admission for every active role. The handler reads an
ordinary access-window row for the caller and returns only messages at or
before its persisted `cutoffAt`. The send mutation instead uses
`hasRole(resource, 'member')`, whose hierarchy excludes `former`. Do not expose
an unfiltered query or table-sync path that admits the `former` role.

The removal flow has an intentional order:

1. Patch the ordinary access-window row with a server timestamp and await that
   mutation's successful settlement.
2. Call and await the generated `api.<profile>.changeRole` transition from
   `member` to `former`.
3. Only after that transition settles, allow later message sends.

The second commit advances the global authorization epoch. Every already-open
Sessions subscription crosses the delivery-time authority gate: pre-transition
frames cannot deliver, and the restored handler result may retain only the
pre-cutoff rows. Raw subscription lifecycle callbacks observe
`authorization_quarantine`. Familiar `useQuery` deliberately projects
`undefined` while that boundary is unresolved, then restores the current
value; use `useQueryState` when the component needs the explicit status,
connection, freshness, or error surface. A message committed immediately after
the role-transition settlement is on the post-removal side of the regression
contract; the application does not wait for a resnapshot or a browser signal
before sending it.

The two-step form fails closed for disclosure: if the cutoff patch fails, do
not issue the role transition; if the later transition fails, the cutoff may
take effect early and can be retried or repaired. The current generated
surface does not atomically compose an arbitrary ordinary cutoff write with a
principal-addressed profile transition. If the product requires that stronger
all-or-nothing availability property, treat it as a separate authoring-surface
requirement rather than replacing the authorization fence with client timing.

Do not convert a hand-written roster to `permissionBacking()` while retaining
generic `ctx.db` writers. Authority tables deliberately refuse generic writes
with `SNAPBACK_TABLE_WRITE_AUTHORITY_TABLE_INELIGIBLE`; the diagnostic routes
here with repair class `use-generated-membership-authority-operation`. For a
finite principal/resource role roster, move the authority relation to
`.membership()`/`.authorityProfile()` and use its generated transition
operations. A broader permission-backing relation must instead use that
declaration's own governed writer; it should not be narrowed to membership just
to satisfy this diagnostic. Keep the retained-history cutoff in an ordinary
table.

## Remove another principal with `removePrincipal` (explicit opt-in)

Principal-addressed removal (LLP 0100) is the one other-targeted membership
write reachable from app code, and it is closed by default. A declaration
opts in explicitly, and activation requires at least one **total**
other-principal removal transition — `from` omitted, so the transition
covers every declared and pending target role (per-role coverage would let
removal success/refusal read back a hidden role):

```js fragment reason="authoring shape; runtime witnesses live in crates/snapback/tests/membership_principal_addressed_v0.rs"
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

```js fragment reason="handler shape; the same call is exercised end to end by crates/snapback/tests/membership_principal_addressed_v0.rs"
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

## Inspect effective authority

The local developer/admin API can explain one named principal's effective
profile branch without exposing a public policy oracle:

```json fragment reason="Closed request shape and byte-identical unauthenticated probes are covered by admin::tests::effective_authority_unauthenticated_probes_are_byte_identical_and_public_inspect_is_clean"
{
  "profileId": "appAccess",
  "profileGeneration": "sha256:...",
  "principalId": "user_123",
  "scopeId": "app_456",
  "target": {
    "kind": "view",
    "name": "membership-visible-search",
    "index": { "table": "announcements", "name": "search_announcements" }
  }
}
```

POST that body to `/_snapback/api/authority/effective` with an administrator
credential. The registered route is `AdminWrite` and authenticates before JSON
extraction or lookup. Its response contains only ids, closed role/status and
decision enums, policy identities, membership row/provenance ids, the exact
membership and transition-log index plans read, invalidation disposition, the
LLP 0243 offline reference, the still-refused asset-sharing consequence, and
the guide/code source paths. It links `snapback.authorization-review.v2` as
the static half instead of duplicating that generated inventory. A search view
must name its exact table/index identity; the answer evaluates that index's
lowered role set, not merely the profile's class-level permission to compose
with search.

An absent member appears as the closed-default denial with
`SNAPBACK_AUTH_PERMISSION_DENIED`. Unknown profile/generation probes fail
through the same role-denial machinery. Unauthenticated probes for different
principals or scopes are byte-identical, and public `/inspect` contains none of
these authority facts.

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
  row ids.** V1 intentionally does not make those ids reachable. Use the
  transition-derived authority-profile operations when the declaration admits
  them; otherwise use app-data invitations plus a self transition or choose a
  flow that does not require administrator mutation of a private seat.
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
- **Do not infer unsupported operations from `authorityProfile()`.** A missing
  membership transition means the corresponding mutation reference is absent,
  not a runtime no-op. Asset sharing, hosted profiles, and
  protected offline retention are still outside this surface.
