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

### 0.2.8 HTTP stack diagnostic (2026-09-13, Durand)

A separate symbol-retaining build of published 0.2.8 source `8a81eb855` used the adopted `-USQLITE_ENABLE_MEMORY_MANAGEMENT` input and the production profile with only `strip=none`. Its CLI SHA-256 is `8f5d146c3d05776a47d1724237e08e7ed95e5e88e09d0471ffa94191d3c427c5`, distinct from the published CLI. This is a perturbed stack diagnostic, not an unsampled latency or throughput comparison.

The frozen membership verifier passed all five authorized unions, representative threads and denial checks on the restored, hash-bound 100,000-message fixture. Previously issued sessions were reused unchanged. The C1 and C8 loads checked every response against the exact 150-group feed oracle, completing 2,358 and 15,168 active requests respectively, plus 1,530 preparation requests each. Each complete load visited all 1,500 page inputs. Both five-second, five-millisecond-interval sample invocations fit within their respective twelve-second active load windows; coverage of every page specifically within the sample windows was not recorded.

| Exclusive thread-stack observations | C1 | C8 |
|---|---:|---:|
| All thread trees | 4,438 | 17,905 |
| Request handling | 471 | 4,880 |
| Request mutex-wait leaves | 0 | 1,112 |
| Other request observations | 471 | 3,768 |

Balanced call-tree analysis finds `sqlite3Malloc` immediately above pthread wait wrappers for 734 of C8's 1,112 mutex-wait observations. There are no mutex waits with `pcache1Fetch`, `pcache1Unpin` or `pcache1FetchStage2` as the nearest non-pthread caller; allocation/free and teardown waits remain, including 106 nearest `pcache1TruncateUnsafe`. This supports investigating SQLite's global allocation accounting separately. It does not quantify that experiment's benefit. C1 still shows indexed scan/VM, allocation, JSON and cursor work. Inclusive categories overlap; wait, `pread` and mutex-release samples are not CPU-time measurements.

C1 precedes C8 against one restored process, with another full traversal and 30 warmups before C8. Process and OS-cache history carry forward; OS residency is unmeasured. The diagnostic inherits the pristine snapshot's physical-fixture proof and adds complete authorized traversal checks; it does not repeat a privileged physical scan, leave/regrant matrix or the 39-case benchmark. No comparator, device, write, memory-pressure, durability or universal-performance claim follows. The metrics record preserves the complete receipts, verifier, load observations and exact source/helper/sample hashes.

The subsequently retained outer diagnostic log and exit also reconcile with both load receipts and confirm exit 0.

### Office 0.2.8 membership follow-up (2026-09-13)

Three later Snapback-only runs used the same Office host, frozen instrument, fixture and logical trial IDs 24–26. Relative to the earlier 0.2.5 runs, **32 of 39 case p50 medians were higher**, while several wide-feed tails were lower. The earlier Convex/Supabase runs were not repeated alongside this follow-up; the comparisons below are descriptive and noncontemporaneous.

The selected Linux ARM CLI was built from `8a81eb855` with the adopted `-USQLITE_ENABLE_MEMORY_MANAGEMENT` input: SHA-256 `33bd0c0ba298cfb1044e788aee0702157fbf0530b8c4b01b8d859bda24c89593`, 7,425,552 bytes. It is not the macOS npm executable. The prior Linux qualification passed 103 affected Rust tests, the 211-case corpus with 82 named skips, and a separate production execution of the existing store regression. This version includes intervening engine/HTTP/security/reader changes; these timings do not isolate the SQLite flag or any other one change.

All three runs completed by 22:05:34 UTC with exit 0: 58,500 timed case calls, 3,510 excluded warmups, zero reported errors. A separate 50-sample smoke (1,950 calls) is excluded. Every run rechecked the complete 501-group/186-membership/100,000-message fixture before timing and passed ordinary-auth, exact pages, foreign/old cursor, leave and same-session regrant checks. The 81 complete before/after/regrant walks were untimed, as were other setup/auth checks.

Counts below show cases where later 0.2.8 had a lower median latency or a higher median RPS, out of 39. Each cell compares medians of three reported per-run statistics, not pooled request percentiles.

| Earlier comparison | p50 lower | p95 lower | p99 lower | Median maximum lower | RPS higher |
|---|---:|---:|---:|---:|---:|
| Earlier Snapback4 0.2.5 | 7 | 16 | 21 | 22 | 11 |
| Earlier Convex | 4 | 15 | 19 | 23 | 8 |
| Earlier Supabase | 38 | 39 | 38 | 38 | 38 |

Corresponding logical-trial latency comparisons are lower in 25/60/72/64 of 117 against 0.2.5, 21/45/55/61 against Convex, and 113/111/108/107 against Supabase (p50/p95/p99/max). They remain separate time windows, not interleaved pairs. All individual losses are retained in the raw records and summary.

The wide C8 feed working set is 29.883 / 65.664 ms p50/p95 here, versus earlier 0.2.5 44.881 / 169.251, Convex 4.102 / 7.787, and Supabase 58.169 / 131.892. The 150-group first-feed C8 p50 is higher than 0.2.5 (33.412 versus 28.147 ms), despite its lower p95 (56.635 versus 115.218). The sole case-median p50 loss to Supabase is 150-group thread-first C8 (16.282 versus 15.107 ms); 30-group feed-next C8 loses at p99/median maximum (94.695/114.671 versus 55.941/69.643 ms). Six individual logical-trial p95 comparisons still favor Supabase. The worst new observation is 164.081 ms in trial 25, 150-group thread-first C8.

All 39 later-0.2.8 case medians follow. Latencies are milliseconds; maximum is the median of per-run maxima, and RPS is completed case requests/second.

| Case | p50 | p95 | p99 | Median max | RPS |
|---|---:|---:|---:|---:|---:|
| `groups5PointHotC1` | 4.118 | 7.741 | 11.547 | 25.277 | 214.8 |
| `groups5PointWorkingSetC1` | 5.002 | 10.964 | 23.610 | 45.486 | 167.2 |
| `groups5ThreadFirstC1` | 5.424 | 8.504 | 13.584 | 37.602 | 167.5 |
| `groups5ThreadNextC1` | 4.767 | 7.055 | 10.619 | 15.915 | 198.7 |
| `groups5FeedFirstC1` | 5.090 | 7.280 | 10.047 | 31.570 | 183.2 |
| `groups5FeedNextC1` | 4.798 | 5.943 | 7.412 | 22.363 | 203.7 |
| `groups5FeedWorkingSetC1` | 5.122 | 8.144 | 12.395 | 33.984 | 180.4 |
| `groups5PointWorkingSetC8` | 7.388 | 16.867 | 34.695 | 39.157 | 949.0 |
| `groups5ThreadFirstC8` | 15.180 | 25.440 | 32.513 | 37.331 | 499.8 |
| `groups5ThreadNextC8` | 14.027 | 23.857 | 39.060 | 45.048 | 526.1 |
| `groups5FeedFirstC8` | 11.439 | 17.374 | 21.049 | 21.709 | 677.4 |
| `groups5FeedNextC8` | 11.694 | 18.054 | 21.071 | 23.490 | 663.2 |
| `groups5FeedWorkingSetC8` | 11.632 | 25.592 | 49.327 | 57.651 | 604.1 |
| `groups30PointHotC1` | 3.764 | 6.026 | 8.875 | 14.708 | 242.6 |
| `groups30PointWorkingSetC1` | 4.044 | 6.599 | 8.852 | 16.833 | 231.8 |
| `groups30ThreadFirstC1` | 4.875 | 7.049 | 10.115 | 29.584 | 193.0 |
| `groups30ThreadNextC1` | 5.171 | 7.851 | 11.284 | 26.997 | 176.8 |
| `groups30FeedFirstC1` | 5.923 | 12.067 | 21.213 | 36.869 | 142.9 |
| `groups30FeedNextC1` | 5.511 | 6.884 | 9.465 | 29.838 | 176.0 |
| `groups30FeedWorkingSetC1` | 5.768 | 11.804 | 17.124 | 28.893 | 155.7 |
| `groups30PointWorkingSetC8` | 6.813 | 11.982 | 31.806 | 35.399 | 1045.7 |
| `groups30ThreadFirstC8` | 14.283 | 25.589 | 32.801 | 42.968 | 504.1 |
| `groups30ThreadNextC8` | 13.781 | 20.965 | 34.961 | 47.392 | 547.2 |
| `groups30FeedFirstC8` | 12.458 | 20.091 | 27.293 | 35.672 | 608.5 |
| `groups30FeedNextC8` | 14.762 | 46.586 | 94.695 | 114.671 | 412.2 |
| `groups30FeedWorkingSetC8` | 23.351 | 46.707 | 65.022 | 101.565 | 315.6 |
| `groups150PointHotC1` | 4.007 | 5.920 | 8.524 | 15.102 | 237.8 |
| `groups150PointWorkingSetC1` | 3.815 | 6.710 | 10.200 | 28.579 | 232.9 |
| `groups150ThreadFirstC1` | 5.033 | 7.518 | 10.845 | 24.904 | 185.6 |
| `groups150ThreadNextC1` | 5.069 | 7.837 | 10.555 | 23.196 | 179.9 |
| `groups150FeedFirstC1` | 10.043 | 19.262 | 32.957 | 61.786 | 92.9 |
| `groups150FeedNextC1` | 11.110 | 20.960 | 30.540 | 57.607 | 80.5 |
| `groups150FeedWorkingSetC1` | 10.350 | 16.291 | 24.829 | 60.467 | 89.1 |
| `groups150PointWorkingSetC8` | 6.516 | 11.321 | 20.695 | 22.820 | 1138.8 |
| `groups150ThreadFirstC8` | 16.282 | 29.824 | 37.251 | 55.417 | 452.4 |
| `groups150ThreadNextC8` | 18.415 | 39.771 | 61.198 | 74.764 | 373.4 |
| `groups150FeedFirstC8` | 33.412 | 56.635 | 68.850 | 96.718 | 224.1 |
| `groups150FeedNextC8` | 26.996 | 51.224 | 65.605 | 71.799 | 263.0 |
| `groups150FeedWorkingSetC8` | 29.883 | 65.664 | 88.031 | 103.616 | 232.8 |

Each Snapback run restored the full pristine SQLite snapshot and restarted the server; the earlier comparators retained their processes and immutable tables while memberships were restored. Native query caching remains enabled with unmeasured hit rates. Untimed traversals warmed page arguments; OS cache was retained without resets and residency was unmeasured. Existing copied 90-day guest sessions were used, rather than newly issued seven-day sessions. Per-request timers include HTTP/JSON/projection; exact oracle assertions follow those timers, while case wall time/RPS include assertions and loop overhead. Working-set samples retain the earlier input selection but do not cover every wide-domain input.

The record does not claim a current cross-backend controlled win, full Clique comparison, isolated optimization effect, cross-machine result, device/realtime result, write throughput, memory-pressure behavior or durability equivalence. The ledger annotations retain each complete original record, raw instrument/regrant objects and exact file/provenance hashes.

### MEMSTATUS-default HTTP experiment (2026-09-13, Durand)

The experimental candidate lowers p50 in all 54 matched C8 case pairs, but has substantial C1 regressions. For 150-group thread-first C1, p50 rises in every pair: **0.662→1.322, 0.512→2.738 and 3.968→4.165 ms**. Its case-median p50 rises from 0.662 to 2.738 ms. Trial 43 also raises 5-group thread-first C1 from 0.431 to 4.289 ms and 30-group from 0.513 to 4.143 ms. All observations remain included; a separate transport hypothesis does not explain or exclude these regressions.

Both variants use the unchanged 0.2.8 source `8a81eb855` on the prepared Durand M4 Pro. Baseline SHA `92db0d86e76a9e68859306870b45da795cc5e525f5b6519566aea6a414a369d8` matches the published macOS CLI. Candidate SHA `93fa3b165949db5dcef3ef6ebdf4cb54642a4932b4ffe9e8360b364f6e5c1cbf` adds only `-DSQLITE_DEFAULT_MEMSTATUS=0` beside the adopted `-USQLITE_ENABLE_MEMORY_MANAGEMENT`; both binaries are 6,967,520 bytes. Linked production probes differ only by DEFAULT_MEMSTATUS=0, retaining THREADSAFE=1, configured cache -2000 and zero default heap limits. Global memory accounting/heap-limit functionality is disabled in the candidate; this is an experimental artifact, not a new published or adopted policy.

Six fresh-server runs used orders B/C, C/B, B/C in trials 41–43. All finished with exit 0 by 22:19:54 UTC: 117,000 repeated-case calls, 7,020 excluded case warmups, and 33,510 separately timed traversal pages. All exact-output/auth/ownership/current-union checks and full physical proofs before timing, after leave and after same-session regrant passed. The two 50-sample smoke runs are excluded. Build qualification passed 238 Rust tests (237 product tests plus one experiment probe), with one existing ignored native ceiling/rollback test; both separate production probes also passed.

| Candidate result | Case medians / 39 | Matched case pairs / 117 |
|---|---:|---:|
| Lower p50 | 27 | 83 |
| Lower p95 | 27 | 83 |
| Lower p99 | 23 (one tie) | 71 (one tie) |
| Lower maximum | 24 | 65 |
| Higher RPS | 27 | 84 |

All 18 C8 case p50/p95 medians are lower, while 12 of 21 C1 case p50 medians are higher. C8 tails remain mixed: one of 54 p95 pairs, 11 p99 pairs and 15 maximum pairs are higher. The wide C8 feed working set moves from 6.058 / 7.452 to 4.856 / 5.906 ms median p50/p95. Its three pairs improve, while first-feed C8 p99/max pairs in trials 42 and 43 regress. The largest repeated-case observation is 32.472 ms baseline and 35.162 ms candidate.

The large thread-first C1 case retains all three pairs below (milliseconds, B→C):

| Trial | p50 | p95 | p99 | Maximum |
|---|---:|---:|---:|---:|
| 41 | 0.662→1.322 | 4.906→4.734 | 5.409→6.882 | 14.255→35.162 |
| 42 | 0.512→2.738 | 4.809→4.122 | 5.731→5.296 | 17.335→15.681 |
| 43 | 3.968→4.165 | 5.570→5.104 | 8.782→6.494 | 18.080→11.655 |

All repeated-case values below are medians of three reported per-run statistics. Each cell is **baseline / candidate**; latencies are milliseconds, maximum is median per-run maximum, and RPS is completed requests/second. These are not pooled percentiles or statistical-significance claims.

| Case | p50 B/C | p95 B/C | p99 B/C | Max B/C | RPS B/C |
|---|---:|---:|---:|---:|---:|
| `groups5PointHotC1` | 0.297 / 0.284 | 0.357 / 0.343 | 0.455 / 0.471 | 3.537 / 6.598 | 3142.6 / 3257.1 |
| `groups5PointWorkingSetC1` | 0.287 / 0.276 | 0.350 / 0.329 | 0.463 / 0.463 | 3.186 / 3.395 | 3258.4 / 3376.1 |
| `groups5ThreadFirstC1` | 0.431 / 0.432 | 0.513 / 0.554 | 0.661 / 0.734 | 3.475 / 3.462 | 2155.2 / 2130.6 |
| `groups5ThreadNextC1` | 0.437 / 0.420 | 0.526 / 0.504 | 0.735 / 0.720 | 3.433 / 3.507 | 2146.1 / 2224.9 |
| `groups5FeedFirstC1` | 0.482 / 0.537 | 0.560 / 0.624 | 0.758 / 0.812 | 3.518 / 14.965 | 1928.7 / 1700.1 |
| `groups5FeedNextC1` | 0.525 / 0.550 | 0.552 / 0.698 | 0.608 / 1.171 | 3.799 / 3.850 | 1853.9 / 1764.1 |
| `groups5FeedWorkingSetC1` | 0.528 / 0.551 | 0.617 / 0.637 | 0.752 / 0.750 | 11.470 / 3.419 | 1748.6 / 1744.8 |
| `groups5PointWorkingSetC8` | 2.286 / 2.073 | 3.432 / 2.672 | 4.109 / 3.449 | 5.280 / 4.981 | 3325.4 / 4264.3 |
| `groups5ThreadFirstC8` | 3.846 / 2.666 | 4.953 / 3.303 | 5.531 / 4.111 | 6.151 / 5.778 | 2121.0 / 3277.4 |
| `groups5ThreadNextC8` | 3.736 / 2.613 | 4.832 / 3.334 | 5.409 / 3.988 | 6.039 / 5.829 | 2174.9 / 3265.2 |
| `groups5FeedFirstC8` | 3.418 / 2.637 | 4.710 / 3.342 | 7.611 / 4.105 | 7.943 / 5.596 | 2287.8 / 3329.5 |
| `groups5FeedNextC8` | 3.409 / 2.725 | 4.684 / 3.470 | 5.639 / 8.552 | 6.395 / 10.639 | 2331.8 / 3050.4 |
| `groups5FeedWorkingSetC8` | 3.392 / 2.695 | 4.554 / 3.170 | 5.544 / 3.563 | 6.148 / 4.032 | 2355.6 / 3293.3 |
| `groups30PointHotC1` | 3.323 / 3.342 | 4.037 / 3.997 | 5.002 / 7.419 | 16.122 / 15.966 | 336.2 / 315.5 |
| `groups30PointWorkingSetC1` | 3.353 / 3.253 | 4.076 / 4.208 | 5.251 / 7.389 | 20.913 / 15.738 | 313.7 / 311.6 |
| `groups30ThreadFirstC1` | 0.513 / 0.748 | 4.803 / 4.453 | 5.758 / 5.592 | 7.708 / 9.819 | 593.3 / 496.9 |
| `groups30ThreadNextC1` | 0.483 / 0.540 | 0.567 / 0.644 | 0.668 / 0.820 | 3.754 / 15.018 | 1961.7 / 1767.2 |
| `groups30FeedFirstC1` | 0.641 / 0.643 | 0.682 / 0.745 | 0.732 / 0.931 | 3.403 / 3.960 | 1524.8 / 1493.2 |
| `groups30FeedNextC1` | 0.701 / 0.709 | 0.741 / 0.748 | 0.775 / 0.771 | 6.728 / 2.912 | 1381.1 / 1398.7 |
| `groups30FeedWorkingSetC1` | 0.710 / 0.733 | 0.746 / 0.772 | 0.807 / 0.821 | 3.424 / 14.402 | 1383.0 / 1288.1 |
| `groups30PointWorkingSetC8` | 2.418 / 2.018 | 3.928 / 2.376 | 4.755 / 4.436 | 4.971 / 4.762 | 3170.1 / 4286.4 |
| `groups30ThreadFirstC8` | 3.741 / 2.728 | 5.007 / 3.597 | 6.786 / 6.255 | 7.866 / 7.899 | 2199.0 / 3100.2 |
| `groups30ThreadNextC8` | 3.684 / 2.772 | 4.837 / 3.336 | 6.335 / 4.558 | 7.161 / 5.130 | 2212.2 / 3072.4 |
| `groups30FeedFirstC8` | 3.372 / 2.085 | 4.604 / 3.687 | 5.247 / 6.724 | 6.209 / 8.262 | 2336.7 / 3475.5 |
| `groups30FeedNextC8` | 3.579 / 2.275 | 4.723 / 3.523 | 5.295 / 4.083 | 5.685 / 4.991 | 2254.0 / 3416.2 |
| `groups30FeedWorkingSetC8` | 3.491 / 2.197 | 4.534 / 3.095 | 5.037 / 3.831 | 5.658 / 4.150 | 2274.6 / 3492.5 |
| `groups150PointHotC1` | 2.769 / 2.849 | 3.788 / 3.527 | 4.271 / 4.299 | 17.065 / 16.970 | 368.0 / 379.0 |
| `groups150PointWorkingSetC1` | 3.420 / 3.291 | 4.014 / 3.959 | 4.549 / 4.884 | 16.098 / 18.513 | 294.3 / 318.6 |
| `groups150ThreadFirstC1` | 0.662 / 2.738 | 4.906 / 4.734 | 5.731 / 6.494 | 17.335 / 15.681 | 500.7 / 415.7 |
| `groups150ThreadNextC1` | 0.472 / 0.465 | 0.504 / 0.568 | 0.780 / 0.767 | 2.669 / 12.423 | 2046.1 / 2040.8 |
| `groups150FeedFirstC1` | 1.457 / 1.442 | 1.696 / 1.721 | 2.091 / 1.977 | 9.557 / 8.694 | 661.2 / 666.2 |
| `groups150FeedNextC1` | 1.725 / 1.695 | 1.769 / 1.939 | 1.813 / 2.125 | 9.327 / 9.234 | 571.4 / 575.0 |
| `groups150FeedWorkingSetC1` | 1.743 / 1.693 | 1.943 / 1.837 | 2.281 / 1.971 | 7.270 / 7.924 | 564.6 / 582.5 |
| `groups150PointWorkingSetC8` | 2.584 / 1.994 | 3.856 / 2.297 | 4.584 / 3.997 | 5.088 / 4.813 | 3042.5 / 4146.7 |
| `groups150ThreadFirstC8` | 3.785 / 2.679 | 4.987 / 3.274 | 5.472 / 3.990 | 6.484 / 5.253 | 2147.1 / 3293.2 |
| `groups150ThreadNextC8` | 3.835 / 2.609 | 5.045 / 3.307 | 6.232 / 3.976 | 7.501 / 5.986 | 2114.9 / 3277.3 |
| `groups150FeedFirstC8` | 5.862 / 4.088 | 7.796 / 5.638 | 8.925 / 8.181 | 9.892 / 8.656 | 1337.0 / 1886.6 |
| `groups150FeedNextC8` | 6.078 / 4.774 | 7.705 / 5.802 | 8.802 / 6.260 | 10.351 / 7.217 | 1288.3 / 1669.4 |
| `groups150FeedWorkingSetC8` | 6.058 / 4.856 | 7.452 / 5.906 | 8.007 / 6.414 | 8.825 / 6.721 | 1308.5 / 1651.8 |

Traversal timing is separate: 27 initial/after-leave/regrant identities, repeated in each trial, total 162 walks. Candidate medians are lower for p50/p95/p99/max in 26/22/22/21 of 27; corresponding pairs are lower in 58/56/55/51 of 81. The sole median p50 regression is reader 0’s four-page thread after leave (1.831→1.847 ms). Thread walks contain four pages and empty/outsider controls one, so their tail percentiles have very small samples. Every traversal regression remains in the summary, including candidate’s worst page observation of 24.790 ms versus baseline’s 23.776 ms. Walk wall time and page throughput include oracle checks; per-page HTTP/JSON/projection timers end before those checks.

Each process restores the same pristine SQLite/session snapshot. Previously issued seven-day guest sessions are unchanged through leave/regrant; no refresh or process restart occurs between those operations. Full proofs and initial traversals warm repeated cases; native caches remain as implemented, and OS cache is retained without resets or measured residency. Results are scoped to this loopback macOS experiment. They do not establish a comparator, cross-machine, device, write, memory-pressure, durability, universal or eventual-publication win. The raw-preserving ledger bundle retains every case, traversal, proof, paired loss and exact artifact/controller binding.

## Four-variant TCP and memory-accounting follow-up

A four-variant follow-up on the prepared Durand M4 Pro macOS host completed on
2026-09-13 at 23:08:04 UTC. A is the retained baseline, whose CLI SHA
`92db0d86…` matches published 0.2.8; B adds only
`-DSQLITE_DEFAULT_MEMSTATUS=0`; C adds the two-file bounded TCP_NODELAY change;
D combines B and C. All use source `8a81eb855`, the adopted
`-USQLITE_ENABLE_MEMORY_MANAGEMENT` input, production optimization and the same
configured SQLite page-cache size. B, C and D remain experimental.

Logical rounds 51–54 ran serially in orders A/B/C/D, B/D/A/C, C/A/D/B and
D/C/B/A. Each process restored the same pristine SQLite fixture and previously
issued guest sessions. All 16 runs passed the full fixture, auth, exact-result,
old-cursor, leave/current-union and same-session regrant checks: 312,000 repeated
case calls, 18,720 excluded warmups and 89,360 separately timed traversal pages
(401,360 timed reads total), with zero reported errors. The preceding four
50-sample smoke runs are excluded.

The table counts lower p50/p95/p99/max and higher RPS, in that order. A case
median is the average of the middle two of four per-run statistics; it is not a
pooled percentile. Paired counts compare matching logical rounds.

| Contrast | Better case medians /39: p50/p95/p99/max/RPS | Better pairs /156: p50/p95/p99/max/RPS | Worse C1 p50 medians |
|---|---|---|---|
| B / A | 37/35/31/27/37 | 146/136/114/98/141 | 2/21 |
| C / A | 22/23/24/16/23 | 84/81/80/67/82 | 6/21 |
| D / A | 25/26/19/19/23 | 114/108/86/79/114 | 14/21 |
| D / B | 11/13/12/12/11 | 48/54/58/67/54 | 18/21 |

B/A has one median p95 tie; C/A has one median p99 tie and one paired p50 tie.
D/B has one paired p50 tie and one paired p95 tie. Every other non-winning
entry in this table is worse. B's only C1 p50 median
losses are the 30- and 150-group hot points. C has six C1 p50 median losses;
D has fourteen, including all seven 5-group C1 cases. D is worse than B on
28/39 p50 medians, including 18/21 C1 cases.

For the 150-group working feed at C8, A/B/C/D p50 medians are
6.084/4.8925/6.1225/5.0315 ms. C1 remains unstable: the 5-group hot-point
p50 medians are 0.3135/0.281/0.2945/1.6495 ms. In round 53, C's 30-group
feed-next C1 p50 is 4.656 ms against A's 0.702 ms. B also has paired tail
regressions: round 52's 150-group hot-point max is 22.836 ms versus A's
7.445 ms. The largest single case maxima anywhere in A/B/C/D are
35.429/22.836/30.276/22.521 ms; these do not imply each case's tail improved.
All observations and losses remain in the 16 raw-preserving records.

This matrix does not supersede the earlier three-pair MEMSTATUS experiment:
that run had 12/21 C1 p50 medians worse, including higher 150-group thread-first
p50 in all three pairs. The present run has 2/21 worse. Their disagreement
precludes claiming a stable C1 improvement from these runs alone.

Complete traversal timings are separate: 27 phase/actor/operation identities
per run, including outsider and empty controls. The following counts lower
page p50/p95/p99/max and higher whole-walk pages/second, respectively.

| Contrast | Better traversal medians /27 | Better traversal pairs /108 |
|---|---|---|
| B / A | 17/16/15/14/18 | 68/64/70/65/71 |
| C / A | 11/13/13/11/12 | 49/50/49/48/48 |
| D / A | 15/13/13/13/15 | 64/57/56/57/61 |

B/A has one paired p95 tie; other non-winning traversal entries above are worse.
Page timers include HTTP, JSON decoding and projection; walk wall time and
throughput also include oracle/loop work. One- and four-page controls provide
little percentile information. Host CPU/process/memory snapshots are pre-run
point samples; OS cache was retained without resets and residency was
unmeasured. These observations establish neither Nagle causality nor an
adoption, comparator, WAN, device, write, memory-pressure or durability claim.
The controller is `0b9cb9b0…`, qualification receipt `954a20ab…`, and frozen
instrument `ebe5b64d…`; the annotations retain their complete hashes and proofs.

## ARM Linux memory-accounting comparison

A separate ARM Linux MEMSTATUS comparison on Office M1 Max/Colima VZ
(4 CPUs, 12 GiB) completed on 2026-09-13 at 23:26:18 UTC. Both executables
were built from `8a81eb855` (0.2.8), with the adopted
`-USQLITE_ENABLE_MEMORY_MANAGEMENT` input. The candidate adds only
`-DSQLITE_DEFAULT_MEMSTATUS=0`; NODELAY is unchanged. Baseline CLI SHA
`33bd0c0b…` reproduces the qualified Linux 0.2.8 artifact; candidate
`8c47c6a5…` is experimental. Both are 7,425,552 bytes. These are source-built
Linux artifacts, separate from the macOS npm CLI.

Three logical rounds 24–26 used baseline/candidate, candidate/baseline,
baseline/candidate order. Every run restored a fresh SQLite/app copy and the
same previously issued 90-day guest sessions. All six formal runs passed the
full three-table physical proof, exact authorized feeds/threads, invalid and
expired auth, old-cursor/leave checks and same-session regrant on the same
server. There were 117,000 case calls and 7,020 excluded warmups, with zero
reported errors. All 162 complete walks (33,510 page requests) were **untimed**.
The two 50-sample smoke runs are separate and excluded.

Each case median is the middle of three per-run reported statistics, not a
pooled request percentile. “Better” means lower latency or higher RPS;
triplets below are better/worse/tie.

| Metric | Case medians /39 | Matching logical-trial pairs /117 |
|---|---|---|
| p50 | 34/5/0 | 88/29/0 |
| p95 | 30/9/0 | 81/36/0 |
| p99 | 29/10/0 | 75/42/0 |
| max | 25/14/0 | 71/46/0 |
| RPS | 31/8/0 | 83/33/1 |

All five p50 median losses are retained (ms):

| Case | Baseline | Candidate |
|---|---:|---:|
| groups5PointHotC1 | 3.638 | 3.845 |
| groups5PointWorkingSetC8 | 6.127 | 6.629 |
| groups30ThreadNextC1 | 4.554 | 4.861 |
| groups30FeedFirstC1 | 4.962 | 5.150 |
| groups150PointHotC1 | 3.314 | 3.741 |

