---
title: "Recipe: list members without exposing authority"
id: recipes.membership-roster-projection
order: 14
audience: agent-first
capabilities: [auth.scoped-roles, authority.profile.v1]
authorities: [llp/0056-scoped-roles-and-memberships.rfc.md, llp/0240-application-authority-profiles.rfc.md, llp/0278-paged-live-results-and-relational-composition.rfc.md, llp/0295-published-matrix-improvement-program.plan.md, packages/snapback-codegen/rbac-authoring.test.mjs, packages/snapback-codegen/authority-projection-packed.test.mjs, crates/snapback-kernel/src/storage.rs, crates/snapback-engine/src/runtime/host_glue.rs]
examples: [packages/snapback-codegen/authority-projection-packed.test.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-22
reviewed-authorities-digest: sha256:6b7e76ab01d5b050deb6a5298ea2f1aa0519b7a5de8100d7b992d00369606239
---

# Recipe: list members without exposing authority

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Use an authority profile product projection when the product needs a private
room roster, display history, leave/rejoin incarnations, or a send-time
recipient set. Do not make the membership table public and do not maintain a
second app-owned mirror. The membership row remains the current authorization
source; Snapback captures declared product facts from its before/after row
images inside the same writer transaction.

Search phrases: list chat members; private membership roster; private roster;
product-visible roster projection; display roster; show roster; who is in the room;
enumerate members; member history; join date; leave and rejoin;
recipient snapshot; send-time recipient set; who received a message; roster
mirror; authority product projection.

## Declare the generated projection

Projection capture is available only on a membership declaration with
`provenance: "full"`. The writer seam must be able to observe every
authorization-relevant transition; `creation` provenance is refused with
`SNAPBACK_AUTHORITY_PROJECTION_FULL_PROVENANCE_REQUIRED`.

The history field list is historical product data. It may not repeat the
principal/resource/role axes or a current roster field. In this example,
`auditLabel` is historical while the ordinary current roster stays the small
`userId`/`role` projection:

```js fragment reason="Minimal public spelling; the packed Explicit/Familiar contract fixture constructs and verifies the complete schema."
export const eventDeliveries = defineTable({
  eventId: v.id('events'),
  senderId: v.principal(),
  body: v.string(),
  recipientIds: v.array(v.principal(), { maxItems: 1024 }),
}).visibility({ kind: 'owner', field: 'senderId' });

export const eventMembers = defineTable({
  eventId: v.id('events'),
  userId: v.principal(),
  role: v.string(),
  auditLabel: v.optional(v.string()),
})
  .membership({
    id: 'eventMembers',
    principal: 'userId',
    resource: 'eventId',
    role: 'role',
    roles: ['owner', 'member'],
    pendingRoles: ['invited'],
    bootstrapRole: 'owner',
    lastHolder: { protect: 'owner' },
    provenance: 'full',
    transitions,
  })
  .authorityProfile({
    name: 'eventMembers',
    hierarchy: { owner: ['member'], member: [] },
    roster: { visible: ['userId', 'role'] },
    projection: {
      history: { visible: ['auditLabel'] },
      recipients: {
        ceiling: 1024,
        sinks: [{
          operation: 'sendDelivery',
          table: 'eventDeliveries',
          scopeField: 'eventId',
          recipientsField: 'recipientIds',
        }],
      },
    },
  })
  .visibility({ kind: 'owner', field: 'userId' });
```

Explicit and Familiar accept the same declaration shape. As with every
Familiar operation reference, a Familiar sink uses its exact two-segment
operation identity (for example, `messages.sendDelivery`) while Explicit uses
the exported name. Familiar's `defineTable` adds its normal sync default; it
does not change authority, projection, or history semantics.

## Read current state and history through different operations

`eventMembers.list` and `eventMembers.myRole` are unchanged. `list` remains
the bounded, redacted current roster; it does not expose membership row ids.
Enabling `projection` adds `eventMembers.history` and
`eventMembers.incarnations`. Both require current roster admission before
cursor parsing, use sealed operation/scope/generation/caller-bound cursors,
and return the D1 envelope:

History does not widen roster visibility. `principal`, `scope`, and
role-derived fields appear only when their membership fields are declared in
`roster.visible`; private row/incarnation ids never appear. Pending-only
invitations are omitted from history and incarnation results. Once an
incarnation becomes active or departed, its admitted, redacted history can be
returned.

```ts fragment reason="Generated type spelling verified by the packed authority-projection fixture."
interface AuthorityHistoryPageV1<Row> {
  readonly rows: readonly Row[];
  readonly cursor: string | null;
  readonly boundary: 'exact' | 'at-limit';
  readonly horizon: {
    readonly earliestCoveredCommit: number;
    readonly coverageClass: 'full' | 'authorization-facts-only';
  };
}
```

`boundary` says whether this page hit its pagination limit. It never describes
history completeness. The separate horizon says the earliest covered commit
and whether older ledger backfill carries only role/status facts. A leave
closes one incarnation; a later invite/rejoin opens a new one; role changes
remain interior events. Projection activation captures existing current rows
at its horizon, so they are not misrepresented as pre-activation history.

Projection reads do not imply offline retention. Treat them as ordinary
authorized live results unless a separate retention profile explicitly says
otherwise.

## Freeze recipients inside the sending mutation

The `recipients.sinks` declaration binds the helper to an exact sending
mutation and product field. Insert the product row, then call
`ctx.authority.eventMembers.snapshotRecipients(eventId, rowId)`. The host
writes `recipientIds` onto that row in the same transaction and returns
`null`; application JavaScript never receives or enumerates the principals.
Use from another mutation, against another table/field, or without the sink
row is refused. The host keeps the resolved patch outside the handler's
read-your-writes overlay until commit, so a later `ctx.db.get` or query sees
only the handler-authored row, not the private recipient set. Once frozen, a
later patch of `recipientIds` or deletion of the row refuses with
`SNAPBACK_AUTHORITY_RECIPIENT_SINK_FROZEN`.

Later membership changes do not rewrite the frozen product row.

Keep recipient sinks behind an owner or membership visibility policy unless
publishing the set is deliberate. A `public-read` sink remains allowed, but
codegen emits `SNAPBACK_AUTHORITY_RECIPIENT_SINK_PUBLIC_READ` to name that
publication choice.

```js fragment reason="The packed projection fixture verifies this exact generated helper and sink identity."
export const sendDelivery = defineJsMutation({
  auth: 'authenticated',
  args: { eventId: v.id('events'), body: v.string() },
  reads: ['eventMembers', 'eventDeliveries'],
  writes: ['eventDeliveries'],
  handler: async (ctx, args) => {
    const rowId = await ctx.db.insert('eventDeliveries', {
      eventId: args.eventId,
      body: args.body,
      recipientIds: [],
    });
    await ctx.authority.eventMembers.snapshotRecipients(args.eventId, rowId);
    return rowId;
  },
});
```

The declared ceiling may be at most 1,024. Resolution reads at most one row
past the declaration and refuses with
`SNAPBACK_AUTHORITY_RECIPIENT_CEILING_EXCEEDED` instead of truncating. The
refused read remains dependency-captured. Never resolve a recipient list on
the client and pass it back as authority.

For receipt counts across many message or profile keys, use
`defineSetKeyedAggregate` from `@expo/snapback-codegen/standard-patterns` when
the UI requires one atomic cross-set snapshot. Declare `maxKeys` and
`rowCeiling`; the generated live handler owns 499-item operand chunks. When
cross-set atomicity is unnecessary, bounded independent reads remain correct.

## Rely on the generated outcome contract

The manifest publishes the closed three-class matrix per generated mutation:

| Branch class | Result |
| --- | --- |
| requested state already holds, or `remove` target is absent | idempotent success, no write/transition receipt |
| visible target violates a precondition | typed precondition refusal |
| target or scope is hidden | non-enumerating denial |

For example, changing a member to its current role performs no write; inviting
an already-active visible member is a typed precondition; changing the role of
an absent visible target is a typed precondition; removing an absent target is
an idempotent no-op; and hidden targets/scopes deny without enumeration. Clients may retry, but
must not convert a denial into existence evidence.

## Adopt from an app-owned mirror

Preview adoption without opening the database for writes:

```sh
snapback authority plan --db ./snapback.db --schema ./snapback/generated/schema.manifest.json --profile eventMembers --mirror-table conversationMembers --json
```

The plan reports only counts and digests for matched, missing, extra, or
mismatched rows; it does not print private row values. It also reports the
activation horizon and whether authorization-ledger backfill is available.
Activate the generated projection through the normal schema generation
rotation. If reviewed historical role/status recovery is desired, apply it
explicitly:

```sh
snapback authority backfill --db ./snapback.db --profile eventMembers --apply --confirm authorization-facts-only
```

That operation is idempotent. It moves the horizon backward for available
authorization facts only; it never fabricates display values or timestamps.
After comparing the generated projection, stop writing the old mirror and
retire it through the normal reviewed migration path.

## Use authored resource fields

Child product tables scope visibility with an authored resource field such as
`conversationId` or `eventId`. Do not spell Familiar
`resourceField: "_id"` when `_id` is outside the authored field union, and
never copy a private membership-row id into product storage.

## Anti-patterns

- Making a membership table public to render a roster.
- Maintaining a second app-authored roster mirror beside a generated
  projection.
- Declaring a projection without `provenance: "full"`.
- Treating D1 `boundary` as history completeness or fabricating facts before
  the reported horizon.
- Reusing one incarnation across leave and rejoin.
- Resolving recipients outside the sending transaction, accepting a
  client-supplied recipient array, or truncating at the ceiling.
- Treating generated history as retained/offline-capable without a separate
  retention declaration.
- Using `resourceField: "_id"` where the schema requires an authored relation
  field.
