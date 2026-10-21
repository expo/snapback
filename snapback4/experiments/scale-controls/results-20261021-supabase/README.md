# S1-SB — Supabase native PostgREST W1–W5, 2026-10-21

**PostgREST alone with Supabase JWTs, roles and RLS**, measured on the S1-H topology. This is a native-default data-path comparison, not a complete self-hosted Supabase capacity result. The official stack’s GoTrue and Kong are omitted. PostgREST keeps its default pool of 10; raw PG uses 32 read connections and one connection per writer.

**132 identical cells, 524 rate settings, 1,572 trials, 5,499,918 measured scheduled arrivals.** All arrivals and histograms audit correctly; all cells have passing/failing brackets. Every passing repetition has zero errors and writes require counter equality. **287 overloaded trials have unknown commit outcomes after client timeouts; all are retained and disqualified.** No automatic write retry. [Audit](./audit.json), [all Supabase rows/resources](./ledger.md), [132 rows beside raw PG](./comparison.md), [curves](./curves.json).

Values below are highest tested passing **offered** operations/s, requiring all three repetitions: read p99 ≤ 50 ms, write p99 ≤ 100 ms, errors ≤ 0.1%, plus write-counter equality. Windows are the same 0.5 s warm-up + 2 s measurement. Cohort acknowledgement and completion-window rates/spread are in ledger.json; these are coarse short-window brackets.

Each entry is **Raw PG / Supabase**. For writes, parentheses give configured writers; each headline selects the best configuration, with the smallest writer count breaking ties. Supabase’s pool remains 10 at every writer count.

| Workload, 1m messages | Natural | +0.2 ms | +0.5 ms | +1.0 ms |
|---|---:|---:|---:|---:|
| W1 visible message | 22,627 / 1,414 | 16,000 / 707 | 16,000 / 707 | 11,313 / 707 |
| W2 newest 20 | 11,313 / 1,414 | 8,000 / 707 | 8,000 / 707 | 8,000 / 707 |
| W3 32-room inbox | 8,000 / 1,414 | 11,313 / 707 | 11,313 / 707 | 8,000 / 707 |
| W4 disjoint counters | 18,101 (256) / 800 (16) | 18,101 (256) / 800 (16) | 18,101 (256) / 565 (64) | 18,101 (256) / 565 (32) |
| W5 shared counter | 282 (1) / 141 (2) | 282 (8) / 200 (2) | 282 (2) / 200 (32) | 282 (2) / 200 (16) |
| W5 1% shared mix | 12,800 (256) / 800 (16) | 12,800 (128) / 800 (16) | 12,800 (128) / 800 (32) | 12,800 (128) / 565 (16) |

[Raw PG report](../results-20261021-raw-pg/README.md) and [the full comparison](./comparison.md) retain every size, writer count and delay. The latter also gives matched offered-rate latencies. At natural 1,000/s, read p50s are raw/Supabase W1 0.96/3.67 ms, W2 1.47/4.01 ms, W3 1.24/3.85 ms. The W4 and 1% mix C=32 common rates overload Supabase; their pass flags are shown rather than treating those tails as steady-state overhead.

At the predeclared P1 budget of 32 writers (authorized HTTP operations, not S1b’s SQL-only denominator):

| W4, C=32 | Natural | +0.2 ms | +0.5 ms | +1.0 ms |
|---|---:|---:|---:|---:|
| Raw PG | 2,262 | 3,200 | 4,525 | 3,200 |
| Supabase (PostgREST only) | 800 | 800 | 282 | 565 |

## Versions, configuration and construction