The 150-group working-feed C8 p50/p95 medians decreased from
39.867/78.174 to 22.380/43.171 ms, but tails remain mixed. The 30-group
thread-first C8 p50 decreased from 14.521 to 7.934 ms while p95/p99/max
medians increased from 33.931/58.083/69.413 to
71.398/168.631/235.739 ms, and RPS fell from 470.7 to 381.2. Its round-24
max rose from 69.413 to 348.182 ms. The largest single observations across
all cases were 353.839 ms in baseline (150-group feed-next C8, round 24)
and 348.182 ms in candidate (30-group thread-first C8, round 24).
The six raw-preserving records retain all medians, paired losses and tails.

This is a prepared loopback workload with full-proof/traversal warming;
working-set samples cover bounded selections of the larger domains.
Pre-run load/free-memory observations are point samples. OS cache was retained
without resets and residency was unmeasured. The historical instrument
`36f4026b…` reports no traversal latency or traversal RPS; its verify-only
`auth.timedIdentities=3` field is preserved, while that invocation has no
repeated-case timing. No competitors were rerun, and these results do not
establish adoption, a general/platform win, device throughput, memory-pressure,
write or durability behavior. Controller `6d2a2f7e…`, setup `a53df17e…` and
qualification `25a61327…` are fully bound in every annotation.

## HTTP request-stage diagnostic

An HTTP stage diagnostic used the 0.2.8 source `8a81eb855`, the published build input `-USQLITE_ENABLE_MEMORY_MANAGEMENT`, and one instrumented `serve.rs` on Durand (M4 Pro/macOS). The experimental CLI `b512a52a…` is distinct from the published artifact. Its build receipt records 26 CLI tests and one production-profile independent-reader test passed, zero failed/ignored; 614 of 615 archived files were unchanged. The extra logging is diagnostic overhead.

The first load (23:35:25–23:36:14 UTC) exited 1 after 18 completed 1,000-request blocks with `UND_ERR_SOCKET: other side closed`. It retained 18,548 server traces but no final client JSON or after-load verifier; those extra traces do not establish successful client responses. Its build qualification and failed load remain separate. The cause is unestablished. V2 retained the same executable and request plan, added partial client/error preservation, stopped new scheduling after failure and awaited in-flight workers; it added no retry.

V2 completed at 23:47:15 UTC (receipt start 23:45:19), exit 0. All 48,000 selected requests matched the expected responses and exact 15-stage server traces: eight rounds × C1/C8 × point/thread/feed × 1,000 requests. It excluded 1,440 warmups and 1,500 preparation feed pages. Full before/after authorized verification used the same server and previously issued seven-day guest sessions: another 18 untimed walks/3,730 pages plus auth and cursor checks. The hash-bound pristine fixture, activation identity and owned-process teardown reconcile. This diagnostic made no new physical full-database scan or leave/regrant exercise.

Each row below pools eight equal 1,000-request blocks. Values are milliseconds; percentiles use nearest rank. The complete record preserves all 48 blocks, all phase distributions, and raw client/server hashes.

| Case | Client body mean | Server flushed mean | Signed residual mean | Client p95 | Client p99 | Client max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| C1/point | 2.4875 | 0.7527 | 1.7348 | 3.3348 | 3.9989 | 16.1651 |
| C1/thread | 2.9417 | 1.1800 | 1.7616 | 4.0056 | 4.7304 | 14.7078 |
| C1/feed | 5.0039 | 3.4692 | 1.5347 | 5.7341 | 6.2666 | 15.9127 |
| C8/point | 2.5627 | 1.5796 | 0.9831 | 3.8882 | 5.3759 | 17.5993 |
| C8/thread | 3.9655 | 2.8725 | 1.0930 | 5.2290 | 6.1259 | 8.4934 |
| C8/feed | 6.3309 | 5.1489 | 1.1821 | 7.6643 | 8.4798 | 12.1909 |

For C1 point reads, body completion after headers averaged 0.0341 ms. The elapsed query interval was the largest mean measured server phase in each group, but these intervals include scheduling and waits. Server timing starts at dispatch, after unobserved accept/parser work; `flushed` means the write/flush call returned, not acknowledgement. Stderr formatting/I/O happens after the last stage while the request permit is still held and can affect later admission. The signed client-minus-server residual is neither network time nor CPU time.

The prepared domain contains all 1,500 feed pages. Selected requests visit 1,259 unique feed pages and 5,555 of the 150-group reader's 30,000 point rows across eight rounds (1,000 unique inputs per corresponding block); C1/C8 use the same selections. Thread requests repeat the first page of group `g020`. This is an instrumented single-host diagnostic, with no optimization adoption, comparator, device, write, durability, WAN or unsampled-performance conclusion.

## Partial HTTP parser-stage diagnostic

The subsequent parser-stage diagnostic **failed and remains partial**. It used the same archived 0.2.8 source `8a81eb855` and `-USQLITE_ENABLE_MEMORY_MANAGEMENT` on Durand, with timestamps added to three existing files. Its experimental CLI `8e1f6507…` (6,967,536 B) passed 26 CLI tests and one explicitly named production reader test, zero failed/ignored; 612 of 615 archived files remained unchanged. That successful build qualification does not qualify the failed HTTP workload.

The load ran 2026-09-14 00:15:08–00:16:22 UTC and exited 1 without retries. It attempted 30,768 selected calls: 30,766 returned exact expected responses and two recorded `UND_ERR_SOCKET` failures (IDs 30766/30767, round 5 C8 point samples 765/766). ID 30768 succeeded. All 30,766 successful calls have exactly one complete 17-stage server trace; neither failed ID has a trace. Thirty 1,000-request blocks completed, followed by 766 successful calls in the unfinished C8 point block. Actual excluded warmups were 930 of the planned 1,440, in addition to 1,500 preparation feed pages. The before-verifier passed nine untimed walks/1,865 pages plus auth/cursor checks using the hash-bound pristine fixture and previously issued sessions. No after-verifier ran. The owned server then exited on controller SIGTERM. Original raw files and the failed receipt remain intact.

The table summarizes available successful observations in milliseconds, using nearest-rank percentiles. C8 point includes the unfinished block and has more samples; these are not a completed, balanced comparison. The evidence record also retains separate complete-block-only distributions and every observed block.

| Case | Successes | Client body mean | First-byte-to-flush mean | Signed residual mean | Client p95 | Client p99 | Client max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| pointC1 | 5,000 | 2.4676 | 0.7687 | 1.6988 | 3.2387 | 3.8071 | 16.1547 |
| threadC1 | 5,000 | 2.8544 | 1.1585 | 1.6959 | 3.9212 | 4.7377 | 17.2647 |
| feedC1 | 5,000 | 4.9700 | 3.4579 | 1.5121 | 5.7133 | 6.1450 | 15.7557 |
| pointC8 | 5,766 | 2.6871 | 1.7200 | 0.9671 | 3.9371 | 5.9471 | 12.3870 |
| threadC8 | 5,000 | 3.9702 | 2.8958 | 1.0744 | 5.1348 | 5.8339 | 10.6139 |
| feedC8 | 5,000 | 6.5800 | 5.3893 | 1.1906 | 8.2487 | 10.1393 | 27.6284 |

For C1 point reads, the added parser interval averaged 0.0187 ms and the following construction/queue/scheduling interval to dispatch 0.0179 ms. These clocks begin only after the parser observes its first byte, including ordinary small-body prebuffering afterward. They exclude waiting for that first byte and prior buffering; neither endpoint is packet arrival. Stages are elapsed intervals, not CPU time. Client-minus-flush remains a signed difference across different boundaries, not network time. Successful calls visited 5,185 point rows and 1,148 feed pages from the 30,000-row/1,500-page domains; thread calls repeat the first page of `g020`.

The source can close before trace emission through connection admission, request admission, or socket/deadline handling. Diagnostic stderr formatting/I/O also retains a request permit after the last timestamp and response flush, so completed client calls need not imply released server permits. These are hypotheses, not an identified failure cause. There is no server close-reason observation, successful complete-run qualification, adoption, comparator, device, write, durability, WAN or unsampled-performance conclusion.

## Published-server client-path comparison

A separate client-path diagnostic completed on Durand from 2026-09-14 00:30:46–00:32:13 UTC, exit 0, using the unchanged published 0.2.8 server bytes (`92db0d86…`, 6,967,520 B; source `8a81eb855`). It compared Node 24.18 built-in fetch (Undici 7.28.0) with `node:http` using `Agent({keepAlive:true,maxSockets:8,maxFreeSockets:8,scheduling:'lifo'})`. No server tracing or product source change was present.

All 48,000 selected calls passed exact response checks: four rounds × two clients × C1/C8 × point/thread/feed × 1,000 samples. Fetch/http order alternated by round; C1/C8 order reversed for the last two rounds. Inputs matched within each round. Each block had 30 excluded warmups (1,440 total). All 1,500 preparation feed pages used fetch only. Before/after verification passed on the same server PID and previously issued sessions: 18 additional untimed walks/3,730 pages plus auth/cursor checks. Fixture, activation, raw-output hashes and owned-process teardown reconcile; no new physical full-database scan or leave/regrant exercise occurred.

Each table cell is **fetch / node:http**, in milliseconds, pooling 4,000 successful calls per client/case. Percentiles use nearest rank. Timers include request construction through JSON parsing and exclude projection/oracle checks; the complete record also retains all 48 block distributions and matched-round comparisons.

| Case | Body mean | p50 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: |
| pointC1 | 3.2250 / 0.1978 | 3.4150 / 0.1919 | 4.1462 / 0.2367 | 5.5146 / 0.2729 | 18.6105 / 2.4324 |
| threadC1 | 3.9911 / 0.3285 | 4.0109 / 0.3216 | 5.2652 / 0.3517 | 7.1531 / 0.4077 | 19.0320 / 3.0434 |
| feedC1 | 5.1707 / 1.5273 | 5.2154 / 1.4958 | 6.7528 / 1.7231 | 7.9609 / 1.8258 | 16.1737 / 5.2473 |
| pointC8 | 2.4534 / 2.6536 | 2.2244 / 2.6105 | 4.2011 / 3.3532 | 6.1765 / 3.9781 | 10.7534 / 7.3589 |
| threadC8 | 3.7597 / 4.0047 | 3.8233 / 3.9677 | 4.9790 / 4.7560 | 5.6426 / 5.4880 | 8.7190 / 8.5967 |
| feedC8 | 6.2697 / 5.8030 | 6.1507 / 5.6720 | 8.0058 / 7.1886 | 9.6578 / 8.8225 | 12.8608 / 11.2166 |

Node HTTP had lower pooled means/p50s in four of six cases and lower pooled p95/p99/max in all six, but C8 point and thread means were higher. Across 24 matched round/case pairs, HTTP was lower in 17 means/p50s, 22 p95s/p99s and 21 maxima. C8 point p50 was higher in all four rounds; point and thread means were higher in three of four. Remaining tail regressions are retained: round 2 C8 point max +27.08%; round 1 C8 thread p99 +11.45% and max +0.53%; round 2 C8 thread p95 +4.20%; round 3 C8 feed mean +1.97%, p95 +19.23%, p99 +23.66% and max +0.82%. The largest successful observation was fetch C1 thread at 19.0320 ms. This complete diagnostic does not erase the earlier failed server-tracing attempts or identify their socket-close cause.

The four rounds selected 4,000 unique point rows and 1,111 feed pages from domains of 30,000/1,500; thread requests repeat the first page of `g020`. The clients have different native pooling, framing and decoding, and separate pool histories; fetch alone performed preparation, while both received block warmups. OS cache was retained without resets, residency unmeasured. These are complete client-path observations on one host, not isolated network/server/decoder costs or a general adoption, comparator, browser/device, write, durability or WAN conclusion.

### 0.2.8 fetch lifecycle diagnosis — instrumented client observations

One Durand M4 Pro run completed on 2026-09-14 at 00:54:57 UTC using the unchanged published 0.2.8 CLI (`92db0d86…`, 6,967,520 B), Node 24.18.0 and its bundled Undici 7.28.0. Eight rounds alternated C1/C8 order for point, first-thread-page and working-feed-page queries: all 48 blocks × 1,000 selected requests passed exact response checks. All 48,000 IDs had exactly one of each five captured events (240,000 observations, captureErrors 0); observed order was create, sendHeaders, bodySent, responseHeaders, trailers throughout. The validator did not require that order. Load completion, capture validation and same-process/same-session after-verification each passed separately; owned server cleanup and outer exit were successful.

Pooled mean milliseconds from local library observations (8,000 selected requests per row):

| Case | Start→create | Create→sendHeaders | SendHeaders→responseHeaders | ResponseHeaders→trailers | Trailers→JSON endpoint | Complete JSON endpoint |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| pointC1 | 0.1168 | 1.2720 | 1.5437 | 0.0218 | 0.1017 | 3.0561 |
| threadC1 | 0.1240 | 1.2848 | 2.3827 | 0.0255 | 0.1530 | 3.9700 |
| feedC1 | 0.0519 | 1.2737 | 3.9385 | 0.0102 | 0.0604 | 5.3347 |
| pointC8 | 0.0169 | 0.8358 | 1.5380 | 0.0031 | 0.0142 | 2.4079 |
| threadC8 | 0.0163 | 0.9106 | 2.6671 | 0.0032 | 0.0237 | 3.6209 |
| feedC8 | 0.0182 | 1.0258 | 5.1004 | 0.0034 | 0.0210 | 6.1688 |

The separate sendHeaders→bodySent means were 0.1415/0.1570/0.0509 ms for C1 point/thread/feed and 0.0153/0.0152/0.0166 ms for C8. ResponseHeaders→the fetch-headers endpoint means were 0.0697/0.0777/0.0316 ms for C1 and 0.0097/0.0099/0.0104 ms for C8; this is a separate branch from response-body completion. Signed differences were retained without clamping. Complete JSON endpoint maxima were 19.226/36.298/34.403 ms for C1 point/thread/feed and 14.980/8.678/13.120 ms for C8. The record retains all per-block and pooled p50/p95/p99/max observations, including the 36.298 ms thread C1 request in round 5.

The 1,440 warmups and 1,500 preparation feed pages were excluded from selected counts. Selected requests visited 5,555 of 30,000 point keys and 1,259 of 1,500 feed pages; the thread case repeated one 50-row page. Before and after verifiers added 18 untimed complete walks/3,730 pages plus auth/cursor checks, using the same previously issued sessions. This restored a previously verified logical 100,000-message fixture; it did not perform a new physical full-database scan or leave/regrant exercise.

Callbacks and in-memory event collection perturb the load, including unselected preparation/warmups. Timers end after JSON decoding and before projection/oracle checks. These intervals locate local client-library boundaries; they are not network-only, CPU or server duration, and the observed create→sendHeaders interval does not identify any particular timer or scheduler cause. No server instrumentation, retry, package change, comparator, device, WAN, write, durability or adoption result is claimed. The raw load is `11fe41d7…`, receipt `92c935dd…`, frozen controller `4e8a23bc…`, and loader `3c6e75cd…`; the independently computed summary is `cdfe820c…`.

### 0.2.8 dispatcher comparison using the same runtime — mixed C1/C8 outcome

On Durand M4 Pro, one run ending 2026-09-14 01:12:13 UTC held the published 0.2.8 server (`92db0d86…`) and Node 24.18.0 fixed. Both paths used built-in fetch: its bundled Undici 7.28.0 dispatcher, or an explicit per-call Agent from the complete unmodified npm Undici 7.29.1 package. The package index/global-dispatcher setter was not loaded. Four rounds alternated which client led; C1/C8 order reversed after round 1. All 48 blocks × 1,000 selected requests passed exact response checks, and every ID had one of each five events (240,000 observations, captureErrors 0). Response, process-exit, agent-cleanup, package-before/after and same-process/same-session after-verification outcomes all passed independently.

Pooled milliseconds, **bundled→updated**, with 4,000 requests per client/case. Endpoint times end after JSON decoding; quantiles are nearest-rank individual-request quantiles.

| Case | Body mean | p50 | p95 | p99 | Max | Create→sendHeaders mean |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| pointC1 | 3.085→0.226 | 3.128→0.212 | 4.456→0.271 | 5.935→0.372 | 27.543→3.016 | 1.293→0.006 |
| threadC1 | 3.798→0.371 | 3.847→0.351 | 5.287→0.432 | 6.778→0.583 | 31.085→5.737 | 1.276→0.005 |
| feedC1 | 5.344→1.526 | 5.543→1.510 | 7.020→1.606 | 8.087→1.839 | 13.736→5.004 | 1.265→0.005 |
| pointC8 | 2.396→2.615 | 2.151→2.589 | 4.159→3.235 | 5.808→3.915 | 11.240→7.630 | 0.839→0.015 |
| threadC8 | 3.553→3.972 | 3.654→3.931 | 4.755→4.694 | 5.572→5.679 | 7.985→9.843 | 0.916→0.014 |
| feedC8 | 6.140→5.848 | 6.084→5.744 | 7.517→7.048 | 8.200→8.364 | 14.806→9.494 | 1.019→0.009 |

Across 24 matched round/case pairs, updated body mean/p50/p95/p99/max were lower in **16/16/21/22/20** pairs. C8 point and thread means **and p50s were higher in every round**: point mean increases were 6.86–11.68%, thread 8.01–15.67%. The create→sendHeaders mean/p50/p95/p99 were lower in all 24 pairs, but its maximum was higher for thread C8 round 1 (3.182→3.372 ms) and feed C8 round 2 (2.658→3.200 ms). A smaller local stage interval therefore did not guarantee a smaller complete response time.

Every body tail loss remains: p95 was higher for thread C8 rounds 1 and 3 and feed C8 round 2; p99 for thread C8 round 3 and feed C8 round 2; maxima for thread C8 rounds 0–2 and feed C8 round 2. Pooled thread C8 p99/max and feed C8 p99 were also higher, as the table shows. The largest individual observations were 31.085 ms bundled (thread C1, round 1) and 9.843 ms updated (thread C8, round 1). All 48 blocks, signed stage deltas and losses remain in the record.

Each client visited the same 4,000 point keys and 1,111 of 1,500 feed pages; the thread case repeated one 50-row page. The 1,440 warmups and 1,500 feed preparation pages were excluded from selected counts. Preparation used only the bundled client, and both pools retained their separate histories. Before/after checks added 18 untimed complete walks/3,730 pages plus auth/cursor checks using the same previously issued sessions; this was not a new physical full-database scan or leave/regrant exercise. All 210 npm files and archive/registry integrity were checked before and after; no lifecycle script or product package installation was involved.

This instrumented comparison includes callback/collection overhead and the entire dispatcher-version/defaults delta. It does not isolate any particular timer, network time, CPU time or server duration, or qualify a Node runtime upgrade, first-party client change, comparator, device/WAN, write/durability result or adoption. Server source and build were unchanged, and there were no retries. Raw load `366de1b8…`, receipt `ca9648fb…`, controller `14ce2e88…`, loader `5391661c…` and independently frozen summary `f6197a5e…` bind the observations.

### SQLite memory-accounting follow-up using Node 24.21.0

On 2026-09-14 UTC, three paired rounds on the prepared Durand M4 Pro compared the same retained 0.2.8 production binaries: baseline `92db0d86…` (the published CLI) and experimental `93fa3b16…`, whose only additional SQLite input is `-DSQLITE_DEFAULT_MEMSTATUS=0`. Both retain `-USQLITE_ENABLE_MEMORY_MANAGEMENT`, thread safety and configured cache size. Both clients used the same official Node 24.21.0 binary `e4b5a3af…`, bundled Undici 7.29.1 and ordinary built-in fetch, with no lifecycle hooks or custom dispatcher. This compares the SQLite variants under that runtime; it is not an isolated Node-upgrade experiment.

Trials 61–63 ran B/C, C/B, B/C with identical logical inputs within each pair. Six runs completed all 39 cases × 500 samples: **117,000 case calls**, plus 7,020 excluded case warmups. Separate initial/after-leave/regrant traversals contributed **33,510 timed page requests across 162 walks**. Two earlier 50-sample smokes passed and are excluded from the formal comparisons. Every run restored the same 100,000-message snapshot, checked all three physical application tables, verified full authorized feeds/threads and denial/cursor behavior, left one group, checked the current authorized union, restored that membership and reverified with the same previously issued sessions on the same server. All reported errors were zero; owned processes stopped successfully.

Counts below compare medians of three **per-run statistics**, not pooled request quantiles. Case throughput is requests/second; traversal throughput is pages/second. Individual latency timers include HTTP/JSON/projection; throughput includes exact oracle checks.

| Comparison | Lower p50 | Lower p95 | Lower p99 | Lower maximum | Higher throughput |
|---|---:|---:|---:|---:|---:|
| All case medians / 39 | 38 | 30 | 26 | 25 | 34 |
| C1 case medians / 21 | 20 | 12 | 9 | 8 | 16 |
| C8 case medians / 18 | 18 | 18 | 17 | 17 | 18 |
| All paired case values / 117 | 97 | 88 | 80 | 82 | 91 |
| Traversal medians / 27 | 16 | 18 | 16 | 16 | 19 |
| Paired traversal values / 81 | 48 | 46 | 44 | 40 | 48 |

In all 54 C8 paired cases, p50/p95 were lower and throughput was higher; C8 p50 medians were 30.48–82.03% lower. C1 retained substantial tail variation: 12/21 p99 and 13/21 maximum medians were higher, and 20/63 paired p50 values were higher. The sole higher case p50 median was five-group `FeedWorkingSetC1`, 0.509→0.510 ms. Median throughput fell for five-group `ThreadFirstC1`, `FeedNextC1`, `FeedWorkingSetC1`, and 30-/150-group `FeedFirstC1`. Selected tail regressions include five-group `FeedNextC1` maximum median 3.448→7.790 ms and 30-group `PointWorkingSetC8` p99 3.548→4.167 ms / maximum 3.885→4.723 ms. The largest individual case observations were 18.871 ms baseline and 15.777 ms candidate; neither is omitted.

Traversal behavior was mixed. The initial 150-group feed's p50/p95 medians were 1.648/1.804→1.695/1.949 ms; its after-leave maximum median rose 3.195→10.363 ms. The largest individual traversal page observations were 17.826 ms baseline and 22.254 ms candidate. Paired traversal p99 and maximum each have one tie; all remaining comparisons not counted as lower in those columns are losses. One-page empty controls and four-page threads provide few observations for tail percentiles. All raw values, every case/traversal median loss and every loss in a matched pair are retained in the [appended records](../../../snapback4/metrics/storage.jsonl).

Bindings: source `8a81eb855…`, historical build qualification `90b7637b…`, frozen instrument `ebe5b64d…`, controller `26f8c62f…`, Node download receipt `bf507238…`; independent summary `e37d2f44…`. Fresh server/client processes and full proofs/traversals preceded repeated cases; OS cache was retained without resets, residency unmeasured. Earlier Node 24.18 observations remain intact. This evidence makes no adoption, general platform, comparator, device, memory-pressure, write-throughput or durability claim.

### Node 24.21 client compatibility follow-up (2026-09-14 UTC)

On Durand, the archived 0.2.8 source (`8a81eb855`) completed the wasm/package build and **89 client tests with zero failures or skips** under Node 24.21.0 / Undici 7.29.1. The helper supplied the retained experimental MEMSTATUS-off CLI (`93fa3b16…`) for tests honoring `SNAPBACK4_BIN`; five tests in `local-e2e` and `native-e2e` instead use a shared debug executable whose digest this receipt does not identify. This is scoped client compatibility evidence, not a full suite, publication or performance result.

Both unsuccessful preparation attempts remain recorded. V1 omitted generated wasm: the package build failed, two client files could not load the module, and React initialization timed out after Vite reported the same missing import (29 passes, 3 failures). V2 added the wasm step but could not find `wasm-bindgen`, then retained the same client failures. V3 used the hash-verified, previously prepared publication tools and passed on the unchanged archived source. The **nine fixture-wrapper tests passed in V1** and were retained explicitly, not rerun in V3. All three raw receipts, exit codes, logs and test-source hashes are preserved in the metrics record; no prior failure was reclassified as a pass.

### ARM Linux MEMSTATUS comparison with Node 24.21 (2026-09-14 UTC)

Office M1 Max / ARM Linux Colima (4 CPUs, 12 GiB) ran three paired rounds, 71–73, in baseline/candidate, candidate/baseline, baseline/candidate order. Both use Node 24.21.0 / bundled Undici 7.29.1 and ordinary built-in fetch, the unchanged historical membership instrument (`36f4026b…`), and archived 0.2.8 source (`8a81eb855`). Retained production CLIs `33bd0c0b…` and `8c47c6a5…` differ by candidate `-DSQLITE_DEFAULT_MEMSTATUS=0` beside the existing `-USQLITE_ENABLE_MEMORY_MANAGEMENT`; they are source-built Linux artifacts.

All **117,000 case requests** (39 cases × 500 samples × six runs) passed exact-result checks with zero reported errors; **7,020 warmups** are excluded. Fresh processes restore the same pristine snapshot and previously issued guest sessions, check all 501 groups / 186 memberships / 100,000 messages, exercise denial, leave and old-cursor checks, then regrant and verify using unchanged sessions. All **162 complete walks / 33,510 page requests are untimed**. Separate two-variant smoke results are preserved and excluded from the comparison.

Counts below compare medians of three per-run statistics; paired counts compare the same logical trial inputs. Lower is better for latency; higher is better for RPS.

| Scope | Lower p50 | Lower p95 | Lower p99 | Lower max | Higher RPS |
|---|---:|---:|---:|---:|---:|
| Case medians (39) | 26 | 23 | 19 | 20 | 26 |
| Paired case statistics (117) | 78 | 69 | 56 | 56 | 76 |

The candidate has lower p50 medians in all 18 C8 cases, but **13 of 21 C1 cases regress** (37 of 63 paired C1 p50 values are worse). Representative medians, in milliseconds:

| Case | p50 baseline → candidate | p95 baseline → candidate |
|---|---:|---:|
| 30-group hot point C1 | 1.692 → 2.480 | 2.706 → 8.013 |
| 30-group thread first C1 | 2.396 → 3.449 | 3.166 → 10.545 |
| 150-group feed next C1 | 7.229 → 7.471 | 8.757 → 13.092 |
| 150-group feed first C8 | 29.376 → 22.158 | 75.039 → 47.329 |

Hot-point and 150-group feed-next C1 p50 regress in all three pairs; thread-first C1 regresses in two. C8 retains five p99-median losses, including 150-group feed working set, 61.705 → 63.858 ms. The largest individual observations are 306.769 ms baseline and 193.058 ms candidate, in different cases. Every raw statistic and median/paired loss remains in the evidence records.

The candidate remains experimental; no setting was adopted after these serial-read regressions. OS cache was retained without resets and residency was unmeasured; full proofs/walks preceded the repeated cases. It does not isolate a Node upgrade from the earlier runs, pool per-request quantiles, rerun comparators, or establish a Darwin, device, write, memory-pressure, durability or universal performance result.

### Bounded request-worker reuse on Darwin, Node 24.21.0

On Durand M4 Pro, three alternating pairs (84–86, baseline/candidate, candidate/baseline, baseline/candidate) compared the retained published Darwin 0.2.8 CLI with an isolated candidate that reuses bounded request workers. Both used Node 24.21.0/Undici 7.29.1, ordinary built-in fetch, identical SQLite flags (`-USQLITE_ENABLE_MEMORY_MANAGEMENT`) and MEMSTATUS on. The same 100,000-message fixture and original guest sessions were restored for each fresh server. All 117,000 case calls, 7,020 excluded warmups and 162 complete walks/33,510 separately timed pages passed exact results, auth/denial, full fixture, leave/old-cursor and same-session regrant checks; reported errors were zero. Smoke samples are excluded.

These counts compare medians of three reported run statistics, not pooled request percentiles:

| Candidate improvement | Case medians /39 | Paired cases /117 | Traversal medians /27 |
| --- | ---: | ---: | ---: |
| Lower p50 | 39 | 116 | 25 |
| Lower p95 | 38 | 102 | 24 |
| Lower p99 | 32 | 85 | 25 |
| Lower max | 22 | 65 | 22 |
| Higher throughput | 38 | 106 | 25 |

One case p99 median tied; the other uncounted comparisons are losses. The 150-group PointWorkingSet C1 p95 rose **0.236→0.285 ms**, with throughput **4,642.8→4,555.7 requests/s**. Five-group FeedNext C8 p99 rose **4.863→9.999 ms**. Seventeen case median maxima rose; 150-group hot-point C1 max rose **0.333→2.894 ms**. The only paired p50 loss was 150-group ThreadFirst C1 in trial 85 (**0.343→0.351 ms**). Worst individual case observations were 20.375 ms baseline and 19.360 ms candidate. Every statistic and regression remains in the annotated records. Traversal timing is separate; one-page empty controls and four-page thread walks provide few tail observations, and walk throughput includes exact checks outside individual request timers.

After all measurements/proofs and a 6.5-second quiet interval, idle medians were **3→11 total threads** and **21,584→24,688 KiB RSS** (+3,104 KiB); virtual size rose 17,840 KiB. These are whole-process point observations, not peak memory or pure worker-stack attribution. Background maintenance remained active; OS cache was retained without measured residency.

The original build's unsupported method and stale-timestamp test reuse, and the first smoke's idle ps-parser failure, are preserved separately and excluded. They were corrected before formal timing. The corrected build passed 27 CLI tests, a separate rerun of the focused reuse witness, one existing store-policy test and production compilation; it did not run the full workspace/client/publication path. Panic recovery is evidenced only in unwinding tests; production still uses `panic=abort`. At this checkpoint the candidate remains unadopted pending Linux evidence. No comparator, cross-platform, device, write, durability, memory-pressure or universal improvement claim follows.

