# Snapback 4 public-catalog reads — 2026-09-13

This is a warm, local HTTP microbenchmark on actual Snapback 4, Convex and
Supabase backends. It is not the independent Clique bakeoff, a hosted latency
comparison, or a write/durability/SDK benchmark. The overall performance goal
remains open.

## Fixture and instrument

`node snapback4/scripts/measure-storage.mjs --catalog-init NEW_DIRECTORY`
generates all three schemas, public-read operations and the identical JSONL
seed. The default fixture has 100,000 products, 100 categories, unique SKUs,
and prices unique within each category. A point returns the same four public
fields; category pages return the same ordered 50 rows and a continuation.
All writes are administrative seeding and excluded from timings. Snapback uses
a real guest token, Supabase its anonymous role through the normal Kong and
PostgREST path with public SELECT RLS, and Convex public queries. Administrative
credentials are never used for measured reads.

Every run first reads and validates every stored row, in SKU order, through
the actual backend. The generated and returned JSONL both hash to
`6c9bc309a27c997195934c60ba65c65c1417c425056eb42e663d23a10ffb399f`.
Every timed response is checked against expected records or absence; Snapback
must also say `complete: true`. No partial result or request failure counts
as a successful sample.

The measurement instrument SHA-256 is
`1537193eadf44c24c4208550d5e0b14cbd1e58acb02313fb7c702312ab15a02c`.
Run it with `--catalog snapback4|convex|supabase --rows 100000 --samples 500
--trial N`, `SB4_CATALOG_URL` set to the appropriate loopback HTTP URL, and
`SB4_CATALOG_METADATA` pointing to public deployment metadata. Supabase also
needs `SB4_CATALOG_KEYS` pointing to a private local CLI status JSON file.
The script refuses non-loopback endpoints and does not deploy or seed during
measurement. The local Supabase CLI also needs Docker on PATH.

## Environment and procedure

Office M1 Max, Colima VZ ARM64 Linux, four vCPUs, 12 GiB RAM, 40 GiB disk.
Each backend uses a native VM Docker volume for its database. The Node
24.18.0 ARM64 HTTP runner shares the VM network, so it reaches every backend
via loopback. No browser, reverse proxy added for Snapback or Convex, CPU
emulation, database reset, or disabled backend result cache. Supabase's normal
local gateway remains in its path. Other backends stay idle during measured
runs. CPU resources are shared with the load generator; throughput is
client-observed and includes response validation and scheduling.

Convex CLI 1.45.0 and the official self-hosted backend image digest
`sha256:69885bae73766f625404a5425b22702341e89b43002f1d700864f8364be0d1f8`.
Supabase CLI 2.117.0, Postgres 17.6.1.167, PostgREST v16.2, Kong 2.8.1;
all image digests and architectures are retained in the raw metadata.
Snapback uses its file-backed SQLite WAL/NORMAL defaults; Supabase retains
its default Postgres durability. Only reads are compared.

There are 500 timed requests per case in each of three trials. Point and
continuation cases have 30 warmups; category cases warm all 100 category keys
before timing. Distinct point keys use a seeded permutation with different
slices per concurrency case and trial; missing keys also vary by trial.
`pointHot` and `categoryNextHot` repeat one key; category-first cases cycle
100 warmed keys. Backend caches remain enabled. Warmups are sequential;
concurrent cases include their initial connection-pool expansion. This is a
warm-database request batch, not a cold-I/O or open-loop saturation claim.

Initial order: Snapback/Convex/Supabase, then Convex/Supabase/Snapback, then
Supabase/Snapback/Convex, trials 0–2. A later Snapback-only batch repeats the
same trial keys after the HTTP change. That before/after is consecutive
batches, not randomized A/B. Correctness smoke runs are excluded: the Convex
and Supabase smoke processes briefly overlapped. Their trial-1000 point-key
slices do not overlap the formal trial-0–2 slices.

## Initial matched runs and HTTP change

Both Snapback batches use source `76983a4058ab44dbcee733f112377782090b20a2`,
version 0.1.14 and rusqlite 0.32; the candidate additionally coalesces JSON
HTTP headers and body into one write for prebuffered requests. Its
`httpSourceSha256` and `binarySha256` identify the exact measured artifact.
The original response-before-body-drain order is retained for Expect,
chunked/streaming bodies, large Content-Length and upgrade requests. The
optimization adds one transient response-sized buffer for JSON; asset
streaming is unchanged.

Medians of the three per-run percentiles; milliseconds:

| Case | Snapback before p50 / p95 | Snapback after p50 / p95 | Convex p50 / p95 | Supabase p50 / p95 |
|---|---:|---:|---:|---:|
| Repeated point | 3.321 / 4.240 | 3.647 / 6.912 | 3.366 / 5.769 | 5.043 / 10.825 |
| Distinct point, C1 | 3.764 / 6.741 | 3.475 / 5.942 | 7.992 / 15.854 | 4.614 / 8.930 |
| Distinct point, C8 | 4.740 / 11.281 | 4.041 / 8.075 | 22.915 / 51.066 | 8.225 / 15.874 |
| Distinct point, C32 | 16.887 / 42.528 | 16.344 / 34.724 | 81.251 / 135.284 | 24.631 / 48.833 |
| Distinct missing point | 3.114 / 6.729 | 3.369 / 5.179 | 7.305 / 12.332 | 5.424 / 13.016 |
| Repeated 50-row page, C1 | 27.781 / 55.684 | 4.186 / 6.859 | 3.517 / 5.676 | 5.687 / 10.206 |
| Repeated 50-row page, C8 | 45.820 / 54.973 | 8.052 / 21.697 | 5.542 / 17.110 | 12.393 / 22.289 |
| Repeated continuation | 27.522 / 55.390 | 4.163 / 6.834 | 3.854 / 6.852 | 6.526 / 11.604 |

The isolated HTTP change reduced category-first p50 from 27.781 to 4.186 ms
and p95 from 55.684 to 6.859 ms. Concurrent category pages and continuation
pages also improved. Small point differences are not asserted as wins or
regressions from this batch: shared-machine variation is visible, and the
point-hot p50 moved from 3.321 to 3.647 ms. Convex retains a category-cache
advantage; this record does not claim Snapback wins every measured case.

All 12 formal raw records are in
[`snapback4/metrics/storage.jsonl`](../../../snapback4/metrics/storage.jsonl),
with `workload: public-catalog`, trial 0–2, and timestamps beginning
2026-09-13T05:21 through 05:30 UTC. The baseline records have no
`metadata.sourceDelta`; the three candidate records have one. Each includes
verified count/hash, instrument hash, backend metadata and sample counts.

The updated instrument and transport each received independent read-only
review. The transport's tests cover persistent small/large/chunked responses,
HEAD, no-content and error status, plus early responses before unread
Content-Length/Expect bodies. Those tests passed on Darwin and Linux ARM64.
Final integration and publication qualification are recorded below when run.

## Work remaining

The next integrated measurements must include main's newer SQLite dependency.
Cached category reads remain a concrete optimization target. Broader coverage
still includes private authorization, writes with matched durability, feeds,
joins, counts, realtime fanout, reconnect/offline, search, files, scheduled jobs,
SDK/UI costs, and hosted network conditions. This catalog does not stand in
for those workloads.
