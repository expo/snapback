# G7.0 — write-pipelining arms on one host

The experiment measures the real S1 W4 SQL tail with a populated commit index. These are SQL-harness bounds; Quarry execution, HTTP ingress, G5/G6 publication gates and product recovery protocols are not implemented by the arms. No product code changes.

## Verdict at 32 clients

| Arm | A: open-loop client mean ms | ≤7.07 ms + SLO? | B: open-loop client mean ms | ≤14.15 ms + SLO? |
|---|---:|---|---:|---|
| serial | 12.11–14.63 | no | 14.66–16.78 | no |
| S | 8.59–8.74 | no | 13.42–13.49 | yes |
| E1 | 8.04–8.22 | no | 13.15–13.19 | yes |
| E2 | 7.01–7.03 | yes | 10.95–11.08 | yes |
| C | 6.93–6.94 | yes | 10.52–10.65 | yes |

Each range spans the three 10s/20s open-loop confirmations at 4,525/s A or 2,262/s B, using the strongest short-matrix configuration for that arm/link. Client residence includes batching and queueing after admission to the 32-client population; intended-time generator backlog is reported separately below. A yes requires every repetition’s client mean to meet the bound, write p99 ≤100 ms, errors ≤0.1%, and the offered rate to be delivered. This is a SQL-harness result, not a Snapback S1 capacity win. The short saturation matrix alone is insufficient: its serial B estimate does not survive the longer rung confirmation.

S remains near one WAL sync per batch and misses A. E2 reaches both targets while its best N=16 cells still use roughly one sync per batch: overlapping the next tail with the durable marker flush is the gain. C demonstrates flush sharing at N=8 with four active writers, but its fastest N=16 cells also use roughly one sync per batch.

## Method and custody

- Host: expo-build-450b, OS hostname `expose-builder-pixel-a`, Ryzen 5 3600, six physical/twelve logical CPUs. PostgreSQL: `0–2,6–8`; harness writer slots and the existing delayed proxy: `3–4,9–10`; client scheduler: `5,11`.
- PostgreSQL 16.15, inherited `scale-controls/postgresql.conf.delta`: fsync/full_page_writes on, fdatasync, commit_delay 0, 8 GiB shared buffers. S/C are synchronous; E disables synchronous commit only in the batch transaction and acknowledges after its following synchronous marker transaction.
- Link A adds 250 µs/direction; B adds 500 µs/direction through the unchanged one-host Unix proxy. RTT captures bracket each block. The inherited unrelated-process start gate runs before every measured repetition.
- Fixed N=8/16/32, 32 disjoint counter clients. Effective simultaneous batches are `min(depth, connections, 32/N)`. Thus N=32 has one active batch even with additional connections; E1 and serial always have one. All requested nominal connections are actually open.
- Primary matrix: 90 configurations × three 1 s warm-up/4 s measured repetitions. Strongest configurations receive three 10 s/20 s open-loop confirmations at the registered strict-win rung; these are additional trials, not replacements. One-log-row sensitivity covers each N using that N’s strongest primary connection configuration.
- Rates, mean and p50 are medians across repetitions; p99 is the worst repetition. Sync/batch is the summed private-cluster WAL sync delta divided by summed batches over warm-up+measurement+drain. It includes background WAL work; values slightly above one do not imply two batch flushes. CPU columns are sampled logical CPU usage for PG / harness writers+proxy / client over the whole trial; the app column also includes Python controller/sampler overhead.

The fixture compiles the actual S1 schema and seeds parents/counters plus the first 1,000 messages through `Engine::seed_at`. Immutable background messages use the product’s canonical row and index encoders and binary COPY; eight native seed rows and all their index keys are checked for exact parity. Room/user totals are set to the S1 values. Internal maintained contribution state is not reconstructed for the bulk-loaded background and is never read by W4. The fixture is a W4 SQL image, not a read-workload qualification. It uses synthetic account-session facts and a static owner row; periodic lease traffic and HTTP ingress resolution are absent.

One million contiguous historical `_commits` rows are retained using an actual seed-commit template; measured sequences/revisions begin above 1,000,000. The 1,000-row evidence window is restored between trials. Only measured rows are removed; `_commits` is vacuumed/analyzed and checkpointed before each trial. An earlier exploratory matrix that emptied the commit table is excluded and retained outside Git. Pre-campaign smokes also caught the required evaluation-schema prefix, a missing ping database environment variable, and an incorrect assumption that online-only W4 emits log rows. The initial row-at-a-time background seed was cancelled before timing and replaced with codec-based COPY. These setup/smoke attempts are archived; none replaces a final primary repetition.

