# S1-PG4 context

Scope: results-only before/after experiment; two immutable product revisions,
private PostgreSQL clusters on one host, the existing S1 application and Rust harness.

- [LLP 3000](../../../../llp/3000-snapback4.explainer.md), foundation: the Snapback 4 fence and results/journal custody.
- [LLP 3000.009.001.002 §4–7](../../../../llp/3000.009.001.002-scale-limits-against-postgres-controls.rfc.md#4-controls), current: unchanged fixture, intended arrivals, repetition, error/latency limits, and honest limits ledger.
- [Request round-trip RFC §4–6](../../../../llp/3000.009.001.000.001-the-request-round-trip-budget.rfc.md#4-the-budgets): structural B1 budgets, distinct request classes, and the test-only RT0 ratchet. Budgets do not qualify measured capacity.
- [S1-PG2 method](../results-20261022-snapback-postgres-2/METHOD.md): seed, account sessions, search, clean statement probes, and whole-cohort counter audit.
- S1-PG3 report, read from branch `sb4-pg/s1-pg3`: account fallback and the shared SSH tail disqualified its B1 capacity result. No code from that lane was merged.

The author explicitly permits local PostgreSQL provisioning, separate release
builds, affinity changes and the existing delay proxy for this experiment.
No product, app, harness semantics, ceiling, durability or authority change is
permitted. Stop below 30 GB free or at a per-boundary ping p99 above 3 ms;
wait for unrelated work using more than one core. Signal only recorded owned
processes. No push, stash or Git configuration change.

Expected updates: this result directory and an appended journal entry.
Hand-off: none. No new design decision or product gate is introduced.
