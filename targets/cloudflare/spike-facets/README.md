# LLP 0087 Phase 0 micro-spike — Worker Loader + DO Facets under Miniflare

First hands-on evidence for [LLP 0087](../../llp/0087-facets-hosted-adoption.plan.md)
Phase 0, run 2026-07-23 on the repo's pinned toolchain (Node 24.18.0,
miniflare 4.20260701.0, workerd 1.20260707.1).

Run it:

```
node targets/cloudflare/spike-facets/spike.mjs   # pinned Node per .node-version
```

## What it demonstrates

A supervisor Durable Object loads app code supplied **at runtime as a
string** (via a `workerLoaders` binding), starts it as a named **facet**
(`ctx.facets.get`), and exercises it end to end.

Result: all probes pass locally.

| Probe | Result |
| --- | --- |
| Worker Loader binding in Miniflare (`workerLoaders: { LOADER: {} }`) | works |
| Facet started from `worker.getDurableObjectClass(...)` | works |
| Facet has its own SQLite (`ctx.storage.sql`) | works — facet sees only `notes`, supervisor only `supervisor_meta` |
| `facets.abort` → restart via `get` | storage persists across abort/restart |
| `facets.delete` | database permanently destroyed (fresh empty DB on restart) |
| `globalOutbound: null` egress denial inside facet | denied with a capability-style error ("must use capabilities (such as bindings in 'env')") |

## Why this matters

- **The plan's biggest kill-risk is cleared at micro-spike level:** LLP 0087
  names Miniflare parity a hard requirement ("no Miniflare support, no
  adoption") because the whole local proof runs on Miniflare. Both
  primitives work under the exact pinned versions the proof uses.
- **The egress model composes with Snapback's.** `globalOutbound: null`
  yields deny-by-default with capability-shaped errors — the same posture
  as the LLP 0047 action-egress gating.

## The per-topology reconnaissance harness (`harness.mjs`)

```
node targets/cloudflare/spike-facets/harness.mjs   # pinned Node; ~1 min
```

Runs **reconnaissance-grade partial shapes** of probes P1/P2/P3/P4/P5/P7/P8
from `gate0-probe-list.md` (see that file's "Instruments — honest coverage
statement" for exactly what each shape omits; P6 and P9–P13 are not
implemented) against topologies A (facet family), B (loader-fed shared
services), C (hybrid), and the compiled-in baseline. It emits
reconnaissance JSON — explicitly **not** the Gate 0 receipt, and its green
results are instrument validation, never probe passes.

Reconnaissance results (2026-07-23, Node 24.18.0 / miniflare 4.20260706 /
workerd 1.20260707):

- **Recon shapes of P1 egress denial, P2 envelope enumeration, P3
  slow-action non-blocking (query p95 ≈ 4–7 ms during a 1.5 s action), P5
  storage inspection, and P8 sequential version switch: green in all three
  topologies.** These are instrument-validation results, not probe passes
  — the full criteria run post-sign-off.
- **P4 adversarial: not locally answerable.** App 2 starves during app 1's
  CPU spin in every topology *including the baseline* — local workerd does
  not exhibit production isolate scheduling, so P4's contention half is
  strictly an on-platform question. Termination semantics (abort while
  misbehaving) do verify locally.
- **P7:** facet abort/restart costs tens of ms locally (A ≈ 41 ms p95,
  C ≈ 5 ms) vs warm p50 ≈ 2–5 ms; true cold-start comparison needs the
  on-platform run with validated eviction.

## What this does NOT establish (open for Gate 0)

- LLP 0009 isolation review (what the isolate boundary actually guarantees;
  CPU/memory attribution between supervisor and facet; whether the
  coordinator/action-handler service split survives colocation).
- Behavior on the **real** platform: cold-start delta, hibernation
  interaction, alarms-per-facet, PITR-per-facet, and measured billing
  (pricing page: billed since 2026-05-26 — $0.002/dynamic-worker/day beyond
  1,000/month, standard request/CPU rates; paid plan only).
- Facet class versioning/migration semantics under real deploys.
- Scale behavior (many facets per supervisor; large modules).

Findings roll up to LLP 0087 Gate 0 and, on decision, into LLP 0014.
