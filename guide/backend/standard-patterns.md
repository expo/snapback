---
title: Safe standard data patterns
id: backend.standard-patterns
order: 25
audience: agent-first
capabilities: [backend.standard-patterns]
authorities: [llp/0051-language-neutral-data-tier.rfc.md, llp/0065-generated-data-pattern-soundness.rfc.md, llp/0100-membership-addressed-operations-and-pages.rfc.md, llp/0110-bounded-children-and-activity-patterns.spec.md, llp/0113-qualification-and-publication-authority.spec.md, llp/0157-composition-algebra-and-completeness.spec.md, llp/0166-local-persistent-store.spec.md, packages/snapback-codegen/standard-patterns.mjs, packages/snapback-codegen/define.mjs]
examples: [packages/snapback-codegen/standard-patterns.test.mjs, packages/snapback-codegen/relation-activity-authoring.test.mjs]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:f99b6fdb988d64145b86f8c6275af59102ac56d2b59681059038fcfabeb44bec
---

# Safe standard data patterns

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Use `@expo/snapback-codegen/standard-patterns` when a table follows the common
single-owner shape. The helpers generate declarative queries and mutations;
they do not add a second runtime or hide handwritten JavaScript behind the
API.

This surface is partial because the implemented v1 profile is intentionally
narrow: owner visibility only, with authorization and visibility always
declared by the caller. Its governing soundness RFC is Implemented; “partial”
describes the helper's limited profile, not unfinished enforcement.

## Declare the owner and continuation boundary

The pagination index is an authorization partition followed by one unique
continuation field. This example uses a server-generated string `pageKey`;
timestamps alone are usually not unique enough for the v1 keyset contract.

```js source=packages/snapback-codegen/standard-patterns.test.mjs
export const todos = defineTable({
  ownerId: v.principal(),
  slug: v.string(),
  title: v.string(),
  pageKey: v.string(),
  createdAt: v.integer(),
  updatedAt: v.integer(),
})
  .index('by_owner_slug', ['ownerId', 'slug'], { unique: true })
  .index('by_owner_page_key', ['ownerId', 'pageKey'], { unique: true })
  .index('by_owner_created', ['ownerId', 'createdAt'])
  .visibility({ kind: 'owner', field: 'ownerId' })
  .sync();
```

## Generate owner-scoped CRUD

Bind the table into a schema first, then name every generated operation and
declare the owner field. The generated list and get queries include an
executable `ownerId == authUserId()` filter. Create stamps the owner from the
authenticated principal; update and delete re-read the row and guard its owner
inside the transaction.

`createDefaults` and `updateDefaults` use trusted runtime values. `now` becomes
server-derived `runtimeNow()` and `id` becomes server-derived `runtimeId()`;
neither field appears in the public argument schema, so a client cannot forge
it. For the direct JavaScript handler form, including runtime diagnostics and
transitioning an existing client-authored field, see
[trusted runtime time and identifiers](./trusted-runtime-values.md).

```js source=packages/snapback-codegen/standard-patterns.test.mjs
export const { listTodos, getTodo, createTodo, updateTodo, deleteTodo } = defineOwnedCrud({
  table: schema.tables.todos,
  names: {
    list: 'listTodos',
    get: 'getTodo',
    create: 'createTodo',
    update: 'updateTodo',
    delete: 'deleteTodo',
  },
  visibility: { kind: 'owner', field: 'ownerId' },
  createDefaults: { pageKey: 'id', createdAt: 'now', updatedAt: 'now' },
  updateDefaults: { updatedAt: 'now' },
  immutable: ['slug', 'pageKey', 'createdAt'],
  listIndex: 'by_owner_created',
});
```

`listIndex` is required: it names a declared index whose leading field is the
owner field, the generated list orders by that index's field sequence (the
storage layer's implicit `_id` component breaks ties deterministically), and
the helper never emits an unindexed owner scan. `now` defaults bind only to
integer millisecond fields.

