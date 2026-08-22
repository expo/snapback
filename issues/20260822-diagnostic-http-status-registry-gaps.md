# Diagnostics silently inherit HTTP 500, and the registry undercounts classified codes by 558

Status: Open — includes a registry parser defect that undercounts by 35%
Created: 2026-08-22
Related: issues/20260822-bounded-commit-capsule-spec.md (where the pattern was noticed)

## Why this audit ran

Two diagnostics were independently found this week to be internally typed and `retryable: true`
but absent from the HTTP status registry, so they reach clients as an opaque 500. Two instances in
one week, from different reviewers on unrelated work, looked like a pattern rather than luck. It
was.

## Findings

| Rank | Diagnostic | Current | Correct | Client union |
|---|---|---|---|---|
| 1 | `SNAPBACK_WRITER_ACQUIRE_TIMEOUT` | 500 fall-through | **503** | missing |
| 2 | `SNAPBACK_WATCH_PREFLIGHT_STALE` | 500 fall-through | **409** (INFERRED) | missing |
| 3 | `SNAPBACK_AUTH_HOSTED_ADMISSION_EXPIRED` | 500 fall-through | **503** (INFERRED) | present |
| 4 | `SNAPBACK_ASSET_STORE_UNAVAILABLE` | 500 for every producer | **503** for transport/availability, **500** for integrity/ambiguous-effect | present |

Plus `SNAPBACK_WATCH_SECRET_ROLLBACK_FAILED`, where 500 is correct but the code is absent from the
client union and generated registry.

**Highest consequence: `SNAPBACK_WRITER_ACQUIRE_TIMEOUT`.** The server explicitly says retry, the
timeout occurs *before* effect acquisition, and yet the HTTP status and the missing client type
jointly hide both facts. Its details also omit `effectCommitted: false`, so a safely uncommitted
refusal looks effect-ambiguous.

Note: `SNAPBACK_WATCH_PREFLIGHT_STALE` has since been mapped to 409 with `retryable: true` on
`lane/migrate9`, independently arriving at this audit's recommendation.

## The default is a deliberate fail-safe

`_ => auth_budget_status(code).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR)` exists so a server
fault can never masquerade as a caller 4xx. That is right. The oversight is that **no gate
distinguishes "intentionally internal 500" from "new retryable refusal that silently inherited
500"**.

## Why no gate caught it

- **`check-inventories`** runs the diagnostic generator with `--check`, so it should report stale
  generated artifacts — but not missing status mappings.
- **The `s5_d10_production_diagnostic_inventory_cannot_drift` test** requires exact equality
  between discovered literals and a reviewed status table, but under the default `server-owner`
  feature its source walk covers **only the server crate**, not `snapback-engine`. So it should
  catch `WRITER_ACQUIRE_TIMEOUT` but misses both engine-owned watch diagnostics — and it asserts
  neither route reachability nor client-union membership.
- **The generator explicitly permits `httpStatus: null`**, so regeneration fixes the union while
  silently retaining the runtime 500 default.

## Independent defect: the registry undercounts by 558 codes

`parseHttpStatuses` uses a regex that does not accept rustfmt-wrapped tuples with a trailing comma,
and cannot parse the inline 202 row (`scripts/generate-diagnostics-registry.mjs:240`).

The committed registry therefore reports **1,030 HTTP-classified codes** against **1,588** actual
reviewed rows — a **558-code undercount**, about 35%.

This matters beyond the count: the registry is a published guide artifact and a gate input, so
every consumer of it has been reading a number that is wrong, and any check built on it inherits
the blind spot. Parsing Rust with a formatting-sensitive regex is the root cause.

## What a sufficient gate looks like

One route-aware manifest joining:

    route → emitted diagnostic → metadata → actual status (including overrides) → client union

It should reject route-reachable `httpStatus: null`, permit the default 500 only with an explicit
internal-fault classification, validate retry/effect/authority semantics against the mapped status,
and **parse Rust structurally rather than through formatting-sensitive regexes**.

