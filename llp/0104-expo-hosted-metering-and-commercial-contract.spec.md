# LLP 0104: Expo-hosted Snapback metering and commercial contract

**Type:** Spec
**Status:** Accepted
**Systems:** Billing, Metering, Product, Quotas, Runtime, Storage, Realtime, Observability, EAS
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-28
**Revised:** 2026-08-03 (commercial-direction ruling, author decision sitting #2 (`issues/20260803-author-decision-sitting-2.md`): Snapback ships a legible database write-unit meter as a named Charlie-facing line item, not write-cost-in-margin; final prices remain Gate-0 outputs pending the real-DO rerun — the ruling sets the shape only; see §Margin gate); 2026-08-02 (trailing Status reconciled to the Accepted metadata and author-acceptance history without ratifying gate-pending commercial values); 2026-08-02 (implementation cross-reference to LLP 0154's shared operation-class registry; independent loss-tolerant telemetry remains non-authoritative for billing); 2026-07-28 (initial draft after source and public-pricing review); 2026-07-28 (/llp-super-refine round 1 revision: DB-storage price marked gate-pending with floor-plus-overhead logic; bill-grade logical-SQLite-bytes definition and reconciliation; request/CPU reuse made contingent on write-amplification measurement; per-environment service limit and near-cap behavior in the paid contract; free-tier PITR demoted to capability-gated; authoritative account-budget/lease protocol for free limits; owner-independent metering identity; versioned operation-classification table; pinned dated included amounts; realtime shipping default and fold trigger); 2026-07-28 (/llp-super-refine round 2 revision: logical-storage named honestly as allocated non-freelist page bytes (upper bound) with supported Cloudflare APIs, irreversible missing-sample treatment, and namespace-level aggregate reconciliation; transfer fence in the account-budget protocol revoking/epoching old-owner leases plus min(account,per-env) storage bound; scale-ceiling formulas/pin as Gate-0 outputs; enumerated chargeable control-op subset; ownership interval made authoritative; 20:1 WebSocket frame billing named as a margin-gate input); 2026-07-28 (/llp-super-refine round 3 revision: `occurredAt` defined as the admission-bound attribution timestamp with attribution/budget bound at admission and carried through commit; transfer fence made an atomic coordinator boundary; billed storage terms named to exact pragmas `PRAGMA page_count`/`freelist_count`/`page_size` with `databaseSize` demoted to a validated cross-check; missing-sample carry-forward de-claimed as conservative, replaced with a bounded-error reproducible estimator and customer-favorable credit policy; op-class table given distinct `environment.create`/`environment.inspect` ids and `transfer`/`preview-TTL governance` added to the non-chargeable enumeration); 2026-07-28 (/llp-super-refine round 4 revision: `code.activate` (promote/rollback modes) classified once instead of separate `promote`/`rollback` op-ids, plus push/read/lockdown + internal ops named non-chargeable by default; service-limit headroom reconciled to the allocated-non-freelist billed basis so index/system-table pages are counted in-band and not double-counted as headroom; app-wide multi-coordinator transfer protocol added to the account-budget protocol; PRAGMA availability flagged as a Gate-0 verification item); 2026-07-28 (/llp-super-refine round 5 revision: transfer fence made a durable prepare/commit/abort state machine — prepare freezes old-owner leases without destroying them, commit revokes/epochs, abort restores; app-wide protocol snapshots and freezes the participant set with publication re-validation; "no partial transfer" narrowed to ownership attribution; missing PRAGMA support made a Gate-0 failure blocking the billing basis with `databaseSize` a cross-check only never the billing source; summary lead reworded to "beyond the metered allocated-non-freelist quantity"); 2026-07-28 (/llp-super-refine post-convergence touch-up: r6 detail items folded in); 2026-07-28 (Accepted by author Charlie Cheever after /llp-super-refine dual-READY convergence on r6; r6 detail items folded in)
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
therefore needs its own price. **$0.25 per GB-month after the included amount is
a candidate contingent on the margin gate below, not a decision.** The floor
logic is explicit: the price must cover the $0.20/GB-month DO SQLite provider
floor (LLP 0014 §Platform Facts) **plus** the physical overhead **beyond the
metered allocated-non-freelist quantity** — PITR history, replication, and
provider-side allocation slack beyond the page allocator (the customer meter counts
allocated non-freelist pages, including index/system-table pages, but not these; see
§Defining billable "logical SQLite bytes") — so a 1.25× markup over the bare floor is almost
certainly too thin on storage-heavy tenants. The gate either replaces the candidate with a proven number or widens
it (comparable durable storage sits at ~$0.75–$1.00/GB-month equivalent per the
cited competitor pricing); until Gate 0 runs the number is gate-pending. Database
row operations, Durable Object duration, realtime messages, Queues, and dynamic
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
- `occurredAt` and `observedAt`. **`occurredAt` is the admission-bound
  attribution timestamp**: the instant the operation was admitted for execution,
  not when it later executed or committed. Each operation's ownership attribution
  and budget reservation are **bound at admission and carried through commit**, so
  an operation admitted under the old owner attributes and charges to the old
  owner even if it commits after a transfer cutover. This removes the admission/
  execution/commit ambiguity: attribution is fixed at admission and never
  re-derived at commit;
- the owner-independent durable id `(expoAppId, snapbackEnvironmentId)` (LLP 0103
  §Project and environment identity) as the primary join key;
- the **ownership interval** in force at `occurredAt`, which is **authoritative**
  for attribution; `expoAccountId` is **derived from it** (the interval's owner at
  `occurredAt`), not an independent second encoding — it is time-versioned and
  changes on transfer, and is never part of the durable key;
- `releaseId` and deployment identifier where applicable;
- request/job id;
- metric and integer quantity in its canonical unit;
- source and provider receipt/cursor;
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
| Backend requests | request | One accepted query, mutation, action, HTTP function, live subscribe/resubscribe, or chargeable platform operation, per the versioned `operation-class.v1` table below. Expo-caused transport retries are excluded. |
| Realtime messages | delivered message | One app payload delivered to one connection. Ping/pong and retry duplicates are excluded. |
| CPU | CPU-ms | Combined attributable user-handler and Snapback CPU, rounded only at account-period aggregate. |
| Database storage | GB-month | Time-weighted allocated non-freelist SQLite page bytes (an upper bound on live logical bytes; see §Defining billable "logical SQLite bytes"), including index/system-table pages, excluding freelist pages and invisible PITR overhead. |
| Asset storage | GB-month | Time-weighted user asset/variant bytes; platform bundles and policy backups excluded. |
| Data transfer | GB | User payload/asset egress where Expo incurs material cost; internal/control/cache bytes excluded. |

Realtime messages **ship as a separate meter** because fan-out is understandable
on its own; that is the default customer-facing schema. They are folded into the
backend-request rate only on an explicit trigger — the margin gate showing that a
separate realtime charge does not change account-level economics enough to
justify a distinct line for typical shapes. Until that trigger fires, the
separate meter and its $0.40/million rate are what runtime, dashboard, and
invoice present. Cloudflare WebSocket frame conversion is an implementation
detail.

#### Defining billable "logical SQLite bytes"

"Logical bytes" is otherwise ambiguous against allocation, free pages, WAL, and
unreclaimed deleted pages, so the billable quantity is defined honestly as
**allocated non-freelist page bytes**: `(page_count − freelist_count) ×
page_size` for the environment's SQLite database, including index and system-
table pages, sampled inside the coordinator against a consistent committed
snapshot. The three terms come from the exact first-party SQLite sources that
yield this formula directly and no other: **`PRAGMA page_count`**,
**`PRAGMA freelist_count`**, and **`PRAGMA page_size`**. Cloudflare's per-object
`databaseSize` is **a cross-check only, never the billing source** (it yields
`page_count × page_size` but not `freelist_count`, so it cannot compute the billed
allocated-non-freelist quantity and would over-count freelist space against the
customer); it must be validated to equal `page_count × page_size`, with any
divergence treated as a measurement fault, not a silent billing input. **PRAGMA
availability (`page_count`/`freelist_count`/`page_size`) on Cloudflare DO-SQLite is
a Gate-0 verification item** — it is assumed here but not backed by LLP 0014
platform facts. Because `databaseSize` cannot implement the meter,
**missing PRAGMA support is a Gate-0 failure that blocks the DO-SQLite billing
basis until resolved** (LLP 0105 P0.4), not a silent billing fallback: the meter
does not ship on a quantity that over-counts freelist space. Any fallback billing
path, if one is wanted at all, must bill an explicitly **customer-favorable**
quantity that is never above the true non-freelist bytes; the default is that Gate 0
must confirm PRAGMA availability before the meter ships.

This quantity is an **upper bound on live logical bytes, not the live logical
contents**: it excludes only pages on the freelist and un-checkpointed WAL bytes
(space the engine has fully released for reuse), but it **still includes
partially-empty B-tree pages and deleted-but-not-yet-reclaimed data occupying
allocated pages**. The customer is therefore not billed for freelist space, but
is billed for allocated pages the engine has not compacted — this is a stated,
honest upper bound, not a claim of measuring only live rows. (An earlier draft
claimed deleted-but-unreclaimed space is excluded; that was wrong for a
page-allocation measure and is corrected here.)

Sampling is hourly, time-weighted to a GB-month. **Missing samples are treated as
irreversible**: a sample interval that was never taken cannot be retroactively
recovered. Carry-forward from the last confirmed sample is **not** claimed to be
conservative — it **undercounts when storage grew during the missing interval**
and overcounts when it shrank. The gap is instead filled by a **reproducible
estimator with a bounded customer-billing error** (the bound is a Gate-0 output;
LLP 0105 P0.4), applied under an explicit **customer-favorable policy**: an
unresolved gap is never billed above the last confirmed sample plus the bounded
estimate, an irrecoverable gap is resolved in the customer's favor, and if a
later true sample **below the carried-forward estimate for the interval**
establishes that the estimate overcharged, the difference is corrected and
credited. Endpoint samples cannot reconstruct the time-weighted path through a
gap, so an interval whose true time-weighted path is **unknowable** is settled
conservatively in the customer's favor rather than estimated upward. Corrections
remain append-only for genuinely restatable events (a
never-taken sample is not resurrected as a "true sample," but an overcharge it
caused is credited when a subsequent real sample reveals it).

This allocated figure is smaller than the **physical** bytes Cloudflare bills
(PITR history, replication, provider-side allocation slack beyond the page
allocator) — that expected gap is part of the overhead the price floor above must
cover. Reconciliation is against the level the provider actually exposes:
Cloudflare's per-object `databaseSize` is a first-party per-stable-id sample, but
provider **stored-byte billing analytics are namespace-level**, not a per-object
physical charge. Reconciliation therefore aggregates the per-object first-party
samples across the namespace and compares that aggregate to the namespace/provider
bill under an **explicit allocation rule and error bound**; a persistently
widening ratio is a margin-gate signal, not a silent customer charge (LLP 0105
P0.4). It never claims a per-stable-id provider physical charge that Cloudflare
does not expose.

#### Chargeable operation classification (versioned)

"Backend request" must count identically in runtime, dashboard, docs, and
invoice, so what counts as one is a versioned table (`operation-class.v1`), not
prose. At launch:

| Operation | Counts as | Notes |
| --- | --- | --- |
| Query / mutation / HTTP function call | 1 request | Accepted call; Expo-caused transport retries excluded |
| Action invocation | 1 request | Egress metered separately |
| Live subscribe / resubscribe | 1 request each | A reconnect that resubscribes counts once |
| Delivered realtime message | 1 realtime message | Not a request; see realtime meter |
| Compound / batched call | 1 request per accepted logical operation | A batch of N accepted operations is N |
| Platform operation | Chargeable subset only, enumerated: **`export` and `restore` are chargeable** (1 request to initiate each); **`app.create`, `environment.create`, `code.activate` (promote/rollback modes), `environment.inspect`, `suspend`, `delete`, `transfer`, and `preview-TTL governance` are not chargeable** | Only the enumerated tenant-visible control operations count; app/environment-creating and lifecycle operations (`app.create`/`environment.create`/`code.activate`/`environment.inspect`/suspend/delete/transfer/preview-TTL governance) and all internal repair, health, and quota-notice operations never count. **`promote` and `rollback` are not separate op-ids: both are modes of LLP 0089's `code.activate`** (rollback is `code.activate` naming a prior version under the anti-rollback policy), classified once here and encoded identically in 0103 §Paved path and 0105 §Work ownership. `environment.create` (LLP 0103) is distinct from 0089's `app.create`, and `environment.inspect` is distinct from LLP 0024's `app.inspect`. **push/read/lockdown provisioning operations and all internal operations are non-chargeable by default** (covers `code.push`/`schema.push`/`permissions.push`/`capabilities.read`/`schema.lockdown`) |
| Export / restore | 1 request to initiate | Bytes moved are metered under storage/egress, not per-row |

The table is versioned with the pricing version; changing it requires a new
version so historical invoices remain reproducible.

### 2026-08-02 implementation cross-reference: one class seam, separate sinks

LLP 0154's accepted OQ1 ratification implements the local
`operation-class.v1` registry as a shared classification seam. One admitted
observation class may project into telemetry, metering, and hosted structured
logs, but those projections keep separate reliability and identity contracts.
The telemetry projection is bounded and may shed; the metering projection is
non-shedding, idempotent, and independently deduplicated under this spec's
admission-bound account/environment attribution. Neither a telemetry event nor
its absence can add, remove, or prove billable usage. The committed shared
projection fixtures are the executable cross-document witness; no telemetry
transport is a billing source.

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
| Point-in-time recovery | Capability-gated: advertised only once user-visible restore ships and passes LLP 0105 Gate 1 | Makes the DO primitive visible user value once truthful |
| Preview environments | 2 active, TTL-governed | Useful without permanent storage multiplication |

Point-in-time recovery stays capability-gated because today only the DO PITR
*primitive* exists; user-visible restore/export is an acknowledged unbuilt gap
(LLP 0103 §Completeness gap matrix). Advertising a 30-day restore guarantee
before restore ships would violate commercial principle #8 (commercial and
capability truth agree). It becomes an advertised free-tier value only when LLP
0105 Gate 1's "restore and logical export independently verify" passes.

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
| Backend requests | 100,000 (the 2026-07-28 EAS Hosting allowance) | $2 / million |
| CPU | 1,000,000 CPU-ms (the 2026-07-28 EAS Hosting allowance) | $0.04 / million CPU-ms |
| Database storage | At least 1 GB, up to the per-environment service limit | $0.25 / GB-month (candidate, gate-pending) |
| Asset storage | 1 GB (the 2026-07-28 EAS Hosting allowance) | $0.04 / GB-month |
| Realtime messages | At least 5 million | $0.40 / million (shipping default); folded into requests only on the trigger below |
| Egress | At least 10 GB | $0 while provider economics safely permit |

