<!-- Generated data section flat projection by scripts/generate-guide-manifest.mjs. Never hand-edit. -->

---

<!-- snapback-guide-source: guide/data/resources.md -->
---
title: Generate a tiny typed data resource
id: data.resources
order: 10
audience: agent-first
capabilities: [data.resources-v1]
authorities: [llp/0255-tiny-data-surface-v1-api.spec.md, llp/0065-generated-data-pattern-soundness.rfc.md, llp/0231-entity-and-permissioning-recommendation.rfc.md, packages/snapback-codegen/define.mjs, packages/snapback-codegen/data-resource.mjs, packages/snapback-codegen/standard-patterns.mjs, packages/snapback-cli/index.mjs]
examples: [tests/fixtures/data-resource-a1-explicit, tests/fixtures/data-resource-a1-familiar, tests/fixtures/data-resource-a2-explicit, packages/snapback-codegen/data-resource.test.mjs, packages/snapback-cli/data-promotion.test.mjs]
status: current
targets: [local]
maturity: partial
since: 0.1.21
unreleased: true
reviewed: 2026-08-13
reviewed-authorities-digest: sha256:5ec66d2c811d3360928ad418efe029cb796ef2c529b0336b15e87ba182ec0af1
---

# Generate a tiny typed data resource

> **Unreleased.** DataResourceV1 is newer than the newest published closure,
> 0.1.20. Use it from contributor source until a later closure publishes it.

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Use terminal `.data(...)` when one table is either owner-scoped or deliberately
public-read and needs the standard bounded list/get operations. Owner resources
also receive create/update/delete with owner stamping and transactional
non-disclosing guards. This Phase 1 surface generates ordinary functions and
artifacts; the `db.<resource>` query builder and transaction facade remain a
later phase.

## Declare one terminal resource

Declare indexes and visibility first. `.data(...)` is terminal in both the
explicit and familiar profiles.

```js source=tests/fixtures/data-resource-a1-explicit/schema.mjs
export const todos = defineTable({
  title: v.string(),
  completed: v.boolean(),
  ownerId: v.principal(),
  createdAt: v.integer(),
})
  .index('by_owner_created', ['ownerId', 'createdAt'])
  .visibility({ kind: 'owner', field: 'ownerId' })
  .data({ createDefaults: { createdAt: 'now' }, immutable: ['createdAt'] });
```

The generated names are `todos.list`, `todos.get`, `todos.create`,
`todos.update`, and `todos.delete`.

Public-read resources generate only list/get and require an explicit ordinary
`listIndex`. Owner resources may omit `listIndex` only when exactly one
ordinary index begins with the owner field. Zero or multiple candidates refuse
instead of guessing.

## Continue a list

List accepts optional `after`, but any present cursor refuses
`SNAPBACK_DATA_QUERY_CAPABILITY_UNAVAILABLE` until the Phase 2 cursor executor
ships. Omit `after` and request the first page; do not treat the contracted
argument as an implemented continuation.

## Check the v1 eligibility floor

DataResourceV1 admits explicit owner visibility over a required principal or
plain string, or explicit public-read visibility. It refuses membership or
any-of visibility, authority-bearing tables, retained history, relation-
incarnation fields, more than 64 authored fields, and more than 16 ordinary
indexes. An owner unique index must contain the owner field. A bare `v.id(...)`
field is neutral; the LLP 0110 relation-incarnation stamp is what makes a field
ineligible.

Search/vector indexes and asset-sharing declarations remain owned by their
existing systems. They may coexist with an otherwise eligible resource, but
the generated data operations do not claim search, vector, or asset powers.
For membership, relationships, partial updates, compare-and-set, or other
shapes outside this floor, use a [named query](../backend/queries.md) or
[declarative mutation](../backend/declarative-plans.md).

## Choose the application sync mode

Sync is enabled for every data resource by default. Set the one application
policy field to opt out:

```json fragment reason="the application-wide DataResourceV1 sync opt-out"
{
  "schemaVersion": "snapback.codegen-policy.v1",
  "committedProjections": [],
  "dataSync": "disabled"
}
```

Opt-out changes generated list/get from `LiveQuery` to `Query` and disables
local materialization; owner server writes remain. The field is forbidden when
there are no `.data()` resources. Never add authored `.sync()` to a data table:
it refuses because per-table sync would compete with this application policy.
Familiar's automatic sync is tagged as a profile default and is accepted.

## Inspect generated witnesses

Run generation and inspect `schema.manifest.json#dataResources`, plus the
conditional `data.mjs` and `data.d.ts` files. The normalized resource witness
binds field/default/immutability facts, visibility policy, list index,
contracts, plans, effects, sync, capabilities, ceilings, and refusals. It
excludes source profile and paths, so equivalent explicit and familiar A1
declarations mint the same `normalizedDataResourceId`.

When no table calls `.data()`, all data manifest fields, semantic inputs,
generated files, and package exports are absent. There is no empty default
surface that rotates existing applications.

## Promote one write

Preview a generated owner write as ordinary explicit source:

```sh
snapback data promote todos.update --format explicit
```

The command preflights current source, verifies the active generated graph is
not stale, prints the deterministic patch and semantic diff, and writes only
after approval. It freezes the current policy, defaults, immutability, owner
assignment, plan/contracts, effects, and failure facts. A changed destination
or resource witness refuses. Familiar v1 cannot express the generated owner
write guard and always points to the explicit command instead.

## Recover from Phase 1 refusals

Every Phase 1 refusal is stable and routes to one next action:

| Code | Next action |
| --- | --- |
| `SNAPBACK_DATA_RESOURCE_DECLARATION_INVALID` | Use only the four `.data(...)` keys, call it once, and make it the final table-builder call. |
| `SNAPBACK_DATA_RESOURCE_VISIBILITY_REQUIRED` | Declare owner or public-read visibility, or move the behavior to a named function. |
| `SNAPBACK_DATA_RESOURCE_INELIGIBLE` | Remove the named authority, relation, history, size, or disclosure fact, or use a named function. |
| `SNAPBACK_STANDARD_PATTERN_LIST_INDEX_REQUIRED` | Name an eligible ordinary index; owner omission works only for one owner-leading candidate. |
| `SNAPBACK_DATA_RESOURCE_SYNC_PER_TABLE_FORBIDDEN` | Remove authored `.sync()` and use application `dataSync: "disabled"` when needed. |
| `SNAPBACK_DATA_OPERATION_NAME_COLLISION` | Rename the authored export or remove `.data()`; generated names never auto-rename. |
| `SNAPBACK_DATA_QUERY_CAPABILITY_UNAVAILABLE` | Omit `after` during Phase 1 and request the first page. |
| `SNAPBACK_DATA_PROMOTION_REFUSED` | Regenerate stale artifacts, preserve the previewed destination, and use explicit format for owner writes. |
| `SNAPBACK_DATA_FUNCTION_RECORD_PARITY_FAILED` | Update the recursive disposition gate for the changed canonical function record before generating. |

## Anti-patterns

- Do not call table-builder methods after `.data(...)`; move every declaration
  before the terminal call.
- Do not use `.sync()` as a data-table switch; use the application policy.
- Do not infer owner visibility from a field name. Declare the table policy.
- Do not hand-copy generated function bytes. Use promotion so stale facts and
  destination changes fail closed.
- Do not accept `after` in production as pagination support during Phase 1;
  its present-value path is an intentional capability refusal.
