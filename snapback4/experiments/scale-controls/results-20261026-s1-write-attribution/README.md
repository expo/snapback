# S1-WA — one-host write residence under S and E

**E releases PostgreSQL’s data locks earlier, but does not shorten the product’s acknowledged write residence.** At B/2,262, matched native sent-request means are **16.94 / 17.41 ms for W4, S / E**, and **17.11 / 17.84 ms for W5 mix**. Both modes pass the lower B rung and fail the higher rung. W4 A/3,200 is **14.39 / 14.93 ms**, well above the 7.07 ms necessary mean for the next strict-win rung, 4,525/s. These are diagnostic fixed-rate checks, not a new capacity search.

The measured-budget path to B is a **combination**: G7.3’s two-flight final, roughly halving the measured preparation/merge and PG-tail CPU budgets, and promptly releasing already-confirmed batches. Its conditional central estimate is **about 13.3 ms on B**, with a 12.3–14.3 ms residual-sensitivity screen. No individual measured-budget lever reaches 14.15 ms here. The same combination estimates about **11.3 ms on A**; no identified individual lever reaches 7.07 ms. Forecasts require implementation and qualification; the upper B screen still misses the target.

This current qualification-build check does **not reproduce the [historical synchronous A/2,262 pass](../results-20261025-s1-writes-levers/README.md)**. Native S achieves about 2,177/s there; E about 2,225/s, with both failing the inherited error/SLO rule. That limits any attribution of the historical A regression to E itself. The present paired S/E builds use the same core debug-assertion configuration; the historical levers-S build did not.


## Matched native check

These are fixed diagnostic rungs, with one uninstrumented 10 s warm-up / 20 s repetition per configuration. They do not replace the earlier three-repetition searches or establish a new ceiling. HTTP mean below excludes arrivals that expired before an HTTP send; the native value is derived from the lossless HDR service histogram and actual sent count. Intended p99 retains every scheduled arrival.

| Cell · offered/s | Sent HTTP mean S / E ms | Intended p99 S / E ms | Achieved S / E per s | SLO passes S / E |
|---|---|---|---|---|
| W4/A 2262 | 14.99 / 14.53 | 1016.07 / 1015.02 | 2177 / 2225 | 0/1 / 0/1 |
| W4/A 3200 | 14.39 / 14.93 | 1015.55 / 1017.12 | 2223 / 2142 | 0/1 / 0/1 |
| W4/B 1600 | 13.90 / 15.76 | 18.71 / 54.53 | 1600 / 1600 | 1/1 / 1/1 |
| W4/B 2262 | 16.94 / 17.41 | 1018.69 / 1019.74 | 1889 / 1838 | 0/1 / 0/1 |
| W5mix/B 1600 | 14.23 / 15.65 | 20.63 / 37.00 | 1600 / 1600 | 1/1 / 1/1 |
| W5mix/B 2262 | 17.11 / 17.84 | 1018.69 / 1020.26 | 1869 / 1793 | 0/1 / 0/1 |


Probe sent-request means exceed the corresponding native means by about 0.2–1.4 ms. This combines observer cost and the blocked run order/shared-host timing; it is not a pure overhead estimate. Phase tables retain probe values, while lever forecasts anchor their level to native residence. No universal correction is applied. The delta uses the median of per-repetition all-sent means; the request ledger below pools successful requests.

| Cell · offered/s | S probe − native ms | E probe − native ms |
|---|---|---|
| W4/A 2262 | 0.16 | 0.99 |
| W4/A 3200 | 1.02 | 0.55 |
| W4/B 1600 | 1.00 | 0.76 |
| W4/B 2262 | 0.33 | 0.51 |
| W5mix/B 1600 | 1.10 | 1.30 |
| W5mix/B 2262 | 0.67 | 0.41 |


## Request residence

The out-of-tree probe runs three complete 10 s / 20 s repetitions at every requested configuration. Numbers below are pooled successful measured-request means, in milliseconds. The raw archive retains every request, error and batch. `HTTP` combines client-send→intake, intake→admission, admission→queue, response encode/write, and client completion; every component is retained separately in [the aggregate](./attribution.json). Intake is tiny_http’s parsed-Request timestamp; client-send→intake includes preceding transport/header parsing. `Q` is mailbox age before collection; `fill` is each member’s remaining collection time; `X` is collection end→final dispatch; `C` is final dispatch→slot confirmation; `release` is slot confirmation→that member’s continuation. The components reconcile per request; the derived CPU terms are not additive residence terms.