Generation fails closed when `visibility` is missing, the owner field is
optional or unsuitable, `listIndex` is absent or not owner-leading, a trusted
default has the wrong field type, the table carries a membership or
permission-backing declaration (generated CRUD refuses authority-bearing
tables), a unique index that excludes the owner field is not named in
`discloseUniqueConflicts` (an undeclared cross-owner conflict would disclose
existence), or an unknown option is present. Cross-owner update and delete
refuse with the same `SNAPBACK_ROW_NOT_FOUND` outcome as a missing row, so
existence is not disclosed at the public boundary.

## Generate a unique lookup

Use a declared unique index that includes the owner field. The helper derives
arguments for the other index fields while retaining the server-derived owner
predicate.

```js source=packages/snapback-codegen/standard-patterns.test.mjs
export const { todoBySlug } = defineOwnedUniqueLookup({
  table: schema.tables.todos,
  name: 'todoBySlug',
  index: 'by_owner_slug',
  visibility: { kind: 'owner', field: 'ownerId' },
});
```

## Generate keyset pages

Keyset pagination emits separate first-page and next-page live queries. Its
index must be unique and contain both the owner and cursor fields; generation
rejects a declaration that would disguise a scan as pagination.

```js source=packages/snapback-codegen/standard-patterns.test.mjs
export const { firstTodoPage, nextTodoPage } = defineOwnedKeysetPages({
  table: schema.tables.todos,
  names: { first: 'firstTodoPage', next: 'nextTodoPage' },
  index: 'by_owner_page_key',
  cursorField: 'pageKey',
  visibility: { kind: 'owner', field: 'ownerId' },
});
```

The default page size is 50. Pass `direction: 'desc'`, a smaller `limit`, or a
different cursor argument name when the declared unique index supports that
shape. The index fields must be exactly `[ownerField, cursorField]`, in that
order. A unique index with a third field is not sufficient because the cursor
may still repeat within one owner's partition. A generated string `pageKey`
using an `id` trusted default is the safe v1 continuation when the natural sort
field, such as a timestamp, is not independently unique.

The continuation is an opaque versioned cursor, never the raw boundary
value. When a page returns its full `limit` of rows, the response carries a
`cursor` next to `rows`; pass it as the next-page function's cursor argument
(`after` by default). The cursor binds the app, the first/next pair's plan
identity, and the caller's authority partition: a malformed, raw-value,
cross-pair, cross-owner, or post-authorization-change presentation is
refused with `SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID` (HTTP 400), never
silently repositioned, and every refusal class answers byte-identically. A
page with fewer than `limit` rows is terminal and carries no cursor.
Continuation guarantees no skipped and no duplicated row among rows
untouched by concurrent mutations; a row whose cursor field is concurrently
mutated may move relative to the page boundary.

## Generate membership-scoped keyset pages

When the partition is a shared resource rather than the caller's own rows —
a chat room's history, an org's board — `defineMembershipKeysetPages`
(LLP 0100 §4) pages one membership-protected resource. Visibility is the
caller's declared seat: the generated pair executes the resource-value
filter AND the declaration-bound role predicate on every invocation —
executable authority, never metadata.

```js source=packages/snapback-codegen/standard-patterns.test.mjs
export const { firstRoomMessagePage, nextRoomMessagePage } =
  defineMembershipKeysetPages({
    table: messages,
    names: { first: 'firstRoomMessagePage', next: 'nextRoomMessagePage' },
    membership: {
      declaration: roomMembers,
      resourceArg: 'roomId',
      resourceField: 'roomId',
      roles: ['owner', 'member'],
    },
    index: 'by_room_page_key',
    cursorField: 'pageKey',
    limit: 50,
  });
```