The appended storage records retain both platform build qualifications and their failed first receipts, followed by all six Darwin formal records. The Darwin candidate is `bc8d2fc79b05d5065265684b11cd4d4dc7c925d89e88fd684d6ceb680dee37bb` (6,984,080 bytes), built from archived 0.2.8 with the two recorded source overrides; qualification `7e1b6a9ba2b89cec505dd04ef4688ecf4f2c2fdec5d00faea35857b84956cf12`. Controller `3c2beb6c3fcc0301c1e0375e218e1dda7b4b4011338037e971d29313a1a41840`, independent summary `f37be13fc326d61a9717640e07e67019efb6f02993051361451ef937fa2a60c1`, and reviewed raw records bind the results. Retained public artifacts are under `.llp/ship-runs/sb4-performance-20260913/request-workers-node2421-http/`; the first failed smoke and build rounds have separate directories under the same ship-run root.

### Corrected worker source: complete suite qualification

On Durand, the existing `scripts/test.sh` completed with **238 Rust passes and one existing ignored test, 89 client passes and 9 fixture-wrapper passes**, zero failures and no JavaScript skips. All ten script stages succeeded in 58.811 seconds of subprocess wall time (the script reports 59 seconds), after a frozen dependency install. The source remains the same isolated corrected 0.2.8 worker candidate, with Node 24.21.0, Rust 1.97.0 and the published SQLite build input.

The suite first built the debug workspace and generated wasm/package outputs. With `SNAPBACK4_BIN` absent, CLI-spawning client tests—including those hardcoding the debug path—used that fresh debug build (`100447c8…`, 41,559,096 bytes). This is separate from the retained production candidate `bc8d2fc7…`, whose hash remained unchanged. The helper checked all 615 archived source files before/after, allowing only the exact worker source and test overrides. This qualifies the existing source/debug suite; it is not a claim that tests ran against production, a publication/installed-consumer receipt, or another HTTP performance measurement. Production still uses `panic=abort`.

### Request-worker reuse on ARM Linux: prototype not adopted

The MPSC worker prototype is **not adopted**, globally or as platform-specific behavior; the published dispatcher remains unchanged. On Office ARM Linux/Colima, three alternating pairs (87–89) compared retained baseline `33bd0c0b…` with corrected candidate `e3abf8f0…`, both source-built from archived 0.2.8 with the same SQLite input, MEMSTATUS on and Node 24.21.0. The historical instrument, 100,000-message fixture and original 90-day guest sessions remained fixed. All **117,000 case calls**, 7,020 excluded warmups and **162 untimed complete walks/33,510 pages** passed exact results, auth/denial, full fixture, leave/old-cursor and same-session regrant checks; reported errors were zero. Smoke results are excluded.

| Candidate improvement | Case medians /39 | Matched pairs /117 |
| --- | ---: | ---: |
| Lower p50 | 22 | 67 |
| Lower p95 | 18 | 54 |
| Lower p99 | 16 | 52 |
| Lower max | 20 | 54 |
| Higher requests/s | 21 | 63 |

These are medians of three reported run statistics, not pooled quantiles. There were no ties; all uncounted comparisons were losses. C1 p50 medians worsened in 11/21 cases and p95 in 14/21. Thirty-group ThreadNext C1 p50 rose **2.922→3.526 ms**, p95 **5.268→11.144 ms**, while throughput fell **304.3→200.5 requests/s**. Five-group FeedNext C8 p50 rose **10.949→14.175 ms** and p99 **24.256→51.550 ms**. Improvements are retained too, including 150-group FeedFirst C1 p50 **7.674→6.013 ms**. Worst individual observations were **173.761 ms baseline and 205.363 ms candidate**. Every case, tail and throughput loss remains in the annotated records.

After all measurements/proofs and a 6.5-second quiet interval, total idle threads were **3→13** in every pair; median RSS was **12,644→25,672 KiB** (+13,028 KiB). Median virtual size fell 1,955,556→1,905,020 KiB, with one pair increasing. These are whole-process `/proc/status` point observations, not peak memory, pure stack allocation or memory-pressure evidence. OS cache was retained without measured residency. The favorable Darwin p50 results do not override these Linux regressions and resource costs. No causal mechanism, cross-platform timing comparability, traversal timing, comparator, device, write, durability or production panic-recovery claim follows; production still uses `panic=abort`.

The suite receipt is `b061ed1535f3b0ec8770e883573d0cf8e0d9dd713d99ae9cc01842bdb95e79a7`. Linux qualification `0ab085c1f9b77307550b3943147509004478f63388b984d104c2930c788746d1` binds candidate `e3abf8f0403b3f9e9314165375cd86812ebef9c6da24cb90de63061b7b69d640` (7,491,088 bytes). The controller is `31d8dd9e8a40b6f498b89e3c08ee9f69342834d06eec55f2e15038aadd7861f0`; independent summary `ffc607589ff9554ecc05a327204fda8cbe479fe165f94720ea11475671cc1024` retains all comparisons and artifact hashes. Public evidence remains under the same ship-run root in `request-workers-full-suite/` and `request-workers-node2421-linux-http/`; the appended records preserve the raw suite receipt and all six Linux records.

### Condvar request-worker prototype: source qualification

A separate bounded prototype replaces per-request thread creation with reusable workers consuming a mutex/condition-variable queue. Admission remains 32 short requests plus 32 waiting requests, queued tasks retain their permits, and the two lanes stay separate. Source `ad5c1ff7…` and the unchanged focused test `d1639787…` are the only overrides to archived 0.2.8. Both Darwin and ARM Linux qualifications recompiled the baseline test and observed the intended worker-reuse assertion failure, then passed the recompiled candidate test, all 27 CLI tests, the existing SQLite policy/refresh test and production compilation. SQLite flags remain `-USQLITE_ENABLE_MEMORY_MANAGEMENT`, with MEMSTATUS on. The tests exercise unwinding; production retains `panic=abort`.

On Durand, the existing complete suite subsequently passed all ten stages: **238 Rust tests, one existing ignored Rust test, 89 client tests and 9 fixture tests**, with zero failures or JavaScript skips. Subprocess wall time was 44.760 seconds (the script reports 45 seconds). The suite built the debug workspace before client tests with `SNAPBACK4_BIN` absent, so CLI-spawning clients used fresh debug binary `4b5425b1…` (41,472,456 bytes). The retained production candidate remained unchanged. This is source/debug qualification, separate from production, publication and performance evidence; no corpus-case counts are inferred from the quiet suite output.

Darwin qualification `e184e860…` binds production candidate `1f72258e…` (6,967,536 bytes); Linux qualification `9c772437…` binds `9cd0d221…` (7,491,088 bytes). Full-suite receipt `b92b69de…` and the appended build/suite records retain all source, tool and log hashes. Public artifacts remain under `.llp/ship-runs/sb4-performance-20260913/` in `request-workers-condvar-darwin/`, `request-workers-condvar-office/` and `request-workers-condvar-full-suite/`.

### Condvar worker experiment: ARM Darwin, Node 24.21.0

A separate `Mutex<VecDeque<RequestTask>>`/`Condvar` candidate was compared with retained published 0.2.8 on the M4 Pro. It preserves the existing 32 short/32 wait permits and SQLite settings; this is an isolated experiment, with no adoption conclusion. Source `8a81eb855` plus patch `3482b542…` produced candidate `1f72258e…` (6,967,536 B), versus published baseline `92db0d86…` (6,967,520 B). Both used Node 24.21.0 / bundled Undici 7.29.1, ordinary built-in fetch, and `-USQLITE_ENABLE_MEMORY_MANAGEMENT` with MEMSTATUS enabled.

Three alternating pairs (trials 90–92: B/C, C/B, B/C) completed all 39 cases × 500 samples: 117,000 case calls plus 7,020 excluded warmups. Full fixture/auth/leave/old-cursor checks and regrant with the original sessions passed; 162 complete walks supplied another 33,510 timed pages. All reported errors were zero; the two 50-sample smokes are excluded.

| Candidate result | p50 | p95 | p99 | max | RPS |
| --- | ---: | ---: | ---: | ---: | ---: |
| Better case medians / 39 | 37 | 36 | 28 | 27 | 38 |
| Worse case medians / 39 | 2 | 2 | 9 | 12 | 1 |
| Better paired cases / 117 | 111 | 100 | 84 | 75 | 109 |
| Worse paired cases / 117 | 6 | 16 | 32 | 42 | 8 |

Lower latency and higher RPS count as better; p95 has one median/paired tie, and p99 has two median ties and one paired tie. These are medians of three reported run statistics, not pooled percentiles. For example, 150-group working-feed C8 p50/p95 fell 5.601/7.305→4.472/5.051 ms, with RPS 1,379.3→1,781.7. Retained losses include 5-group hot/working point C1 p50 0.294/0.296→0.297/0.297 ms, 30-group hot-point C1 p95 0.254→0.279 ms and RPS 4,521.4→4,499.7, 5-group feed-next C8 p99 4.782→7.954 ms, and working-feed C1 max median 3.660→14.400 ms. Worst individual case observations were 22.686 ms baseline and 16.542 ms candidate. All per-run metrics and paired losses remain in the annotated records.

Separate traversal medians improved p50/p95/p99/max in 24/25/23/20 of 27 identities; losses were 2/2/4/7, with one p50 tie. Page RPS improved in 25 and worsened in two. One-page empty controls and four-page threads have few tail observations; page timers include HTTP/JSON projection, while walk wall time/RPS also include oracle checks.

After measurements/proofs and 6.5 seconds without harness HTTP work, idle thread counts were 3→11 in each pair. Median whole-process RSS was 21,568→24,592 KiB (+3,024), and virtual size rose 18,000 KiB. These are point samples, not peak memory or pure worker-stack costs. Fresh processes and full checks precede each run; OS cache is retained without resets, residency unmeasured. The prior MPSC failures/results remain separate. The Condvar build passed the focused reuse test, 27 CLI cases and existing store-policy test; production panic=abort is unchanged. No comparator, device, write, durability, memory-pressure, cross-platform or universal-win claim is made.

### Condvar worker experiment: ARM Linux, not adopted

The Condvar worker prototype is **not adopted globally or per platform**. The bounded worker-pool experiment ends here; the existing production dispatcher remains. Despite improvements in many cases, this Office M1 Max/Colima comparison retained substantial Linux regressions and higher idle RSS. Positive build/full-suite qualification is separate from that performance decision.

Trials 93–95 used alternating B/C, C/B, B/C orders, retained Linux baseline `33bd0c0b…` and Condvar candidate `9cd0d221…` from archived 0.2.8 source plus patch `3482b542…`. Both used Node 24.21.0 / Undici 7.29.1 and the same SQLite settings with MEMSTATUS enabled. All six runs passed 39 cases × 500 samples: 117,000 timed calls plus 7,020 excluded warmups, with zero reported errors. Full fixture/auth/leave/old-cursor checks and original-session regrant passed; 162 complete walks / 33,510 pages were **untimed**. Smoke 984 is excluded.

| Candidate result | p50 | p95 | p99 | max | RPS |
| --- | ---: | ---: | ---: | ---: | ---: |
| Better case medians / 39 | 27 | 22 | 22 | 22 | 24 |
| Worse case medians / 39 | 12 | 17 | 17 | 17 | 15 |
| Better paired cases / 117 | 84 | 71 | 69 | 69 | 77 |
| Worse paired cases / 117 | 33 | 46 | 48 | 48 | 40 |

There were no ties. These are medians of three per-run statistics; lower latency/higher RPS count as better. The 150-group working-feed C1 lost p50, p95 and RPS in **all three pairs**: median p50/p95 8.022/9.951→8.679/17.377 ms, RPS 125.0→99.7. Working-feed C8 median p50/p95 24.055/44.423→29.812/62.526 ms and RPS 292.3→223.1 also regressed, with mixed paired directions. Five-group hot-point C1 p95/p99 rose 2.176/2.483→5.238/12.307 ms. An improvement was 150-group first-feed C1 p50/p95 8.277/14.791→6.708/8.895 ms and RPS 106.9→145.3. Worst individual case observations were 248.502 ms baseline and 272.597 ms candidate; every metric and paired loss remains in the annotated records.

After measurements/proofs plus 6.5 quiet seconds, idle thread observations were [3,3,3]→[12,13,13], median whole-process RSS 12,796→25,652 KiB (+12,856), and median virtual size decreased 50,544 KiB. These are process points, not peak memory, pure stack costs or memory-pressure proof. Fresh processes and full checks precede each run; OS cache is retained without resets, residency unmeasured. No comparator, direct Darwin, device, write, durability, causal queue or universal-win claim follows; production panic=abort remains unchanged.

The independent analyzer was frozen before data access. The separate root analyzer initially stopped on two stale MPSC hash pins before processing run statistics; its preserved revision corrected only those pins after the independent counts were reported. Both analyses agree, and no workload was rerun.

### Native x86 Linux private catalog, trials 990–992 (2026-09-14 UTC)

The complete native batch compares source-built Snapback 0.2.8 (`8a81eb855…`, binary `05dda771…`), the post-publication 0.2.9 snapshot `04ed8cab8…` (`d09d1ec5…`), and the official Convex release `precompiled-2026-09-11-157eb19` (`36c41a7f…`, reported version `unknown`). It ran on the Ubuntu 24.04 AMD EPYC 9454 x86_64 host, using the same pinned Node 24.21.0 / Undici 7.29.1. Both Snapback builds use Rust 1.97.0, the production speed profile, `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`, and memory-status accounting enabled. Their source and binary identities differ from the Office ARM batch and are not asserted identical to registry packages. Convex uses its native SQLite-backed local backend and CLI 1.45.0, not the Office container image. No native Supabase run is included.

Nine serial runs rotated the order: 990 = 0.2.8 / 0.2.9 / Convex; 991 = 0.2.9 / Convex / 0.2.8; 992 = Convex / 0.2.8 / 0.2.9. The admitted 39-input freeze preceded launch. All runs completed without workload retries or dropped runs, from 08:51 to 09:04 UTC: 12 cases × 500 samples per run, **58,500 timed HTTP calls**, and **6,570 excluded warmups**. The paired write/read case contributes two requests per sample: 4,500 timed pairs and 270 warmup pairs across the batch. Setup, full-state verification, exports and restart checks are additional untimed work.

Each fresh app uses two ordinary owners plus an authenticated outsider and an expired-credential control. All original full-state, authorization, ownership, cursor, concurrent-ID, successful/failed replay and acknowledged-write/read assertions pass; reported errors are zero. Each app then actually restarts with the same data and sessions, preserving all 530 write/read operation IDs. All nine final/restart product states have 100,000 rows, 1,161 changed rows and a revision sum of 1,602, with SHA-256 `504ac01e383a78e0355857e2abce92ad917d3ab3ffbb133cdd0277aeba2de55b`. Convex has 1,604 receipt records after/restart, including the two failed operations. The main raw record still says `processRestartTested:false`; separate restart events and replay records supply that evidence. Nine restarts, 18 planned stops and empty cleanup receipts are recorded.

The 0.2.9 snapshot has worse median p50 than 0.2.8 in **10/12 cases**; its two gains are replay and contended fresh writes. Concurrent point and category reads lose to Convex in both Snapback snapshots. At 32 clients, point-read p50 is **20.644 / 24.322 / 7.797 ms** for 0.2.8 / 0.2.9 / Convex; category reads at eight clients are **6.109 / 7.298 / 1.956 ms**. The 0.2.9 snapshot loses point C8, point C32 and category C8 p50 to 0.2.8 in all three matched trials. These complete snapshots do not isolate the cause of the difference or justify a causal version-change claim.

Counts below compare medians of three reported per-run statistics, not pooled request quantiles. There are no ties; every uncounted comparison is a loss. The rate column compares each case in its own units and includes the write/read pair rate; it is not an aggregate throughput score.

| Left versus right | Lower p50 | Lower p95 | Lower p99 | Lower maximum | Higher rate |
|---|---:|---:|---:|---:|---:|
| 0.2.9 / 0.2.8 | 2/12 | 4/12 | 4/12 | 6/12 | 2/12 |
| 0.2.8 / Convex | 8/12 | 7/12 | 6/12 | 7/12 | 8/12 |
| 0.2.9 / Convex | 7/12 | 7/12 | 7/12 | 7/12 | 7/12 |

Every cell below is **0.2.8 / 0.2.9 / Convex**. Latencies are milliseconds; maximum is the median of per-run maxima. Rate is requests/second except `privateWriteThenCategoryC1`, which is **pairs/second** (two HTTP calls per pair). All original per-run metrics remain in the appended storage records.

| Case | p50 | p95 | p99 | Maximum | Rate |
|---|---:|---:|---:|---:|---:|
| `privatePointHot` | 0.920 / 0.975 / 1.173 | 1.297 / 1.247 / 1.387 | 1.804 / 1.747 / 1.775 | 5.142 / 4.580 / 16.029 | 1020.2 / 986.1 / 821.4 |
| `privatePointRandomC1` | 1.015 / 1.051 / 3.089 | 1.245 / 1.275 / 5.385 | 1.711 / 1.842 / 6.870 | 1.898 / 2.110 / 9.125 | 944.9 / 890.9 / 282.1 |
| `privatePointRandomC8` | 4.400 / 5.134 / 3.177 | 8.341 / 8.908 / 6.338 | 15.759 / 15.532 / 12.152 | 22.359 / 22.689 / 14.307 | 1665.2 / 1519.2 / 2135.6 |
| `privatePointRandomC32` | 20.644 / 24.322 / 7.797 | 39.595 / 46.979 / 30.503 | 53.580 / 65.057 / 39.662 | 66.215 / 74.615 / 47.025 | 1381.5 / 1196.5 / 2918.8 |
| `privateMissingDistinct` | 0.915 / 0.939 / 3.512 | 1.261 / 1.217 / 4.773 | 1.630 / 1.663 / 7.496 | 12.975 / 14.245 / 11.167 | 1017.5 / 985.2 / 286.3 |
| `privateCategoryHotC1` | 1.400 / 1.504 / 1.377 | 2.054 / 2.255 / 1.438 | 2.586 / 2.725 / 1.608 | 8.065 / 7.811 / 7.551 | 649.8 / 610.4 / 672.6 |
| `privateCategoryHotC8` | 6.109 / 7.298 / 1.956 | 9.732 / 10.840 / 4.716 | 12.263 / 12.976 / 8.078 | 16.931 / 18.655 / 8.356 | 1257.8 / 1049.1 / 3288.8 |
| `privateNextHot` | 1.330 / 1.382 / 1.337 | 2.000 / 2.071 / 1.392 | 2.506 / 2.785 / 1.569 | 6.426 / 7.847 / 9.982 | 723.5 / 650.6 / 714.2 |
| `privateReplayHot` | 0.479 / 0.348 / 2.955 | 0.602 / 0.532 / 5.651 | 0.663 / 0.630 / 6.182 | 0.804 / 0.714 / 8.295 | 2156.1 / 2452.3 / 306.0 |
| `privateFreshBumpC1` | 0.636 / 0.654 / 4.500 | 0.749 / 0.870 / 6.967 | 1.073 / 1.152 / 8.680 | 7.410 / 7.298 / 9.999 | 1481.4 / 1439.4 / 208.4 |
| `privateFreshBumpC8` | 1.741 / 1.710 / 9.981 | 3.904 / 3.761 / 14.720 | 9.022 / 9.047 / 17.218 | 10.274 / 9.954 / 26.531 | 3864.7 / 3900.1 / 772.7 |
| `privateWriteThenCategoryC1` | 2.172 / 2.415 / 24.391 | 2.918 / 3.144 / 26.009 | 4.955 / 4.729 / 27.757 | 11.985 / 11.439 / 64.099 | 415.6 / 392.2 / 40.3 |

The write/read pair has p50 **2.172 / 2.415 / 24.391 ms** and throughput **415.6 / 392.2 / 40.3 pairs/s**. Both Snapback snapshots have lower pair latency than Convex in all three paired trials. Its separately timed mutation-ack/category-read p50 medians are **0.774/1.392**, **0.880/1.522** and **7.839/16.498 ms** respectively; component percentiles must not be added. The 0.2.9 pair loses p50/p95/rate to 0.2.8 in trials 990 and 991 but gains in 992, improves pair p99 in all three, and regresses maximum in 992. Worst individual observations across all cases are **78.364 ms** (0.2.8, point C32, trial 991), **104.061 ms** (0.2.9, point C32, trial 992), and **364.073 ms** (Convex, write/read pair, trial 991). None is excluded.

The public transfer contains 290 data files plus its manifest, all size/hash checked. Independent analysis validates 27 physical-state receipts and directly compares all 900,000 canonical Convex product rows; Snapback physical state is supported by producer digest receipts plus live HTTP checks. Root and independent analyses reconcile **729 raw metric values, 243 medians and 972 median/paired contrast objects** exactly. The independent analyzer first stopped before per-run statistics because the transfer included one extra root-level `freeze.json`; the original failure and a versioned, exact-path/digest correction are retained. No workload or statistical logic changed, and no workload reran. Its summary was frozen before root results were read.

Evidence is retained under `.llp/ship-runs/sb4-performance-20260913/private-write-read-x64/formal-990-992/`; the nine appended storage records preserve the entire original main records plus separately labeled restart/cleanup/completion evidence. Public archive SHA-256 `bc47ee330df1e6305cdf32c1b8264f8b6d07b2f6ee15a5b75e20f9027ebe8373`; transfer `8e2f56628215d2888dd4687ab18386ddcb427569d6cfa86240464175bcd9d8fc`; protocol `d8034d2da9bbcde4f5512b80bd7914f4bdd1394fb725c0797060560ffe55f478`; freeze `07dc72766fab4d9940938486ca27e1c7b133ad847c66f0cffea874d5cb0e234d`. Root summary `845d35a299a45fcd4eded5c841173ff5178c221dd937768df908e71aae93fbe1`, independent summary `29f3ae57a58b94c2e031f3174f2c8bb14d5a0af0782b59304e0b9545f313b5cc`, reconciliation `7bb6e44e3728f53a2468e091fe8d9766e9247ffdaa594603dd43e5316f421f98`, and independent evidence review `34c99ac1faeb23815e74c58326f721f185677bd46b05caa59fa098daed2258de` bind the full retained results and every loss.

Limits: prepared loopback workloads after seed and full verification, retained OS caches with unmeasured residency, backend-native automatic caches, different default authentication and acknowledgement paths. Snapback uses WAL/NORMAL; effective native Convex connection durability is not established. Write results therefore measure default acknowledgements, not matched power-loss durability. Raw timing vectors and private client stderr are unavailable, so the audit checks reported statistics rather than recomputing percentiles. Private SQLite files, credentials, original Convex export ZIPs and receipt contents remain remote; receipt contents are not independently proven. Pre-run process/memory observations are point samples. This establishes no hosted, Supabase, cold-cache, device/SDK, memory-pressure, isolated-version or universal result.

### Published-policy membership comparison with Node 24.21 (formal V3, 2026-09-14)

Nine serial runs on the Office M1 Max ARM64 Colima VM (4 CPUs,12 GiB) rotated Snapback/Convex/Supabase, Convex/Supabase/Snapback, then Supabase/Snapback/Convex (trials 96–98). Snapback is the retained source-built 0.2.8 Linux artifact `33bd0c0b…`, source `8a81eb855…`, with the packaged SQLite flag and MEMSTATUS enabled. Node 24.21.0/Undici 7.29.1 and the original 39-case instrument are shared. Comparator service/source bindings are preserved in the original public records; source pins are not an independent proof of exact deployed Convex module bytes.

All 175,500 timed calls and 10,530 excluded warmups passed exact results and reported zero errors. The 243 complete authorized walks/50,265 pages are **untimed**. Complete fixture, outsider/foreign/invalid credentials, acknowledged leave, old cursors and same-session regrant checks passed. Convex used five separately issued same-principal 24-hour fixture JWTs with the original expired control; seven live credential probes preceded formal preparation. Supabase used ordinary per-run login. No workload was retried or dropped. Prepared walks visit the arguments later timed, and native automatic query caching is retained. These are warm self-hosted reads on one VM, not hosted/WAN, cold-cache, write, device, realtime, durability or memory-pressure claims.

Counts of lower Snapback median latency or higher throughput, out of 39 cases. These compare medians of three reported statistics, not pooled request quantiles or significance:

| Comparator | p50 | p95 | p99 | Maximum | Requests/s |
|---|---:|---:|---:|---:|---:|
| convex | 3/39 | 5/39 | 9/39 | 8/39 | 4/39 |
| supabase | 34/39 | 35/39 | 31/39 | 29/39 | 35/39 |

All uncounted cells are losses; there are no ties. In particular, the 150-membership first-feed page at eight clients is 37.103/3.415/36.110 ms p50 for Snapback/Convex/Supabase. The working-feed page is 31.831/3.528/29.957 ms. These remain concrete targets.

Every cell below is **Snapback/Convex/Supabase**. Latencies are milliseconds; maximum is the median of per-run maxima.

