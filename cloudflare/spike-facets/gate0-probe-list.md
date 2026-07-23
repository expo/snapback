# Gate 0 isolation probe list — for LLP 0009 reviewer sign-off

Status: **DRAFT — awaiting LLP 0009 reviewer sign-off.** Per
[LLP 0087](../../llp/0087-facets-hosted-adoption.plan.md) Gate 0 item 1, the
reviewer signs this list **before** the suite-level isolation leg runs on the
candidate topologies, and signs the results after. The micro-spike
(`spike.mjs`) and the topology harness (`harness.mjs`) are pre-leg
reconnaissance: they inform this list and prove the instruments work, but
discharge no Gate 0 criterion.

Scope note (LLP 0087 §Ratification posture): facet-hosted code is
**operator-supplied trusted code**. These probes verify the *engineering*
containment properties the coordinator contract depends on — not an
untrusted-tenant security boundary, which remains LLP 0009/0047 + Workers
for Platforms territory.

## Topologies under test

- **A — facet family:** coordinator DO hosts handler + action facets.
- **B — loader-only shared services:** handler and action services are
  shared platform Workers loading per-app code via Worker Loader;
  coordinator calls them over service bindings.
- **C — hybrid:** handler as coordinator facet; action as loader-fed shared
  service.
- **Baseline — compiled-in:** today's shape (static module), for cold-start
  and latency comparison only.

## Probes

| # | Probe | Applies to | Pass criterion |
| --- | --- | --- | --- |
| P1 | **Ambient egress denial.** App code (handler and action roles) calls global `fetch` to an external origin. | A, B, C | Denied with a coded/capability error; no bytes leave. Matches the `acceptance.egress.mjs` ambient-denial behavior. |
| P2 | **Binding-envelope minimality.** App code enumerates its `env`. | A, B, C | Only the intended host seam binding(s) are present — no loader binding, no storage bindings, no platform secrets reachable from app code. |
| P3 | **Slow-action non-blocking.** A 1.5 s action is in flight; ≥ 20 concurrent queries and 1 mutation dispatch meanwhile. | A, B, C | Concurrent query/mutation p95 unaffected (budget: ≤ 100 ms local; on-platform budget set in the Gate 0 receipt). Verifies the LLP 0040/0049 slow-action property survives each topology. |
| P4 | **Two-app adversarial leg.** App 1 runs (a) a CPU-spin variant and (b) an allocation-balloon variant; app 2 is well-behaved. | A, B, C | App 2's query latency stays within budget while app 1 misbehaves; app 1 is terminable (`facets.abort` / stub invalidation / per-app service isolation) without affecting app 2; after termination, app 1's stubs fail with the abort reason and app 2 is undisturbed. For topology B this is the shared-service queue-isolation test LLP 0087 §Target architecture names. **This probe is on-platform only for its pass/fail:** the 2026-07-23 reconnaissance run showed app 2 starvation during app 1's CPU spin in *every* topology *including the compiled-in baseline* (p95 ≈ 1.9 s against a 2 s spin), i.e. local Miniflare cannot exhibit production isolate scheduling at all; local runs verify only the termination semantics, never the contention behavior. |
| P5 | **Storage invariant.** Inspect facet/loaded-worker SQLite after a full probe run. | A, C (facet roles); B (n/a unless service uses DO state) | Nothing app-data-shaped in facet SQLite: app rows, version counter, journal, outbox, cron, and subscription state live only in the coordinator (LLP 0014 door 1). Today's handler roles keep no durable role-local state, so the expected facet table set is empty (or enumerated in the receipt if a topology introduces genuine role-local state). |
| P6 | **Lifecycle and stub semantics.** `facets.abort(reason)` then re-`get`; `facets.delete`; calls on stale stubs. | A, C | Abort halts and invalidates stubs (calls throw the abort reason); storage persists across abort/restart; delete permanently destroys the facet DB; all failure modes surface as distinguishable errors the host can map to stable `SNAPBACK_*` codes. |
| P7 | **Cold start with validated eviction.** First-request latency after demonstrably discarding the loaded worker/facet (fresh loader id / abort — the eviction surrogate must be shown to actually discard the runtime, per LLP 0087 Gate 0 item 3). | A, B, C vs Baseline | p95 over ≥ 30 samples, same session/location as baseline; budget (frozen pre-measurement): candidate p95 ≤ 2× baseline p95. |
| P8 | **Version-skew smoke.** Load app code v1, then v2 under a new content hash; in-flight v1 requests complete; new requests get v2. | A, B, C | No cross-version interleaving within one request; old version discardable; maps to LLP 0014's code-update-skew caveat. |

## Instruments

- `spike.mjs` — micro-spike (P1/P5/P6 shapes, single facet). Reconnaissance.
- `harness.mjs` — per-topology harness implementing P1–P8 locally and
  emitting a reconnaissance JSON (explicitly **not**
  `cloudflare/generated/gate0-facets-comparison.json`; the official receipt
  is produced only by the post-sign-off suite-level runs).
- The suite-level leg reuses the existing acceptance behaviors
  (local-suite manifest checks, `acceptance.egress.mjs`) with app code
  hosted under each candidate topology.

## Reviewer sign-off

- [ ] **Pre-leg:** probe list approved (probes sufficient and correctly
      scoped for the trusted-code posture; budgets and applicability
      matrix agreed) — reviewer: ____________, date: ____________
- [ ] **Post-leg:** results reviewed against this list — reviewer:
      ____________, date: ____________

Amendments after pre-leg sign-off require reviewer re-approval; record
deltas here with dates.
