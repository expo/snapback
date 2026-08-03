---
title: Scoped sequences
id: backend.sequences
order: 28
audience: agent-first
capabilities: [backend.sequences]
authorities: [llp/0128-popular-app-storage-scale.research.md, llp/0135-sequence-allocation-and-snapshot-batch.spec.md, src/manifest.rs, src/runtime.rs, src/storage.rs, packages/snapback-codegen/define.mjs, packages/snapback-codegen/sequence-authoring.test.mjs, packages/snapback-harness/ctx-bootstrap.js, demos/improvement-sweep/arms/a6-snapback-web/evidence/app/acceptance.a6.mjs]
examples: [demos/improvement-sweep/arms/a6-snapback-web/evidence/app]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-02
reviewed-commit: HEAD
---

# Scoped sequences

> **Experimental, local target only.** The handler-tier surface ships as
> `sequence_allocation_v1`. Generated host-plan allocation, local/offline
> execution, and snapshot-batch composition do not.

Use a scoped sequence for dense, monotonic human-facing numbers such as
JOB-42 without maintaining an application-owned read/increment/write counter.
Declare every counter on the JS mutation, including its scope table and the
exact way the handler may reach that scope:

```js source=packages/snapback-codegen/sequence-authoring.test.mjs
const declaration = [{
  name: 'jobNumber',
  scopeTable: 'orgs',
  scopeAccess: { declaration: 'orgMembers', roles: ['dispatcher', 'operator'] },
}];
const direct = defineJsMutation({
  writes: ['jobs'],
  sequences: declaration,
  handler: async (ctx, args) => ctx.sequence.allocate('jobNumber', args.orgId),
});
```

`scopeAccess` is either a membership declaration plus admitted roles or the
literal `public.v1`; there is no implicit scope reach. The call names the scope
row itself: `ctx.sequence.allocate(counterName, scopeId)`. This makes the
serialization and authorization unit part of the API.

## Commit and replay behavior

A mutation may allocate once. The counter advance, application writes, result,
and settlement commit atomically. Aborts do not burn numbers. Concurrent
allocators serialize at the scoped counter or lose with an effect-free
mutation conflict, so committed values stay dense and monotonic. An Exact
mutation replay returns the retained result without advancing again.

The scope row's relation incarnation is part of counter identity. Deleting and
recreating the row starts a new sequence at 1, even when the application row id
is reused. The last admitted value is `Number.MAX_SAFE_INTEGER`; later
allocation refuses with `SNAPBACK_SEQUENCE_EXHAUSTED` and commits nothing.

The declaration automatically emits the experimental capability requirement
and acknowledgment. Allocation facts are settlement evidence: direct receipts
carry the exact counter, scope, incarnation, and value, while ordinary live
fanout strips them. A sequence-only migration mutation may use `writes: []`;
do not invent an application write merely to advance the framework counter.

## Bound string order fields

When a bounded query orders by a string, declare the storage-enforced UTF-8
width in the order expression, for example
`asc('sequenceLabel', { maxEncodedBytes: 32 })`. All declarations for one
`(table, field)` must agree. Activation checks existing rows and every central
writer rejects oversized values with
`SNAPBACK_ORDER_FIELD_MAX_ENCODED_BYTES_EXCEEDED`.

## Current limits

- Only JS/Ibex mutation handlers can allocate; generated `AllocateSequence`
  plans are not implemented.
- One mutation can allocate at most once.
- A counter's current or next value is never readable through the API.
- Lane-Q optimistic changesets containing sequence-derived placement are not
  implemented by this slice; do not claim local-execution parity.
- Historical application counters need an explicit, reviewed migration. The
  A6 fixture records its literal seed and reset/restore history through
  ordinary committed sequence allocations; there is no authored start-value
  escape hatch.
