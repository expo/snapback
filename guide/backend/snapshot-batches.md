---
title: Snapshot batches
id: backend.snapshot-batches
order: 27
audience: agent-first
capabilities: [backend.snapshot-batch-v1]
authorities: [llp/0135-sequence-allocation-and-snapshot-batch.spec.md, llp/0157-composition-algebra-and-completeness.spec.md, llp/0110-bounded-children-and-activity-patterns.spec.md, llp/0080-portable-relational-queries-and-projections.rfc.md, llp/0166-local-persistent-store.spec.md, crates/snapback-engine/src/manifest.rs, crates/snapback-engine/src/local.rs, crates/snapback-sync/src/snapshot_batch_cursor.rs, packages/snapback-codegen/define.mjs]
examples: [packages/snapback-codegen/relation-activity-authoring.test.mjs, packages/snapback-codegen/snapshot-batch-v2-authoring.test.mjs, demos/fleet-observatory-move1]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:21e047f9a0382245b33c96da4b91b541f81b8de4c5b93f131512a7da792745c4
---

# Snapshot batches

> **Experimental local target.** `snapshot_batch_v1` (all-bounded-children
> tuples, one `sbsb1` continuation) and `snapshot_batch_v2` (tuples that
> include relational join nodes, one `sbsb2` continuation; registered
> 2026-08-06, LLP 0157 v0.11) are supported by the contributor local
> SQLite/Ibex target only. The remote-service manifest records both as
> explicit capability gaps, and hosted targets and public runtime packages do
> not claim them. An artifact must acknowledge the profile capability it uses
> plus every composed experimental class — `bounded_children_v1` whenever a
> bounded-children node appears; `relational_query_v1` is stable and never
> needs acknowledgment. Codegen emits these acknowledgments with the
> generated artifact.

`single_table_v1` is a separate experimental sibling selected automatically
for qualifying public authority-independent declarative live queries. It is
single-node-only and therefore cannot be placed inside a snapshot batch; its
Arm A retained answer and QMK adoption rules are documented under
[offline retention](../sync/offline-and-retention.md).

Use `defineSnapshotBatchQuery` when one screen needs several independently
bounded lists from one authoritative snapshot. Build each node with
`defineBoundedChildrenQuery` or `defineRelationalQuery`, then pass a static
tuple of 2–8 nodes. Codegen selects the profile from the node classes, not
from a flag: an all-bounded-children tuple is `snapshot-batch.v1`; any tuple
containing at least one relational node is `snapshot-batch.v2`:

```js source=packages/snapback-codegen/relation-activity-authoring.test.mjs
export const boardView = defineSnapshotBatchQuery({
  nodes: [incidentTasks, incidentTasks, incidentTasks],
});
```

The host executes every node against one pinned snapshot in declaration order.
That order cannot affect the result. Nodes that have the same parent table,
typed parent argument, and complete visibility declaration share one parent
point read and visibility evaluation; equal runtime IDs under different
bindings do not deduplicate.

## Mix relational joins into the batch (`snapshot-batch.v2`)

A dashboard screen often needs a bounded join — message plus sender, event
plus vehicle — next to bounded child lists. `snapshot-batch.v2` admits a
static mixed tuple of complete `defineBoundedChildrenQuery` and
`defineRelationalQuery` nodes, with **at least one relational node**,
evaluated at the same single pinned snapshot. Each node keeps its own class's
complete declaration — visibility, index, order, `take`, projection —
unchanged:

```js source=packages/snapback-codegen/snapshot-batch-v2-authoring.test.mjs
export const eventActors = defineRelationalQuery({
  root: events,
  joined: actors,
  join: [{ root: 'actorSlug', joined: 'slug' }],
  visibility: {
    root: { kind: 'owner', field: 'ownerId' },
    joined: { kind: 'public-read' },
    output: 'owner',
  },
  projection: { title: { root: 'title' }, actorName: { joined: 'name' } },
  take: 3,
  rootIndex: 'by_owner_sequence',
  joinedIndex: 'by_slug',
});
export const mixedView = defineSnapshotBatchQuery({ nodes: [boardCards, eventActors, boardCards] });
export const allRelational = defineSnapshotBatchQuery({ nodes: [eventActors, eventActors] });
```

