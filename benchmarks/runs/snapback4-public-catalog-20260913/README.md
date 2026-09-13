# Snapback 4 catalog HTTP performance — 2026-09-13

The public-read batches below are warm, local HTTP microbenchmarks on actual
Snapback 4, Convex and Supabase backends. A private extension also validates
owned reads and atomic, replay-safe updates. These are not the independent
Clique bakeoff, a hosted comparison, an SDK benchmark or evidence of matched
power-loss durability. The overall performance goal remains open.

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

The public batches through trial 17 use instrument SHA-256
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
Convex's `/version` endpoint reports `unknown`; the image digest is the
server pin. The configured query/mutation concurrency is 16, matching the
[official self-hosted Compose defaults](https://github.com/get-convex/convex-backend/blob/main/self-hosted/docker/docker-compose.yml).
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
Final integration and publication qualification follow below.

## Integrated 0.1.15, trials 3–5

Source `2063884c8fd40c672158d4b4e3187864192db11c`, rusqlite 0.40.2,
release ARM64 Linux binary SHA-256
`769c422d8723970609d081268c8871cca216d8f027e4f30279bc0724559ddeb4`.
The HTTP source hash is
`2f5becc8f15cd328e9e6554157141c56281c188f9df5e911181e24e09f714108`.
All nine runs reverified all 100,000 rows; no response failed its assertion.
Backend order rotates as before. Trials 3–5 use present/missing point keys
that do not overlap trials 0–2 or the smoke slices. The same instrument,
fixture, Node runtime, VM and competitor images apply. These nine additional
raw records are in `metrics/storage.jsonl`, selected by `trial: 3–5` and
`workload: public-catalog`.

Medians of the three per-run percentiles, in milliseconds; RPS is the
median per-run client-observed throughput:

| Case | Snapback p50 / p95 / RPS | Convex p50 / p95 / RPS | Supabase p50 / p95 / RPS |
|---|---:|---:|---:|
| Repeated point | 3.158 / 4.277 / 307.7 | 3.479 / 7.827 / 239.6 | 5.829 / 11.395 / 153.3 |
| Distinct point, C1 | 3.150 / 4.684 / 297.0 | 7.782 / 13.524 / 116.4 | 5.256 / 10.332 / 155.3 |
| Distinct point, C8 | 3.742 / 7.082 / 1531.0 | 20.231 / 38.165 / 359.9 | 8.132 / 14.352 / 915.3 |
| Distinct point, C32 | 16.086 / 35.540 / 1648.0 | 70.225 / 108.933 / 426.6 | 29.036 / 53.924 / 1003.7 |
| Distinct missing point | 2.924 / 3.855 / 336.6 | 7.605 / 12.960 / 118.0 | 5.289 / 7.199 / 183.0 |
| Repeated 50-row page, C1 | 4.147 / 6.586 / 211.4 | 3.818 / 6.667 / 230.5 | 5.542 / 8.695 / 165.7 |
| Repeated 50-row page, C8 | 6.177 / 11.988 / 1163.5 | 5.186 / 10.186 / 1281.5 | 10.323 / 19.145 / 690.4 |
| Repeated continuation | 3.979 / 5.608 / 231.8 | 3.731 / 6.304 / 237.8 | 6.264 / 10.943 / 143.3 |

Snapback records lower aggregate p50 and p95 than Supabase in all eight
cases in this local warm-read fixture. Its point cases also have lower
p50/p95 than Convex here; Convex retains lower p50 on all three repeated
category/continuation cases. Tiny differences are descriptive, not a
statistical declaration of a platform win. At C8, Convex's category page
p50 is 5.186 ms versus Snapback's 6.177 ms, with higher throughput too.
That is an outstanding measured target.

The integrated full Snapback suite passed with zero failures in 72 s on its
first integrated run. The publication repeat also took 72 s; this exceeded the
60s budget on both runs, so the cause is not attributed to first-time compilation. Reference validation
passed (467 LLPs, 8,674 refs, no errors). The Linux transport/version tests
passed; the release build used `--locked`. Integrated code and the initial
evidence table received independent review with no material findings. The
publication path repeated the suite with zero failed assertions, then passed
the installed-consumer proof and published `snapback4@0.1.15` and
`snapback4-darwin-arm64@0.1.15` at 2026-09-13T05:49:06.874Z. Both versions and
their integrity values were verified in the npm registry. Publication took
188.3 s; the client tarball is 56,905 B and the Darwin ARM64 binary 8,103,840 B.
The persistent suite-budget overrun is tracked as
[a P0 timing issue](../../../issues/closed/20260913-snapback4-blocking-suite-over-60-seconds.md).

Registry integrity:

- Client: `sha512-6gww1IapOLZC+5paVZUqhVNmPu/pJt1zMC7IGIbjv57HTzYAHRBbWOHf5PFQzt8iWE6SY5XcJ//v0+m/acw7mw==`
- Darwin ARM64: `sha512-iVBp4pQuV7se1vz66B5+sjkyB++TOMV8X0Xnvf4czUq4XsaOZ01jejpDPsXVlDj+ZKB/g2rFI4GClV32XcUwnQ==`

## Borrowed JSON and connection dispatch experiments, trials 6–11

The same instrument and Linux ARM64 VM were used for six alternating pairs,
now with **1,000 timed samples per case**. Every run reverified all 100,000
rows and checked every timed result. The twelve records are appended to
`metrics/storage.jsonl` with explicit `experiment` and `variant` fields.
These are within-Snapback experiments, not fresh competitor comparisons.

Trials 6–8 compare 0.1.15 with borrowed query-reply serialization. Trial order
was control/borrowed, borrowed/control, control/borrowed. In a separate direct
profile of 5,000 samples after 100 warmups, encoding a 50-row page fell from
98.750 µs p50 / 119.375 µs p95 to 14.708 / 16.084 µs. Point encoding fell from
2.125 / 2.500 µs to 0.541 / 0.667 µs. Every encoded result was byte-identical
to the old encoding. The profile times only encoding an already evaluated
result, old encoding then borrowed encoding for each pair; it does not include
network, scheduling, authorization or query work.
The larger HTTP comparison found multi-second tails in both builds and no
uniform p50/p95 improvement. Faster encoding alone does not resolve those tails.

Source inspection isolated an inherited tiny_http 0.12.0 dispatch race: several
accepted persistent connections can be queued against the same notified idle
worker. Workers remain busy on their assigned keep-alive connection, leaving
surplus accepts waiting for one to close. The candidate also counts queued
work when reserving idle workers. A deterministic five-arrival/four-waiter
test fails with the original predicate and passes with the fixed predicate;
all ten tests in the prepared library copy pass. An initial short raw-socket
burst experiment did not reproduce the stall; the forced dispatch interleaving
and longer HTTP runs did.

Trials 9–11 isolate this allocation predicate. Both variants include borrowed
JSON and the same metadata/session prepared-statement reuse; only the fixed
variant uses the temporary dependency override. Order was fixed/control,
control/fixed, fixed/control. The HTTP experiment used the one-line predicate
before extraction of the reviewed private dispatch helper and regression test.
The fixed records correct the runner's inherited `--locked` build label: the
actual release build used a command-line path override. Each record includes
the binary hash and source delta from the published source pin.

Medians of three per-run percentiles and throughput; latencies are milliseconds:

| Case | Control p50 / p95 / RPS | Fixed pool p50 / p95 / RPS |
|---|---:|---:|
| Repeated point | 3.057 / 5.258 / 292.7 | 3.587 / 7.229 / 241.9 |
| Distinct point, C1 | 3.584 / 6.908 / 252.0 | 3.294 / 5.959 / 263.3 |
| Distinct point, C8 | 3.387 / 5.981 / 215.2 | 4.217 / 10.392 / 1528.8 |
| Distinct point, C32 | 13.879 / 32.611 / 1579.4 | 13.194 / 36.635 / 2002.3 |
| Distinct missing point | 2.991 / 5.773 / 292.5 | 3.157 / 5.275 / 286.2 |
| Repeated 50-row page, C1 | 3.493 / 5.914 / 249.8 | 3.586 / 5.859 / 246.4 |
| Repeated 50-row page, C8 | 5.433 / 14.463 / 1062.3 | 4.372 / 9.225 / 1557.4 |
| Repeated continuation | 3.702 / 5.995 / 245.2 | 3.564 / 5.463 / 253.6 |

The point-C8 controls have maxima of 4,644.890, 4,172.665 and 5,268.025 ms;
the corresponding fixed runs have maxima of 16.750, 28.525 and 51.156 ms.
Five of nine control cases with concurrent clients had multi-second tails;
zero of nine fixed cases did. Across all **24,000 fixed timed requests**, no
latency exceeded 117.959 ms and no assertion failed. This is a stall and
throughput gain, not a uniform quantile gain. Stranded connections reduce
effective concurrency, so apparently better control p50/p95 can coexist with
much worse completion time. Connection expansion remains inside the measured
interval, as it was in the original protocol.

The author approved the pool change's reproducible
vendored package and one new Cargo manifest on 2026-09-13. Main then landed an
existing vendor copy with a bounded unread-body drain. The 0.1.16 integration
adds the reviewed pool helper/test there and retains the drain fix, response
ceiling and newly added query metadata. No second vendor copy or manifest is
introduced. The earlier profile/HTTP experiments predate those other main
changes and do not qualify the integrated candidate's latency. The
[resolved transport issue](../../../issues/closed/20260913-snapback4-keepalive-connection-pool-stalls.md)
records the prepared fix, review, integrated qualification and landing.

## Integrated 0.1.16 production profile, trials 12–14

The integrated runtime source is
`43569823cf89d6e685fd4cf2712a2e6b8c4cae92`, including main's atomic activation,
strict decoding, bounded responses and unread-body drain corrections. The
Linux ARM64 binary SHA-256 is
`6705674aefffa2794a6d7c70567ce4b5603fa1b64620cc69739cc6e14e457d02`.
It uses the same `production` profile now selected by publication: size
optimization, fat LTO, one codegen unit, abort on panic and stripped symbols.
The retained server pathname contains `release`, but the installed artifact
was copied from `target/production`; the raw metadata records this explicitly.
Earlier batches used the release profile and predate other main changes, so
this batch is not an isolated before/after estimate of any one optimization.

All three backends were rerun with 1,000 timed requests per case, the same
instrument, runtime, verified fixture and competitor images. Trial order was
Snapback/Convex/Supabase, Convex/Supabase/Snapback, then
Supabase/Snapback/Convex. The nine raw records have `trial: 12–14`, timestamps
2026-09-13T07:47 through 07:53 UTC and `workload: public-catalog` in
`metrics/storage.jsonl`. Every run reverified all 100,000 rows. All 72,000
timed responses passed their assertions; connection-pool expansion remains
inside the measured interval.

Medians of three per-run percentiles and client-observed throughput;
latencies are milliseconds:

| Case | Snapback p50 / p95 / RPS | Convex p50 / p95 / RPS | Supabase p50 / p95 / RPS |
|---|---:|---:|---:|
| Repeated point | 3.320 / 6.574 / 262.8 | 3.171 / 5.780 / 274.5 | 4.181 / 8.266 / 208.2 |
| Distinct point, C1 | 3.290 / 6.589 / 253.2 | 6.954 / 14.045 / 124.2 | 3.647 / 4.772 / 263.8 |
| Distinct point, C8 | 3.638 / 5.347 / 2091.6 | 22.963 / 54.175 / 296.1 | 7.708 / 19.529 / 867.8 |
| Distinct point, C32 | 22.657 / 68.107 / 1010.7 | 79.282 / 141.503 / 370.3 | 27.568 / 61.805 / 989.7 |
| Distinct missing point | 3.319 / 6.364 / 265.1 | 7.093 / 15.254 / 118.7 | 4.509 / 9.170 / 185.3 |
| Repeated 50-row page, C1 | 3.423 / 5.819 / 263.3 | 2.913 / 6.237 / 263.2 | 4.903 / 9.606 / 169.7 |
| Repeated 50-row page, C8 | 8.517 / 20.859 / 792.4 | 4.612 / 11.342 / 1278.5 | 9.474 / 20.329 / 736.0 |
| Repeated continuation | 3.761 / 6.072 / 227.1 | 3.548 / 6.057 / 245.2 | 5.037 / 7.460 / 182.6 |

None of the 24,000 timed Snapback requests had a multi-second stall; the
maximum was 124.371 ms. Snapback's aggregate p50 is lower than Supabase's in
all eight cases, but Supabase has lower p95 in distinct-point C1, point C32
and category-page C8. Convex has lower p50 on repeated points and all three
category/continuation cases. Its category-page C8 throughput is 1,278.5
requests/s versus Snapback's 792.4. These are remaining targets, not an
overall platform win; the 0.1.15 eight-of-eight p95 result does not describe
this newer candidate. Three runs on a shared VM do not establish the
significance of small differences.

The combined dependency's twelve library tests passed on Linux. Current
Darwin checks passed three HTTP/version tests, six real-HTTP body/output
bound tests and the SQLite-free core build. Linux passed the Rust workspace,
typechecks/build and client tests; its React browser lifetime group was
skipped because Chromium is unavailable. A missing shared fixture pack was
copied from the committed repository and all nine fixture tests passed on
rerun. These separate checks are not a single passing timed Linux suite.
The complete Darwin publication suite subsequently passed in 112 s: all Rust
groups, nine fixture tests and all 94 client tests, with no skips. Its
fifteen-test simulator group took 10.24 s. A sampled pre-main loader pause
recurred, and the 60 s budget issue remains open. References
validated with 471 LLPs, 8,682 references, zero errors and zero unchecked.
Independent source review found no material issue in the integrated runtime.

The runtime and comparison record landed at `d5215e6d2`. The existing
publication path then passed its installed-consumer proof and published
`snapback4@0.1.16` and `snapback4-darwin-arm64@0.1.16` at
2026-09-13T08:14:25.337Z. Registry metadata and downloaded tarballs were
verified independently, including the exact production binary hash and
upstream dependency notice. The Darwin ARM64 binary is 2,727,360 B, SHA-256
`f419528dbb1c2cff73cc98547cbcdc3969d526e1b299ce39406ee1c180911429`.
The client tarball is 72,025 B and the platform tarball 1,669,125 B.
Publication took 451.8 s. Pre-main loader pauses were sampled in the version
probe and the installed CLI's `/usr/bin/env` launcher as well as the test
process; no underlying macOS cause is claimed. This host's launch delays
are separate from the Linux HTTP comparison.

Registry integrity:

- Client: `sha512-Cb+nAvlQvpNoQ7GoU9u3V/WfjJALW5CjDehjpFT5VQjn2TDz507RbKu0qpwsjg7L9RUEmfbYKuVpVOs5FIrahw==`
- Darwin ARM64: `sha512-96bYjuhvRsjITJKbyspan21MyQpeQYAXdMY5NKwFBJzQc2llHTmDeWr8C2dEDptLfqbAH+2nBFsnh3OiqvdPZg==`

## Compiler optimization comparison, trials 15–17

This experiment changes only the production optimization level from `z` to
`3` on runtime source `43569823cf89d6e685fd4cf2712a2e6b8c4cae92` (0.1.16).
Both binaries use Cargo 1.97.0, fat LTO, one codegen unit, stripped symbols
and abort on panic. Build selection was identical:
`cargo build --locked --profile production -p snapback4 -p snapback4-core --bin snapback4 --example profile_production`;
the speed build additionally used `--config 'profile.production.opt-level=3'`
and a separate target directory. The temporary profiling example is not a
shipped target. The size build matches the published-profile Linux hash above.
The speed binary is 5,787,152 B, SHA-256
`c6fd609bbcaaada6339a95c4b2abd25824701e16af71cc163766d2d624f919cb`:
2,490,216 B (75.5%) larger than the 3,296,936 B control. Both remain below
the recorded PocketBase server-size anchor. These are Linux executable
sizes; they do not predict Darwin tarball or native-library size.

The same eight public-read cases, 100,000 verified rows and unchanged
instrument (`1537193e…`) ran with 1,000 timed samples per case. Order was
z/3/Convex/Supabase, Convex/Supabase/3/z, then Supabase/z/3/Convex. The twelve
raw records in `metrics/storage.jsonl` have `experiment: compiler-optimization`,
`variant` and `trial: 15–17`. All 96,000 timed responses passed their
assertions, including connection expansion. The retained public server was
restored to the size build after the experiment.

Medians of three per-run percentiles and throughput; latencies in milliseconds:

| Case | Size z p50 / p95 / RPS | Speed 3 p50 / p95 / RPS | Convex p50 / p95 / RPS | Supabase p50 / p95 / RPS |
|---|---:|---:|---:|---:|
| Repeated point | 5.115 / 13.123 / 160.3 | 3.620 / 6.188 / 238.6 | 3.680 / 5.989 / 234.2 | 4.893 / 10.383 / 163.6 |
| Distinct point, C1 | 4.208 / 10.196 / 204.3 | 3.065 / 5.053 / 272.5 | 8.571 / 14.574 / 105.5 | 5.076 / 9.144 / 176.1 |
| Distinct point, C8 | 14.409 / 32.380 / 487.0 | 3.801 / 7.092 / 1857.2 | 21.225 / 40.032 / 348.9 | 10.264 / 22.990 / 660.8 |
| Distinct point, C32 | 35.771 / 74.167 / 801.8 | 14.786 / 33.498 / 1884.3 | 78.977 / 151.031 / 367.3 | 29.594 / 57.096 / 984.8 |
| Distinct missing point | 3.876 / 5.165 / 250.9 | 3.368 / 4.986 / 278.7 | 8.988 / 13.701 / 105.2 | 5.783 / 12.707 / 147.5 |
| Repeated 50-row page, C1 | 5.732 / 9.493 / 150.9 | 4.381 / 5.512 / 216.6 | 4.222 / 7.162 / 212.6 | 5.418 / 6.924 / 172.4 |
| Repeated 50-row page, C8 | 13.611 / 29.999 / 513.2 | 8.122 / 14.194 / 874.4 | 4.852 / 10.407 / 1361.4 | 11.610 / 18.800 / 655.5 |
| Repeated continuation | 4.652 / 5.568 / 208.2 | 4.324 / 7.656 / 204.5 | 3.906 / 6.645 / 227.4 | 6.917 / 13.751 / 114.5 |

The speed build has lower median p50 in all eight cases and lower p95 in
seven compared with the size build. Continuation-page p95 rises 37.5%, and
its throughput falls 1.8%. Shared-host variance is substantial: point-C32
p50 is 18.084/35.771/60.493 ms for z and 14.575/14.786/51.116 ms for 3.
Three trials do not establish precise causal percentage improvements or a
universal regression in the exception. Maxima are 184.362 ms (z), 149.640 ms
(3), 247.143 ms (Convex) and 321.526 ms (Supabase); there are no observed
multi-second stalls. The speed build's aggregate p50/p95 beat Supabase in
this batch's eight cases, while Convex still leads cached category-page and
continuation p50. Its page-C8 throughput remains 1,361.4 versus 874.4
requests/s. This is still a warm, local public-read comparison.

An isolated profile on a separate copy of the current database used three
alternating z/3 pairs, 100 warmups and 5,000 samples per operation. Median
point-query p50 fell from 107.875 to 85.333 microseconds, category-query p50
from 724.335 to 430.584, and the 51-row transactional store scan from 387.709
to 241.917. Borrowed encoding of the same six-field category answer fell
from 64.250 to 13.000 microseconds, with byte equality asserted against the
earlier JSON-tree encoding on every sample. These isolate query and encoding
costs; they do not measure the bounded HTTP writer or network path. Raw
profile observations use `workload: catalog-core-compiler-profile` in the
same metric file. The fresh opt3 target build took 5m57s; the z build reused
its target. This is not a matched warm-build comparison or evidence that
the five-minute warm-build budget passes.

The production server selects level 3 on this evidence. The wasm profile
retains z, and both `build-xcframework.sh` and `measure-native.sh` explicitly
select z for native device libraries. The incremental release profile is
unchanged. Qualification of the shipping artifact remains separate from
these Linux experiment binaries.

The integrated 0.1.18 candidate (`68fc5371f`, over the published 0.1.17)
passed the existing publication dry run: 136 Rust tests, 96 client tests and
nine fixture-wrapper tests, with no failures or harness skips, followed by
the installed-package typecheck and query/write/offline-admission checks.
The suite took 776 seconds on the shared Mac; sampled processes paused at
`_dyld_start` before test code. This is not a 60-second loop-budget pass or
an underlying OS-cause diagnosis. The complete dry run took 1,027.3 seconds.
The installed production Darwin executable is 5,491,680 B, SHA-256
`d0205dd042499e886cc4c3eeb0408a1f9c117953abfc66e62a6890eb23095203`;
its Cargo record confirms optimization level 3. The separately built Linux
executable is 5,787,152 B, SHA-256
`d1fc80e3dc977d022e43c12dc7cc60b7f741c470f04e6e4c3f5ff41b45f7a7be`.
Both actual executables compile the generated public and private catalog
fixtures without problems. These checks qualify the new artifacts; the
historical timings above remain bound to their recorded 0.1.16 binaries.

Main then gained native jobs and the unified Rust device in 0.2.0. The
reviewed compiler change landed over that work as `87dcac33c`; 0.1.18 was
not published. The existing publication path published **0.2.1** at
09:55:18 UTC, with optimization level 3 in the actual Cargo artifact record.
Its updated suite passed 141 Rust tests (one existing long native-job
ceiling/rollback test at the 8,192-write limit ignored), 60 client tests and nine fixture-wrapper
tests, with zero failed stages and no JavaScript skips. The suite took
92 seconds, still above the 60-second loop budget; the complete publication
took 209.2 seconds. The installed-package typecheck and query/write/offline
checks passed.

The separately invoked ignored native-job ceiling/rollback test subsequently
passed on this 0.2.1 source under the Linux production profile: one passed,
zero failed or ignored, seven filtered out, in 14.41 s after compilation.
It attempts 9,000 writes, verifies the 8,192-write ceiling parks the job with
`E_BOUND`, and verifies that the chunk's writes roll back. This supplements
the publication suite; it does not change that suite's recorded skip count.

The published Darwin executable is 7,101,584 B, SHA-256
`b892c68d95e08f1d49ee9112406180cad4e3fdffbcc734600d211ba6df035703`.
The client tarball is 362,126 B and the platform tarball 3,397,409 B. Both
registry archives were downloaded and verified against their registry
integrity values; the platform binary matches the qualified artifact and
includes the tiny_http MIT notice. The downloaded executable compiles both
catalog fixtures. The client archive includes the new upstream wasm device;
these package sizes are not a measurement of the earlier TypeScript client.
The corresponding Linux executable is 7,622,208 B, SHA-256
`98d1fad68c4c4a4e77384e64885a4402a480dd0cace5fe67ccbd5b6296f0bbee`,
built from `6f4004a9f`, whose runtime is byte-identical to the landed source
(the later rebase adds publication records and an asynchronous test wait).
It also compiles both catalog fixtures. Its build took 6m21s with newly
introduced native-job dependencies; this is not a matched warm-build result.

## Private catalog extension and correctness smokes

`--private-catalog-init NEW_DIRECTORY` extends the existing instrument with
schemas and operations for private data. The logical seed adds
`ownerSlot = floor(n / 100) % 2` and `revision: 0` to each public product:
two owners have 50,000 rows each and 500 rows per category. Initial normalized
JSONL SHA-256 is
`fdf373afc5317df2b7c44cd4c169e424dd3da5bf7acf614cfc1ef598dc113057`.
Administrative setup maps the owner slots to real principals and imports the
fixture. Queries return SKU, category, price, title and revision through
owner-leading indexes. Owner, SKU, category, price and title are immutable.

Snapback uses real guest bearer sessions and viewer-derived rules. Convex
uses a disposable RS256 issuer, an audience and a public JWKS data URI;
every operation obtains its owner from verified identity. Supabase uses
ordinary local Auth password logins, native ES256 user JWTs and a low-privilege
API key, with SELECT/UPDATE RLS keyed to `auth.uid()`. Issuance is untimed;
the private runner never uses administrative credentials. The generated SQL
revokes default broad privileges before granting SELECT and column-specific
UPDATE. Its receipt schema stays outside the REST API and GraphQL search
path. In this actual local instance, SQL and the HTTP endpoint confirm that
the GraphQL extension is disabled; a real request selecting the private REST
schema returns 406. No GraphQL performance result is implied.

The update atomically increments a non-indexed revision and returns the new
value. Each backend records success or NOT_FOUND by `(principal, operationId)`
in the same transaction. Convex uses an indexed absence read plus insertion
in its mutation transaction. Supabase uses an invoker-rights, VOLATILE RPC,
a unique receipt claim and an atomic SQL increment. Reusing an ID with a
changed payload replays the original outcome. Successful replays are timed
separately from fresh C1/C8 updates; warmup writes also make real changes.
Every formal trial must begin with the pristine revision-zero fixture and
empty operation receipts.

Run `--private-catalog BACKEND --rows 100000 --samples N --trial T` with
`SB4_CATALOG_URL`, public `SB4_CATALOG_METADATA`, and `SB4_PRIVATE_SESSIONS`
pointing to a private JSON file. That file supplies `backend`, three
`sessions` (`principal` and `token`, in two-owner/outsider order), Supabase's
low-privilege `apiKey`, a validly signed expired `expiredToken`, and optional
non-secret `publicMetadata`. Keep credentials outside tracked files. The
output records actual auth and deployment metadata and whether expiry was
checked. It prints one JSON record; private results are retained explicitly
after inspection. Backend caches remain enabled; both owners' category keys
are warmed, with concurrent connection expansion inside timing.

All three 100,000-row correctness smokes passed with 50 samples in each of
eleven cases (550 timed calls per backend), plus untimed ownership,
pagination and mutation checks. They used private instrument
`d92311e8d2bd6c750d301f5da2c3db9e4415ab0aa64f2482526b867c814c8822` and the
existing 0.1.16 size-profile Snapback binary. The actual full partitions were
verified before and after, including the outsider's empty partition. All
three final normalized hashes equal
`acd0715b81c62a4cd4249d8f20c6184cac856d88224e4800f6ed936c817bcfd7`.
Checks covered cross-owner reads/cursors, forged owner arguments, missing,
malformed, tampered and expired credentials, Supabase immutable-column PATCH
refusal, original successful/failed outcomes, principal-scoped IDs, eight
contended increments and eight concurrent attempts with one ID. Expired
Supabase tokens use the native signing key and ordinary user claims, with
expiry forced one hour into the past solely for the untimed refusal check;
timed calls use ordinary Auth-issued access tokens.

These smoke timings are excluded from comparative conclusions. The appended
records are labelled `experiment: private-catalog-smoke`; the formal
comparison follows below. Writes use
each backend's defaults: Snapback serves with SQLite WAL/NORMAL, Postgres
reports `fsync=on`, `synchronous_commit=on`, `full_page_writes=on` and logged
tables, and this pinned Convex binary's effective synchronous setting is not
established. Any timing comparison must therefore say **default-mode
acknowledgement latency**, not matched power-loss-durable writes.

After an actual, separately recorded backend restart, add `--private-restart`
with the same trial and sample count to check the entire prior final state,
replay Alice's success with a changed payload, Bob's same ID and Alice's
failed ID, then verify the entire state again. This mode has no timing cases
and does not restart a process itself. It cannot establish power-loss
durability, SDK retry behavior or immediate logout equivalence.

The restart checks passed for all three backends at 09:24–09:26 UTC after
SIGTERM and relaunch of the recorded Snapback process, and
`docker restart --time 30` of the owned Convex and PostgreSQL containers.
Each check reverified all
100,000 rows, replayed the three outcomes above and reverified the same
`acd0715b…` full-state hash. Raw records use
`workload: private-catalog-restart-replay`, retain the actual before/after
process or container start identities, and name the extended instrument hash
`71b0810d3b648116bd9f10bfb5d28f5ce0cedad68bb502d365a7d1f028acc992`.
The original event labels called these graceful; the metric records correct
that description while preserving the original labels. Shutdown completion
and possible Docker escalation were not recorded. No machine-crash or
power-loss fault was injected.

## Authenticated 0.2.1 comparison, trials 18–20

Nine formal runs completed at 10:02–10:16 UTC, with 1,000 timed requests in
each of eleven cases: **99,000 timed calls**, all assertions passing. Each
run begins with a restored or reimported revision-zero seed and empty
operation receipts. The runner checks both owners' complete partitions and
the outsider's empty partition before and after, including the ownership,
credential and replay checks described above. Every initial normalized
100,000-row hash is `fdf373afc5317df2b7c44cd4c169e424dd3da5bf7acf614cfc1ef598dc113057`;
every final hash is `716baad65f9d951002da54f92241a73830848e4b7e2161914048356917bd0548`.
The expected final state has 2,062 changed rows and 2,072 increments,
including warmup writes and untimed correctness operations.

Snapback serves the qualified 0.2.1 Linux production artifact above
(`98d1fad6…`, 7,622,208 B), archived source
`6f4004a9f0e235c25e22f23d8339101365bd6ffa`, with runtime identical to landed
`87dcac33c12d97a6269aaa84ac4605284914d11d`. Each run verifies the actual
recorded process's executable digest. Main's later 0.2.2 publication is not
the measured artifact. The private instrument SHA-256 is
`20c765d02776f5e107ff4af2e863359b15a8590c85e4fd3671220dcebeab9888`;
its private generator and runner are unchanged from the reviewed extension.
The whole-file hash changed when main removed unrelated TypeScript replica
measurements. The same VM, Node runtime and pinned competitor images apply.

Backend order rotates: Snapback/Convex/Supabase, then
Convex/Supabase/Snapback, then Supabase/Snapback/Convex. No builds overlap
timing. All cases use 30 sequential warmups except first-category pages,
which warm all 200 owner/category keys. Each backend retains its native
caches. Connection-pool expansion is timed; throughput includes the
closed-loop runner's response validation and scheduling. Ordinary Supabase
Auth logins refresh before each run, with at least thirty minutes remaining
on measured credentials. Reset, issuance and deployment work are untimed.
The nine records in `snapback4/metrics/storage.jsonl` use
`workload: private-catalog`, `experiment: private-catalog-formal` and
`trial: 18–20`; annotations add reset/order/provenance metadata without
changing any raw measurements. An initial setup attempt stopped on an
incorrect provenance path before any timed output; the corrected helper
restored the pristine seed before these runs.

Medians of three per-run percentiles and client-observed throughput;
latencies are milliseconds. Fresh writes are **default-mode acknowledgement
latency**, with the durability differences recorded above.

| Case | Snapback p50 / p95 / RPS | Convex p50 / p95 / RPS | Supabase p50 / p95 / RPS |
|---|---:|---:|---:|
| Repeated owned point | 2.824 / 4.782 / 322.5 | 3.519 / 6.213 / 257.0 | 4.779 / 7.726 / 196.6 |
| Distinct owned point, C1 | 2.982 / 5.128 / 300.5 | 8.593 / 15.020 / 103.8 | 4.422 / 5.270 / 222.3 |
| Distinct owned point, C8 | 3.356 / 5.142 / 2103.7 | 21.480 / 40.780 / 341.6 | 7.910 / 16.012 / 893.5 |
| Distinct owned point, C32 | 17.780 / 51.176 / 1292.4 | 77.779 / 120.191 / 389.8 | 28.794 / 56.781 / 1008.9 |
| Distinct missing point | 3.729 / 7.632 / 234.2 | 7.353 / 11.770 / 126.0 | 4.162 / 5.424 / 234.8 |
| Repeated owned 50-row page, C1 | 3.413 / 6.579 / 242.5 | 3.322 / 6.642 / 239.0 | 4.924 / 6.266 / 192.1 |
| Repeated owned 50-row page, C8 | 7.414 / 17.042 / 923.2 | 5.198 / 13.430 / 1211.1 | 9.985 / 17.785 / 733.9 |
| Repeated owned continuation | 3.941 / 6.823 / 208.5 | 3.560 / 6.288 / 239.9 | 5.503 / 14.060 / 132.4 |
| Repeated successful replay | 3.014 / 5.177 / 306.6 | 7.619 / 11.866 / 122.5 | 4.440 / 5.733 / 219.3 |
| Fresh atomic increment, C1 | 3.157 / 5.433 / 277.3 | 17.065 / 28.279 / 51.5 | 5.540 / 11.618 / 152.3 |
| Fresh atomic increment, C8 | 4.437 / 10.288 / 1392.3 | 75.716 / 126.804 / 100.3 | 9.579 / 16.535 / 732.8 |

Snapback has lower aggregate p50 than Supabase in all eleven cases and
lower p95 in nine. Supabase has lower p95 on distinct missing points and
first-category pages at C1. Against Convex, Snapback has lower aggregate
p50 in eight cases and lower p95 in nine. Convex retains lower p50 on all
three category/continuation cases, and lower p95 on category C8 and
continuation. Its category-C8 throughput is 1,211.1 versus Snapback's
923.2 requests/s. These remain measured targets.

Per-run variation is substantial: Snapback point-C32 p95 is
51.176/167.710/50.325 ms, and category-C8 p50 is 7.414/9.176/5.274 ms;
Convex category-C8 p50 is 9.685/4.483/5.198 ms. Maximum samples are
341.306 ms (Snapback), 849.608 ms (Convex) and 161.765 ms (Supabase).
The aggregate rankings do not mean every individual run or tail wins, and
three trials do not establish statistical significance. This comparison
adds real ownership and replay-safe writes to the local catalog evidence;
it does not establish hosted/SDK performance, matched power-loss durability,
or a universal platform win. The earlier restart proof is separate and
used the recorded 0.1.16 artifact; no restart is claimed for these timed runs.

## Activation identity statement reuse

Every store transaction reads four persisted activation-identity keys before
it can use its opened schema and catalog. Reusing one prepared SQL statement
for those lookups avoids compiling the same SQL four times per transaction.
All four reads remain inside the same transaction and observe current values;
this changes neither the ownership boundary nor query-result caching policy.

A temporary two-variant core example on the archived 0.2.1 source ran after
the formal HTTP trials and all builds finished. It uses the same Linux VM,
the production profile at level 3, and a disposable copy of the private
catalog's pristine SQLite database with WAL/NORMAL. Three pairs alternate
current/cached, cached/current, current/cached, with 100 warmups and 25,000
samples per variant. Timing includes `BEGIN IMMEDIATE`, all four reads and
rollback. Median per-run p50 is 7.667 µs before and 3.834 µs with reuse;
p95 is 7.958 and 4.084 µs. Every tuple matches. Separate checks verify
changed metadata, optional-key absence and rollback are observed freshly.
These are isolated transaction-check measurements, not HTTP latency or
cross-process activation timings; the savings are about four microseconds.

The six observations are in `metrics/storage.jsonl` with
`experiment: activation-identity-statement-reuse`. Temporary instrument
SHA-256 is `cf5b8e1ad9175249cf8a0883bd6f90544287d74256d970cf80ece2906d37b2d9`;
its executable is `e37d326f11d345af552d0278a9617acddc042d3e72b39603e0e8d1145688d153`.
The production implementation applies that statement reuse to
`store/activation.rs`; the existing activation regressions exercise the
actual engine, including competing owners and A → B → A invalidation.
All thirteen existing `review_corrections` tests passed on the 0.2.3
implementation: Darwin's ordinary test profile in 0.06 s after a 7.85 s
build, and Linux's production profile in 0.07 s after a 1m59s build.
Reference validation passed with zero errors or unchecked references.

The change landed at `a19cb33b1` and the existing publication path published
**0.2.3** at 10:42:21 UTC. Qualification passed 152 Rust tests (the existing
long native-job ceiling test remained ignored), 61 client tests and nine
fixture tests, with no failed stages or JavaScript skips. The complete suite
took 77 s, above the 60 s budget; its subsequent warm repeat passed the same
tests in 44.05 s on the shared M5 Max Black. These are separate observations,
and the warm result is not a timing guarantee on every host. Publication
took 199.4 s and passed the installed-consumer proof.

Both registry archives were downloaded and checked against their registry
integrity values. The platform archive contains the qualified 7,316,416 B
Darwin binary, SHA-256
`04546180389dd26ad01f27276dd7271e0a8022a97eed11ab692958872fc49d8e`,
and the tiny_http MIT notice. That actual downloaded binary checks freshly
generated public and private schemas, including all three public queries
and the private atomic update. The client tarball is 437,906 B and the
platform tarball 3,517,368 B. The separately built Linux production binary
is 7,884,352 B, SHA-256
`dfed981a43bd72a2786c1dc6c59fc1033ad15c2402cc8f7b0c5913687fd0a1ca`.
This release also contains main's 0.2.2 surfaces; its sizes and qualification
do not replace the earlier comparison's pinned 0.2.1 artifact or timings.

## Scan cursor experiment — not adopted

A temporary candidate on 0.2.3 source `78366743b` decodes only the last
fetched key when a batch's final row passes its existing examined-row
charge. It also moves accepted stored keys into the result instead of
cloning them. The local resume bound is only needed when that entire batch
was consumed; the public continuation still comes from the last visible
row. The proposal received independent control-flow review, and the
temporary implementation passed the existing core corpus: sixteen Rust
tests, with 211 corpus cases passed, 82 named exclusions and zero failures.
That corpus does not establish current search/device coverage.

The isolated example compares point queries, first category pages and
51-row store scans on a disposable copy of the earlier public profile
database. Each operation has 100 warmups and 5,000 timed samples. Full
six-field reply hashes and raw store-row/key hashes agree across every
variant and run, including warmups; hashing is outside timing. The query
hash omits meter usage, and this public first-page fixture does not cover
filtered refills or cap exits. These are direct core timings, excluding
HTTP and credential processing.

The first three pairs rotate control/candidate, candidate/control,
control/candidate. A second batch pins the runner and its children to
Linux virtual CPU 0 and rotates candidate/control, control/candidate,
candidate/control. No builds or other controlled timed jobs overlap these
runs. The eighteen observations in each batch remain separate, selected
by `experiment: scan-cursor-reuse` and `affinity: unpinned|vcpu-0` in
`metrics/storage.jsonl`. Medians of three per-run percentiles, microseconds:

| Affinity | Case | Control p50 / p95 | Candidate p50 / p95 |
|---|---|---:|---:|
| Unpinned | Point query | 51.000 / 64.834 | 75.041 / 105.834 |
| Unpinned | Category query | 280.459 / 427.001 | 320.667 / 408.834 |
| Unpinned | Store scan, 51 rows | 233.917 / 283.417 | 195.209 / 254.584 |
| CPU 0 | Point query | 59.542 / 76.625 | 44.209 / 56.375 |
| CPU 0 | Category query | 326.667 / 435.750 | 259.834 / 274.876 |
| CPU 0 | Store scan, 51 rows | 227.667 / 262.626 | 172.792 / 195.709 |

The page p50 direction reverses between batches. Point and direct-store
code is unchanged yet their timings also move substantially; CPU affinity
does not remove this variation. These observations do not isolate a
reliable speedup from the candidate. It remains an unlanded experiment;
the shipping scan loop is unchanged. No comparator, HTTP or regression-free
performance claim follows from these profiles.

The common instrument SHA-256 is
`d9886a62871ecdb2054324109ca8662cd7a9dce7c332b387107539de8be8a70b`.
Control and candidate example binaries are respectively
`e933873e078cf4bdccaedeca3f6f21e5305640dec738c46164490f779d677f9b` and
`57871d3471d279b9d012422abbbe71f930a8f5f40c8ff026a63cfec475506093`.
Both use the production profile at level 3 on the same ARM64 Linux VM;
the records retain each variant's actual read-source hash.

## Membership-gated feed protocol

The existing instrument now supports `--membership-init NEW_DIRECTORY` and
`--membership snapback4|convex|supabase`. This is a separate live-membership
fixture: 100,000 immutable messages in 500 populated groups, plus one empty
group. Five real identities cover readers with 5, 30 and 150 memberships,
an outsider, and an empty-group reader. The measured readers can see 1,000,
6,000 and 30,000 messages; their overlapping unions cover 34,000 distinct
messages. Privileged, untimed full-table digests match on all three backends,
including the other 66,000 messages. The message digest is
`91e37b68d13e112eb0ab9faf9078d95eaadcc8d784d984916e833103c1f73675`.

All backends project `{messageKey, groupKey, at, body}` and order by the
same required `(at, messageKey)` suffix. Logical ASCII keys avoid native
ID ordering differences; timestamps deliberately tie within and across
groups. Membership discovery uses `(memberId, groupKey)`, while message
access probes `(groupKey, memberId)`. Each request resolves current
membership from the database. Counts, joins and materialized per-reader
feeds are separate future cases.

Snapback uses ordinary guest sessions, a unique-key point read, a
membership-gated 50-row thread and a 20-row `merge`. Its existing
500-lane discovery bound produces the documented wide-merge advisory;
no resource ceiling changes. Convex retains the configured real JWT
provider and uses indexed lazy iterators with a small heap. Continuation
seeks the remaining equal-time keys before earlier timestamps; a lone
`at < cursor.at` range would omit ties. These are ordinary query functions,
including the backend's automatic query cache.
[Convex indexed reads](https://docs.convex.dev/database/reading-data/indexes/),
[ordered iterators](https://docs.convex.dev/api/interfaces/server.OrderedQuery).

Supabase uses ordinary Auth sessions, RLS and `SECURITY INVOKER` RPCs.
Feed selection joins the caller's memberships to indexed per-group
`LATERAL` queries with 21-row lookahead, then takes the global page. First
and continuation reads use disjoint `UNION ALL` arms: the continuation
arm exposes a bare composite index bound. An earlier `cursor IS NULL OR
tuple < cursor` spelling was removed during review because a generic plan
could scan newer prefixes. Twelve executed prepared-body plans, extracted
from the deployed functions under the authenticated role and fixture claims
with generic parameters, confirm active composite index seeks and inactive
opposite branches. First-feed scans read 21 rows per membership lane. The
Postgres image refused nested `auto_explain`, so these are query-body plans;
the thread plan excludes its preceding membership requirement. Actual RPC
authorization and results are checked separately through HTTP.
[PostgreSQL lateral queries](https://www.postgresql.org/docs/17/queries-table-expressions.html#QUERIES-LATERAL),
[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

The adapter checks complete authorized feed traversals and representative
threads, exact full-row equality, ties, empty readers, missing/foreign
points, invalid and expired authentication, forged viewers and cursor
reuse. After timing, an acknowledged leave must hide the revoked group's
rows immediately, including with old cursors, while another member keeps
access. The controller must then regrant and repeat full verification
without replacing the measured sessions.

There are 39 read cases: for each membership degree, one repeated point
at C1, then point working sets, first/next thread pages, first/next feed
pages and feed working sets at C1/C8. Page arguments were visited during
untimed correctness traversal; working sets cycle real keys and cursors,
so they are not an uncached-work claim. Every timed response is checked.
All three smoke runs passed: 39 cases × 50 samples × 3 backends =
5,850 timed calls, plus warmups and complete authorization, pagination and
same-session revoke/regrant checks. These trial-1000 records are tagged
`membership-feed-smoke` in `metrics/storage.jsonl`; they qualify the fixture
and instrument, not a repeated comparative result. The measured Snapback
binary is the retained production 0.2.3 artifact described above. The
Convex and Supabase image digests remain attached to their records.

The remote artifacts show completion by 2026-09-13 12:05:23 UTC. The
original SSH log stream stopped advancing after 11:51:37; later process
and artifact inspection confirmed completion. Re-running the controller
validated all three saved records and returned exit 0 without repeating
timings. The interrupted SSH client's exit 255 is not a backend failure or
a successful measurement exit. These observations establish no formal
comparative win; repeated trials remain next.

## Repeated cursor encoding experiment — not adopted

A separate temporary candidate on qualified 0.2.3 removes only the final
`encode_cursor` comparison in `decode_cursor`. The base64 decoder already
checks canonical text, and the tagged JSON round trip establishes the
same bytes; version, typed values, both size limits and caller descriptor
checks remain. Independent source review found that final encoding
redundant. The candidate passed the two existing cursor unit tests and
sixteen corpus tests (211 cases passed, 82 named skips, zero failures).
No broader malformed-token differential proof is claimed.

The isolated native profiler uses the same compiled membership schema,
programs and five principals on a disposable seed copy. Three alternating
pairs run control/candidate, candidate/control, control/candidate, pinned
to Linux virtual CPU 0 with no overlapping builds or controlled timings.
Each process measures fifteen query cases at 1,000 samples plus two
microcases at 100,000 samples: 90,000 timed queries and 1.2 million timed
microcalls overall. Each query has 100 excluded warmups; each microcase
has 1,000. Complete query outcomes, including meters, caps, sequence,
tables and cursor, match across all six runs; hashes include warmups and
are computed outside timers. The outsider and empty-group controls also
match. The profiler checks point identity and page sizes; full-fixture
correctness comes from the preceding smoke qualification. These are core
calls with real principal rule evaluation, excluding HTTP/session handling.

The six `redundant-cursor-encoding-profile` records in `metrics/storage.jsonl`
retain every observation. Selected medians of three per-run percentiles:

| Case | Control p50 / p95 (µs) | Candidate p50 / p95 (µs) |
|---|---:|---:|
| Cursor decode | 4.583 / 4.791 | 3.250 / 3.375 |
| 5-group point | 111.125 / 135.083 | 112.958 / 143.416 |
| 5-group thread first | 499.499 / 582.415 | 526.541 / 864.915 |
| 5-group feed first | 1073.413 / 2012.996 | 1121.874 / 1470.453 |
| 5-group feed next | 1123.329 / 1593.621 | 1156.330 / 1211.080 |
| 30-group feed first | 4729.615 / 8284.860 | 4850.945 / 11792.677 |
| 30-group feed next | 4942.366 / 8130.944 | 5075.401 / 11561.382 |
| 150-group feed first | 16134.570 / 27057.990 | 16252.977 / 23458.640 |
| 150-group feed next | 16961.986 / 24949.295 | 16809.204 / 23241.601 |

Decoder p50 improves in all three pairs, with a 29.09% lower median.
Fourteen of fifteen query-case p50 medians are higher, however; the one
lower median (150-group continuation, 0.90%) has mixed pair directions.
Null-cursor and point controls also move despite no decode on those paths.
The experiment supplies no causal explanation for those changes and no
reliable whole-query improvement. The candidate is not adopted, and the
shipping cursor implementation is unchanged. No HTTP or comparator win
follows from the microcase.

The profiler SHA-256 is
`87c91b01d83e0d85ee0b61180a09141d8b64e8e30be7165fbe703fc374e81e20`.
Control and candidate binary hashes are respectively
`38e91ee34b1fa68b5c8210dee241316c06cf22ee20ea5475c48c18a5be03ff42` and
`4e6e93a74017237f868699ade53d0d388fb3078f506954853ca3913179815d76`;
both use the production profile at optimization level 3.

## Simulator observation follow-up

The four chat checks previously constructed and parsed every host state
independently after each event. Sharing one fresh observation across these
specific read-only checks preserves their failure order and persistent
watermark history. Standalone and arbitrary invariants retain independent
observations. No fault, seed, timer, persistence operation, trace payload or
correctness check was removed.

Five fault scenarios (seeds 1, 2, 3, 42 and 7) and all five day-two changes
produced byte-identical before/after output: trace digest/length, forty final
host states and all day-two reports. The 36,170-byte observation record's
SHA-256 is `7aa1d5188dda02116add7dcd6d5204ee97bf6a51d868df544b1739f57fd2f664`.
A focused regression exercises each original failure name, short-circuit
ordering, watermark regression across calls, generation reset and engine
changes between phases.

On the shared M5 Max Black, alternating the same fourteen existing simulator
tests gave control wall times of 20.776 and 21.130 s, versus 8.719 and 8.276 s
with sharing. Both variants already include prepared-statement reuse; all
assertions passed. The new regression was tested separately and excluded
from this equal-test comparison. These timings improve the developer loop;
they are not server request latency or a competitor measurement. Complete
suite qualification remains separate from this isolated result.
The trace and equal-test timing comparison predates main's later activation
and day-two fixture corrections. The current integrated Linux simulator's
fifteen-test group passed in 51.21 s on the four-vCPU VM; the earlier 8 s
Darwin result is not a timing claim for that combined candidate.

## Work remaining

The integrated measurements include main's newer SQLite dependency.
Cached category reads remain a concrete optimization target. Broader coverage
still includes membership-based authorization, writes with matched durability, feeds,
joins, counts, realtime fanout, reconnect/offline, search, files, scheduled jobs,
SDK/UI costs, and hosted network conditions. This catalog does not stand in
for those workloads.

## SQLite page-cache experiments — no setting adopted

A first hot-only pilot kept the initial point/thread/feed pages in a small
working set. All four cache settings produced identical per-case miss
deltas, including zero misses for the 150-group first feed over 100
warmups plus one measured call. The planned hot-only repeated matrix was
left unexecuted; those pilots supply no comparative latency claim.

A distinct native-core experiment then rotated through the membership
fixture's point and feed domains. It uses one binary built from qualified
0.2.3 source `78366743b`, with the original cursor implementation. The
baseline leaves `Store::open` unchanged and reads back `cache_size=-2000`;
other runs set only that connection's cache target to -4096, -8192 or
-16384. Negative values are approximate KiB targets, not hard heap limits.
All runs report SQLite 3.53.2, 4096-byte pages, WAL and synchronous NORMAL.
No query, authorization or result cache, resource ceiling, rule or
transaction setting changes.

Three rounds use orders default/4/8/16, 16/8/4/default and
4/default/16/8, with one fresh process per setting/run, pinned to Linux
virtual CPU 0. OS cache is retained without resets; residency is unmeasured.
Nine cases per process each have 100 excluded warmups and 500 measured
queries: **54,000 timed core queries** across twelve processes. Hot point
repeats one key. Rotating point domains contain 1,000/6,000/30,000 rows;
feed domains contain 50/300/1,500 pages. Each case visits
`min(500, domain size)` distinct timed inputs, so the large domains are
sampled rather than traversed fully. The first 100 inputs repeat after
warmup. Real principal rules execute, but HTTP/session handling is outside
this native experiment.

Every warmup and timed response is checked against the hash-bound full
fixture oracle, including exact rows and next cursor. Untimed first/last
pages check terminal behavior. Full query-outcome hashes, including meters,
caps, sequence, tables and cursor, match across all twelve runs; the outsider
and empty-group controls match too. Inputs, oracle work, hashing and storage
observations are outside the query timer. The twelve
`membership-sqlite-working-set-profile` records in `metrics/storage.jsonl`
retain all observations. Medians of three per-run percentiles:

| Case | Default −2000 p50 / p95 (µs) | −4096 | −8192 | −16384 |
|---|---:|---:|---:|---:|
| 5-group hot point | 114.584 / 155.917 | 112.959 / 153.250 | 112.875 / 144.500 | 112.125 / 138.208 |
| 5-group rotating point | 134.000 / 176.125 | 121.958 / 278.251 | 119.084 / 171.000 | 118.833 / 190.625 |
| 5-group rotating feed | 1201.626 / 2961.920 | 1228.584 / 3714.087 | 1203.001 / 2656.669 | 1217.085 / 3120.044 |
| 30-group hot point | 113.666 / 158.209 | 115.125 / 528.625 | 113.708 / 148.875 | 113.625 / 161.916 |
| 30-group rotating point | 132.166 / 171.958 | 121.292 / 663.417 | 120.333 / 162.042 | 119.709 / 211.292 |
| 30-group rotating feed | 5366.172 / 7544.757 | 5416.172 / 12447.845 | 5134.088 / 8794.842 | 5203.671 / 10221.093 |
| 150-group hot point | 112.292 / 137.750 | 113.084 / 148.167 | 112.042 / 140.000 | 111.833 / 137.166 |
| 150-group rotating point | 130.334 / 159.708 | 130.709 / 179.959 | 132.500 / 167.542 | 132.000 / 167.666 |
| 150-group rotating feed | 18474.017 / 35691.032 | 18392.683 / 24193.105 | 18535.726 / 25964.607 | 18193.766 / 27298.191 |

The 150-group rotating feed illustrates the limit of this change. Across
600 calls per case (warmups included), each round records the same cache
miss totals shown below. The 8/16 MiB targets reduce misses by
97.27%/97.87%, while p50 medians change by +0.33%/−1.52%. The corresponding
p95 medians are 27.25%/23.52% lower, but same-round p95 changes include a
regression for both settings. Smaller point domains have lower p50 medians,
while the 150-group rotating point does not. These observations do not
establish a general benefit or justify changing the production default.

| Cache size | 150-group feed misses / 600 calls | Cache-used bytes after case | Median observed query-phase high-water (KiB) |
|---|---:|---:|---:|
| Default −2000 | 46,114 | 2,102,672 | 130,512 |
| −4096 | 14,032 | 4,313,488 | 132,696 |
| −8192 | 1,259 | 8,626,320 | 136,932 |
| −16384 | 984 | 12,033,936 | 140,364 |

SQLite counters include warmups and cannot assign misses to measured calls
alone; cache misses are not physical disk-I/O counts. Cache-used bytes are
current approximate pager allocation. Observed query-phase VmRSS/VmHWM
include the parsed 100,000-row fixture, cloned oracle and other profiler
allocations, so they are not production memory estimates or hard limits.
Process CPU ticks also cover whole cases, including input/oracle/hash work,
and use the recorded 100 ticks/second; they are not syscall counts or
query-only CPU time. Every case has zero write/spill counter deltas.

The profiler SHA-256 is
`ce850dc695a270e0349a6bd832dcf4cf6b8b000370e20c5dae5096c980027b09`;
the common binary is
`0b9aac6b7c185d751491b553c8d603d037fbc2da44fdc705eb60edf8823ad174`,
built with the production profile at optimization level 3. The controller
is `927314624887db2c73eab7e23aff5fc01c429eeb5fa2172479c10c1b6cb1fdec`.
No cache setting is adopted. This is not an HTTP, comparator, device,
write/durability or shipping-default result.

## Membership execution-phase diagnostics

A temporary instrumented copy of qualified 0.2.3 source `78366743b` adds
RAII timers around existing query, merge, rule and store regions. It keeps
the original expressions, branches, meter charges and transaction calls.
The default SQLite cache remains -2000. An initial pilot's full outcomes,
meters and cursors match the uninstrumented pilot over 100 warmups plus one
measured call per case. This is a diagnostic binary, not a product change.

Three fresh processes run serially at Linux virtual CPU 0. Each measures
nine hot-point, rotating-point and rotating-feed cases with 200 samples
after 100 warmups: **5,400 timed queries and 2,700 warmups**. Domain coverage
is `min(200, domain size)` distinct timed inputs, with one key for hot
points. The full fixture oracle checks every observed row and cursor,
including untimed first/terminal pages and both empty readers. Complete
outcome/meter hashes agree across the three instrumented runs. The
uninstrumented equality preflight is limited to the pilot's input sequence.
OS cache is retained without resets; residency is unmeasured.

Phase counters exclude warmups and oracle/hash work. For each phase and
run, summed nanoseconds are divided by 200 queries; the table reports the
median of those three means. Percentage and call columns are separately
computed medians of per-run ratios, so dividing displayed median durations
need not reproduce the percentage. These are **overlapping inclusive
regions**, not percentile costs or additive exclusive shares. Selected
150-group rotating-feed observations:

| Source region | Mean ms / query | Share of query total | Calls / query |
|---|---:|---:|---:|
| `query.total` | 20.204 | 100.00% | 1.000 |
| `merge.initial_heads` | 16.013 | 79.13% | 1.000 |
| `read.bounds` | 0.891 | 4.40% | 151.000 |
| `rule.probe` | 7.721 | 38.39% | 169.300 |
| `store.scan_keys` | 17.155 | 84.79% | 340.300 |
| `store.step_collect_inclusive` | 16.518 | 81.63% | 340.300 |
| `store.row_json` | 0.996 | 5.05% | 657.875 |
| `store.prepare_bind` | 0.233 | 1.16% | 340.300 |

The iteration/collection region is a concrete next inspection target. It
includes SQLite stepping, column copies and allocations, JSON decoding,
collection and iterator cleanup. The JSON subregion is already included;
subtracting it does not isolate pure SQLite time. `prepare_bind` measures
cached statement acquisition and binding, not every possible activity
inside later iteration. The 340.3 store scans per query include 169.3 rule
probe lookups; the separate prepared-scan count is 171, including membership
discovery. This record establishes no more specific cause or speedup.

The three `membership-execution-phase-profile` records in
`metrics/storage.jsonl` retain all cases, phase sums, complete outcome
hashes and storage observations. Counter bookkeeping and compiler layout
affect absolute costs; these means cannot be compared with earlier
uninstrumented percentiles as an optimization result. SQLite counters still
cover whole cases including warmups, and observed query-phase process
memory includes the parsed fixture and cloned oracle. No HTTP, comparator,
device, write/durability or production-default claim follows.

The profiler SHA-256 is
`65bc1f4ad8ca5f6ef5830760a58fdad68e7d4e1bf284de4a2a222e6a90a2a7ed`;
the instrumented production opt-3 binary is
`eb17f777f4a05aa87fa274e404862bfa309a72214f049c4699cb77c72b5166a6`.
Original and instrumented hashes for every modified core file are retained
in each record's source bindings.

## SQLite plan reuse — direct statements and complete core queries

The execution-phase profile led to a direct SQLite diagnostic using the
store's indexed scan SQL. On bundled SQLite 3.53.2, the default reported
500 automatic reprepares for 500 executions of each tested statement.
An initial false/true/true/false QPSG sequence retained already-cached
statements and still reported 500/500 in every case. It is retained as an
option-toggle diagnostic: SQLite preserves those VDBEs' parameter-expiry
masks, so it does not establish that QPSG is ineffective.

The corrected diagnostic flushes the prepared-statement cache after each
option change, before preparing the next round. Every default case still
reports 500/500; every fresh QPSG case reports **0/500**. Both diagnostics
run four cases in four rounds, with 100 excluded warmups and 500 timed
executions each: 8,000 timed statements per diagnostic. Fresh-round p50s:

| Direct SQL case | Default round 1 (µs) | QPSG round 2 | QPSG round 3 | Default round 4 |
|---|---:|---:|---:|---:|
| Hot point | 36.542 | 4.166 | 4.125 | 37.083 |
| Rotating point | 48.208 | 13.292 | 11.042 | 48.875 |
| Membership probe | 35.542 | 3.333 | 3.375 | 36.042 |
| Feed heads | 47.792 | 10.792 | 10.791 | 47.833 |

Exact rows/keys hashes agree across all rounds and both diagnostics.
High-level EXPLAIN QUERY PLAN text remains the same primary-index search
and join, with zero full-scan steps, sorts or automatic-index rows. This
does not mean identical bytecode: QPSG records two extra VM steps per
execution. Timers include bound SQL execution, column collection and JSON
decode, excluding key construction and hashing. These diagnostics bypass
engine authorization and HTTP. The two `membership-sqlite-statement-diagnostic`
ledger records retain all 34 configuration/case observations; the rejected
fresh-builder preflight contributes no measurements.

A separate complete-query comparison restores the original qualified
0.2.3 core source, without phase instrumentation, and uses one production
opt-level-3 binary. Only QPSG varies: default remains false, or it is set
after `Store::open` and before `Engine::new`. Generic scan statements are
fresh in that experiment; the store's metadata statement was already
cached. The 0.2.5 implementation instead sets QPSG early in
`Store::prepare`, including metadata and native SQLite stores. These
measurements are therefore not timings of the exact 0.2.5 artifact.

Three pairs run default/QPSG, QPSG/default, default/QPSG, serially on Linux
virtual CPU 0 in the same Colima VM. Each fresh process executes nine cases
with 100 excluded warmups and 500 timed queries: **27,000 timed core
queries** plus 5,400 warmups. Both settings retain `cache_size=-2000`,
4096-byte pages, WAL/NORMAL and SQLite 3.53.2. OS cache is retained without
resets; residency is unmeasured. Point domains are 1,000/6,000/30,000 rows,
feed domains 50/300/1,500 pages; each rotating case times
`min(500, domain size)` distinct inputs. Hot point repeats one key.

Every warmup and timed result/next cursor matches the full fixture oracle;
first/terminal pages and two empty controls also pass. All eleven full
outcome/control identities, including meters, match the original
500-sample working-set baseline in every run. Inputs, oracle checks and
hashing are outside the query timer. Medians of three per-run percentiles:

| Case | Default p50 / p95 (µs) | QPSG p50 / p95 (µs) |
|---|---:|---:|
| 5-group hot point | 113.376 / 156.333 | 38.416 / 47.417 |
| 5-group rotating point | 129.334 / 166.000 | 49.583 / 73.583 |
| 5-group rotating feed | 1202.585 / 2766.796 | 766.126 / 1278.836 |
| 30-group hot point | 112.583 / 164.458 | 37.458 / 51.375 |
| 30-group rotating point | 128.750 / 167.001 | 50.000 / 70.292 |
| 30-group rotating feed | 5211.593 / 8167.972 | 1493.127 / 2103.420 |
| 150-group hot point | 112.708 / 143.084 | 37.625 / 56.916 |
| 150-group rotating point | 128.583 / 157.959 | 49.834 / 68.583 |
| 150-group rotating feed | 19099.033 / 27863.464 | 5290.384 / 8841.182 |

All nine p50 medians are lower, by factors of 1.57–3.61. All 27 paired
p50 and 27 paired p95 comparisons are lower. The 150-group feed moves from
19.099 to 5.290 ms p50 and 27.863 to 8.841 ms p95. Tails are not uniformly
better: the 150-group rotating-point median of per-run maxima increases
from 547.126 to 1434.669 µs. These are medians of per-run summaries, not
pooled percentiles or uncertainty estimates.

The six `membership-sqlite-qpsg-profile` ledger records preserve every
observation and source/fixture/controller/raw-artifact hash. The common
binary is `a109928a04599eb6e0b8bbc08384c9ae89c0721a62006ffc1d9bb32d87e7cecf`,
built from qualified source `78366743b`; profiler SHA-256 is
`d64a6c96636b34284f5b7b47b422271307144a6dae62f10913f4b4e2714212da`.
SQLite counters cover warmups as well as timed calls; process CPU ticks
include whole-case observer work, and observed query-phase RSS includes
the full fixture/oracle. All case write/spill deltas are zero. QPSG may
trade away useful parameter-sensitive planning for other SQL shapes.
No HTTP/comparator, device performance, write/durability or production
memory claim follows from this core experiment; publication qualification
is recorded separately.

The plan-reuse implementation landed as `9250a61ee` and both npm packages
published as **0.2.5** at 2026-09-13 16:59:10.168 UTC. The existing
publication path exited 0 after 165.1 seconds, including its installed-consumer
proof. Its blocking suite reported zero failures in 69 seconds: 156 Rust
tests passed, with one existing long native-job ceiling/rollback test at
the 8,192-write limit ignored; all 61 client and 9 fixture-wrapper tests
passed with no skips. A separate warm repeat passed the same counts in
50.52 seconds wall time (51 seconds in the suite summary). Both downloaded
registry tarballs match their recorded integrity and SHA-1 values; the
Darwin production binary is 6,802,080 bytes, SHA-256
`e752662aa96f5d224da46b333540a8e6e4b186ffc248a8b4c7c69a077a5989b3`.
The same source archive also built successfully on Linux at production
optimization level 3, and both production-profile store tests passed
(0.24 seconds after an 87-second test build); the Linux binary SHA-256 is
`251e607404f3faa4e2b0fb05eb3ae42afd4aa03fe204b8532eaf0ad1afe66718`.
These are source, build, test, consumer and publication receipts. The
formal 0.2.5 HTTP comparison is underway; the earlier native-core experiment
is not an HTTP or exact published-artifact performance result.

## Optional write/read and traversal timing — local correctness checks

`--private-write-read` adds a serial acknowledged-mutation/category-read
pair to the existing eleven private-catalog cases. Use the same flag, trial
and sample count for `--private-restart`. `--membership-traversal-timing`
adds per-page and whole-walk observations to the existing exact membership
traversals; it also works with `--membership-verify-only`. Both flags are
optional. Native query caches remain enabled.

Local instrument correctness smokes on 2026-09-13 passed on the primary Apple
M5 Max using Node 24.18.0 and the published 0.2.5 Darwin CLI
(`9250a61ee8ad3b7a9fb899e43368e43a041e8508`, binary SHA256
`e752662aa96f5d224da46b333540a8e6e4b186ffc248a8b4c7c69a077a5989b3`). Both use
combined instrument SHA256
`ebe5b64dd15a6e16371a7449bd8ec55e6a5421ec392bec64b943472f42d616be`. These are
local correctness checks on a separate machine from the Office M1 Max
comparison. Their observed latency summaries are retained without a controlled
performance or comparator claim.

The private `--private-write-read` smoke used 20,000 rows and 12 cases: 550
timed single-request samples across the existing 11 cases, plus 50 serial
write-then-category-read pairs (100 HTTP requests). The new case also
performed 30 excluded warmup pairs (60 requests), two prime reads and two
changed-payload replay checks. Pair and read/write component latencies have
separate summaries. Full partition, authentication, ownership, contention and
replay checks passed. An actual owned-process SIGTERM/relaunch with the same
database then passed full-state and receipt replay checks; the final and both
restart hashes are
`42ecd0c14ec9109a3584b061f27b90319081dbe1754c3a48ac988df580ac9188`. This
establishes process-restart correctness, with no power-loss durability claim.

The membership `--membership-verify-only --membership-traversal-timing` smoke
first verified all 501 groups, 186 memberships and 100,000 messages through
complete logical fixture hashes. Nine exact authorized/control walks then
measured 1,852 feed pages and 13 representative-thread pages, including
outsider and empty-group controls. All five timed identities and the absence
of repeated-case samples are correctly labelled; this invocation performed no
39-case run, leave or regrant. Exact page oracles follow each request timer
and remain inside traversal wall time; no cache reset is claimed.
Convex/Supabase validation of these new opt-in modes remains pending. The
formal 0.2.5 comparison remains bound to the unchanged original instrument
SHA256 `36f4026bcbef551d675842c760fbdc491f94e5d8b062fe8626bdf2a4cb12c39b`.

## Existence-only rule probes — unadopted native experiment

An ignored candidate based on `cc72e4614bcdac59ebd09f0fc0fe3c82e2954ec9`
uses SQLite `SELECT EXISTS` for raw rule probes on tables without expiry;
expiring tables retain full lookup. On 2026-09-13, two native profiler
binaries ran three counterbalanced pairs (baseline/candidate,
candidate/baseline, baseline/candidate) on the Minisforum AMD Ryzen AI 9 HX
370, x86_64 Linux, pinned to logical CPU 2. This is separate from the Office
ARM64 HTTP comparison. The candidate remains unadopted pending ARM/HTTP
evidence.

Each fresh process ran nine direct core-query cases, with 100 excluded
warmups and 5,000 timed samples per case: **270,000 timed queries plus 5,400
warmups**. The 100,000-message fixture uses synthetic principals with
5/30/150 groups. Rotating point domains contain 1,000/6,000/30,000 rows;
feed domains contain 50/300/1,500 pages. Each case times
`min(5000, domain size)` distinct inputs; hot point repeats one key. Full
response/next-cursor oracles and all eleven outcome/control identities,
including meters, agree across the six runs; first/terminal pages and
empty controls also pass. Checks and hashing are outside query timers.

Medians of three per-run percentiles, in microseconds:

| Case | Baseline p50 / p95 | Candidate p50 / p95 | p50 reduction |
|---|---:|---:|---:|
| 5-group hot point | 7.194 / 7.334 | 6.783 / 6.953 | 5.71% |
| 5-group rotating point | 8.265 / 9.979 | 7.885 / 9.658 | 4.60% |
| 5-group rotating feed | 152.006 / 157.396 | 148.078 / 151.825 | 2.58% |
| 30-group hot point | 7.343 / 7.534 | 6.863 / 6.994 | 6.54% |
| 30-group rotating point | 8.626 / 10.099 | 8.075 / 9.768 | 6.39% |
| 30-group rotating feed | 311.145 / 319.050 | 291.097 / 297.750 | 6.44% |
| 150-group hot point | 7.274 / 7.424 | 6.723 / 6.833 | 7.57% |
| 150-group rotating point | 8.566 / 9.869 | 8.035 / 9.438 | 6.20% |
| 150-group rotating feed | 1127.789 / 1153.518 | 1066.194 / 1091.180 | 5.46% |

All 27 paired p50 comparisons and 26 of 27 paired p95 comparisons are
lower. The exception is trial 3's 5-group rotating point, whose p95 rises
from 9.979 to 10.279 µs. Tails are mixed: that case's worst sample across
the three runs increases from 41.118 to 217.569 µs. These are per-run
summaries, not pooled percentiles or uncertainty estimates.

Both variants retain QPSG, SQLite 3.53.2, `cache_size=-2000`, 4096-byte
pages and WAL/NORMAL. SQLite files are on **tmpfs**; OS cache is retained
without resets and residency is unmeasured. Counter deltas include warmups;
CPU ticks and observed query-phase RSS include fixture/oracle work. Case
write/spill deltas are zero. The six `membership-rule-existence-native-profile`
ledger records preserve all 126 observations, including maxima and memory
snapshots, plus exact source, patch, binary, raw-file and receipt bindings.
There is no HTTP/comparator, device-performance, write/durability,
production-memory or corrupted-store equivalence claim.

The initial build/check script exited 101 on a new test mixing synthetic
expiry with wall-clock deletion. Its failure is retained. A test-only
correction then passed 85 Rust tests; the included corpus harness reported
211 cases passed and 82 named skips. Web/Wasm compilation also passed;
this was compilation, not device runtime qualification. The frozen runner
recorded discovered binary hashes and checked stability before each run.
Expected build/archive, pilot and corrected-check bindings were reconciled
**after** timing against retained artifacts; no pre-run expected-hash check
or timing rerun is implied.

## Plan reuse on the new independent readers

The 0.2.6 source (`342c53d306d7484cd64e820ee27a151e02eb4b0b`) added
independent read-only SQLite connections for HTTP query/sync work. Those
connections skipped the QPSG setting in the ordinary store constructor.
Commit `434ab8e79` restores the same per-connection planning policy before
statements are cached. No SQL, transaction boundary or result cache changes.

The new file-reader regression reproduced 12 automatic reprepares for 12
bound scans before the fix. Afterward it passed with zero reprepares in
both directions, exact rows/keys across bounds and limits, an unchanged
snapshot across a concurrent index-changing commit, fresh rows in the next
transaction, and schema-triggered plan invalidation. Linux qualification
passed 129 Rust tests plus 211 corpus cases with 82 named skips. An initial
host-test command selected a nonexistent library target; the separate
corrected binary-target check passed. The failed invocation is retained.

Matched ARM Darwin builds use the same 0.2.6 source plus this isolated
runtime/test delta. Candidate qualification passed 129 Rust tests and the
same corpus cases; baseline qualification passed 54 Rust tests. The initial
parallel baseline host run exhausted Darwin's default 256 file descriptors;
serial host checks passed at that unchanged limit, preserving each test's
explicit concurrency. The original failure and the successful correction
are bound by pre-measurement receipt SHA-256
`5e1f073fb552873010edfcbea37c48deb8ecf1339be9cf7af502083c209e8597`.
The [test-harness follow-up](../../../issues/20260913-snapback4-parallel-http-tests-exhaust-darwin-file-descriptors.md)
records that environment limitation. These are source-built artifacts;
HTTP comparison and publication evidence remain separate.

### Independent reader QPSG: ARM Darwin HTTP A/B (0.2.6 source builds)

Three serial paired orders (baseline/candidate, candidate/baseline,
baseline/candidate; trials 31–33) compared the unmodified
`342c53d306d7484cd64e820ee27a151e02eb4b0b` source with only the
independent-reader QPSG change. Both binaries were rebuilt on Durand, Apple M4
Pro/macOS 26.6.1, with Rust 1.97.0 and the production profile; both report 0.2.6
and are 6,967,536 B. These are source-built A/B measurements, separate from
registry downloads and 0.2.7 publication qualification. The runtime patch is
SHA-256 `130497a69db40f6b1401b88eeb8b299bf223765a039438aa8a22faa03066483c`;
baseline binary
`f3f10874b7765edcd4bb64551cac82127e4c8a22e9801f10389786cb883f56a1`, candidate
`1f4cb4548ce79496db29c8900ccd7d7e888c0621f272e7efe8704ff1760c8aee`.

All six runs passed 39 cases × 500 samples: **117,000 repeated-case timed
requests**, 7,020 excluded warmups, and **33,510 separately timed traversal
pages** (150,510 timed HTTP requests total), with zero reported errors. Each run
restored the same pristine 100,000-message/501-group/186-membership SQLite
snapshot and the same five actually issued seven-day guest sessions. Complete
physical/logical fixture proofs before reads, after leave, after regrant and
after verification matched. Exact authorized feeds/threads, tie order,
invalid/expired/forged credentials, outsider access, acknowledged revocation,
old/foreign cursors and same-session regrant checks passed. Regrant used the
same running server without credential refresh.

The candidate has lower **three-run median p50 in 39/39 cases, p95 in 38/39, p99
in 32/39 and maximum in 26/39**; median RPS is higher in 39/39. Paired
lower-latency counts are 105/117 p50, 99/117 p95, 86/117 p99 and 79/117 maximum.
These are strict comparisons of reported statistics, with no significance claim.
Representative feed working-set medians follow; each cell is baseline →
candidate, and RPS is computed from whole-case elapsed time.

| Memberships / concurrency | p50 ms | p95 ms | requests/s |
|---|---:|---:|---:|
| 5 / C1 | 0.630 → 0.540 | 0.729 → 0.616 | 1492.2 → 1785.3 |
| 5 / C8 | 7.099 → 3.733 | 8.368 → 5.048 | 1134.3 → 2154.3 |
| 30 / C1 | 4.904 → 0.713 | 6.318 → 0.754 | 199.8 → 1342.6 |
| 30 / C8 | 31.574 → 4.729 | 34.197 → 6.611 | 252.4 → 1666.5 |
| 150 / C1 | 5.739 → 1.765 | 6.229 → 1.904 | 174.2 → 555.7 |
| 150 / C8 | 97.780 → 15.839 | 109.242 → 17.522 | 81.1 → 513.0 |

Tails and run variation remain material to interpretation. The one median p95
increase is 5-group PointWorkingSet C1, 0.398 → 0.400 ms. Seven case-median p99s
and thirteen case-median maxima increase; all 18 paired p95, 31 paired p99 and
38 paired maximum regressions remain in the records. Trial 33 reverses several
30/150-group C1 thread/feed results, including 150-group ThreadNext C1 p50 0.502
→ 4.097 ms. The largest observed repeated-case requests are 154.218 ms baseline
and 41.596 ms candidate. Medians do not erase those per-case reversals.

Traversal timings are separate: 27 walks per run (initial, after-leave, regrant
verification), with no excluded warmups. The 150-membership reader traverses all
1,500 feed pages in each phase:

| 150-group full feed phase | page p50 ms | page p95 ms | walk elapsed s |
|---|---:|---:|---:|
| Initial | 4.116 → 1.775 | 4.296 → 1.908 | 6.2239 → 2.7138 |
| After leave | 5.685 → 1.779 | 6.232 → 6.141 | 8.5456 → 4.5743 |
| Same-session regrant | 4.099 → 1.773 | 4.341 → 1.895 | 6.1939 → 2.7342 |

Across all 27 walk identities, page-p50 and page-p95 medians each decrease in
19, increase in seven and tie in one. Page-p99 medians increase in eight and
maximum medians in ten. The 150-group after-leave feed p99 increases 6.969 →
7.854 ms; its regrant median maximum increases 9.591 → 19.930 ms. Thread walks
have four pages and empty controls one, so their high quantiles are small-sample
controls. All walk records, including these tails, are retained.

Per-request timers include loopback HTTP, JSON/projection and adapter checks;
exact oracle comparisons follow each timer. Whole-case/walk elapsed and
throughput include those comparisons and scheduling. Full SQLite/auth checks
precede initial walks, which warm the repeated cases. Servers and Node clients
restart between variants, while OS caches remain without resets and residency is
unmeasured. Connection scheduling, thermal state and cache hit rates were not
isolated. No result cache or ceiling change was introduced. This supplies scoped
HTTP A/B evidence, with no comparator, device, write-throughput, durability,
cold-cache or overall Clique claim.

Build qualification finished before setup: both production builds passed; the
first parallel baseline host attempt failed with explicit
descriptor-exhaustion/reset errors (20 passed, six failed). Retained corrective
checks ran serially at the unchanged soft descriptor limit 256 and passed
baseline core/host 54 and candidate host 26; together with the original
candidate core/corpus/sim checks, candidate qualification is 129 Rust tests plus
211 corpus cases and 82 named exclusions. Original failed receipts remain. An
earlier V1 controller smoke stopped before timing at its JSON/SQLite
object-prototype identity guard; the reported formal runs use only corrected V2.

Frozen instrument SHA-256
`ebe5b64dd15a6e16371a7449bd8ec55e6a5421ec392bec64b943472f42d616be`; V2
controller `674cc8a59600f14ba3ac810f7a492f8646f2ab847893c6c2466169c56606d3af`;
qualified pre-run receipt
`5e1f073fb552873010edfcbea37c48deb8ecf1339be9cf7af502083c209e8597`. The six
accompanying raw-preserving records retain every observation; the retained
`reader-http-formal-summary.json` contains all 39 case medians, 27 walk medians,
every paired/tail regression and exact raw/build/controller hashes.

## Published 0.2.7 — independent-reader plan reuse

`snapback4@0.2.7` and `snapback4-darwin-arm64@0.2.7` were published at
2026-09-13T19:55:18Z from source
`485018648782c692122788c8a094d145008c65c8`, carrying the reader QPSG fix.
The unchanged publisher ran the full suite on Durand (M4 Pro,
macOS 26.6.1): **237 Rust tests passed, one ignored; 89 client tests and
nine fixture tests passed; zero failures in 58 seconds** on the prepared
host. The existing ignored test covers native-job ceiling/rollback behavior
at the 8,192-write limit. Rust test scheduling used `RUST_TEST_THREADS=1`;
the publication helper applied no descriptor-limit override, and each test
retained its own explicit concurrency. Separate dependency/tool preparation
and compilation preceded this qualification. The Durand HTTP A/B had
finished before publication preparation began.

The publisher then built the production CLI with Rust 1.97.0 (opt-level 3,
fat LTO, one codegen unit), packed both packages, and verified the installed
CLI digest/version, TypeScript compilation, and the installed mock client's
query/write behavior.
The CLI is **6,967,536 bytes**, SHA-256
`e54745cd668981efd3ead1dd4bad9e289f390b57d248e57d418942b6dac3476b`.
The client and platform tarballs are **451,061** and **3,420,548 bytes**.
Both registry downloads match the qualified tarballs byte for byte and
match their registry integrity values; the downloaded CLI reports 0.2.7.

The source/fixture archive SHA-256 is
`7d95f9f95f2246d752b0dcd435b66a467e76ab658e789e3d53d22c108f1f7063`;
all archived files and prepared tools were checked again before the
publisher ran. The successful publisher log SHA-256 is
`d7c11d07465ef61859f1880a22036dba3ff18a78c1cbf56c239892f6da4e735d`.
The publication took 145.4 seconds including the suite and is recorded in
`snapback4/metrics/publish.jsonl`. The HTTP A/B above uses the separately
bound source-built 0.2.6 variants; it does not measure this exact registry
artifact or establish a Convex/Supabase, device, write, or durability win.

### 0.2.7 concurrent-feed stack diagnostic

After the reader-QPSG HTTP run, a separate symbol-retaining build of source
`485018648782c692122788c8a094d145008c65c8` sampled the remaining feed cost on
the M4 Pro. It used Rust 1.97.0 and the production profile with only
`CARGO_PROFILE_PRODUCTION_STRIP=none`; its SHA-256 was
`1c4cbde6bc694b16ef4e844777cbff407e3c99a70c082896afb6907326179c6e`.
This was a diagnostic executable, distinct from the published CLI.

The controller restored the same hash-bound 100,000-message SQLite snapshot
and its previously issued sessions, then ran the full five-identity authorized-feed
verifier. C1 and C8 each prepared all 1,500 actual cursor pages for the
150-membership reader, performed 30 warmups, and ran a twelve-second rotating
load. Every preparation and active response passed its exact ordered-row,
viewer, completeness and terminal-cursor checks. C1 completed 2,347 active
requests and C8 completed 6,055. Each five-second `sample` invocation, at a
five-millisecond interval, fell entirely inside its active request window.
The server stopped after both loads. This diagnostic did not repeat the
earlier leave/regrant matrix or perform a new physical scan of every stored
row; it reused the pristine fixture established by that proof.

An independent review balanced the call trees and counted exclusive leaf
observations. At C8, 2,838 of the 5,718 observations under the request handler
were explicit mutex waits. Of all 2,842 mutex-wait observations, 2,697 had a
SQLite page-cache fetch or unpin routine as their nearest non-pthread caller.
C1 had no explicit mutex-wait observation under the request handler. Its
visible query work was chiefly indexed row retrieval, JSON and cursor work.
These are overlapping thread observations, not CPU percentages or a division
of request latency. Idle transport/background waits and mutex-release
syscalls were classified separately.

The pinned `libsqlite3-sys` 0.38.2 build enables
`SQLITE_ENABLE_MEMORY_MANAGEMENT`. Its bundled SQLite 3.53.2 implementation
then places page caches in one recycling group protected by the static LRU
mutex. This provides a concrete mechanism for the sampled contention and a
focused experiment: separate recycling groups trade cross-connection spare
page reuse for less shared locking. The diagnostic alone establishes neither
an improvement nor an adopted setting.

The ignored run directory retains the raw receipt, verifier output, both load
outputs and stack files, their hashes in the storage ledger, and
`reader-027-http-profile-review.md`. C1 precedes C8 on the same server, with
fresh preparation for each; OS cache residency was neither reset nor
measured. Sampling perturbs execution, and input-domain coverage over the
whole load does not prove coverage inside the shorter sample window. No
unsampled latency, exact published-artifact timing, comparator, device,
write, memory-pressure or durability result follows from this diagnostic.

### SQLite memory-management compile option: ARM HTTP experiment, trials 41–43

Six loopback HTTP runs on the prepared Apple M4 Pro compared the exact retained 0.2.7 registry CLI (baseline SHA-256 `e54745cd668981efd3ead1dd4bad9e289f390b57d248e57d418942b6dac3476b`, 6,967,536 B) with an experimental production build of the same source `485018648782c692122788c8a094d145008c65c8`, using `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT` (candidate `a5badc307698f2eb1c56ebfb4df8f618ff14ba524794d6584189e349449940d0`, 6,967,520 B). Both report version 0.2.7. The linked probes report SQLite 3.53.2, `THREADSAFE=1` and configured `cache_size=-2000` in both variants; their compile-option lists differ only by `ENABLE_MEMORY_MANAGEMENT`. This changes SQLite's optional global page-cache recycling mechanism; the configured cache size, authorization rules and query ceilings are unchanged.

The frozen instrument (`ebe5b64dd15a6e16371a7449bd8ec55e6a5421ec392bec64b943472f42d616be`) and controller (`8629ad5377b3370f92809942730bf693bdc106cea600c9e9f474f140a92ecc43`) ran serial pairs B/C, C/B, B/C at trials 41, 42 and 43. Each run restored the same pristine SQLite snapshot and previously issued guest sessions, started its own server process, verified all 501 groups / 186 memberships / 100,000 messages, and exercised the original auth, cursor, ownership, own-leave and current-union checks. The separate regrant restored the physical fixture and verified the full authorized feeds with the same sessions and server. All assertions passed. The six runs contain 117,000 timed case calls (39 cases × 500 × 6), 7,020 excluded case warmups, and 33,510 separately timed traversal-page calls across 162 walks. The two 50-sample smoke runs are excluded. Formal completion was 2026-09-13 21:06:24.305Z.

Full fixture proof, auth checks and initial traversals preceded the repeated cases. OS cache was retained without resets; residency was unmeasured. These are prepared working-set reads, not cold-start measurements. The candidate has lower three-run median p50 in 26/39 cases, p95 in 20/39, p99 in 18/39 and maximum in 25/39; the remaining 13, 19, 21 and 14 case medians are higher. Across the 117 paired case comparisons, p50 is lower/higher/equal in 82/34/1, p95 in 67/50/0, p99 in 65/52/0 and maximum in 68/49/0. Median throughput is higher in 26/39 cases (79/117 paired comparisons).

The targeted 30- and 150-group C8 feed-first, feed-next and working-set cases improve at all four latency statistics in all 18 paired comparisons. Results elsewhere are mixed: six of seven 150-group C1 case p50 medians are higher. Trial 41 includes substantial C1 regressions that the medians alone obscure: 150-group thread-next p50 0.457 → 4.137 ms, feed-first 1.438 → 4.921 ms, feed-next 1.716 → 5.601 ms and feed-working-set 1.719 → 5.224 ms. In that trial, 150-group C8 thread-first p99 is 5.395 → 17.905 ms and maximum 6.642 → 19.438 ms. The largest case observation is 30.066 ms in baseline versus 35.283 ms in candidate, both in 150-group point-working-set C1; candidate trial 41's matched baseline is 7.090 ms. These observations are retained without attributing their cause.

Every table cell below is baseline → candidate, using the median of three reported per-run statistics, not a pooled percentile over 1,500 samples. The JSON summary retains every paired result and every p50/p95/p99/maximum regression. Latencies are milliseconds; throughput is HTTP requests/second.

| Case | p50 | p95 | p99 | Maximum | Requests/s |
|---|---:|---:|---:|---:|---:|
| groups5PointHotC1 | 0.306 → 0.307 | 0.379 → 0.380 | 0.531 → 0.570 | 3.316 → 3.248 | 3043.9 → 3023.5 |
| groups5PointWorkingSetC1 | 0.291 → 0.304 | 0.349 → 0.357 | 0.488 → 0.536 | 3.001 → 3.190 | 3202.1 → 3049.0 |
| groups5ThreadFirstC1 | 0.440 → 0.434 | 0.527 → 0.498 | 0.735 → 0.667 | 3.123 → 3.373 | 2109.7 → 2154.9 |
| groups5ThreadNextC1 | 0.455 → 0.438 | 0.551 → 0.510 | 0.697 → 0.805 | 4.365 → 3.261 | 2043.9 → 2145.1 |
| groups5FeedFirstC1 | 0.508 → 0.494 | 0.580 → 0.613 | 0.764 → 0.890 | 10.889 → 4.752 | 1822.9 → 1879.2 |
| groups5FeedNextC1 | 0.519 → 0.525 | 0.575 → 0.588 | 0.696 → 0.726 | 3.708 → 4.011 | 1851.4 → 1826.3 |
| groups5FeedWorkingSetC1 | 0.541 → 0.523 | 0.628 → 0.622 | 0.779 → 0.765 | 3.768 → 3.734 | 1765.4 → 1826.3 |
| groups5PointWorkingSetC8 | 2.785 → 2.395 | 3.768 → 3.573 | 5.328 → 4.478 | 6.075 → 5.025 | 2905.3 → 3231.1 |
| groups5ThreadFirstC8 | 4.048 → 3.902 | 5.163 → 5.171 | 6.094 → 7.252 | 7.578 → 9.574 | 1979.2 → 2036.1 |
| groups5ThreadNextC8 | 4.013 → 3.902 | 4.990 → 5.028 | 5.503 → 5.540 | 6.369 → 5.737 | 2016.1 → 2096.6 |
| groups5FeedFirstC8 | 3.673 → 3.515 | 4.895 → 4.904 | 5.828 → 5.860 | 6.517 → 6.379 | 2162.7 → 2248.6 |
| groups5FeedNextC8 | 3.771 → 3.470 | 5.108 → 4.635 | 7.256 → 5.243 | 8.363 → 5.849 | 2091.6 → 2316.8 |
| groups5FeedWorkingSetC8 | 3.836 → 3.441 | 5.488 → 4.725 | 6.130 → 5.613 | 6.854 → 6.934 | 2034.8 → 2285.3 |
| groups30PointHotC1 | 3.094 → 3.192 | 4.218 → 3.976 | 5.848 → 5.044 | 15.565 → 18.363 | 331.1 → 343.5 |
| groups30PointWorkingSetC1 | 3.542 → 3.321 | 4.414 → 3.967 | 5.529 → 5.225 | 18.618 → 16.990 | 289.6 → 307.2 |
| groups30ThreadFirstC1 | 0.525 → 0.537 | 4.520 → 4.744 | 5.612 → 5.119 | 8.109 → 5.909 | 689.7 → 579.1 |
| groups30ThreadNextC1 | 0.484 → 0.472 | 0.551 → 0.581 | 0.679 → 0.750 | 3.847 → 5.004 | 1956.6 → 1904.3 |
| groups30FeedFirstC1 | 0.653 → 0.639 | 0.692 → 0.665 | 0.741 → 0.852 | 3.605 → 3.515 | 1475.8 → 1545.8 |
| groups30FeedNextC1 | 0.708 → 0.688 | 0.734 → 0.722 | 0.787 → 0.804 | 8.166 → 3.314 | 1383.5 → 1397.6 |
| groups30FeedWorkingSetC1 | 0.717 → 0.706 | 0.753 → 0.749 | 0.800 → 0.791 | 3.791 → 6.062 | 1343.4 → 1374.8 |
| groups30PointWorkingSetC8 | 2.482 → 2.599 | 3.710 → 4.135 | 4.794 → 5.242 | 6.034 → 5.801 | 3119.0 → 2992.8 |
| groups30ThreadFirstC8 | 3.927 → 4.163 | 5.013 → 5.537 | 5.472 → 6.014 | 5.969 → 7.076 | 2046.5 → 1958.7 |
| groups30ThreadNextC8 | 3.907 → 3.790 | 4.966 → 4.923 | 5.499 → 5.602 | 6.445 → 6.294 | 2067.3 → 2138.2 |
| groups30FeedFirstC8 | 4.639 → 3.597 | 6.542 → 4.705 | 7.612 → 5.597 | 7.988 → 6.964 | 1706.6 → 2235.3 |
| groups30FeedNextC8 | 4.686 → 3.626 | 6.585 → 4.809 | 7.635 → 5.445 | 8.604 → 6.223 | 1679.4 → 2210.2 |
| groups30FeedWorkingSetC8 | 4.788 → 3.702 | 6.861 → 4.781 | 7.938 → 5.578 | 8.249 → 6.178 | 1648.1 → 2161.5 |
| groups150PointHotC1 | 2.961 → 3.030 | 4.146 → 3.694 | 5.187 → 4.650 | 17.753 → 14.567 | 346.1 → 363.3 |
| groups150PointWorkingSetC1 | 3.376 → 3.444 | 4.030 → 4.261 | 5.037 → 5.784 | 8.298 → 9.852 | 300.5 → 295.4 |
| groups150ThreadFirstC1 | 0.489 → 0.493 | 4.816 → 5.046 | 5.620 → 6.143 | 13.121 → 8.870 | 604.9 → 553.3 |
| groups150ThreadNextC1 | 0.467 → 0.465 | 0.503 → 0.513 | 0.759 → 0.708 | 2.679 → 6.095 | 2028.0 → 2007.7 |
| groups150FeedFirstC1 | 1.480 → 1.483 | 1.568 → 1.580 | 1.917 → 1.865 | 8.958 → 8.799 | 663.3 → 656.2 |
| groups150FeedNextC1 | 1.752 → 1.755 | 1.826 → 1.972 | 1.951 → 2.255 | 8.431 → 7.628 | 566.7 → 556.9 |
| groups150FeedWorkingSetC1 | 1.760 → 1.859 | 1.835 → 2.030 | 2.059 → 2.162 | 4.685 → 7.657 | 564.1 → 531.0 |
| groups150PointWorkingSetC8 | 2.765 → 2.348 | 3.720 → 4.097 | 6.004 → 8.026 | 7.231 → 10.251 | 2795.4 → 3105.7 |
| groups150ThreadFirstC8 | 3.966 → 3.695 | 4.886 → 4.846 | 5.433 → 5.614 | 6.642 → 6.260 | 2019.9 → 2188.1 |
| groups150ThreadNextC8 | 3.906 → 3.834 | 4.860 → 5.069 | 5.404 → 5.500 | 5.561 → 6.424 | 2092.2 → 2106.6 |
| groups150FeedFirstC8 | 15.958 → 5.804 | 19.032 → 7.124 | 20.714 → 7.982 | 22.352 → 8.128 | 496.3 → 1363.9 |
| groups150FeedNextC8 | 15.759 → 6.309 | 17.659 → 8.373 | 18.783 → 9.616 | 20.808 → 10.635 | 510.0 → 1229.4 |
| groups150FeedWorkingSetC8 | 15.860 → 6.226 | 17.645 → 7.554 | 18.721 → 8.488 | 19.804 → 8.906 | 504.7 → 1281.7 |

Traversal timings are separate C1 walks before repeated cases, after the actor's leave, and after same-session regrant. They have lower median p50 in 19/27 identities, p95 in 18/27, p99 and maximum in 16/27; the other 8, 9, 11 and 11 are higher. Across 81 pairs, p50 is lower/higher in 51/30, p95 in 48/33, p99 in 46/35 and maximum in 44/37. Walk wall time is lower/higher/equal in 14/6/7 median identities and 43/22/16 pairs. Per-page timers include HTTP, JSON decoding and projection, with exact oracle checks outside each request timer; walk wall time and page throughput include those checks. First-page latency, page throughput and every individual walk are retained in the records/summary.

A thread walk has four pages; outsider and empty controls have one. Their p95/p99 equal the maximum (all percentiles coincide for a one-page control); 40/50-page feed p99 is also the maximum with this instrument's percentile convention. These tails are not 500-sample repeated-case distributions. Initial and regrant 150-group feed p95/p99/maximum medians are higher, despite lower p50; the after-leave wide feed is faster. The largest individual traversal page is 24.024 ms baseline versus 20.493 ms candidate, both after-leave wide feeds in trial 43. Actors below are identified by initial membership count; the 5-group reader has four groups after leave.

| Phase / reader / operation | Pages | p50 | p95 | p99 | Maximum | Walk wall ms |
|---|---:|---:|---:|---:|---:|---:|
| initial / 5-group reader / feed | 50 | 0.716 → 0.711 | 0.853 → 0.842 | 1.080 → 1.063 | 1.080 → 1.063 | 36.4 → 36.6 |
| initial / 5-group reader / thread | 4 | 0.607 → 0.653 | 0.782 → 0.803 | 0.782 → 0.803 | 0.782 → 0.803 | 2.7 → 2.8 |
| initial / 30-group reader / feed | 300 | 0.789 → 0.783 | 0.902 → 0.901 | 1.118 → 1.189 | 2.660 → 2.529 | 249.7 → 243.3 |
| initial / 30-group reader / thread | 4 | 0.562 → 0.563 | 0.643 → 0.627 | 0.643 → 0.627 | 0.643 → 0.627 | 2.4 → 2.4 |
| initial / 150-group reader / feed | 1500 | 1.754 → 1.742 | 1.867 → 1.875 | 2.155 → 2.192 | 10.024 → 12.263 | 2691.8 → 2644.4 |
| initial / 150-group reader / thread | 4 | 0.583 → 0.571 | 0.748 → 0.731 | 0.748 → 0.731 | 0.748 → 0.731 | 2.5 → 2.5 |
| initial / outsider / feed | 1 | 0.464 → 0.427 | 0.464 → 0.427 | 0.464 → 0.427 | 0.464 → 0.427 | 0.5 → 0.4 |
| initial / empty-group reader / feed | 1 | 0.467 → 0.415 | 0.467 → 0.415 | 0.467 → 0.415 | 0.467 → 0.415 | 0.5 → 0.4 |
| initial / empty-group reader / thread | 1 | 0.444 → 0.403 | 0.444 → 0.403 | 0.444 → 0.403 | 0.444 → 0.403 | 0.4 → 0.4 |
| after-leave / 5-group reader / feed | 40 | 1.815 → 1.813 | 1.859 → 1.841 | 1.866 → 1.865 | 1.866 → 1.865 | 72.5 → 72.6 |
| after-leave / 5-group reader / thread | 4 | 1.845 → 1.842 | 1.907 → 1.883 | 1.907 → 1.883 | 1.907 → 1.883 | 7.5 → 7.4 |
| after-leave / 30-group reader / feed | 300 | 4.226 → 4.196 | 5.539 → 5.779 | 6.788 → 6.449 | 10.257 → 12.173 | 1167.3 → 1131.7 |
| after-leave / 30-group reader / thread | 4 | 2.742 → 3.869 | 2.883 → 4.002 | 2.883 → 4.002 | 2.883 → 4.002 | 11.3 → 15.8 |
| after-leave / 150-group reader / feed | 1500 | 5.610 → 1.857 | 6.823 → 5.916 | 8.137 → 7.555 | 18.392 → 17.381 | 8072.4 → 4564.5 |
| after-leave / 150-group reader / thread | 4 | 2.220 → 0.601 | 2.457 → 0.788 | 2.457 → 0.788 | 2.457 → 0.788 | 9.2 → 2.7 |
| after-leave / outsider / feed | 1 | 1.902 → 0.437 | 1.902 → 0.437 | 1.902 → 0.437 | 1.902 → 0.437 | 2.0 → 0.5 |
| after-leave / empty-group reader / feed | 1 | 1.943 → 0.434 | 1.943 → 0.434 | 1.943 → 0.434 | 1.943 → 0.434 | 1.9 → 0.4 |
| after-leave / empty-group reader / thread | 1 | 1.889 → 0.401 | 1.889 → 0.401 | 1.889 → 0.401 | 1.889 → 0.401 | 1.9 → 0.4 |
| regrant / 5-group reader / feed | 50 | 0.721 → 0.714 | 0.890 → 0.842 | 1.072 → 1.105 | 1.072 → 1.105 | 37.6 → 36.7 |
| regrant / 5-group reader / thread | 4 | 0.643 → 0.624 | 0.779 → 0.847 | 0.779 → 0.847 | 0.779 → 0.847 | 2.8 → 2.8 |
| regrant / 30-group reader / feed | 300 | 0.806 → 0.790 | 0.922 → 0.897 | 1.020 → 1.147 | 2.551 → 2.590 | 250.0 → 245.7 |
| regrant / 30-group reader / thread | 4 | 0.587 → 0.590 | 0.620 → 0.608 | 0.620 → 0.608 | 0.620 → 0.608 | 2.4 → 2.4 |
| regrant / 150-group reader / feed | 1500 | 1.759 → 1.739 | 1.837 → 1.863 | 2.229 → 2.240 | 9.603 → 10.291 | 2688.3 → 2662.7 |
| regrant / 150-group reader / thread | 4 | 0.566 → 0.582 | 0.759 → 0.756 | 0.759 → 0.756 | 0.759 → 0.756 | 2.5 → 2.6 |
| regrant / outsider / feed | 1 | 0.444 → 0.488 | 0.444 → 0.488 | 0.444 → 0.488 | 0.444 → 0.488 | 0.5 → 0.5 |
| regrant / empty-group reader / feed | 1 | 0.436 → 0.457 | 0.436 → 0.457 | 0.436 → 0.457 | 0.436 → 0.457 | 0.4 → 0.5 |
| regrant / empty-group reader / thread | 1 | 0.407 → 0.430 | 0.407 → 0.430 | 0.407 → 0.430 | 0.407 → 0.430 | 0.4 → 0.4 |

Qualification history is preserved: both production builds and option probes passed, while the original candidate Rust workspace run reported 237 passed / 1 failed / 1 ignored because a frontend test lacked locked Bun dependencies. After frozen installation, all 14 frontend tests passed with all 615 archived source files and both binaries unchanged. This resolves to 238 distinct candidate Rust tests passed, including the experiment-only option probe, and one existing ignored test; the corpus reported 211 passed cases and 82 named skips. The original failed exits and corrective receipts remain bound by `qualified-v2.json` (`4710463e1198f4204fbe0a613dac540b1041ab200db342c7bafc0c5a37442e3f`). This experimental qualification is not a complete publication or installed-consumer receipt.

Raw controller records, their nested raw/regrant observations, all proof/log hashes, and the independent aggregation are preserved in the six annotated storage records and the ignored run's `page-cache-http-formal-summary.json`. This experiment supplies no exact-next-publication, comparator, device-throughput, write, durability, memory-pressure or universal performance claim. SQLite's changed cross-connection memory-recycling behavior was not tested under memory pressure. Any publication uses its own qualification and receipt.

### Completed Office membership comparison: qualified 0.2.5, trials 24–26

Nine serial runs on the Office M1 Max's ARM64 Colima VZ VM (4 CPUs, 12 GiB) compared the retained Linux production Snapback 0.2.5 binary `251e607404f3faa4e2b0fb05eb3ae42afd4aa03fe204b8532eaf0ad1afe66718` from source `9250a61ee8ad3b7a9fb899e43368e43a041e8508`, Convex CLI 1.45.0/self-host image `sha256:69885bae73766f625404a5425b22702341e89b43002f1d700864f8364be0d1f8` (server version string unknown), and Supabase CLI 2.117.0/PostgREST 16.2/Postgres 17.6.1.167 with the recorded component image digests. This measures the old qualified Linux 0.2.5 build, not 0.2.8 or the separate Durand M4 experiments. A shared version string does not establish identity with a registry platform binary.

Orders were Snapback/Convex/Supabase, Convex/Supabase/Snapback, then Supabase/Snapback/Convex. The frozen instrument SHA-256 is `36f4026bcbef551d675842c760fbdc491f94e5d8b062fe8626bdf2a4cb12c39b`, controller `cd0ca16890fce049684a4f6732e3acad96b2465ab8e50b1bb8c46837754e2540`, and setup helper `47bf199de85f48117c87dcfd21f5fd2b21933e30ddbea5a7bd7447fb925bdcac`; each is bound in the retained log and records. Every backend completed all 39 cases × 500 samples in each round: **175,500 timed reads**, 10,530 excluded warmups and zero reported errors. The controller completed with exit 0 at 2026-09-13 21:20:50.445Z. All 27 public record/raw/regrant files are retained.

A fresh privileged proof read all 501 groups, 186 memberships and 100,000 messages after every reset and before timing. The ordinary verifier checked exact ordered authorized unions of 1,000 / 6,000 / 30,000 / 0 / 0 messages, representative threads, timestamp ties, hidden foreign points, forged-viewer refusal, invalid/tampered/expired credentials and cross-reader cursor safety. An acknowledged own leave reduced the first union to 800, including correct old-cursor behavior and retained access for another member. Administrative regrant then restored every initial union using the same measured credentials. These checks passed in all nine runs. After leave/regrant, the proof is complete ordinary authorized-union/thread verification; no second privileged physical-database scan is claimed. There are 243 untimed walks (27 per run), plus other untimed auth/cursor/mutation checks. This frozen instrument did not measure traversal-page latencies.

Snapback has lower three-run median p50 than Supabase in all 39 cases, but lower p95 in 36, p99 in 35 and maximum in 35. Against Convex, the respective counts are 21, 19, 19 and 20. All comparisons below are strict on reported values, with no ties, workload weighting or significance claim. Each aggregate is the median of three per-run statistics, not a pooled percentile over 1,500 requests. “Same round” pairs trial IDs across the rotating serial order; it does not establish a causal A/B effect.

| Snapback statistic favorable | Convex: case medians / same-round comparisons | Supabase: case medians / same-round comparisons |
|---|---:|---:|
| Lower p50 | 21/39 · 56/117 | 39/39 · 113/117 |
| Lower p95 | 19/39 · 55/117 | 36/39 · 107/117 |
| Lower p99 | 19/39 · 52/117 | 35/39 · 101/117 |
| Lower maximum | 20/39 · 54/117 | 35/39 · 101/117 |
| Higher requests/s | 21/39 · 57/117 | 39/39 · 111/117 |

Convex retains lower median p50 in 15/18 feed cases; Snapback is lower in 9/9 point and 9/12 thread cases. The largest feed gaps are the 150-group C8 cases: Snapback p50 is 6.67× / 7.46× / 10.94× Convex for first / next / working-set feeds, with p95 12.36× / 13.28× / 21.74×. Supabase has lower median p95 for all three of those wide C8 feeds. It has lower p99 and maximum for those three plus the 5-group C8 feed-next case.

The 39/39 median p50 result against Supabase also contains four unfavorable individual comparisons: trial 25's 5-group feed-first C8 is 21.055 vs 16.610 ms; trial 26's 5-group feed-next C8 is 25.114 vs 15.536, 150-group feed-next C8 is 51.022 vs 39.749, and 150-group feed-working-set C8 is 44.881 vs 32.856. These are preserved along with every p95/p99/maximum and throughput loss. The largest case observation across all three rounds is 450.759 ms for Snapback (150-group feed-working-set C8, trial 25), 105.718 ms for Convex (150-group point-working-set C1, trial 25) and 1,027.657 ms for Supabase (150-group feed-next C8, trial 25). Table maximums below are medians of the three run maximums, not these overall worst observations.

In every cell, values are **Snapback / Convex / Supabase**. Latencies are milliseconds; throughput is HTTP requests/second.

| Case | p50 | p95 | p99 | Maximum | Requests/s |
|---|---:|---:|---:|---:|---:|
| groups5PointHotC1 | 3.290 / 3.711 / 6.193 | 6.822 / 6.959 / 12.799 | 10.307 / 11.090 / 22.685 | 24.570 / 25.257 / 35.524 | 245.0 / 240.9 / 132.7 |
| groups5PointWorkingSetC1 | 3.197 / 12.109 / 7.150 | 6.191 / 28.320 / 29.340 | 9.727 / 47.884 / 48.648 | 19.486 / 63.938 / 69.217 | 279.4 / 69.7 / 96.0 |
| groups5ThreadFirstC1 | 4.191 / 4.345 / 9.269 | 7.557 / 7.405 / 35.655 | 12.174 / 11.179 / 61.745 | 29.497 / 17.119 / 83.834 | 207.3 / 206.0 / 72.8 |
| groups5ThreadNextC1 | 3.732 / 5.286 / 8.696 | 6.707 / 9.721 / 36.418 | 9.696 / 20.081 / 60.908 | 21.305 / 33.825 / 83.522 | 233.1 / 162.9 / 75.3 |
| groups5FeedFirstC1 | 4.112 / 4.519 / 9.644 | 7.255 / 8.821 / 34.676 | 10.055 / 17.347 / 53.725 | 20.562 / 25.347 / 76.367 | 211.2 / 192.7 / 70.1 |
| groups5FeedNextC1 | 3.976 / 4.073 / 9.059 | 6.322 / 7.256 / 32.324 | 8.623 / 9.749 / 50.718 | 24.730 / 27.403 / 69.317 | 232.3 / 223.7 / 78.2 |
| groups5FeedWorkingSetC1 | 4.441 / 3.665 / 10.666 | 7.510 / 5.715 / 33.300 | 10.447 / 9.060 / 61.188 | 20.960 / 44.466 / 90.101 | 207.0 / 248.6 / 70.1 |
| groups5PointWorkingSetC8 | 3.775 / 6.940 / 12.262 | 9.456 / 21.027 / 28.483 | 35.887 / 39.976 / 169.221 | 37.570 / 42.731 / 215.696 | 1591.8 / 915.5 / 542.8 |
| groups5ThreadFirstC8 | 6.873 / 8.475 / 19.649 | 21.138 / 21.461 / 41.533 | 34.170 / 49.942 / 81.232 | 40.878 / 62.004 / 93.001 | 806.1 / 761.5 / 355.3 |
| groups5ThreadNextC8 | 7.230 / 5.991 / 25.672 | 16.108 / 12.053 / 61.419 | 36.181 / 22.028 / 77.096 | 45.727 / 24.042 / 82.529 | 931.9 / 1171.0 / 274.3 |
| groups5FeedFirstC8 | 13.549 / 5.018 / 26.759 | 38.325 / 10.896 / 65.480 | 49.331 / 24.599 / 93.911 | 65.877 / 25.919 / 138.504 | 476.5 / 1375.6 / 257.8 |
| groups5FeedNextC8 | 16.242 / 4.887 / 17.174 | 46.964 / 10.670 / 48.131 | 76.585 / 23.651 / 65.111 | 100.826 / 24.870 / 77.791 | 383.8 / 1414.0 / 371.4 |
| groups5FeedWorkingSetC8 | 18.587 / 5.367 / 21.628 | 50.237 / 10.093 / 65.228 | 84.018 / 26.279 / 152.682 | 109.210 / 31.216 / 157.239 | 361.2 / 1298.3 / 281.4 |
| groups30PointHotC1 | 3.121 / 3.309 / 9.579 | 6.521 / 5.349 / 40.086 | 11.191 / 8.726 / 60.321 | 40.652 / 19.142 / 96.414 | 278.3 / 272.5 / 70.1 |
| groups30PointWorkingSetC1 | 3.596 / 13.196 / 6.787 | 7.239 / 36.125 / 24.928 | 11.145 / 54.888 / 39.102 | 33.123 / 81.680 / 52.422 | 243.6 / 57.2 / 107.3 |
| groups30ThreadFirstC1 | 4.411 / 4.542 / 9.845 | 8.997 / 8.578 / 35.753 | 13.417 / 11.527 / 58.980 | 32.852 / 31.679 / 100.703 | 185.6 / 199.8 / 70.1 |
| groups30ThreadNextC1 | 3.606 / 4.824 / 10.672 | 6.502 / 11.020 / 33.682 | 9.967 / 19.448 / 60.301 | 26.909 / 46.693 / 77.673 | 243.9 / 168.6 / 69.6 |
| groups30FeedFirstC1 | 4.460 / 4.666 / 11.244 | 7.560 / 10.100 / 30.585 | 10.909 / 18.780 / 49.220 | 19.208 / 31.479 / 84.808 | 206.4 / 185.8 / 68.5 |
| groups30FeedNextC1 | 5.949 / 5.372 / 10.611 | 11.443 / 18.190 / 31.281 | 16.794 / 40.897 / 46.835 | 34.397 / 48.918 / 69.079 | 144.9 / 125.1 / 71.9 |
| groups30FeedWorkingSetC1 | 6.031 / 4.893 / 13.732 | 11.910 / 8.079 / 59.232 | 23.815 / 12.746 / 86.561 | 42.209 / 35.025 / 138.101 | 144.0 / 193.3 / 47.2 |
| groups30PointWorkingSetC8 | 3.027 / 6.018 / 17.420 | 6.459 / 19.388 / 45.558 | 21.632 / 31.803 / 67.636 | 24.236 / 48.789 / 98.710 | 2092.0 / 937.5 / 381.2 |
| groups30ThreadFirstC8 | 7.402 / 6.097 / 19.425 | 21.461 / 15.731 / 50.136 | 39.661 / 40.300 / 87.569 | 47.558 / 46.543 / 102.331 | 852.1 / 1031.5 / 340.9 |
| groups30ThreadNextC8 | 6.770 / 9.449 / 20.784 | 17.999 / 34.503 / 49.971 | 31.026 / 51.062 / 69.541 | 36.075 / 54.920 / 76.551 | 961.5 / 672.9 / 324.8 |
| groups30FeedFirstC8 | 12.232 / 9.260 / 30.042 | 29.240 / 21.066 / 88.369 | 37.878 / 51.463 / 108.997 | 57.876 / 55.874 / 137.662 | 564.1 / 725.4 / 213.0 |
| groups30FeedNextC8 | 13.501 / 5.788 / 21.381 | 32.896 / 11.162 / 47.909 | 41.756 / 42.999 / 55.941 | 55.359 / 56.570 / 69.643 | 501.9 / 1153.2 / 333.5 |
| groups30FeedWorkingSetC8 | 14.128 / 5.834 / 33.344 | 31.089 / 27.104 / 78.058 | 44.858 / 47.261 / 97.087 | 61.307 / 57.152 / 112.737 | 496.6 / 940.6 / 214.6 |
| groups150PointHotC1 | 2.930 / 3.794 / 6.914 | 5.431 / 6.211 / 16.689 | 9.212 / 8.415 / 28.739 | 18.542 / 19.041 / 73.545 | 287.3 / 243.8 / 118.9 |
| groups150PointWorkingSetC1 | 3.709 / 12.937 / 7.408 | 6.347 / 39.579 / 33.829 | 8.846 / 64.476 / 49.130 | 27.028 / 100.619 / 75.381 | 255.1 / 56.5 / 85.3 |
| groups150ThreadFirstC1 | 4.281 / 3.923 / 10.898 | 9.506 / 6.340 / 34.737 | 17.657 / 11.885 / 53.059 | 41.543 / 39.063 / 62.658 | 197.8 / 231.7 / 67.1 |
| groups150ThreadNextC1 | 3.657 / 4.554 / 8.972 | 6.783 / 7.765 / 27.291 | 9.509 / 11.059 / 47.277 | 35.468 / 24.715 / 81.945 | 242.2 / 199.7 / 81.9 |
| groups150FeedFirstC1 | 7.662 / 3.593 / 18.326 | 16.025 / 6.611 / 42.352 | 27.864 / 8.372 / 59.434 | 37.381 / 22.316 / 104.075 | 109.3 / 247.8 / 45.7 |
| groups150FeedNextC1 | 8.660 / 3.991 / 19.368 | 13.292 / 7.304 / 58.923 | 15.772 / 13.628 / 83.701 | 27.056 / 31.009 / 107.580 | 106.8 / 221.2 / 38.5 |
| groups150FeedWorkingSetC1 | 9.833 / 4.979 / 17.727 | 21.844 / 9.759 / 38.185 | 33.784 / 16.487 / 55.988 | 70.669 / 25.894 / 104.787 | 87.0 / 180.0 / 49.5 |
| groups150PointWorkingSetC8 | 4.328 / 5.507 / 13.620 | 11.794 / 12.826 / 48.440 | 25.416 / 21.475 / 76.975 | 27.083 / 26.051 / 85.190 | 1435.5 / 1234.9 / 437.0 |
| groups150ThreadFirstC8 | 6.134 / 6.792 / 15.107 | 15.499 / 22.246 / 31.770 | 36.687 / 35.831 / 48.014 | 38.358 / 41.222 / 55.736 | 1116.5 / 911.9 / 468.2 |
| groups150ThreadNextC8 | 6.478 / 7.115 / 24.234 | 17.854 / 22.417 / 53.054 | 31.083 / 30.981 / 66.135 | 34.073 / 34.124 / 97.904 | 995.9 / 861.8 / 298.6 |
| groups150FeedFirstC8 | 28.147 / 4.220 / 42.101 | 115.218 / 9.325 / 74.549 | 172.695 / 33.803 / 111.080 | 330.212 / 39.670 / 155.737 | 192.8 / 1427.8 / 176.8 |
| groups150FeedNextC8 | 37.216 / 4.988 / 60.051 | 135.092 / 10.171 / 116.901 | 228.484 / 24.541 / 208.722 | 412.712 / 26.291 / 259.787 | 149.5 / 1379.3 / 121.8 |
| groups150FeedWorkingSetC8 | 44.881 / 4.102 / 58.169 | 169.251 / 7.787 / 131.892 | 280.653 / 23.488 / 164.238 | 429.344 / 28.977 / 198.299 | 121.7 / 1686.1 / 120.4 |

The protocol uses real native bearer authentication: copied 90-day Snapback guest sessions, Convex RS256 custom JWTs, and Supabase ES256 password-login users with RLS. Those paths have different implementation costs. Supabase login refresh occurs before timing and never between leave and regrant; the controller asserts an unchanged credential-file digest before the second verifier. The raw verify-only records retain the older instrument's `timedIdentities: 3` field, but their explicit scope and lack of measurements mean that invocation has zero timed samples.

There is no harness/application result cache. Native automatic query caching remains enabled, and actual hit/eviction rates are unmeasured. Full initial traversals visit all feed/thread page arguments before repeated cases. Working-set sequences match across backends within each trial: 500 timed point inputs from domains of 1,000/6,000/30,000, and 50/300/500 unique timed feed-page inputs from domains of 50/300/1,500. The wide feed's full domain is verified outside timers. Request latency includes HTTP, JSON decoding and normalized projection; exact response assertions follow the request timer, while whole-case elapsed/RPS includes that observer and loop work. Thirty warmups per case are excluded.

Snapback restores its full pristine SQLite snapshot and restarts its server before each run. Convex/Supabase retain processes and immutable message/group tables while replacing memberships. OS cache remains without resets and residency is unmeasured. The Supabase plan artifact verifies 12 executed prepared query bodies extracted from deployed SECURITY INVOKER functions under the authenticated role/claims, including indexed continuation arms. Because nested `auto_explain` was unavailable, this is body-plan evidence, not a nested stored-function trace; actual HTTP authorization and returned data are checked separately.

The nine annotated storage records preserve the original controller records, embed the untouched raw instrument and separate same-session regrant records, and bind their files and common execution log by SHA-256. The ignored `membership-025-formal-summary.json` contains every backend/case median, every same-round contrast, all losses and all supporting hashes. These results do not establish an overall or current-release win, statistical significance, isolated QPSG attribution, cold-cache behavior, full Clique coverage, device/realtime throughput, materialized feed/count performance, write throughput, memory-pressure behavior or durability. Later security, independent-reader and page-cache changes require their own scoped evidence.

### Publication of the page-cache policy: 0.2.8

Source `8a81eb8551fb9711de91f87f199a94e03b2ed201` landed with the reviewed HTTP evidence in `a36219aa2ea9a1bbd969a24223c1fd042b188c4b`. The existing publisher now selects `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT` for its full suite and production build, and records that build input. The existing store regression checks the linked SQLite options and configured cache size under that input. LLP 3000 §7 documents the cross-connection recycling tradeoff and the build command; the packaged CLI's native device RPC is included in this policy.

The actual publisher completed on the prepared M4 Pro at **2026-09-13 21:33:19.388Z**: **237 Rust tests passed, one existing test ignored; 89 client and 9 fixture tests passed; zero failures in 54 s**. `RUST_TEST_THREADS=1` retains the documented Darwin file-descriptor workaround, with within-test concurrency intact and no descriptor-limit increase. This run did not remeasure the numeric descriptor limit. The suite uses default-profile test artifacts before constructing production; native SQLite/device and real native-process client checks remain included. The installed-package consumer separately passed typechecking and mock query/write checks, and its CLI version/digest matched the newly built production artifact. Publication took **140.2 s** on the prepared host.

The registry's `snapback4@0.2.8` and `snapback4-darwin-arm64@0.2.8` archives have verified registry integrity and are byte-identical to the qualified tarballs. The downloaded CLI also executed `--version` successfully on the primary ARM Mac. Its build flag is unnecessary at runtime.

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| CLI | 6,967,520 | `92db0d86e76a9e68859306870b45da795cc5e525f5b6519566aea6a414a369d8` |
| Client archive | 451,044 | `3032ad0d9ed5a2728f31a73e83780e26da557a9426a5e13c15b5de3a8500e04b` |
| ARM macOS platform archive | 3,417,449 | `c23474c59a28ec3b879a2c224652a1a1011ff1b7ff8ed760d0e3700f25cddae6` |

The retained source archive is `a0ed84778c75fa0d682088fa9c6cf16578170f886a70927f17d22f185f3d3ef0`; publication log `4b46f50a1859fc453d239f0c3a9ee4a971eb95173fb54b1a2968ccfaedd00984`, with exit 0. An early preparation launch exited 2 because its helper had not finished transferring; that original failure is retained. After transfer, preparation and the exact affected store test passed against the unchanged archived source, followed by the full publisher above. The temporary remote npm credential file was removed and its cleanup receipt verified. The raw publisher record is appended to `snapback4/metrics/publish.jsonl`; `page-cache-028-publication-qualification.json` in the ignored run binds the original/corrective preparation, publication and registry receipts.

The preceding HTTP timings remain bound to the same-source **0.2.7 experimental pair**. The 0.2.8 package has its own qualified source and artifact digests; this publication adds no new latency, comparator or memory-pressure measurement.