## Arm definitions

- **serial:** six-flight model of the serial G6 SQL shape: owner opener, head lock, composed facts, vector apply/tail, publication witness, separate synchronous COMMIT. The model omits the initial duplicate first-member authority lookup and times its own encode work, not the production committer’s interpreter/closure/receipt work; the archived native phase ledger remains the production baseline.
- **S:** depth two, fused owner/ticket/facts, then predecessor ticket wait and fresh head+revision CAS, vector tail and folded publication; client validates counts before a separate synchronous COMMIT.
- **E1/E2:** fused opener/facts; predecessor ticket wait/CAS and the same vector tail; `COMMIT` with local synchronous_commit off immediately followed in the same message by `BEGIN; SET LOCAL synchronous_commit=on; UPDATE _durable SET n=n+1 WHERE slot=...; COMMIT`. Only the final completion acknowledges the batch. Durable slots are disjoint across writer connections.
- **C:** independent disjoint batches, preassigned ranges, synchronous commit on. The tail’s head CTE becomes a constant range witness and the singleton revision update is omitted. Other tail CTEs and owner key-share remain. It has no visibility/publication protocol.

S/E use disjoint evidence-pruning ranges and a head/revision CAS. C also uses disjoint pruning ranges, avoiding a shared delete hot spot. Tail counts are checked, with a server-side commit-count assertion before any co-dispatched COMMIT. The original vector SQL, authority/facts and level SQL are imported from product source; no product file is edited. W4 has zero dependent-level flights.

**Actual S1 W4 emits zero `_log` rows**: counters are `online only`, and templates captured from real `Engine::mutate` invocations contain an empty log vector. The `_log` CTE still executes. The separate sensitivity below adds one log row per write rather than silently changing the primary workload. Unkeyed W4 also has no `_ops` receipt rows or effects.

## Complete primary matrix