| Cell · offered/s | Arm | HTTP | Q | Fill | X | C | Release | Residence |
|---|---|---|---|---|---|---|---|---|
| W4/A 2262 | E | 0.63 | 4.23 | 0.010 | 3.62 | 6.58 | 0.54 | 15.62 |
| W4/A 2262 | S | 0.63 | 4.13 | 0.010 | 3.60 | 6.51 | 0.29 | 15.18 |
| W4/A 3200 | E | 0.63 | 4.15 | 0.010 | 3.62 | 6.49 | 0.56 | 15.45 |
| W4/A 3200 | S | 0.63 | 4.20 | 0.010 | 3.66 | 6.66 | 0.30 | 15.46 |
| W4/B 1600 | E | 0.45 | 3.62 | 0.011 | 4.12 | 7.57 | 0.76 | 16.54 |
| W4/B 1600 | S | 0.42 | 3.16 | 0.010 | 3.95 | 7.17 | 0.24 | 14.95 |
| W4/B 2262 | E | 0.65 | 4.59 | 0.012 | 4.36 | 7.68 | 0.62 | 17.92 |
| W4/B 2262 | S | 0.64 | 4.67 | 0.011 | 4.30 | 7.36 | 0.33 | 17.32 |
| W5mix/B 1600 | E | 0.48 | 3.84 | 0.010 | 4.35 | 7.61 | 0.74 | 17.03 |
| W5mix/B 1600 | S | 0.43 | 3.28 | 0.009 | 4.11 | 7.25 | 0.28 | 15.36 |
| W5mix/B 2262 | E | 0.65 | 4.85 | 0.012 | 4.57 | 7.58 | 0.64 | 18.30 |
| W5mix/B 2262 | S | 0.64 | 4.85 | 0.011 | 4.46 | 7.58 | 0.37 | 17.91 |


## Batch preparation and final flights

Batch phase means below weight batches equally; mean N and I summarize repetition means by their median. The request table weights batch work by the members that actually depended on it. Ordinary W4 batches use three flights. W5 mix batches containing a shared-counter membership dependency use a fourth flight; the census records its frequency. One E W4/A two-batch cascade (19-member predecessor and 5-member successor) aborts before the original COMMITs; the five successor survivors recover serially; it is retained in request and recovery evidence. The level wrapper may run with no probes; it sends no dependent-level flight. `Pre residual` is X minus named SQL flights and the parallel wrapper, not a direct CPU measurement.

| Cell · offered/s | Arm | Mean N | Opener/facts ms | Level flights ms | Parallel ms | Pre residual ms | X ms | Staging CPU ms |
|---|---|---|---|---|---|---|---|---|
| W4/A 2262 | E | 11.21 | 1.86 | 0.000 | 0.51 | 1.13 | 3.49 | 1.10 |
| W4/A 2262 | S | 11.22 | 1.84 | 0.000 | 0.50 | 1.13 | 3.47 | 1.10 |
| W4/A 3200 | E | 11.24 | 1.87 | 0.000 | 0.50 | 1.11 | 3.48 | 1.08 |
| W4/A 3200 | S | 11.21 | 1.91 | 0.000 | 0.51 | 1.12 | 3.53 | 1.09 |
| W4/B 1600 | E | 10.17 | 2.38 | 0.000 | 0.53 | 1.11 | 4.02 | 1.11 |
| W4/B 1600 | S | 9.23 | 2.37 | 0.000 | 0.48 | 1.03 | 3.88 | 1.03 |
| W4/B 2262 | E | 11.49 | 2.42 | 0.000 | 0.53 | 1.20 | 4.14 | 1.17 |
| W4/B 2262 | S | 11.30 | 2.42 | 0.000 | 0.53 | 1.21 | 4.15 | 1.19 |
| W5mix/B 1600 | E | 10.33 | 2.43 | 0.145 | 0.54 | 1.15 | 4.26 | 1.15 |
| W5mix/B 1600 | S | 9.46 | 2.37 | 0.131 | 0.49 | 1.05 | 4.04 | 1.05 |
| W5mix/B 2262 | E | 11.34 | 2.45 | 0.160 | 0.54 | 1.22 | 4.37 | 1.20 |
| W5mix/B 2262 | S | 11.30 | 2.41 | 0.159 | 0.53 | 1.19 | 4.29 | 1.17 |


