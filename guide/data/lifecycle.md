---
title: Read, watch, and settle tiny data
id: data.lifecycle
order: 50
audience: agent-first
capabilities: [data.lifecycle-v1]
authorities: [llp/0255-tiny-data-surface-v1-api.spec.md, llp/0043-offline-replay-retention.rfc.md, llp/0133-local-settlement.spec.md, llp/0218-outbox-settlement-contract.rfc.md, packages/snapback-client/data-client.mjs, packages/snapback-react/data.mjs]
examples: [tests/fixtures/data-surface-a1, tests/acceptance/data-surface-a1-v1.mjs, packages/snapback-client/data-client.test.mjs, packages/snapback-react/data.test.mjs]
status: current
targets: [local]
maturity: partial
since: 0.1.21
unreleased: true
reviewed: 2026-08-14
reviewed-authorities-digest: sha256:7b6ec20435fc4b96477248b9cf126b9c6654dee7dea84b2907c54e45dc00659f
---

# Read, watch, and settle tiny data

> **Unreleased.** The experimental tiny-data lifecycle is newer than the
> newest published closure, 0.1.20. Use contributor source until a later
> qualified closure publishes it.

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Construct a generated descriptor once, then choose one delivery method. The
descriptor, authority policy, cursor, bounds, and result contract are the same
across headless and React; delivery does not create a new query language.

## Read one bounded page

`await db.read(descriptor)` returns `DataPageV1`: frozen `rows`, an opaque
`cursor | null`, and `complete`. Build the next-page descriptor by passing the
cursor to the same generated static query shape. `read` does not subscribe or
retain a cache owner.

## Watch without inventing polling

`db.watch(descriptor)` returns the canonical notify-only handle:
`snapshot()`, `subscribe(listener)`, `refresh()`, and `dispose()`. It delegates
to the existing streaming `liveQuery` owner and never persists its own resume
state. `refresh()` asks that owner for fresh authority data; `dispose()` ends
observation, not transaction custody.

The snapshot is the full `DataQueryStateV1` union intersected with
`pendingWrites`. It distinguishes `pending`, `ready`, `refreshing`, `blocked`,
and `error`; `db.useQuery("skip")` adds the stable `skipped` arm. Every state
also names connection, freshness, retention, and a payload-free ordered list
of relevant unresolved intents.

## Render with `db.useQuery`

Under `SnapbackProvider`, call `db.useQuery(descriptor)`. Pass the literal
`"skip"` to suppress materialization; the returned stable skipped state is:

```json fragment reason="the exact row type is application-specific"
{
  "status": "skipped",
  "connection": "idle",
  "freshness": "unknown",
  "retention": null,
  "pendingWrites": []
}
```

Skip owns no subscription and causes no query I/O. Do not switch to a sentinel
descriptor or conditional hook call.

## Explain or escape after a refusal

`db.explain(descriptor)` returns the generated redacted explain record without
reading rows. `read` refuses absent target read capability; `watch` and
`useQuery` additionally refuse sync-disabled or unretained shapes. Follow the
diagnostic's single next action: enable the required app/target capability,
choose `read` when live materialization is unnecessary, or promote the shape
to a named bounded function. Cloudflare and Expo-store write paths remain
deliberate refusals.

## Settle and recover a write

`db.transact(...chunks)` starts the existing Phase 3 machinery. Observe
`dispatched` separately from `settled`, and use `db.transaction(intentId)` to
recover after reload. Query `pendingWrites` contains intent identity and state,
never argument or row payloads. See [transactions](./transactions.md) for the
closed grammar and custody ceilings.

## Anti-patterns

- Do not treat a prediction, custody acceptance, or dispatch as committed
  settlement.
- Do not poll around `watch`; use its stream and `refresh()` escape.
- Do not read or rewrite opaque cursors.
- Do not render retained protected data after an authority boundary; follow
  the canonical client invalidation owner.