## Provenance

Read-only codex audit against `lane/migrate9@cff852dd1` (the lane carried the two reported
additions; `origin/main` did not). Full audit with per-diagnostic citations appended below.

---

## Outcome

On `origin/lane/migrate9@cff852dd1`, I found:

- **Four diagnostics with misleading HTTP behavior**: three map wholly to the wrong status; one (`ASSET_STORE_UNAVAILABLE`) conflates 500- and 503-class producers under one code.
- **Three route-reachable diagnostics missing from the client union**, not two.
- The highest-consequence instance is **`SNAPBACK_WRITER_ACQUIRE_TIMEOUT`**.

The current `origin/main` no longer contains the two reported additions, so lane-only citations below use `origin/lane/migrate9:path:line`.

## Ranked findings

| Rank | Diagnostic | Current HTTP behavior | Correct status | Client union |
|---|---|---|---|---|
| 1 | `SNAPBACK_WRITER_ACQUIRE_TIMEOUT` | **500, fall-through** | **503 Service Unavailable** | Missing |
| 2 | `SNAPBACK_WATCH_PREFLIGHT_STALE` | **500, fall-through** | **409 Conflict** — INFERRED | Missing |
| 3 | `SNAPBACK_AUTH_HOSTED_ADMISSION_EXPIRED` | **500, fall-through** | **503 Service Unavailable** — INFERRED | Present |
| 4 | `SNAPBACK_ASSET_STORE_UNAVAILABLE` | **500, fall-through for every producer** | **503** for transport/store availability; **500** for integrity/ambiguous-effect producers | Present |

A fifth finding has the right status but the wrong type exposure:

- `SNAPBACK_WATCH_SECRET_ROLLBACK_FAILED`: **500 is correct**, but it is absent from the client union and generated registry.

### 1. `SNAPBACK_WRITER_ACQUIRE_TIMEOUT` — highest consequence

The diagnostic is emitted when the timeout expires before the managed writer guard is acquired. Dropping the waiter also drops its work and retained authority, but details contain only `retryable:true`, omitting `effectCommitted:false`: `origin/lane/migrate9:crates/snapback-server/src/server/writer_gate.rs:102-127`.

It propagates directly through the HTTP `watch_create` handler’s `Result<…, ApiError>` at `origin/lane/migrate9:crates/snapback-server/src/server.rs:26229-26320`. With no mapper arm, it reaches the default 500 at [api_error.rs:1753](crates/snapback-server/src/server/api_error.rs:1753).

**Correct: 503.** It is explicitly retryable server contention, before effect acquisition. Missing `effectCommitted:false` also makes a safely uncommitted refusal look effect-ambiguous.

### 2. `SNAPBACK_WATCH_PREFLIGHT_STALE`

The engine emits `retryable:true` when the permission epoch, function definition, authorization basis, or guarded secret identity changes between preflight and commit: `origin/lane/migrate9:crates/snapback-engine/src/local/engine.rs:23827-23874` and `:38148-38151`.

The engine test establishes both effectlessness and successful fresh retry: the stale attempt leaves no durable watch, then a new preflight succeeds exactly once at `origin/lane/migrate9:crates/snapback-server/src/server/tests.rs:32238-32285`. It reaches the same `watch_create` `ApiError` path and defaults to 500.

**Correct: 409 Conflict — INFERRED.** The confirming analogue is `SNAPBACK_AUTH_RESERVATION_STALE`: it has `retryable:true`, `effectCommitted:false` at [room_authority.rs:2262](crates/snapback-kernel/src/storage/room_authority.rs:2262) and is explicitly grouped under 409 at [api_error.rs:574](crates/snapback-server/src/server/api_error.rs:574). `WATCH_PREFLIGHT_STALE` should likewise expose `effectCommitted:false`.

### 3. `SNAPBACK_AUTH_HOSTED_ADMISSION_EXPIRED`