| Arm | Link | N | Conn. / active | Writes/s | Mean ms | p50 ms | p99 ms | Sync/batch | CPU PG/app/client |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| C | A | 8 | 2/2 | 2840 | 11.27 | 11.10 | 16.46 | 1.002 | 0.55/0.48/0.03 |
| C | A | 16 | 2/2 | 5056 | 6.33 | 6.23 | 9.70 | 1.003 | 0.68/0.49/0.03 |
| C | A | 32 | 2/1 | 4136 | 7.74 | 7.69 | 10.00 | 1.014 | 0.45/0.38/0.01 |
| C | B | 8 | 2/2 | 2492 | 12.85 | 12.78 | 15.56 | 1.002 | 0.48/0.46/0.03 |
| C | B | 16 | 2/2 | 4256 | 7.52 | 7.25 | 19.92 | 1.003 | 0.57/0.47/0.02 |
| C | B | 32 | 2/1 | 3640 | 8.78 | 8.73 | 11.12 | 1.008 | 0.37/0.37/0.01 |
| C | A | 8 | 3/3 | 3148 | 10.16 | 10.52 | 24.81 | 0.937 | 0.63/0.52/0.03 |
| C | A | 16 | 3/2 | 4976 | 6.43 | 6.19 | 9.81 | 1.005 | 0.66/0.50/0.04 |
| C | A | 32 | 3/1 | 4160 | 7.70 | 7.61 | 10.08 | 1.014 | 0.44/0.39/0.01 |
| C | B | 8 | 3/3 | 3066 | 10.44 | 10.43 | 13.33 | 0.981 | 0.63/0.52/0.02 |
| C | B | 16 | 3/2 | 4360 | 7.34 | 7.18 | 10.25 | 1.004 | 0.59/0.48/0.02 |
| C | B | 32 | 3/1 | 3632 | 8.81 | 8.73 | 10.94 | 1.011 | 0.38/0.37/0.01 |
| C | A | 8 | 4/4 | 4136 | 7.74 | 7.78 | 19.81 | 0.705 | 0.89/0.61/0.04 |
| C | A | 16 | 4/2 | 4928 | 6.50 | 6.28 | 9.98 | 1.004 | 0.67/0.49/0.02 |
| C | A | 32 | 4/1 | 4152 | 7.71 | 7.62 | 9.59 | 1.017 | 0.44/0.39/0.01 |
| C | B | 8 | 4/4 | 4028 | 7.95 | 7.89 | 11.88 | 0.742 | 0.86/0.61/0.04 |
| C | B | 16 | 4/2 | 4432 | 7.22 | 7.14 | 10.12 | 1.005 | 0.58/0.48/0.02 |
| C | B | 32 | 4/1 | 3720 | 8.61 | 8.59 | 10.88 | 1.007 | 0.38/0.37/0.01 |
| E1 | A | 8 | 1/1 | 1348 | 23.74 | 23.26 | 28.72 | 1.030 | 0.32/0.36/0.01 |
| E1 | A | 8 | 2/1 | 1354 | 23.62 | 23.24 | 52.41 | 1.030 | 0.32/0.36/0.02 |
| E1 | A | 8 | 3/1 | 1368 | 23.40 | 22.99 | 27.19 | 1.029 | 0.32/0.37/0.01 |
| E1 | A | 16 | 1/1 | 2424 | 13.21 | 12.97 | 17.38 | 1.033 | 0.38/0.36/0.02 |
| E1 | A | 16 | 2/1 | 2376 | 13.48 | 13.17 | 18.10 | 1.034 | 0.37/0.36/0.00 |
| E1 | A | 16 | 3/1 | 2432 | 13.16 | 12.90 | 16.04 | 1.034 | 0.38/0.38/0.01 |
| E1 | A | 32 | 1/1 | 3904 | 8.20 | 8.05 | 10.84 | 1.041 | 0.46/0.37/0.02 |
| E1 | A | 32 | 2/1 | 3896 | 8.22 | 8.10 | 10.78 | 1.041 | 0.45/0.38/0.01 |
| E1 | A | 32 | 3/1 | 4032 | 7.94 | 7.88 | 10.52 | 1.043 | 0.45/0.39/0.01 |
| E1 | B | 8 | 1/1 | 1146 | 27.91 | 27.49 | 34.27 | 1.035 | 0.27/0.35/0.00 |
| E1 | B | 8 | 2/1 | 1180 | 27.11 | 26.83 | 30.66 | 1.035 | 0.27/0.35/0.01 |
| E1 | B | 8 | 3/1 | 1150 | 27.82 | 27.33 | 32.96 | 1.034 | 0.27/0.36/0.01 |
| E1 | B | 16 | 1/1 | 2068 | 15.49 | 15.09 | 20.04 | 1.039 | 0.33/0.35/0.00 |
| E1 | B | 16 | 2/1 | 2112 | 15.16 | 14.93 | 18.27 | 1.031 | 0.32/0.36/0.01 |
| E1 | B | 16 | 3/1 | 2076 | 15.42 | 15.16 | 19.55 | 1.040 | 0.32/0.36/0.01 |
| E1 | B | 32 | 1/1 | 3488 | 9.18 | 8.96 | 12.16 | 1.051 | 0.41/0.37/0.00 |
| E1 | B | 32 | 2/1 | 3432 | 9.32 | 9.12 | 16.59 | 1.046 | 0.39/0.36/0.01 |
| E1 | B | 32 | 3/1 | 3512 | 9.11 | 8.96 | 12.17 | 1.046 | 0.40/0.37/0.01 |
| E2 | A | 8 | 1/1 | 1320 | 24.21 | 23.77 | 53.49 | 1.031 | 0.31/0.36/0.01 |
| E2 | A | 8 | 2/2 | 2732 | 11.72 | 11.55 | 14.55 | 1.011 | 0.65/0.48/0.02 |
| E2 | A | 8 | 3/2 | 2696 | 11.86 | 11.62 | 15.24 | 1.011 | 0.65/0.47/0.03 |
| E2 | A | 16 | 1/1 | 2404 | 13.33 | 13.08 | 18.06 | 1.033 | 0.37/0.36/0.01 |
| E2 | A | 16 | 2/2 | 4784 | 6.69 | 6.66 | 11.23 | 1.013 | 0.71/0.48/0.02 |
| E2 | A | 16 | 3/2 | 4812 | 6.65 | 6.50 | 9.75 | 1.014 | 0.75/0.48/0.03 |
| E2 | A | 32 | 1/1 | 3944 | 8.12 | 8.05 | 10.80 | 1.045 | 0.44/0.37/0.02 |
| E2 | A | 32 | 2/1 | 3928 | 8.15 | 8.01 | 12.21 | 1.043 | 0.46/0.37/0.00 |
| E2 | A | 32 | 3/1 | 3840 | 8.33 | 8.11 | 15.72 | 1.046 | 0.45/0.37/0.01 |
| E2 | B | 8 | 1/1 | 1166 | 27.42 | 27.01 | 32.65 | 1.037 | 0.28/0.36/0.01 |
| E2 | B | 8 | 2/2 | 2290 | 13.98 | 13.68 | 17.27 | 1.014 | 0.55/0.46/0.03 |
| E2 | B | 8 | 3/2 | 2302 | 13.90 | 13.80 | 17.40 | 1.015 | 0.53/0.45/0.02 |
| E2 | B | 16 | 1/1 | 2100 | 15.25 | 14.95 | 19.06 | 1.037 | 0.33/0.36/0.00 |
| E2 | B | 16 | 2/2 | 4168 | 7.68 | 7.53 | 10.36 | 1.016 | 0.65/0.46/0.03 |
| E2 | B | 16 | 3/2 | 4124 | 7.76 | 7.60 | 12.98 | 1.016 | 0.62/0.46/0.03 |
| E2 | B | 32 | 1/1 | 3424 | 9.35 | 9.14 | 16.36 | 1.048 | 0.40/0.36/0.00 |
| E2 | B | 32 | 2/1 | 3528 | 9.06 | 8.92 | 11.95 | 1.046 | 0.40/0.36/0.02 |
| E2 | B | 32 | 3/1 | 3504 | 9.14 | 9.04 | 11.70 | 1.047 | 0.39/0.36/0.00 |
| S | A | 8 | 1/1 | 1288 | 24.85 | 24.78 | 30.18 | 1.004 | 0.29/0.40/0.00 |
| S | A | 8 | 2/2 | 1780 | 17.99 | 17.65 | 24.28 | 1.005 | 0.42/0.46/0.01 |
| S | A | 8 | 3/2 | 1826 | 17.51 | 17.25 | 21.95 | 1.005 | 0.43/0.47/0.01 |
| S | A | 16 | 1/1 | 2292 | 13.95 | 13.87 | 17.38 | 1.009 | 0.34/0.40/0.01 |
| S | A | 16 | 2/2 | 3292 | 9.72 | 9.61 | 12.22 | 1.010 | 0.51/0.47/0.01 |
| S | A | 16 | 3/2 | 3184 | 10.06 | 9.78 | 24.31 | 1.011 | 0.51/0.46/0.02 |
| S | A | 32 | 1/1 | 3664 | 8.73 | 8.54 | 16.25 | 1.013 | 0.41/0.40/0.01 |
| S | A | 32 | 2/1 | 3808 | 8.39 | 8.38 | 11.20 | 1.019 | 0.42/0.40/0.01 |
| S | A | 32 | 3/1 | 3672 | 8.71 | 8.61 | 11.42 | 1.018 | 0.42/0.40/0.01 |
| S | B | 8 | 1/1 | 1026 | 31.18 | 31.06 | 34.47 | 1.005 | 0.24/0.37/0.02 |
| S | B | 8 | 2/2 | 1636 | 19.55 | 19.47 | 26.66 | 1.006 | 0.37/0.44/0.01 |
| S | B | 8 | 3/2 | 1656 | 19.33 | 19.25 | 23.59 | 1.004 | 0.37/0.45/0.01 |
| S | B | 16 | 1/1 | 1880 | 17.04 | 16.97 | 21.27 | 1.012 | 0.28/0.37/0.00 |
| S | B | 16 | 2/2 | 2976 | 10.74 | 10.65 | 13.69 | 1.014 | 0.45/0.45/0.01 |
| S | B | 16 | 3/2 | 2924 | 10.95 | 10.77 | 25.45 | 1.009 | 0.45/0.46/0.01 |
| S | B | 32 | 1/1 | 3144 | 10.16 | 10.08 | 17.97 | 1.025 | 0.36/0.37/0.02 |
| S | B | 32 | 2/1 | 3208 | 9.99 | 9.92 | 11.94 | 1.017 | 0.37/0.39/0.01 |
| S | B | 32 | 3/1 | 3152 | 10.17 | 10.04 | 12.59 | 1.020 | 0.36/0.38/0.00 |
| serial | A | 8 | 1/1 | 972 | 32.90 | 32.45 | 42.09 | 1.007 | 0.24/0.45/0.00 |
| serial | A | 8 | 2/1 | 804 | 39.83 | 39.69 | 48.78 | 1.014 | 0.35/0.45/0.00 |
| serial | A | 8 | 3/1 | 860 | 37.13 | 35.93 | 45.54 | 1.007 | 0.32/0.45/0.01 |
| serial | A | 16 | 1/1 | 1776 | 17.99 | 17.64 | 22.51 | 1.016 | 0.29/0.46/0.00 |
| serial | A | 16 | 2/1 | 1632 | 19.57 | 18.62 | 24.72 | 1.020 | 0.36/0.45/0.00 |
| serial | A | 16 | 3/1 | 1576 | 20.31 | 19.67 | 27.37 | 1.014 | 0.37/0.44/0.01 |
| serial | A | 32 | 1/1 | 2800 | 11.44 | 11.31 | 15.63 | 1.035 | 0.40/0.43/0.00 |
| serial | A | 32 | 2/1 | 2864 | 11.17 | 11.11 | 20.03 | 1.030 | 0.43/0.44/0.00 |
| serial | A | 32 | 3/1 | 2880 | 11.11 | 10.84 | 14.93 | 1.021 | 0.41/0.45/0.01 |
| serial | B | 8 | 1/1 | 672 | 47.53 | 47.45 | 52.62 | 1.006 | 0.23/0.39/0.00 |
| serial | B | 8 | 2/1 | 710 | 45.10 | 45.00 | 49.44 | 1.009 | 0.19/0.40/0.00 |
| serial | B | 8 | 3/1 | 660 | 48.52 | 47.71 | 55.13 | 1.013 | 0.23/0.40/0.00 |
| serial | B | 16 | 1/1 | 1248 | 25.63 | 25.47 | 29.74 | 1.015 | 0.27/0.39/0.00 |
| serial | B | 16 | 2/1 | 1344 | 23.79 | 23.67 | 27.68 | 1.014 | 0.22/0.41/0.00 |
| serial | B | 16 | 3/1 | 1192 | 26.86 | 27.15 | 31.84 | 1.025 | 0.29/0.39/0.01 |
| serial | B | 32 | 1/1 | 2248 | 14.26 | 14.32 | 17.79 | 1.024 | 0.32/0.40/0.00 |
| serial | B | 32 | 2/1 | 2400 | 13.36 | 13.34 | 16.60 | 1.029 | 0.29/0.40/0.00 |
| serial | B | 32 | 3/1 | 2176 | 14.74 | 15.23 | 18.37 | 1.023 | 0.34/0.39/0.00 |