| Case | p50 | p95 | p99 | Maximum | Requests/s |
|---|---:|---:|---:|---:|---:|
| `groups5PointHotC1` | 2.224 / 1.608 / 7.995 | 5.097 / 3.310 / 23.964 | 10.075 / 5.548 / 36.610 | 28.945 / 9.156 / 58.921 | 361.5 / 522.9 / 98.7 |
| `groups5PointWorkingSetC1` | 1.782 / 9.327 / 6.065 | 2.343 / 17.689 / 23.539 | 3.360 / 29.768 / 41.080 | 17.354 / 38.864 / 67.055 | 527.4 / 93.3 / 115.8 |
| `groups5ThreadFirstC1` | 2.812 / 2.372 / 7.223 | 3.808 / 4.262 / 11.061 | 5.947 / 8.326 / 13.218 | 30.091 / 14.694 / 47.045 | 329.8 / 387.9 / 125.2 |
| `groups5ThreadNextC1` | 3.013 / 1.975 / 6.915 | 5.512 / 3.647 / 12.937 | 8.023 / 4.672 / 25.161 | 12.075 / 18.463 / 56.449 | 298.8 / 422.6 / 128.7 |
| `groups5FeedFirstC1` | 3.535 / 1.405 / 7.858 | 8.715 / 2.442 / 18.719 | 18.223 / 3.750 / 30.068 | 27.453 / 10.187 / 48.596 | 228.2 / 608.5 / 103.6 |
| `groups5FeedNextC1` | 4.083 / 1.517 / 7.429 | 9.840 / 3.466 / 14.527 | 17.387 / 5.594 / 25.406 | 26.940 / 22.697 / 41.477 | 197.4 / 528.0 / 114.7 |
| `groups5FeedWorkingSetC1` | 3.415 / 1.957 / 6.872 | 8.283 / 4.486 / 9.255 | 11.632 / 6.374 / 13.995 | 22.530 / 8.068 / 31.904 | 235.0 / 440.5 / 136.6 |
| `groups5PointWorkingSetC8` | 7.540 / 3.888 / 8.901 | 16.727 / 7.980 / 19.119 | 24.971 / 18.917 / 136.980 | 28.621 / 20.989 / 169.620 | 942.3 / 1774.7 / 682.2 |
| `groups5ThreadFirstC8` | 14.210 / 7.593 / 11.735 | 24.159 / 16.746 / 24.694 | 39.592 / 34.324 / 38.954 | 47.214 / 38.699 / 46.903 | 529.9 / 921.0 / 590.8 |
| `groups5ThreadNextC8` | 13.390 / 8.840 / 15.328 | 21.440 / 18.851 / 31.925 | 30.779 / 40.437 / 49.046 | 35.169 / 47.069 / 62.841 | 573.4 / 775.4 / 452.8 |
| `groups5FeedFirstC8` | 12.998 / 6.064 / 17.578 | 21.327 / 15.191 / 43.533 | 25.681 / 30.698 / 66.697 | 31.689 / 35.013 / 69.681 | 596.6 / 1096.4 / 385.6 |
| `groups5FeedNextC8` | 13.895 / 5.056 / 18.418 | 31.811 / 10.502 / 48.986 | 47.900 / 28.825 / 66.309 | 50.225 / 33.450 / 86.155 | 501.6 / 1343.0 / 361.5 |
| `groups5FeedWorkingSetC8` | 11.995 / 8.137 / 20.370 | 25.100 / 19.500 / 37.477 | 34.948 / 42.692 / 52.930 | 41.737 / 48.193 / 73.408 | 596.8 / 820.2 / 359.4 |
| `groups30PointHotC1` | 2.139 / 1.912 / 4.748 | 6.561 / 4.932 / 17.779 | 10.981 / 8.873 / 32.754 | 37.262 / 26.653 / 41.678 | 332.1 / 418.5 / 148.8 |
| `groups30PointWorkingSetC1` | 1.982 / 10.183 / 5.309 | 4.347 / 22.016 / 9.330 | 7.977 / 30.587 / 14.339 | 41.463 / 79.551 / 24.377 | 381.8 / 83.7 / 170.9 |
| `groups30ThreadFirstC1` | 3.375 / 2.807 / 7.464 | 6.109 / 10.735 / 16.028 | 9.120 / 16.168 / 27.763 | 19.357 / 36.640 / 42.820 | 248.3 / 223.7 / 108.5 |
| `groups30ThreadNextC1` | 3.203 / 2.066 / 9.090 | 7.091 / 5.548 / 24.453 | 12.515 / 9.037 / 42.187 | 18.896 / 11.509 / 59.531 | 256.8 / 411.5 / 96.8 |
| `groups30FeedFirstC1` | 3.836 / 1.277 / 11.224 | 4.395 / 2.838 / 41.395 | 4.636 / 4.543 / 62.683 | 16.351 / 11.534 / 81.017 | 258.2 / 635.6 / 63.7 |
| `groups30FeedNextC1` | 3.682 / 1.507 / 10.460 | 6.938 / 3.821 / 23.409 | 10.021 / 5.381 / 40.669 | 18.448 / 21.163 / 64.987 | 241.7 / 522.0 / 80.5 |
| `groups30FeedWorkingSetC1` | 3.683 / 1.335 / 8.368 | 5.554 / 2.376 / 12.520 | 7.113 / 3.632 / 18.025 | 20.229 / 17.778 / 48.058 | 246.2 / 643.2 / 109.6 |
| `groups30PointWorkingSetC8` | 6.959 / 3.140 / 8.167 | 11.729 / 7.576 / 13.451 | 24.201 / 25.249 / 23.978 | 30.281 / 25.805 / 25.554 | 1082.7 / 2004.8 / 940.7 |
| `groups30ThreadFirstC8` | 14.395 / 4.508 / 13.771 | 22.387 / 10.375 / 28.027 | 31.501 / 23.966 / 47.643 | 37.686 / 26.521 / 49.910 | 538.7 / 1487.4 / 514.8 |
| `groups30ThreadNextC8` | 14.013 / 4.447 / 16.759 | 22.305 / 8.984 / 34.532 | 29.785 / 24.101 / 43.832 | 36.798 / 25.385 / 50.361 | 547.1 / 1558.9 / 426.5 |
| `groups30FeedFirstC8` | 11.599 / 3.316 / 16.885 | 18.761 / 6.368 / 28.009 | 33.329 / 16.497 / 36.759 | 38.665 / 18.349 / 53.295 | 649.6 / 2067.9 / 451.4 |
| `groups30FeedNextC8` | 11.273 / 3.636 / 19.525 | 22.422 / 6.971 / 36.851 | 29.552 / 9.221 / 51.439 | 35.476 / 11.024 / 70.830 | 646.9 / 2021.0 / 379.6 |
| `groups30FeedWorkingSetC8` | 11.731 / 3.388 / 15.445 | 23.901 / 6.809 / 25.718 | 49.282 / 26.047 / 33.211 | 52.877 / 27.862 / 37.872 | 598.2 / 1913.9 / 501.0 |
| `groups150PointHotC1` | 1.625 / 1.054 / 4.184 | 2.890 / 2.013 / 5.600 | 10.606 / 2.991 / 7.263 | 22.196 / 21.210 / 17.231 | 504.5 / 801.8 / 224.3 |
| `groups150PointWorkingSetC1` | 1.552 / 7.018 / 4.553 | 2.518 / 11.157 / 5.755 | 3.673 / 15.903 / 7.115 | 25.200 / 24.954 / 21.980 | 542.8 / 129.2 / 209.8 |
| `groups150ThreadFirstC1` | 2.610 / 1.377 / 6.920 | 4.290 / 2.090 / 10.070 | 6.979 / 2.520 / 13.461 | 20.398 / 11.560 / 23.471 | 336.3 / 652.7 / 133.5 |
| `groups150ThreadNextC1` | 4.136 / 1.393 / 6.701 | 11.688 / 2.270 / 8.964 | 19.335 / 3.048 / 10.608 | 39.147 / 16.440 / 23.768 | 179.8 / 606.1 / 140.6 |
| `groups150FeedFirstC1` | 8.072 / 1.258 / 13.515 | 13.069 / 1.983 / 20.523 | 22.032 / 3.569 / 31.971 | 32.791 / 12.854 / 61.163 | 113.2 / 712.7 / 68.5 |
| `groups150FeedNextC1` | 8.158 / 1.237 / 14.099 | 10.072 / 2.794 / 19.244 | 14.184 / 4.541 / 26.879 | 33.214 / 15.405 / 63.484 | 122.2 / 639.7 / 67.1 |
| `groups150FeedWorkingSetC1` | 8.390 / 1.287 / 14.570 | 14.460 / 2.470 / 27.029 | 22.066 / 4.228 / 41.613 | 44.273 / 18.489 / 81.296 | 105.0 / 650.7 / 59.2 |
| `groups150PointWorkingSetC8` | 8.644 / 2.913 / 12.364 | 26.308 / 6.978 / 33.684 | 47.891 / 23.814 / 50.858 | 55.243 / 26.559 / 61.311 | 704.8 / 2107.0 / 516.2 |
| `groups150ThreadFirstC8` | 15.844 / 4.580 / 17.166 | 29.233 / 8.006 / 32.597 | 38.880 / 25.089 / 65.302 | 51.564 / 27.340 / 80.111 | 462.3 / 1615.6 / 418.2 |
| `groups150ThreadNextC8` | 18.640 / 4.197 / 16.369 | 43.015 / 8.077 / 30.480 | 61.826 / 21.102 / 40.743 | 81.319 / 22.340 / 48.040 | 367.8 / 1631.4 / 448.1 |
| `groups150FeedFirstC8` | 37.103 / 3.415 / 36.110 | 67.575 / 7.046 / 64.616 | 91.527 / 18.518 / 78.707 | 130.179 / 20.089 / 105.315 | 196.0 / 2018.0 / 211.7 |
| `groups150FeedNextC8` | 27.847 / 3.328 / 36.251 | 48.132 / 6.694 / 63.464 | 57.710 / 22.198 / 74.713 | 70.292 / 23.668 / 86.632 | 270.5 / 2053.8 / 209.4 |
| `groups150FeedWorkingSetC8` | 31.831 / 3.528 / 29.957 | 71.354 / 7.331 / 47.446 | 103.684 / 22.753 / 58.347 | 149.058 / 27.665 / 69.768 | 216.9 / 1892.0 / 261.0 |

The initial frozen independent audit failed on the credential-probe logical-value hash because it serialized the same four fields in fixture insertion order, while the source helper hashes the returned Convex object order. The original failure is preserved. A versioned post-data-access correction (`575f0eaa…`) changes that field order only; run, proof and statistic logic is unchanged. Its independent result `690bd519…` and root result `ed7904bf…` agree on all 702 formal median values and 1,872 shared contrast records. The 2,106 formal raw metric values and 702 separate smoke values were revalidated separately; smoke contributes no formal statistic. All 195 transferred public files rehash. Twelve Convex snapshot ZIPs remain remote and are not locally rehashed; their normalized public proof JSON is preserved.

### Bounded HTTP reader reuse: native x86 Linux A/B, trials 996–998

Six native loopback runs on the Ubuntu 24.04 AMD EPYC 9454 host compare the qualified 0.2.9 snapshot `04ed8cab8…` with the same source plus the host reader-pool change and two host regressions. Baseline/candidate binary hashes are `d09d1ec5…`/`dee2c2b6…`; the candidate is 9,457,144 B. Both use Rust 1.97.0, the production speed profile, `-USQLITE_ENABLE_MEMORY_MANAGEMENT`, MEMSTATUS enabled, and Node 24.21.0/Undici 7.29.1. Core source, SQLite flags, admission limits, authentication and timed instrument are unchanged. Successful query readers retain their connections/plans; each invocation still opens and ends a fresh identity-checked transaction.

Orders are baseline/candidate, candidate/baseline, baseline/candidate. All 39,000 timed HTTP calls,4,380 excluded warmups and 3,000 timed write/read pairs passed. The paired workflow has two HTTP calls per sample;180 warmup pairs are included in the excluded request count. Exact owner/outsider/auth checks, acknowledged writes and replay, all 100,000 canonical rows, six actual same-app process restarts and empty owned-process cleanup passed. The two 50-sample smoke runs are excluded. No workload retries or missing runs are substituted.

Candidate median p50/p95/p99 improve in 11/12 cases each; maximum in 9/12 and throughput in 11/12. Paired p50 improves 30/36, p95/p99 each 32/36, maximum 24/36; ordinary request rate improves 28/33 and pair rate 2/3. All losses remain. Cells below are **baseline/candidate**; rate is requests/s except the write/read workflow, which is pairs/s.

| Case | p50 ms | p95 ms | p99 ms | Maximum ms | Rate |
|---|---:|---:|---:|---:|---:|
| `privatePointHot` | 0.991 / 0.460 | 1.527 / 0.689 | 2.076 / 0.822 | 4.224 / 3.925 | 941.5 / 2028.3 |
| `privatePointRandomC1` | 1.014 / 0.427 | 1.208 / 0.474 | 1.775 / 0.630 | 1.914 / 0.827 | 933.9 / 2270.5 |
| `privatePointRandomC8` | 5.249 / 1.506 | 8.396 / 2.269 | 17.518 / 13.412 | 24.045 / 16.470 | 1484.3 / 4149.9 |
| `privatePointRandomC32` | 23.718 / 5.690 | 44.878 / 20.293 | 62.120 / 22.138 | 86.010 / 29.862 | 1206.8 / 4074.7 |
| `privateMissingDistinct` | 0.937 / 0.371 | 1.205 / 0.472 | 1.646 / 0.618 | 10.263 / 11.028 | 1024.0 / 2405.7 |
| `privateCategoryHotC1` | 1.519 / 0.931 | 2.278 / 1.044 | 3.049 / 1.508 | 7.461 / 7.697 | 586.5 / 972.5 |
| `privateCategoryHotC8` | 7.182 / 1.713 | 11.556 / 3.361 | 13.936 / 7.385 | 16.799 / 7.989 | 1061.7 / 3946.9 |
| `privateNextHot` | 1.380 / 0.804 | 1.972 / 0.907 | 2.628 / 1.419 | 7.784 / 6.021 | 649.5 / 1162.9 |
| `privateReplayHot` | 0.463 / 0.385 | 0.599 / 0.554 | 0.656 / 0.683 | 0.788 / 0.841 | 2233.6 / 2254.9 |
| `privateFreshBumpC1` | 0.648 / 0.646 | 0.859 / 0.787 | 1.094 / 1.056 | 7.034 / 6.684 | 1450.8 / 1498.6 |
| `privateFreshBumpC8` | 1.752 / 1.871 | 3.543 / 4.151 | 8.557 / 6.796 | 8.897 / 7.902 | 3941.6 / 3747.3 |
| `privateWriteThenCategoryC1` | 2.188 / 1.921 | 2.871 / 2.475 | 5.182 / 2.991 | 12.803 / 10.911 | 421.1 / 481.1 |

Concurrent fresh writes regress in **all three pairs**: median p50 rises 1.752→1.871 ms (+6.79%), p95 rises 3.543→4.151 ms (+17.16%), and throughput falls 3,941.6→3,747.3 requests/s (−4.93%). Replay p99 and three case-median maxima also worsen. The final pair has write/read workflow and component regressions; component percentiles are not summed, and HTTP rate is not reconstructed from rounded pair rate.

Untimed process snapshots show after-workload RSS medians 33,780→39,600 KiB (+5,820 KiB); all three paired RSS differences are positive. Restart snapshots have separate process lifetimes. These are point observations and process-lifetime HWM, not continuous peak sampling or an isolated measure of pool allocation. Retained connections trade memory between requests for the measured read improvements; the count is capped by the existing 32-request worker bound.

The candidate passed 32 CLI test executions and one separately compiled production reader-policy check. The first candidate qualification had a newly written test incorrectly assert that stale-generation refusal is retryable; that failed attempt remains. Correcting the assertion to the existing `E_GENERATION` code and strengthening empty-success checks changed only tests, and the V2 production binary is byte-identical to the first build-only artifact. This is not a claim that the failed qualification passed.

Independent result `d307e12c…` and root result `0d124444…` agree on 360 shared raw values,120 medians,240 contrasts and all 18 resource snapshots; the independent audit retains 126 additional elapsed/component/rate values. The formal freeze is `c7382937…`, full public transfer `f9443c31…`, and independent evidence review `8d32e082…`. The historical A/B is separate from current-main integration, real native rebuild qualification and publication. There is no fresh comparator, matched power-loss durability, cold-cache or universal performance claim.

### Integrated reader reuse: source and native-reload qualification (2026-09-14)

The host change was integrated onto archived source `52961b050f021be02a2bf249827e302c75c89767` (0.2.10). The V3 qualification preserves 634 of 638 source files and applies four exact overrides: the reader host and its tests, five workspace-only Cargo.lock version corrections, and a bounded signal-log buffer correction. Core source, external dependency versions/edges/checksums, SQLite flags and all existing lifecycle assertions are unchanged. Later main changes through `dc65c3ada` are documentation/evidence only. This qualification adds no current-source latency or comparator measurement; the preceding reader A/B remains bound to `04ed8cab8`.

The production build, **49 CLI test executions** (30 unit, six fix, two HTTP, eleven lifecycle), one exact production reader-policy test and version check all passed. Both new reader regressions are included. Retained Linux x86_64 binary `a400b1c03e1a244144128aa9aefc1bcc2da905dbeeb0c57b53bfcf4c4b09ccae` is 9,662,072 B; qualification receipt SHA-256 is `47cef34e73d160e70e2dc4c5ecdc207fba061142259989cc0feae196db4b1fcc`. All 638 qualified source hashes and the retained binary were rechecked, with no owned process remaining.

Two earlier attempts remain failures. Attempt 1 stopped before compilation because five workspace lockfile versions still said 0.2.9 while their manifests said 0.2.10; offline metadata corrected only those version fields. Attempt 2 built successfully and passed both pool regressions, but six inherited Linux lifecycle tests failed; its production reader check passed separately. A leftover worker was verified in that attempt's recorded Cargo process group and terminated before further work. The later passing run does not relabel either failed attempt.

A standalone probe importing only the original lifecycle code reproduced SIGSEGV instead of TERM, truncated-mapping BUS and abort in both opt-level 0 and 3. The main thread reported an enabled 8,192-byte alternate signal stack. A 256-byte signal-line buffer restored all six expected statuses and complete signal lines; ordinary panic, thread and exit lines retain 4 KiB capacity. The 12 original/candidate observations are retained under diagnostic complete SHA-256 `4b41a476296192fc90bb7feb2322212667967d37f2a6d2cdf301e276d13a0968`. This does not measure the aborting thread's stack or exact generated frame sizes. Existing lifecycle assertions, including application-worker cleanup and exit 143, then passed unchanged.

The exact retained production binary also passed a real dev-watcher sequence using the qualified native SDK: **eight phases / 816 exact native HTTP queries**, three actual guest sessions, two owners' rows and outsider isolation, acknowledged-write freshness, two same-generation native replacements, rejected Rust and missing-export edits, a schema-generation change, and an actual restart with the original app/store/sessions. Both planned shutdowns required live owned children, SIGTERM status -15 and absent process groups; emergency cleanup is separate. Every qualified source file, SDK, helper and binary was rechecked after the sequence. Eleven public files were transferred with known session tokens excluded; no private sessions or app state were copied. Complete receipt SHA-256 is `d28c2edb6f7a75b76e4e2fd7659b13a3a6547a788b387efcb6b43b409aace30c`; cleanup is `089a16375ef9f507f9a235d085d0b591b72b61112002fa9901cdb909ea4035e7`.

This is source/build and native-reload correctness evidence. It does not intentionally park a borrowed native reader across adoption, exercise failed native installation after adoption, fill all 32 pool slots, or establish a full workspace/client suite, publication, durability, memory-pressure or performance result. The two rejected native edits fail before adoption; the direct old-loan epoch test remains separate coverage for the loan boundary. Prior source, corrected-helper and input-update reviews remain bound to their exact inputs.

### Current-source qualification and private replay contract (2026-09-14)

Source `beed6a51e1592360a746099de585a049df3808d7` was archived without overrides and qualified independently on Office ARM Linux and native x86 Linux. Each passed 49 CLI tests, 29 production core unit tests and 18 membership/page-admission tests, with zero failures or skips in those selected groups. All 638 source files and each retained binary were rehashed. Both use the packaged SQLite build input with MEMSTATUS enabled. These are affected-source qualification results, not a full workspace/client suite or publication. Qualification receipts are `0d2e265c…` (ARM) and `1b6f141c…` (x86), retained under the ignored run's `reader-reuse-0210-{office,native}-qualification/` directories.

The first fresh comparator attempts failed because their trial identifiers exceeded the unchanged instrument maximum of 1000; no timing run completed. The corrected native attempt passed eight read cases and two fresh mutations, then the historical adapter dereferenced `result` on a successful replay. Its partial timings remain excluded from completed comparisons. The original attempts, inputs and cleanup observations are retained.

Current Snapback retries return execution identity with `replayed: true`, withholding historical `result` and `current` as required by LLP 3000.007 §17 and the language guide. The private-catalog instrument now distinguishes fresh results from those receipts. Fresh writes still require their exact SKU/revision result; retries must match the captured first response's id, state and sequence or refusal code. Eight simultaneous same-id calls require one fresh execution and seven matching receipts, independent of response arrival order. The six relevant first responses are retained only as oracle evidence. For Snapback `--private-restart`, `SB4_PRIVATE_REPLAY_RECORD` names the completed main raw record; instrument, trial, sample count and session-file bindings are checked before replay, and its digest is recorded. No replay result is fabricated and no extra query is added to a timing interval.

The complete row, authorization, acknowledged-write/read visibility, failed-replay, concurrent-write and actual-process-restart oracles remain. Sample counts and the mutation schedule are unchanged. The Convex fixture continues returning its historical result, so replay timing must disclose this response-contract difference and cannot be described as a same-result recovery speedup. The separate [client type/documentation mismatch](../../../issues/20260914-snapback4-write-result-type-omits-replay-state.md) is an owner follow-up; it does not justify returning historical data from the server.

### Current reader reuse versus native Convex: trials 220–222

Six serial native loopback runs on Ubuntu 24.04 / AMD EPYC 9454 completed at 2026-09-14 14:12:46 UTC. Orders were Snapback/Convex, Convex/Snapback, Snapback/Convex. Snapback is qualified source `beed6a51e…` (0.2.10), native binary `d6dd5f6c…`; Convex is official `precompiled-2026-09-11-157eb19`, binary `36c41a7f…`, reported version `unknown`, CLI 1.45.0. Both use pinned Node 24.21.0 / Undici 7.29.1. Snapback retains the packaged SQLite flag with MEMSTATUS enabled. Instrument `364e3d13…` is a separate input; its landed commit `49742f7e8` is not the measured server source.

All 39,000 timed HTTP calls, 4,380 excluded warmup calls and 3,000 timed two-request write/read pairs passed, with zero reported errors. The 180 warmup pairs are included in the excluded HTTP count. All 100,000-row before/after/restart oracles, auth/owner/outsider/cursor checks, fresh and failed retries and contended writes passed. Six actual process restarts used the original app/instance and unchanged credentials; twelve planned SIGTERM stops and empty owned-process cleanup were verified. The independent audit also compared all 900,000 rows in the nine Convex canonical projections and the 18 retained Snapback first-response identities. Individual retry wire bodies and private receipt contents are not public proof.

Medians of three reported run statistics follow, **Snapback / Convex**. Latencies are milliseconds; rate is HTTP requests/s except the final row, which is pairs/s. These are not pooled percentiles or statistical significance estimates.

| Case | p50 | p95 | p99 | Maximum | Rate |
|---|---:|---:|---:|---:|---:|
| `privatePointHot` | 0.472 / 1.166 | 0.638 / 1.406 | 0.968 / 1.772 | 4.071 / 32.345 | 1975.1 / 784.2 |
| `privatePointRandomC1` | 0.430 / 3.249 | 0.490 / 5.448 | 0.639 / 7.473 | 0.793 / 9.032 | 2202.5 / 269.4 |
| `privatePointRandomC8` | 1.583 / 3.144 | 2.404 / 6.229 | 15.121 / 13.621 | 17.352 / 16.411 | 3903.4 / 2043.7 |
| `privatePointRandomC32` | 5.624 / 7.567 | 22.517 / 30.531 | 24.786 / 36.949 | 28.058 / 39.751 | 4110.1 / 3019.1 |
| `privateMissingDistinct` | 0.375 / 3.549 | 0.438 / 4.972 | 0.609 / 7.634 | 10.039 / 12.243 | 2404.9 / 274.9 |
| `privateCategoryHotC1` | 0.888 / 1.356 | 1.149 / 1.415 | 1.570 / 1.621 | 7.743 / 7.697 | 966.1 / 685.5 |
| `privateCategoryHotC8` | 1.706 / 2.198 | 3.164 / 4.393 | 7.760 / 7.965 | 7.855 / 8.413 | 3964.3 / 3133.8 |
| `privateNextHot` | 0.818 / 1.332 | 1.013 / 1.390 | 1.454 / 1.736 | 6.209 / 9.876 | 1117.6 / 707.9 |
| `privateReplayHot` | 0.342 / 2.843 | 0.513 / 5.280 | 0.563 / 6.071 | 7.449 / 8.258 | 2504.3 / 309.3 |
| `privateFreshBumpC1` | 0.653 / 4.156 | 0.884 / 6.454 | 1.113 / 7.545 | 7.253 / 9.831 | 1473.2 / 229.3 |
| `privateFreshBumpC8` | 1.871 / 9.940 | 4.061 / 14.969 | 6.731 / 16.625 | 8.615 / 19.921 | 3784.1 / 771.6 |
| `privateWriteThenCategoryC1` | 1.957 / 24.541 | 2.474 / 26.535 | 2.923 / 27.757 | 11.449 / 297.421 | 474.3 / 40.1 |

Excluding the replay row, Snapback has lower p50 and p95 in all **11 case medians and 33 matched case-runs**; p99/max are lower in 10/9 medians and 27/28 matched case-runs. Including replay, counts are 12/12/11/10 case medians for p50/p95/p99/max, and 36/36/30/30 matched case-runs. All ordinary request, pair and pair-HTTP rates favor Snapback here. There are no ties. The pair's separate HTTP-rate medians are 948.7/80.3 requests/s; component percentiles remain separate and are never summed.

Losses remain: random-point C8 median p99 is 15.121/13.621 ms (+11.01%) and maximum 17.352/16.411 ms (+5.73%); category C1 maximum is 7.743/7.697 ms (+0.60%). The six paired p99 and six paired maximum losses are retained, including C8 point p99 +43.89% in trial 221 and +21.78% in 222, and category C1 maximum +72.47% in 220. Largest individual observations are 38.509 ms Snapback and 341.235 ms Convex, in different cases; they do not erase the matched losses.

The replay row compares Snapback's execution identity without historical result/current against the Convex fixture's historical result. It is not a same-result recovery comparison. Prepared full verification warms inputs, native automatic query caches remain enabled, OS cache residency is unmeasured, and write timings compare default acknowledgements (Snapback WAL/NORMAL), not matched power-loss durability. No causal attribution to reader reuse or W5 follows from this cross-backend batch. No registry-artifact, hosted/WAN, Supabase, cold-cache, device, realtime, memory-pressure or universal result follows. Host load/available-memory observations are point samples, with no new process RSS or peak measurement.

The six appended storage records preserve their complete raw main objects and separately labeled restart, lifecycle, state and input evidence. The public bundle under `.llp/ship-runs/sb4-performance-20260913/private-write-read-x64/current0210-v3-formal-220-222/` contains 218 files (archive `a06e8c76…`). Root `b5d6c2ab…` and independent `2955ebf9…` summaries agree on all 486 numeric raw statistics, 162 medians, 81 median contrasts, 243 paired contrasts and six resource-point bindings; reconciliation `b6c071ee…`, independent review `39bc9b42…`. Original invalid-trial and replay-parser failures remain excluded and preserved.

### Published 0.2.11 — bounded HTTP reader reuse

The existing publisher completed at **2026-09-14 15:15:59 UTC** on the prepared M4 Pro, publishing `snapback4` and `snapback4-darwin-arm64` **0.2.11**. Its source archive is `13fdce76f7d6e881e070f0ad247b95f39fb0c0de`, including the landed reader reuse and bounded Linux signal-log correction. Of its 669 files, 668 are byte-identical to landed `b2b38c474`; the sole difference is six later benchmark rows in `snapback4/metrics/storage.jsonl`. Runtime, package metadata, publisher, tests and fixture source match. The archive is not asserted to be the exact `b2b38c474` tree.

The full suite passed **379 Rust, 132 client and 9 fixture tests**, with zero failures and one existing ignored Rust test. It used Node 24.21.0, `RUST_TEST_THREADS=1`, `CARGO_BUILD_JOBS=4`, and the packaged `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT` input. The suite took **161 s**, above the 60-second budget; Cargo tests reported 157 s, client tests 38 s and fixture tests 5 s, with stages overlapping. Preparation had installed dependencies and compiled workspace tests, but this run does not establish a fully warm native-fixture state or a matched warm-loop regression. No assertion failure was bypassed.

The production build passed. The installed-package consumer passed typechecking and mock-client query readiness/freshness, online-write-sent and offline-write-pending checks. The consumer verified CLI version `snapback4 0.2.11` and the exact **7,728,304-byte** production binary, SHA-256 `7627e77098bd2f343b1cf2aeff6e0980dc5f4730d6aaf98582efc59dc35c21ad`. Publication took **260.3 s**. The supervisor recorded both child process groups absent, temporary credential removal, and no cleanup failure or remaining scoped process.

Both public registry versions were verified by **15:28:59 UTC**. Their tarballs match the tested archives byte for byte, including registry SHA-512 integrity and SHA-1 metadata; the client pins its platform optional dependency to 0.2.11. The client archive is 505,220 B (`ba4a3b31…` SHA-256); the platform archive is 3,787,041 B (`0f7c3e52…`). The initial registry observation returned a 404 while retaining the platform archive; it remains recorded separately. Only read-only visibility checks followed, with no repeated publication.

The unchanged publisher row is appended to `snapback4/metrics/publish.jsonl`. The ignored run retains `reader-reuse-0211-publication-public/` (nine verified public files), `reader-reuse-0211-registry-verification.json` (`2db60a7d…`), and `reader-reuse-0211-publication-qualification.json`; publisher log SHA-256 is `e740cff582cc5ab50c500709cf6a37ac20c6f9b781ea27b67ff57c8ba3f55b23`. These are publication and correctness receipts. The preceding native A/B and comparator timings retain their measured source and binary identities; this release qualification adds no performance measurement.

### Development-loop follow-up: shared write-observation index

An unchanged repeat of the 0.2.11 source's full suite on the prepared M4 Pro
took **140 s**: 379 Rust, 132 client and 9 fixture passes, zero failures and
one existing ignored Rust test. The shared test observation helper contained
a quadratic deletion search. The candidate indexes typed identities per
table, preserving the complete observation boundary and original privacy
populations, and adds one assertion included by four existing Rust targets.
It changes no runtime source, client contract, suite command or ceiling.

The isolated candidate completed two full runs at 2026-09-14 16:16:27 UTC:

| Observation | Suite wall seconds | Cargo seconds | Client seconds | Rust / client / fixture passes |
|---|---:|---:|---:|---:|
| Unchanged warm baseline | 140 | 137 | 38 | 379 / 132 / 9 |
| Candidate first, including rebuilds | 140 | 119 | 39 | 383 / 132 / 9 |
| Candidate warm | 96 | 93 | 38 | 383 / 132 / 9 |

Every run has zero failures and one existing ignored Rust test. Stages
overlap and must not be summed. The warm suite is 44 s / 31.4% shorter in
these observations. They ran consecutively in separate source directories
with a shared target cache; this is not randomized repeated A/B or an exact
attribution of every wall-time difference. Node 24.21.0, Rust 1.97.0,
`CARGO_BUILD_JOBS=4`, `RUST_TEST_THREADS=1` and the packaged SQLite build flag
were retained. The first candidate's build work is not a warm-loop result.

The page-admission group fell from 69.11 to 33.61 s, and the 34/35-test
group from 18.21 to 9.72 s; the unchanged 17-test group took 18.12 s.
The [budget P0](../../../issues/20260913-snapback4-blocking-suite-over-60-seconds.md)
remains open at 96 s. No product latency, comparator or publication claim
follows from this test-helper measurement.

The ignored run's `write-observation-delta-0211-v2-public/` retains seven
hash-verified public files. Complete receipt SHA-256 is
`5c6599162685ec508fce261be698b3660927472aa9c33d9db87a8bf80b3a7afe`;
warm log is `23a815b862f29eb604eb828dd178087927d8a782ee1dfe521c75a1cfbd9f47e4`.
The baseline receipt/log are in `warm-suite-reader-reuse-0211-v1-public/`.
The isolated test tree matches all 669 archived source files with one exact
helper override. Integration base `99dfedfc9` differs from the archive only
in seven later metrics rows; this landing adds the helper and its journal
and benchmark evidence. Source checks passed before/after, all three owned process groups
exited zero and were observed absent, and cleanup reported no remaining
scoped process or failure. The V1 archive preflight refusal was local and
preceded any launch; it remains preserved separately.

### Actual serving-writer settings: untimed native qualification (2026-09-14)

The native Linux 0.2.12 experiment uses source `206650f29…` with one reviewed
host-only diagnostic override; retained binary `10557d0f…` is distinct from
the registry executable. Its production build, 72 CLI tests and 44 production
core tests pass. The diagnostic reads the actual Engine-owned writer, applies
only the selected synchronous setting before listening, and reads it back on
untimed authenticated, typed query probes. A separate inspection connection
is not used as evidence for that writer.

| Mode | Startup before → serving writer | Fresh acknowledged writes | Changed-payload replays | Actual same-app restarts |
|---|---|---:|---:|---:|
| Observe | WAL/NORMAL → WAL/NORMAL | 34 | 2 | 1 |
| Full | WAL/NORMAL → WAL/FULL | 34 | 2 | 1 |

Both modes produce the same complete six-row typed-state hashes before work,
after exercise and after the restart write. Two owners and an outsider retain
their original sessions. Invalid startup mode, disabled diagnostics, auth and
argument refusals, invalid/malformed/duplicate phases, complete visibility,
acknowledgements and replay checks pass. Four enabled server processes each
emit exactly phases `[0,1,2,3]`, with stable generation and writer settings;
all five planned server stops are SIGTERM-only with no remaining owned group.
The two modes report SQLite 3.53.2 and the same 50 compile options, retaining
the packaged page-cache flag and memory-status accounting.