Official **PostgREST 14.18**, pinned by [Supabase compose at 5491fb60bc0f27b8909a83100d79499aa7667ee5](https://github.com/supabase/supabase/blob/5491fb60bc0f27b8909a83100d79499aa7667ee5/docker/docker-compose.yml). The official static Linux x86-64 release archive SHA-256 is `98de1c0be7787aea5f5e11a25f303ea0077634d6fc1000b687bfa825fd27d299`; executable SHA-256 is `e62299f98f67938f754291340b2fc07b69685546e6017b455ef3e776daef45ee`. [Installer](../scripts/install-postgrest.py) verifies both. Installed only under `~/sb4scale/bin` on 450b. [Toolchain](./toolchain.txt).

[Source configuration](../supabase.conf), [every effective setting](./effective.conf), [role settings](./roles.json), [schema/policies/RPCs](../supabase-schema.sql), and [reproduction commands and source rationale](../README.md#s1-sb-supabases-native-postgrest-path). All 132 redacted effective configurations are identical. Pool 10, prepared statements on, JWT cache 1,000, no db-pre-request or db-pre-config hook, in-database configuration and notification listener on, row maximum 1,000, normal committed transactions. Default anon/authenticated/authenticator statement timeouts are 3/8/8 seconds. API/DB-dispatcher/health bind to loopback 58080/58081/58082.

JWTs use HS256, authenticated role, UUID subjects and `request.jwt.claims`. The harness mints them offline; signing secret and token files remain mode 600 outside Git (`~/sb4scale/s1sb-jwt-secret` and `s1sb-jwt-tokens.json`). Harness token expiry is 24 hours so the matrix survives issuance expiry; the normal app setting remains 3,600 seconds. No measured request uses service_role or bypasses RLS. The 256 tokens fit the normal JWT cache.

Only owned `sb4scale_supabase_100000` and `sb4scale_supabase_1000000` databases and standard owned roles were created. API schema `sb4scale` is separate from raw PG; `auth.uid()` reads the claim, and an unexposed pinned-path helper maps UUIDs to the original numeric IDs. The same seed.sql produces identical messages/payloads, memberships/last-read offsets and room/sender totals at both sizes ([fingerprints](./seed-equivalence.json)). Added storage: one UUID column/unique index on 256 users and an owner index on 257 counters. [100k storage](./storage-100000.json), [1m storage](./storage-1000000.json).

W1/W2 call table GETs directly; W3 and W4/W5 call SECURITY INVOKER inbox/increment RPCs. SELECT/INSERT/UPDATE RLS enforces membership, sender and counter ownership. Policy initplans and the recommended membership indexes are present; post-run EXPLAINs show messages_pkey, messages_room_time and memberships_principal_room, plus initplans ([point](./plan-w1.json), [page](./plan-w2.json), [inbox](./plan-w3.json), [counter](./plan-counter.json)). A private definer trigger maintains room/sender totals atomically. No extra HTTP application wraps PostgREST.

## Network, resources and limits

App and generator run on **expo-build-450b** (hostname expose-builder-pixel-a), database on **expo-build-450a**. The unchanged durable PostgreSQL **17.9** cluster remains at `~/sb4scale/pg17`, loopback port **55440**, postmaster **2735539**: fsync/synchronous_commit/full_page_writes on, 8GB shared_buffers, max_connections 320, pg_stat_statements 1.11, jit off for the inherited missing LLVM19 dependency. No cluster restart or configuration change. [Effective PG settings](./postgres.txt).

Exactly S1-H’s allocation: PostgREST + dispatcher + S0 proxy on logical 0–2,6–8; generator on 3–5,9–11; data SSH forwards on 4–5,10–11, sharing generator cores. Each physical PostgREST DB socket, including its notification listener, leases a distinct SSH stream. The dispatcher adds a local TCP forwarding step absent in raw PG; its CPU is charged to the app. The same unchanged S0 per-direction proxy supplies nominal added delay. Prepared SELECT 1 controls measure SSH + proxy independently, excluding dispatcher/HTTP/transactions.

Medians of 66 before/after RTT-control quantiles per delay (not pooled packet percentiles):

| Added RTT | measured p50 / p99 ms | p50 range ms |
|---|---:|---:|
| 0.0 ms | 0.597 / 0.764 | 0.531–0.689 |
| 0.2 ms | 0.878 / 1.090 | 0.827–0.937 |
| 0.5 ms | 1.228 / 1.523 | 1.181–1.410 |
| 1.0 ms | 1.754 / 2.034 | 1.717–1.965 |

Natural-link Supabase headline evidence (latencies are at each workload’s own passing rate):

| Workload | p50 / p99 / p99.9 ms | worst-run p99 ms | app CPU ms/op | DB CPU ms/op | leading sampled active wait |
|---|---:|---:|---:|---:|---|
| W1 visible message | 3.43 / 7.22 / 45.78 | 10.83 | 0.588 | 0.402 | active:-:- |
| W2 newest 20 | 3.97 / 6.92 / 46.24 | 7.59 | 0.682 | 0.518 | active:-:- |
| W3 32-room inbox | 3.94 / 6.41 / 45.84 | 7.12 | 0.620 | 0.736 | active:-:- |
| W4 disjoint counters | 10.11 / 49.87 / 61.47 | 66.91 | 0.695 | 0.715 | active:LWLock:WALWrite |
| W5 shared counter | 9.77 / 61.11 / 70.98 | 96.08 | 0.652 | 1.105 | active:IO:WalSync |
| W5 1% shared mix | 10.83 / 54.69 / 66.98 | 61.24 | 0.665 | 0.675 | active:LWLock:WALWrite |

The captures include app/dispatcher/proxy, generator and data-forward CPU; cluster postmaster/children CPU; wait states/connections; own-database statement, WAL/I/O snapshots; and exact counter witnesses. High-writer cells reach 10 pooled connections plus the notification listener. Idle-in-transaction ClientRead samples occur on reads; WALWrite/WalSync samples on writes support protocol/durable-flush attribution. No isolated test separates pool, dispatcher, RLS, JWT or transaction-protocol contributions. `perf_event_paranoid=4` prevents stack profiling.

The reporter aggregates duplicate query IDs across role/toplevel rows **before** differencing. This postprocessing correction preserves captured data and all rate decisions. Nested RPC executor times can overlap, SQL counts are not wire-roundtrip counts, executor time is not CPU, sample edges undercount CPU, cluster WAL/CPU can include background work, and some asynchronous PG counters lag short windows. [Derivation hashes](./derivation.json) bind the report/plot tools and raw-PG source ledgers.

## Scope and validation

- PostgREST-only native data path, not the official complete self-hosted stack: no Docker, GoTrue auth tables/sessions/login, Kong/API-key gateway, Realtime, Storage, Studio or Supavisor. The existing native PG cluster substitutes for Supabase’s Postgres image. Kong would add an HTTP gateway hop; its overhead is **unmeasured**, not estimated or included. Offline JWT issuance is the stated GoTrue substitution; verification, claims and RLS run normally. No TLS or replication. W6/live is outside scope.
- Same two shared fleet hosts and core split as S1-H, rather than an idle three-host qualification. No advocate review under the explicit one-worker/no-sub-agent instruction. No co-located 0.05 ms reference, matched-pool control or long-duration soak. These are configuration-specific exploratory brackets, not a system-wide product ceiling.
- Short serial windows and coarse rate steps produce substantial non-monotonic spread: e.g. W5 shared passes 141/s naturally and 200/s at added delay; disjoint/mix best writer counts also vary. This does not establish that added RTT helps or that a 1% hot key improves capacity. Every trial remains, including 241 latency-only failures.
- Release build, Clippy with warnings denied, native authorization/JWT/atomic-maintain/overload checks, seed equality, RLS plans, full matrix audit and LLP references pass. [Checks](./checks.json), [validation](./validation.json), [secret audit](./password-audit.json). Plots: [read curves](./read-curves.svg), [write brackets](./write-brackets.svg).
- All 10,422 recorded matrix children exited; check/smoke/inspection children also exited. No PostgREST API sessions remain. [Cleanup summary](./process-summary.json), [matrix PID ledger](./pids.jsonl). All raw subprocess/remote-monitor PID records live in the archive. Only the existing cluster remains running; both Supabase fixture databases and owned roles are retained. No push, clone, stash, sub-agent, sudo, paid service or unrelated 450a work.

Raw per-cell data is excluded from Git. [ARCHIVE.md](./ARCHIVE.md) records the compressed archive, SHA-256, contents and extraction command. The measurement source is commit `2a249acb06`; measurement binary/source hashes are in ownership.json. The report and README contain no publication, full-stack, idle-host or advocate-reviewed capacity claim.
