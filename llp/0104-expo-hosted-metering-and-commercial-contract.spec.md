# LLP 0104: Expo-hosted Snapback metering and commercial contract

**Type:** Spec
**Status:** Draft
**Systems:** Billing, Metering, Product, Quotas, Runtime, Storage, Realtime, Observability, EAS
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-28
**Revised:** 2026-07-28 (initial draft after source and public-pricing review)
**Related:** LLP 0012, LLP 0014, LLP 0018, LLP 0044, LLP 0047, LLP 0071, LLP 0103, LLP 0105, https://expo.dev/pricing, https://docs.expo.dev/billing/plans/, https://docs.expo.dev/billing/usage-based-pricing/, https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/pricing/, https://developers.cloudflare.com/durable-objects/platform/pricing/, https://developers.cloudflare.com/dynamic-workers/pricing/, https://www.convex.dev/pricing, https://supabase.com/pricing, https://firebase.google.com/docs/firestore/pricing

## Summary

Expo bills Expo-hosted Snapback to the Expo account that owns the project when
usage occurs. Users see a small, predictable set of meters, a generous no-card
free tier, explicit hard/soft limit behavior, current usage, projected cost,
and budgets in the Expo dashboard. Provider-specific Cloudflare meters remain
internal unless one becomes too material to absorb safely.

The commercial goal is to preserve current EAS Hosting prices where semantics
match:

- requests: 100,000 included, then $2 per million;
- CPU: 1 million CPU-ms included, then $0.04 per million CPU-ms;
- hosted asset storage: 1 GB included, then $0.04 per GB-month.

Snapback adds database storage and stateful-resource costs. Database storage
therefore needs its own candidate price, initially **$0.25 per GB-month after
the included amount**, subject to the margin gate below. Database row
operations, Durable Object duration, realtime messages, Queues, and dynamic
handler creation are shadow-metered at launch. They become separate
customer-facing charges only if normal workloads cannot be sustained by
request/CPU/database-storage pricing.

All prices and quotas in this Draft are candidates, not commitments.

## Commercial principles

1. **One Expo bill.** No Cloudflare account, card, invoice, or provider quota.
2. **No surprise free-tier bill.** Free has hard quotas and no overages.
3. **Predictable paid use.** Show included use, month-end projection, charge,
   and budgets before GA.
4. **Meter what users control.** Prefer calls, delivered realtime messages,
   CPU, database storage, asset storage, and egress over Cloudflare vocabulary.
5. **Do not hide loss-making shapes.** Shadow provider costs by stable ids and
   compare them with revenue.
6. **Aggregate free use by Expo account.** Projects, aliases, releases, and
   environments do not multiply quotas.
7. **Keep successful data safe.** Quota crossing may reject new work or make
   an environment read-only; it never silently deletes a successful write.
8. **Commercial and capability truth agree.** A free runtime limit that makes
   an advertised operation impossible is not support.

## Metering identity and event contract

Every usage event carries:

- globally unique, idempotent `eventId` and `schemaVersion`;
- `occurredAt` and `observedAt`;
- `expoAccountId`, `expoAppId`, `snapbackEnvironmentId`;
- `releaseId` and deployment identifier where applicable;
- request/job id;
- metric and integer quantity in its canonical unit;
- source and provider receipt/cursor;
- ownership interval for transfer attribution;
- correction relationship when reversing or replacing an estimate.

Hostname, development-domain name, alias, and custom domain may be dimensions,
but never the primary join key.

Ingestion is at-least-once and consumers deduplicate by `eventId`. Corrections
are append-only. Every hour has a completeness watermark per source. A billing
period closes only after required sources are complete or a documented
estimate/correction policy applies.

## Customer-facing meters