## Open-loop strict-rung confirmations

| Arm | Link | Configuration | Offered / achieved/s | Intended mean ms range | Client mean ms range | Worst p99 ms | Error fraction max | SLO all three |
|---|---|---|---:|---:|---:|---:|---:|---|
| C | A | N=16, c=2, active=2 | 4525 / 4525 | 8.07–10.34 | 6.93–6.94 | 84.38 | 0.000% | yes |
| C | B | N=16, c=4, active=2 | 2262 / 2262 | 10.61–10.74 | 10.52–10.65 | 14.64 | 0.000% | yes |
| E1 | A | N=32, c=3, active=1 | 4525 / 48 | 1003.88–1003.94 | 8.04–8.22 | 1009.58 | 99.044% | no |
| E1 | B | N=32, c=3, active=1 | 2262 / 2262 | 16.06–16.18 | 13.15–13.19 | 24.09 | 0.000% | yes |
| E2 | A | N=16, c=3, active=2 | 4525 / 4525 | 8.82–12.95 | 7.01–7.03 | 90.44 | 0.000% | yes |
| E2 | B | N=16, c=2, active=2 | 2262 / 2262 | 11.06–11.51 | 10.95–11.08 | 21.97 | 0.000% | yes |
| S | A | N=32, c=2, active=1 | 4525 / 12 | 1004.14–1004.18 | 8.59–8.74 | 1009.55 | 99.955% | no |
| S | B | N=32, c=2, active=1 | 2262 / 2262 | 16.83–17.06 | 13.42–13.49 | 24.08 | 0.000% | yes |
| serial | A | N=32, c=3, active=1 | 4525 / 0 | 1005.00–1005.36 | 12.11–14.63 | 1016.23 | 100.000% | no |
| serial | B | N=32, c=2, active=1 | 2262 / 952 | 601.28–917.41 | 14.66–16.78 | 1016.88 | 77.626% | no |