The `membership` block is this profile's visibility declaration and is
closed: `declaration` is the `defineTable(...).membership(...)` table
(resource-scoped only), `resourceArg`/`resourceField` carry the
declaration's exact nominal resource id type (a plain string that merely
looks like a room id is refused), and `roles` is a non-empty subset of the
declared non-pending roles — a pending seat is not visibility. The index
must be unique with exactly `[resourceField, cursorField]`, and a
membership or permission-backing table can never be the page table.

**The per-resource page-key idiom is a real authoring constraint.** The
single-column cursor means a chat-shaped table that would naturally page on
`(createdAt, id)` must instead maintain a per-resource unique page key —
a generated string `pageKey` written with an `id` trusted default (or an
app-owned monotone key) so `[roomId, pageKey]` can be declared unique.
Compound cursor boundaries are LLP 0100 open question 4, not a v1 surface.

**These pages are callable-only.** The pair is emitted as ordinary `Query`
definitions that cannot be subscribed at all — a deliberate delta from the
owned helper's live-query emission, because a subscribable historical page
would create one authorization-sensitive subscription per visited page.
The product's separate current-room `live_replace` query owns live
grant/revocation updates; a fresh first-page call observes a later grant.
When a Contract product screen needs one of these pages, invoke the
generated references from a host/client control beside the compiled
Contract surface — the composition is shown in
[the Contract adapter](../clients/contract-adapter.md#call-a-paged-query-from-a-contract-screen).

A non-member's first page is empty with no cursor and reveals neither room
nor membership existence — byte-identical to a nonexistent resource id.
The continuation cursor binds, beyond the owned profile's members, the
exact resource-argument VALUE (a room-A cursor presented for room B
refuses), the membership declaration facts, the global authorization pair
(any membership write invalidates outstanding continuations — removal
between pages refuses the old cursor, and rejoining does not revive it),
the data-version stream (reset invalidates), and the active artifact
identity (any redeploy invalidates — accepted conservatism). Every refusal
class answers with the byte-identical
`SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID` before any candidate row is
read.

## Know when to leave the profile

The v1 helpers do not authorize joins, projections, migrations, shared ACLs,
or public rows. Express those semantics directly with the declarative builders
— the complete `defineMutation` step/expression vocabulary is
[declarative mutation plans](./declarative-plans.md) — or a JavaScript
handler under their governing design. A schema field or index
can prove structure; it cannot prove who may see or mutate a row.

## Design reference: write plus one activity row

`defineWriteWithActivity` and `defineBoundedChildrenQuery` are experimental
local profiles. A contributor source build of the exact
`local-dev-sqlite-ibex` target advertises both as one atomic source publication
only when its private embedded
`LocalCapabilityPublicationV1` carrier still matches the committed
qualification receipt and the executor/schema source bytes. Application
artifacts cannot supply that carrier. They must explicitly acknowledge
`write_activity_v1` or `bounded_children_v1`; an unacknowledged requirement
refuses at load.

The repository evidence is split deliberately. Run
`node packages/snapback-codegen/relation-activity-authoring.test.mjs` for
closed authoring, generated relationship assertions, exact-one bounded result
typing, and dedicated capability refusal. Run
`cargo test --lib
relation_incarnation_is_protected_and_delete_recreate_isolated` for the
transaction-local active-incarnation check, including stale-row patch/delete
refusal after parent deletion and ID reuse. Run
`node tests/conformance/relation-activity-publication-v1.mjs` to verify the
tracked carrier, receipt, source digests, cursor golden, and first-party queue
ownership together. Remote-service, conformance-workerd, Cloudflare, and
hosted profiles retain both GAPs; this local source carrier does not authorize
them. Public runtime packages are deliberately compiled as `public-package`
and retain both structured GAPs because the loader does not yet embed and
verify the release-key-signed `PackageCapabilityAttestationV1`. Package
assembly refuses a contributor-source binary, so placing the same executable
under `node_modules` cannot launder the source trust root into a published
claim.

The helper makes one existing-owner transaction reviewable:

1. point-read the declared scope and collapse missing/invisible to
   `SNAPBACK_ROW_NOT_FOUND`;
2. run a bounded closed primary plan;
3. verify the declared source table, id, operation, and exactly one changed
   row;
4. insert exactly one activity row with server-derived authority provenance
   and the scope relation incarnation; and
5. validate and durably retain the exact LLP 0108 result under LLP 0043's
   client mutation identity.

Declare every non-scope primary table explicitly:

```js fragment reason="closed relation declaration shape; the executable fixture uses domain-specific table bindings"
relations: [{
  table: tasks,
  scopeForeignKey: 'incidentId',
  scopeIncarnation: 'incidentIncarnation',
}]
```

Do not author either protected field on an insert. The helper stamps the
foreign key from the authorized scope and the central writer supplies the
current incarnation. Before every non-scope `Get`, `Patch`, or `Delete`, the
generated host plan executes `AssertCurrentRelation` inside the commit
transaction. It compares the row foreign key and protected stamp with the
active registry token and collapses missing, cross-scope, and stale-orphan
rows to `SNAPBACK_ROW_NOT_FOUND`.

`defineBoundedChildrenQuery` returns exactly one row of a sealed union:
`absent` has `parent: null`, no children, and no continuation; `visible` has
the projected parent, the bounded child page, and a nullable continuation.
Projection leaves are `_id` or portable scalar fields only. Optional stored
scalars remain required keys whose value is `null | Scalar`; optional JSON is
not admitted as a projection leaf.

Two to eight complete bounded-children definitions additionally compose into
one pinned-snapshot batch via `defineSnapshotBatchQuery` — a further
experimental capability (`snapshot_batch_v1`, which also requires
`bounded_children_v1`) with its own page:
[snapshot batches](./snapshot-batches.md).

The neighboring experimental `single_table_v1` class is deliberately not an
authoring helper. Codegen derives it automatically when an ordinary
`defineLiveQuery` is public, authority-independent, ambient-free, and its
complete read summary is the one table in its declarative plan. The generated
artifact then requires the class; authors cannot assert membership. It remains
single-node-only and uses Arm A authority-independent snapshot retention, not
an `AuthorizedLease` and not `defineSnapshotBatchQuery`.

The source operation is exactly `insert`, `patch`, or `delete`. Empty and
storage-identical patches are not effects; missing targets and operation
mismatches roll the whole transaction back before activity or settlement.
Scope, source, and activity identities are declared, not inferred from the
first write or from field names.

Activity provenance comes only from admitted server authority. Sessions map
to a direct human actor. Delegated service authority requires an effective
user and records the distinct agent actor and grant. Anonymous, admin bypass,
system, bare/autonomous service, and dev impersonation refuse. The activity
stores a purpose-derived SHA-256 digest of the canonical durable
`ClientMutationIdentity`, not the cleartext client mutation id.

Inspect the generated plan and `EffectCeilingV1`: it must expose the scope
read/patch count, auxiliary point reads, one source effect, one activity
insert, runtime IDs/time, settlement lookup/write, and maximum application
writes. A maintained-projection participant or an unpartitioned observable
unique constraint is outside this profile.

## Anti-patterns

- Do not accept owner, creation time, update time, or generated IDs from client
  arguments when the server can derive them.
- Do not treat `authScopeField` metadata as an authorization predicate; the
  executable owner filter and mutation guard are the enforcement.
- Do not use a non-unique or owner-free index for keyset pagination.
- Do not infer visibility from field names such as `ownerId` or `userId`.
- Do not stretch these helpers over joins, ACLs, or migrations; leave the
  profile and state those semantics explicitly.
- Do not append activity after commit or treat a no-op patch as an auditable
  source change.
- Do not accept effective subject, actual actor, actor kind, grant, or
  mutation digest from application arguments.
- Do not infer support from an exported helper. Check the target manifest and
  acknowledge the experimental capability; other targets still report a GAP.
