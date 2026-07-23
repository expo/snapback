# LLP 0087 Phase 0 micro-spike — Worker Loader + DO Facets under Miniflare

First hands-on evidence for [LLP 0087](../../llp/0087-facets-hosted-adoption.plan.md)
Phase 0, run 2026-07-23 on the repo's pinned toolchain (Node 24.18.0,
miniflare 4.20260701.0, workerd 1.20260707.1).

Run it:

```
node cloudflare/spike-facets/spike.mjs   # pinned Node per .node-version
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