The 1,000 ms arrival deadline and 100 ms write p99 are retained in these SQL-driver confirmations. Expired arrivals and late confirmations are counted as errors. They exercise the tail and collection/dispatch phasing; they do not include native HTTP/authentication/Quarry costs.

## Serial K/H and durability ledger

| Link | N | Opener ms | Facts ms | Levels ms | Harness encode ms | Apply+tail ms | Publication ms | COMMIT ms | WAL sync ms | Sync/batch |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A | 8 | 1.324 | 1.074 | 0.000 | 0.073 | 1.683 | 0.766 | 3.277 | 2.695 | 1.007 |
| A | 16 | 1.354 | 1.270 | 0.000 | 0.129 | 2.169 | 0.769 | 3.281 | 2.617 | 1.016 |
| A | 32 | 1.408 | 1.605 | 0.000 | 0.232 | 3.877 | 0.767 | 3.485 | 2.805 | 1.035 |
| B | 8 | 2.334 | 1.562 | 0.000 | 0.074 | 2.904 | 1.269 | 3.641 | 2.542 | 1.006 |
| B | 16 | 2.361 | 1.745 | 0.000 | 0.133 | 3.601 | 1.269 | 3.683 | 2.558 | 1.015 |
| B | 32 | 2.415 | 2.067 | 0.000 | 0.233 | 4.363 | 1.273 | 3.828 | 2.652 | 1.024 |