The Fleet Observatory workload's required route is exactly one such
composite — a 100-row relational join over 250,000 protected events next to a
100-row bounded child page, with no JavaScript handler assembling or joining
result collections
([retained workload receipt](repo:tests/acceptance/fixtures/fleet-observatory/move1-exit.2026-08-06.v1.json)):

```js source=demos/fleet-observatory-move1/snapback/functions.mjs
export const fleetObservatory = defineSnapshotBatchQuery({
  nodes: [latestEventsWithVehicles, vehicleRollupPage],
});
```

Generated artifacts acknowledge the composed experimental capabilities
exactly — `snapshot_batch_v2` always, `bounded_children_v1` only when a
bounded-children node is present:

```js source=packages/snapback-codegen/snapshot-batch-v2-authoring.test.mjs
  assert(mixed.requiredCapabilities.includes('snapshot_batch_v2'));
  assert(mixed.requiredCapabilities.includes('relational_query_v1'));
  assert(mixed.requiredCapabilities.includes('bounded_children_v1'));
  assert(allRelational.requiredCapabilities.includes('snapshot_batch_v2'));
  assert(!allRelational.requiredCapabilities.includes('bounded_children_v1'));
  assert(manifest.acknowledgedExperimentalCapabilities.includes('snapshot_batch_v2'));
```

### Sealed parents, visible empty joins

Sealing runs only through bounded-children parents: if any declared parent is
missing or invisible, the whole mixed tuple is the byte-identical
`absent` row, disclosing no sealing node, count, or cause. A relational node
never seals — an authorized join that matches nothing is a **visible empty
page**, and missing or invisible joined rows keep the node's `inner`/`left`
semantics. An invocation-level authorization refusal of a relational node
refuses the whole composite; it is never recoded as parent absence. An
all-relational tuple has no parent, so its `absent` arm is statically
unreachable — but the declared result contract keeps the same two-arm
envelope in every profile, so the envelope shape never leaks the tuple's
class mix.

### Joined-side work accounting

The composite work ceiling is a static fact of the normalized plan. Each
bounded-children node examines at most `take + 1` child-range entries plus
one point read per deduplicated parent. Each relational node examines at most
`take` root-range entries with no lookahead — a page consuming fewer than
`take` roots is terminal — plus **exactly one joined-side unique-index lookup
per consumed root**, including roots an `inner` join later omits, so at most
`take` joined lookups per relational node per page. Summed node `take` stays
at most 1,024.

### Budget rule for relational order fields

