# Snapback 4: Replica apply path is quadratic in table size

Status: Open
Severity: minor
Priority: P2
Area: perf
Observed: 2026-09-13
Evidence: Code-traced (complexity reasoning, no benchmark run)
Baseline: `6918cccbc264cf000982b03a5a11a2cf5563f885` / Snapback 4 0.1.15
Review provenance: Snapback4 comprehensive-review synthesis (2026-09-13 child review)

## Problem and reproduction

`put` in [store.ts](../snapback4/packages/snapback4/src/replica/store.ts)
does, per row and per index: a binary search, a `splice(at, 1)` removal
and a `splice(at, 0, ...)` insertion into a plain array, plus
`structuredClone(row)` on every `put`/`get`/`lookup`/`scan`/`page`. Each
`splice` memmoves O(n) entries, so applying a sync batch (or any bulk
load) of n rows over k indexes costs O(k·n²) moves plus O(n) full-row
clones — on the device, during sync, where cold starts already pay the
horizon cost tracked in `20260913-snapback4-expired-rows-fill-sync-horizon`
(different issue: horizon content, not apply complexity). No open ticket
covers apply-path complexity (searched issues/ for splice/structuredClone
— no hits). Impact is complexity-based: not benchmarked, and small tables
will never notice.

## Implementation locations

- [packages/snapback4/src/replica/store.ts](../snapback4/packages/snapback4/src/replica/store.ts) (`put`, `page`, `scan`, `lookup`)

## Suggestion

Batch index maintenance (sort-then-merge per index instead of per-row
splice), avoid cloning rows that never cross an API boundary, and add a
sync-apply benchmark (e.g. 10k-row table, time `apply`) with a budget so
regressions fail loudly.