Production/Enterprise may include more, but overage rates should remain
consistent unless a volume contract says otherwise. Starter plus usage is the
natural launch path; Production should not be required merely to exceed hobby
quotas.

#### Service limit (per-environment ceiling)

Database-storage overage is **not uncapped growth**. Every paid environment has a
published per-environment ceiling — the same interim scale envelope 0103 §Interim
per-environment scale envelope sets. Both ceilings are **Gate-0 outputs** produced
by explicit formulas, not pinned here as prose:

- **storage ceiling** = `10 GB (LLP 0014 SQLite-backed DO hard limit) − reserved
  headroom`, defined on the **same allocated-non-freelist page basis as the billed
  quantity** (index and system-table pages counted in-band; see §Defining billable
  "logical SQLite bytes"). Because index/system-table pages are already inside the
  metered/ceiling quantity, reserved headroom covers only capacity **not** in that
  quantity: PITR history depth, compaction/allocation slack, and safety margin — the
  physical overhead the storage price floor above must cover. Headroom must **not**
  double-count index/system-table overhead. The numeric ceiling comes from the
  **same Gate-0 measurement that proves write amplification and reconciles logical
  storage** (0105 P0.4);
- **write-rate ceiling** derived from the single-coordinator single-
  `transactionSync` version authority under the P0.4 write-amplification result.