The advisory-ticket column is the statement’s wall time, followed by off-CPU stall (wall minus thread CPU). Stall can include descheduling; it is not asserted to be exclusively lock sleep. Tail and COMMIT are the actual separate product flight wrappers. The Postgres commit clocks use XID-bearing transaction PRE_COMMIT→COMMIT callbacks, which include the durable flush; the SQL utility hook alone does not. E’s first value is its asynchronous data commit, its second the synchronous marker commit. WAL sync time is a component of COMMIT and must not be added to it. `pg_stat_wal` is whole private-cluster, whole-cohort evidence with ordinary backend reporting lag.

| Cell · offered/s | Arm | Apply/tail flight ms | Ticket wall/stall ms | COMMIT/marker flight ms | PG data / marker COMMIT ms | WAL sync ms | Sync/batch |
|---|---|---|---|---|---|---|---|
| W4/A 2262 | E | 2.60 | 0.03 / 0.02 | 3.84 | 0.01 / 2.83 | 2.63 | 1.021 |
| W4/A 2262 | S | 3.16 | 0.63 / 0.62 | 3.32 | 2.64 / — | 2.60 | 1.022 |
| W4/A 3200 | E | 2.54 | 0.03 / 0.02 | 3.82 | 0.01 / 2.81 | 2.63 | 1.032 |
| W4/A 3200 | S | 3.25 | 0.68 / 0.67 | 3.38 | 2.70 / — | 2.64 | 1.011 |
| W4/B 1600 | E | 3.07 | 0.01 / 0.01 | 4.32 | 0.01 / 2.79 | 2.66 | 1.041 |
| W4/B 1600 | S | 3.25 | 0.47 / 0.46 | 3.84 | 2.65 / — | 2.63 | 1.013 |
| W4/B 2262 | E | 3.16 | 0.04 / 0.03 | 4.32 | 0.01 / 2.80 | 2.64 | 1.036 |
| W4/B 2262 | S | 3.46 | 0.46 / 0.45 | 3.84 | 2.65 / — | 2.60 | 1.019 |
| W5mix/B 1600 | E | 3.14 | 0.01 / 0.01 | 4.31 | 0.01 / 2.76 | 2.65 | 1.043 |
| W5mix/B 1600 | S | 3.34 | 0.46 / 0.45 | 3.83 | 2.64 / — | 2.60 | 1.013 |
| W5mix/B 2262 | E | 3.08 | 0.03 / 0.02 | 4.31 | 0.01 / 2.78 | 2.59 | 1.047 |
| W5mix/B 2262 | S | 3.66 | 0.54 / 0.53 | 3.88 | 2.69 / — | 2.65 | 1.024 |


## Scheduling, durability and release

`Chain` runs from acquisition of the predecessor ticket through the data commit, on the same Postgres backend. `I` is the measured final-dispatch interval. `Done→poll` captures confirmation already waiting for the committer; it separates that delay from time the committer blocks waiting for a slot. D and grant columns are CPU time in the certified-release transitions; their wall clocks and data-commit→publication lag are in the aggregate.

| Cell · offered/s | Arm | Chain ms | I ms | Poll blocked ms | Done→poll ms | D CPU µs/batch | Grant CPU µs/batch | Data→D ms |
|---|---|---|---|---|---|---|---|---|
| W4/A 2262 | E | 2.33 | 5.47 | 1.42 | 0.39 | 1.7 | 1.8 | 3.87 |
| W4/A 2262 | S | 4.90 | 5.31 | 1.29 | 0.08 | 0.0 | 2.1 | — |
| W4/A 3200 | E | 2.26 | 5.46 | 1.39 | 0.41 | 1.6 | 1.8 | 3.87 |
| W4/A 3200 | S | 4.98 | 5.41 | 1.35 | 0.09 | 0.0 | 2.1 | — |
| W4/B 1600 | E | 2.80 | 6.36 | 1.76 | 0.66 | 1.8 | 2.0 | 4.37 |
| W4/B 1600 | S | 5.15 | 5.77 | 1.40 | 0.04 | 0.0 | 2.4 | — |
| W4/B 2262 | E | 2.87 | 6.46 | 1.65 | 0.54 | 1.8 | 1.9 | 4.26 |
| W4/B 2262 | S | 5.36 | 6.11 | 1.35 | 0.11 | 0.0 | 2.2 | — |
| W5mix/B 1600 | E | 2.86 | 6.46 | 1.64 | 0.61 | 1.8 | 2.0 | 4.30 |
| W5mix/B 1600 | S | 5.24 | 5.92 | 1.38 | 0.08 | 0.0 | 2.3 | — |
| W5mix/B 2262 | E | 2.80 | 6.48 | 1.49 | 0.54 | 1.8 | 1.9 | 4.24 |
| W5mix/B 2262 | S | 5.51 | 6.33 | 1.43 | 0.16 | 0.0 | 2.2 | — |