The `sbsb2` cursor budget is proved before the first storage read, so a v2
relational node's declared root order fields must come from the closed
template set: a portable string or a table-scoped id carrying a
storage-enforced `maxEncodedBytes` declaration (the
`asc('field', { maxEncodedBytes: n })` order syntax —
[bound string order fields](./sequences.md#bound-string-order-fields)), a
JavaScript-safe integer, or a boolean. Declaring any other order-field type — a float (`v.real()`),
`principal`, or `assetRef` — refuses composition at establishment with
`SNAPBACK_SNAPSHOT_BATCH_CURSOR_BUDGET_EXCEEDED`; the node's standalone
admission is unchanged.

### Not retained, by design

Both profiles classify as `retention:"none"`: cursor-free-first-page
`live_replace` only, table-granular resnapshot over the union of every node's
declared dependency set when all node tables are public-read. Every bounded or
relational node also carries each source table's declared visibility policy.
If any node policy is restricted, invalidation conservatively resnapshots on
any commit until exact policy-dependency matching is available. There is no
`live_delta` and **no retained composite** — a batch never renders offline. If
a screen needs offline rendering, retain the owner-scoped relational query
standalone (that class is retainable) and keep the composite for the online view
([offline retention](../sync/offline-and-retention.md)).

## Result and continuation

The result is always one row. It is either a sealed absence or the exact
declaration-ordered tuple of cursor-free node pages:

```ts fragment reason="closed result shape from LLP 0135; illustrative generic aliases"
type SnapshotBatchRow<Nodes extends readonly unknown[]> =
  | { kind: "absent"; nodes: null; continuation: null }
  | { kind: "visible"; nodes: Nodes; continuation: string | null };
```

If any bounded-children parent is missing or invisible, the whole result is
the same `absent` row. No partial tuple or sealing node index is disclosed.
Parent visibility is checked before the cursor, so a hidden parent with
malformed cursor bytes still returns the sealed absence.

The visible row has no inner node continuations. Its one opaque continuation
starts with the profile's cursor-family prefix — `sbsb1.` for v1, `sbsb2.`
for v2 — and carries every node's terminal or boundary state under LLP 0157's
exact shared cursor grammar. Pass it back as the `cursor` argument.
A continuation page is a new invocation and therefore a new pinned snapshot;
the cursor detects parent incarnation/version or stream changes and asks the
caller to restart (`SNAPBACK_SNAPSHOT_BATCH_RESTART_REQUIRED`) rather than
pretending the prior snapshot still exists. A relational node has no parent
point-read on resume: its revalidation is the fail-closed plan, argument,
authority, epoch, and order-schema check, and its resumed root window keeps
LLP 0080's no-skip/no-duplicate guarantee for untouched roots. Cross-family
presentation refuses — `sbsb1` bytes in a v2 composite, `sbsb2` bytes in a
v1 composite, or any standalone `sbbc1`/relational cursor in either — with
`SNAPBACK_SNAPSHOT_BATCH_CURSOR_INVALID`; per-node cursor identity does not
survive composition.

## Live behavior

Only the cursor-free first page is live. Subscribe normally to receive
whole-batch `live_replace` frames when any node table changes — in a mixed
tuple that includes every relational node's root and joined tables. With any
restricted node-table policy, any commit may produce the conservative
replacement described above. A
subscribe request carrying a cursor refuses before storage access with
`SNAPBACK_SNAPSHOT_BATCH_LIVE_CURSOR_UNSUPPORTED`.

## Closed limits

- Every node is a complete admitted plan of its own class:
  `bounded-children.v1` only in v1; `bounded-children.v1` and/or
  `relational-query.v1` (at least one relational) in v2. Search, aggregate,
  imperative, and data-dependent nodes are not admitted in either profile.
- The tuple has 2–8 nodes and the sum of `take` values is at most 1,024. The
  tuple is static: no node argument may reference another node's output.
- One node still performs at most its own bounded work (see
  [joined-side work accounting](#joined-side-work-accounting)). Terminal
  bounded-children nodes re-read the parent but do not scan a child range;
  terminal relational nodes examine zero root entries and perform zero joined
  lookups.
- The `sbsb1`/`sbsb2` wire cap is 8,192 bytes and the plaintext cap is 6,099
  bytes. Establishment computes the declared worst case before parent storage
  reads; an over-budget plan refuses instead of risking an unmintable page.
- String and id order fields need storage-enforced `maxEncodedBytes`
  declarations so the cursor budget is a proof over stored values, not a
  hopeful estimate. The declaration syntax —
  `asc('field', { maxEncodedBytes: n })` on the order expression, agreement
  across all declarations for one `(table, field)`, and the
  `SNAPBACK_ORDER_FIELD_MAX_ENCODED_BYTES_EXCEEDED` write-side refusal — is
  [bound string order fields](./sequences.md#bound-string-order-fields).
- Cross-page snapshot consistency is not claimed. Each invocation has exactly
  one snapshot; the coordinated cursor binds plan, arguments, authority,
  parent versions, and all node boundaries for honest resume behavior.

Codegen emits LLP 0157's normalized node/composite record and `PlanHashV1`.
The host reconstructs and exact-compares both before execution. Liveness is a
fact inside that identity record, never inferred from the plan's shape.

## Anti-patterns

- **Hand-assembling a dashboard in a JS handler** by querying and joining
  several lists imperatively. Declare one snapshot batch instead: the
  generated composite gives one pinned snapshot, sealing, and a static work
  ceiling the handler form cannot claim. Fleet Observatory's required route
  is one v2 tuple with no JS assembly.
- **Feeding one node's output into another node's arguments.** The tuple is
  static; data-dependent invocation refuses.
- **Retaining or replaying a composite offline.** Retention is `"none"` by
  design; retain the owner-scoped relational query standalone instead.
- **Subscribing with a cursor.** Only the cursor-free first page is live;
  paginate with ordinary calls.
