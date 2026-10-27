# S1-SQ context pack

Scope: six S1 natural-column SQLite cells on product `9ee365bbd6`, benchmark lifecycle tooling, separate observation, and aggregate results. No product or Quarry changes.

Governing LLPs: [LLP 3000](../../../../llp/3000-snapback4.explainer.md) (Snapback 4 fence; current), [LLP 2000.000](../../../../llp/2000.000-keep-the-core-flip-two-substrates.rfc.md) (decided-substrate brief), [LLP 3000.009.001.002 §6](../../../../llp/3000.009.001.002-scale-limits-against-postgres-controls.rfc.md#6-method-and-metrics) (intended-arrival metrics, repeated SLO/counter qualification; current), [LLP 3000.009.001.000.002 §3.2](../../../../llp/3000.009.001.000.002-beating-the-postgres-controls.rfc.md#3-writes-program-member-batches-with-a-buffered-overlay) (physical durability before acknowledgement; current) and §4 (revision cache/grant contract). The Snapback 1 foundation/gates do not apply inside this fence.

Active constraints: unchanged fixture, HTTP operations, native identity, scheduler, seeds, pinning, clients/caps, warm-up/windows, repetitions, SLOs and whole-cohort counter equality. SQLite retains shipped WAL/FULL. Only the natural column applies: no database link exists. G6 clock bounds `1000,250` are disclosed but do not enable a cache on SQLite. Source inspection of `engine/revision_cache.rs::cache_key` proves the explicit Postgres-only eligibility check; this is not a measured SQLite cache speedup. Extra high read rungs prevent a search ceiling.

The author's lane brief supersedes inherited setup/floor instructions: local `sb4-pg/main-wp`, no origin fetch, own release target, stop below 25 GiB; the runner's stricter 30 GiB boundary guard remains. No push, stash, Git config change, publication, managed service, paid resource, unowned signal, credentials or raw trials in Git. Process birth identities are retained and checked at cleanup.

Rationale: the old SQLite results predate group commit and later serving work. Compare current SQLite to the explicitly requested S1-C natural A controls and the old SQLite run, while disclosing old/new core budgets and absence of a database hop. Separate instrumentation from capacity runs. CPU sampling spans whole cohorts and is approximate; see `issues/closed/20261024-snapback4-rcpu-sampler-and-payload-guard.md`.

Risks: a shared-host start check does not reserve the host; short serial windows and geometric search can be non-monotonic. The original Convex W2 control is search-dependent. The fsync diagnosis must distinguish actual method, initialized allocation and same-device evidence; no product tuning follows from it.

Likely updates: requested README, aggregate qualification/latency/resource/diagnosis evidence and benchmark tooling. Hand-off: none.
