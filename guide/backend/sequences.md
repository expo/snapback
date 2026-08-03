---
title: Scoped sequences
id: backend.sequences
order: 28
audience: agent-first
capabilities: [backend.sequences]
authorities: [llp/0113-qualification-and-publication-authority.spec.md, llp/0128-popular-app-storage-scale.research.md, llp/0135-sequence-allocation-and-snapshot-batch.spec.md, llp/0157-composition-algebra-and-completeness.spec.md, src/manifest.rs, src/runtime.rs, src/storage.rs, packages/snapback-codegen/define.mjs, packages/snapback-codegen/sequence-authoring.test.mjs, packages/snapback-harness/ctx-bootstrap.js, demos/improvement-sweep/arms/a6-snapback-web/evidence/app/acceptance.a6.mjs]
examples: [demos/improvement-sweep/arms/a6-snapback-web/evidence/app]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-02
reviewed-commit: HEAD
---

# Scoped sequences

> **Unpublished local substrate; no supporting target yet.** The contributor
> tree contains handler-tier `ctx.sequence.allocate`, generated
> `AllocateSequence`, mutation-atomic lane-Q withholding, and A6 evidence, but
> `sequence_allocation_v1` remains support-false with a structured GAP until the
> complete LLP 0135 §5.1 qualification and LLP 0113 publication train land. Do
> not make an application depend on it yet.

The accepted surface is intended for dense, monotonic human-facing numbers such
as JOB-42 without an application-owned read/increment/write counter. The local
substrate declares every counter on the JS mutation, including its scope table
and the exact way the handler may reach that scope:

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

Codegen emits the experimental capability requirement and acknowledgment, but
because target support remains false, an artifact requiring the capability
must be refused rather than served. In the observed substrate, allocation
facts are settlement evidence: direct receipts carry the exact counter, scope,
incarnation, and value, while ordinary live fanout strips them. A sequence-only
migration mutation may use `writes: []`; do not invent an application write
merely to advance the framework counter.

## Bound string order fields

When a bounded query orders by a string, declare the storage-enforced UTF-8
width in the order expression, for example
`asc('sequenceLabel', { maxEncodedBytes: 32 })`. All declarations for one
`(table, field)` must agree. Activation checks existing rows and every central
writer rejects oversized values with
`SNAPBACK_ORDER_FIELD_MAX_ENCODED_BYTES_EXCEEDED`.

## Current limits

- No target currently publishes `sequence_allocation_v1` support. The local
  handler implementation and A6 run are substrate evidence only; the full
  LLP 0135 §5.1 corpus remains the qualification boundary.
- The generated `AllocateSequence` plan step and lane-Q mutation-atomic
  optimistic withholding are implemented substrate with focused proof. They do
  not complete §5.1 or authorize target publication.
- One mutation can allocate at most once.
- A counter's current or next value is never readable through the API.
- Lane-L local execution of allocating mutations remains out of scope; do not
  claim local-execution parity.
- Historical application counters need an explicit, reviewed migration. The
  A6 fixture records its literal seed and reset/restore history through
  ordinary committed sequence allocations; there is no authored start-value
  escape hatch.
- Snapshot-batch composition is a separate LLP 0135 Part 2 capability. LLP 0157
  §D8 has unblocked that implementation lane by confirming LLP 0135 owns the
  `sbsb1` cursor grammar; no snapshot-batch support is claimed here.