The successful V5 receipt is `e527a2da…`; independent audit `ced0bb03…` and
review `a65ecab7…` recheck the public records and independently reconstruct
all three six-row state hashes. Private wire bodies, databases, credentials
and logs stay remote; their successful checks are assertions of the pinned
controller. V4's earlier port-probe failure remains preserved and excluded.
The corrected probe admits a recently closed connection while still refusing
a live listener; it does not alter the server binary.

There are **zero timed requests** in this qualification. Project creation and
schema activation precede the hook; each process re-applies its serving-mode
setting after restart. Readback and graceful restart do not establish
power-loss behavior or the official Convex binary's effective writer policy.
The subsequent 100,000-row sensitivity experiment needs its own complete
execution and analysis; this record makes no latency claim.

### Reader reuse on Office ARM Linux: membership comparison, trials 201–203

Nine serial runs on Office M1 Max / ARM Linux Colima (4 CPUs, 12 GiB)
completed at 2026-09-14 18:41:39 UTC. Orders were Snapback/Convex/Supabase,
Convex/Supabase/Snapback, then Supabase/Snapback/Convex. Snapback is qualified
source `beed6a51e1592360a746099de585a049df3808d7` (0.2.10), retained binary
`9d1ccf5e…`, with the packaged SQLite flag and MEMSTATUS enabled. Clients use
Node 24.21.0 / Undici 7.29.1 and the original membership instrument
`36f4026b…`. This is a source-built comparison, not an isolated reader-reuse
A/B or a measurement of the current published release.

All 175,500 timed case calls passed (39 cases × 500 samples × nine runs),
with 10,530 excluded warmups. The 243 complete walks / 50,265 traversal
pages are untimed. Required auth, owner/outsider, cursor, leave and
same-session regrant checks pass. The 36 complete physical proof records
match 501 groups, 100,000 messages and 186→185→186 memberships. All 18
client processes exit zero; three owned Snapback servers stop with SIGTERM.
The original outer launcher and zero exit marker were also collected.

Counts below are Snapback wins out of 39 medians of three per-run
statistics. They are not pooled request percentiles or all paired wins.

| Comparator | Lower p50 | Lower p95 | Lower p99 | Lower maximum | Higher requests/s |
|---|---:|---:|---:|---:|---:|
| Convex | 11 | 8 | 12 | 10 | 8 |
| Supabase | 39 | 39 | 35 | 32 | 39 |

Against Convex, p50 wins break down into 8/9 point cases, 3/12 thread cases
and 0/18 feed cases. The concurrent feed gap remains substantial. Example
medians below are Snapback / Convex / Supabase, in milliseconds except rate.

| Case | p50 | p95 | Requests/s |
|---|---:|---:|---:|
| Five-group rotating point, C1 | 1.014 / 8.689 / 5.059 | — | 882.3 / 101.3 / 159.4 |
| 150-group rotating feed, C8 | 23.327 / 3.847 / 48.635 | 49.232 / 7.931 / 93.980 | 310.9 / 1742.9 / 153.3 |

All losses remain in the records. Against Supabase, four median p99 and
seven maximum comparisons are worse; matched rounds also contain two p50,
eleven p95 and three rate losses. Against Convex, the 117 paired case
comparisons favor Snapback in 32 p50, 39 p95 and 34 rate values. No ties occur.

Prepared walks visit the timed pages, automatic backend query caches remain
enabled, and OS residency is unmeasured. Snapback restores a fresh app and
process each run; Convex/Supabase retain their processes and message/group
tables. Memberships reset before every run. Convex's regrant performs the
labelled full 186-row reset; Snapback/Supabase restore the missing row.
Historical Convex source pins do not prove exact deployed module bytes.
The independent audit checks the producer's normalized proof records against
the fixture; it does not reconstruct the remote databases or inspect the
21 private logs, 12 snapshot ZIPs and six reset JSONLs. These limits preclude
a universal, hosted/WAN, cold-cache, write, realtime or matched-durability claim.

The nine appended records preserve each original annotated record and its
raw main object. Public transfer `5af43c96…` covers 164 JSON files; original
outer receipt transfer is `d963c72a…`. Independent summary `f73c947f…`, review
`ef9fd089…` and reconciliation `378a61c1…` agree on all 1,755 shared raw
statistics, 585 medians and 1,560 shared contrasts. The independent result
also retains elapsed statistics and all three backend pairings. Two
preserved analysis refusals corrected historical-witness provenance and
the reset-file inventory; no raw statistic or workload changed. Original
failed producer attempts and excluded smokes remain separate.

### Actual serving-writer NORMAL/FULL sensitivity: native Linux, trials 301–303

Six serial native loopback runs on Ubuntu 24.04 / AMD EPYC 9454 completed
at 2026-09-14 18:40:02 UTC. They compare the same qualified 0.2.12 source
`206650f29b26fa14456d49f33b9e8839b6ac005e` plus the reviewed host diagnostic,
binary `10557d0f…`. The serving writer itself reports WAL/NORMAL or WAL/FULL;
the expiration-fixture connection is separately labelled and is not used
to infer that setting. Node 24.21.0, the packaged SQLite flag, MEMSTATUS,
query limits and all other captured writer settings are unchanged.

Orders are NORMAL/FULL, FULL/NORMAL, NORMAL/FULL. All 39,000 timed HTTP
requests, 4,380 excluded warmups and 3,000 timed write/read pairs pass.
There are 36 additional untimed phase reads and 12 expired-session refusals.
All 18 complete physical proofs match the expected 100,000-row state.
Six actual same-app restarts use the original credentials; all 12 server
processes stop with SIGTERM. Restart checks verify the full state and
historical replays, not a fresh write after restart. Forty-eight readbacks
prove phases 0–3 of each serving writer used the selected setting.

Entries below are NORMAL → FULL medians of three per-run statistics.
Latency is milliseconds; rate is requests/s except the write/read row,
which is pairs/s. Component percentiles are retained separately and never
summed.

| Case | p50 | p95 | Rate |
|---|---:|---:|---:|
| Fresh write, C1 | 0.667 → 0.794 | 0.843 → 1.085 | 1398.9 → 1253.6 |
| Fresh write, C8 | 1.823 → 2.311 | 3.596 → 4.364 | 3767.5 → 3216.1 |
| Write then read, C1 | 1.921 → 2.133 | 2.365 → 2.789 | 492.7 → 433.3 |
| Rotating point, C32 | 5.779 → 5.433 | 18.067 → 25.852 | 4164.4 → 3984.5 |

FULL fresh-write throughput falls in every pair at both C1 and C8; median
rate decreases are 10.39% and 14.64%. Write/read pair rate falls 12.06%, with
p50/p95/p99 and rate worse in every pair. Across all 12 cases, FULL improves
six p50, three p95, six p99, five maximum and three rate medians. All other
medians are worse, with no ties. The full record retains all per-run and
tail losses, including the C32 point-read p95 increase above.

The 18 resource snapshots are untimed point observations, not peak-memory
or allocation measurements. After-workload RSS medians are 40,916 KiB
NORMAL and 40,856 KiB FULL, with mixed paired changes. Three pairs on one
prepared host do not isolate fsync cost or eliminate cache/order/load
effects. Graceful restart success does not prove power-loss durability;
this experiment establishes neither a Convex policy match nor a policy
adoption, release qualification or comparator win.

The six appended main records retain the separately labelled restart,
state, resource, auth and actual-writer evidence. Public transfer
`275896cb…` contains 133 JSON files; completion is `d7076409…`, independent
summary `4ea9fb24…`, review `0cfa574c…`, reconciliation `12d7c70b…`.
Root and independent calculations agree on all 486 raw statistics, 162
medians, 81 median and 243 paired contrasts, and 18 resource medians.
Earlier source refusal, failed V2 smoke and successful excluded smokes are
preserved. The local/remote exit timestamps differ by 30.5 ms in reverse
order; zero exit and within-host chronology agree, without a synchronized
clock assumption.

### Query CPU and wall time: instrumented 0.2.10 membership reads

A diagnostic on Office M1 Max / ARM Linux Colima (four CPUs, 12 GiB)
completed at 2026-09-14 20:25:45 UTC. It used source `beed6a51e…` with a
host-only stage/thread-CPU observer, binary `a68b11a2…`, Node 24.21.0 and
the packaged SQLite option with MEMSTATUS enabled. Production compilation
and 49 CLI tests passed. All 18,432 timed HTTP calls, 2,160 excluded warmups,
72 case/round blocks and 2,304 selected traces validated. Selection rotates
one in eight calls across three rounds; each case has 32 traces per round.
The 48-trace passing smoke remains separate. Before/after whole-fixture,
ordinary-session, outsider and invalid/expired-auth proofs passed; all owned
processes exited. Of the formal selected readers, 2,303 were reused and one
was constructed.

The following combines 96 selected observations per row across three rounds.
Means and nearest-rank p95 describe the instrumented `reader.query` interval;
ratios divide sums, not medians. Server wall runs from dispatch observation
through handler completion. All 24 combined cases and 72 separate case/round
summaries remain in the diagnostic ledger record.

| 150-group query | Mean CPU ms | Mean wall ms | Query wall p95 ms | CPU / query wall | Query / server wall |
|---|---:|---:|---:|---:|---:|
| First page, C1 | 4.719 | 4.735 | 6.956 | 99.65% | 89.08% |
| Rotating page, C1 | 6.180 | 6.212 | 9.339 | 99.49% | 91.52% |
| First page, C8 | 5.898 | 10.557 | 23.680 | 55.87% | 78.89% |
| Rotating page, C8 | 7.817 | 16.154 | 32.373 | 48.39% | 85.45% |

For the two C8 feed rows, waits for the outer auth/reader engine mutexes
average 0.154/0.173 ms. Query wall minus thread CPU averages 4.659/8.337 ms.
That signed residual cannot identify an internal lock, scheduler, I/O or
specific core function. The null-cursor first page is already CPU-intensive
at C1. The observer runs in-process and its cost is not calibrated away;
there is no uninstrumented speedup or new comparator conclusion here.

The earlier V3 formal attempt remains a **failed capture**: its HTTP load
finished, but only 421 of 2,304 required traces were collected and no after
verifier ran. Its traces are excluded. A host-only logging correction
preformats each line before taking the stderr lock; the successful V4 run
uses that reviewed correction. This diagnoses the observer, not product
latency. One `write_all` call is not a one-syscall guarantee.

Current core/language source at `206650f29…` and `886afe026…` is identical,
but differs materially from the measured `beed6a51e…`. Schema-derived rule
dependencies, prefix-verdict work and lookup materialization execute for
this fixture in the newer core. These numbers must not be relabelled as
0.2.12/current-release performance. The [feed follow-up](../../../issues/20260914-snapback4-membership-feed-query-cost.md)
requires a scoped current-source measurement before selecting a core change.
The old final cursor-encoding deletion remains unadopted.

The formal transfer (`eba60c90…`) retains 22 original public files, 4,674,220
bytes, under the ignored ship run's `membership-stages-0210-v4-formal-public/`.
Independent summary `81055afd…`, evidence review `19a4b5b7…` and reconciliation
`0eee78c1…` bind this result. The two calculators agree on 23,040 shared event
values and 2,304 shared group statistics; their p50 conventions differ
(arithmetic median versus nearest rank), and each was checked against its
own definition. No failed or smoke sample contributes to formal statistics.

### Query CPU and wall time: instrumented 0.2.12 membership reads

The same Office ARM Linux host completed the fixed `206650f29` (0.2.12)
diagnostic at 2026-09-14 21:55:52 UTC. The retained production binary is
`4a380ffd…`, with the packaged SQLite option and MEMSTATUS enabled. Its
700-file archive has one host-only observer override; all 71 CLI tests,
production compilation and version checks passed. A separate unmodified
0.2.12 build also passed those checks; it was not timed here.

All 18,432 HTTP calls, 2,160 excluded warmups, 72 case/round blocks and
2,304 selected traces passed. The original full before/after verifiers,
three physical fixture proofs and ordinary-session/outsider/auth checks
passed; all four owned process groups were absent at completion. There
were 2,303 reused selected readers and one construction. The successful
384-call smoke and every historical run remain outside these statistics.

Each row combines 96 selected observations across three rounds. Query
wall brackets `reader.query`; thread CPU is read on that same worker.
Ratios divide summed intervals, and p95 uses nearest rank.

| 150-group query | Mean CPU ms | Mean wall ms | Query wall p95 ms | CPU / query wall | Query / server wall |
|---|---:|---:|---:|---:|---:|
| First page, C1 | 4.399 | 4.410 | 5.073 | 99.75% | 91.05% |
| Rotating page, C1 | 5.550 | 5.568 | 6.467 | 99.67% | 92.09% |
| First page, C8 | 5.585 | 11.138 | 22.781 | 50.14% | 84.72% |
| Rotating page, C8 | 9.384 | 17.293 | 33.239 | 54.26% | 82.53% |

Query execution remains the main wide-feed cost on this source. At C8,
first/rotating feed query wall is 84.7%/82.5% of server dispatch-to-handler
wall. Signed query wall minus thread CPU averages 5.553/7.909 ms; it is
not attributed to an internal lock, I/O or scheduler. The sum of the five
outer host mutex waits averages 0.301/0.117 ms, including program and
reader-pool locks as well as engine locks. At C1 the query interval is
about 99.7% thread CPU. Nested internal query costs still need decomposition.

The root and independent calculations agree on 23,040 shared per-event
values and 2,304 shared summary values. Their p50 conventions remain
explicit: root arithmetic median versus independent nearest rank; the
432 checked common p50s are each valid under their own definition. This
is an instrumented diagnostic, not a cross-version speedup, fresh competitor
comparison or measurement of the published binary. The historical setup
source in the identity supplies fixture provenance, not the serving code.

The diagnostic ledger retains all 22 original public objects (4,674,403
bytes), all 72 case/round and 24 combined summaries, and build receipts.
Bindings: formal transfer `0fffccfc…`, independent summary `1b626d34…`,
review `f748ffad…`, reconciliation `e5deff38…`, qualification `dff38735…`.
The [core-owner follow-up](../../../issues/20260914-snapback4-membership-feed-query-cost.md)
now advances from current-source qualification to internal cost decomposition.


### Borrowed sync replies: native x86 Linux A/B on fixed 0.2.12

Six serial native loopback runs completed at 2026-09-14 22:16:04 UTC on
Ubuntu 24.04 / AMD EPYC 9454, using Node 24.21.0 / Undici 7.29.1. Both
binaries use source `206650f29b26fa14456d49f33b9e8839b6ac005e`, Rust 1.97.0,
the production profile, the packaged SQLite flag and MEMSTATUS enabled.
Baseline `265a81d3…` is 9,904,632 B; candidate `d07291d3…` is 9,909,944 B.
The only candidate source delta is the two host serialization/test files:
snapshot and stream responses serialize their owned original event values
without building a second JSON tree. The existing encoder drops the reply
before socket I/O. Readers, core, auth, transactions and ceilings are unchanged.

Production builds and the complete CLI groups passed: 71 baseline and 73
candidate tests, including both new exact-byte tests. The unchanged HTTP
bounds suite passed 9/9 for each binary, including oversize sync refusal and
slow-reader engine access. A separate ordinary-auth comparison passed all
32 normalized response pairs (64 wire captures), covering snapshots,
continuations, stream-from-zero, edits, deletes, leave and same-session
regrant, held/joined groups, acknowledgements and watermarks. Actual cursors
were followed within each run; cross-run comparison normalizes principal
roles and nonnull cursor presence only. The later formal run repeats those
checks and independently reconstructs the large reference response bytes.

Orders are B/C, C/B, B/C, with reversed case order in the middle pair. Each
run uses fresh ordinary guests and two groups containing 8,192 bulk messages
each, plus the ordinary-auth fixture: final owner/reader views contain
16,462/8,231 rows, and the outsider sees none. Complete owner, reader,
outsider and stream walks run before and after timing. Across six runs,
all **9,600 timed calls**, 960 excluded warmups, 192 ordinary wire captures,
48 full walks and 144 reconstructed page hashes pass. Every timed response
matches its fully checked reference bytes. All six clients exit zero and
all recorded server groups stop cleanly; there is no restart experiment.

Each case has 200 timed requests after 20 sequential warmups. Values below
are medians of three per-run nearest-rank statistics, baseline → candidate;
latencies are milliseconds, rates are requests/s. A stream requested at
4,000 returns **3,584 events** because this fixture preserves commit groups.

| Case | p50 | p95 | p99 | Maximum | Requests/s |
|---|---:|---:|---:|---:|---:|
| First snapshot, 64 events, C1 | 2.076 → 1.626 | 3.131 → 2.439 | 3.438 → 2.838 | 5.189 → 4.246 | 438.5 → 563.4 |
| First snapshot, 64 events, C8 | 5.909 → 5.199 | 11.399 → 9.496 | 17.806 → 13.199 | 18.490 → 20.308 | 1227.8 → 1449.3 |
| First snapshot, 4,000 events, C1 | 38.832 → 25.873 | 45.992 → 28.541 | 48.128 → 30.339 | 49.265 → 34.502 | 22.9 → 35.0 |
| First snapshot, 4,000 events, C8 | 59.138 → 59.100 | 97.443 → 82.141 | 139.416 → 107.150 | 175.828 → 117.107 | 117.7 → 122.7 |
| Next snapshot, 4,000 events, C1 | 39.697 → 30.360 | 43.323 → 33.312 | 44.188 → 34.348 | 46.752 → 34.832 | 22.1 → 27.8 |
| Next snapshot, 4,000 events, C8 | 59.143 → 57.550 | 83.175 → 76.015 | 101.894 → 97.084 | 116.738 → 112.464 | 125.0 → 126.3 |
| Stream requested 4,000, C1 | 58.198 → 49.924 | 61.260 → 53.038 | 63.038 → 54.315 | 65.568 → 55.649 | 15.8 → 18.2 |
| Stream requested 4,000, C8 | 67.047 → 63.226 | 129.251 → 121.378 | 163.665 → 180.840 | 176.624 → 194.659 | 102.0 → 111.4 |

All eight case-median p50/p95 values and rates improve; p99 improves in
seven and maximum in six. At C1, p50 falls 21.7% for 64 events, 33.4% for
the first 4,000, 23.5% for the next 4,000 and 14.2% for stream. The C8
4,000-event first-page p50 is effectively flat (-0.065%). All median losses
are explicit: small-snapshot C8 maximum +9.83%, stream C8 p99 +10.49% and
maximum +10.21%. Across 24 same-trial cases, losses for p50/p95/p99/maximum/
elapsed/rate are 1/1/3/4/1/1, with no ties. The
[concurrent-tail follow-up](../../../issues/20260914-snapback4-sync-concurrent-tail-latency.md)
keeps those targets open. Adoption is for the measured warm gains and
unchanged response semantics, not a uniform tail-latency claim.

Timers include HTTP, text collection and JSON parsing. Hash oracles run
after each latency timer but remain inside whole-case rates, and may delay
overlapping C8 callbacks. Complete walks prepare the fixture before timing;
sequential warmups do not establish eight warmed connections. There is no
cold-cache, CPU/allocation attribution, peak-memory, device acquisition,
realtime, comparator or power-loss durability claim. Source-built A/B
measurements remain separate from later integration/publication qualification.

The storage ledger's `sync-wire-0212-perf-v2-formal` row preserves all 223
formal public files (1,317,264 B), raw vectors, all 48 median and 144 paired
contrasts, both build completions and the complete bounds/ordinary-auth
public evidence. Transfer `cc03b514…`, complete `87a06e53…`, independent
summary `b0c99e32…` and review `aa0b1d09…` bind the results. Reconciliation
`08196368…` checks 288 shared raw values, 80 medians, 40 median changes and
360 paired values against frozen root summary `8dac6364…`. Private logs,
sessions and databases remain on the benchmark host.

The V1 smoke failed before any timed case because its small-page reference
omitted the request body. V2 corrects that shape only; the failed run is
retained and excluded. The 256-call V2 smoke is admission evidence only.
The original independent formal calculator also failed before numeric work
on a smoke-only outer-launcher field. Its separately versioned correction
validates the formal input receipt and bootstrap; all statistic/oracle
functions are unchanged. Both attempts and the correction are retained.


### Published 0.2.13 — borrowed sync serialization

The unchanged publisher completed on the prepared M4 Pro at **2026-09-14
23:10:55 UTC**, publishing `snapback4` and `snapback4-darwin-arm64` **0.2.13**
from committed source `d81381a98f56478f8e5d776f0d1b36d234145112`. The
700-file source archive is SHA-256 `40081bdccd36a0b35300ac39568b0790c1ff561385e3c27a1a478638010a490b`.
The later pushed checkpoint `ec15bba44` adds incoming benchmark documentation;
runtime, package, scripts, vendor and fixture source remain identical.

The full suite passed **474 Rust, 146 reported client and 9 fixture tests**,
with zero failures and one existing ignored Rust test. Its wall time was
**130 s**, above the existing 60-second budget. Cargo tests took 127 s,
client tests 38 s and fixture tests 6 s; stages overlap and are not summed.
Node 24.21.0, Rust 1.97.0, four Cargo build jobs, one Rust test thread and
the packaged `-USQLITE_ENABLE_MEMORY_MANAGEMENT` setting were retained.
Preparation compiled tests but did not execute them; these counts come
from the actual publication run. This is no matched warm-loop comparison.

The production build and installed-package proof passed. The installed
CLI reports `snapback4 0.2.13` and matches the **7,893,696-byte** packed
production binary, SHA-256 `096b464f9a9afb3e0ec8b6ad64b0dd29558897b60fba65c2c0847aa97e4963e8`.
The TypeScript consumer compiles; its mock client asserts query readiness,
freshness and three rows, an online write sent and an offline write pending.
Its inherited log says `complete+fresh`, but it does not separately assert
the query's complete flag. Publication took **235.5 s**. Both supervised
process groups were absent at completion, the temporary credential was
removed, and all 700 source files were rechecked with only the one expected
publication-metric append. No cleanup failure or scoped process remained.

Both public registry archives were verified by **23:14:28 UTC** against
the tested tarballs, their registry SHA-512/SHA-1 values, and the packed
binary. The client is **526,218 B**, SHA-256 `1dfa3256525624731d0db1641ae56efb200d39612e1552347ae826fc33c7df90`;
the platform archive is **3,868,663 B**, SHA-256 `5df79c0e5696cab551acd5a44880e643a426471cdecff80fb9df888d5e6435b2`.
The client pins its optional platform dependency to 0.2.13. The initial
platform metadata request returned 404 while the client archive verified;
that observation is retained separately. Only read-only visibility checks
followed, with no repeated publication.

The original publisher row is appended unchanged to `snapback4/metrics/publish.jsonl`.
The ignored run retains `sync-wire-0213-publication-public/` (nine original
public files), `sync-wire-0213-registry-verification.json` and
`sync-wire-0213-publication-qualification.json`. Publisher log SHA-256 is
`d3fae29b9bc32679f2176b399acf370a03e4d547367b65cc7cdcb6c12132db4a`.
This is release and correctness evidence; the preceding native sync
measurements retain their original 0.2.12 A/B source and binary identities.
No new latency, hosted, competitor, device or durability result follows.


### Fixed 0.2.13 core-scope diagnostic: membership lane work

The Office ARM Linux run completed at **2026-09-15 00:09:22 UTC** using
source `d81381a98f56478f8e5d776f0d1b36d234145112` plus seven ignored
diagnostic source overrides. V2's production build and **73 CLI tests**
passed with zero failed/ignored/filtered tests. The retained binary is
`08c4c062…`, 8,474,128 B; Node is 24.21.0 / Undici 7.29.1, Rust 1.97.0,
with the packaged SQLite flag and MEMSTATUS enabled. V3 corrects an
unexecuted controller's port mismatch with the unchanged loader.

All **18,432 timed calls**, 2,160 excluded warmups, 2,304 selected traces
and 72 blocks passed. Each of 24 degree/query/concurrency cases has 96
selected queries across three rounds. The two original full HTTP verifiers,
three physical fixture proofs, ordinary authorization/cursor checks and
same-session checks passed. The selected readers include 2,303 reused and
one constructed reader. The planned SIGTERM and all four owned group
lifetimes ended as expected. The 384-call smoke is excluded.

The useful finding is repeated work per returned 20-row feed. Every selected
first-page query at both C1 and C8 has the following counts:

| Groups | Prepared scans | Live rule probes | Indexed scan collections | Row JSON decodes |
|---|---:|---:|---:|---:|
| 5 | 6 | 5 | 11 | 120 |
| 30 | 51 | 50 | 101 | 180 |
| 150 | 171 | 170 | 341 | 660 |

The source explains the counts. It discovers N memberships, initializes all
N message lanes, and performs a live membership lookup for each initial scan
or refill. Above eight lanes it buffers one visible message per lane and
requests two for lookahead; these full pages refill after each of 20 emitted
rows. With L=N+20 message scans, indexed scan collections are **1+2L**:
one discovery, L message scans and L membership lookups. Five-group pages
buffer 21 visible messages per lane and request 22, so need no refill here.
At 150 groups the first page decodes 150 discovery membership rows,
170 membership-proof rows and 340 fetched message rows: 660 decodes for
20 outputs. These may revisit rows; they are not unique rows, disk reads,
meter units, all SQL statements or individual SQLite-step calls.

The rotating 150-group cases retain 171 prepared scans, 170 rule probes and
341 indexed collections per selected query; mean row decodes are 659.479
because some cursor-positioned lanes fetch fewer messages. Rule dependency
preparation also repeats 171 times. `metadata_numbers` is in-memory catalog
lookup/name formatting, not another SQL read.

The following are **instrumented** means for the 150-group cases, not
uninstrumented release latency or a speedup. The last two columns divide by
the recorded core query CPU sum; initial-head time is inclusive, whereas
step/collect time excludes nested JSON decoding.

| Query | Core CPU ms | Core wall ms | Initial heads / core CPU | Step/collect exclusive / core CPU |
|---|---:|---:|---:|---:|
| First page, C1 | 14.364 | 14.383 | 72.16% | 20.34% |
| Rotating page, C1 | 15.674 | 16.010 | 68.66% | 21.17% |
| First page, C8 | 16.146 | 28.628 | 73.74% | 22.45% |
| Rotating page, C8 | 19.291 | 34.730 | 68.31% | 22.20% |

All 31 scopes' exclusive wall and CPU counters partition the core query
root exactly. **That proves accounting, not negligible probe overhead.**
The 150-group first page executes 5,024 scope guards. Clock reads, TLS,
counter/drop bookkeeping and later trace logging perturb the workload;
bookkeeping can fall in a parent's exclusive remainder. The percentages
must not be promoted to uninstrumented CPU shares or pure SQLite costs.
`step_collect` includes SQLite iteration, row copying, Rust iterator/error
work and vector allocation; JSON decoding is a nested scope. No specific
internal lock, filesystem, scheduler or VM cause follows from CPU/wall gaps.

Both calculators were frozen before formal execution. Independent checks
and reconciliation agree on **357,120 raw scope components**, 6,912 outer
intervals, 3,720 case-sum components, 3,720 means and 1,488 shares. The
storage ledger appends all 22 original public objects (8,082,457 transferred
bytes), all 24 case counter summaries, qualification, source mappings and
limits. Transfer `c23f67d0…`, completion `62f8048f…`, independent summary
`29b6fa3b…` and reconciliation `4483be1c…` bind the retained local evidence.

Main advanced through **0.2.14 to 0.2.15** during this fixed-source experiment.
The manifests at observed origin `66a7c976` say 0.2.15. Rules/store/host-query
source is identical, but query/read/
runner/page logic and accepted-socket behavior differ. These are not 0.2.14
or 0.2.15 measurements. The [core-owner follow-up](../../../issues/20260914-snapback4-membership-feed-query-cost.md)
now targets repeated scan/preparation/materialization work, with current-source
qualification and ordinary uninstrumented A/B required before adopting a
change. No runtime code, authority cache, ceiling or client contract changes
in this evidence landing; no new competitor win is claimed.

### Merge-local scan preparation: fixed 0.2.15 HTTP A/B, not adopted

The candidate passes correctness qualification but is **not recommended for
adoption**: the targeted 150-group concurrent next and rotating feeds lose
throughput in every pair. Smaller concurrent feeds improve, so this is a
mixed result rather than evidence of a uniform regression.

Main reached **0.2.16** before this evidence landing. Integration parent
`1a4a50da8…` changes core reads/rules/admission/schema and host behavior
relative to measured d0ea. This batch qualifies neither that newer runtime
nor its performance; the next candidate needs its own source qualification.

Six serial runs on Office M1 Max / ARM Linux Colima (4 CPUs, 12 GiB)
completed at **2026-09-15 02:03:08 UTC**. Both production binaries use
`d0ea081923efb375a00fee97b78ebcd2f836554d` (0.2.15), Rust 1.97.0,
`-USQLITE_ENABLE_MEMORY_MANAGEMENT` with MEMSTATUS enabled, and Node
24.21.0 / Undici 7.29.1 with ordinary built-in fetch. Baseline binary
`7b995328…` and candidate `1f41011f…` are each 8,539,664 B. The candidate's
only runtime delta is in `engine/read.rs`: two pure schema/IR analyses are
initialized lazily and reused per original plain-merge lane template. The
cells die with that merge. Prefix values, live authority, expiry, dependency
accounting, meters, bounds and page/cursor state remain freshly evaluated.

The V2 candidate passed **318 selected Rust test executions**, including
three new differential/privacy tests and the affected core, CLI, simulator
and device groups. Reported groups have zero failures or ignored tests;
filtered slots and corpus-internal named exclusions remain separate. The
earlier V1 core-test compile failure is preserved; V2 corrected the test's
seed-return arm and expiry fixture without changing the runtime patch.
This is selected source qualification, not a full-workspace, physical-device
or publication claim.

