---
title: Snapshot batches
id: backend.snapshot-batches
order: 27
audience: agent-first
capabilities: [backend.snapshot-batch-v1]
authorities: [llp/0135-sequence-allocation-and-snapshot-batch.spec.md, llp/0157-composition-algebra-and-completeness.spec.md, llp/0110-bounded-children-and-activity-patterns.spec.md, llp/0166-local-persistent-store.spec.md, src/manifest.rs, src/local.rs, src/snapshot_batch_cursor.rs, packages/snapback-codegen/define.mjs]
examples: [packages/snapback-codegen/relation-activity-authoring.test.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-04
reviewed-commit: 30e3d09c7e5063a1233773742c2b69e0b6981e07
---

# Snapshot batches

> **Experimental local target.** `snapshot_batch_v1` is supported by the
> contributor local SQLite/Ibex target. Hosted targets and public runtime
> packages do not claim it. An artifact must acknowledge both
> `snapshot_batch_v1` and its `bounded_children_v1` dependency.

`single_table_v1` is a separate experimental sibling selected automatically
for qualifying public authority-independent declarative live queries. It is
single-node-only and therefore cannot be placed inside a snapshot batch; its
Arm A retained answer and QMK adoption rules are documented under
[offline retention](../sync/offline-and-retention.md).

Use `defineSnapshotBatchQuery` when one screen needs several independently
bounded child lists from one authoritative snapshot. Build each node with
`defineBoundedChildrenQuery`, then pass a static tuple of 2–8 nodes:

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

## Result and continuation

The result is always one row. It is either a sealed absence or the exact
declaration-ordered tuple of cursor-free node pages:

```ts fragment reason="closed result shape from LLP 0135; illustrative generic aliases"
type SnapshotBatchRow<Nodes extends readonly unknown[]> =
  | { kind: "absent"; nodes: null; continuation: null }
  | { kind: "visible"; nodes: Nodes; continuation: string | null };
```

If any parent is missing or invisible, the whole result is the same `absent`
row. No partial tuple or sealing node index is disclosed. Parent visibility is
checked before the cursor, so a hidden parent with malformed cursor bytes still
returns the sealed absence.

The visible row has no inner node continuations. Its one opaque continuation
starts with `sbsb1.` and carries every node's terminal or boundary state under
LLP 0157's exact shared cursor grammar. Pass it back as the `cursor` argument.
A continuation page is a new invocation and therefore a new pinned snapshot;
the cursor detects parent incarnation/version or stream changes and asks the
caller to restart rather than pretending the prior snapshot still exists.

## Live behavior

Only the cursor-free first page is live. Subscribe normally to receive
whole-batch `live_replace` frames when any node table changes. A subscribe
request carrying a cursor refuses before storage access with
`SNAPBACK_SNAPSHOT_BATCH_LIVE_CURSOR_UNSUPPORTED`.

## Closed limits

- Every node is a complete admitted `bounded-children.v1` plan; relational,
  search, aggregate, imperative, and data-dependent nodes are not v1 nodes.
- The tuple has 2–8 nodes and the sum of `take` values is at most 1,024.
- One node still performs at most its bounded parent read and `take + 1` child
  range. Terminal nodes re-read the parent but do not scan a child range.
- The `sbsb1` wire cap is 8,192 bytes and its plaintext cap is 6,099 bytes.
  Establishment computes the declared worst case before parent storage reads;
  an over-budget plan refuses instead of risking an unmintable page.
- String order fields need storage-enforced `maxEncodedBytes` declarations so
  the cursor budget is a proof over stored values, not a hopeful estimate.
- Cross-page snapshot consistency is not claimed. Each invocation has exactly
  one snapshot; the coordinated cursor binds plan, arguments, authority,
  parent versions, and all node boundaries for honest resume behavior.

Codegen emits LLP 0157's normalized node/composite record and `PlanHashV1`.
The host reconstructs and exact-compares both before execution. Liveness is a
fact inside that identity record, never inferred from the plan's shape.