The following distributions are time-weighted over the common measured arrival window. Each entry gives percent time at 0 / 1 / 2 batches. Physical finals end at slot confirmation; unreleased finals end at ordered release; preparing-or-unreleased also includes the committer’s preparation of the next batch. Dispatch-depth histograms alone cannot distinguish these.

| Cell · offered/s | Arm | Physical finals % | Unreleased finals % | Preparing or unreleased % |
|---|---|---|---|---|
| W4/A 2262 | E | 7.2 / 66.7 / 26.1 | 0.0 / 72.9 / 27.1 | 0.0 / 9.8 / 90.2 |
| W4/A 2262 | S | 1.5 / 74.1 / 24.4 | 0.0 / 74.7 / 25.3 | 0.0 / 10.0 / 90.0 |
| W4/A 3200 | E | 7.5 / 66.7 / 25.8 | 0.0 / 73.2 / 26.8 | 0.0 / 9.8 / 90.2 |
| W4/A 3200 | S | 1.6 / 73.3 / 25.1 | 0.0 / 74.1 / 25.9 | 0.0 / 9.7 / 90.3 |
| W4/B 1600 | E | 10.4 / 61.9 / 27.8 | 0.0 / 71.3 / 28.7 | 0.0 / 8.5 / 91.5 |
| W4/B 1600 | S | 0.6 / 74.9 / 24.5 | 0.0 / 74.7 / 25.3 | 0.0 / 8.0 / 92.0 |
| W4/B 2262 | E | 8.4 / 66.0 / 25.7 | 0.0 / 73.5 / 26.5 | 0.0 / 9.5 / 90.5 |
| W4/B 2262 | S | 1.8 / 76.0 / 22.2 | 0.0 / 77.0 / 23.0 | 0.0 / 9.5 / 90.5 |
| W5mix/B 1600 | E | 9.3 / 65.3 / 25.5 | 0.0 / 73.6 / 26.4 | 0.0 / 8.3 / 91.7 |
| W5mix/B 1600 | S | 1.4 / 75.2 / 23.5 | 0.0 / 75.7 / 24.3 | 0.0 / 8.0 / 92.0 |
| W5mix/B 2262 | E | 8.3 / 68.7 / 23.0 | 0.0 / 76.1 / 23.9 | 0.0 / 9.2 / 90.8 |
| W5mix/B 2262 | S | 2.5 / 74.6 / 22.8 | 0.0 / 76.4 / 23.6 | 0.0 / 9.0 / 91.0 |


## CPU cost

Process CPU below comes from the matched native cohorts, sampled at 100 ms across warm-up, measurement and drain, divided by whole-cohort acknowledged writes. PG includes the entire owned private tree and its observer/background work. Units are CPU µs per acknowledged write; parenthesized values are sampled logical CPUs. They are not physical-core utilization percentages. Probe thread clocks additionally split intent, classification/plan, parallel/merge, callbacks and publication in the aggregate.

| Cell · offered/s | Arm | Server µs/write (CPUs) | Proxy µs/write (CPUs) | PG µs/write (CPUs) |
|---|---|---|---|---|
| W4/A 2262 | E | 417 (0.88) | 80 (0.17) | 295 (0.62) |
| W4/A 2262 | S | 423 (0.88) | 81 (0.17) | 275 (0.57) |
| W4/A 3200 | E | 422 (0.88) | 80 (0.17) | 301 (0.62) |
| W4/A 3200 | S | 424 (0.91) | 81 (0.17) | 263 (0.56) |
| W4/B 1600 | E | 438 (0.68) | 94 (0.15) | 340 (0.53) |
| W4/B 1600 | S | 438 (0.68) | 102 (0.16) | 318 (0.50) |
| W4/B 2262 | E | 430 (0.78) | 81 (0.15) | 311 (0.56) |
| W4/B 2262 | S | 431 (0.80) | 82 (0.15) | 276 (0.51) |
| W5mix/B 1600 | E | 437 (0.68) | 97 (0.15) | 343 (0.54) |
| W5mix/B 1600 | S | 443 (0.69) | 103 (0.16) | 324 (0.51) |
| W5mix/B 2262 | E | 435 (0.76) | 84 (0.15) | 319 (0.56) |
| W5mix/B 2262 | S | 432 (0.78) | 84 (0.15) | 280 (0.51) |


