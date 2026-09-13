# Snapback 4: Preserve timestamp bits and durable outbox admission order

Status: Open
Priority: P1
Observed: 2026-09-12
Review finding: R09
Evidence: ID packing reproduced; queue ordering code traced
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.001](../llp/3000.001-durable-replica-and-write-lifecycle.research.md), [comprehensive review](../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

`mintId` shifts the timestamp left by 80 bits, then shifts the entire value
left by another 80 bits while appending random bytes. Encoding only 26 base32
digits discards the timestamp. IDs minted for times 1000, 2000 and 3000 all
have a zero decoded timestamp and start with ten zeroes.

The outbox sorts by these ids, so dependent offline writes replay in random
order. Correctly packing a timestamp is necessary but insufficient: writes
admitted within one millisecond, or after a wall-clock adjustment, still need
an explicit durable order.

Fix the 128-bit packing and give outbox admission a persisted sequence that
survives restart. Keep identity and ordering separate. Verify timestamp round
trips, uniqueness, same-millisecond admission, a backwards clock, and two
dependent offline writes where the second requires the first's server result.
Retrying or reopening must not change their admitted order.

## Implementation locations

- [packages/snapback4/src/client.ts](../snapback4/packages/snapback4/src/client.ts)
- [packages/snapback4/src/local.ts](../snapback4/packages/snapback4/src/local.ts)
