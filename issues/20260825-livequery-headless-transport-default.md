# Headless liveQuery defaults to manual polling; stream requires an opt-in

**Status:** Open
**Opened:** 2026-08-25
**Systems:** Client SDK, Live queries, Guide
**Related:** LLP 0307 (Q-b probe F1),
`benchmarks/runs/2026-08-25-qb-lifecycle-probe-0127/record.md`

## Problem

On published 0.1.27, a headless `liveQuery` on the caller-owned path
defaults to manual polling; `transport: 'stream'` must be passed to get
push delivery. The guide documents the option, so the journey recovers in
minutes — but the default choice means every first-time consumer starts
on the slow path and discovers streaming later (the probe measured 3ms
delivery lag once on stream).

## Wanted

Either stream becomes the default where the target supports it (with
polling the documented fallback), or the polling default is made loud
(dev diagnostic naming the option on first poll cycle). Owner: the client
live-query surface (LLP 0108/0095 chain) rules which.

## Acceptance

- [x] A default headless liveQuery emits one dev advisory on its first manual
  poll cycle naming `transport: 'stream'`.
- [x] Guide reflects the conservative ruling; a test pins the polling default
  and once-per-handle diagnostic.

## Orchestrator ruling and Lane P2 disposition (2026-08-26)

Ship the conservative fix now: preserve manual polling as the headless
`liveQuery` default, and emit `SNAPBACK_CLIENT_LIVE_QUERY_MANUAL_POLL` on the
first actual `poll()` cycle for that handle. The warning is carried by the
LLP 0219 dev diagnostics channel, names `transport: 'stream'`, and does not
fire for stream handles or merely constructing an unused polling handle.
`guide/clients/headless.md#subscribe-to-durable-state` steers callers to the
stream option and explains when explicit polling is intentional.

This ticket remains **Open**. Whether stream should become the default is an
unresolved design decision for the LLP 0108/0095 owner; Lane P2 neither decides
nor implies that default change.