| Meter | Unit | Count rule |
| --- | --- | --- |
| Backend requests | request | One accepted query, mutation, action, HTTP function, live subscribe/resubscribe, or platform operation. Expo-caused transport retries are excluded. |
| Realtime messages | delivered message | One app payload delivered to one connection. Ping/pong and retry duplicates are excluded. |
| CPU | CPU-ms | Combined attributable user-handler and Snapback CPU, rounded only at account-period aggregate. |
| Database storage | GB-month | Time-weighted logical SQLite bytes, including indexes/system tables, excluding invisible PITR overhead. |
| Asset storage | GB-month | Time-weighted user asset/variant bytes; platform bundles and policy backups excluded. |
| Data transfer | GB | User payload/asset egress where Expo incurs material cost; internal/control/cache bytes excluded. |

Realtime messages are separate in the UI because fan-out is understandable,
but may be priced as an included block plus the backend-request rate.
Cloudflare WebSocket frame conversion is an implementation detail.

## Internal shadow meters

Record, per stable identity:

- WfP request, CPU, retained/invoked scripts, and role;
- Dynamic Workers created daily if enabled;
- Durable Object requests, alarms, WebSocket messages, and GB-seconds;
- SQLite rows read/written and physical bytes;
- R2 operations/physical bytes;
- Queue operations, retries, dead letters, and runtime;
- logs, traces, Analytics Engine, BigQuery, backups, and restores;
- notification and asset-processing provider costs.

These support margin, abuse, capacity, and invoice reconciliation. They do not
expose provider credentials or cross-tenant facts.

## Proposed free tier

Promise “the best small reactive Expo backend free tier,” not the largest
number in every category. Competitors constrain different vectors, so universal
quota dominance is not an honest claim.

Candidate aggregate monthly entitlement per Expo account:

| Resource | Candidate free amount | Competitive intent |
| --- | ---: | --- |
| Active Snapback projects | 3 | More than Supabase's two active free projects |
| Backend requests | 1,000,000 | 10× current EAS Hosting free requests |
| Realtime messages | 5,000,000 | Above Supabase's current 2 million |
| CPU | 2,000,000 CPU-ms | 2× current EAS Hosting inclusion |
| Database storage | 1 GB | 2× current Convex/Supabase database allowance |
| Asset storage | 2 GB | 2× common 1 GB file allowances |
| Egress | 10 GB | Above Supabase's 5 GB; matches Firestore |
| Logs | 7 days | Matches current EAS Hosting free retention |
| Point-in-time recovery | 30 days where the provider contract permits | Makes the DO primitive visible user value |
| Preview environments | 2 active, TTL-governed | Useful without permanent storage multiplication |

Free uses the same semantic profile as paid. A 10 ms/request wrapper that
breaks normal Snapback handlers is not acceptable; use a Snapback-specific
limit profile instead of today's coarse Hosting `FREE` restrictions.

Warn at 50%, 80%, 95%, and 100%. At 100%:

- storage blocks new writes with a structured reversible error while
  reads/export remain;
- request/CPU/realtime overage rejects new work without billing;
- jobs pause except deletion, export, quota notice, and integrity work;
- CLI/dashboard show the exact meter and reset/upgrade path.

No successful free data is deleted for quota overage. Inactivity archival
would require a separate retention policy, notice, restore, and export.

## Proposed paid contract

Starter and higher use the existing Expo payment method and billing period:

| Meter | Included | Candidate overage |
| --- | ---: | ---: |
| Backend requests | Current EAS Hosting allowance | $2 / million |
| CPU | Current EAS Hosting allowance | $0.04 / million CPU-ms |
| Database storage | At least 1 GB | $0.25 / GB-month |
| Asset storage | Current EAS Hosting allowance | $0.04 / GB-month |
| Realtime messages | At least 5 million | $0.40 / million, or folded into requests after evidence |
| Egress | At least 10 GB | $0 while provider economics safely permit |

Production/Enterprise may include more, but overage rates should remain
consistent unless a volume contract says otherwise. Starter plus usage is the
natural launch path; Production should not be required merely to exceed hobby
quotas.

### Margin gate

Replay the five-app corpus plus read-heavy live, write-heavy collaboration, and
bursty action/job workloads. Calculate provider cost at p50, p95, and an
adversarial-but-admitted shape. Candidate pricing passes when:

