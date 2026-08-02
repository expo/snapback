# Phase-0 dated platform/pricing facts (2026-08-01)

Recorded per LLP 0105 §Status's rule ("dated platform/pricing facts");
sources are the official Cloudflare docs pages, fetched 2026-08-01.

## Workers for Platforms
(source: developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/platform/pricing/)
- Paid plan required: **$25/month base**; no free tier.
- Included: **20M requests/mo**, **60M CPU-ms/mo**, **1,000 scripts**.
- Overage: **$0.30/M requests**, **$0.02/M CPU-ms**, **$0.02/script**.
- CPU ceilings: 30 s/invocation; 15 min for cron/queue invocations.
- Entitlement: purchase-gated add-on (probe receipt: p0-access-wfp.json,
  error 10121 on a standard account).

## Durable Objects (Workers Paid plan)
(source: developers.cloudflare.com/durable-objects/platform/pricing/)
- Requests: 1M/mo included, then **$0.15/M** (HTTP, RPC, WS messages, alarms).
- Duration: 400,000 GB-s/mo included, then **$12.50/M GB-s**.
- SQLite storage backend (billing active since Jan 2026):
  - rows read: 25B/mo included, then **$0.001/M rows**;
  - **rows written: 50M/mo included, then $1.00/M rows** — the
    load-bearing coefficient for P0.4's write-amplification measurement
    (per-mutation amplified row writes × this price is the margin driver
    0104 ratification #1 decides on);
  - stored data: 5 GB-month included, then **$0.20/GB-month**.

## Immediate implications for Gate 0
- The $1.00/M rows-written coefficient is ~6,700× the per-request
  coefficient ($0.15/M): write amplification dominates the margin
  question exactly as 0105 P0.4 anticipated. The local
  write-amplification measurement (receipt p0.4-write-amplification,
  milestone 2) is therefore the decisive economics input.
- Stored-data pricing ($0.20/GB-month) prices the logical-storage
  formula's output directly; the freelist exclusion in 0104's billing
  basis is customer-favorable against this provider charge.
- WfP's per-script overage ($0.02/script past 1,000) bounds the
  per-app-per-release script retention policy Phase 1 must set.
