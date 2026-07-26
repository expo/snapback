---
title: Safe standard data patterns
id: backend.standard-patterns
order: 25
audience: agent-first
capabilities: [backend.standard-patterns]
authorities: [llp/0051-language-neutral-data-tier.rfc.md, llp/0065-generated-data-pattern-soundness.rfc.md, packages/snapback-codegen/standard-patterns.mjs]
examples: [packages/snapback-codegen/standard-patterns.test.mjs]
status: current
targets: [local]
maturity: partial
reviewed: 2026-07-26
reviewed-commit: 5606ab06
---

# Safe standard data patterns

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Use `@snapback/codegen/standard-patterns` when a table follows the common
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

## Know when to leave the profile

The v1 helpers do not authorize joins, projections, migrations, shared ACLs,
or public rows. Express those semantics directly with the declarative builders
or a JavaScript handler under their governing design. A schema field or index
can prove structure; it cannot prove who may see or mutate a row.

## Anti-patterns

- Do not accept owner, creation time, update time, or generated IDs from client
  arguments when the server can derive them.
- Do not treat `authScopeField` metadata as an authorization predicate; the
  executable owner filter and mutation guard are the enforcement.
- Do not use a non-unique or owner-free index for keyset pagination.
- Do not infer visibility from field names such as `ownerId` or `userId`.
- Do not stretch these helpers over joins, ACLs, or migrations; leave the
  profile and state those semantics explicitly.
