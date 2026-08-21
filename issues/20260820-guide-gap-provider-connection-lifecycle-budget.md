# guide-gap: provider adapters need a connection lifecycle and budget recipe

**Status:** Open — reopened 2026-08-21 after independent review
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

## Reopening note — 2026-08-21

The requested N-cells/one-transport regression fixture does not exist, D0.5
still owns the provider connection policy, and the former Coterie example mints
per-subscription connection ids. The recipe now presents inspection and stable
declared ownership as decision-independent guidance without claiming a selected
one-transport contract. Both the requested regression and LLP 0295's packed
vertical receipt remain required; the exit is not met.

## Partial implementation

Added `guide/recipes/provider-lifecycle.md` and linked it from the headless and
Contract adapter pages. It teaches stable declared ownership, authority
settlement, callback/store boundaries, explicit teardown, and
`localResourceInspection()` observation without claiming one selected provider
connection policy. Per LLP 0295's decision-dependent rule, it states today's
qualitative zero-owned-resource boundary and explicitly leaves ownership and
numeric limits to
`issues/20260821-provider-connection-subscription-budget-decision.md` rather
than inventing policy. The recipe and retrieval case 70 preserve the exact
"connection per subscription", "N cells imply N transport connections",
"active connections and subscriptions by owner", and "provider lifecycle
budget" vocabulary. The retained cold run at
`guide/eval-runs/2026-08-21/provider-lifecycle.md` passed in 8/15 tool uses.

Partial evidence: retrieval, Guide, and inventory checks pass; the N-cells
regression and packed vertical receipt remain open.
