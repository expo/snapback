# guide-gap: provider adapters need a connection lifecycle and budget recipe

**Status:** Open
**Opened:** 2026-08-20
**Systems:** Guide, Headless client, Contract adapter, Live queries, Auth
**Related:** LLP 0095; LLP 0277 P24; LLP 0278; LLP 0280; LLP 0295;
diaries 0094, 0095, 0098, 0099, 0102, 0103

## Problem

Coterie lanes independently opened per-query connections, rebuilt streams
during auth establishment, issued nested reads from live callbacks, or
republished whole trees on transport-only changes. Stable adapters shared a
connection manager, waited for settled authority, sampled already-delivered
rows, deduplicated equal snapshots, and bounded fan-out. The provider/headless
guide pages describe primitives but not the lifecycle or connection budget.

## Requested repair

- Publish one Contract/provider-neutral adapter recipe covering manager
  ownership, connection-id reuse, subscribe-after-settle, update callback
  constraints, snapshot deduplication, teardown, retry, and per-app/query
  connection budgets.
- Include a diagnostic/inspection example that reports active connections and
  subscriptions by owner.
- Add a regression fixture proving N provider cells do not imply N transport
  connections when their authority/origin is shared.

## Exit

A cold provider author reaches a bounded, teardown-safe two-client adapter
without deriving lifecycle rules from timeouts or source inspection.
