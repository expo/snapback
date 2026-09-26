# Snapback 4: two edges in the local expiry retry

- **Opened:** 2026-09-25, from the lane U round 10 delta reviews, both READY WITH CHANGES. These were left for 0.4.3 so that 0.4.2 could ship; both are narrow.
- **Area:** `packages/snapback4/src/local-query.ts`, the retry that re-evaluates a local candidate whose `nextExpiry` passed while it was in flight (lane U rounds 9–10).
- **Severity:** Medium, twice.

## 1. Recovery drops the retry's next local deadline (Astra)

The query has two synced permits that expire at T1 and T2, and an `online only` read on the middle branch:

```quarry
query expiryBranch():
  if exists permits['permit']:
    return false
  if exists permits['later']:
    return exists audits['a1']
  return true
```

Offline, the first observation arrives at T1. Its retry is speculative and carries `nextExpiry: T2`. Recovery then returns loading, or independent remembered data, with `nextExpiry: null`, and `watch.dirty` stays false. So the watch never re-runs at T2.

**Fix:** keep the retry's deadline on whatever recovery publishes, or mark the watch dirty.

## 2. The retry's server call retains the pre-deadline value (Grok)

On the online retry, `server()` runs with `retain` on. The watch's snapshot keeps the value from before the deadline, for example a secret whose permit just expired, for one server round trip after T. The value is already on screen, but its revocation is late by that round trip.

**Fix:** on this one retry, call `server()` with `retain: false`, and do not publish a loading reset on the purely local retry.

**Tests:** a watch that already holds the pre-deadline value when it straddles T online. Add a paginated server fallback after T that keeps its `next`; Grok's surviving mutation nulls it.

## Resolution — 2026-09-25, lane U round 11 (for 0.4.3)

Recovery preserves the local retry's `nextExpiry` alongside the remembered
answer's separate `serverExpiry`; existing watch scheduling observes both
clock domains. Only server transport reached by the expiry retry disables
snapshot retention. Purely local retries still publish without a loading reset.

Real wasm and native process tests cover the chained-permit watch, an already
populated watch during delayed fallback, and server pagination through the next
cursor. Router tests cover missing, valid and expired memory, queries and
watches, offline recovery and failed transport. The related whole-answer
row-expiry limitation remains in its separate open ticket. Evidence and the
full-suite result: [round-11 report](../../snapback4/reports/20260925-bounded-following-r11/REPORT.md).
