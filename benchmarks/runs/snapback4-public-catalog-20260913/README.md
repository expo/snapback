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
