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

- A default headless liveQuery on a stream-capable target either streams
  or emits one dev advisory naming `transport: 'stream'`.
- Guide reflects the ruling; a test pins the default.