The paid contract therefore states a maximum, not open-ended per-GB billing.
**0104 and 0103 ratification must pin identical dated numeric values for both
ceilings, produced by Gate 0, before private paid beta** (0105 Phase 2); until
pinned, both documents carry the formula and reserved-headroom basis rather than
a number.

Near-cap behavior is defined and matches 0103's at-ceiling behavior: warn on
approach; at the ceiling, refuse new writes with a structured reversible error
while reads, live queries, export, and deletion continue; never silently drop a
successful write; never bill an environment into provider exhaustion. The
supported exit is user-visible export/graduation (LLP 0046), not paying to keep
one object growing. Paying more does not raise the per-object ceiling; it is
lifted only by graduation to a different profile.

### Margin gate

Replay the five-app corpus plus read-heavy live, write-heavy collaboration, and
bursty action/job workloads. Calculate provider cost at p50, p95, and an
adversarial-but-admitted shape. Candidate pricing passes when:

- normal p95 gross margin is at least 50%;
- no admitted shape has unbounded loss relative to charge;
- free maximum cost is bounded by proven controls;
- database price covers DO storage plus backup/metadata overhead;
- row-write amplification is measured after batching version/journal writes;
- the provider **WebSocket frame billing shape** is modeled: incoming WebSocket
  frames bill as requests at a **20:1 ratio** and hibernation stops duration
  charges (LLP 0014 §Platform Facts), so both the realtime-messages meter
  ($0.40/million delivered) and the backend-request meter sit atop this
  asymmetry; the gate confirms neither undercharges subscribe/fan-out-heavy
  shapes against the provider frame bill.