WAL sync is a component of COMMIT and must not be added to it. The SQL-driver encode span excludes native Quarry interpretation and committer work. The retained native S1 clocks provide the following separate K/H decomposition; this is a new analysis of archived measurements, not a new native trial.

| Native link/rate | Batches | Cycle ms | Opener flights ms | K outside named phases ms | K outside flights+parallel ms | H external ms | H + intake/admission/encode ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| A / 800 | 722 | 10.857 | 1.701 | 1.091 | 1.309 | 0.194 | 0.281 |
| A / 1131 | 564 | 13.733 | 2.800 | 1.667 | 1.949 | 0.503 | 0.688 |
| B / 800 | 486 | 16.114 | 2.693 | 1.475 | 1.754 | 0.170 | 0.240 |
| B / 1131 | 477 | 16.192 | 3.616 | 1.752 | 2.049 | 0.645 | 0.946 |

| Native link/rate | Opener flights ms | Facts ms | Levels ms | Parallel ms | Apply+tail ms | Publication ms | COMMIT ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| A / 800 | 1.701 | 1.528 | 0.000 | 0.448 | 1.918 | 0.780 | 3.390 |
| A / 1131 | 2.800 | 1.794 | 0.000 | 0.617 | 2.657 | 0.753 | 3.445 |
| B / 800 | 2.693 | 2.247 | 0.000 | 0.605 | 3.978 | 1.298 | 3.818 |
| B / 1131 | 3.616 | 2.234 | 0.000 | 0.726 | 2.775 | 1.239 | 3.849 |

K outside named phases is the additive residual after subtracting measured opener flights and all named phase wall times. The second K column also includes client work inside facts/tail phase wrappers, so it is not additive to those wrappers. Neither is a direct CPU measurement. H external is client-send→server-accept plus server-write-end→client-completion; it excludes generator backlog and server residence. The expanded H column adds measured intake/admission/JSON encode. Uninstrumented glue remains; no assumed RTT is subtracted to manufacture a CPU number. Native source under `snapback4/crates` is unchanged between the diagnosis branch and the G7 base.

## One log row per write — sensitivity