This is a previously reviewed code, but its route-reachability classification is stale.

Every hosted AppData request calls `admission_epoch_at` before entering the handler and serializes its error through `ApiError`: [server.rs:10595](crates/snapback-server/src/server.rs:10595), [server.rs:12969](crates/snapback-server/src/server.rs:12969). Expired authority is produced at [deployment.rs:686](crates/snapback-auth/src/auth/deployment.rs:686).

The status table nevertheless places it among 500s at [tests.rs:24046](crates/snapback-server/src/server/tests.rs:24046), near commentary claiming the hosted diagnostics do not cross a request path. The governing spec says loss of currency withdraws protected serving until a fresh verified snapshot arrives: [LLP 0098:447](llp/0098-hosted-edge-adapter.spec.md:447).

**Correct: 503 — INFERRED.** This is server readiness/authority availability, not a client authentication failure. It occurs before the requested operation, so 401/403 would also be wrong.

### 4. `SNAPBACK_ASSET_STORE_UNAVAILABLE` — overloaded semantics

This code is route-reachable and always defaults to 500. But its producers span incompatible HTTP classes:

- S3 transport and response-read errors: [assets_s3.rs:147](crates/snapback-services/src/assets_s3.rs:147).
- Public delivery whose blob is unavailable: [asset_reads.rs:132](crates/snapback-kernel/src/storage/asset_reads.rs:132), propagated by [asset_routes.rs:720](crates/snapback-server/src/server/asset_routes.rs:720).
- In contrast, response-construction failures and write-task failures also use the same code: [asset_routes.rs:368](crates/snapback-server/src/server/asset_routes.rs:368), [asset_routes.rs:739](crates/snapback-server/src/server/asset_routes.rs:739).

**INFERRED:** availability/transport instances are 503-class; integrity and ambiguous-write instances can truthfully remain 500. Therefore no single global mapping can represent this diagnostic correctly. The defect is code-level semantic overloading, not merely one missing arm.

### Typed-only gap: `SNAPBACK_WATCH_SECRET_ROLLBACK_FAILED`

When watch creation fails and rollback of the already-installed secret also fails, this diagnostic propagates through the watch route: `origin/lane/migrate9:crates/snapback-engine/src/local/engine.rs:23915-23929`.

The 500 default is appropriate because partial effect is possible. But exhaustive comparison of production additions since the last generated-union update found three missing codes:

1. `SNAPBACK_WATCH_PREFLIGHT_STALE`
2. `SNAPBACK_WATCH_SECRET_ROLLBACK_FAILED`
3. `SNAPBACK_WRITER_ACQUIRE_TIMEOUT`

The lane union’s alphabetical watch section has no entries for the first two at `origin/lane/migrate9:packages/snapback-client/diagnostic-codes.d.mts:3444-3453`; no writer entry exists either.

## Correctly mapped scale

The audited lane’s reviewed HTTP table contains **1,588 unique code/status rows**:

- 1,149 map to non-500 statuses.
- 439 are reviewed as 500.
- Relevant recovery families include 181 mapped to 409 and 104 mapped to 503.

Of those 1,588, this audit found two existing semantic exceptions: hosted-admission expiry and the overloaded asset-store code. Thus **1,586 reviewed rows were not contradicted by the source audit**. Adding the three new route diagnostics gives one additional correct default-500 case and two wrong defaults: **1,587 status-correct/not-contradicted codes versus four status defects** in the broad production inventory.

That is deliberately not presented as an exact route-only denominator: the repository has no route-to-diagnostic inventory, and the reviewed table explicitly includes CLI/internal codes and diagnostics carried inside HTTP-200 envelopes.

The narrower metadata audit is exact: only four distinct server diagnostics on the lane explicitly carry `retryable:true`:

