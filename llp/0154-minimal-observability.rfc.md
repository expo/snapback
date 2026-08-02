# LLP 0154: Minimal built-in observability and analytics

**Type:** RFC
**Status:** Draft
**Systems:** Observability, Storage, Server, Admin console, CLI,
Hosted execution, Developer experience
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-08-02
**Revised:** 2026-08-02 (v0.1, initial draft from the 2026-08-02 landscape
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
**Related:** LLP 0000 (explainer; reserves Observability as an undrafted
subsystem), LLP 0003 (storage core; app write lane), LLP 0010 (inspect
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
(prefixed identifier grammar)

## Summary

Snapback today persists essentially no runtime telemetry: there is no
`tracing`/`log` crate, `src/server.rs` contains two `eprintln!` calls in
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
  live-query matcher (`src/storage.rs`, @ref LLP 0003#database-model; a
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
  per `src/diagnostic.rs` may carry source paths, handler text, and
  arguments — operator-only context), captured `log` output, and later
  app-defined properties. It is **sensitive** under LLP 0031's
  classification (`SensitiveApplicationData` explicitly includes handler
  errors, source, arguments, correlation data) and is handled as such:
  the read surfaces split by sensitivity (D5 — aggregates are a closed
  `OperatorMetadata` projection; raw events require `AdminSecretRead`
  leases), scrubbing and an allowlist/redactor at admission (D2),
  restrictive file permissions, and deletion semantics (D1 generations;
  Phase 3 subject deletion). Phase 1 persists **no user subject** at
  all. What C5 does *not* mean: telemetry is excluded from the LLP 0104
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
  a telemetry file-size cap (shed-on-full, counted), rollup row and
  operation-name cardinality budgets (D7), per-query work budgets (rows,
  steps, time), and per-event byte caps. "Operator-free" local
  configuration means no plan gate, not unbounded storage (C3).

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
  (`dev.sqlite3.config.json`, `src/config.rs`).
- **Not** attached to app storage: telemetry tables do not appear in the
  schema surface, are not queryable by app functions or live queries, do
  not ride `_snapback_changes`, and are excluded from LLP 0007
  backup/restore and the LLP 0104 logical-bytes meter (C1, C5).
- File permissions restrict to the owning user (C5); the file is absent
  until the first observation is written — on a provisioned instance
  that means the boot settle write (C2).
- **Generation identity is a durable protocol, not a trigger list.**
  Every event row carries a `generation` (`gen_`-prefixed per the LLP
  0148 grammar). The protocol:
  - The app database already carries a durable incarnation rotated
    inside the reset transaction (the authorization-stream incarnation
    with its committed successor witness and publication fence,
    `src/storage.rs` / `src/server.rs`). The telemetry generation is
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
    surface — Tier-1 operations, CLI, export, and the SQL hatch — reads
    through a `telemetry_events_visible` view** scoped to the current
    generation and the retention window (D4), and the hatch's authorizer
    denies the base tables. Old-generation rows are swept
    opportunistically by D4 maintenance.
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
  admitted): observation id (LLP 0148-prefixed, unique — the idempotency
  key for bill-grade sinks), operation class + **registry version**,
  app/environment identity, `generation`, release identity
  (function-bundle hash / deployment id), admission time `ts_ms`
  (the attribution-bound timestamp per LLP 0104's admission-bound
  `occurredAt` discipline), correlation (request/job/connection id), and
  attribution fields the metering projection needs (ownership interval
  per LLP 0104).
- **Terminal completion** (joined by observation id): outcome status,
  `duration_ms`, Diagnostic `code` when the operation terminated with
  one.

**Projection matrix (normative skeleton; OQ1 ratifies the full table
against LLP 0104's classification):**

| operation class        | telemetry (lossy)          | metering (reliable)        | hosted logs (LLP 0072) |
|------------------------|----------------------------|----------------------------|------------------------|
| logical call (function_run) | joined row at terminal | **admission = billable**   | terminal, redacted     |
| transport request (http_request) | joined row at terminal | not billable (carrier of a logical call; billable only when it maps to no logical call, per the registry) | terminal, redacted |
| live subscription      | admission + terminal rows  | admission (subscription meter) | lifecycle only     |
| realtime frames        | **counters only (D7)**     | frame meter (counters)     | none                   |
| job run                | joined row at terminal     | admission                  | terminal               |
| lifecycle              | single row                 | not billable               | mirrored               |
| log line               | single row (capped)        | not billable               | per LLP 0072 policy    |

Exactly one record per class is billable; the registry is versioned and
the version is stamped on every persisted row, so a class-table change
never reinterprets old rows.

The telemetry projection persists spans as fixed columns —
schema-on-write, capped sizes, no per-app migrations:

```sql
CREATE TABLE telemetry_events (
  id           INTEGER PRIMARY KEY,
  observation  TEXT NOT NULL,             -- span id (obs_…)
  generation   TEXT NOT NULL,             -- D1 binding (gen_…)
  class_v      INTEGER NOT NULL,          -- registry version
  ts_ms        INTEGER NOT NULL,          -- admission time
  kind         TEXT NOT NULL,
  name         TEXT NOT NULL,
  status       INTEGER,
  duration_ms  REAL,
  code         TEXT,                      -- Diagnostic code, when failed
  correlation  TEXT,
  details      TEXT                       -- JSON, allowlisted + capped
);
-- all reads go through this view (D1):
CREATE VIEW telemetry_events_visible AS
  SELECT * FROM telemetry_events
  WHERE generation = (SELECT generation FROM telemetry_meta)
    AND ts_ms >= /* now − max_days (D4, read-time enforced) */;
```

There is deliberately **no subject column content in Phase 1** (C5): the
distinct-user metrics that would need it are Phase 3, so Phase 1 carries
correlation ids only. The schema reserves the column position for Phase
3 rather than migrating later.

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
| `job_run`        | cron/job terminal seam (`src/cron.rs`)      | the existing terminal seam already       |
|                  |                                             | carries identity/outcome/duration        |
| `lifecycle`      | closed Phase-1 allowlist, below             | the deploy markers agents correlate      |
|                  |                                             | regressions to                           |
| `log`            | the existing `runtime.log` host call        | authored handler output, size-capped,    |
|                  | (`src/runtime.rs`)                          | low priority, C5 operator-only           |
| `diagnostic`     | the **emission boundary** only              | see below                                |

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
`Info`/`Warning`/`Error`/`Fatal` (`src/diagnostic.rs`); the `min_level`
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
authority. No IP persistence unless `log_ip` is enabled.

### D3 — Write path: buffered, batched, priority-aware, event-driven

A bounded in-memory buffer with a dedicated flusher:

- Producers (the D2 seams) push fire-and-forget records into a bounded
  channel; the hot path never touches SQLite and never blocks on
  telemetry.
- **Two priority classes.** Failure and terminal-outcome records
  (`status >= 500`, Warning+ codes, `job_run`/`ws_connect` terminals,
  `lifecycle`) have reserved capacity; successful high-volume records
  (`http_request`, `function_run` successes, `log`) shed first. Within
  the low-priority class, drop-oldest — under sustained overload, the
  recent records an agent is debugging with survive. Drops are counted
  by kind, priority, and reason; the counters surface on Health, in
  every Tier-1 variance envelope, and — because the buffer is exactly
  the seam between "current instant" and "recent past" — as buffer
  depth/drop/last-flush fields on the LLP 0010 inspect surface.
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

### D4 — Maintenance rides the flush path (no cron)

Retention, checkpointing, rollups, and old-generation sweeps are
**post-flush opportunistic work on the telemetry connection**, ordered as
a watermarked state machine (D7): after a flush, if the last sweep is
older than a threshold (default 6h) or the hour boundary was crossed:

1. **Roll up first**: fold rows above the rollup watermark into hourly
   aggregates and advance the watermark atomically (same transaction).
2. **Then delete**: retention-sweep raw rows older than `max_days`
   (default 7) **and** below the watermark — aggregation always precedes
   deletion, so an app that goes idle and resumes past the retention
   window cannot lose unaggregated history.
3. Sweep old-generation rows; occasionally `PRAGMA
   wal_checkpoint(TRUNCATE)` / `PRAGMA optimize`.

**The boot flush always runs maintenance**, so a process that was long
idle heals its retention debt at startup. Independent of sweep timing,
**retention is enforced at read time**: every surface reads
`telemetry_events_visible` (D1), which applies the `max_days` boundary —
the sweep is space reclamation, not the privacy boundary (C5).

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
  there like every other operation. (`src/guide_mcp.rs` is deliberately
  a resources-only server and is not this seam.)
- **Console**: Health and Logs render the same operations (D6).
- **Hosted arms**: the target adapter / control plane serves the same
  operations where the app runtime cannot (D8).

The operations:

- `telemetry.events` — filterable, cursor-paginated listing over
  `telemetry_events_visible` (`kind`, `name`, `status`, `code`,
  `correlation`, time range, text match); deterministic ordering
  (`ts_ms`, `id`); bounded page sizes.
- `telemetry.stats` — bucketed counts and aggregates: counts by
  kind/status class, latency percentiles per `name` from D7 histograms
  **merged with the in-memory unrolled tail**, so results are fresh to
  the last flush, not the last rollup.
- Phase 3 adds `telemetry.usage`.

**Sensitivity split (C5, LLP 0031):** `telemetry.stats` is a **closed
`OperatorMetadata` projection** — aggregates only, no free text, no
`details`, no handler-controlled content — served under ordinary admin
authority. `telemetry.events` and export return raw C5-sensitive rows
and therefore require **scoped, budgeted `AdminSecretRead` leases**
(the same authority split the existing raw inspect/table routes use)
with `no-store` response semantics.

**The variance envelope.** Every response carries: store backend,
**per-field** exactness (counts exact; histogram percentiles approximate
with bucket-error bounds), sampling factor (if any), freshness watermark
(latest flushed `ts_ms`), raw-retention boundary, drop counters since
boot, truncation facts, and — per query — a capability outcome:
`exact | approximate | bounded-window | unsupported`. Backends answer
honestly instead of simulating each other.

**The SQL hatch — local CLI only, not a network surface.** v0.2's
network endpoint is deleted (see Alternatives). The escape hatch
survives where it is safe and where agents actually need it:

- `snapback telemetry query "<sql>"` opens the **local telemetry file
  directly**: read-only open flags (`SQLITE_OPEN_READ_ONLY`); a **new,
  deny-by-default authorizer** — *inspired by, and stricter than*, the
  Ibex boundary precedent (which is allow-by-default except
  `ATTACH`/`DETACH`/`load_extension` and tests those refusals) —
  allowing only read actions against `telemetry_events_visible` and the
  rollup views, denying the base tables, all pragmas, attach/detach,
  and extension loading; single statement with rejected tails;
  memory-only temp state; row, step, and time budgets (C8). Adversarial
  tests beyond the Ibex refusal set are part of the deliverable.
  Implementation note: the rusqlite authorizer API (`hooks` feature) is
  already compiled in transitively via the vendored `ibex-runtime`'s
  feature unification — declare it explicitly in Snapback's `Cargo.toml`
  rather than relying on unification.
- Because the hatch reads the same visibility view, generation fencing
  and read-time retention hold there too (D1, D4).

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
telemetry_meta(generation, app_db_incarnation,
               rollup_watermark_id, last_sweep_ms, drop_counters)
```

- **State machine:** buckets and `rollup_watermark_id` (the highest
  rolled `telemetry_events.id`) update in one transaction; retention
  deletes only rows at-or-below the watermark (D4); `telemetry.stats`
  merges finalized hourly rows with the in-memory unrolled tail, so
  nothing is double-counted and nothing recent is missing.
- **Mergeable by construction:** counters add; fixed-bucket histograms
  add; any window (day, week, month) is a sum over hourly rows, with
  percentiles from the merged histogram. Stored scalar percentiles and
  exact daily `DISTINCT` scalars were rejected in review as
  non-aggregable. Exactness is per-field in the variance envelope:
  counts exact, percentiles approximate with known bucket error.
- **Cardinality budget (C8):** `name` includes app-defined
  route/function/job names that accumulate across deployments while
  rollups are kept indefinitely. Each hour keeps the top-N names per
  kind by count (default N=200); the remainder folds into `_other` and
  the fold is counted and visible — no silent truncation.
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
  keeping observed-zero idle billing intact). The **query operations are
  served by the control plane**, which holds the account-scoped
  Analytics Engine credential under LLP 0072's custody rules — the
  worker cannot answer `telemetry.events`/`stats` itself, and the
  console/CLI on this arm reach the control-plane projection of the
  same typed operations (D5's transport-neutral contract exists for
  exactly this). The arm is **partial and says so**: AE is sampled and
  retention-capped (~3 months), so responses carry `approximate` /
  `bounded-window` capability outcomes, and long-window history does
  not exist unless OQ4 lands rollup persistence. Registry rows for the
  control-plane projection land with Phase 2.

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

- `snapback telemetry export --since --until` streams NDJSON of visible
  raw events (AdminSecretRead authority, C5; current generation and
  retention window by construction).
- A later optional forwarder (Convex-style log stream: batched HTTP to a
  webhook/PostHog endpoint, best-effort, HMAC-signed) is noted as future
  work, not v1.

## Deliverables checklist (Phase 1)

1. `telemetry.rs` (store, `telemetry_meta` generation protocol, buffer
   with priority classes, flusher, watermarked flush-path maintenance,
   histogram rollups, visibility view) + span seams in
   `src/server.rs`/`src/cron.rs`/`src/jobs.rs`/`src/runtime.rs` (`log`
   capture); config knobs (`max_days`, `min_level`, `log_ip`, buffer
   sizes, C8 caps) in the config store; reset/restore fence wired into
   the existing reset transition and its incarnation authority.
2. The operation-class registry (versioned) and the OQ1 projection-matrix
   ratification against LLP 0104, checked by a shared fixture both the
   telemetry and metering projections deserialize.
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

- **OQ1 — Span and registry ratification against LLP 0104 (hard gate
  before the seams land).** The full projection matrix: exact field
  names and admission-vs-terminal timing, stable observation identity,
  operation-class registry version semantics, batch/retry rules, and
  which record is billable per class — reconciled with LLP 0104's
  admitted-operation vocabulary and checked by a shared fixture that
  both projections deserialize, so "projection, not translation" is a
  CI property.
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