| Arm | Link | N | Conn. / active | Writes/s | Mean ms | p50 ms | p99 ms | Sync/batch | CPU PG/app/client |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| C | A | 16 | 2/2 | 4596 | 6.96 | 6.85 | 9.50 | 1.006 | 0.76/0.49/0.03 |
| C | A | 32 | 3/1 | 3728 | 8.59 | 9.01 | 11.42 | 1.018 | 0.46/0.39/0.01 |
| C | A | 8 | 4/4 | 4014 | 7.97 | 7.82 | 19.85 | 0.722 | 1.05/0.62/0.04 |
| C | B | 8 | 4/4 | 4058 | 7.88 | 7.78 | 10.73 | 0.750 | 0.99/0.62/0.05 |
| C | B | 16 | 4/2 | 4016 | 7.97 | 7.88 | 10.44 | 1.006 | 0.67/0.49/0.02 |
| C | B | 32 | 4/1 | 3208 | 9.97 | 10.06 | 17.42 | 1.022 | 0.44/0.38/0.01 |
| E1 | A | 32 | 3/1 | 3440 | 9.30 | 9.15 | 12.20 | 1.051 | 0.50/0.38/0.01 |
| E2 | A | 8 | 2/2 | 2508 | 12.76 | 12.54 | 21.35 | 1.012 | 0.68/0.48/0.03 |
| E2 | A | 16 | 3/2 | 4344 | 7.37 | 7.21 | 9.91 | 1.014 | 0.82/0.50/0.03 |
| E2 | B | 8 | 3/2 | 2200 | 14.54 | 14.25 | 19.04 | 1.014 | 0.61/0.46/0.03 |
| E2 | B | 16 | 2/2 | 3764 | 8.50 | 8.29 | 19.91 | 1.015 | 0.72/0.46/0.01 |
| E2 | B | 32 | 2/1 | 3072 | 10.42 | 10.27 | 13.03 | 1.058 | 0.45/0.36/0.01 |
| S | A | 8 | 3/2 | 1686 | 18.98 | 18.67 | 27.07 | 1.007 | 0.46/0.48/0.02 |
| S | A | 16 | 2/2 | 2992 | 10.70 | 10.55 | 13.00 | 1.011 | 0.56/0.47/0.02 |
| S | A | 32 | 2/1 | 3320 | 9.64 | 9.81 | 11.77 | 1.023 | 0.47/0.40/0.01 |
| S | B | 8 | 3/2 | 1526 | 20.98 | 20.63 | 26.15 | 1.009 | 0.42/0.45/0.00 |
| S | B | 16 | 2/2 | 2684 | 11.91 | 11.74 | 14.41 | 1.013 | 0.50/0.46/0.02 |
| S | B | 32 | 2/1 | 2864 | 11.19 | 11.18 | 13.67 | 1.033 | 0.41/0.37/0.01 |
| serial | A | 8 | 1/1 | 850 | 37.65 | 36.77 | 66.88 | 1.006 | 0.32/0.44/0.00 |
| serial | A | 16 | 1/1 | 1608 | 19.86 | 20.85 | 25.52 | 1.009 | 0.36/0.45/0.00 |
| serial | A | 32 | 3/1 | 2400 | 13.34 | 13.43 | 17.45 | 1.030 | 0.47/0.44/0.01 |
| serial | B | 8 | 2/1 | 648 | 49.31 | 48.99 | 54.32 | 1.011 | 0.25/0.39/0.00 |
| serial | B | 16 | 2/1 | 1204 | 26.61 | 26.82 | 30.91 | 1.021 | 0.29/0.40/0.01 |
| serial | B | 32 | 2/1 | 2104 | 15.22 | 14.98 | 22.49 | 1.021 | 0.35/0.40/0.01 |

With one log row per write, E2 N=16/A reaches 4,320–4,376/s at 7.31–7.41 ms mean, missing A. C N=16/A reaches 4,556–4,636/s at 6.91–7.03 ms, with little headroom. These sensitivity cells have short windows only; they do not receive the longer rung confirmation. The primary A verdict therefore applies specifically to the actual empty-log S1 W4 tail.

## Arm E crash/restart test

36 seeded random SIGKILL injections, both links, N=8/16/32, depth 1/2 and 1/2/3 connections. Acknowledgements are recorded only after the synchronous marker completes and are synced to an external acknowledgement file. The postmaster is killed; every recorded old child must end before ordinary PostgreSQL crash recovery/restart. No old transaction is allowed to overlap recovery.

**Acknowledged writes lost: 0. Prefix failures: 0.** Across the tests, 8,112 writes are acknowledged; 32 additional writes recover without an acknowledgement. Every recovered head/revision equals the contiguous benchmark commit count, counters match per-principal commits, and no partial batch exists. Actual online-only logs remain empty.

This is process-crash evidence, not power-loss testing. PostgreSQL’s synchronous marker is the durability mechanism; the test does not establish safe reader visibility between the async batch COMMIT and its marker, takeover behavior or an unknown-outcome API. Those remain product-design work.

| Depth | N | Connections | Crashes | Links | Acknowledged lost | Prefix |
|---:|---:|---:|---:|---|---:|---|
| 1 | 8 | 1 | 2 | A/B | 0 | pass |
| 1 | 8 | 2 | 2 | A/B | 0 | pass |
| 1 | 8 | 3 | 2 | A/B | 0 | pass |
| 1 | 16 | 1 | 2 | A/B | 0 | pass |
| 1 | 16 | 2 | 2 | A/B | 0 | pass |
| 1 | 16 | 3 | 2 | A/B | 0 | pass |
| 1 | 32 | 1 | 2 | A/B | 0 | pass |
| 1 | 32 | 2 | 2 | A/B | 0 | pass |
| 1 | 32 | 3 | 2 | A/B | 0 | pass |
| 2 | 8 | 1 | 2 | A/B | 0 | pass |
| 2 | 8 | 2 | 2 | A/B | 0 | pass |
| 2 | 8 | 3 | 2 | A/B | 0 | pass |
| 2 | 16 | 1 | 2 | A/B | 0 | pass |
| 2 | 16 | 2 | 2 | A/B | 0 | pass |
| 2 | 16 | 3 | 2 | A/B | 0 | pass |
| 2 | 32 | 1 | 2 | A/B | 0 | pass |
| 2 | 32 | 2 | 2 | A/B | 0 | pass |
| 2 | 32 | 3 | 2 | A/B | 0 | pass |

