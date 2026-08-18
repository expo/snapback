---
title: Backend observability
id: operating.observability
order: 5
audience: agent-first
capabilities: [backend.observability-v1]
authorities: [llp/0154-minimal-observability.rfc.md, crates/snapback-services/src/telemetry.rs, crates/snapback-services/src/telemetry_query.rs, crates/snapback/src/cli.rs, crates/snapback/src/host_ops.rs, packages/snapback-cli/mcp-control.mjs, admin-ui/admin-boundary.mjs, scripts/telemetry-phase1-idle-proof.mjs, crates/snapback/src/telemetry_bench.rs]
examples: []
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:c39c3ad792dc3458af8398d113e6d24cb378de2094556d3bcb84fea4956a2e85
---

# Backend observability

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Snapback records a bounded, loss-tolerant recent history of backend work with
no application setup. Use the fixed Health and Logs console pages for a quick
view; use the typed operations below when an agent needs exact filters,
coverage facts, or an export.

The local implementation, recurring smoke gate, and retained clean-release
idle/benchmark receipt are shipped together. The
[retained carrier](repo:tests/acceptance/telemetry-phase1-evidence.v1.json)
binds its measured clean source revision, the complete proof-source byte
closure, and the exact receipt bytes; the recurring local proof reopens it
before running the smoke profile.

This is the Phase-1 surface from
[LLP 0154](repo:llp/0154-minimal-observability.rfc.md): backend requests,
function and job runs, live/WebSocket lifecycle, process and release markers,
runtime logs, and standalone diagnostics. It does not include hosted telemetry,
declared product-analytics events, distinct-user metrics, funnels, or client
crash ingest. Grouped backend issue lifecycle is the separate
[error-tracking capability](./error-tracking.md) built on these rows.

## Check health and recent logs in the console

Open the admin console and select **Health** for request volume, request error
rate, p50/p95 latency, live connections, top routes/functions, lifecycle
markers, and drop counters. Select **Logs** to filter raw events by kind, name,
diagnostic code, or text and inspect one record.

Health reads the closed aggregate `telemetry.stats` projection. Logs reads
`telemetry.events`, whose records can contain authored log text or diagnostic
context and therefore require the separate scoped secret-read authority. The
console acquires that authority through its existing operator boundary; an app
session never grants it.

The stats HTTP projection also accepts `callerKey`, `lane`, and
`groupByCaller=true` for the bounded external-caller dimension. Declared
caller keys are digests and integration keys are registration IDs. The
declared-client and integration admin listings join a recent 24-hour count
from this rollup so operators can inspect usage beside suspension state.

## Query the typed operations from the CLI

Address the server by its readiness descriptor so the CLI can resolve its URL,
admin credential, and—only for raw reads—a short-lived scoped lease:

```sh
snapback telemetry stats --ready-file .snapback/server-ready.json --kind function_run
snapback telemetry events --ready-file .snapback/server-ready.json --kind log --limit 50 --order desc
snapback telemetry export --ready-file .snapback/server-ready.json --since 1760000000000 --until 1760086400000 > telemetry.ndjson
```

`stats` admits `--kind`, `--name`, `--from-ms`/`--since`, and
`--to-ms`/`--until`. `events` and `export` additionally admit `--status`,
`--code`, `--correlation`, and `--text`; `events` has the deterministic
`recorded_ts_ms` + `id` cursor and a page limit of 1–500. Export freezes one
snapshot and emits a self-describing NDJSON header followed by the visible
records.

When addressing `--url` instead, supply the admin token and a separately
minted `--secret-read-lease` for `events` or `export` — mint it with
`snapback secret-read-mint` as described in
[host operations — "Mint a scoped secret-read lease"](./host-ops.md#mint-a-scoped-secret-read-lease).
An admin token alone is deliberately insufficient for raw records. Responses
from raw HTTP carriers are `no-store`.

## Query from an agent tool

The control MCP exposes the same Rust-owned operations as:

- `snapback_telemetry_stats` — aggregate counts, error rates, latency,
  coverage, and variance;
- `snapback_telemetry_events` — one bounded raw-event page with an
  automatically minted scoped lease;
- `snapback_telemetry_export` — one immutable-snapshot page bounded by
  `maxRows` and `maxBytes`, plus an opaque continuation token when truncated.

The host-operation identities are `telemetry.stats`, `telemetry.events`, and
`telemetry.export`. The agent export is intentionally finite; follow its
continuation token rather than treating one page as the whole snapshot.

## Read the variance envelope before drawing conclusions

Every typed response reports its store backend, capability outcome, sampling,
freshness watermark, retention boundary, truncation, and drop counters.
Window totals are exact only when the reported coverage spans the requested
window. Per-name results become approximate when heavy-hitter folding occurred;
latency percentiles are histogram approximations with stated bounds.

Telemetry may shed under pressure. Since-boot and lifetime counters say what
was lost and why. A missing event after a nonzero drop count is not evidence
that the operation never happened, and an old freshness watermark is not a
current health reading. Telemetry is never billing authority.

## Use the local SQL hatch for bounded investigations

When the typed operations cannot express a local investigation, query the app
database's telemetry sibling through the CLI:

```sh
snapback telemetry query \
  "SELECT kind, name, count(*) AS n FROM telemetry_events_visible GROUP BY kind, name" \
  --db .snapback/dev.sqlite3 --max-rows 100 --max-time-ms 2000
```

The command opens `.snapback/dev.sqlite3.telemetry` read-only and permits one
statement over `telemetry_events_visible` or `telemetry_rollup_visible`.
Caller-aware investigations use the typed stats fields above.
Base-table reads, writes, pragmas, attach/detach, extension loading, and SQL
tails are refused. Row, SQLite-step, elapsed-time, and serialized-byte budgets
remain enforced even though the command is local. There is no network SQL
endpoint.

## Understand storage and retention

Telemetry uses its own generation-bound SQLite sibling and write connection;
it is not attached to the app database, does not enter application tables or
live-query changes, and rotates visibility with reset/restore incarnation.
Producers enqueue without waiting for SQLite. A record arrival arms a flush at
256 records or when the oldest record reaches 3 seconds; retention, rollups,
checkpointing, and generation cleanup ride that flush path rather than a
periodic timer.

The local defaults retain 7 days of raw events, reserve 512 of 4,096 buffer
slots for failure/terminal records, and cap the physical telemetry main + WAL
+ SHM footprint at 256 MiB. These are deployment-owned resource-safety
settings, not plan entitlements. `maxDays: 0` is a true persistence off switch.
Automation should inspect the returned retention/variance facts instead of
assuming defaults; the current author-facing CLI does not mutate this policy.

## Anti-patterns

- **Do not use telemetry to compute bills, audit ledgers, or durable app
  state.** It is explicitly loss-tolerant and priority-shedding.
- **Do not treat the admin token as raw-data authority.** Events and exports
  require their own short-lived, budgeted secret-read scope.
- **Do not open telemetry base tables or hand-edit the config sibling.** Use
  typed operations, or the bounded local visibility-view hatch.
- **Do not infer zero activity from an empty page without checking freshness,
  coverage, retention, truncation, and drops.**
- **Do not build product analytics or a second error-group lifecycle on raw
  Phase-1 rows.** Product analytics remains unbuilt; use the typed
  [error-tracking capability](./error-tracking.md) for backend issue triage.