Formal trials 401–403 use orders B/C, C/B, B/C. All **117,000 timed case
calls** (39 cases × 500 samples × six runs), **7,020 excluded warmups** and
**162 untimed complete walks / 33,510 traversal pages** pass. Each run
starts a fresh server/private fixture copy, compiles the same authored
schema, and verifies all 501 groups, 100,000 messages and memberships
186 → 185 after leave → 186 after regrant. Auth, outsider, invalid/expired/
forged credentials, exact ordered results, old/foreign cursors and regrant
with the original sessions on the same server pass. The two trial-997
smokes are excluded. All twelve clients exit zero; all six servers receive
their planned SIGTERM, and final owned-group cleanup passes.

The following counts compare lower latency/elapsed or higher requests/s.
Medians use three reported run statistics; request quantiles are not pooled.

| Metric | Better / worse case medians (39) | Better / worse / tied pairs (117) |
|---|---:|---:|
| p50 | 21 / 18 | 59 / 58 / 0 |
| p95 | 24 / 15 | 70 / 47 / 0 |
| p99 | 23 / 16 | 68 / 49 / 0 |
| Maximum | 21 / 18 | 63 / 54 / 0 |
| Elapsed | 21 / 18 | 62 / 54 / 1 |
| Requests/s | 21 / 18 | 62 / 55 / 0 |

Selected medians are baseline → candidate, milliseconds except rate:

| Feed case | p50 | p95 | p99 | Requests/s |
|---|---:|---:|---:|---:|
| 5 groups, next, C1 | 1.778 → 2.503 | 2.509 → 6.977 | 3.588 → 11.395 | 525.9 → 310.1 |
| 5 groups, first, C8 | 7.656 → 4.729 | 20.991 → 9.500 | 32.044 → 13.058 | 859.9 → 1486.2 |
| 30 groups, first, C8 | 11.091 → 6.234 | 37.695 → 10.735 | 56.402 → 13.604 | 489.7 → 1221.9 |
| 150 groups, first, C1 | 5.287 → 4.679 | 6.777 → 6.007 | 7.357 → 6.349 | 188.2 → 203.2 |
| 150 groups, rotating, C1 | 7.352 → 7.052 | 8.779 → 12.372 | 10.072 → 20.639 | 132.0 → 130.1 |
| 150 groups, first, C8 | 20.610 → 19.501 | 46.939 → 43.183 | 68.039 → 56.395 | 313.5 → 357.4 |
| 150 groups, next, C8 | 18.446 → 24.014 | 34.477 → 56.209 | 42.626 → 71.103 | 405.0 → 291.5 |
| 150 groups, rotating, C8 | 19.176 → 24.454 | 36.245 → 55.225 | 59.378 → 78.369 | 375.8 → 282.9 |

For the 150-group rotating C8 feed, median p50 rises **27.52%**, p95
**52.37%**, and throughput falls **24.72%**. Its three paired elapsed
increases are 44.10%, 5.60% and 32.87%. The corresponding next-page elapsed
increases are 184.18%, 48.25% and 2.68%; p95, p99, maximum and rate worsen
in all three pairs. Five-group first-page C1 and 30-group rotating C1 p50
also worsen in every pair. All 317 paired losses across six metrics remain
in the reconciled summaries; the largest individual observations are
178.702 ms baseline and 201.963 ms candidate, in different cases.

After-workload RSS medians are 29,968 → 29,120 KiB, but paired differences
are −3,032, +2,764 and +2,260 KiB. Process-lifetime HWM medians are
37,860 → 37,312 KiB. These are untimed process observations, not continuous
peaks or isolated preparation allocation. Full proofs/walks warm the cases;
OS cache residency is unmeasured. Point/thread controls also vary, and no
particular allocator, internal lock or scheduler cause is established.
There is no new comparator, cold-cache, write, durability, device-performance
or current published-artifact claim.

Both analysis programs were frozen before smoke timing and passed their
actual calculations unchanged. The original **137-file / 1,115,631-byte**
public transfer is `24400ba3…`, formal completion `4f5cf9ec…`, root summary
`1668fa83…`, independent summary `ee74ee95…`, and reconciliation `0a2cc6bc…`.
They agree on 1,404 run values, 468 median values, 234 median contrasts,
702 paired contrasts and twelve RSS/HWM snapshots. Six appended ledger
objects preserve the original formal records and add count/scope annotations.
Supporting files use the ignored run prefix
`membership-scan-preparation-0215-v2-http-v1`. The
[core-owner follow-up](../../../issues/20260914-snapback4-membership-feed-query-cost.md)
remains open; this landing changes evidence only.


### Borrowed SQLite row text: fixed 0.2.16 A/B, trials 401–403

**Do not adopt this candidate from the measured evidence.** Removing one
intermediate JSON string copy does not establish an overall gain, and the
150-group continuation feed at eight clients loses p95, p99, elapsed time
and throughput in every matched pair. No candidate runtime is landed.

Six serial runs on Office M1 Max / ARM Linux Colima (4 CPUs, 12 GiB)
completed at **2026-09-15 04:25:36 UTC**. Both production binaries use
`009de62842945ee86f4dec22d1d43705bfa21d74` (0.2.16), Rust 1.97.0,
`-USQLITE_ENABLE_MEMORY_MANAGEMENT` with MEMSTATUS enabled, and pinned
Node 24.21.0 / Undici 7.29.1 with the ordinary built-in fetch instrument.
Baseline `9c6d0b8c…` and candidate `90aadbfc…` are each 8,736,272 bytes.
Only `Tx::scan_keys` has a candidate runtime change: parse SQLite's borrowed
TEXT into the same owned Value instead of first copying it into a String.
The original SQL, bindings, key-before-JSON error order, owned return values,
transactions, live authority, meters and cursor behavior are retained.

The baseline passed 293 selected Rust test executions. The candidate passed
546: core 72, language 120, CLI 104, simulator 79 and device-crate 171.
All selected result groups report zero failed, ignored, measured or filtered;
corpus-internal named exclusions remain separate. Three new differential
tests cover typed rows, bounds/keys, malformed text and first-error order.
This is selected source qualification, not a full workspace or physical-device
claim. Test and production profiles are separate; both production artifacts
were retained and rehashed after HTTP collection.

Orders are B/C, C/B, B/C at trials 401–403. All **117,000 timed calls**,
7,020 excluded warmups, and **162 untimed walks / 33,510 pages** passed.
Each run verifies 501 groups, 100,000 messages and the 186→185→186 membership
transition, exact ordered results, outsider/expired/foreign credentials,
old cursors, acknowledged leave and regrant using the original sessions.
All twelve clients exited zero; six owned servers stopped with their planned
SIGTERM; all eighteen registered groups were absent before completion.
The two 50-sample smokes are excluded from every formal statistic.

Counts compare lower latency/elapsed or higher requests/s. Medians use three
reported run statistics; request quantiles are not pooled.

| Metric | Better / worse / tied medians (39) | Better / worse / tied pairs (117) |
|---|---:|---:|
| p50 | 19 / 19 / 1 | 60 / 56 / 1 |
| p95 | 16 / 23 / 0 | 53 / 64 / 0 |
| p99 | 20 / 19 / 0 | 58 / 59 / 0 |
| Maximum | 20 / 19 / 0 | 59 / 58 / 0 |
| Elapsed | 19 / 20 / 0 | 57 / 60 / 0 |
| Requests/s | 19 / 20 / 0 | 57 / 60 / 0 |

Selected medians are baseline → candidate, milliseconds except rate:

| Case | p50 | p95 | p99 | Requests/s |
|---|---:|---:|---:|---:|
| 5 groups, next, C8 | 5.335 → 6.491 | 10.668 → 14.200 | 25.931 → 26.661 | 1301.9 → 1098.6 |
| 30 groups, thread first, C1 | 1.570 → 2.807 | 2.248 → 7.227 | 2.520 → 14.032 | 566.1 → 283.4 |
| 30 groups, rotating, C1 | 3.260 → 3.001 | 5.501 → 4.073 | 8.212 → 5.967 | 272.6 → 312.9 |
| 150 groups, first, C1 | 6.186 → 6.451 | 8.086 → 11.957 | 10.416 → 19.466 | 155.8 → 131.1 |
| 150 groups, rotating, C1 | 7.984 → 7.984 | 13.254 → 12.310 | 20.506 → 16.083 | 111.9 → 115.6 |
| 150 groups, first, C8 | 19.951 → 18.539 | 40.712 → 35.913 | 54.556 → 44.084 | 369.4 → 394.3 |
| 150 groups, next, C8 | 21.460 → 28.791 | 46.609 → 93.346 | 60.304 → 117.648 | 333.4 → 206.2 |
| 150 groups, rotating, C8 | 25.185 → 23.806 | 51.060 → 50.874 | 66.864 → 75.534 | 289.6 → 306.6 |

The large continuation's median p50 rises **34.16%**, p95 **100.27%** and
throughput falls **38.15%**. Its three paired elapsed increases are 104.57%,
15.00% and 40.63%; paired p95 increases are 100.27%, 65.04% and 65.78%.
The large first page improves its median p50/p95/rate, but loses all three
in the first pair; its p99 also rises 271.62% in that pair. The large rotating
page's p50/rate medians improve 5.48%/5.87%, while p99 rises 12.97%.
Largest observations are 201.672 ms baseline (trial 402) and 238.028 ms candidate (trial 401), both in `groups150FeedFirstC8`.
Point and thread controls vary substantially too. All **357 paired losses**
across six metrics remain in the summaries; no particular allocator, SQLite
lock or scheduler cause is established by these timings.

After-workload RSS medians are 29,704 → 30,224 KiB (+520 KiB); paired
differences are −1,116, −388 and +2,188 KiB. Process-lifetime HWM medians
are 37,696 → 37,376 KiB. These are untimed point observations, not continuous
peaks or an isolated measure of the removed String allocation.

The extra initial preflight wrongly required every `/target` server absent.
That failed receipt is preserved. Historical and fresh identity observations
reconcile five older fixture servers outside the established experiment
scope. The corrected preflight kept that scope empty and port 4414 clear;
none of those older servers was signalled. Their two short samples had no
CPU-tick change, but a later sample added 6/6/6/7/6 ticks. This is a shared VM,
not evidence of continuous inactivity or isolation. Full proofs/walks warm
the cases; OS cache residency is unmeasured. There is no new comparator,
write, durability, cold-cache, device-performance or published-artifact claim.

Main reached 0.2.18 (`826108972…`) during this work. Its `scan_keys` function
is byte-identical to the measured baseline, but store opening, read/cursor,
schema and host/device behavior changed. The archived A/B remains bound to
0.2.16; advancing the evidence worktree does not qualify the newer runtime.

Both original calculators were frozen before smoke timing and passed their
first formal execution unchanged. All 1,404 run values, 468 median values,
234 median contrasts, 702 paired contrasts, twelve memory snapshots, and
all losses/ties reconcile. Six appended ledger objects are the exact original
formal records. The public transfer contains **137 files / 1,337,281 bytes**:
transfer `7d3ea92e…`, completion `e71e95fe…`, root summary `0a9cc815…`,
independent summary `b5f05db8…`. Supporting files use ignored-run prefix
`membership-borrowed-scan-0216-v1-http-v1`. The existing
[core-owner follow-up](../../../issues/20260914-snapback4-membership-feed-query-cost.md)
remains open for the larger repeated-scan/materialization cost.


### Unmodified 0.2.18 membership feed stack diagnostic

Four external sampling runs completed on the shared Durand Apple M4 Pro at
2026-09-15 05:34:31–05:36:29 UTC. Source is `053a5b288…` (0.2.18),
retained native binary `93c2dc5c…`. The production profile retains function
symbols with `strip=none`; Cargo reports `debuginfo:0`. The packaged SQLite
flag, MEMSTATUS enabled, Node 24.21.0 and the original membership verifier
remain pinned. This measures one fixed source and prepared fixture.

All **158,243 active-load responses** and **6,120 preparation/warmup
responses** passed exact viewer, completeness, ordered-row and continuation
checks. The original five-reader logical feed/thread and credential checks
passed before and after. The 150-group reader's first/rotating pages ran at
one/eight concurrent clients, each for 25 seconds; every ten-second sample
invocation stayed inside its active window. Ten verifier/loader/sampler
children exited zero; the owned server exited -15. All eleven recorded
groups are absent, with no cleanup or sanitization errors. No new
leave/regrant, restart or physical-all-table proof ran.

The following are inclusive unions of **request-subtree stack observations**.
Categories overlap and cannot be added; they are not CPU time, call counts,
latency or cache misses.

| Case | Active responses | Request | Engine query | Store scan | SQLite step | Cursor | Kernel mutex wait |
|---|---:|---:|---:|---:|---:|---:|---:|
| First page, C1 | 21,995 | 1,203 | 1,174 | 677 | 307 | 1 | 0 |
| Rotating page, C1 | 16,765 | 1,266 | 1,243 | 555 | 242 | 308 | 0 |
| First page, C8 | 65,553 | 11,353 | 11,194 | 5,163 | 1,706 | 3 | 4 |
| Rotating page, C8 | 53,930 | 11,387 | 11,289 | 4,013 | 1,458 | 2,974 | 4 |

Most request observations lie under the query engine. Rotating pages show
cursor parsing/encoding ancestry; allocation/free and SQL index work also
appear. Source inspection finds a successful initial cursor validation
followed by bounds decoding for each expanded lazy-merge lane. This suggests
an experiment retaining one decoded token during one request, while keeping
canonical, descriptor, live-authority, scope, meter and result semantics.
No such runtime change is adopted by this record. The earlier rejected
canonical-re-encoding-removal experiment remains separate.

Two independent call-tree implementations agree on all structural counts,
scope unions, exclusive partitions, matched symbols and reported top frames.
Every exclusive residual is nonnegative and the residual sum equals the
thread-root sum. Wait-symbol lists are incomplete classifications; zero
kernel-mutex observations cannot establish absence of contention. Inlining,
unresolved symbols, shared-host activity and sampling affect attribution.
No new unsampled speedup, comparator, current-release, device, write or
durability result follows.

The ignored run retains 49 public payload files / 36,196,185 bytes, all
hash-verified, plus the transfer manifest. Private sessions, DB and raw logs
were not transferred. The failed first collector parse/empty archive are
preserved; the profile ran once. Transfer is `d1b5b811…`, final receipt
`bb6c82f5…`, root analysis `dde31de2…`, independent audit `3de9cebe…`,
parser reconciliation `9db47dd9…` and independent review `9951d0ce…`.


### Decoded-cursor reuse: fixed 0.2.18 HTTP experiment

Three alternating baseline/candidate pairs completed on shared Durand M4 Pro /
native Darwin at 2026-09-15 06:47:46–06:49:30 UTC. This remains an ignored
core-owner experiment, with no runtime adoption. Fixed source `053a5b288…`
is version 0.2.18; retained baseline/candidate binaries are `93c2dc5c…` /
`7b9c73d3…`. Both use production optimization with `strip=none`, the packaged
SQLite flag and MEMSTATUS enabled. No sampler ran. Node 24.21.0 / Undici
7.29.1 uses ordinary built-in fetch and the historical Darwin instrument
`ebe5b64d…`, not the newer tracked instrument.

The candidate retains the first successfully decoded cursor only within one
eligible lazy merge. Reuse requires identical token, table, index, ordering
and prefix width. Initial validation before discovery, canonical re-encoding,
all expression evaluation and meter charges, scope/generation checks and
live authority/row reads remain. The runtime overlay is one `read.rs` change;
the second overlay supplies two simulator regressions. Selected qualification
passed **368 candidate and eight baseline Rust tests**, with four full
outcome/refusal objects equal. This was not a complete workspace or client
qualification.

Formal trials 501–503 run B/C, C/B, B/C: **117,000 timed requests**, 7,020
excluded warmups and 162 untimed complete walks / 33,510 pages. All 234 case
records have zero errors. Twenty-four full proofs agree on normalized records
of all three app tables, including 186→185→186 memberships. Auth, tie order,
cursor, acknowledged leave and same-session regrant checks pass; the original
seven-day sessions are unchanged. Each run restores a fresh app/server/DB;
leave and regrant use the same live server. All 42 owned child groups are
absent with expected exits and no cleanup errors. The two 50-sample smoke
runs are excluded. Neither batch was rerun.

All **12 feed-continuation cases** have lower median p50/p95 and higher rate;
p50 improves in all 36 matched pairs. For the 150-group rotating feed at C8,
p50 falls **3.716→2.984 ms (19.70%)**, p95 **4.376→3.247 ms (25.80%)** and
rate rises **2,092.8→2,649.1 requests/s (26.58%)**. Across all 39 cases,
p50/p95/p99/max medians improve in 32/33/28/27; rate improves in 31. The
p50 count has five losses and two ties. These are medians of three reported
per-run statistics, not pooled quantiles or significance estimates.

| Case | p50 ms, baseline → candidate | p95 ms | p99 ms | Maximum ms | Requests/s |
|---|---:|---:|---:|---:|---:|
| groups5PointHotC1 | 0.181 → 0.186 | 0.265 → 0.251 | 0.362 → 0.333 | 3.171 → 3.249 | 4832.5 → 4761.4 |
| groups5PointWorkingSetC1 | 0.176 → 0.181 | 0.236 → 0.274 | 0.360 → 0.397 | 2.762 → 2.824 | 5256.6 → 4907.8 |
| groups5ThreadFirstC1 | 0.273 → 0.272 | 0.384 → 0.389 | 0.483 → 0.473 | 1.930 → 3.309 | 3301.0 → 3225.4 |
| groups5ThreadNextC1 | 0.277 → 0.274 | 0.369 → 0.337 | 0.443 → 0.432 | 2.973 → 2.751 | 3189.4 → 3317.1 |
| groups5FeedFirstC1 | 0.322 → 0.317 | 0.371 → 0.389 | 0.479 → 0.517 | 3.438 → 2.832 | 2856.1 → 2904.8 |
| groups5FeedNextC1 | 0.338 → 0.326 | 0.413 → 0.393 | 0.515 → 0.569 | 3.358 → 2.853 | 2741.1 → 2844.1 |
| groups5FeedWorkingSetC1 | 0.344 → 0.330 | 0.451 → 0.420 | 0.582 → 0.542 | 3.165 → 3.660 | 2687.1 → 2833.0 |
| groups5PointWorkingSetC8 | 0.417 → 0.401 | 0.932 → 0.851 | 3.736 → 3.281 | 4.000 → 3.408 | 14255.5 → 15729.5 |
| groups5ThreadFirstC8 | 0.564 → 0.561 | 0.781 → 0.759 | 1.140 → 3.090 | 1.707 → 3.398 | 13283.3 → 12682.6 |
| groups5ThreadNextC8 | 0.575 → 0.561 | 0.820 → 0.763 | 2.844 → 2.858 | 3.134 → 2.902 | 12526.0 → 13092.0 |
| groups5FeedFirstC8 | 0.736 → 0.674 | 1.032 → 0.922 | 3.055 → 2.765 | 3.387 → 2.815 | 10416.0 → 10950.8 |
| groups5FeedNextC8 | 0.846 → 0.684 | 1.131 → 0.947 | 3.062 → 3.083 | 3.250 → 3.217 | 9295.3 → 10649.1 |
| groups5FeedWorkingSetC8 | 0.726 → 0.674 | 1.066 → 0.908 | 3.260 → 3.095 | 3.389 → 3.221 | 10110.9 → 10965.6 |
| groups30PointHotC1 | 0.119 → 0.111 | 0.130 → 0.128 | 0.147 → 0.153 | 3.054 → 2.565 | 7914.6 → 8528.6 |
| groups30PointWorkingSetC1 | 0.122 → 0.115 | 0.137 → 0.129 | 0.181 → 0.152 | 2.779 → 2.694 | 7850.3 → 8116.6 |
| groups30ThreadFirstC1 | 0.210 → 0.206 | 0.232 → 0.227 | 0.302 → 0.282 | 3.601 → 2.340 | 4313.5 → 4530.5 |
| groups30ThreadNextC1 | 0.222 → 0.218 | 0.285 → 0.279 | 0.352 → 0.350 | 2.286 → 3.267 | 4114.1 → 4145.6 |
| groups30FeedFirstC1 | 0.398 → 0.398 | 0.429 → 0.418 | 0.469 → 0.438 | 2.921 → 3.220 | 2427.7 → 2449.2 |
| groups30FeedNextC1 | 0.490 → 0.417 | 0.544 → 0.445 | 0.646 → 0.474 | 3.057 → 2.834 | 1981.6 → 2354.7 |
| groups30FeedWorkingSetC1 | 0.514 → 0.444 | 0.580 → 0.478 | 0.634 → 0.530 | 3.043 → 2.967 | 1903.6 → 2184.7 |
| groups30PointWorkingSetC8 | 0.344 → 0.343 | 0.424 → 0.416 | 2.507 → 3.731 | 2.585 → 3.781 | 20818.7 → 19959.6 |
| groups30ThreadFirstC8 | 0.559 → 0.511 | 0.793 → 0.752 | 3.392 → 3.288 | 3.605 → 3.480 | 13008.1 → 13601.3 |
| groups30ThreadNextC8 | 0.581 → 0.515 | 0.941 → 0.685 | 3.173 → 3.030 | 3.443 → 3.172 | 11817.4 → 13802.7 |
| groups30FeedFirstC8 | 1.119 → 1.108 | 1.331 → 1.368 | 3.453 → 3.150 | 3.904 → 3.754 | 6763.1 → 6793.0 |
| groups30FeedNextC8 | 1.337 → 1.129 | 1.525 → 1.344 | 1.678 → 3.400 | 1.985 → 3.860 | 5913.8 → 6725.4 |
| groups30FeedWorkingSetC8 | 1.311 → 1.146 | 1.758 → 1.337 | 2.022 → 1.416 | 2.242 → 1.828 | 5742.3 → 6713.3 |
| groups150PointHotC1 | 0.108 → 0.106 | 0.123 → 0.118 | 0.134 → 0.130 | 3.011 → 2.898 | 8850.5 → 8866.7 |
| groups150PointWorkingSetC1 | 0.116 → 0.113 | 0.135 → 0.124 | 0.195 → 0.142 | 3.184 → 2.990 | 7969.5 → 8343.2 |
| groups150ThreadFirstC1 | 0.203 → 0.203 | 0.223 → 0.222 | 0.297 → 0.283 | 3.039 → 2.820 | 4487.3 → 4571.6 |
| groups150ThreadNextC1 | 0.211 → 0.209 | 0.226 → 0.223 | 0.246 → 0.239 | 2.833 → 2.403 | 4425.9 → 4490.9 |
| groups150FeedFirstC1 | 1.126 → 1.156 | 1.190 → 1.301 | 1.221 → 1.369 | 2.989 → 1.437 | 881.1 → 857.9 |
| groups150FeedNextC1 | 1.488 → 1.170 | 1.559 → 1.237 | 1.640 → 1.246 | 3.960 → 1.351 | 666.5 → 846.8 |
| groups150FeedWorkingSetC1 | 1.587 → 1.268 | 1.666 → 1.367 | 1.686 → 1.499 | 1.904 → 3.347 | 627.2 → 776.3 |
| groups150PointWorkingSetC8 | 0.345 → 0.347 | 0.417 → 0.420 | 2.696 → 2.555 | 2.795 → 2.632 | 20802.6 → 20760.3 |
| groups150ThreadFirstC8 | 0.557 → 0.500 | 0.796 → 0.720 | 3.908 → 3.693 | 4.018 → 3.794 | 12483.3 → 13890.7 |
| groups150ThreadNextC8 | 0.543 → 0.508 | 0.751 → 0.721 | 2.887 → 2.746 | 3.026 → 3.036 | 13282.9 → 14047.1 |
| groups150FeedFirstC8 | 2.851 → 2.912 | 3.570 → 3.241 | 4.320 → 4.150 | 5.763 → 6.169 | 2692.2 → 2670.5 |
| groups150FeedNextC8 | 3.656 → 2.944 | 4.356 → 3.520 | 5.104 → 5.191 | 6.203 → 5.959 | 2144.5 → 2588.5 |
| groups150FeedWorkingSetC8 | 3.716 → 2.984 | 4.376 → 3.247 | 5.286 → 4.890 | 7.114 → 5.581 | 2092.8 → 2649.1 |

The favorable medians do not erase tail and control-case losses. Feed
continuation has 11 paired p99 and 13 paired maximum losses; p95 and rate
each lose three pairs. In trial 503, 150-group next-page C8 p99 rises
**5.104→12.691 ms** and maximum **5.996→12.812 ms**, even as p50/p95 improve.
Thirty-group next-page C8 median p99 rises **1.678→3.400 ms**. Five-group
thread-first C8 loses p99/max/elapsed/rate in all three pairs, with median
p99 **1.140→3.090 ms**. The 150-group first-page median p50 rises
**1.126→1.156 ms** at C1 and **2.851→2.912 ms** at C8; both rates fall.
All 190 paired losses and 50 median losses across six correlated metrics
remain in the summaries; these counts are not a combined success score.

RSS before/after medians are 10,928/39,440 KiB baseline and 10,960/38,912 KiB
candidate. One paired after snapshot rises 256 KiB. These twelve process
points are not peak, residency, memory-pressure or isolated-allocation proof.
Shared-host one-minute load observations range 13.96–18.91. Full walks and
proofs warm the workload, OS caches were not reset, and background effects
are not isolated. HTTP timers include text/JSON/projection but stop before
the oracle; case rates include oracle/scheduling. No current-package,
competitor, cold-cache, device, write-throughput or durability claim follows.

Independent recomputation agrees with all 1,404 reported run values, 468
medians, 234 median contrasts, 702 paired contrasts, losses/ties and twelve
RSS points. The six appended storage-ledger objects preserve the original
formal result values. Public originals contain **230 files / 492,099 bytes**;
transfer `0af2f0db…`, completion `85a777d8…`, root analysis `a0395355…`,
independent summary `fdbf3550…`, reconciliation `dd34e965…` and
independent review `c1a88176…` bind this record. Supporting files live under
ignored-run prefix `membership-cursor-reuse-0218-http-v2`.

Failure history is retained: unexecuted V1 controls had port-probe and
launcher-supervision findings; controller V2 and launcher V3 resolved them
within three review rounds. After successful smoke, root analyzer V2 wrongly
compared sanitized duplicate text logs with untouched raw JSON. Analyzer V3
checks the exact redaction transform; only four smoke prose occurrences of
“bearer credentials;” changed in duplicate logs. Formal has twelve such
occurrences. Raw data and workload controls never changed. The independent
calculator was frozen after that correction and successful smoke, before its
first formal numerical access; its first formal execution passed unchanged.

The existing [core-owner follow-up](../../../issues/20260914-snapback4-membership-feed-query-cost.md)
stays open. A second-platform replication is the next adoption input; an
Office ARM Linux preflight found the runner idle but only 8,362,958,848 bytes
free on its target, below the older builder's 10 GiB precondition. No Linux
source transfer, build or measurement has started for this candidate.


### Decoded-cursor reuse: fixed 0.2.18 native Linux replication

The same ignored cursor candidate completed a second-platform comparison on
Ubuntu 24.04 / AMD EPYC 9454, native x86_64, at **2026-09-15 08:25:29 UTC**.
Both binaries use fixed source `053a5b288f6a0765e3f640e917e1cb3100244c86`
(0.2.18), Rust 1.97.0, opt-level 3 / fat LTO / one codegen unit / panic abort,
the packaged SQLite flag and MEMSTATUS enabled. Symbols are retained, with
no sampler. Baseline `b9ecc9013ac32ac908c679f124039dae41b98a53b9fa4b94a6e0844b18c230ac`
is 14,645,576 B; candidate
`1bc1a4fdc1cf2d9fcfbaa62e6e9ae63b519324531f4255d98d8c97ba17e1cd8b`
is 14,646,360 B. The runtime overlay is the same `read.rs` (`52046708…`)
as the Darwin experiment: reuse within one eligible merge, with initial
validation, canonical encoding, expression evaluation, meters, authority,
expiry and scope/generation checks preserved. The four differential cases
use the same test overlay (`e3c8d695…`). No core change is adopted here.

The actual native build passed **368 candidate and eight baseline selected
Rust test executions**, including exact full outcome/refusal equality for
same, different, malformed-later and foreign-empty-discovery cursor inputs.
All twelve build stages exited zero. The independent audit rejoined all
37 public build files, the 762 source paths and both retained binary hashes;
this is affected-source qualification, not a full workspace/client suite.
Build receipt `a8b5f59c…`, transfer `b7f1ae17…` and actual review `18c0ee56…`
remain under ignored-run prefix `membership-cursor-reuse-0218-linux-v1`.

The unchanged historical instrument (`ebe5b64d…`) uses ordinary Node 24.21.0 /
Undici 7.29.1 fetch. A fresh Linux setup created the 501-group,
186-membership, 100,000-message fixture and six ordinary seven-day guests;
one became the expired control only after the setup server stopped. The
other five original sessions stayed fixed for all runs. Actual activation
generation is 1. No Darwin database or credentials were transferred.
The reviewed Linux controller (`d8e133db…`) ran excluded smoke B/C at 50
samples, then formal trials 501–503 B/C, C/B, B/C at 500 samples per case.

All **117,000 formal timed requests**, 7,020 excluded warmups and 162 untimed
complete walks / 33,510 pages passed. All 234 case records report zero
errors. Twenty-four full physical proofs agree on all three normalized app
tables, with memberships 186→185→186. Exact feeds/threads, tied order,
invalid/expired auth, cursors, acknowledged leave and same-session regrant
pass. Each run uses a fresh app/server/database copy; leave/regrant occur on
that same live server. All 42 recorded child groups stopped with expected
exits and no cleanup or sanitization errors. The 3,900-request smoke is
excluded, and neither workload was rerun.

