# LLP 0154: Minimal built-in observability and analytics

**Type:** RFC
**Status:** Accepted
**Systems:** Observability, Storage, Server, Admin console, CLI,
Hosted execution, Developer experience
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-08-02
**Revised:** 2026-08-15 (registry v3 adds the system elevated-read point class and named-count projection)
**Revised:** 2026-08-07 (LLP 0189 alignment sweep: the exact-current release/promotion authority is annotated as the D-7 per-claim carve-out, not the repo default). 2026-08-02 (v0.1, initial draft from the 2026-08-02 landscape
research pass: PostHog feature decomposition, backend-platform built-ins
survey, and the codebase substrate map)
**Revised:** 2026-08-02 (v0.2, author direction: programmatic agent access
is first-class, not a dashboard afterthought — D5 restructured into an
agent-facing query contract (routes as the contract, CLI/MCP as thin
clients, read-only SQL escape hatch) with the console as one more client)
**Revised:** 2026-08-02 (v0.3, round-1 super-refine — both families NOT
READY, run in design-partner mode at the author's direction; this is a
restructure, not a patch. Headline: the network SQL endpoint is deleted
(both families independently showed `PRAGMA query_only` is not an
authorization boundary — the hatch survives as a local-only CLI command
under a deny-by-default authorizer); retention/rollups fold into the
event-armed flush path after Fable showed LLP 0028 cron state persists
inside the app database; the C4 metering claim is replaced by a shared
observation envelope with three independently-reliable projections after
Codex showed the schemas were not actually compatible; telemetry is
reclassified as identity-derived application data (Codex BLOCKING);
`track()` moves to a root app-facing route as source-declared typed
events; the product splits into three phases with Usage and distinct-user
metrics deferred to the declared-events phase; events are
generation-bound to the app incarnation; the flush trigger is corrected
to max-age-from-first-buffered; a `lifecycle` kind is added; the MCP seam
is corrected to the control MCP's host-ops projection.)
**Revised:** 2026-08-02 (v0.4, round-2 super-refine — both families NOT
READY on v0.3, converging on the same defects from different angles.
Headline design changes, all adopted from review-partner proposals: the
observation primitive becomes a **two-stage span** (immutable admission
record + terminal completion, joined by observation id) with an explicit
per-class **projection matrix**, because LLP 0104 bills at admission,
before outcome exists (Codex BLOCKING); **typed telemetry operations**
replace HTTP routes as the cross-target contract, with routes, CLI, MCP,
console, and the hosted control plane as projections — resolving the
Cloudflare credential-locus contradiction both families found; **Phase 1
is subject-free** (the deferral of distinct-user metrics had already
removed its purpose); generation identity gets a durable protocol bound
to the existing reset-incarnation authority, and every read surface —
including the SQL hatch — reads through a current-generation
retention-window view; rollups become a watermarked state machine
(aggregate before delete, merge the unrolled tail, per-field exactness);
the boot-lifecycle/idle-gate contradiction is resolved with
post-provision-settle wording; the authorizer is restated as a new
deny-by-default policy inspired by — not identical to — Ibex's
allow-default-except precedent, and the rusqlite `hooks` note corrected
(already active transitively; declare it explicitly); a `log` kind
captures `runtime.log` output so the Logs page is honest; `_unmatched`
sentinel for patternless requests; Phase 1 strips all query strings; a
resource-safety envelope (C8) independent of commercial tiers; buffer
depth/drop counters joined to the LLP 0010 inspect surface; lifecycle
inventory closed as a Phase-1 allowlist.)
**Revised:** 2026-08-02 (v0.5, round-3 super-refine — both families NOT
READY on v0.4, with mostly disjoint residue converging on localized
repairs; both endorse the converged architecture and neither reopens it.
From Fable: dual timestamps (`ts_ms` stays the admission-bound
attribution time; a new `recorded_ts_ms` stamped at persistence drives
visibility, retention, ordering, freshness, and rollup bucketing — fixing
long-lived spans whose terminals were born outside the retention window),
an explicit `phase` column, `telemetry_meta` promoted to the single
read-boundary authority shared with the out-of-process hatch, and the
Cloudflare arm declared classification-only by default. From Codex: the
observation id demoted to correlation root with per-metric derived
LLP 0104 `eventId`s and the per-class billable rule replaced by an
operation-instance rule (job admission is not independently billable —
the invoked logical operation is), a monotonic retention floor making the
read-time boundary irreversible under config changes and clock rollback,
`stats` re-authorized as one consistent SQLite read (rollups ≤ watermark
plus visible raw rows above it; memory is an accelerator, never the
authority), rollups restructured as open hourly buckets finalized behind
the watermark and compacted into bounded historical tiers with per-field
exactness labels, `telemetry.export` added to the typed operations, and
the Phase-2 hosted projection specified as an operation gateway with its
own authorization envelope. Phase-1 IP capture is dropped entirely;
`gen_`/`obs_` grammar was restated locally because LLP 0148 was absent
from the loop's worktree at rounds 1–3 — it landed concurrently
mid-loop, and v0.6 corrects the wording.)
**Revised:** 2026-08-02 (v0.6, round-4 super-refine — focused delta
check, both families NOT READY on v0.5-introduced defects. Codex found
two BLOCKING algebra defects: the `stats` union omitted rows already
folded into a still-open hourly bucket (fixed: buckets open+finalized
cover rows at-or-below the watermark, the raw tail is strictly above it
— an exact coverage partition with response metadata); and the retention
floor only advanced at sweeps, so config transitions or clock rollback
between sweeps could resurrect hidden rows (fixed: the floor advances
durably at boot, every flush, and every retention-config transition,
and both boundary and timestamps derive from a persisted nondecreasing
observation clock, which also repairs the append-ordered-rollup claim
both families questioned). Tier coverage intervals, the daily-tier
horizon and eviction rule, and partial-window exactness labeling are
now explicit. Fable found the v0.5 restatement "LLP 0148 is not in this
checkout's ancestry" had become false — 0148 landed into the shared
worktree mid-loop — fixed by citing 0148 directly and making prefix
registration unconditional; plus the rollup phase filter and the
Cloudflare generation source, now stated.)
**Revised:** 2026-08-02 (v0.7, round-5 super-refine — spot-check split:
Fable READY (all v0.6 repairs sound, three wording residues), Codex NOT
READY with two real mechanism catches inside the v0.6 hunks, both
fixed: `telemetry_events.id` becomes `AUTOINCREMENT` because SQLite's
default rowid allocator reuses ids after deletes, which would let
post-reclamation rows fall at-or-below the durable watermark and vanish
from both sides of the stats partition; and the visibility predicate
becomes strict with `max_days = 0` making the views empty outright,
because an inclusive bound left rows stamped exactly at the observation
clock visible after a disable transition. Consistency residue both
families flagged is swept: one boundary formula stated in both places,
`observation_clock_ms` and the per-tier aggregate floors added to the
`telemetry_meta` sketch, the D1 rollup-view scoping corrected to tier
horizons (aggregates are subject-free, so outliving raw retention is
C5-consistent), eviction respecified as whole coverage intervals with
durable aggregate floors so partial windows report not-fully-covered,
and deliverable 1's prefix registration made unconditional.)
**Revised:** 2026-08-02 (v0.8, round-6 super-refine — spot-check split
again: Fable READY (second consecutive; all six v0.7 repairs sound, two
wording residues), Codex NOT READY on three findings inside the v0.7
hunks, all fixed: the observation clock now issues **strictly
increasing** stamps (`max(wall, high_water + 1)`), closing the
post-re-enable invisibility edge where a stamp could equal the captured
disable-floor under clock rollback; `max_days = 0` is defined as the
whole-subsystem off switch (both views empty while disabled, aggregates
reappearing on re-enable) and D7's "raw rows only" rule is scoped to
while-enabled, dissolving the plural-views contradiction both families
flagged; and the boundary formula gains its day→millisecond conversion
at both sites. Fable's remaining gloss residue (the D2 rollup-view
comment) is reworded to name the tier-horizon/aggregate-floor
boundary.)
**Revised:** 2026-08-02 (v0.9, round-7 super-refine — Codex-only
spot-check of the v0.8 hunks, NOT READY on three strictly-narrower
findings, all applied: strict clock issuance moved from per-row to
**per-flush-batch** (`max(wall, high_water + 1)` shared by the batch),
bounding clock drift to ≤ 1 ms per flush instead of unbounded at
> 1,000 rows/second while preserving the floor argument; the
floor-advance instruction gains its missing day→millisecond conversion;
the no-resurrection claim is scoped to **raw rows** with aggregates'
re-enable reappearance named as designed off-switch behavior. Loop
closed here under the corpus's asymmetric stopping rule: Fable READY in
rounds 5 and 6, Codex NOT READY in rounds 5–7 with monotonically
shrinking, fix-of-the-fix findings; these v0.9 repairs are applied
per Codex's own resolutions but are themselves unreviewed. The author
decides the status transition.)
**Revised:** 2026-08-02 (ACCEPTED by Charlie Cheever in the 2026-08-02
decision sitting — see `issues/20260802-author-decision-packet.md`. The
asymmetric stop is recorded honestly: Fable READY in rounds 5–6, Codex
NOT READY through round 7 with monotonically shrinking fix-of-the-fix
findings, v0.9 repairs applied per Codex's own resolutions but themselves
unreviewed; the author accepts on that record. Acceptance releases the
Phase-1 deliverables program (`issues/closed/20260802-obs-00-program.md`,
tickets obs-01..04); Phases 2–3 and the OQ2/OQ3 retention and identity
decisions remain gated as the document states.)
**Revised:** 2026-08-02 (dated amendment, post-acceptance — admission
identity representation, resolving the decision-packet question that
blocked obs-01 close/obs-02: **release identity becomes a fixed
`release TEXT` column** on `telemetry_events` (nullable — rows admitted
before any bundle activation carry NULL) and leaves the `details`
allowlist; D2 lists it first-class, the schema is schema-on-write by
design, LLP 0156's flusher needs it per-row in the hot upsert, and
identity fields must not be truncatable while `details` is.
**App/environment identity is store-implicit and meta-pinned**: the
sibling database is per-app/per-environment by D1 construction, so
`telemetry_meta` gains `app_id` and `environment`, written at store
creation and rebind — no per-row stamping (a constant column would add
only a way for rows to lie). `telemetry.export` stamps both meta fields
into the NDJSON at egress so exports are self-describing, and the
obs-02 shared telemetry/metering fixtures check projection equality on
the composed record (row + meta), with the metering projection taking
the same identity from the C7 envelope. Ruled with Charlie in the LLP
0156 promotion session working through the obs-02 block.)
**Revised:** 2026-08-02 (dated amendment, post-acceptance — local
environment identity source, resolving the remaining obs-01 production
binding: local telemetry store construction receives an explicit
environment identity threaded from `TargetDescriptor.environment_id`;
the lower-level identity seam carries `app_id` and `environment_id`
together. Telemetry does not infer environment identity from a database
path, process environment, `target_profile`, or a universal `"local"`
sentinel. A descriptor-owned identifier may itself be `"local"`, but is
opaque caller-supplied identity. The exact Rust API spelling and
compatibility plumbing are implementation details. Ruled by Charlie in
the 2026-08-02 side conversation and recorded in the author decision
packet.)
**Revised:** 2026-08-02 (dated implementation ratification, post-acceptance —
OQ1 is resolved against LLP 0104 by the versioned
`operation-class.v1.json` registry and the shared
`telemetry.projection-fixtures-v1.json` corpus. Production seams now admit
closed typed class ids through one registry-owned observation header before
the existing telemetry projection; the reliable metering projection remains
pure and transport-independent per C7. The exact projection, identity,
timestamp, event-id, retry/dedup, and billable-instance rules are recorded in
the OQ1 resolution below and the full deliverable-2 boundary corpus is pinned
in Store-level tests.)
**Revised:** 2026-08-02 (dated amendment, post-acceptance — the agent-first
export carrier is resolved per Charlie's direction in the author decision
packet. `telemetry.export` remains snapshot-bounded NDJSON for HTTP/CLI and is
also a required finite host-op/control-MCP projection. Each agent request
declares hard row and byte ceilings; each response reports the applied bounds,
exact page rows/bytes, and explicit truncation state, and carries an opaque
authenticated continuation token bound to the original filter, store
generation, app-DB incarnation, and frozen export header. Reset/rebind or
server restart refuses continuation instead of weakening the snapshot. The
D-05 error-contract amendment advances the internal operation registry to
`registryVersion: 2`, adds the LLP 0156 classifier vocabulary and D2's closed
failure-detail allocator, and pins classifier/carrier/fingerprint artifacts
before runtime or storage wiring.)
**Revised:** 2026-08-02 (dated implementation/evidence amendment,
post-acceptance — C2's bounded boot settle is witnessed by an internal
transaction sequence rather than a timestamp proxy, and deliverable 5's
retained receipt uses a non-self-referential source-commit/carrier-commit
protocol. The witness is excluded from every public typed projection and
visibility view; the carrier validator binds the measured clean ancestor,
the complete proof-source byte closure, and the exact receipt bytes tracked
at current HEAD.)
**Revised:** 2026-08-02 (dated D-05 store amendment, post-acceptance —
admission sequences, their durable high-water and exhaustion behavior,
fingerprint-rollout bounds, and the closed failure-stamp carrier are pinned
for LLP 0156 E1. The amendment also records branch-specific code/status
optionality, `subsystem`, malformed-stamp accounting, and the rule that the
ordinary telemetry redactor preserves allocator-owned failure fields without
reclassification.)
**Revised:** 2026-08-03 (Phase-1 implementation record — the local telemetry
kernel, agent-first query surfaces, console pages, guide, and retained evidence
carrier have landed. LLP 0156 E0/E1 local error tracking has also landed on
this substrate. Phases 2–3 remain deferred by phasing and unbuilt; LLP 0156 E2
alerting and E3 client crash ingest likewise remain deferred by phasing and
unbuilt.)
**Revised:** 2026-08-04 (the retained Phase-1 evidence was remeasured after
the wave-end source closure settled; the carrier protocol and frozen ceilings
are unchanged.)
**Revised:** 2026-08-04 (the retained Phase-1 evidence was remeasured at the
final post-fixture source closure; the carrier protocol and frozen ceilings
remain unchanged.)
**Revised:** 2026-08-06 (rolling trailing-head evidence amendment: historical
receipt integrity, ordinary-main currentness, and exact release/promotion
authority are now separate verdicts. Continuous source churn is accepted by a
coalesced latest-head full-proof lane without weakening any benchmark, idle,
or clean-source requirement.)
**Revised:** 2026-08-06 (LLP 0175 selector reconciliation: receipt-only changes
retain fast validation, telemetry/native source changes select feature smoke,
and full remint plus the exact-current validator remain separate. The dated
authority-wiring follow-up is resolved by the 2026-08-07 amendment below.)
**Revised:** 2026-08-07 (exact-current release authority lands: real candidate
publication gates the clean qualified candidate revision before registry
mutation, and default-tag promotion gates the candidate ledger's frozen
revision before authority acquisition. Both durable receipts retain the
assessment; capability-maturity records still consume no telemetry evidence.)
**Related:** LLP 0000 (root explainer; points the shipped local Phase-1
surface here), LLP 0003 (storage core; app write lane), LLP 0010 (inspect
loop; explicitly defers production observability), LLP 0012 (headless
integration contract; registers the diagnostics dialect), LLP 0013
(ephemeral realtime state; bounded-loss-must-be-observable precedent),
LLP 0017 (admin console serving model), LLP 0024 (host operations; the
one-core/thin-projections rule this RFC's query contract follows), LLP
0028 (cron; considered and rejected for telemetry maintenance), LLP 0031
(route taxonomy and response sensitivity; `AdminSecretRead`), LLP 0035
(idle benchmark; the zero-writes invariant), LLP 0047 (execution limits),
LLP 0071 (abuse/moderation audit), LLP 0072 (control-plane structured
logs and credential custody), LLP 0104 (hosted metering; shared
observation span, separate sinks), LLP 0110 (bounded children and
activity patterns; the durable activity-row contrast), LLP 0148
(prefixed identifier grammar), LLP 0156 (local E0/E1 error tracking layered on
the telemetry substrate; later alerting and client-ingest phases remain
separate)

## Summary

Snapback today persists essentially no runtime telemetry: there is no
`tracing`/`log` crate, `crates/snapback/src/server.rs` contains two `eprintln!` calls in
~44k lines, and the only introspection is the LLP 0010 inspect loop, which
its own spec frames as "not a production observability replacement."
LLP 0000 lists Observability as a named, not-yet-drafted subsystem, and
`guide/capabilities.md` has no row for it — not even a GAP row.

This RFC proposes the deliberately minimal layer, in three phases:

- **Phase 1 — the observability kernel.** A **telemetry sibling SQLite
  database** next to the app database, generation-bound to the app
  incarnation by a durable protocol; system events captured as
  **two-stage observation spans** (admission + terminal) at a handful of
  server seams, classified by a **versioned operation-class registry**
  with an explicit projection matrix; **batched, event-driven writes**
  with priority-aware shedding; retention and watermarked rollup
  maintenance folded into the flush path (no cron); **typed telemetry
  query operations** as the agent-first contract — projected onto
  admin routes, CLI, and the control MCP — with two fixed console pages
  (**Health**, **Logs**) as one more projection; a **local-only SQL
  hatch** in the CLI under a deny-by-default authorizer; NDJSON export.
  Phase 1 is **subject-free**: no user identity is persisted.
- **Phase 2 — hosted arms.** The container-VM arm verbatim; the
  Cloudflare arm via Workers Analytics Engine with query operations
  served by the control plane (which holds the credential), honestly
  marked partial, every response carrying per-field
  exactness/sampling/freshness facts.
- **Phase 3 — declared product analytics.** Source-declared, typed app
  events (`defineTelemetry`), the identity/deletion policy that
  distinct-user metrics require, and the **Usage** page over
  deletion-compatible mergeable aggregates.

Agents are a primary consumer, not an afterthought: everything the
dashboards can show is queryable programmatically, and more.

The scope line, drawn from the landscape research: **fixed dashboards over
pre-aggregated rollups are in scope; ad-hoc analytical slicing is not.**
Funnels, paths, session replay, experiments, and arbitrary breakdowns over
long raw-event history are what push PostHog to ClickHouse and Supabase to
BigQuery — and they are already outside Snapback's stated non-goals
(`llp/0000-snapback.explainer.md`, "Analytics / data-warehousing
workloads"). For those, apps should use a dedicated tool (PostHog,
Amplitude); for client-side performance (launch time, TTR/TTI), Expo
Observe. Snapback's built-in layer answers the questions every app has on
day one — is my server healthy, what happened, is anyone using this — with
zero additional infrastructure.

## Motivation

1. **Agent DX.** Agents building and operating Snapback apps currently have
   no way to answer "did that request fail, and why, and how often" without
   reproducing it live. The LLP 0010 inspect loop covers the current
   instant; nothing covers the recent past. Convex's per-function metrics
   (invocations, errors, p50–p99 execution time) are among its most-used
   surfaces for exactly this reason.
2. **Operator confidence.** An app deployed to the Cloudflare or hosted
   container-VM arms is a black box today beyond the LLP 0072 log surface
   (`snapback hosted logs`), which is scoped to control-plane and
   supervisor concerns rather than app-behavior queries.
3. **Basic product signal.** "How many people used my app this week" is a
   day-one question for every app. Only Firebase answers it built-in (via a
   bundled GA4 property stored in Google's infrastructure, not yours);
   PocketBase, Supabase, and Convex all stop at backend observability.
   Snapback can answer the basic form of it unusually cheaply because it
   already owns identity — though the anonymous-to-authenticated linking
   and deletion policy that honest distinct-user metrics require is real
   work, which is why user-visible analytics is Phase 3, not Phase 1.
4. **Metering synergy.** LLP 0104 (Accepted) needs a database write-unit
   meter and defines an append-only usage-event contract with shadow
   meters. The instrumentation seams this RFC adds are largely the same
   seams metering needs. The seams and the classification vocabulary are
   shared; the transports and reliability contracts deliberately are not
   (C7).

## Landscape findings (evidence)

From the 2026-08-02 research pass (PostHog docs/handbook, PocketBase
source, Supabase/Convex/Cloudflare/Expo docs). This pass produced no
separate research LLP; this section is its record, and the external
figures below carry that date. The design does not stand or fall on their
exact values.

- **PocketBase** is the existence proof of the minimal shape. Its entire
  observability surface is a `_logs` table in a separate `auxiliary.db`
  SQLite file (WAL, own connection pools, a write pool pinned to one
  connection) so log writes never contend with app data and app backups
  stay clean. Request logs are written by middleware and flushed in
  batches of 200 rows or after 3 seconds of inactivity; string fields are
  size-capped; retention defaults to 5 days (`MaxDays`, 0 = disabled)
  enforced by a 6-hourly SQL `DELETE` cron. The admin UI is one
  requests-over-time chart plus a filterable log list. That is the whole
  product, and it is widely considered enough.
- **Convex** ships a health page (failure rate, cache hit rate), four
  per-function charts (invocations/min, errors, cache hit rate, execution
  time at p50/p90/p95/p99, ~1-hour windows), and an *ephemeral* log
  buffer; durable logs require streaming to Axiom/Datadog/PostHog on the
  paid plan. Lesson: percentile latency per function is the highest-value
  metric after raw counts, and short in-platform retention with an export
  path is a defensible position.
- **Supabase** is strictly backend observability (infra reports + SQL logs
  explorer) backed by a heavy Logflare → BigQuery/ClickHouse pipeline;
  free-tier retention is one day. The pipeline weight is what serving
  *ad-hoc SQL over logs* costs.
- **PostHog**'s deliberately simple mode ("Web Analytics") is one fixed
  dashboard over a single event stream: visitors, views, sessions, bounce
  rate, top pages, referrers/UTMs, device and geo breakdowns, one weekly
  retention tile. Its Kafka + ClickHouse machinery exists to serve
  *ad-hoc* funnels/breakdowns over billions of events — the feature class
  this RFC excludes. Anonymous-by-default identity with an explicit
  identify step is also a pricing lever there (identified events cost ~4x).
- **Cloudflare Workers Analytics Engine** is the proven minimal design for
  *developer-defined* analytics: `writeDataPoint({blobs, doubles,
  indexes})` into a fixed-column store, non-blocking writes, SQL-only
  query surface, 3-month retention, adaptive sampling. Its fixed-column,
  capped-cardinality event shape maps naturally onto a dedicated SQLite
  file.
- **Expo Observe** covers client-side performance (cold/warm launch,
  TTR/TTI, per-route metrics, custom events as OTel log records, 90-day
  retention). Snapback should point at it rather than rebuild it.
- **Retention norms:** raw logs live 1–7 days on free tiers everywhere
  (Supabase 1d, Cloudflare 3–7d, PocketBase 5d, Convex
  minutes-to-hours); ~90 days is the premium ceiling. Nobody keeps raw
  telemetry long-term in-platform; long retention is always an export
  path.

## Substrate constraints (what the design must honor)

- **C1 — The app write lane.** App-database writes go through one
  serialized write connection; mutation commits that change rows bump
  `_snapback_version`, append to `_snapback_changes`, and run the
  live-query matcher (`crates/snapback/src/storage.rs`, @ref LLP 0003#database-model; a
  few internal transaction paths, e.g. asset-system commits, bypass the
  journal). Telemetry written to the app database would contend for that
  writer on every request and — for declared tables — ride journaling and
  fan-out matching. Telemetry therefore lives **off** this lane entirely.
- **C2 — Idle means zero, after settle.** The measured idle-instance
  property — zero disk writes over a 120s window on a provisioned
  instance (LLP 0035), observed-zero Cloudflare billing over a quiet
  7,200s window (`llp/0000-snapback.explainer.md`) — is preserved
  evidence. Every telemetry write, sweep, checkpoint, and rollup is
  armed only by event arrival: no heartbeat, no timer that fires while
  idle. Boot and activation are themselves observations (D2 `lifecycle`),
  so provisioning produces one bounded **settle write** (the boot flush,
  drained within the D3 max-age); after settle, an untouched instance
  writes nothing. The deliverable-5 acceptance gate measures the idle
  window from after settle, and separately asserts the settle write is
  bounded and terminal.
- **C3 — The analytics non-goal.** The explainer excludes "high-frequency
  write firehoses" and "analytics / data-warehousing workloads." This
  layer must stay on the app-facing side of that line: fixed dashboards,
  bounded write volume, short raw retention.
- **C4 — One observation span, shared seams.** The instrumentation seams
  emit a two-stage **observation span** (D2): an immutable admission
  record and a terminal completion, joined by observation id, classified
  by a versioned operation-class registry. LLP 0104 metering, LLP 0072
  structured hosted logs, and this RFC's telemetry store are
  *projections* of that span — same classification vocabulary, same
  correlation identifiers, independently owned delivery contracts (C7),
  with an explicit per-class projection matrix (D2) declaring which
  record each sink consumes and which single record is billable. The
  seams are built once.
- **C5 — Telemetry is identity-derived application data, out of band.**
  The store contains route paths, user agents, diagnostic details (which
  per `crates/snapback/src/diagnostic.rs` may carry source paths, handler text, and
  arguments — operator-only context), captured `log` output, and later
  app-defined properties. It is **sensitive** under LLP 0031's
  classification (`SensitiveApplicationData` explicitly includes handler
  errors, source, arguments, correlation data) and is handled as such:
  the read surfaces split by sensitivity (D5 — aggregates are a closed
  `OperatorMetadata` projection; raw events require `AdminSecretRead`
  leases), scrubbing and an allowlist/redactor at admission (D2),
  restrictive file permissions, and deletion semantics (D1 generations;
  Phase 3 subject deletion). Phase 1 persists **no stable application
  subject identifier and no IP addresses** — the `subject` column exists
  in the schema but is invariantly NULL until Phase 3's identity policy,
  and there is no Phase-1 IP knob at all. What C5 does *not* mean:
  telemetry is excluded from the LLP 0104
  billed logical-bytes basis, from LLP 0007 backup/portability, and from
  app exports — out of the customer-data *accounting*, not out of the
  customer-data *duty of care*.
- **C6 — Route and console conventions.** Admin query surfaces live under
  `/_snapback/api/*`; app-client-facing surfaces live at the root under
  app credentials; no route is both (LLP 0031). Every new route lands
  with its LLP 0031 registry row (path class, credential resolution,
  response sensitivity). Console pages are clients of the same
  operations (LLP 0017).
- **C7 — Shared seams, separate transports.** Telemetry may shed;
  metering may not. The loss-tolerant buffer (D3) is telemetry's
  transport only. Bill-grade events take a non-shedding, idempotent,
  deduplicated path per LLP 0104; structured hosted logs take LLP 0072's
  bounded channel with its own drop accounting. Loss-tolerant telemetry
  must never supply billable totals — LLP 0104 itself already forbids
  sampled observability stores as billing authority.
- **C8 — A resource-safety envelope, independent of commercial tiers.**
  Whatever LLP 0104-process entitlements arms later adopt, the telemetry
  subsystem itself enforces validated hard bounds: a `max_days` ceiling,
  a telemetry file-size cap covering main+WAL (shed-on-full, counted,
  and a shed-at-cap cycle still arms maintenance so the file self-heals
  under pressure rather than only at boot), rollup budgets — per-hour
  name cardinality *and* a total rollup row budget enforced by the D7
  historical tiers — per-query work budgets (rows, steps, time), and
  per-event byte caps. "Operator-free" local configuration means no plan
  gate, not unbounded storage (C3).

## Design

### D1 — Telemetry store: a sibling SQLite database, generation-bound

A second SQLite file next to the app database:

```
.snapback/dev.sqlite3            # app data (unchanged)
.snapback/dev.sqlite3.telemetry  # telemetry (new)
```

Properties:

- Own write connection (WAL, `busy_timeout`, `synchronous = NORMAL` — a
  lost telemetry batch on power failure is acceptable; a slowed app write
  lane is not). No `ReaderPool` integration with the app database. WAL
  mints `.telemetry-wal`/`.telemetry-shm` siblings; every path that
  manages the telemetry file manages all three.
- The filename deliberately does not match `*.sqlite3`, which reduces the
  chance of accidental inclusion by suffix-keyed tooling; the normative
  exclusions (below) do not depend on the name. The managed-sibling
  pattern follows the existing config-store precedent
  (`dev.sqlite3.config.json`, `crates/snapback/src/config.rs`).
- **Not** attached to app storage: telemetry tables do not appear in the
  schema surface, are not queryable by app functions or live queries, do
  not ride `_snapback_changes`, and are excluded from LLP 0007
  backup/restore and the LLP 0104 logical-bytes meter (C1, C5).
- File permissions restrict to the owning user (C5); the file is absent
  until the first observation is written — on a provisioned instance
  that means the boot settle write (C2).
- **Store identity is explicit, not inferred.** Local construction threads
  the authoritative `TargetDescriptor.environment_id` into the telemetry
  store, whose lower-level identity seam carries it together with `app_id`.
  Database paths, process environment, and `target_profile` are not identity
  authorities, and telemetry does not mint a universal local sentinel. An
  authority may supply `"local"` as an actual opaque environment identifier;
  that is distinct from telemetry inventing one. Creation and rebind pin this
  caller-supplied pair in `telemetry_meta`.
- **Generation identity is a durable protocol, not a trigger list.**
  Every event row carries a `generation` (`gen_`-prefixed per the LLP
  0148 grammar). The protocol:
  - The app database already carries a durable incarnation rotated
    inside the reset transaction (the authorization-stream incarnation
    with its committed successor witness and publication fence,
    `crates/snapback/src/storage.rs` / `crates/snapback/src/server.rs`). The telemetry generation is
    **bound to that authority**: a `telemetry_meta` table in the
    telemetry file persists the current `generation` together with the
    app-database incarnation identity it belongs to.
  - At boot, the pair is compared: app-DB incarnation mismatch (reset
    happened, restore happened, or the file was replaced out of band) ⇒
    mint a fresh generation and record the new binding. Match ⇒ keep the
    current generation. A plain restart therefore preserves history;
    out-of-band replacement is *detected*, not hooked.
  - The reset/restore fence (D3) clears the buffer before new
    admissions; in-flight batches from the old generation may still
    land, which is why visibility is filtered, not raced: **every read
    surface — typed operations, CLI, export, and the SQL hatch — reads
    through visibility views only** (`telemetry_events_visible` for raw
    rows, `telemetry_rollup_visible` for aggregates), each scoped to
    the current generation — the raw view additionally bounded by the
    read-time retention boundary (D4), the rollup view by the D7 tier
    horizons (aggregates are classification-only and subject-free in
    Phase 1, so outliving raw retention is C5-consistent) — and
    the hatch's authorizer denies every base table. **`telemetry_meta`
    is the single read-boundary authority**: it durably holds the
    current generation, the app-DB incarnation binding, the mirrored
    `max_days` (refreshed at boot and on config change), and the
    monotonic retention floor (D4) — so the in-process server and the
    out-of-process CLI hatch agree on generation *and* retention with
    zero coordination. Old-generation rows are swept opportunistically
    by D4 maintenance.
  - Crash matrix (normative): admission stamps the in-memory current
    generation; a crash between app-DB reset commit and telemetry
    rebind is healed at next boot by the pair comparison (the stale
    generation's rows become invisible); a crash mid-flush loses at most
    one buffered batch (acceptable, counted at next boot as an unclean
    predecessor `lifecycle` event); restore rebinds like reset.
- Deleting the telemetry file (all three siblings) remains safe at any
  time — it is regenerated on next write.

### D2 — The observation span, classification registry, and Phase-1 kinds

Each instrumented seam emits a two-stage **observation span** (C4):

- **Admission record** (immutable, written when the operation is
  admitted): observation id (unique — the **correlation root**, not a
  bill-event id; see the identity rule below), operation class +
  **registry version**,
  app/environment identity (store-scoped: pinned in `telemetry_meta`
  per the 2026-08-02 amendment, not stamped per row), `generation`,
  release identity (function-bundle hash / deployment id — the fixed
  `release` column), admission time `ts_ms`
  (the attribution-bound timestamp per LLP 0104's admission-bound
  `occurredAt` discipline), correlation (request/job/connection id), and
  attribution fields the metering projection needs (ownership interval
  per LLP 0104).
- **Terminal completion** (joined by observation id): outcome status,
  `duration_ms`, Diagnostic `code` when the operation terminated with
  one.

**Identity rule (normative).** The observation id is the correlation
root shared by all projections. It is **not** the LLP 0104 `eventId`:
one operation instance can yield several metering facts (request, CPU,
transfer, shadow meters), each of which is its own 0104 usage event.
Bill-grade event ids are **derived deterministically** as
`(observation_id, metric_id, stage, schema_version)`, which keeps
retries idempotent per metric without collapsing distinct meters into
one event. Identifiers follow LLP 0148 (Accepted, in-tree): `obs_` and
`gen_` under its grammar with random 26-char Crockford-base32 bodies.
LLP 0148 requires every identifier kind to be a registry row, and
neither prefix is registered yet — Phase 1 adds the `Observation` and
`Generation` rows unconditionally (deliverable 1).

**Projection matrix (normative skeleton; OQ1 ratifies the full table
against LLP 0104's classification):**

| operation class        | telemetry (lossy)          | metering (reliable)        | hosted logs (LLP 0072) |
|------------------------|----------------------------|----------------------------|------------------------|
| logical call (function_run) | joined row at terminal | **admission = billable**   | terminal, redacted     |
| transport request (http_request) | joined row at terminal | not billable (carrier of a logical call; billable only when it maps to no logical call, per the registry) | terminal, redacted |
| live subscription      | admission + terminal rows  | admission (subscription meter) | lifecycle only     |
| realtime frames        | **counters only (D7)**     | frame meter (counters)     | none                   |
| job run                | joined row at terminal     | scheduler admission **not** independently billable; the invoked logical operation is the billable instance (per LLP 0104's accepted-operation basis) | terminal |
| lifecycle              | single row                 | not billable               | mirrored               |
| log line               | single row (capped)        | not billable               | per LLP 0072 policy    |
| elevated read          | two named point counters per executed read | not billable | none |

**Billable-instance rule:** billing is per accepted *operation
instance*, not per record or per class — each operation instance yields
exactly one set of derived metering events (identity rule above), a
carrier request whose logical call is billed is itself not, and a
scheduler admission is not billed separately from the operation it
invokes. No path may double-count a job/action or a carrier/logical
pair; the OQ1 fixture proves it. The registry is versioned and the
version is stamped on every persisted row, so a class-table change never
reinterprets old rows.

The telemetry projection persists spans as fixed columns —
schema-on-write, capped sizes, no per-app migrations:

```sql
CREATE TABLE telemetry_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,  -- non-reusing: the
                                      -- watermark partition needs ids that
                                      -- never fall back below a durable
                                      -- watermark after full reclamation
  observation    TEXT NOT NULL,           -- span correlation root (obs_…)
  phase          TEXT NOT NULL,           -- 'point' | 'admission' | 'terminal' | 'joined'
  generation     TEXT NOT NULL,           -- D1 binding (gen_…)
  class_v        INTEGER NOT NULL,        -- registry version
  ts_ms          INTEGER NOT NULL,        -- admission time (attribution, LLP 0104)
  recorded_ts_ms INTEGER NOT NULL,        -- persistence time (observation)
  flush_sequence INTEGER NOT NULL DEFAULT 0, -- internal transaction witness;
                                             -- never a public projection field
  kind           TEXT NOT NULL,
  name           TEXT NOT NULL,
  status         INTEGER,
  duration_ms    REAL,
  subject        TEXT,                    -- invariantly NULL until Phase 3 (C5)
  code           TEXT,                    -- Diagnostic code, when failed
  correlation    TEXT,
  release        TEXT,                    -- bundle hash / deployment id
                                          -- (fixed column per the 2026-08-02
                                          -- amendment; NULL before first
                                          -- activation; never in details)
  details        TEXT                     -- JSON, allowlisted + capped
);
-- all raw reads go through this view (D1); rollup reads use
-- telemetry_rollup_visible with the same generation scoping but its
-- own tier-horizon/aggregate-floor boundary (see trailing note):
CREATE VIEW telemetry_events_visible AS
  SELECT id, observation, phase, generation, class_v, ts_ms,
         recorded_ts_ms, kind, name, status, duration_ms, subject,
         code, correlation, release, details
  FROM telemetry_events
  WHERE generation = (SELECT generation FROM telemetry_meta)
    AND (SELECT max_days_mirror FROM telemetry_meta) > 0  -- disabled ⇒ empty
    AND recorded_ts_ms > /* strict: the read-time boundary from
                            telemetry_meta (the ONLY formula, D4):
                            max(observation_clock − max_days*86_400_000,
                                retention_floor) */;
-- rollup reads use telemetry_rollup_visible: same generation scoping
-- and the same disabled-guard, but bounded by the D7 tier horizons and
-- aggregate floors, NOT by max_days (D1, D7).
```

### Amendment 2026-08-02: internal flush witness and retained evidence carrier

C2's settle gate must prove a storage transaction, not infer one from
`recorded_ts_ms`: equal timestamps can cover different commits, and one
commit must not be inferred as several merely because a surrogate timestamp
changed. `telemetry_meta` therefore has an internal
`flush_commit_sequence INTEGER NOT NULL DEFAULT 0`; every committed telemetry
flush increments it inside that flush's SQLite transaction, and every event
inserted by the transaction receives the resulting value in the internal
`telemetry_events.flush_sequence` column shown above. A rollback advances
neither authority. Additive migration deliberately leaves historical rows at
zero, meaning “no transaction witness”; it does not fabricate provenance for
pre-amendment rows.

These two columns are implementation/evidence authority only. They are absent
from `telemetry_events_visible`, the bounded SQL hatch, all D5 typed operation
schemas, export records, host-op/control-MCP projections, and console models.
The C2 acceptance starts from a fresh sibling store and requires exactly one
event-bearing sequence, `flush_commit_sequence = 1`, and both
`process_start` and `process_ready` stamped with `flush_sequence = 1`, with
the already-bounded startup row count. Any second committed flush before the
idle window is an implementation failure, not accepted measurement noise.

Deliverable 5 retains its measured JSON receipt without asking a Git commit
to contain its own hash. The protocol has two stages:

1. At a clean source commit **S**, the full gate builds the release binary,
   verifies its embedded identity is S, executes the benchmark and idle
   witnesses, and emits a candidate receipt carrying `sourceRevision = S`
   plus a length-framed SHA-256 over the enumerated proof-source closure.
2. A later carrier commit **P** adds that receipt and may record completion in
   non-proof-source documentation. Reopening the retained receipt requires S
   to be an ancestor of current HEAD, no enumerated proof-source path to have
   changed between S and current HEAD, the current source files to reproduce
   the receipt's exact file list and digest, and the receipt's working-tree
   bytes to equal the tracked bytes at current HEAD.

Thus P does not pretend its unexecuted hash was measured, while any production,
benchmark, baseline, launch/identity harness, todo/codegen input, or validator
change makes the receipt stale and requires a new clean full run. The retained
carrier itself is checked as committed evidence, not trusted merely because a
JSON file exists in a working tree.

**Two timestamps, two jobs (normative).** `ts_ms` is the admission-bound
attribution timestamp — the span's LLP 0104-aligned identity, shared by
all records of the span. `recorded_ts_ms` is stamped when the record is
persisted and drives everything observational: visibility, retention,
`telemetry.events` ordering, the freshness watermark, and rollup
bucketing. It is read from the **observation clock** — a persisted clock in
`telemetry_meta` that issues **strictly increasing per-flush-batch**
stamps: each flush batch takes one stamp `max(wall clock,
high_water + 1)` shared by all rows in the batch, and the high-water
advances at every flush and boot. Batch granularity bounds drift: the
clock can run ahead of wall time by at most 1 ms per flush (flushes are
≥ 3 s apart or 256 rows), so sustained load cannot push
`recorded_ts_ms` into future query ranges the way per-row increments
would above 1,000 rows/second; within a batch, ordering is
`(recorded_ts_ms, id)` with ids strictly increasing. Strict issuance
(not merely nondecreasing) matters at the retention boundary: the floor
only ever captures a past clock value, so every later batch stamp
strictly exceeds every captured floor — re-enabling after a disable is
visible immediately even if wall time still lags the clock. Monotone
stamps also mean freshness never regresses, event cursors never
re-sort, and under wall-clock rollback new rows land in the current
open bucket, never inside an already-finalized hour. Without the timestamp split, the terminal record of a long-lived
span (a week-old websocket's disconnect) would be born outside the
retention window and invisible the moment it was written. A long span's
terminal therefore aggregates into the hour it *ended* — accepted, and
with the monotone clock the rollup watermark is genuinely
append-ordered (D7). The `phase` column
makes the span stage explicit rather than inferred from NULL status:
short-lived classes persist one `joined` row at terminal; long-lived
classes (`ws_connect`, `live_subscribe`) persist `admission` and
`terminal` rows; `lifecycle`/`log`/`diagnostic` persist `point` rows.
`telemetry.stats` counts `point`/`joined`/`terminal` rows only.

The `subject` column is deliberately **invariantly NULL in Phase 1**
(C5): the distinct-user metrics that would need it are Phase 3, so Phase
1 carries correlation ids only.

Phase-1 `kind` values, each mapped to one existing server seam:

| kind             | seam                                        | notes                                    |
|------------------|---------------------------------------------|------------------------------------------|
| `http_request`   | one layer in the axum router                | `name` = route *pattern*; requests that  |
|                  |                                             | match no pattern get the fixed sentinel  |
|                  |                                             | `_unmatched` (raw path only in capped    |
|                  |                                             | `details`, low priority — scanner floods |
|                  |                                             | shed first by construction)              |
| `function_run`   | around handler invocation                   | queries, mutations, actions              |
| `live_subscribe` | subscribe/resume admission                  | subscription lifecycle, not per-frame    |
| `ws_connect`     | stream attach/detach                        | connect, disconnect, cause               |
| `job_run`        | cron/job terminal seam (`crates/snapback/src/cron.rs`)      | the existing terminal seam already       |
|                  |                                             | carries identity/outcome/duration        |
| `lifecycle`      | closed Phase-1 allowlist, below             | the deploy markers agents correlate      |
|                  |                                             | regressions to                           |
| `log`            | the existing `runtime.log` host call        | authored handler output, size-capped,    |
|                  | (`crates/snapback/src/runtime.rs`)                          | low priority, C5 operator-only           |
| `diagnostic`     | the **emission boundary** only              | see below                                |
| `elevated_read`  | trusted `ctx.db.elevated` host read seam    | two point names: function and member; no handler arguments or row data |

**Lifecycle allowlist (closed for Phase 1):** process start/ready,
release (bundle) activation, migration success/failure, reset/restore
generation rotation, detected unclean predecessor, graceful shutdown.
Config changes and secret rotations stay in the control-plane audit
(LLP 0072); at most a non-sensitive version/digest marker may be
emitted. Additions to this list are registry-version changes.

**The diagnostic seam is the emission boundary, not construction sites.**
Diagnostics are constructed pervasively as typed refusal values (hundreds
of sites); most are returned as ordinary refusals already captured by the
owning span's `code`. A standalone `diagnostic` event exists only for
Warning+ diagnostics not attached to any in-flight operation (background
failures, terminal anomalies — e.g. today's two `eprintln!` sites).
Severity names follow `DiagnosticSeverity` as it exists:
`Info`/`Warning`/`Error`/`Fatal` (`crates/snapback/src/diagnostic.rs`); the `min_level`
knob uses those names.

**Operation-class exclusions.** The registry declares which classes count
as application usage. Health probes, console polling, the telemetry
operations themselves, static asset serving, and internal maintenance
are disposition `system` and excluded from usage metrics by default
(still visible in Logs). Without this, the dashboard observes its own
polling.

Caps and scrubbing at admission (C5): URL ≤ 3000 bytes with **all query
strings stripped in Phase 1** (declared-safe parameters arrive with
Phase 3's declaration mechanism), user-agent/referer ≤ 2000, `details`
≤ 8 KiB serialized and passed through a field **allowlist/redactor** —
not merely a byte cap — before persistence. `details` carries no
request/response bodies; for `diagnostic` and `log` rows it may carry
operator-only context (source paths, handler text) under the redactor,
which is C5-sensitive content served only under the D5 raw-read
authority. No IP persistence in Phase 1, and no knob for it — if IP
capture ever arrives it is a Phase-3 decision made with the identity
policy (C5).

### Amendment 2026-08-15: elevated-read point class

The compatible `operation-class.v1.json` artifact family advances its internal
`registryVersion` from 2 to 3. Registry v3 additively publishes the system
class `runtime.elevated-read`, telemetry kind `elevated_read`, point
projection, and no metering rules. The trusted runtime host seam emits two
point records after each non-empty elevated database read has reached storage:
`function:<name>` and `member:<query|get|getMany|uniqueMany>`. Thus the existing
bounded `telemetry.stats` named-count projection answers totals along both
dimensions without a new endpoint. Ordinary reads, rejected descriptors, and
empty batch reads emit neither record.

The optional `SNAPBACK_ELEVATED_READ_TRACE=/path/to/file.jsonl` process setting
adds a JSONL trace event for the same seam with function, member, table,
invocation mode, correlation, and a process-monotonic timestamp. It captures
no handler arguments, row data, or policy conclusion. A missing or empty
setting disables the file trace; telemetry counting remains active when the
ordinary invocation telemetry sink is installed.

### Amendment 2026-08-02: error-classifier vocabulary and failure-details allocation

LLP 0156 E0/E1 advances the operation-class registry's internal
`registryVersion` from 1 to 2 while retaining the compatible artifact-family
filename and format, `schemas/operation-class.v1.json` with
`artifactVersion: 1`. The class rows and usage-event schema do not change.
Registry v2 additively publishes one `failureClassifier` vocabulary containing
`classifierVersion: 1`, carrier categories `diagnostic`, `app_refusal`,
`exception`, and `transport`, dispositions `fault`, `app_refusal`,
`caller_error`, `cancellation`, `timeout`, and `overload`, the ordered
first-match arms from LLP 0156 E0.1, and the following closed platform-code
memberships:

- cancellation: `SNAPBACK_ACTION_STREAM_CANCELLED`,
  `SNAPBACK_AUTH_RESERVATION_CANCELLED`, `SNAPBACK_MIGRATION_CANCELLED`,
  `SNAPBACK_OPERATION_CANCELLED`;
- timeout: `SNAPBACK_ACTION_STREAM_IDLE_TIMEOUT`,
  `SNAPBACK_ACTION_STREAM_TIMEOUT`, `SNAPBACK_ACTION_TIMEOUT`,
  `SNAPBACK_AUTH_MODE_QUIESCENCE_TIMEOUT`,
  `SNAPBACK_HANDLER_DID_NOT_SETTLE`,
  `SNAPBACK_HANDLER_WALL_CLOCK_EXCEEDED`;
- overload: `SNAPBACK_ACTION_CAPACITY_EXCEEDED`,
  `SNAPBACK_ACTION_PROGRESS_RATE_EXCEEDED`, `SNAPBACK_AUTH_THROTTLED`,
  `SNAPBACK_BUNDLE_PENDING_CAPACITY`, `SNAPBACK_BUNDLE_RATE_LIMITED`,
  `SNAPBACK_CLIENT_MUTATION_RETENTION_FULL`,
  `SNAPBACK_CRON_DISPATCH_CAPACITY_EXCEEDED`,
  `SNAPBACK_CRON_RUN_CAPACITY_EXCEEDED`, `SNAPBACK_EPHEMERAL_RATE_LIMITED`,
  `SNAPBACK_LIVE_STAGE_CAPACITY`, `SNAPBACK_OVERLOADED`,
  `SNAPBACK_SUBSCRIPTION_CONNECTION_LIMIT`, and
  `SNAPBACK_SUBSCRIPTION_GLOBAL_LIMIT`;
- caller error: `SNAPBACK_ACTION_STREAM_INVALID`,
  `SNAPBACK_ACTION_STREAM_LIMIT_EXCEEDED`, `SNAPBACK_ARG_MISSING`,
  `SNAPBACK_AUTH_AUTHORITY_CREATING_UNCONSENTED`,
  `SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY`,
  `SNAPBACK_AUTH_GRANT_SCOPE_DENIED`, `SNAPBACK_AUTH_MUTABLE_INPUT_DENIED`,
  `SNAPBACK_AUTH_PERMISSION_DENIED`, `SNAPBACK_AUTH_REQUIRED`,
  `SNAPBACK_AUTH_SCOPED_TOKEN_INVALID`,
  `SNAPBACK_BUFFERED_WRITE_LIMIT_EXCEEDED`, `SNAPBACK_CTX_LEDGER_EXHAUSTED`,
  `SNAPBACK_CTX_LEDGER_LIMIT_EXCEEDED`, `SNAPBACK_EXPECTED_STRING`,
  `SNAPBACK_FIELD_MISSING`, `SNAPBACK_FIELD_TYPE_MISMATCH`,
  `SNAPBACK_FUNCTION_ARGS_CONTRACT_VIOLATION`,
  `SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED`,
  `SNAPBACK_HANDLER_CAPABILITY_DENIED`, `SNAPBACK_HANDLER_WRITE_IN_QUERY`,
  `SNAPBACK_INVALID_FLOAT`, `SNAPBACK_INVALID_IDENTIFIER`,
  `SNAPBACK_QUERY_FILTER_BINDINGS_EXCEEDED`,
  `SNAPBACK_QUERY_FILTER_VALUE_INVALID`,
  `SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED`,
  `SNAPBACK_QUERY_IN_ITEMS_EXCEEDED`, `SNAPBACK_QUERY_LIMIT_INVALID`,
  `SNAPBACK_REQUEST_BODY_TIMEOUT`, `SNAPBACK_REQUEST_JSON_INVALID`,
  `SNAPBACK_UNKNOWN_FIELD`, `SNAPBACK_UNKNOWN_FUNCTION`,
  `SNAPBACK_UNKNOWN_TABLE`, and `SNAPBACK_VALUE_TOO_LARGE`.

The 4xx rule applies only to a transport carrier with no admitted logical
platform code; an exception such as `SNAPBACK_HANDLER_FAILED` or
`SNAPBACK_UNHANDLED_REJECTION` remains residual `fault` even if a legacy
surface projects it as HTTP 400. The unmatched-route rule reads the admitted
name sentinel `_unmatched`, not the operation-class axis. An admitted
`SNAPBACK_APP_REFUSAL` is `app_refusal` only with a grammar-valid, declared
`appCode` and the app-refusal carrier; its per-code manifest opt-in controls
issue eligibility. That opt-in is the separate LLP 0108 authoring amendment
and does not follow merely from declaring a refusal.

Failure records allocate D2 `details` under one 8 KiB canonical-JSON budget.
The closed new keys are `platformCode`, `statusClass`,
`failure_disposition`, `issue_eligible`, `classifier_version`, `fp_branch`,
`fp_version`, `fp_hash`,
`predecessor_fp_version`, `predecessor_fp_hash`, `appCode`, `errorClass`,
`subsystem`, `function`, `name`, `appDetails`, `messageTemplate`, `message`,
`stack`, and `detailFlags`. `fp_branch` is the closed
`typed_refusal | app_refusal | exception | transport | diagnostic`
discriminator chosen by the emission seam. `platformCode` is grammar-valid
and required on every branch except transport; the transport tuple instead
requires `statusClass = 5`, `failure_disposition = fault`, and no platform
code. Diagnostic tuples require the validated `subsystem` facet. Foreign
branch facets make an eligible stamp malformed rather than inviting the
flusher to reinterpret it. Priority is total: (1)
branch/platform/status/classifier/fingerprint stamps;
(2) the branch-required `appCode`, `errorClass`, or `subsystem` facet, in that
order when present; (3) decoder `function` then `name`; (4) the
pre-existing keys, individually, in `attempt`, `cause`, `level`, `method`,
`rawPath`, `referer`, `severity`, `trigger`, `userAgent` order; (5)
`appDetails`, kept or dropped whole; (6) `messageTemplate`; (7) `message`; (8)
the stack head. Strings truncate only at UTF-8 character boundaries. The
allocator reserves `detailFlags` before optional occupants and always carries
`functionTruncated`, `nameTruncated`, `messageTemplateTruncated`,
`messageTruncated`, `stackTruncated`, `appDetailsDropped`, and one
`<existingKey>Dropped` boolean for each slot-5 key. The carrier's separate
pre-allocation extraction limit remains 16 KiB per captured string.

Fingerprint scheme v1 normalizes exactly four token classes and no others:
quoted spans (single or double quoted, backslash escapes admitted) to
`<quoted>`; email-shaped tokens to `<email>`; hexadecimal runs of at least
eight ASCII hex characters with an A–F digit, or at least eight hex digits
following a `0x` prefix, to `<hex>`; Crockford base32-shaped runs of at least
twelve characters with at least one letter to `<base32>`; and digit runs to
`<digits>`. This list says four semantic classes because hex/base32
are the single identifier-run class named by LLP 0156; their two concrete
recognizers are pinned separately. Matching precedence is quoted, email,
hex, base32, digits. No Unicode normalization occurs. Any new recognizer or
threshold change bumps `fp_version`.

The generated, drift-gated proof artifacts are
`error-classification.fixtures-v1.json` (the complete Phase-1 kind × frozen
signal × carrier × opt-in matrix), `error-carrier.fixtures-v1.json` (class,
normalizer, extraction/allocation bounds), and
`error-fingerprint.vectors-v1.json` (branch tags, absent-versus-empty,
Unicode, canonical bytes, full SHA-256, and 16-byte hash). These contracts are
pure in this tranche: storage, flusher recomputation prohibitions, and runtime
carrier wiring land separately under D-05.

### Amendment 2026-08-06: rolling trailing-head evidence

The 2026-08-02 carrier amendment coupled three different claims into one
`validate` result: whether a retained receipt honestly proves its measured
revision, whether that revision's proof-source closure is byte-identical to
current `HEAD`, and whether the evidence can authorize a release or capability
promotion. That coupling made continuous development structurally red: any
claim-affecting landing invalidated the historical receipt before a full Linux
producer could measure and carry a later head. Waiting for a quiet `main` is
not an admissible operating requirement.

The three claims are now separate and normative:

1. **Historical integrity.** A retained receipt is `HISTORICAL_VALID` when its
   clean `sourceRevision` exists, its benchmark and idle identities name that
   revision, the receipt's explicit source-file list reproduces its
   length-framed digest from that revision's Git tree, every frozen ceiling is
   satisfied, and the retained receipt bytes equal the tracked carrier bytes.
   Later source changes do not rewrite this result. Tampering, a missing
   measured blob, a dirty or mismatched binary identity, or a failed ceiling
   remains invalid evidence.
2. **Rolling-main currentness.** Relative to a branch head, historically valid
   evidence is `CURRENT` when the current proof-source list and digest equal
   the measured closure, `LAGGING` when the measured revision is an ancestor
   and the configured age is at most 24 hours, `OVERDUE` when that age is
   exceeded, and `DIVERGED` when it is not an ancestor. `LAGGING` and
   `OVERDUE` are explicit accepted states for an ordinary merge: they request
   the rolling full producer and never masquerade as current. `DIVERGED` is a
   merge failure because the receipt supplies no baseline in the branch's
   history. The 24-hour boundary is an operator-attention classification, not
   a claim that affected tests equal a full integration proof.
3. **Release and promotion authority.** A release or capability promotion
   requires `CURRENT`. Neither a recent historical receipt nor passing
   affected tests can substitute for an exact clean-source full benchmark and
   idle witness at the frozen candidate revision. (This exact-commit
   strictness is the per-claim carve-out LLP 0189 D-7 names via LLP 0175
   D2.4; it stands as written and is not the repo default.)

The executable modes mirror those claims: `validate-history` proves item 1;
`assess` reports items 1–2 and is the ordinary recurring check; and
`require-current` enforces item 3. The two repository release authorities now
invoke `scripts/verify-telemetry-phase1-proof --require-current
<frozen-candidate-sha>` through the shared fail-closed release gate. Real
`scripts/snapback-publish.mjs --publish` runs it after the qualified ledger is
bound to the clean checkout revision and before any npm publication;
`scripts/snapback-promote.mjs` runs it against the candidate ledger's frozen
`revision`, not the possibly newer promotion checkout, before publication-
authority acquisition or any dist-tag operation. Both the candidate
publication ledger and promotion receipt retain the returned assessment. The
old `validate` spelling remains a historical-integrity alias, not an exact-
current gate. Assessment output includes both digests, age, bounded changed-
source detail, and separate ordinary-merge versus release/promotion
dispositions.

No current record under `tests/acceptance/maturity/` cites telemetry evidence,
and the capability-maturity validator consumes no telemetry receipt. If a
future maturity record cites telemetry evidence, that authority must route the
record through the same frozen-revision exact-current mode before promotion;
ordinary `assess` output is not sufficient.

A Linux `telemetry-latest-main` workflow runs every six hours and on demand.
Its concurrency group finishes the one running source snapshot while retaining
at most one pending latest head; newer triggers replace older pending work, so
there is no per-commit full-proof queue. Each successful run uploads an exact
source-bound candidate. A candidate stays honest and retainable if `main`
advances during production because historical integrity is revision-scoped.
The scheduled workflow's own status owns rolling integration health; retained
carriers are durable evidence and release inputs, not a requirement that every
ordinary `main` commit immediately mint and land new JSON.

The repository-wide affected selector preserves the three modes rather than
collapsing them. A retained-receipt-only change selects historical/rolling
validation in the fast lane. Telemetry policy, producer, runtime, or native
source changes select the feature smoke and its native prerequisite closure.
The separate `telemetry-latest-main` producer retains full remint cadence. Its
candidate alone does not authorize release or promotion; the publish and
promotion authorities independently reopen it through `require-current` at
the frozen candidate revision before their first irreversible effect.
Selector/shared-authority changes fail broad into the complete canonical
inventory.

The full producer is otherwise unchanged: clean checkout, release identity,
feature smoke, complete benchmark, 120-second Linux idle witness, frozen
ceilings, and two-stage receipt/carrier separation all remain mandatory. The
evidence policy file is itself part of the current proof-source closure, so
changing cadence or release authority makes currentness explicit and requires
review.

### D3 — Write path: buffered, batched, priority-aware, event-driven

A bounded in-memory buffer with a dedicated flusher:

- Producers (the D2 seams) push fire-and-forget records into a bounded
  channel; the hot path never touches SQLite and never blocks on
  telemetry.
- **Two priority classes.** Failure and terminal-outcome records have
  reserved capacity; successful high-volume records (`http_request`,
  `function_run` successes, `log`) shed first. "Failure" is defined
  per class by the registry's failure predicate (`status >= 500` for
  transport requests, error outcomes for `function_run`/`job_run`,
  Warning+ codes anywhere), not by an HTTP-only rule. Within the
  low-priority class, drop-oldest — under sustained overload, the
  recent records an agent is debugging with survive. Drops are counted
  by kind, priority, and reason; **lifetime counters persist in
  `telemetry_meta` (updated at flush), and surfaces report both**: the
  variance envelope and the LLP 0010 inspect fields (buffer depth,
  drops, last-flush watermark) carry since-boot deltas, the Health page
  shows both lifetime and since-boot, labeled.
- The flusher writes a batch when **N records accumulate (default 256)**
  or when the **oldest buffered record reaches a maximum age (default
  3000 ms)** — age-from-first-buffered, not debounce-from-latest, so a
  steady trickle cannot starve the flush — and drains on graceful
  shutdown. Both triggers are armed only by record arrival (C2).
- One multi-row `INSERT` per flush inside a single transaction on the
  telemetry connection.
- **Reset/restore fence (D1):** clear the buffer, rotate the generation
  and its durable binding, then admit. In-flight old-generation batches
  land invisibly behind the view and are swept by D4.
- `telemetry.max_days = 0` disables persistence entirely (the buffer
  short-circuits), mirroring PocketBase's `MaxDays == 0` semantics.

### Amendment 2026-08-02: D-05 admission sequencing and failure-stamp state

LLP 0156 E1 uses the D3 admission critical section as its sole acceptance
order. Every accepted record receives a strictly increasing unsigned
in-memory sequence whose durable domain is SQLite's nonnegative `INTEGER`
range. At `i64::MAX`, admission fails closed before increment or insertion
and advances the ordinary kind/priority/reason drop counter under the stable
reason `sequenceExhausted`; a sequence is never repeated or admitted in a
form the store cannot flush.

`telemetry_meta` gains `enqueue_high_water`, advanced in the same transaction
as every drained batch, including admissions shed later by file-cap policy.
Resolve transactions also advance it to their captured barrier. Boot seeds
the live counter from
`max(enqueue_high_water, max(resolved_seq) for the current generation)`, so a
crash after resolve and before flush cannot reissue a barriered sequence. The
same meta row carries the all-or-none rollout tuple
`rollout_from_version`, `rollout_to_version`, `rollout_started_ms`, and
`rollout_expires_ms`; matching is exactly
`started_ms <= event.ts_ms < expires_ms` and never uses the flush clock.
Generation rebind resets rollout-derived/fold counters and the release
activation floor with the new generation.

The D2 redactor recognizes failure-shaped details only through the closed
allowlist above. It preserves allocator-owned values and `detailFlags`
exactly within the 8 KiB carrier budget; it neither truncates them a second
time nor derives missing classifier/fingerprint values. A literal
`issue_eligible: true` with an incomplete, unknown, branch-confused, or
wrongly typed stamp remains available on the raw row, is skipped by E1
materialization, and increments `malformed_error_stamp_count` in the flush
transaction. Non-eligible and ordinary D2 details retain the prior redaction
rules.

### D4 — Maintenance rides the flush path (no cron)

Retention, checkpointing, rollups, and old-generation sweeps are
**post-flush opportunistic work on the telemetry connection**, ordered as
a watermarked state machine (D7): after a flush, if the last sweep is
older than a threshold (default 6h) or the hour boundary was crossed:

1. **Roll up first**: fold rows above the rollup watermark into hourly
   aggregates and advance the watermark atomically (same transaction).
2. **Then delete**: retention-sweep raw rows with `recorded_ts_ms`
   older than `max_days` (default 7) **and** below the watermark —
   aggregation always precedes deletion, so an app that goes idle and
   resumes past the retention window cannot lose unaggregated history.
   Each sweep **advances the monotonic `retention_floor` in
   `telemetry_meta`** to the boundary it enforced.
3. Sweep old-generation rows; occasionally `PRAGMA
   wal_checkpoint(TRUNCATE)` / `PRAGMA optimize`.

**The boot flush always runs maintenance**, so a process that was long
idle heals its retention debt at startup, and **a shed-due-to-cap flush
cycle arms maintenance too** (C8), so a server at its file cap reclaims
space instead of starving until reboot. Independent of sweep timing,
**retention is enforced at read time**: every surface reads the
visibility views (D1), whose predicate is **strict** —
`recorded_ts_ms > max(observation_clock − max_days × 86_400_000,
retention_floor)` (`max_days` converts to milliseconds; this is the one
boundary formula, and the D2 view snippet states the same one).
**`max_days = 0` is the whole-subsystem off switch**: the disabled-guard
empties *both* views — raw and rollup alike — while disabled (aggregate
rows stay on disk and reappear on re-enable; D7's "raw rows only" rule
describes which knob governs which lifetime *while enabled*). Strictness
matters at the disable transition: floor := the observation clock at
disable, every stamp already issued is ≤ that value, so a strict
comparison hides all pre-disable rows — an inclusive one would leave
rows stamped exactly at the clock visible — while D2's strictly
increasing issuance guarantees every post-re-enable stamp exceeds the
captured floor, so new rows are visible immediately even if wall time
still lags the clock. The
no-resurrection guarantee is a **durable boundary protocol**, not a
sweep side effect: the floor advances to
`observation_clock − max_days × 86_400_000` **at boot, at every flush,
and at every
retention-config transition** — a `max_days` decrease captures the
tighter boundary durably before it applies, and a transition to
`max_days = 0` (persistence off) sets the floor to the current
observation clock, so re-enabling later cannot reveal pre-disable rows
even though no flush ran while off. Because the observation clock is
nondecreasing and the floor is monotone and persisted in
`telemetry_meta`, raising `max_days`, lower-then-raise sequences,
disable/re-enable, and clock rollback can never resurrect **raw rows**
that were ever hidden — for the in-process server and the
out-of-process hatch alike, with no sweep required. (Aggregate rows
reappearing after a disable/re-enable cycle is the designed D7
off-switch behavior, not resurrection: they were suspended by the
guard, never boundary-hidden.) The sweep is space reclamation,
not the privacy boundary (C5).

This deliberately does **not** use LLP 0028 cron: cron scheduler state
persists inside the app database (`META_CRON_STATE`), so a telemetry
cleanup cron would write app-DB bytes on every run — exactly the C1/C5
contamination the sibling file exists to avoid — and LLP 0028's run
ledger structurally rejects non-manifest jobs. Flush-path maintenance
needs no new job class, satisfies C2 for free, and keeps every
telemetry-related write on the telemetry connection. The accepted cost —
a server that goes idle right after a burst defers *reclamation* (never
the read-time boundary) to its next active period or boot.

### D5 — The query contract: typed operations, projected everywhere

The contract is a set of **typed telemetry query operations** in the LLP
0024 host-operations style — named operations with pinned request/response
JSON Schemas and fixtures — not any particular transport. Every surface
is a projection of the same operations:

- **Local admin routes** `/_snapback/api/telemetry/*` (C6), each with
  its LLP 0031 registry row.
- **CLI**: `snapback telemetry stats|events|export` (`--json` by default
  when not a TTY).
- **MCP**: the control MCP (`packages/snapback-cli/mcp-control.mjs`)
  projects host operations one-to-one; telemetry operations appear
  there like every other operation. (`crates/snapback/src/guide_mcp.rs` is deliberately
  a resources-only server and is not this seam.)
- **Console**: Health and Logs render the same operations (D6).
- **Hosted arms**: the target adapter / control plane serves the same
  operations where the app runtime cannot (D8).

The operations:

- `telemetry.events` — filterable, cursor-paginated listing over
  `telemetry_events_visible` (`kind`, `name`, `status`, `code`,
  `correlation`, time range, text match); deterministic ordering
  (`recorded_ts_ms`, `id`); bounded page sizes.
- `telemetry.stats` — bucketed counts and aggregates: counts by
  kind/status class, latency percentiles per `name`. **Authority is one
  consistent SQLite read over an exact coverage partition**: rollup
  buckets — open *and* finalized — cover precisely the rows at-or-below
  the watermark, and the raw tail is the visible rows strictly above
  it; the union counts every row exactly once, is correct across
  restarts and independent of rollup cadence, and is fresh to the last
  flush. Responses carry the coverage metadata (watermark position,
  bucket coverage intervals) so the partition is checkable. An
  in-memory accumulator may accelerate the union; it is never the
  authority.
- `telemetry.export` — snapshot-bounded streaming composition over
  `telemetry.events` (same filters, same visibility views, NDJSON
  framing); the CLI's `export` verb is this operation, not a side door.
- Phase 3 adds `telemetry.usage`.

**Sensitivity split (C5, LLP 0031):** `telemetry.stats` is a **closed
`OperatorMetadata` projection** — aggregates only, no free text, no
`details`, no handler-controlled content — served under ordinary admin
authority. `telemetry.events` and export return raw C5-sensitive rows
and therefore require **scoped, budgeted `AdminSecretRead` leases**
(the same authority split the existing raw inspect/table routes use)
with `no-store` response semantics.

**The variance envelope.** Every response carries: store backend,
**per-field** exactness — window totals exact when the reported window
is fully covered (D7's partial-window rule); per-name counts exact
until heavy-hitter folding occurred in the window, then approximate and
flagged; histogram percentiles approximate with bucket-error bounds —
sampling factor (if any), freshness watermark (latest flushed
`recorded_ts_ms`), the read-time retention boundary, drop counters
(since-boot; lifetime available), truncation facts, and — per query — a
capability outcome: `exact | approximate | bounded-window |
unsupported`. Backends answer honestly instead of simulating each
other.

**The SQL hatch — local CLI only, not a network surface.** v0.2's
network endpoint is deleted (see Alternatives). The escape hatch
survives where it is safe and where agents actually need it:

- `snapback telemetry query "<sql>"` opens the **local telemetry file
  directly**: read-only open flags (`SQLITE_OPEN_READ_ONLY`); a **new,
  deny-by-default authorizer** — *inspired by, and stricter than*, the
  Ibex boundary precedent (which is allow-by-default except
  `ATTACH`/`DETACH`/`load_extension` and tests those refusals) —
  allowing only read actions against the visibility views
  (`telemetry_events_visible`, `telemetry_rollup_visible`), denying
  every base table, all pragmas, attach/detach, and extension loading.
  Implementation note: SQLite's authorizer fires base-table read
  callbacks during view expansion, so the policy is attribution-aware —
  base-table reads are allowed only when attributed to the visibility
  views (the callback's view context makes this expressible), and a
  naive literal deny-on-base-tables would break the views themselves.
  Single statement with rejected tails; memory-only temp state; row,
  step, and time budgets (C8). Adversarial tests beyond the Ibex
  refusal set are part of the deliverable.
  Implementation note: the rusqlite authorizer API (`hooks` feature) is
  already compiled in transitively via the vendored `ibex-runtime`'s
  feature unification — declare it explicitly in Snapback's `Cargo.toml`
  rather than relying on unification.
- Because the hatch reads the same visibility views, whose boundary
  comes from `telemetry_meta` (D1), generation fencing and read-time
  retention hold there too with zero coordination (D1, D4).

### Amendment 2026-08-02: agent-first export carrier

The host-op and control-MCP projection of `telemetry.export` ships in v1; it is
not deferred behind the streaming HTTP carrier. An agent call returns one
snapshot-bounded finite page with caller-declared row and byte ceilings, the
applied bounds and exact serialized page size, an explicit truncation fact,
and an opaque authenticated continuation token when more rows remain. The
token binds the original filter, frozen export header, store generation, and
app-DB incarnation; a process restart or reset/rebind invalidates it. HTTP and
CLI continue to unfold the same query core as NDJSON. The request and page are
Rust-owned, schema-generated, committed, and covered by the shared query
fixture corpus.

### D6 — Console pages (Phase 1: Health and Logs)

The packaged console (LLP 0017) gains two fixed pages — fixed in the
PostHog-web-analytics sense: opinionated, zero-config, no query builder —
each rendering the D5 operations:

1. **Health** — requests over time, error rate, p50/p95 latency (from
   `telemetry.stats`, fresh to the last flush), live connection count
   (the live service's existing accounting), top routes/functions by
   volume and by error rate, `lifecycle` markers on the time axis, drop
   counters.
2. **Logs** — the filterable event list (including captured `log` rows —
   the page name is honest because authored output is actually there)
   with a detail modal showing the full record under the raw-read
   authority (C5).

The **Usage** page ships in Phase 3 with the metrics it needs (D8). The
console polls (PocketBase-style); if live updates prove wanted, LLP 0013
ephemeral state is the carrier that stays off the durable lane. The
inspect surface (LLP 0010) stays as-is — plus the D3 buffer-state fields
— and telemetry remains the "recent past" complement to inspect's
"current instant."

### D7 — Aggregates: a watermarked state machine, mergeable by construction

Rollups are maintained by D4 flush-path maintenance:

```sql
telemetry_rollup_hourly(generation, hour, kind, name,
                        count, error_count,
                        latency_histogram)   -- fixed log-spaced buckets
telemetry_rollup_daily(...)                  -- compacted tier, same shape
telemetry_meta(generation, app_db_incarnation,
               app_id, environment,         -- store identity (2026-08-02
                                            -- amendment): written at
                                            -- creation/rebind; stamped into
                                            -- exports at egress
               max_days_mirror, retention_floor,
               observation_clock_ms,        -- the D2 nondecreasing clock
               aggregate_floor_hourly, aggregate_floor_daily,
               rollup_watermark_id, last_sweep_ms,
               drop_counters_lifetime)
-- reads use telemetry_rollup_visible (generation-scoped union of tiers)
```

- **State machine:** hourly buckets are keyed by `recorded_ts_ms`,
  which is monotone by the D2 observation clock — so the stream is
  **append-ordered relative to the watermark**: no late record can land
  behind an already-finalized hour, even under wall-clock rollback,
  which dissolves the late-completion/top-N retroactivity problem by
  construction. Buckets and `rollup_watermark_id` (the highest rolled
  `telemetry_events.id`) update in one transaction; an hour is **open**
  until the watermark passes its end and **finalized** after; every
  bucket row carries its **coverage interval** (the `recorded_ts_ms`
  range and watermark position it aggregates); retention deletes only
  rows at-or-below the watermark (D4). Rollups fold **the same phase
  set `stats` counts** (`point`/`joined`/`terminal`; `admission` rows
  are never folded), so the D5 coverage partition — buckets open and
  finalized ≤ watermark, raw tail strictly above — counts every
  counted-phase row exactly once, restart-safe.
- **Bounded historical tiers (C8):** hourly rows are kept for a bounded
  window (default 90 days), then compacted into daily rows; the daily
  tier has its own horizon (default 730 days), beyond which — or
  whenever the total rollup row budget is exceeded — eviction removes
  **whole coverage intervals** (an entire hour or day bucket, all names
  at once, oldest first), never individual rows, and advances a durable
  per-tier **aggregate floor** in `telemetry_meta`
  (`aggregate_floor_hourly`/`_daily`), counted and visible. A window
  overlapping an evicted interval is thereby reported not-fully-covered
  rather than silently partial, which is what keeps the exactness
  labels honest. While enabled, `max_days` governs **raw rows only**;
  the tier horizons and aggregate floors govern aggregates
  (`telemetry_rollup_visible` scopes to generation + these floors, D1).
  `max_days = 0` is the whole-subsystem off switch and empties both
  views (D4).
  Rows ≈ hours × active names within the hourly window plus days ×
  names within the daily horizon — bounded by construction, not hope.
- **Partial windows are labeled, not fudged:** a query window that cuts
  through a bucket is served exactly from visible raw rows where the
  window lies within raw retention; beyond raw retention the response
  snaps to bucket-aligned boundaries and reports the actual covered
  window in the variance envelope. "Exact" is claimed only when the
  reported window is fully covered.
- **Mergeable by construction:** counters add; fixed-bucket histograms
  add; any window is a sum over tier rows, with percentiles from the
  merged histogram. Stored scalar percentiles and exact daily
  `DISTINCT` scalars were rejected in review as non-aggregable.
- **Cardinality budget (C8):** `name` includes app-defined
  route/function/job names that accumulate across deployments. Each
  hour keeps the top-N names per kind by count (default N=200); the
  remainder folds into `_other`, the fold is counted and visible — no
  silent truncation — and per-name figures for a window containing
  folds are flagged approximate in the variance envelope (window
  totals stay exact).
- **Distinct-user metrics are deliberately absent from Phase 1** —
  Phase 1 stores no subject at all (C5). Phase 3's gate is a
  **deletion-compatible aggregate strategy** decided with the identity
  policy: sketches (HLL-class) cannot un-count a deleted subject, and
  the contract must say what deletion means for historical aggregates
  *before* any distinct-user number ships (OQ2).
- Fan-out counters (frames delivered, bytes egressed — LLP 0104's
  realtime meter material) accumulate in memory and land in rollups
  directly, never as per-frame raw events (C3).

**Capacity model and the benchmark gate.** 1M requests/day ≈ 11.6
rows/second sustained — roughly one 256-row batched INSERT every ~20
seconds, against a dedicated WAL connection. That arithmetic is a sanity
check, not a proof: deliverable 5 adds a benchmark gate in the LLP 0035
style covering event amplification (rows per request), sustained and
burst traffic, file growth against the C8 cap, flush latency,
retention-sweep and checkpoint stalls, query latency, shed behavior
under overload, and — the number that matters — impact on app request
latency with telemetry on vs off.

### D8 — Phases 2 and 3

**Phase 2 — hosted arms.**

- *Container-VM (Fly):* D1–D7 apply verbatim; the telemetry file sits on
  the instance volume beside the app database. The LLP 0072 structured
  log channel is the hosted-logs projection of the same spans (C4), with
  its own delivery/drop accounting — not this store.
- *Cloudflare:* no local durable file exists. The worker owns
  **`writeDataPoint` only** (non-blocking; writes only on traffic,
  keeping observed-zero idle billing intact), and its payload is
  **classification-only by default (C5)**: kind, name pattern, status
  class, duration, code, generation — never `log`/`diagnostic`
  details, never `_unmatched` raw paths, never free text. Analytics
  Engine has fixed retention, no deletion, and no per-row read
  authority, so the C5 apparatus cannot follow data into it; the
  classification-only projection is what makes that acceptable, and
  the raw-detail product (`telemetry.events` detail, the Logs modal)
  is honestly `unsupported` on this arm unless a future decision
  changes the projection. The arm's `generation` does not come from a
  sibling file (none exists): the deployment/environment identity in
  the control plane's trusted target descriptor stands in for the
  D1 incarnation binding, rotating on reset/redeploy — pinned
  concretely with the Phase-2 registry rows. The **query operations are served by the
  control plane** as a real operation gateway: it holds the
  account-scoped AE credential under LLP 0072's custody rules,
  resolves the caller's deployment/environment identity and current
  generation from trusted target descriptors (never from
  caller-supplied strings), authorizes the caller independently of
  that provider credential — including the D5 sensitivity split, with
  raw-read authority, row/byte budgets, audit, and `no-store`
  semantics intact — and serves `telemetry.events`/`stats`/`export`
  through the same pinned schemas and capability outcomes (D5's
  transport-neutral contract exists for exactly this). The arm is
  **partial and says so**: AE is sampled and retention-capped
  (~3 months), so responses carry `approximate` / `bounded-window`
  outcomes, and long-window history does not exist unless OQ4 lands
  rollup persistence. Registry rows for the control-plane projection
  land with Phase 2.

**Phase 3 — declared product analytics.**

- **Declared, typed events** — not arbitrary `track(name, props)`. The
  app's source manifest declares its event vocabulary
  (`defineTelemetry({ events: {...} })` alongside schema/functions), and
  codegen gives clients and handlers typed event references. This
  matches the repo's manifest-declared philosophy (cron rejects
  runtime-created entries for the same reason), makes cardinality
  genuinely bounded, enables field-level privacy review of properties at
  declaration time, and gives agents exact types instead of an `_other`
  bucket silently swallowing typos. Undeclared names are refused at
  admission, visibly.
- **Ingestion route at the root**, as an app-facing operation under
  connection/session credentials per LLP 0031 — not under
  `/_snapback/api/*`. Admission quotas are a named design obligation
  (LLP 0047 lineage, C8): per-connection and per-app budgets with
  shed-and-count semantics. Server-side `ctx.track(eventRef, props)`
  rides the same span machinery. Both are explicitly **best-effort and
  non-audit**: apps needing durable transactional activity rows use the
  LLP 0110 pattern; the two are different products and the guide page
  says so. Whether mutation-scoped events settle only on commit is a
  named Phase-3 decision (OQ2) — the recommendation is release-on-commit
  so rolled-back actions are not counted silently.
- **Identity policy** — the gate for distinct-user metrics: anonymous
  device ids, anonymous-to-authenticated linking (default **don't
  link**; apps may declare linking, with deletion applying to the whole
  link set), subject deletion/rotation semantics (C5), the
  deletion-compatible aggregate strategy (D7), and only then DAU/WAU/MAU,
  the Usage page, and the retention tile.
- Sessions stay out until demand shows up; gap-based sessionization is
  derivable at rollup time later without schema changes.

### D9 — Export, not retention

Long retention and ad-hoc analysis are export problems (the universal
pattern: BigQuery export, log drains, log streams):

- `snapback telemetry export --since --until` is the `telemetry.export`
  typed operation (D5): snapshot-bounded NDJSON over the visibility
  views (AdminSecretRead authority, C5; current generation and
  retention boundary by construction).
- A later optional forwarder (Convex-style log stream: batched HTTP to a
  webhook/PostHog endpoint, best-effort, HMAC-signed) is noted as future
  work, not v1.

## Deliverables checklist (Phase 1)

1. `telemetry.rs` (store, `telemetry_meta` read-boundary authority and
   generation protocol, buffer with priority classes, flusher,
   watermarked flush-path maintenance with the monotonic retention
   floor, tiered histogram rollups, both visibility views) + span seams
   in `crates/snapback/src/server.rs`/`crates/snapback/src/cron.rs`/`crates/snapback/src/jobs.rs`/`crates/snapback/src/runtime.rs`
   (`log` capture); config knobs (`max_days`, `min_level`, buffer
   sizes, C8 caps) in the config store; reset/restore fence wired into
   the existing reset transition and its incarnation authority; the
   `obs_`/`gen_` prefixes registered in the LLP 0148 registry
   (`Observation` and `Generation` rows) as part of this deliverable —
   unconditionally.
2. The operation-class registry (versioned) and the OQ1 projection-matrix
   ratification against LLP 0104, checked by shared fixtures both the
   telemetry and metering projections deserialize — covering derived
   multi-metric event ids, no job/action or carrier/logical double
   count, per-class record timing and timestamp semantics
   (admission/terminal/recorded), retry/dedup, registry-version
   behavior, reset/in-flight generation races, raw-tail stats across
   restart, late-completion bucketing, cap exhaustion, and
   snapshot-bounded export. Boundary-protocol fixtures: 7→1→7 and
   N→0→N `max_days` transitions with no intervening sweep, clock
   rollback against the floor *and* across an hour-finalization
   boundary (pagination cursors and freshness must not regress),
   hatch/server boundary parity, and a mid-hour maintenance run
   proving every counted-phase row lands exactly once in the stats
   partition before and after restart.
3. Typed operations with pinned JSON Schemas + fixtures; local routes
   with LLP 0031 registry rows (stats = OperatorMetadata; events/export
   = AdminSecretRead + no-store); the variance envelope; `snapback
   telemetry` CLI; the host-op + control-MCP projection; the local-only
   SQL hatch (read-only open + deny-by-default authorizer + budgets +
   adversarial tests; declare rusqlite `hooks` explicitly); Health and
   Logs console pages. Acceptance coverage exercises the operations,
   CLI, and SQL hatch directly — agents are the tested consumer, the
   console is not the proof. Inspect gains the buffer-state fields.
4. `guide/` page for the observability surface; **a capability-index
   row** (`backend.observability-v1`) — and until this RFC lands, a GAP
   row, which `guide/capabilities.md` is missing today in violation of
   its own stated policy.
5. Evidence gates: the LLP 0035-style idle re-run with telemetry enabled
   (settle write bounded and terminal; zero writes after settle — C2),
   and the D7 benchmark gate (amplification, burst, file growth vs C8
   cap, flush and sweep stalls, query latency, shed behavior,
   app-latency impact).
6. LLP 0000 explainer updated to point its reserved Observability slot at
   this LLP; LLP 0104 cross-reference for the shared span/registry
   (C4/C7).

## Amendment (2026-08-03): Phase-1 implementation record

Phase 1 is implemented for the local target. The shipped boundary comprises
the sibling telemetry store, generation/config/reset protocol, two-stage
observation spans, operation-class registry and LLP 0104 projection fixtures,
typed operations with route/CLI/control-MCP projections, the local read-only
SQL hatch, and the Health and Logs console pages. The guide now documents the
operator and agent surfaces, the capability index labels the local contract,
and the retained-evidence protocol recurs through the local proof.

The retained receipt is a carrier over measured source commit
`de86d22a4550a40fa7b767e6946ef84ef5764587`. Its exact benchmark and idle
measurements are recorded in
`tests/acceptance/telemetry-phase1-evidence.v1.json`; the carrier validator
binds that clean source closure rather than measuring its own receipt bytes.
This implementation record intentionally leaves the numerical results to that
machine-readable authority so later evidence refreshes cannot leave duplicate
prose figures stale.

The idle witness deliberately leaves the ordinary server's non-telemetry
cron, jobs, maintenance, and asset schedulers armed. Its process-wide CPU
noise band is therefore a clock-resolution-derived 100 ms over the 120 s
window, bounding aggregate scheduler overhead to less than 0.1% of one core;
it is not a relaxation of C2. The post-settle directory, lifecycle, and
process-write witnesses still require exactly zero mutations and zero written
bytes, while RSS growth remains separately bounded.

LLP 0156 E0/E1 is also implemented locally on this substrate: the classifier
and failure-detail vocabulary, durable issue-group state machine, read and
mutation operations, CLI/control-MCP projections, and Errors console page are
present. That capability is documented separately as partial because its
declared local residue remains visible there.

This amendment does not collapse later phases into the completed kernel.
LLP 0154 Phases 2–3 are deferred by phasing and unbuilt. LLP 0156 E2 alerting
(outbox, delivery worker, webhook transport, and Sentry bridge) is deferred by
phasing and unbuilt. LLP 0156 E3 client crash ingest is sketch-only, requires
its own later authority, and is deferred by phasing and unbuilt. The RFC
therefore remains **Accepted**; this dated record reports implementation scope
without changing the proposal status.

## Alternatives considered

- **Events table in the app database.** Rejected: contends for the
  serialized app writer on every request and (for declared tables) rides
  the change journal and live-matcher fan-out (C1); pollutes the
  logical-bytes meter and backups (C5); aggravates the Cloudflare
  declared-tables fan-out defect
  (`issues/20260801-cloudflare-live-fanout-uses-declared-tables.md`).
  The sibling-file pattern is PocketBase-proven.
- **A network SQL endpoint (v0.2's Tier 3).** Rejected in round 1: no
  achievable authorization story worth its surface — `query_only` is not
  a boundary, an authorizer-hardened network endpoint still exposes an
  arbitrary-SQL attack surface for marginal gain over the typed
  operations + export, and cross-arm dialect divergence would poison the
  contract. Survives as the local-only CLI hatch (D5).
- **LLP 0028 cron for retention/maintenance.** Rejected in round 1: cron
  state persists in the app database (C1/C5 contamination) and the run
  ledger structurally rejects non-manifest jobs. Watermarked flush-path
  maintenance (D4) needs neither.
- **A single terminal envelope instead of the two-stage span.** Rejected
  in round 2: LLP 0104 binds attribution and budget at admission, before
  outcome and duration exist, so a terminal-only record cannot be the
  metering projection and pretending otherwise re-creates the v0.2
  incompatibility one layer down.
- **A second engine (DuckDB embedded, hosted ClickHouse).** Rejected for
  v1: a new dependency and operational surface purchased to serve ad-hoc
  analytics — the excluded feature class (C3). Watermarked
  mergeable-histogram rollups keep fixed dashboards cheap in plain
  SQLite; DuckDB remains the known upgrade path if a future LLP ever
  revisits the non-goal.
- **Third-party only (ship nothing, document PostHog + Expo Observe).**
  Rejected as the *whole* answer: it leaves agent DX (motivation 1) and
  operator health (motivation 2) unserved, requires every toy app to
  adopt an external service for "did it work," and forfeits the
  identity-for-free advantage. Retained as the answer for everything
  beyond the fixed dashboards.
- **stdout structured logging + external collection.** Rejected as the
  primary design: pushes the burden to every deployment arm, contradicts
  the batteries-included local story, and leaves the admin console with
  nothing to render. `tracing` may still arrive someday for *process*
  diagnostics; it is orthogonal to this app-behavior layer.

## Open questions

- **OQ1 — Resolved 2026-08-02; ratified against LLP 0104.** Admission creates
  one registry-owned header with `observation_id`, `registry_version`, exact
  `operation_class`, broad `telemetry_kind`, and telemetry projection mode.
  The shared fixture envelope spells the remaining cross-projection fields as
  `generation`, `appId`, `environment`, nullable `release`, `occurredAtMs`,
  `correlationId`, `ownershipInterval`, `stages`, and `meterFacts`.
  Telemetry composes row + `telemetry_meta` into `appId`/`environment` at
  egress; metering projects the identical values as LLP 0104's `expoAppId` /
  `snapbackEnvironmentId`, with the ownership interval's `expoAccountId`
  authoritative at `occurredAtMs`. Telemetry retains the fixed broad `kind`
  vocabulary (`function_run`, `http_request`, `live_subscribe`, `ws_connect`,
  `job_run`, `lifecycle`, `log`, `diagnostic`, and counter-only realtime),
  while the shared header preserves query/mutation/action, carrier/logical,
  scheduler/logical, platform-operation, and system-exclusion distinctions.

  Timing is exact: `occurredAtMs` / telemetry `ts_ms` is the admission-bound
  attribution time for every stage; admission, terminal, point, and counter
  stage records each carry their own monotone recorded time; telemetry emits
  joined short spans at terminal, admission+terminal long spans, point rows,
  or counters according to the class; metering `observedAtMs` is the selected
  stage's recorded time. Accepted query, mutation, action, HTTP-function,
  subscribe/resubscribe, standalone transport, export, and restore classes
  derive `backend_requests = 1` at admission — it is not caller-supplied and
  cannot be omitted or overridden. CPU, transfer, and delivered-message
  quantities are measured facts admitted only where the registry allows the
  exact `(metric, stage, unit)` tuple. Duplicate stages, duplicate metric-stage
  facts, unregistered classes, unsupported registry versions, negative
  quantities, and unit mismatches fail closed in both projections.

  Each usage `eventId` is `sha256:` over a domain-separated, length-framed
  `(observation_id, metric_id, stage, schema_version)` tuple. At-least-once
  retries therefore reproduce one id per metric and consumer dedup never
  collapses distinct meters. A scheduler `job_run` contributes no independent
  request meter; its invoked `function.action` does. An HTTP carrier contributes
  no independent request meter when the logical function is admitted; a
  registry-classified standalone accepted operation does. A compound batch
  carries one observation per accepted logical operation. The chargeable
  platform subset is exactly LLP 0104's `export` and `restore`; its complete
  non-chargeable enumeration plus health, console polling, telemetry, static
  assets, and maintenance are `system`. Registry v1 is stamped on telemetry
  rows and usage events, and unsupported versions are never reinterpreted as
  v1. The generated shared corpus is independently deserialized and asserted
  by both projection views; no metering writer, second ingestion pipeline, or
  network SQL endpoint is introduced.
- **OQ2 — Phase-3 identity and settlement policy.** Anonymous-to-
  authenticated linking (default don't-link; app-declared linking with
  deletion applying to the whole link set), subject deletion/rotation
  semantics, the deletion-compatible aggregate strategy (sketches
  cannot un-count — the contract must say so), and whether
  mutation-scoped `ctx.track` events settle only on commit
  (recommendation: release-on-commit).
- **OQ3 — Hosted retention ceilings.** Local `max_days` stays
  operator-free below the C8 safety ceiling (no plan gate ≠ unbounded).
  Hosted arms pin a default `max_days` and file-size cap at Phase-2
  landing — telemetry disk is billing-invisible under C5, so the bound
  cannot wait for the commercial discussion; entitlements within the
  safety bounds are the LLP 0104-process decision.
- **OQ4 — Cloudflare long-window history.** Whether the CF arm gains
  durable rollup persistence (DO storage) for Health parity, or
  honestly caps history at the AE window. Leaning: cap for v1 — the
  variance envelope exists so the cheap answer can be truthful, and DO
  rollups add a durable-write surface to the arm whose appeal is
  writes-only-on-traffic. Decide after the Phase-2 control-plane
  projection (D8) is real.