- normal p95 gross margin is at least 50%;
- no admitted shape has unbounded loss relative to charge;
- free maximum cost is bounded by proven controls;
- database price covers DO storage plus backup/metadata overhead;
- row-write amplification is measured after batching version/journal writes.

If request/CPU cannot cover write-heavy row costs, prefer one legible logical
**database write unit** meter over raising unrelated prices. Do not expose raw
Cloudflare rows; the unit must survive a storage-engine change.

## Entitlements and quotas

Universe stores a versioned `SnapbackEntitlement` snapshot per account billing
period:

- plan/pricing version and included/overage quantities;
- hard invocation/runtime limits;
- active project/environment limits;
- log/backup retention;
- domain, region, support, and compliance features;
- spend cap and alerts;
- effective/expiration timestamps.

Deployment authorization embeds entitlement version, stable ids, release id,
and short expiration. Runtime reads a cached projection with immediate
invalidation for suspension, spend cap, abuse, transfer, or plan change.

This replaces extending `DevDomainNameTier.FREE | PAID`; that enum can remain
an ordinary Hosting compatibility projection.

## Reconciliation with today's EAS pipeline

The existing pipeline is a strong base: Logpush supplies request host/CPU;
BigQuery maps hosts to ownership intervals; R2 snapshots join through
development-domain names; period views subtract included use; Stripe receives
aggregate quantities.

Snapback requires:

1. stable ids at emission;
2. hostname joins retained only as reconciliation;
3. stateful shadow meters and logical database storage;
4. sampled observability separated from billable totals;
5. source watermarks, late data, dedupe, correction, and transfer tests;
6. provider invoice reconciliation;
7. usage/projected charges in Expo billing;
8. Hosting/Snapback threshold notifications;
9. public docs reconciliation: the pricing page publishes Hosting overages
   while the usage-based-pricing guide currently describes Build and Update.

Analytics Engine views are not billing authority. Totals come from a complete
provider feed or separately proven counter.

## Spend controls

Paid accounts choose alert-only, hard budget stop, or overage through a second
ceiling. Alert Owners/Admins and optional webhooks at 50%, 80%, 95%, 100%, and
anomalous rate-of-change. Show estimate freshness and the complete watermark.

A hard stop rejects actions/jobs first where appropriate, preserves reads and
export, never corrupts an in-flight commit, and appears in health/capabilities.

## Invoice and dashboard contract

Show included, used, estimated-late, remaining, current charge, month-end
projection, top apps/environments, pricing version, period, and corrections.
Invoice language is:

- “Expo Hosting — Snapback backend requests”;
- “Expo Hosting — Snapback CPU”;
- “Expo Hosting — Snapback database storage”;
- “Expo Hosting — Snapback realtime delivery”;
- “Expo Hosting — asset storage.”

Provider names/raw units appear only in support receipts.

## Abuse and commercial safety

Admission enforces account/project/environment rate and concurrency, auth
throttles, CPU/response/subrequest/egress, storage/write amplification,
connection/subscription/message, release churn/dynamic creation, asset, and
staged account-trust limits. Suspension/appeal follows LLP 0071.

## Acceptance

Automate proof that:

- mid-period transfer attributes both sides correctly;
- aliases/domains/rename never change identity;
- duplicate/out-of-order events do not change bills;
- missing watermarks block premature closure;
- corrections appear once and reconcile;
- Free never creates an overage invoice;
- hard caps preserve committed data/export;
- budgets alert/stop correctly;
- estimate, invoice, and ledger agree within freshness bounds;
- workload cost and free maximum-cost gates pass;
- public pricing/docs agree with runtime behavior.

## Decisions requiring ratification

1. Reuse EAS Hosting request, CPU, and asset prices; add database storage.
2. Market the strongest small reactive Expo bundle, not universal dominance.
3. Keep provider meters internal initially, with a trigger for one logical
   database-write meter.
4. Free hard-stops without charges or successful-data deletion.
5. Stable Expo ids at event emission are mandatory.

## Status

Draft. EAS, Cloudflare, and competitor figures are a 2026-07-28 snapshot and
must be rechecked at ratification and launch.