## G7.0 comparison and lever forecasts

The G7.0 headline is not an E configuration toggle over the same schedule. Its selected long-run **S** uses **N=32, one active batch, three flights**; **E2** uses **N=16, two active batches, two flights**, with apply/tail and both commits co-dispatched. Both current product modes retain separate tail and COMMIT messages. The distinction is explicit in [the SQL driver](../../postgres-commit-path/src/bin/g70.rs) and [G7.0’s results](../../postgres-commit-path/results-20261025-g70/README.md). G7.0 also omits HTTP, the Quarry interpreter/authority/continuation work, live owner renewal and the production release protocol, and retains a 1M-row commit history. Our canonical fixture has 1M **messages** and 6,688 commit rows after the smoke; these are different cardinalities.

| Term | G7.0 S A / B | G7.0 E2 A / B | Current W4 product evidence |
|---|---:|---:|---|
| Selected long client mean ms | 8.61 / 13.48 | 7.02 / 11.01 | Native high-rung S 14.39 / 16.94; E 14.93 / 17.41 |
| Like-N=16, c=2 short-matrix opener/facts ms | 1.430 / 1.930 | 1.416 / 1.933 | 1.87–1.91 A; 2.42 B, despite mean N≈11 |
| SQL harness encode ms at N=16 | 0.142 / 0.136 | 0.133 / 0.132 | Actual X−P1≈1.6–1.7 ms, including ≈0.5 ms parallel wall; staging CPU≈1.1–1.2 ms/batch |
| N=16 short tail + separate COMMIT ms | 4.856+3.269 / 4.888+3.784 | Combined completion 5.112 / 5.576 | S 3.245+3.383 A, 3.460+3.835 B; E 2.536+3.816 A, 3.159+4.324 B |
| Dependent levels | zero | zero | W4 zero; W5 shared-counter batches add a membership flight, about 0.12–0.15 ms averaged across batches |
| Long-run client minus service ms | ≈0.05 / 3.43 | ≈0.34 / 3.29 | High-rung product mailbox Q≈4.2 A / 4.6–4.9 B, plus HTTP and release |
| Durability | synchronous COMMIT | async data + synchronous marker | Approximately one WAL sync/batch in both product modes; ≈2.6 ms pure sync |
| Post-confirmation release | omitted | omitted | E has ≈0.4 ms A / 0.54 ms B of completed-slot time before the committer polls it |

G7.0’s long confirmations offer 4,525/s on A and 2,262/s on B; the like-N short matrix is closed-loop. The SQL rows use their actual fixed N and load definitions; the product rows use measured variable N at the requested high rungs. The table is a term ledger, not an assertion that unlike-N observations are a controlled causal subtraction. The raw archive retains the source G7.0 aggregates and this run’s model inputs.

**Why E does not help.** On W4 B/2,262, its serialized chain falls **5.36→2.87 ms**, and the predecessor ticket statement falls **0.46→0.04 ms**. Only about **0.42 ms** of ticket wait was available to remove: interpretation/preparation was already overlapping much of the predecessor’s flush. Meanwhile the COMMIT/marker flight rises **3.84→4.32 ms**. Its server commits are ≈0.010 ms async data plus ≈2.801 ms synchronous marker, versus ≈2.651 ms for S. The marker UPDATE itself costs ≈0.028 ms. The rest of the increased flight includes certificate controls/readback, transport, scheduling and driver validation; it is not all charged to CPU. Pure WAL-sync means are close, ≈2.60 / 2.64 ms. E still needs its marker before acknowledgement.

The corresponding slot-confirmation→committer-poll delay rises **0.11→0.54 ms**. Actual per-request release additionally includes ordered completion and each member’s callback. E’s data-commit→D publication averages **4.26 ms** on B; the **D transition CPU is only ≈1.8 µs/batch and grant transition ≈1.9 µs/batch**. Warm admission→queue time is about 0.08 ms on high-rung E W4/B. The measured expense is the certificate/slot/release schedule, not a large per-request HTTP authority lookup or D-lock CPU charge.

