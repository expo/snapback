# C0′ — calibrated write-capacity search

Experiments only, on `sb4-pg/c0`. No product changes, fetch, push, publication or external service. Current measured preparation is an explicitly labelled **L′ CPU stand-in**. L′ is unbuilt; C-L is omitted because a complete canonical SQL encoder was not implemented. No result here authorizes C or ordered C under the [Accepted RFC](../../../../llp/3000.009.001.000.000.003-concurrent-disjoint-commits.rfc.md#35-stage-c0-the-product-shaped-harness-and-its-gate).

Measured harness commit: `0298c21295955fe0d4bc2dba09e2df5ec6062d37`; release binary SHA-256: `83d431192ca71221a66c4bdf04d44ed985b66f6bfdf10a6467ad122192e01309`. [Provenance](./provenance.json) records source, fixture and numerical injection hashes for the capacity run and each calibration/diagnostic run. Earlier calibration binaries were not saved as immutable snapshots; the capacity binary and sources were saved before its first trial.

## Calibration

A literal N=11, K=1 O1 is not today’s product: it has one slot, provisioned Stage P checks, a typed tail and two flights. The [S1-WA reference](../../scale-controls/results-20261026-s1-write-attribution/README.md) has two pipeline slots, inline checks, the JSON tail and a separate COMMIT: three flights, mean N≈11 under a 32-member cap. The literal calibration failed and is retained below. The separate current-product-shape control restores those protocol and scheduling terms, uses rate-specific joint samples, and matches **all four reference achieved rates and sent means within ±15%**. This protocol correction is disclosed; the literal one-slot arm is not relabelled a calibration success. Its configuration is retained in the three-repetition searches.

| Link / offered/s | Reference achieved/s / sent mean ms | Control achieved/s / sent mean ms | Rate / mean delta | Actual N | S1 |
|---|---:|---:|---:|---:|---|
| A / 2262 | 2177 / 14.99 | 2041 / 15.88 | -6.2% / +6.0% | 10.67 | fail |
| A / 3200 | 2223 / 14.39 | 2003 / 15.96 | -9.9% / +10.9% | 10.67 | fail |
| B / 1600 | 1600 / 13.90 | 1600 / 14.87 | +0.0% / +7.0% | 8.78 | pass |
| B / 2262 | 1889 / 16.94 | 1777 / 18.00 | -5.9% / +6.2% | 10.67 | fail |

| Literal N=11, K=1 | Achieved/s | Sent mean ms | Rate / mean delta |
|---|---:|---:|---:|
| A / 2262 | 1483 | 21.57 | -31.9% / +43.9% |
| A / 3200 | 1487 | 21.52 | -33.1% / +49.5% |
| B / 1600 | 1294 | 24.73 | -19.2% / +77.9% |
| B / 2262 | 1311 | 24.40 | -30.6% / +44.0% |

Calibration is one full 10 s/20 s trial per reference rung, matching the native reference’s diagnostic design. It validates achieved rate and sent mean, not complete latency-distribution equality: the B/1,600 control’s intended p99 is 91.81 ms versus the reference’s 18.71 ms. The reference’s three overloaded rungs fail in the control too. A baseline setup attempt started before the sample export receipt was ready; it was retained, stopped, and repeated after export completed.

## Capacity by arm

These are highest offered rates passing **all three complete S1 10 s warm-up/20 s measurement repetitions**, bracketed by the next tested failing rate within 5%. The screen and refinement use shorter windows, described below. Means span repetitions; p99/errors are worst, delivery is minimum, and CPU/cost columns are medians. All failed observations remain in the archive.

| Arm | Link | N/K/h ms | Capacity/s [next fail) | Delivered/s | Sent mean ms | Intended p99 ms | Errors % | Actual N | Sync/batch | PG statement / CPU ms/batch | Prep CPU ms/batch | CPU PG/app/client |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| O1 | A | 32/2/0.6 | 2,350 [2,467) | 2350 | 10.83–11.31 | 86.68 | 0.000 | 9.59 | 1.046 | 1.054 / 2.021 | 1.411 | 0.44/1.10/0.23 |
| O1 | B | 32/2/0 | 2,166 [2,262) | 2166 | 11.74–12.10 | 21.07 | 0.000 | 9.15 | 1.045 | 0.844 / 1.917 | 1.447 | 0.41/1.10/0.22 |
| C | A | 16/4/0.6 | 2,871 [2,950) | 2871 | 9.64–10.10 | 90.27 | 0.000 | 5.61 | 0.738 | 1.698 / 1.906 | 0.829 | 0.85/1.26/0.28 |
| C | B | 8/4/0.6 | 2,871 [2,950) | 2871 | 9.83–10.29 | 85.35 | 0.000 | 5.71 | 0.747 | 0.887 / 1.505 | 0.906 | 0.66/1.30/0.28 |
| OC | A | 8/4/0.6 | 2,149 [2,211) | 2149 | 11.61–13.27 | 87.78 | 0.000 | 6.14 | 1.039 | 4.315 / 2.893 | 0.898 | 0.91/1.13/0.23 |
| OC | B | 16/4/0 | 2,238 [2,262) | 2238 | 12.10–13.63 | 40.76 | 0.000 | 8.74 | 1.058 | 3.148 / 3.697 | 1.371 | 0.85/1.14/0.23 |

## Fixed-rung S1 verdicts

For each arm/rung this selects the strongest fully confirmed configuration among its best two screened configurations and N=11/K=1/h=0. Every row has three full repetitions. S1 requires intended-arrival p99≤100 ms, errors≤0.1%, delivered offered rate and counter equality. The RFC’s A transfer gate additionally needs every sent mean≤6.4 ms, or a separately tested high-end injection pass, and the ordered comparator. No high-end sensitivity is claimed.

| Arm | Link / offered/s | N/K/h ms | Delivered/s | Sent mean ms | Intended p99 ms | Errors % | S1 3/3 | Mean≤6.4 3/3 |
|---|---|---|---:|---:|---:|---:|---|---|
| O1 | A / 3200 | 32/2/0.6 | 2541 | 12.36–12.59 | 1015.46 | 20.598 | fail | no |
| O1 | A / 3805 | 16/2/0.6 | 2565 | 12.43–12.47 | 1015.77 | 32.597 | fail | no |
| O1 | A / 4525 | 16/2/0.6 | 2504 | 12.24–12.78 | 1015.61 | 44.669 | fail | no |
| O1 | B / 2262 | 16/2/0 | 2262 | 12.23–14.07 | 320.40 | 0.000 | fail | no |
| O1 | B / 3200 | 32/2/0 | 2233 | 13.90–14.32 | 1016.74 | 30.205 | fail | no |
| C | A / 3200 | 16/4/0.6 | 3041 | 10.27–10.68 | 1013.45 | 4.980 | fail | no |
| C | A / 3805 | 16/2/0.6 | 3026 | 10.34–10.57 | 1014.10 | 20.461 | fail | no |
| C | A / 4525 | 16/2/0.6 | 3032 | 10.40–10.55 | 1014.02 | 32.996 | fail | no |
| C | B / 2262 | 8/4/0.6 | 2262 | 9.64–9.83 | 49.99 | 0.000 | pass | no |
| C | B / 3200 | 8/4/0.6 | 3023 | 10.43–10.70 | 1013.35 | 5.544 | fail | no |
| OC | A / 3200 | 16/4/0 | 2485 | 12.29–12.87 | 1016.54 | 22.356 | fail | no |
| OC | A / 3805 | 16/4/0 | 2420 | 12.37–13.22 | 1018.38 | 36.399 | fail | no |
| OC | A / 4525 | 16/4/0 | 2479 | 12.18–12.90 | 1016.95 | 45.217 | fail | no |
| OC | B / 2262 | 16/4/0 | 2262 | 12.39–13.43 | 499.69 | 0.000 | fail | no |
| OC | B / 3200 | 16/4/0 | 2253 | 12.73–14.20 | 1017.20 | 29.594 | fail | no |

## Recommendation

A/3,805 passes: none. A/4,525 passes: none. These statements use current measured preparation; they assume neither 20–30 µs/member L′ CPU nor a cheaper unimplemented server tail.
O1’s strongest A capacity is 2,350/s at N/K/h=32/2/0.6. It records summed PG statement clocks 1.054 ms/batch, PG process CPU 2.021 ms/batch and preparation CPU 1.411 ms/batch, with sampled PG/app/client CPU 0.44/1.10/0.23.
C’s strongest A capacity is 2,871/s at N/K/h=16/4/0.6. It records summed PG statement clocks 1.698 ms/batch, PG process CPU 1.906 ms/batch and preparation CPU 0.829 ms/batch, with sampled PG/app/client CPU 0.85/1.26/0.28.
OC’s strongest A capacity is 2,149/s at N/K/h=8/4/0.6. It records summed PG statement clocks 4.315 ms/batch, PG process CPU 2.893 ms/batch and preparation CPU 0.898 ms/batch, with sampled PG/app/client CPU 0.91/1.13/0.23.
**Build only L′ on the ordered lane, under the RFC’s freshness protocol, then remeasure; stop C and ordered C at this gate.** B does not require a new reader/recovery protocol. The current-preparation experiment supplies no formal authorization for C/ordered C, even if a finer rung passes. A 3,805 result is not a strict control win without a matched control rerun; 4,525 remains the registered strict-win rung.

## Method and limits

The host is `expo-build-450b` (OS `expose-builder-pixel-a`), Ryzen 5 3600. PG16.15 is pinned to 0–2,6–8; replay/app/proxy to 3–4,9–10; the open-loop scheduler to 5,11. The existing Unix delayed proxy injects 250 µs/direction on A and 500 µs/direction on B. Private socket-only PG, inherited fsync/full_page_writes settings, 32 clients/cap 32, live affinity/CPU sampling, unrelated-process start checks, before/after RTT and a 25 GiB /home stop are retained. The runtime checks disk once per second as well as at boundaries and sampler ticks.

The √2 ladder is 1,600/2,262/3,200/4,525, extended downward if the first rung fails or upward if the top passes, then geometric bisection until failing/passing≤1.05. The one-repetition screen uses 1 s/4 s. The best two configurations per arm/link plus the literal N=11/K=1/h=0 configuration receive three-repetition 1 s/4 s searches, then three **10 s/20 s** confirmations at their bracket endpoints and the fixed rungs. Long-window failures move the bracket downward; additional full confirmations narrow it back to 5%. Failed trials are retained, never replaced. This is a measured empirical bracket, not a statistical confidence interval.

A slot’s cohort timer starts at SQL confirmation, while its clients are still in release/HTTP. It dispatches at min(N,ceil(32/K)) ready members or expiration of h; N is a cap. Every hold and queue remains in residence. Ordered arms serialize opener+preparation but overlap final SQL; K=4 is the user-requested depth sensitivity. Replies release only through a contiguous prefix, and a client is reused only after continuation and HTTP replay.

O1 uses two flights: fenced opener/head/authority/receipts/facts, then predecessor ticket, exact Stage P typed CAS tail, raising counts and synchronous COMMIT. C uses one fenced warm-fact flight: first-write `_batches`, stored-authority/absence and locked-image validation, deadline check, two-image typed apply, tripwire and synchronous COMMIT; a dedicated connection pays catch-up/prune/renewal work. Ordered C uses two-image reads at D and E’s ordered async-data/synchronous-marker shape. Its marker is co-dispatched with the data COMMIT and sampled completed-before-poll delay is removed; remaining marker cost, flush, checks, encoding and CPU are charged. It needs no holes/voids. Stage P helper bodies and typed generator provenance are [pinned](../src/c0/stage-p-source.json). The typed generator differs from that source only in comments and removal of an unused test fallback.

Joint numerical S1-WA samples retain request HTTP/continuation/callback terms correlated with batch fill/preparation. Inclusive staging CPU plus measured parallel critical wall is replayed as CPU, scaled by actual/source N. HTTP and callback CPU contend on app cores; wall remainders sleep. Actual encode/driver CPU is charged before padding the preparation budget. This is a **current-preparation stand-in**, not a measurement of L′ or its full parallel-worker CPU. The baseline control uses rate-specific samples; candidate arms use the high-rung S sample per link, and E for ordered C. These distributions are not tuned to make a rung pass.

S1 semantics match the native generator: arrivals expire before send after one second; sent requests time out from send. A successful reply with >1-second intended latency still contributes achieved throughput and its complete intended latency. The previous harness wrongly counted it as an error; this explains 0/s at overloaded fixed rungs. Intended p99 still rejects overload. Whole-cohort counter/commit/request equality is separate from measured-arrival SLO accounting.

Tracked PG statement ms/batch is pg_stat_statements execution+planning minus advisory-ticket and COMMIT utility clocks, including maintenance, divided by all batches. The inherited pg_stat_statements.track=all also records nested function statements, whose clocks can overlap parent statements. This summed tracked-clock column is not additive server wall time. It excludes parsing outside those clocks; other server waits can remain inside them. It is not an exclusive non-wait wall ledger or a flush measurement; PG process CPU is the independent measured server-cost column. PG CPU ms/batch is sampled process CPU, also including backgrounds/observer work; both columns expose their different coverage. WAL sync time and sync/batch are whole-cohort private-cluster deltas. App CPU includes the Python controller/observer; CPU columns are logical CPUs, not percentages. Neither server ledger is an assumed formula substituted for measurements.

The W4-only G7.0 fixture retains one million product-codec background message images and one million historical commit rows, unlike S1-WA’s fully seeded maintained-state/history cardinality. It uses native W4 templates, synthetic session facts and static ordinary authority. Validation does not qualify authority changes, full product readers/recovery, W5 dependency misses, takeover or L′ freshness. The absolute-expiry sentinel and fixed authority facts are fixture assumptions. Prefix and void-race witnesses are diagnostic, not product correctness qualification. Arm E’s earlier harness/product transfer failure is why no mean-only or short-screen result authorizes implementation.

## Every screened configuration

One repetition per tested screen rate; N∈{8,16,32}, K∈{1,2,4}, h∈{0,0.6 ms}, all three arms on A and B: 108 configurations. An abandoned configuration has an already-failing upper bound below 0.7×the best capacity yet found for that arm/link; it is not assigned an invented exact capacity. [All capacity summaries](./capacity.json), [three-repetition confirmation aggregates](./confirmation.json), [gate summaries](./gate.json).

### O1

| Link | N/K/h ms | Screen capacity/s | Next failed/s | Status |
|---|---|---:|---:|---|
| A | 8/1/0 | withheld | 1600 | abandoned below 70% |
| A | 8/1/0.6 | withheld | 1600 | abandoned below 70% |
| A | 8/2/0 | 2262 | 2362 | bracketed within 5% |
| A | 8/2/0.6 | 2262 | 2362 | bracketed within 5% |
| A | 8/4/0 | 1902 | 1986 | bracketed within 5% |
| A | 8/4/0.6 | 1986 | 2074 | bracketed within 5% |
| A | 16/1/0 | 1821 | 1902 | bracketed within 5% |
| A | 16/1/0.6 | 1821 | 1902 | bracketed within 5% |
| A | 16/2/0 | 2166 | 2262 | bracketed within 5% |
| A | 16/2/0.6 | 2576 | 2690 | bracketed within 5% |
| A | 16/4/0 | 1986 | 2074 | bracketed within 5% |
| A | 16/4/0.6 | 1902 | 1986 | bracketed within 5% |
| A | 32/1/0 | 1821 | 1902 | bracketed within 5% |
| A | 32/1/0.6 | 1744 | 1821 | bracketed within 5% |
| A | 32/2/0 | 2467 | 2576 | bracketed within 5% |
| A | 32/2/0.6 | 2576 | 2690 | bracketed within 5% |
| A | 32/4/0 | 1902 | 1986 | bracketed within 5% |
| A | 32/4/0.6 | 1986 | 2074 | bracketed within 5% |
| B | 8/1/0 | withheld | 1131 | abandoned below 70% |
| B | 8/1/0.6 | withheld | 1131 | abandoned below 70% |
| B | 8/2/0 | 1986 | 2074 | bracketed within 5% |
| B | 8/2/0.6 | 1986 | 2074 | bracketed within 5% |
| B | 8/4/0 | 1532 | 1600 | bracketed within 5% |
| B | 8/4/0.6 | 1986 | 2074 | bracketed within 5% |
| B | 16/1/0 | 1670 | 1744 | bracketed within 5% |
| B | 16/1/0.6 | 1670 | 1744 | bracketed within 5% |
| B | 16/2/0 | 2262 | 2362 | bracketed within 5% |
| B | 16/2/0.6 | 2166 | 2262 | bracketed within 5% |
| B | 16/4/0 | 1986 | 2074 | bracketed within 5% |
| B | 16/4/0.6 | 1821 | 1902 | bracketed within 5% |
| B | 32/1/0 | 1670 | 1744 | bracketed within 5% |
| B | 32/1/0.6 | 1532 | 1600 | bracketed within 5% |
| B | 32/2/0 | 2262 | 2362 | bracketed within 5% |
| B | 32/2/0.6 | 2262 | 2362 | bracketed within 5% |
| B | 32/4/0 | 1986 | 2074 | bracketed within 5% |
| B | 32/4/0.6 | 1986 | 2074 | bracketed within 5% |

### C

| Link | N/K/h ms | Screen capacity/s | Next failed/s | Status |
|---|---|---:|---:|---|
| A | 8/1/0 | withheld | 1600 | abandoned below 70% |
| A | 8/1/0.6 | withheld | 1600 | abandoned below 70% |
| A | 8/2/0 | 2690 | 2809 | bracketed within 5% |
| A | 8/2/0.6 | 2690 | 2809 | bracketed within 5% |
| A | 8/4/0 | 2809 | 2934 | bracketed within 5% |
| A | 8/4/0.6 | 2576 | 2690 | bracketed within 5% |
| A | 16/1/0 | 2166 | 2262 | bracketed within 5% |
| A | 16/1/0.6 | 2074 | 2166 | bracketed within 5% |
| A | 16/2/0 | 2934 | 3064 | bracketed within 5% |
| A | 16/2/0.6 | 3064 | 3200 | bracketed within 5% |
| A | 16/4/0 | 2934 | 3064 | bracketed within 5% |
| A | 16/4/0.6 | 3064 | 3200 | bracketed within 5% |
| A | 32/1/0 | 2074 | 2166 | bracketed within 5% |
| A | 32/1/0.6 | 1986 | 2074 | bracketed within 5% |
| A | 32/2/0 | 2576 | 2690 | bracketed within 5% |
| A | 32/2/0.6 | 2576 | 2690 | bracketed within 5% |
| A | 32/4/0 | 2362 | 2467 | bracketed within 5% |
| A | 32/4/0.6 | 2576 | 2690 | bracketed within 5% |
| B | 8/1/0 | withheld | 1600 | abandoned below 70% |
| B | 8/1/0.6 | withheld | 1600 | abandoned below 70% |
| B | 8/2/0 | 2362 | 2467 | bracketed within 5% |
| B | 8/2/0.6 | 2467 | 2576 | bracketed within 5% |
| B | 8/4/0 | 2934 | 3064 | bracketed within 5% |
| B | 8/4/0.6 | 3064 | 3200 | bracketed within 5% |
| B | 16/1/0 | 1986 | 2074 | bracketed within 5% |
| B | 16/1/0.6 | 1986 | 2074 | bracketed within 5% |
| B | 16/2/0 | 2934 | 3064 | bracketed within 5% |
| B | 16/2/0.6 | 2809 | 2934 | bracketed within 5% |
| B | 16/4/0 | 2690 | 2809 | bracketed within 5% |
| B | 16/4/0.6 | 2809 | 2934 | bracketed within 5% |
| B | 32/1/0 | 1902 | 1986 | bracketed within 5% |
| B | 32/1/0.6 | withheld | 1600 | abandoned below 70% |
| B | 32/2/0 | 2467 | 2576 | bracketed within 5% |
| B | 32/2/0.6 | 2690 | 2809 | bracketed within 5% |
| B | 32/4/0 | 2362 | 2467 | bracketed within 5% |
| B | 32/4/0.6 | 2166 | 2262 | bracketed within 5% |

### OC

| Link | N/K/h ms | Screen capacity/s | Next failed/s | Status |
|---|---|---:|---:|---|
| A | 8/1/0 | withheld | 1600 | abandoned below 70% |
| A | 8/1/0.6 | withheld | 1600 | abandoned below 70% |
| A | 8/2/0 | 1902 | 1986 | bracketed within 5% |
| A | 8/2/0.6 | 1902 | 1986 | bracketed within 5% |
| A | 8/4/0 | 2262 | 2362 | bracketed within 5% |
| A | 8/4/0.6 | 2576 | 2690 | bracketed within 5% |
| A | 16/1/0 | 1744 | 1821 | bracketed within 5% |
| A | 16/1/0.6 | withheld | 1600 | abandoned below 70% |
| A | 16/2/0 | 2166 | 2262 | bracketed within 5% |
| A | 16/2/0.6 | 2074 | 2166 | bracketed within 5% |
| A | 16/4/0 | 2576 | 2690 | bracketed within 5% |
| A | 16/4/0.6 | 2467 | 2576 | bracketed within 5% |
| A | 32/1/0 | withheld | 1600 | abandoned below 70% |
| A | 32/1/0.6 | withheld | 1600 | abandoned below 70% |
| A | 32/2/0 | 2262 | 2362 | bracketed within 5% |
| A | 32/2/0.6 | 2362 | 2467 | bracketed within 5% |
| A | 32/4/0 | 2362 | 2467 | bracketed within 5% |
| A | 32/4/0.6 | 2467 | 2576 | bracketed within 5% |
| B | 8/1/0 | withheld | 1600 | abandoned below 70% |
| B | 8/1/0.6 | withheld | 1600 | abandoned below 70% |
| B | 8/2/0 | 1670 | 1744 | bracketed within 5% |
| B | 8/2/0.6 | 1744 | 1821 | bracketed within 5% |
| B | 8/4/0 | 2074 | 2166 | bracketed within 5% |
| B | 8/4/0.6 | 2074 | 2166 | bracketed within 5% |
| B | 16/1/0 | withheld | 1600 | abandoned below 70% |
| B | 16/1/0.6 | withheld | 1600 | abandoned below 70% |
| B | 16/2/0 | 1986 | 2074 | bracketed within 5% |
| B | 16/2/0.6 | 1902 | 1986 | bracketed within 5% |
| B | 16/4/0 | 2362 | 2467 | bracketed within 5% |
| B | 16/4/0.6 | 2262 | 2362 | bracketed within 5% |
| B | 32/1/0 | withheld | 1600 | abandoned below 70% |
| B | 32/1/0.6 | withheld | 1600 | abandoned below 70% |
| B | 32/2/0 | 1986 | 2074 | bracketed within 5% |
| B | 32/2/0.6 | 2074 | 2166 | bracketed within 5% |
| B | 32/4/0 | 2467 | 2576 | bracketed within 5% |
| B | 32/4/0.6 | 2262 | 2362 | bracketed within 5% |

## Diagnostic witnesses

The prefix hammer runs in the 16,000/s overload smokes, not in capacity trials. Every smoke ends cleanly with counter equality; no statement prefix violation is observed. These are experimental witnesses, not qualification of every product reader/recovery entry point. [Diagnostic aggregate](./diagnostics.json).

| Arm | Link | Prefix reads | Reader mean / p99 ms | Stale restarts | Violations |
|---|---|---:|---:|---:|---:|
| C | A | 534 | 3.06 / 5.08 | 0 | 0 |
| C | B | 430 | 4.06 / 6.81 | 0 | 0 |
| O1 | A | 556 | 2.91 / 3.86 | 0 | 0 |
| O1 | B | 445 | 3.90 / 5.25 | 0 | 0 |
| OC | A | 538 | 3.05 / 4.13 | 0 | 0 |
| OC | B | 443 | 3.93 / 5.14 | 0 | 0 |

The independently injected stale snapshot raises S4004; settings drift raises S4001, stale ownership S4002 and a wrong tail count S4003 before commit. A committed batch key beats a void; a void follows a recorded backend kill and refuses the late commit.

## Verification and custody

[Verification](./verification.json), [secret scan](./secret-audit.json), and [archive receipt](./archive.json) bind the retained evidence. The 205 interrupted fixed-rung trials remain as **superseded-by-capacity-search**, including their original incorrect late-intended throughput accounting. They are never used to select or pass a new configuration. The interrupted campaign had no living recorded identities at resume; its private runtime was removed after sealing its known secrets. Clean shutdown was not observed for that interrupted run. All new campaign clusters stop through the runner’s normal cleanup.

The old timeout attempts contain worker panics (owner/settings errors or an invalid SQL column), not evidence of a 120-second overload drain. Startup now checks failed worker joins against a single bounded readiness deadline; the main loop observes maintenance/release worker failure and has a 10-second drain bound. The outer process has warm-up+measurement+15 seconds. Nonzero exits/timeouts write failed trial JSON and stop capacity qualification for diagnosis. Injected startup failures and 16,000/s overloads on all arms/links verify bounded failure, continued counter equality and prefix checks.

Exact-value secret scans cover both benchmark passwords, sealed campaign credentials, JWT/native tokens and PEM payloads. No raw per-request, per-batch or per-rate trial files enter Git. Raw archive path and SHA-256 are in archive.json. No push, stash or Git configuration change. **PIDs left: none.**

The retained-ledger audit passes 1,378 completed trials, 28,629,670 measured arrivals and 4,274,530 batches; two deliberately injected startup failures are retained. It validates 108 screens and all capacity brackets, frozen source/binary hashes, affinities, disk guard and process cleanup. The interrupted 205-trial campaign remains superseded. [Repository checks](./repository-checks.json) record the release build, Python compilation, Stage P source parity, reference check and product-suite scope limit. [Git secret audit](./git-secret-audit.json) covers staged files and the new local commit history.

Raw evidence: `/home/ccheever/sb4scale/archive/c0-20261026-capacity.tar.gz` (1,424,556,547 bytes), SHA-256 **`88cb7c51cfeffdf1af120c729a6250eb52b61af3a0b7e5acf80088fc92b422b8`**. The scan covered 11,692 files and 3,343 sealed values, with zero matches. The shared fixture dump remains at its existing outside-Git path, bound by the fixture hash in provenance; its generator source is archived. Temporary credential vaults are removed after the final staged secret scan.

[Final PID audit](./pid-final.json) includes the verification and archive processes, two completed empty inspections, and a target/runtime scan. **PIDs left: none.**