- Correct: `SNAPBACK_AUTH_RESERVATION_STALE` → 409.
- Correct special case: `SNAPBACK_AUTH_STREAM_RESET` → 401, with the client explicitly recognizing retryable 401 at [index.mjs:389](packages/snapback-client/index.mjs:389).
- Wrong: `SNAPBACK_WATCH_PREFLIGHT_STALE` → default 500.
- Wrong: `SNAPBACK_WRITER_ACQUIRE_TIMEOUT` → default 500.

No present `effectCommitted` field contradicts its status. The problem is omission: both new safely effectless retry cases omit `effectCommitted:false`.

## Should a gate have caught this?

Partially—but none of the gates proves the property the audit needs.

- **Generated registry/client union:** The generator scans all carved Rust production roots, including engine and server, at [generate-diagnostics-registry.mjs:60](scripts/generate-diagnostics-registry.mjs:60), and renders every collected code into the client union at [generate-diagnostics-registry.mjs:377](scripts/generate-diagnostics-registry.mjs:377). Its `--check` mode detects stale outputs at [generate-diagnostics-registry.mjs:441](scripts/generate-diagnostics-registry.mjs:441). Therefore it **should have caught all three client-union omissions if run**.

- **`check-inventories.mjs`:** This invokes the guide inventory at [check-inventories.mjs:168](scripts/check-inventories.mjs:168), which runs the diagnostic generator with `--check` at [guide-lib.mjs:1110](scripts/guide-lib.mjs:1110). It likewise should have reported stale generated artifacts.

- **S5 D10 inventory test:** It requires exact equality between discovered literals and the reviewed status table at [tests.rs:24569](crates/snapback-server/src/server/tests.rs:24569). However, under the default `server-owner` feature ([Cargo.toml:14](crates/snapback-server/Cargo.toml:14)), its source walk covers only the server crate—not `snapback-engine`: [tests.rs:21867](crates/snapback-server/src/server/tests.rs:21867). Consequently:

  - It should catch `WRITER_ACQUIRE_TIMEOUT`.
  - It misses both engine-owned watch diagnostics.
  - It asserts neither route reachability nor client-union membership.

- **No status-completeness assertion:** The generator explicitly permits `httpStatus:null` at [generate-diagnostics-registry.mjs:398](scripts/generate-diagnostics-registry.mjs:398). Regeneration would fix the union while silently retaining the runtime 500 defaults.

There is also an independent parser defect: `parseHttpStatuses` uses a regex that does not accept rustfmt-wrapped tuples with a trailing comma and cannot parse the inline 202 row: [generate-diagnostics-registry.mjs:240](scripts/generate-diagnostics-registry.mjs:240). The committed registry consequently reports only **1,030 HTTP-classified codes** at [diagnostics-registry.json:10](guide/reference/diagnostics-registry.json:10), versus the actual **1,588** reviewed rows—a 558-code undercount.

A sufficient gate needs one route-aware manifest joining:

`route → emitted diagnostic → metadata → actual status, including overrides → client union`

It should reject route-reachable `httpStatus:null`, permit default 500 only with an explicit internal-fault classification, validate retry/effect/authority semantics, and parse Rust structurally rather than through formatting-sensitive regexes.

## Default fall-through

The default is unequivocally:

```rust
_ => auth_budget_status(code).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR)
```

at [api_error.rs:1753](crates/snapback-server/src/server/api_error.rs:1753), and `ApiError::into_response` applies that mapper at [api_error.rs:1791](crates/snapback-server/src/server/api_error.rs:1791).

It is a **deliberate fail-safe**, not an accidental default: the source says unknown codes become 500 so a server fault can never masquerade as caller 4xx at [api_error.rs:133](crates/snapback-server/src/server/api_error.rs:133). The oversight is that no complete route-aware gate distinguishes “intentionally internal 500” from “new retryable refusal silently inherited 500.”

**Single highest-consequence instance:** `SNAPBACK_WRITER_ACQUIRE_TIMEOUT`—the server explicitly says retry, the timeout occurs before effect acquisition, yet the HTTP status and missing client type jointly hide both facts.