The RFC’s uniform `Q≈I/2` assumption is optimistic for the product. B’s high-rung batches average **about 11**, with Q around **0.7–0.8 I**. About **90% of time** has two batches preparing or unreleased, while only about **22–26%** has two final SQL operations physically outstanding. A depth-two dispatch histogram therefore overstates physical database overlap. Mean batch collection itself is only **about 6–7 µs**; the 1 ms constant is a draining cap. A larger fill policy would change phasing and N, rather than remove an existing 1 ms wait.

Aggregate CPU has room: matched native serving+proxy consumes roughly **0.83–1.08 logical CPUs**, and private PG about **0.50–0.62**, across the requested cells. CPU cuts still help the serialized preparation and SQL execution on each batch’s critical path. At W4/B high load, the measured preparation CPU is ≈1.19 ms, including ≈0.23 ms classification/plans, ≈0.40 ms member execution/merge on the committer and ≈0.10 ms intent work; parallel-worker CPU is additional. Post-release callbacks/finishing consume ≈0.29 ms/batch. PG’s tail executor consumes ≈1.02 ms/batch. These are concrete optimization budgets, not evidence that both app cores are exhausted.

**Ranked forecast.** Values below are central screening estimates, anchored to the native high-rung mean. B shows W4 / W5 mix; A shows W4/3,200, extrapolated against the 7.07 ms population bound at 4,525. Individual forecasts are alternatives, not additive claims. The combination recomputes the interval bound. [Model and all scenario inputs](./lever-model.json).

| Priority / lever | Predicted B residence ms | Predicted A residence ms | Threshold implication |
|---|---:|---:|---|
| **1. Combined G7.3 + halve preparation/merge and PG-tail CPU + prompt release** | **13.3 / 13.3** | **11.3** | Identified path to ≤14.15 B under stated targets; A still misses |
| 2. G7.3 two-flight final, including +0.10 ms raising-assertion allowance | 15.1 / 15.2 | 13.0 | Alone misses B and A |
| 3. Halve PG-tail executor CPU (JSON/vector-tail execution and row/index work, ≈1.0–1.1→0.5–0.55 ms/batch) | 15.8 / 15.8 | 13.1 | Alone misses both |
| 4. Halve serialized preparation and callback CPU (≈1.2→0.6 ms and ≈0.29→0.15 ms/batch) | 16.0 / 16.2 | 13.8 | Alone misses both; aggregate spare cores do not remove this residence term |
| 5. E at depth three, chain already short; one reader becomes the third writer | 16.3 / 16.8 | 13.9 | Slot model improves; alone misses. S’s longer chain makes depth three less attractive |
| 6. Promptly poll/release E’s already-confirmed results | 16.9 / 17.3 | 14.5 | Removes the measured ≈0.54 ms B / ≈0.41 ms A delay, without removing durability waits |
| 7. Halve measured HTTP intake/admission/encode/loopback residence | 16.6 / 16.8 | 14.1 | Small budget. Optimizing proxy overhead must preserve the injected delay; the configured RTT is not removable work |
| 8. Fold W5’s hot-counter membership dependency into its opener | W5 ≈16.9–17.0; W4 unchanged | unchanged | Roughly 0.1–0.2 ms opportunity, not the B gap |
| 9. Remove collection time alone / experiment with bounded fill | ≈16.9 / 17.1 for direct removal | ≈14.4 | Direct budget <0.02 ms. New fill/N behavior needs measurement and can increase residence |
| 10. Concurrent disjoint commits, RFC option C | **Product unresolved**; SQL bound 10.52–10.65 | **Product unresolved**; SQL bound 6.93–6.94 | Its visibility/publication layer and native scheduler are unbuilt. No supported product target claim; less than 0.6 ms current S ticket wait and almost none in E cannot fund the whole gap |