All **twelve continuation cases have lower median p50**, with p95 lower in
ten and rate higher in eleven. Paired p50 improves in 29/36 comparisons.
For the 150-group rotating feed at C8, p50 falls **3.292→2.849 ms (13.46%)**,
p95 **4.802→4.134 ms (13.91%)**, and rate rises
**2,214.4→2,659.8 requests/s (20.11%)**. Across all 39 cases, median
p50/p95/p99/maximum improve in 32/27/17/19, and rate in 29. The p50 split
is 32 gains, six losses and one tie. These are medians of three reported
per-run statistics, not pooled request quantiles or significance estimates.
Every table cell is baseline → candidate; latencies are milliseconds.

| Case | p50 | p95 | p99 | Maximum | Requests/s |
|---|---:|---:|---:|---:|---:|
| groups5PointHotC1 | 0.571 → 0.584 | 0.856 → 0.806 | 0.909 → 0.994 | 8.899 → 10.409 | 1588.2 → 1588.8 |
| groups5PointWorkingSetC1 | 0.540 → 0.540 | 0.724 → 0.723 | 0.809 → 0.892 | 9.759 → 8.357 | 1701.4 → 1737.7 |
| groups5PointWorkingSetC8 | 1.242 → 1.235 | 3.465 → 2.786 | 12.638 → 22.241 | 15.214 → 24.891 | 4339.4 → 4455.7 |
| groups5ThreadFirstC1 | 0.778 → 0.729 | 0.986 → 0.957 | 1.376 → 1.380 | 12.621 → 10.788 | 1185.8 → 1221.5 |
| groups5ThreadFirstC8 | 1.493 → 1.495 | 1.918 → 1.916 | 10.127 → 11.054 | 10.500 → 11.671 | 4569.8 → 4695.3 |
| groups5ThreadNextC1 | 0.803 → 0.751 | 1.000 → 0.941 | 1.420 → 1.433 | 4.680 → 4.489 | 1165.5 → 1237.7 |
| groups5ThreadNextC8 | 1.506 → 1.508 | 1.867 → 1.945 | 9.204 → 8.975 | 9.494 → 9.341 | 4661.3 → 4726.5 |
| groups5FeedFirstC1 | 1.022 → 0.843 | 1.182 → 1.246 | 1.755 → 1.642 | 9.045 → 8.547 | 923.0 → 1130.4 |
| groups5FeedFirstC8 | 1.359 → 1.371 | 1.659 → 1.704 | 9.277 → 10.317 | 9.579 → 10.487 | 5179.5 → 5060.5 |
| groups5FeedNextC1 | 1.128 → 1.100 | 1.348 → 1.264 | 1.831 → 1.744 | 7.336 → 7.306 | 867.7 → 868.3 |
| groups5FeedNextC8 | 1.358 → 1.353 | 1.678 → 1.737 | 2.224 → 8.771 | 2.444 → 9.361 | 5565.8 → 5348.7 |
| groups5FeedWorkingSetC1 | 1.260 → 1.104 | 1.430 → 1.543 | 1.992 → 1.981 | 8.774 → 7.888 | 775.3 → 861.0 |
| groups5FeedWorkingSetC8 | 1.373 → 1.356 | 1.852 → 1.809 | 9.788 → 9.884 | 9.903 → 10.555 | 5113.3 → 5185.7 |
| groups30PointHotC1 | 0.501 → 0.477 | 0.698 → 0.651 | 0.938 → 0.830 | 9.911 → 10.229 | 1754.1 → 1816.8 |
| groups30PointWorkingSetC1 | 0.502 → 0.486 | 0.604 → 0.706 | 0.728 → 0.898 | 1.084 → 1.181 | 1923.1 → 1908.4 |
| groups30PointWorkingSetC8 | 1.012 → 1.001 | 2.316 → 2.307 | 8.437 → 9.792 | 8.539 → 10.018 | 5794.7 → 5748.7 |
| groups30ThreadFirstC1 | 0.754 → 0.740 | 0.883 → 1.049 | 1.412 → 1.503 | 8.766 → 9.308 | 1227.3 → 1196.5 |
| groups30ThreadFirstC8 | 1.237 → 1.224 | 1.717 → 1.672 | 9.815 → 9.573 | 10.624 → 10.507 | 5572.7 → 5648.5 |
| groups30ThreadNextC1 | 0.789 → 0.767 | 1.026 → 0.970 | 1.556 → 1.457 | 6.813 → 5.687 | 1173.0 → 1211.8 |
| groups30ThreadNextC8 | 1.241 → 1.234 | 1.501 → 1.659 | 8.041 → 8.905 | 8.844 → 9.624 | 5656.4 → 5614.3 |
| groups30FeedFirstC1 | 1.363 → 1.338 | 1.611 → 1.509 | 2.444 → 2.332 | 2.660 → 8.908 | 715.9 → 725.7 |
| groups30FeedFirstC8 | 1.350 → 1.283 | 2.179 → 2.273 | 2.537 → 8.627 | 2.967 → 8.891 | 5436.9 → 5029.7 |
| groups30FeedNextC1 | 1.503 → 1.390 | 2.231 → 1.973 | 2.766 → 2.472 | 9.100 → 7.976 | 628.9 → 691.7 |
| groups30FeedNextC8 | 1.535 → 1.282 | 2.502 → 2.067 | 8.235 → 8.509 | 8.646 → 8.794 | 4385.9 → 5386.4 |
| groups30FeedWorkingSetC1 | 1.542 → 1.426 | 2.235 → 2.084 | 2.745 → 2.486 | 9.231 → 9.056 | 622.3 → 660.0 |
| groups30FeedWorkingSetC8 | 1.784 → 1.556 | 5.378 → 3.584 | 11.690 → 12.682 | 12.424 → 13.988 | 3581.3 → 3757.6 |
| groups150PointHotC1 | 0.459 → 0.448 | 0.603 → 0.592 | 0.669 → 0.753 | 0.810 → 0.870 | 2065.8 → 2178.8 |
| groups150PointWorkingSetC1 | 0.496 → 0.492 | 0.664 → 0.631 | 0.850 → 0.787 | 6.113 → 5.688 | 1901.2 → 1910.8 |
| groups150PointWorkingSetC8 | 1.016 → 0.991 | 4.443 → 2.400 | 12.428 → 10.386 | 13.333 → 10.692 | 4388.2 → 5367.3 |
| groups150ThreadFirstC1 | 0.745 → 0.740 | 0.909 → 0.934 | 1.299 → 1.384 | 10.228 → 9.307 | 1241.4 → 1275.4 |
| groups150ThreadFirstC8 | 1.223 → 1.217 | 1.596 → 1.505 | 6.777 → 9.451 | 7.278 → 10.127 | 5863.2 → 5736.0 |
| groups150ThreadNextC1 | 0.866 → 0.766 | 1.060 → 0.932 | 1.529 → 1.257 | 6.458 → 6.775 | 1091.9 → 1217.6 |
| groups150ThreadNextC8 | 1.244 → 1.227 | 1.737 → 1.649 | 9.548 → 8.320 | 9.778 → 8.786 | 5391.6 → 5695.2 |
| groups150FeedFirstC1 | 2.520 → 2.606 | 3.678 → 3.844 | 4.383 → 4.431 | 8.286 → 7.995 | 381.3 → 363.0 |
| groups150FeedFirstC8 | 2.511 → 2.530 | 3.550 → 3.567 | 7.441 → 8.146 | 7.857 → 8.941 | 2988.7 → 2930.7 |
| groups150FeedNextC1 | 3.161 → 2.683 | 4.703 → 4.142 | 5.178 → 4.631 | 8.826 → 8.646 | 290.6 → 347.0 |
| groups150FeedNextC8 | 3.100 → 2.600 | 4.040 → 3.652 | 4.738 → 11.260 | 5.938 → 11.824 | 2443.7 → 2787.4 |
| groups150FeedWorkingSetC1 | 3.624 → 3.091 | 5.203 → 4.519 | 5.659 → 4.925 | 6.135 → 5.412 | 253.8 → 299.5 |
| groups150FeedWorkingSetC8 | 3.292 → 2.849 | 4.802 → 4.134 | 11.121 → 4.918 | 12.572 → 5.695 | 2214.4 → 2659.8 |

The tail and control losses remain material. At 150 groups, first-page p50
and rate medians worsen at both C1/C8, as in the Darwin result. Next-page C8
p99 rises **4.738→11.260 ms**, with worse p99 in two of three pairs; its
maximum rises 5.938→11.824 ms. Five-group next-page C8 p95 rises
1.678→1.737 ms, p99 2.224→8.771 ms, and rate falls 5,565.8→5,348.7.
Five-group rotating-page C1 p95 rises 1.430→1.543 ms. Thirty-group
first-page C8 p99 rises 2.537→8.627 ms and rate falls 5,436.9→5,029.7.
All **80 median and 264 paired losses** across six metrics, one median tie
and zero paired ties remain in the independent summary and can be
recomputed from the six full original formal records appended to
`snapback4/metrics/storage.jsonl`. Largest individual case observations are
20.998 ms baseline and 26.730 ms candidate, not median maxima.

Twelve untimed RSS points give before medians 10,288→10,232 KiB and after
medians 29,656→29,916 KiB. Paired after differences are +1,840, +260 and
−3,920 KiB; these are not peaks or isolated cursor-allocation measurements.
Run-start one-minute load observations range 0.815–2.311 on the shared
96-CPU host; no CPU isolation or OS-cache residency measurement was made.
Physical proofs and untimed walks warm inputs. Working-set samples cover
bounded selections, not every possible input; native cache behavior remains.
Rates include whole-case verifier/scheduling work. No current-main,
registry-artifact, competitor, hosted/WAN, cold-cache, realtime, write,
durability, device or memory-pressure claim follows from this fixed A/B.

Both calculators passed unchanged on their first formal executions and
agree on all 1,404 raw metric values, 468 medians, 234 median contrasts,
702 paired contrasts, losses/counts/ties and twelve RSS points. The
independent calculator was frozen **before formal result-file access** at
08:22:22 UTC, after formal launch and the first baseline completion. Its
original freeze record incorrectly said the formal run/data did not exist;
the preserved timing annotation corrects that statement. The pre-freeze
validation wrapper's case-order mismatch is also preserved; the calculator
and arithmetic were unchanged. Formal admission used the successful root
setup/smoke audit and the reviewed controller's own smoke requirement;
the independent setup/smoke audit completed in parallel and passed.

Failure history stays separate: the first source staging attempt timed out
without starting a build, and its first read-only reconciliation could not
read a protected service cwd. The reviewed second observer records narrowly
identified service exclusions without asserting readable cwd or isolation;
reconciled staging, native build, setup, smoke and formal then succeeded.
No unknown process was signaled, no failed workload was substituted, and
credentials/databases stayed remote. No production speedup follows from
those control repairs.

Ignored-run prefix `membership-cursor-reuse-0218-linux-http-v1` retains
230 public formal files / 526,481 B, transfer `617fd603…`, completion
`1f117852…`, root analysis `e0d0097f…`, independent summary `b2755637…`,
and reconciliation `72fe3218…`. The Linux result replicates the continuation
median improvement while preserving substantial tail and first-page
tradeoffs. Core-owner adoption and a current matched competitor comparison
remain open; this evidence landing changes no runtime or package.


### Fixed 0.2.20 membership comparison, trials 231–233

The current-source refresh completed at **2026-09-15 16:52:29 UTC** on
Office ARM Linux / Colima with retained self-hosted Convex and Supabase.
Snapback is fixed committed `68b45b9a92cb73b4cb1b103656d6bdab111a6760`
(0.2.20), qualified production binary `c01cff82…`, 9,063,952 bytes.
All 775 archived source files match, with no overrides; 239 selected Rust
checks passed (122 CLI, 44 core, 49 language and 24 membership). Packaged
SQLite flags and Node 24.21.0 / Undici 7.29.1 are retained. This does not
measure a later main revision or isolate an old-to-new Snapback improvement.

Nine runs use orders S/C/P, C/P/S, P/S/C, 39 cases, 500 samples and 30
excluded warmups per case. All **175,500 timed HTTP calls**, **10,530
warmups**, **243 untimed complete walks / 50,265 traversal pages** and
**36 physical fixture proofs** pass. Every proof checks 501 groups,
100,000 messages and memberships 186→185→186→186 through acknowledged
leave, same-session regrant and final state. Full ordered results, outsider
and empty readers, foreign/old cursors and malformed/tampered/expired auth
checks pass. Main's original `regrantTested=false` is preserved; separate
verify-only records establish regrant and contribute no timed samples.

All 121 registered children have observed group absence: 118 exit zero,
three servers receive their recorded planned TERM and exit -15. All 21
SQL launches have positive Docker-exec completion; no executor remains
unreconciled. Service observations retain the same container/image/StartedAt
bindings. The original failed .19 qualification, failed local production
link, preparation corrections and excluded smoke remain separate failures
or preliminary work, with no replacement result substituted.

Snapback has lower median p50 in **24/39 cases versus Convex and 39/39
versus Supabase**. The corresponding p95 counts are 25/39 and 38/39; p99
21/39 and 34/39; maximum 21/39 and 36/39; requests/s 21/39 and 39/39.
All counts use strict reported-value comparisons, with no ties. These are
medians of three per-run statistics, not pooled distributions or statistical
significance estimates. Against Supabase, same-trial p50 is 115 wins / two
losses, so all median wins do not mean every run won.

Cells below are **Snapback / Convex / Supabase**, latency in milliseconds.
Maximum, elapsed and every per-trial value remain in the nine complete
original objects appended to `snapback4/metrics/storage.jsonl`.

| Case | p50 ms | p95 ms | p99 ms | requests/s |
|---|---:|---:|---:|---:|
| groups5PointHotC1 | 1.178 / 2.987 / 5.385 | 3.001 / 8.897 / 12.280 | 4.288 / 14.142 / 18.066 | 648.0 / 247.0 / 146.6 |
| groups5PointWorkingSetC1 | 1.245 / 8.414 / 5.342 | 3.318 / 20.032 / 11.423 | 6.699 / 29.171 / 24.925 | 607.9 / 108.0 / 157.4 |
| groups5ThreadFirstC1 | 1.540 / 1.921 / 6.664 | 2.259 / 3.029 / 12.415 | 3.054 / 4.103 / 18.578 | 594.8 / 465.0 / 130.4 |
| groups5ThreadNextC1 | 1.642 / 2.416 / 6.662 | 2.431 / 4.782 / 13.083 | 3.014 / 7.640 / 22.220 | 555.2 / 362.4 / 126.0 |
| groups5FeedFirstC1 | 2.100 / 1.680 / 6.585 | 3.278 / 2.631 / 11.055 | 4.956 / 4.059 / 17.271 | 425.4 / 562.4 / 137.7 |
| groups5FeedNextC1 | 1.979 / 1.572 / 6.518 | 2.664 / 2.839 / 13.950 | 2.974 / 5.540 / 23.567 | 479.8 / 552.2 / 127.9 |
| groups5FeedWorkingSetC1 | 2.769 / 3.101 / 6.736 | 6.160 / 8.758 / 9.584 | 8.345 / 15.941 / 12.771 | 304.9 / 252.0 / 140.0 |
| groups5PointWorkingSetC8 | 3.564 / 7.362 / 9.781 | 9.636 / 25.918 / 17.175 | 23.803 / 45.821 / 127.905 | 1725.1 / 796.7 / 764.0 |
| groups5ThreadFirstC8 | 6.599 / 8.973 / 14.096 | 15.624 / 22.583 / 33.682 | 46.950 / 55.649 / 43.159 | 983.8 / 723.5 / 469.8 |
| groups5ThreadNextC8 | 6.572 / 8.504 / 15.154 | 19.736 / 22.892 / 35.644 | 27.543 / 36.763 / 57.192 | 937.3 / 778.3 / 455.9 |
| groups5FeedFirstC8 | 6.462 / 6.948 / 13.608 | 16.954 / 14.388 / 27.453 | 26.135 / 26.264 / 46.146 | 972.7 / 1002.9 / 517.4 |
| groups5FeedNextC8 | 5.742 / 5.762 / 12.481 | 12.391 / 15.823 / 22.328 | 27.174 / 26.781 / 33.228 | 1186.7 / 1200.8 / 587.0 |
| groups5FeedWorkingSetC8 | 5.881 / 4.839 / 12.383 | 15.876 / 14.226 / 22.786 | 32.548 / 30.350 / 32.006 | 1080.2 / 1139.9 / 592.9 |
| groups30PointHotC1 | 1.239 / 1.590 / 3.954 | 3.993 / 2.719 / 5.045 | 12.372 / 4.641 / 5.591 | 475.8 / 569.2 / 245.3 |
| groups30PointWorkingSetC1 | 1.046 / 9.447 / 5.186 | 1.757 / 14.441 / 11.632 | 2.379 / 16.939 / 19.622 | 878.8 / 99.6 / 161.6 |
| groups30ThreadFirstC1 | 1.695 / 2.195 / 6.920 | 2.475 / 4.059 / 15.137 | 3.049 / 6.330 / 25.673 | 534.7 / 385.9 / 120.2 |
| groups30ThreadNextC1 | 1.968 / 2.277 / 6.927 | 3.462 / 4.068 / 13.974 | 5.141 / 6.622 / 21.281 | 430.5 / 386.8 / 121.9 |
| groups30FeedFirstC1 | 2.667 / 2.307 / 7.930 | 5.224 / 6.578 / 12.507 | 10.237 / 8.512 / 17.878 | 324.0 / 330.7 / 114.1 |
| groups30FeedNextC1 | 2.868 / 2.177 / 8.793 | 3.606 / 4.819 / 17.391 | 4.351 / 7.484 / 29.194 | 330.6 / 364.3 / 96.9 |
| groups30FeedWorkingSetC1 | 3.173 / 2.000 / 8.586 | 5.575 / 4.120 / 26.227 | 9.473 / 5.544 / 43.390 | 282.2 / 427.1 / 84.4 |
| groups30PointWorkingSetC8 | 2.883 / 3.533 / 7.148 | 5.805 / 8.186 / 12.493 | 26.558 / 21.102 / 21.681 | 2234.2 / 1878.9 / 1025.3 |
| groups30ThreadFirstC8 | 4.777 / 5.938 / 12.192 | 10.925 / 12.174 / 22.293 | 27.038 / 25.834 / 37.507 | 1348.0 / 1167.3 / 610.8 |
| groups30ThreadNextC8 | 3.965 / 6.282 / 13.110 | 8.396 / 12.522 / 23.029 | 34.049 / 22.388 / 34.731 | 1674.3 / 1124.1 / 561.8 |
| groups30FeedFirstC8 | 6.979 / 4.989 / 19.351 | 15.791 / 10.045 / 36.767 | 36.393 / 17.405 / 47.981 | 963.9 / 1422.1 / 375.4 |
| groups30FeedNextC8 | 11.644 / 5.125 / 19.632 | 39.451 / 9.521 / 40.789 | 56.491 / 13.072 / 59.774 | 534.2 / 1443.9 / 369.4 |
| groups30FeedWorkingSetC8 | 9.186 / 5.416 / 17.417 | 32.904 / 11.629 / 32.220 | 56.486 / 27.804 / 42.631 | 664.5 / 1269.2 / 416.8 |
| groups150PointHotC1 | 0.977 / 1.501 / 4.229 | 2.112 / 3.756 / 6.384 | 3.441 / 6.040 / 9.201 | 828.8 / 535.6 / 229.7 |
| groups150PointWorkingSetC1 | 1.007 / 8.951 / 4.705 | 1.413 / 18.087 / 13.301 | 1.826 / 26.347 / 25.933 | 930.4 / 96.9 / 151.5 |
| groups150ThreadFirstC1 | 1.475 / 1.755 / 6.717 | 2.066 / 3.226 / 9.701 | 2.413 / 4.094 / 14.701 | 604.6 / 491.8 / 135.4 |
| groups150ThreadNextC1 | 1.525 / 1.736 / 7.114 | 2.305 / 2.856 / 12.532 | 2.553 / 3.341 / 19.446 | 580.3 / 504.7 / 121.1 |
| groups150FeedFirstC1 | 5.914 / 2.102 / 13.590 | 9.119 / 3.397 / 23.075 | 13.567 / 4.527 / 31.594 | 155.2 / 442.1 / 62.1 |
| groups150FeedNextC1 | 8.145 / 1.949 / 16.676 | 12.646 / 4.309 / 40.441 | 17.213 / 6.416 / 54.561 | 114.1 / 396.6 / 49.5 |
| groups150FeedWorkingSetC1 | 8.508 / 1.896 / 15.370 | 12.662 / 4.415 / 37.031 | 20.027 / 7.029 / 54.296 | 108.9 / 432.5 / 52.1 |
| groups150PointWorkingSetC8 | 2.637 / 3.800 / 12.098 | 4.453 / 12.138 / 23.597 | 22.881 / 23.559 / 33.072 | 2447.7 / 1639.4 / 612.2 |
| groups150ThreadFirstC8 | 4.622 / 5.917 / 14.018 | 10.770 / 20.536 / 24.953 | 27.970 / 34.344 / 34.997 | 1451.1 / 999.2 / 533.9 |
| groups150ThreadNextC8 | 4.375 / 8.305 / 12.581 | 9.165 / 37.642 / 21.841 | 21.718 / 52.388 / 30.495 | 1564.1 / 631.6 / 595.7 |
| groups150FeedFirstC8 | 16.315 / 5.513 / 39.447 | 29.143 / 14.884 / 84.245 | 38.699 / 34.566 / 101.684 | 452.8 / 1179.6 / 179.2 |
| groups150FeedNextC8 | 21.247 / 4.758 / 43.602 | 36.093 / 9.947 / 95.003 | 48.987 / 32.400 / 118.062 | 357.3 / 1429.8 / 160.7 |
| groups150FeedWorkingSetC8 | 21.460 / 5.006 / 37.504 | 46.503 / 9.273 / 69.682 | 76.443 / 27.765 / 107.669 | 352.0 / 1388.1 / 194.3 |

Large membership feeds remain a clear Convex gap: all twelve 30/150-group
first/next/rotating feed cases lose p50 in all three pairs. The 150-group
next-page C8 medians are 21.247 / 4.758 / 43.602 ms p50 and
357.3 / 1,429.8 / 160.7 requests/s. There are **110 median and 370 paired
metric losses**, all retained and independently recomputed; these are
metric comparisons, not distinct workloads. The
[core-owner issue](../../../issues/20260914-snapback4-membership-feed-query-cost.md)
remains open, including the separately measured cursor-reuse tradeoffs.

Scope: privileged proofs and authorized walks precede repeated reads and
warm inputs; cache residency is unmeasured. Snapback starts fresh processes
from pristine snapshots, while comparator processes persist. Convex regrant
replaces all 186 memberships; Snapback and Supabase restore one membership.
Convex reports serverVersion `unknown`; immutable image/deployment bindings
identify it, with no fresh deployed-source byte proof. Supabase schema/RLS/
policy/index checks retain their limited original assertions, not complete
ACL equivalence. No per-request samples, CPU/RSS, cold-start, hosted/WAN,
write-throughput, realtime, device or matched power-loss-durability claim is
available. This establishes neither a universal ranking nor a causal gain.

Both frozen calculators passed their first actual CLI invocations unchanged.
The independent audit rehashed all 872 public/context files (3,687,594 bytes),
recomputed 2,106 raw metrics and 702 medians, and reconciled 468 median
contrasts and all 1,404 independent same-trial contrasts. Root retains paired
counts and every paired loss rather than a full paired-win array. Original
credential/database/export bytes remain remote; public logs are sanitized.
Ignored-run prefix `membership-current-0220-v1` binds complete `4e5bb86c…`,
formal transfer `9a1d42ac…`, root `8aec8c13…`, independent `807029fe…`,
audit `c9c6880d…` and READY review `11cb1a13…`. This evidence adds no core
adoption, runtime change or new publication.

### Known-length JSON framing: fixed 0.2.20 HTTP A/B — not adopted

The candidate raises tiny_http's chunk threshold above the bounded JSON
response ceiling, so ordinary responses use their known Content-Length; an
explicit chunked preference retains chunk framing. This changes only the
HTTP host and its focused tests. The original framing remains in production.

Six serial warm loopback runs use fixed source `68b45b9a` / 0.2.20 on
Ubuntu 24.04 / AMD EPYC 9454 with Node 24.21.0 / Undici 7.29.1, the
production profile and packaged SQLite flag. Orders are B/C, C/B, B/C.
Each experiment has **9,600 timed requests**, 960 excluded warmups,
192 ordinary-auth captures, 48 complete large-fixture walks and 144
reconstructed page hashes. All assertions pass, all six clients exit zero,
and all twelve server/client groups are absent after planned cleanup. The
original smoke is excluded. These are separate experiments, not comparisons
against Convex or Supabase.

Medians of three per-run statistics, baseline → candidate; latency is ms
and rate is requests/s. C1/C8 denotes concurrency. Each snapshot case
returns its named event count; the stream requested at 4,000 returns 3,584
events because commit groups remain intact.

| Case | p50 | p95 | p99 | Maximum | Rate |
|---|---:|---:|---:|---:|---:|
| snapshot64FirstC1 | 1.608 → 1.493 | 2.468 → 2.584 | 2.980 → 3.105 | 5.655 → 5.012 | 570.726 → 575.334 |
| snapshot64FirstC8 | 5.920 → 5.441 | 10.593 → 10.321 | 14.250 → 15.054 | 18.748 → 19.121 | 1300.382 → 1327.753 |
| snapshot4000FirstC1 | 26.914 → 29.386 | 34.609 → 33.119 | 37.095 → 33.898 | 38.194 → 36.630 | 31.830 → 29.316 |
| snapshot4000FirstC8 | 60.016 → 58.437 | 84.889 → 91.809 | 116.870 → 122.428 | 144.204 → 135.521 | 120.170 → 123.932 |
| snapshot4000NextC1 | 30.101 → 29.777 | 33.316 → 33.627 | 33.736 → 34.563 | 35.125 → 38.124 | 28.419 → 28.600 |
| snapshot4000NextC8 | 59.186 → 58.073 | 79.393 → 77.030 | 101.537 → 93.415 | 114.163 → 111.689 | 124.022 → 129.852 |
| stream4000C1 | 50.215 → 48.131 | 52.966 → 52.175 | 55.093 → 55.099 | 56.051 → 55.900 | 18.017 → 18.664 |
| stream4000C8 | 61.421 → 65.757 | 113.907 → 113.945 | 155.006 → 189.457 | 179.007 → 205.479 | 109.213 → 104.720 |

The concurrent stream loses p50, p99 and rate in every paired run. Its
median p99 rises **155.006 → 189.457 ms (+22.23%)** and rate falls
109.213 → 104.720. Six of eight case-median p50/rates improve, but
the complete record retains **19 median and 55 paired metric losses**.
The large initial C1 snapshot is also slower at p50. The runtime/test
overlay was restored before the next experiment.

Both frozen calculators passed their first formal invocations, and the
independent audit verifies all 229 original public files and reconciles
every raw statistic, median and paired contrast. Full originals, all metric
losses, build qualifications and evidence hashes are retained in the
`json-known-length-0220-v1-perf-formal` storage record. The ignored run
contains the source patch, rejected decision and full review.

Request timing ends after text/JSON parsing; response SHA checks follow the
latency timer and remain inside whole-case elapsed/rate. Concurrent client
callbacks can interfere. All large responses are checked by the bound
producer, but their full bodies are not exported. These descriptive warm
results establish no server CPU/allocation cause, cold-start, hosted/WAN,
current-main, device, realtime, restart, or power-loss durability result.

### Chunk-framing buffer reservation: fixed 0.2.20 HTTP A/B — not adopted

The candidate keeps the original HTTP bytes and reserves eight bytes per
8 KiB body chunk beside the existing 512-byte header allowance. A separate
fixed-header probe verifies 91 byte-identical frame pairs and no candidate
Vec growth. Long reflected Origin headers can still exceed that allowance;
no RSS or peak-memory benefit was measured. This candidate is not adopted.

Six serial warm loopback runs use fixed source `68b45b9a` / 0.2.20 on
Ubuntu 24.04 / AMD EPYC 9454 with Node 24.21.0 / Undici 7.29.1, the
production profile and packaged SQLite flag. Orders are B/C, C/B, B/C.
Each experiment has **9,600 timed requests**, 960 excluded warmups,
192 ordinary-auth captures, 48 complete large-fixture walks and 144
reconstructed page hashes. All assertions pass, all six clients exit zero,
and all twelve server/client groups are absent after planned cleanup. The
original smoke is excluded. These are separate experiments, not comparisons
against Convex or Supabase.

Medians of three per-run statistics, baseline → candidate; latency is ms
and rate is requests/s. C1/C8 denotes concurrency. Each snapshot case
returns its named event count; the stream requested at 4,000 returns 3,584
events because commit groups remain intact.

| Case | p50 | p95 | p99 | Maximum | Rate |
|---|---:|---:|---:|---:|---:|
| snapshot64FirstC1 | 1.689 → 1.739 | 2.873 → 2.783 | 3.255 → 3.289 | 5.032 → 4.782 | 534.920 → 530.031 |
| snapshot64FirstC8 | 5.900 → 5.907 | 10.711 → 11.458 | 16.190 → 17.213 | 19.352 → 23.739 | 1318.452 → 1217.772 |
| snapshot4000FirstC1 | 26.959 → 28.829 | 31.178 → 32.334 | 36.535 → 32.915 | 38.308 → 36.450 | 32.070 → 29.627 |
| snapshot4000FirstC8 | 61.522 → 59.915 | 80.100 → 88.741 | 96.254 → 112.928 | 116.530 → 139.038 | 121.922 → 119.615 |
| snapshot4000NextC1 | 30.592 → 30.381 | 33.894 → 33.509 | 34.978 → 34.379 | 36.851 → 35.323 | 27.491 → 27.708 |
| snapshot4000NextC8 | 60.559 → 58.523 | 78.062 → 77.211 | 103.232 → 99.732 | 109.933 → 107.379 | 126.027 → 125.355 |
| stream4000C1 | 50.300 → 50.494 | 53.240 → 53.932 | 54.115 → 55.691 | 58.427 → 56.115 | 18.074 → 17.888 |
| stream4000C8 | 63.881 → 66.565 | 135.815 → 109.096 | 182.386 → 155.792 | 210.920 → 180.527 | 109.118 → 108.537 |