If request/CPU cannot cover write-heavy row costs, prefer one legible logical
**database write unit** meter over raising unrelated prices. Do not expose raw
Cloudflare rows; the unit must survive a storage-engine change.

**Ruled 2026-08-03 — author decision sitting #2
(`issues/20260803-author-decision-sitting-2.md`).** The commercial
direction is decided: Snapback ships the legible **database write-unit
meter as a named Charlie-facing line item**, not write cost absorbed into
margin on other meters. Final prices remain Gate-0 outputs pending the
real-DO rerun; this ruling sets the shape only.

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

#### Authoritative account-budget protocol

Free limits aggregate per Expo account (principle #6), but concurrent
environments meter locally and report asynchronously, so cached entitlement
projections alone cannot stop them from jointly spending past an account hard
limit before the ledger converges — contradicting "Free never creates an overage
invoice" and the bounded-free-cost gate. The account therefore holds an
authoritative budget environments draw against, not just a projection they read:

- **Leases.** Each active environment holds a time-bounded lease for a share of
  the remaining account budget, sized conservatively for its recent rate. It may
  spend only within its live lease; spending beyond requires renewing against the
  account budget, which fails closed when the account is exhausted.
- **Overshoot bound.** Worst-case account overshoot before convergence is the sum
  of outstanding leases (deliberately small), not unbounded — this sets the
  free-tier maximum-cost bound the margin gate must prove.
- **Partition.** An environment that cannot reach the authority spends only its
  current lease, then degrades to at-ceiling behavior (writes refused,
  reads/export continue) rather than assuming headroom.
- **Delayed meters.** Late/out-of-order events reconcile append-only and can only
  shrink remaining budget, never resurrect spent budget, so lag cannot
  manufacture an overage.
- **Storage headroom.** Storage leases reserve a conservative slice of the account
  storage limit up front, so environments cannot jointly cross the storage cap
  before the ledger sees their writes.
- **Reclaim / rebalance.** Idle environments' unused leases are reclaimed and
  rebalanced to active ones so slices do not strand account budget.
- **Effective storage bound.** An environment's effective storage bound is
  `min(account aggregate, per-environment service limit)` (§Service limit): free
  storage leases draw against the **account aggregate** (e.g. the 1 GB free
  database-storage allowance), while a paid environment is additionally capped by
  its per-environment ceiling. A free account's aggregate can concentrate in one
  of its environments up to that per-environment ceiling but never past the
  account aggregate, resolving the 1 GB-account-aggregate vs. multi-GB-per-
  environment-ceiling interaction.
- **Transfer fence.** On app transfer, ownership crosses an account boundary, so
  a lease reserved from the **old** account must not be spendable while events
  attribute to the **new** account (that would bypass the new owner's hard limit
  and corrupt both accounts' remaining budget). Transfer is an **atomic
  coordinator boundary** (LLP 0103 §Transfer and deletion): the coordinator
  **stops admission**, lets admission-bound in-flight work finish (or terminates
  it) under its bound attribution, **advances the ownership/lease epoch**, and
  **requires a new-owner lease before any newly-admitted work**. Concretely, this is a
  durable prepare / commit / abort state machine (LLP 0103 §App-wide
  multi-coordinator transfer protocol): **prepare freezes** old-owner leases
  (pauses admission and new-lease issuance) **without destroying them**, **commit**
  — tied to the release-cutover / ownership-interval boundary (§Metering identity
  and event contract) — **revokes or epochs every frozen old-owner lease** for the
  transferred environment and **requires a fresh new-owner lease before any
  post-cutover admission**, and **abort** restores or re-issues the frozen
  old-owner leases and requires abort acknowledgements before admission resumes.
  In-flight spend is **bounded** to work already admitted under the old owner's
  interval. "Immediate invalidation" of cached entitlement projections is not
  sufficient by itself; the authoritative already-issued leases are explicitly
  frozen then revoked/epoched at commit, not just the cached projection. Because attribution and budget reservation are **bound at admission
  and carried through commit** (§Metering identity and event contract), an
  operation admitted before cutover settles to the **old** owner even if it
  commits after cutover, and no spend is attributable to the new owner until its
  lease is granted.

**App-wide multi-coordinator transfer.** The transfer fence above is the
**per-environment** boundary, but an app owns multiple environments, each with its
own coordinator, so an app-level transfer is distributed. It runs as a **two-phase
app-wide protocol** driven by a **durable per-coordinator participant state machine
with idempotent prepare / commit / abort** (LLP 0103 §App-wide multi-coordinator
transfer protocol), identical here: (1) the app-level owner-of-record (Universe /
control plane) issues a **global transfer epoch**, **durably snapshots the
participant set**, and — as the **serialization authority that gates
`environment.create`/`delete`/`restore` against the app's active transfer epoch** —
**serializes environment-lifecycle mutations (`environment.create`, two-stage
`delete`, `restore`) against the epoch** — blocked or queued until the transfer
commits or aborts — so the participant set cannot change between enumeration and
publication (an `environment.create` already admitted at Universe but whose
coordinator does not yet exist at snapshot time is caught by publication-time
re-validation and aborts the transfer); (2) **prepare/fence (freeze)** — every
participant coordinator idempotently records `PREPARED`, stops admission,
drains/terminates admission-bound in-flight work under its bound attribution, and
**freezes** its old-owner leases (pauses admission and new-lease issuance) **without
destroying them** — revocation happens at commit — then acknowledges; (3)
**ownership publication point (commit)** — the app's ownership interval (and
therefore which account is charged) advances **atomically only after ALL
coordinators in the snapshot acknowledge and the live participant set is
re-validated equal to the snapshot** (else the transfer aborts), each coordinator
idempotently **commits** by revoking/epoching its now-superseded old-owner leases,
and each environment requires a fresh **new-owner lease before any post-publication
admission**; (4) **failure recovery (abort)** — if any coordinator fails or is
unavailable, or the participant set no longer matches the snapshot, the transfer
**aborts**, every prepared coordinator idempotently **restores or re-issues its
frozen old-owner leases and requires abort acknowledgements before admission
resumes** under the old owner, and old ownership is retained app-wide; an
unavailable coordinator blocks the publication point under bounded retry, else the
control plane explicitly aborts. **Post-publication commit recovery:** a
coordinator that acknowledged `PREPARED` and then becomes unavailable **after
ownership publication but before processing `commit`** must **durably
redeliver/reconcile the commit** and remains **fail-closed (admission paused)**
until it **records the committed epoch and obtains a new-owner lease** — it never
resumes charging under either account until both hold (LLP 0103 §App-wide
multi-coordinator transfer protocol). Partial prepare-time admission pause across
environments IS observable and expected; what the protocol forbids is any **partial
ownership attribution** — no spend attributes to the new owner on any environment
until the app-wide publication point passes and that environment's new-owner lease
is granted, so neither account's hard limit is bypassed by a partially-transferred
app.

The account charged is the ownership attribution in force at the time (§Metering
identity and event contract). LLP 0105 P0.4 / Gate 0 must prove this bounds
account overshoot — including the **transfer-fence case** (old-owner leases
revoked/epoched, in-flight spend bounded, new-owner lease required before
post-cutover work) which 0105 Gate 1 also asserts — not merely calculate costs.

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

1. Reuse EAS Hosting request, CPU, and asset prices; add database storage. This
   reuse is **contingent on the Phase-0 write-amplification measurement** (LLP
   0105 P0.4 / Gate 0), not independent of it: because every mutation writes
   application rows plus version-counter, journal, subscription, and outbox rows
   in one `transactionSync` (LLP 0103 §Recommended topology), and DO SQLite bills
   row writes at 1000× row reads (LLP 0014), write amplification is structural,
   not hypothetical. If request/CPU pricing cannot cover write-heavy shapes, the
   legible logical **database write-unit** meter (§Margin gate) ships rather than
   raising unrelated prices. The database-storage price is likewise a gate output
   (see §Summary, §Margin gate), not a ratified number.
2. Market the strongest small reactive Expo bundle, not universal dominance.
3. Keep provider meters internal initially, with a trigger for one logical
   database-write meter.
4. Free hard-stops without charges or successful-data deletion.
5. Stable Expo ids at event emission are mandatory.

## Status

Accepted. This status accepts the specification's contract; it does not
ratify prices, quotas, provider facts, or other values that the document marks
as gate-pending. EAS, Cloudflare, and competitor figures are a 2026-07-28
snapshot and must be rechecked at launch.