The [RFC §5](../../../../llp/3000.009.001.000.000.002-pipelined-group-commit.rfc.md#5-budget-flights-cpu-and-latency) screening calculation uses measured `X`, `C0=C−ticket`, chain, post CPU and `Q/I`, with `I=max(X+post,(X+C0+post)/d,chain)`. For G7.3 it removes about **0.6 / 1.1 ms** of flight RTT on A / B, charges 0.10 ms for required server checks, and bounds residual ticket wait. Halving CPU assumes those measured critical-path budgets are actually achieved. Prompt release removes the measured completed-before-poll delay. The model holds mean N and residual scheduler work fixed, then compares the changed max-bound and Q; it does not solve a new batch-size distribution. Separate screens allow unchanged poll timing to absorb some shortened C and add **±1 ms of residual sensitivity**, not a confidence interval. The combined B screen is about **12.3–14.3 ms**; implementation can still miss 14.15, so a 12.7 ms working target is preferable to consuming all slack. **No individual lever is shown sufficient for B, and no forecast here supports A≤7.07 ms.**

No product variant, new fill policy, depth-three writer, option C or durability relaxation is built by this lane.


## Method, custody and limits

Product base is `5059edecb3`, local `sb4-pg/main-wa`, measured on `sb4-pg/s1-wa`; no origin fetch. Both product binaries are release opt-level 3 with core-only `debug-assertions=true`, no test-support feature, preserving the prior E flush-position witness. Native and probe S/E use the same qualification build configuration. Product, runner, schema, authorization, deadlines, counters and commit protocol are unchanged. The probe adds clocks only in an outside-repository copy, plus a numeric-only private Postgres session-preload library. Its generator adds numeric clocks and a trace header; its distinct package name prevents Cargo artifact reuse. [Source/binary custody](./method.json).

The canonical `Engine::seed_at` fixture contains 1M messages and correct maintained state. PG16.15 uses the inherited fsync/full_page_writes/synchronous_commit-on configuration; E changes only data transactions and acknowledges after its synchronous marker. G6 is configured as `SNAPBACK4_READ_GRANT_CLOCK_BOUNDS=1000,250`, with single-owner `ha=none`. Writes retain 32 open-loop clients/cap 32. PG is pinned to 0–2,6–8; serving/proxy to 3–4,9–10; generators to 5,11. A adds 250 µs/direction; B 500 µs/direction. Fresh services, RTT captures, live affinity witnesses, host-start checks and whole-cohort counter equality are retained from the unchanged [one-host runner](../scripts/s1-onehost.py).

Setup evidence is retained separately: the first probe build selected the host toolchain, then clock-dependency/lint setup was corrected; a same-name Cargo generator artifact was detected and rebuilt under a distinct probe package; the SQL utility COMMIT hook was replaced before the main matrix; and a quoted empty preload-list reset refused before any main-matrix trial. That first cluster stopped cleanly and its runner removed the fixture. The replacement uses RESET, an explicit fresh-role connection check and a retained validated fixture snapshot. The short smokes and all setup attempts are excluded from the main tables. A separate cold S warm-up also has a 13/7-member two-batch abort cascade; it is outside the measured request ledger and retained in the whole-cohort traces. The release-order census passes for all six probe service cells. One 4.85-second manual generator rebuild lacks a complete PID/birth census; the final recorded-identity and target-executable scans confirm cleanup.

Audit: **48 main trials**, **2,109,760 measured scheduled arrivals**, 48 counter equality checks; 32 disqualified trials retained; 1,311,686/1,311,686 successful measured probe requests join to batch clocks. The fixed overload cohorts contain 119,543 unacknowledged warm-up arrivals (outside the measured SLO), 346,987 measured errors, of which 343,762 expire before HTTP send. Both whole-cohort counter checks and all failed observations remain. Every additive ledger reconciles, the ordinary W4 and W5 membership-dependent flight censuses agree with the protocol, recorded data/marker commit counts match, and measured distributions sum to one. [Validation](./validation.json).

Raw evidence stays outside Git at `/home/ccheever/sb4scale/archive/s1-write-attribution-20261026.tar.gz`. **SHA-256: `883997dfafa4af2020d9a1a37c558b2a2887aee4c523b4aabf61e09ed8918c8c`**. It contains all trials, lossless HDR/stdout, failed cohorts, numeric traces, samplers, source/probe/build records and setup attempts. [Archive receipt](./archive.json).

Repository checks pass: JSON parsing, local Markdown targets and `./ref-check --verbose` (569 LLPs, 12,046 refs, zero errors/unchecked). The affected selector plan uses the supplied local base and maps these result paths to broad/unknown scope. This report-only landing does not claim execution of the broad product battery or publication qualification.

No push, stash, Git configuration change, publication, paid resource or product change. Raw records are scanned before private credential directories are removed; sealed values support a later scan of exact staged UTF-8 blobs and are then removed. All owned benchmark/build/observer processes and both private campaign clusters are stopped; PID/birth and target-executable scans include zombies. **PIDs left: none.**