Seven of eight cases lose median throughput. The concurrent stream loses
p50 and rate in all three pairs, despite better p95 in every pair. Large
initial C8 snapshots improve p50 in every pair, but their median p99 rises
**96.254 → 112.928 ms (+17.32%)**. The large next-page C1 case improves
all six median metrics, with one paired elapsed/rate loss. The record
retains **29 median and 67 paired metric losses**, including small changes;
these counts include elapsed and rate as separate metrics. This runtime
candidate was never applied to the tracked worktree.

Both frozen calculators passed their first formal invocations, and the
independent audit verifies all 229 original public files and reconciles
every raw statistic, median and paired contrast. Full originals, all metric
losses, build qualifications and evidence hashes are retained in the
`json-chunk-capacity-0220-v1-perf-formal` storage record. The ignored run
contains the source patch, rejected decision and full review.

Request timing ends after text/JSON parsing; response SHA checks follow the
latency timer and remain inside whole-case elapsed/rate. Concurrent client
callbacks can interfere. All large responses are checked by the bound
producer, but their full bodies are not exported. These descriptive warm
results establish no server CPU/allocation cause, cold-start, hosted/WAN,
current-main, device, realtime, restart, or power-loss durability result.
The original source-probe compile failure and collector-pin correction
remain preserved separately from the successful qualification. Root
calculator invocation custody is its retained tool result; no separate
original launch/stdout/stderr packet was captured or reconstructed.


### Reuse every successful sync reader: fixed 0.2.22 HTTP A/B — not adopted

The host-only candidate extends the existing bounded query-reader pool to
sync snapshots and streams, returning a reader after the page and separate
acknowledgement transaction succeed. Fresh identity checks, transaction
boundaries, epoch invalidation, response bytes, authentication and ceilings
remain unchanged. The candidate is **not adopted**: small and empty sync
gains come with large-concurrent workload losses and higher process memory
observations. Its source, tests and proposed LLP update remain in the
ignored run; the tracked runtime and governing decision were restored.

Six serial warm loopback runs compare fixed source `788c21d6` / 0.2.22
against that source plus two host files on native Ubuntu 24.04 / AMD EPYC
9454, with Node 24.21.0 / Undici 7.29.1, Rust 1.97.0, the production
profile and packaged SQLite memory-management flag. Orders are B/C, C/B,
B/C; the middle pair reverses case order. Both production qualifications
passed: baseline 152 CLI tests, candidate 153, plus nine HTTP-bound tests
each. The candidate's first test draft had an incorrect event field; that
unexecuted draft remains separate from the corrected, passing qualification.

All **12,000 timed requests**, 1,200 excluded warmups, 192 ordinary-auth
captures, 48 complete owner/reader/outsider and stream walks, and 144
reconstructed page hashes pass. Each of six runs uses fresh ordinary guests
and a fresh store. All six clients exit zero and all twelve server/client
groups are absent after planned cleanup. No restart is exercised. The
320-request smoke is excluded from performance results.

Medians of three per-run statistics, baseline → candidate; latency is ms
and rate is requests/s. C1/C8 denotes concurrency. Each snapshot returns
its named event count; the 4,000-request stream returns 3,584 events at the
fixture's commit boundaries. The empty stream starts at the current watermark.

| Case | p50 | p95 | p99 | Maximum | Rate |
|---|---:|---:|---:|---:|---:|
| snapshot64FirstC1 | 1.600 → 1.052 | 2.706 → 1.394 | 3.018 → 2.050 | 5.128 → 4.667 | 560.495 → 849.891 |
| snapshot64FirstC8 | 5.596 → 2.970 | 9.716 → 6.974 | 16.379 → 11.240 | 22.464 → 13.105 | 1296.330 → 2178.629 |
| snapshot4000FirstC1 | 29.449 → 27.341 | 33.258 → 30.988 | 34.308 → 33.290 | 36.124 → 34.879 | 29.161 → 32.131 |
| snapshot4000FirstC8 | 60.257 → 60.940 | 89.446 → 81.717 | 120.199 → 93.213 | 133.031 → 102.605 | 119.883 → 123.759 |
| snapshot4000NextC1 | 29.727 → 27.634 | 33.226 → 30.948 | 34.444 → 31.741 | 37.482 → 31.952 | 28.990 → 30.229 |
| snapshot4000NextC8 | 57.637 → 58.313 | 77.745 → 84.177 | 87.114 → 88.911 | 99.407 → 100.093 | 128.519 → 126.177 |
| stream4000C1 | 49.878 → 48.216 | 52.996 → 51.374 | 54.848 → 52.496 | 56.823 → 53.434 | 18.217 → 18.635 |
| stream4000C8 | 59.941 → 58.580 | 101.467 → 123.693 | 155.982 → 147.241 | 170.557 → 151.505 | 117.034 → 114.660 |
| streamEmptyC1 | 0.772 → 0.523 | 0.911 → 0.679 | 1.434 → 0.848 | 1.808 → 1.121 | 1236.611 → 1821.825 |
| streamEmptyC8 | 4.387 → 1.372 | 7.773 → 1.667 | 9.267 → 1.823 | 10.946 → 1.886 | 1708.739 → 5733.897 |

Median p50, p95 and throughput improve in 8/10 cases; p99 and maximum in
9/10. Across the 30 same-trial cases, gains are 24/30 for p50 and p95,
26/30 for p99, 22/30 for maximum and 25/30 for throughput. There are no
ties. The complete record retains **10 median and 34 paired metric losses**,
counting elapsed time and its correlated rate separately.

Empty-stream C8 p50 falls **4.387 → 1.372 ms** and rate rises
1,708.739 → 5,733.897 requests/s. The large next-snapshot C8 case loses
all six median metrics: p95 **77.745 → 84.177 ms (+8.27%)**, with rate
−1.82%. Large-stream C8 p95 rises **101.467 → 123.693 ms (+21.90%)**
and rate falls 2.03%. Initial large-snapshot C8 p50 also rises 1.13%.
These losses are mixed across pairs; the medians are descriptive, not
statistical significance estimates or a uniform-win claim.

Two untimed process measurements per run occur after fixture preparation
and full walks, then after repeated cases and before the final walks.
Values below are medians of three process points in KiB:

| Phase | Baseline RSS | Candidate RSS | Baseline lifetime HWM | Candidate lifetime HWM |
|---|---:|---:|---:|---:|
| Before cases | 22,020 | 23,324 | 24,780 | 25,896 |
| After cases | 104,748 | 194,760 | 129,488 | 204,416 |

After-case RSS rises **90,012 KiB (87.90 MiB)** and lifetime HWM rises
74,928 KiB; both are higher in every pair. PIDs and process start ticks are
bound before and after each observation. These are process points and
lifetime high-water marks, not continuous peak sampling or isolated reader
allocation. They do not identify the source of the additional memory. The
[existing sync follow-up](../../../issues/20260914-snapback4-sync-concurrent-tail-latency.md)
now includes this unresolved tradeoff.

Both frozen calculators pass their first original formal invocations, with
actual child launch, stdout, stderr and exit receipts. Their original
reconciliation agrees on 360 raw values, 120 medians, 180 paired contrasts
and all 12 memory points. Full originals, every loss, qualifications and
evidence hashes are retained in the `sync-reader-reuse-0222-v1-perf-formal`
storage record. A stale formal-wrapper stage pin was corrected before its
first execution; the original wrapper remains. Formal launch followed the
successful frozen executable smoke audit and preceded the final manual
smoke-admission narrative; that chronology is retained.

Latency ends after HTTP/text/JSON parsing; full-response hashing follows
the timer but remains inside case elapsed/rate and can delay overlapping
callbacks. Walks prepare inputs, and sequential warmups do not establish
eight warm connections. The producer checks every full response; public
exports retain exact reconstructed reference hashes rather than all large
wire bodies. These results establish no cold-cache, hosted/WAN, concurrent
query-load, device/realtime, comparator, publication or power-loss durability
claim. Follow-up work must distinguish connection-retained state from
allocator retention and overlapping response work before attributing RSS.


### Sync reader reuse with cache cleanup: fixed 0.2.22 HTTP A/B — not adopted

The second pooling variant flushes prepared statements and releases the
reader's SQLite caches after successful sync and acknowledgement transactions,
before returning the connection to the existing pool. Cleanup runs outside
host locks; a cleanup failure discards the connection without changing the
successful response. Snapshot/stream bytes, fresh authorization, transaction
boundaries, fallback, epoch invalidation and ceilings remain unchanged.
The candidate is **not adopted**: retained memory and large concurrent
regressions remain. Its two source files and patch are preserved in the
ignored ship run; the tracked runtime was never changed.

The fixed source, native Linux host, production profile, packaged SQLite
flag, Node version and ten cases match the preceding experimental design.
This is a new six-run baseline/candidate batch, ordered B/C, C/B, B/C,
with the middle pair reversing case order. The candidate passes 153 CLI
tests and nine HTTP-bound tests; the immutable qualified baseline is reused.
All **12,000 timed calls**, 1,200 excluded warmups, 192 ordinary-auth
captures, 48 full walks and 144 reconstructed page hashes pass. Each run
uses a fresh store and ordinary guests. All server/client groups stop.
Smoke is excluded from the following medians of three per-run statistics.
Latency is ms and rate is requests/s; C1/C8 denotes concurrency.

| Case | p50 | p95 | p99 | Maximum | Rate |
|---|---:|---:|---:|---:|---:|
| snapshot64FirstC1 | 1.543 → 1.149 | 2.524 → 1.557 | 2.986 → 2.443 | 4.141 → 3.667 | 575.890 → 787.104 |
| snapshot64FirstC8 | 5.452 → 2.891 | 10.050 → 7.347 | 13.486 → 12.418 | 22.303 → 13.620 | 1358.037 → 2343.806 |
| snapshot4000FirstC1 | 29.251 → 28.517 | 33.194 → 32.234 | 35.608 → 33.390 | 39.112 → 36.595 | 29.650 → 30.219 |
| snapshot4000FirstC8 | 62.254 → 60.412 | 85.851 → 82.946 | 140.246 → 95.987 | 154.985 → 108.982 | 120.171 → 123.161 |
| snapshot4000NextC1 | 30.500 → 29.070 | 33.261 → 31.615 | 34.049 → 32.313 | 37.455 → 34.113 | 27.644 → 28.869 |
| snapshot4000NextC8 | 59.267 → 60.830 | 77.647 → 79.236 | 95.072 → 91.393 | 107.503 → 108.874 | 127.091 → 128.366 |
| stream4000C1 | 50.135 → 49.224 | 53.186 → 52.110 | 54.294 → 53.019 | 55.630 → 57.448 | 18.228 → 18.443 |
| stream4000C8 | 62.549 → 62.670 | 114.823 → 116.001 | 160.484 → 165.889 | 182.145 → 181.481 | 110.789 → 109.913 |
| streamEmptyC1 | 0.830 → 0.561 | 1.065 → 0.732 | 1.529 → 0.906 | 1.789 → 1.030 | 1136.892 → 1680.555 |
| streamEmptyC8 | 4.060 → 1.365 | 7.549 → 2.114 | 8.990 → 2.791 | 9.692 → 3.048 | 1806.557 → 5461.496 |

Empty-stream C8 median p50 falls **4.060 → 1.365 ms** and rate rises
**1,806.557 → 5,461.496 requests/s**. Large next-snapshot C8 p50, p95
and maximum regress; large-stream C8 p50, p95, p99 and rate regress.
The original calculations retain **nine median and 27 paired metric
losses**, counting elapsed and correlated rate separately. No loss is
removed because it is small, and medians imply no statistical significance.

Two untimed observations per process follow preparation/full walks and then
the repeated cases, before final walks. Medians below are KiB.

| Phase | Baseline RSS | Candidate RSS | Baseline reported VmHWM | Candidate reported VmHWM |
|---|---:|---:|---:|---:|
| Before cases | 22,024 | 20,204 | 25,204 | 25,060 |
| After cases | 83,064 | 150,112 | 123,560 | 181,180 |

After-case RSS rises **67,048 KiB (65.48 MiB)** in medians. Two paired
RSS observations rise and one falls by 428 KiB; all three reported VmHWM
observations rise. These process points do not isolate pool allocation or
measure continuous peaks. The preceding native allocation diagnostic
observed same-process VmHWM decreases, so reported VmHWM is retained as
observed rather than treated as a validated monotonic peak. That limit also
qualifies the preceding record’s lifetime-HWM wording. Separate first- and
second-variant batches do not establish that cleanup caused an RSS reduction.

Both original frozen calculators pass and reconcile 360 raw values, 120
medians, 180 paired contrasts and all 12 resource points. The bounded final
independent review verifies original completion, collection and invocation
joins without rerunning the arithmetic. All 229 public originals and all
losses are retained in storage workload `sync-reader-reuse-0222-v3-perf-formal`.
The actual qualification, smoke, formal and review chronology is preserved,
including local audit-parser and pre-execution metadata corrections; none
is relabeled as a workload failure or used to justify a measurement rerun.

Latency includes HTTP/text/JSON parsing; full-response hashing follows the
timer but stays inside case elapsed/rate and can interfere across clients.
The shared query/sync pool could also displace query-warmed state; a mixed
query/sync test would be required before adopting a promising variant.
This sync-only screen already fails. It establishes no new comparator,
current-main, cold-start, device/realtime, restart or durability result.
The [sync follow-up](../../../issues/20260914-snapback4-sync-concurrent-tail-latency.md)
remains open. One optimization round remains; a candidate restricted to
already-caught-up empty polls has not yet been written or measured.


### Caught-up empty-sync reader reuse: final variant, still unshipped (2026-09-15)

The third runtime variant restricts reuse to stream requests whose starting
watermark matches the host's current sequence hint. It returns the loan only
when the fresh response succeeds, contains no events or joined groups, has
no more pages, and leaves that watermark unchanged. Other sync readers are
fresh or discarded. Query reuse and the existing 32-reader bound remain.
Transactions, viewer checks, acknowledgements and pool epochs are evaluated
as before; the hint does not cache a response or an authorization decision.

Six original serial runs compare fixed source 788c21d6 / 0.2.22 with this
host-only change. Retained production binaries are baseline `3d9b8315…`
and candidate `22976be7…`. The Ubuntu 24.04 / AMD EPYC 9454 host, Rust
1.97.0 production profile, packaged SQLite build flag, enabled MEMSTATUS,
and Node 24.21.0 / Undici 7.29.1 match the preceding fixed-source protocol.
Orders are B/C, C/B, B/C, with reversed case order in the middle pair.
All 12,000 timed calls, 1,200 excluded warmups, 192 ordinary-auth captures,
48 complete walks and 144 reconstructed page hashes pass. Original clients
exit zero; each recorded server receives its planned TERM and its group
is observed absent. The separate 320-call smoke is excluded below.

Medians of three per-run statistics follow, baseline → candidate.
Latency is ms; C1/C8 denotes concurrency. Requested-4,000 streams return
3,584 events at this fixture's commit boundaries.

| Case | p50 | p95 | p99 | Maximum | Requests/s |
|---|---:|---:|---:|---:|---:|
| snapshot64FirstC1 | 1.426 → 1.420 | 2.374 → 2.261 | 2.897 → 2.775 | 4.702 → 4.775 | 626.313 → 648.760 |
| snapshot64FirstC8 | 5.493 → 5.541 | 9.595 → 11.041 | 19.271 → 30.733 | 24.442 → 31.828 | 1319.513 → 1234.021 |
| snapshot4000FirstC1 | 27.847 → 29.319 | 31.904 → 36.594 | 33.813 → 37.450 | 34.214 → 38.242 | 31.023 → 29.151 |
| snapshot4000FirstC8 | 61.310 → 62.359 | 86.398 → 84.801 | 124.027 → 123.613 | 149.607 → 132.728 | 120.531 → 118.899 |
| snapshot4000NextC1 | 30.280 → 30.276 | 33.086 → 33.070 | 34.014 → 34.425 | 36.836 → 35.252 | 28.106 → 28.012 |
| snapshot4000NextC8 | 60.277 → 59.908 | 79.467 → 80.781 | 103.498 → 98.115 | 118.042 → 113.658 | 124.593 → 125.446 |
| stream4000C1 | 50.649 → 50.406 | 53.401 → 53.844 | 55.402 → 56.300 | 57.683 → 57.922 | 17.913 → 18.026 |
| stream4000C8 | 65.737 → 64.891 | 126.273 → 96.901 | 182.667 → 167.705 | 199.613 → 182.106 | 106.391 → 106.060 |
| streamEmptyC1 | 0.771 → 0.511 | 1.238 → 0.692 | 1.605 → 0.936 | 1.921 → 1.185 | 1196.859 → 1845.511 |
| streamEmptyC8 | 4.091 → 1.382 | 7.608 → 2.247 | 10.024 → 3.150 | 10.719 → 5.109 | 1791.456 → 5322.631 |

Empty-stream C8 p50 improves 4.091 → 1.382 ms, with rate 1,791.456 →
5,322.631 requests/s. Both empty cases improve p50/p95/rate in all three
pairs. First-4,000-snapshot C1 p50/p95/rate worsen in all three pairs;
its median p50 rises 5.29% and p95 14.70%. Small-snapshot C8 rate also
worsens in all three pairs, with median p99 rising 59.48%. All **25 median
and 79 paired metric losses** remain, counting elapsed and correlated rate
separately. The unchanged snapshot code does not establish that these
observed differences are noise or identify their cause.

Two untimed observations per process follow preparation/full walks and then
the repeated cases, before final walks. Medians below are KiB.

| Phase | Baseline RSS | Candidate RSS | Baseline reported VmHWM | Candidate reported VmHWM |
|---|---:|---:|---:|---:|
| before-cases | 22,016 | 22,332 | 25,840 | 26,324 |
| after-cases | 126,228 | 96,348 | 141,864 | 138,904 |

After-case RSS paired differences are −29,880, +4,528 and −28,284 KiB.
The earlier variants' large RSS increase does not repeat in these points,
but they establish neither causal memory reduction nor continuous peaks.
Reported VmHWM retains its previously documented measurement limits.

The candidate's original production build and 153 CLI tests pass; its
wrapper then fails on a stale required-test name. A separate continuation
preserves that failure, reuses the exact build/test records and binary,
and runs only the version check and nine HTTP-bound tests, all passing.
The original root smoke calculation also stops on a stale loader hash;
one literal is corrected with arithmetic unchanged. The first corrected
root calculation and unchanged independent calculation reconcile all
360 formal raw values, 120 medians, 180 paired contrasts and 12 resource
points. No workload or independent-calculator rerun replaces an outcome.
Formal completion is `b6e1328e…`, transfer `44b2c1dd…`, and independent
final review `ba95887a…`; the full originals and bindings are in storage
workload `sync-reader-reuse-0222-v4-perf-formal`.

A subsequent, separate host test passes for logical membership expiry
before the physical sweep: an ordinary viewer receives a scope revocation
at the same watermark, keeps only its own acknowledgements, and the
nonempty response discards the borrowed reader. Fresh reads hide expired
rows while a second viewer stays authorized; after logout, Alice's next
poll is refused. This uses the existing test host's development
clock and real HTTP handler on file-backed SQLite. It adds one test to the
unchanged candidate runtime; it is not a production-binary latency or
expiry-memory measurement. All 792 source inputs and the retained measured
binary are rechecked. The original one-test receipt is `de209c31…`.

The candidate remains **unshipped**. Snapshot regressions remain in the
[sync follow-up](../../../issues/20260914-snapback4-sync-concurrent-tail-latency.md).
Mixed query/sync traffic and expiring-audience retained-memory measurements
are still pending before any adoption decision. This is the third runtime
variant; further runtime revisions are outside this completed fix loop.
HTTP/text/JSON parsing ends the latency timer; response hashing follows it
but remains in case rates and can interfere across concurrent callbacks.
The fixture is warm, with no cache reset or CPU isolation. This screen
makes no new comparator, current-main, cold-start, device/realtime,
restart, durability or publication claim.


### Mixed queries and empty polls: final pooling variant not adopted (2026-09-16)

The unchanged third/final runtime candidate was measured on fixed
`788c21d6` / 0.2.22, using the same retained native x86 Linux baseline and
candidate binaries as the preceding sync screen. The Ubuntu 24.04 / AMD
EPYC 9454 host, production profile, packaged SQLite flag, MEMSTATUS and
Node 24.21.0 / Undici 7.29.1 are unchanged. No runtime revision is part of
this experiment. It does not measure the subsequently published 0.2.23.

All six original runs completed in B/C, C/B, B/C order. Each fresh store
uses three ordinary guests and the existing two-group fixture with 8,192
bulk messages per group. Owner/reader/outsider views have 16,462/8,231/0
rows. Exact auth, edit/delete, leave/regrant, own-acknowledgement and
complete snapshot/stream checks pass. The mixed instrument adds point,
first-page and real-cursor continuation proofs, exact dependency tables,
viewer/sequence/completeness/expiry metadata and hidden/missing controls.
After timing, an acknowledged ordinary edit changes a held row; fresh
point/page reads and changed/empty polls reflect it, with outsider exclusion.

Per run, there are 20 groups and 24 per-operation cases, each with 512
timed requests. Solo point/page/poll controls use C4/C8/C16/C32. Mixed
point+poll and page+poll groups use total C8/C32, half each operation, and
are immediately followed by a matched query-only C4/C16 probe with no
additional warmup. Other groups have two full-concurrency warmup waves.
Equal-width waves wait at a barrier, alternate the first-issued operation,
and keep equal operation counts throughout. The middle pair reverses
block order while retaining mixed/post-probe adjacency.

All **73,728 timed requests and 3,120 excluded warmups** pass, alongside
192 ordinary-auth captures, 48 complete large walks, 144 reconstructed
full-page hashes, 162 query proofs and 24 freshness proofs. All six client
processes and launch-recorded server groups terminate as planned. No
actual process-restart workload is claimed. The excluded smoke passed
3,072 requests and 1,040 warmups before formal admission.

Cells are baseline → candidate medians of three per-run statistics.
Latency is milliseconds, with nearest-rank percentiles. Rates are
requests/s, using each whole group interval including response hashes and
scheduling. Both mixed operations share that interval and equal counts,
so their identical rates are by construction, not independent saturation.

| Case / operation | p50 | p95 | p99 | Maximum | Requests/s |
|---|---:|---:|---:|---:|---:|
| pointOnlyC4/point | 0.755 → 0.774 | 1.058 → 1.130 | 1.273 → 1.711 | 5.038 → 5.207 | 3516.7 → 3411.9 |
| pageOnlyC4/page | 0.887 → 0.902 | 1.201 → 1.280 | 1.733 → 1.870 | 8.082 → 6.239 | 3152.4 → 3086.5 |
| pollOnlyC4/poll | 1.540 → 0.512 | 2.073 → 0.630 | 2.375 → 1.087 | 5.801 → 5.183 | 2027.3 → 5455.4 |
| pointOnlyC8/point | 0.725 → 0.703 | 1.360 → 0.975 | 7.262 → 7.371 | 7.660 → 7.595 | 6391.3 → 6797.2 |
| pageOnlyC8/page | 1.171 → 1.156 | 1.853 → 1.537 | 10.571 → 10.058 | 11.248 → 10.589 | 3863.0 → 4033.1 |
| pollOnlyC8/poll | 2.916 → 0.667 | 3.907 → 0.800 | 4.336 → 0.967 | 4.566 → 1.053 | 2059.2 → 7891.4 |
| pointOnlyC16/point | 1.264 → 1.257 | 2.455 → 1.711 | 10.518 → 8.068 | 14.960 → 10.636 | 5846.6 → 6437.2 |
| pageOnlyC16/page | 1.792 → 1.784 | 6.888 → 2.859 | 11.323 → 10.118 | 11.870 → 10.543 | 4631.1 → 4774.6 |
| pollOnlyC16/poll | 5.352 → 1.153 | 8.294 → 1.302 | 8.955 → 1.519 | 9.668 → 1.755 | 1878.1 → 9002.8 |
| pointOnlyC32/point | 2.416 → 2.376 | 19.397 → 12.528 | 19.753 → 13.578 | 19.841 → 13.675 | 6038.5 → 7196.9 |
| pageOnlyC32/page | 3.484 → 3.888 | 12.627 → 11.425 | 13.940 → 13.021 | 14.752 → 13.354 | 4456.8 → 4411.6 |
| pollOnlyC32/poll | 10.302 → 2.133 | 17.326 → 6.418 | 18.714 → 6.985 | 19.395 → 7.162 | 1727.5 → 9137.4 |
| pointPollMixedC8/point | 0.929 → 0.706 | 1.429 → 0.852 | 5.267 → 8.346 | 9.510 → 8.987 | 2075.0 → 3507.9 |
| pointPollMixedC8/poll | 1.387 → 0.658 | 2.010 → 0.828 | 5.574 → 8.564 | 9.668 → 9.070 | 2075.0 → 3507.9 |
| pointPostMixedC4/point | 0.497 → 0.495 | 0.588 → 0.574 | 0.757 → 0.980 | 1.209 → 9.173 | 5943.7 → 5440.3 |
| pagePollMixedC8/page | 1.159 → 0.931 | 1.787 → 1.155 | 5.221 → 7.060 | 9.357 → 9.046 | 1895.3 → 2843.1 |
| pagePollMixedC8/poll | 1.477 → 0.595 | 2.159 → 0.879 | 8.129 → 1.531 | 9.765 → 8.005 | 1895.3 → 2843.1 |
| pagePostMixedC4/page | 0.800 → 0.788 | 1.086 → 0.926 | 1.727 → 1.178 | 8.182 → 7.125 | 3360.4 → 3643.4 |
| pointPollMixedC32/point | 3.937 → 2.279 | 7.153 → 2.897 | 13.400 → 10.899 | 14.000 → 11.960 | 1924.8 → 3675.7 |
| pointPollMixedC32/poll | 5.037 → 2.250 | 8.392 → 2.940 | 13.920 → 10.831 | 14.867 → 11.596 | 1924.8 → 3675.7 |
| pointPostMixedC16/point | 1.048 → 1.127 | 1.353 → 1.583 | 1.720 → 11.927 | 1.988 → 12.138 | 8593.6 → 7763.0 |
| pagePollMixedC32/page | 4.713 → 2.735 | 10.779 → 7.763 | 12.929 → 11.603 | 14.176 → 11.958 | 1821.0 → 3402.1 |
| pagePollMixedC32/poll | 5.528 → 2.322 | 11.861 → 6.551 | 14.375 → 11.138 | 15.047 → 11.620 | 1821.0 → 3402.1 |
| pagePostMixedC16/page | 1.728 → 1.812 | 7.106 → 10.613 | 8.340 → 21.243 | 8.630 → 21.524 | 4942.2 → 4434.0 |

The mixed C32 point and page gains coexist with consistent immediate
post-mixed C16 losses. Both post-probes lose all six median metrics, and
their p50/rate worsen in every pair. Point p99 rises 1.720 → 11.927 ms
and page p99 8.340 → 21.243 ms; rates decline 9.67% and 10.28%. Mixed
C8 point/query-poll p99 and other solo-query/paired tails also regress.
All **34 median and 120 paired metric losses** remain in the record,
including elapsed time and rate as separate correlated metrics.

The 132 untimed, PID/start-time-bound resource points cover before, after
every group and after the cases. Before-case RSS medians are
20,808 → 20,832 KiB; after-case medians are 40,532 → 33,564 KiB. Final
candidate RSS is lower in each pair, while some intermediate points rise.
These observations do not isolate pool allocation, prove cache displacement,
show causal memory reduction or establish continuous peak memory. Reported
VmHWM retains the previously documented diagnostic qualification.

Both frozen calculators pass on their first formal invocations. Saved
results reconcile 864 raw metric values, 288 medians, 576 contrast records,
132 resource points and 88 resource medians. The original 229 public files
(12,229,276 bytes), every raw timing vector and all gains/losses are retained
in storage workload `mixed-reader-reuse-0222-v4-v2-formal`. Completion
`e4293592…`, transfer `9521a8bb…`, agreement `ae1b937a…` and independent
review `a3d607f0…` bind the record. The staged-only first instrument and
all pre-data draft corrections are preserved; no formal workload reran.

**The candidate is not adopted.** This ends the three-round pooling
optimization effort; candidate source stays recoverable in the ignored
run. The original snapshot losses remain, and the
[sync tail follow-up](../../../issues/20260914-snapback4-sync-concurrent-tail-latency.md)
stays open. The conditional expiry-memory experiment is not run because
these measured query/snapshot tradeoffs already leave adoption unsupported.
The separate same-watermark expiry correctness result still stands.

This is a warm loopback, finite-wave test of hot points and first pages,
not a rotating query working set or continuous-arrival load. HTTP/text/JSON
parsing ends the latency timer; response hashing follows it but can delay
overlapping client callbacks. Client operation windows do not measure
server concurrency or pool occupancy. No current-main, competitor,
hosted/WAN, cold-start, device/realtime, durability or publication claim
follows. Core/store/contract ownership and the existing runtime remain
unchanged.
