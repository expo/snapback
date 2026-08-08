# Live-query re-evaluation cost under mutation fan-out is minutes-scale at 5.5M rows

**Opened:** 2026-08-08 · **Severity:** P1 (product-shaped: correct but unusable under hot load) · **Owner seam:** D2 (incremental deltas / bounded re-evaluation) + D4 (stream lifecycle) per the LLP 0183 review round; evidence anchor for acceptance.v2 margins

## Measured

`snapback-control-hot.zb5.v10.json` (immutable receipt): with six streaming
`issueListV2` observers (1,000-row windows) open at the 5,549,113-row store,
the 48 sampled mutation settle latencies span **111 ms to 148 s, median
~74 s**. Convergence and correctness are exact; streams stay live (after the
invalidation fix); the cost is pure re-evaluation fan-out — every buffered
mutation re-runs each observer's full opaque JS handler (bounded list-engine
assembly measured at ~1.3 s standalone at this scale × 6 observers × queued
depth).

## Why it matters

This is the structural ceiling of opaque live queries: correctness scales,
latency does not. Zero-class comparators serve deltas from replication
rather than re-execution. Any workload with concurrent writers and multiple
live windows hits this shape.

## Ask

Not a quick fix — a workstream input: incremental/differential delta
computation for admitted query shapes (D2), or bounded re-evaluation
scheduling with per-subscription staleness contracts (D4), with the hot
gate as the acceptance instrument. The zb5-hot machinery reruns this
measurement in ~80 min; `demos/zerobugs/control/scripts/diag-hot-stream.mts`
iterates in minutes against a persistent baseline.

- **Claimed 2026-08-08:** session dc26442d (13-ticket sweep orchestrator) is executing this ticket now; sibling sessions should not duplicate.