## Supabase/PostgREST on this host

| Link | Offered/s | Achieved/s | Passing reps | p50 ms | Worst p99 ms | DB commit delta/ack | Approx. WAL sync/app commit |
|---|---:|---:|---:|---:|---:|---:|---:|
| A | 3200 | 3200 | 3/3 | 8.05 | 74.45 | 0.9944 | 0.1154 |
| B | 1600 | 1600 | 3/3 | 9.31 | 40.08 | 0.9995 | 0.2304 |
| B | 3200 | 3077 | 0/3 | 1004.01 | 1011.35 | 0.9984 | 0.1237 |

These use the unchanged one-host HTTP generator, 32 clients/pool slots, advocate SQL and PostgREST 14.18 configuration, 1M-message control fixture and 10s/20s/three repetitions. WAL counters cover warm-up+measurement+drain; their publication is asynchronous, so the sync ratios are estimates. Ratios use whole-cohort successful HTTP acknowledgements as denominator; the failed B/3,200 cohort can also have unacknowledged commits. Database transaction statistics are published asynchronously and include observer transactions; the sampled deltas have boundary error and are not an exact transaction count. The separate protocol trace establishes one application transaction per W4 request, so sync/request estimates sync/application-commit at passing rates. At the passing rates, the role-filtered statement witness shows one request-context `set_config` and one RPC statement per acknowledged request. The RPC calls the existing SECURITY DEFINER increment function with its explicit authorization predicate. It updates one counter; it does not write Snapback’s commit/evidence/head tail.

The observed application sequence is `BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE` → one request-context `set_config` statement → one RPC statement → `COMMIT`. Connection initialization additionally sets UTF8 and the warning level. The separate one-request PostgreSQL protocol observation is recorded in `verification.json`; bind parameter logging is disabled before enabling statement logging, and no performance trial uses statement logging. Utility statement counters are not used as an exact transaction count. Independent durable requests can share a WAL flush, explaining sync/request below one without relaxing synchronous commit.

## Validation, archive and limits

All primary and sensitivity trials assert whole-cohort counter/commit equality; S/E also assert head and revision. Deadlock deltas are zero. The crash verifier checks acknowledgement survival, per-counter arithmetic and contiguous recovery after every restart. Affinity, disk and host-start evidence, protocol observations, known-secret scan and stopped-PID audit are summarized in [verification.json](./verification.json). [Bounded aggregates](./aggregate.json), [native K/H definitions and source hashes](./native-kh.json), [archive receipt](./archive.json).

Raw repetitions, batch clocks, CPU samples, failed setup/smoke/exploratory attempts and source/binary receipts stay outside Git. Archive: `/home/ccheever/sb4scale/archive/g70-20261025.tar.gz`. SHA-256: `6d2e531409a0bc1f1421ba100d2c998b346434a26c160daf9c284e2c2ca8ea40`. No fetch, push, stash, publication, paid resource, Git configuration change or product edit occurs. All private clusters/proxies/clients/controllers stop; **PIDs left: none**.

Governing context: [G7 §§3–5/8](../../../../llp/3000.009.001.000.000.002-pipelined-group-commit.rfc.md), [controls RFC](../../../../llp/3000.009.001.000.002-beating-the-postgres-controls.rfc.md), [S1 method](../../../../llp/3000.009.001.002-scale-limits-against-postgres-controls.rfc.md), and [native diagnosis](../../scale-controls/results-20261025-s1-diagnosis/README.md). G7 remains a draft. These results measure mechanisms and optimistic SQL bounds; they do not select or qualify a product protocol.

Reproduce from the repository root (release, lane-owned target; raw destination must be new):

```sh
CARGO_TARGET_DIR="$PWD/snapback4/target/g70" cargo build --release \
  --manifest-path snapback4/experiments/postgres-commit-path/Cargo.toml --bin g70
python3 snapback4/experiments/scale-controls/scripts/g70-onehost.py \
  --out "$HOME/sb4scale/g70-NEW" --binary snapback4/target/g70/release/g70
```
