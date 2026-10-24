# M-suite — matched one-host PostgreSQL measurements

**M0 coverage: 260/260 cells, 52/52 fit groups.** The commissioned disk guard stopped all owned processes at 2026-10-23T22:50:21.895128+00:00, with 29.993 GiB free. After space recovered and the host was quiet, a fresh byte-identically configured cluster supplied a separately recorded second epoch. All interrupted and earlier measurements remain retained. M1b, M2 witnesses and M3 retain their distinct experiment/model scopes.

M0 measures the existing G3b SQL write set; M2 tests ordered flights; M3 is a closed-loop simulator using those measured costs; M1b measures independent W2 read pipelining. **These are experiment results, not an engine capacity, publication, or twelve-cell G9 claim.** The host is expo-build-450b (`expose-builder-pixel-a`). The requested directory date is 20261024; UTC timestamps in the retained evidence determine the actual interval.

The design is [LLP 3000.009.001.000.002](../../../../llp/3000.009.001.000.002-beating-the-postgres-controls.rfc.md), especially §§3.4, 5–6, 10.1, 10.7 and 12. The topology follows [S1-PG4](../../scale-controls/results-20261024-snapback-postgres-b1-onehost/README.md). No product source, durability setting, ceiling or public history representation changes.

## Decisions and the warm write marginal

All fits below are OLS over N=1/4/16/32/64, independently for each repetition. `e_total` is measured window time per batch versus N, including payload, driver, collection/dequeue and per-member notification work. It excludes future engine execution. Table entries are medians of three independent slopes; the full per-run fits follow.

| Link | Variant | e_server µs/member | e_total producers µs/member | e_total one client µs/member | Worst producer transaction p99 ms | Both scan intervals clean |
|---|---|---|---|---|---|---|
| A | full | 31.55 | 37.91 | 33.88 | 125.02 | True |
| A | no_ops | 28.29 | 32.84 | 34.44 | 10.62 | True |
| A | batch_tail | 21.11 | 23.58 | 19.00 | 9.91 | True |
| A | r_only | 6.20 | 12.03 | 5.09 | 16.72 | True |
| B | full | 38.82 | 39.33 | 24.75 | 14.24 | True |
| B | no_ops | 31.94 | 31.43 | 25.29 | 22.43 | True |
| B | batch_tail | 16.31 | 26.69 | 18.98 | 12.28 | True |
| B | r_only | 6.29 | 17.12 | 6.07 | 15.04 | True |


The separate existing S1 increment arm measures **561.79 µs/mutation of calling-thread Rust CPU**. It times `Engine::mutate` with `CLOCK_THREAD_CPUTIME_ID`, after native account-session resolution. This includes the existing engine, its codecs/meters and caller-side driver work; it excludes SQL wait and the driver's background I/O thread. It is a solo-path CPU proxy, not a measured overlay interpreter budget. It is never pooled with M0 observations.

The observed component results support the following next branches. A product whole-cycle verdict still requires G3 engine-tail confirmation and measured incremental overlay CPU; pure harness/model headroom is insufficient:

- **Keep current-layout G2/G3/bounded G3b and engine-owned plan hygiene.** Cold RI cliffs select plan hygiene, not A/F. Warm server row work must reach the RFC's ≥100 µs/member binding threshold before A-for-writes or F can be commissioned. Server means, window slopes, flush tails and Rust CPU remain separate.
- **Do not cancel A/F permanently from this harness.** G3 must still confirm the engine's `_change_evidence` insert/prune tail and the composed M0–M3 product cycle. The harness `_s1a_footprints`/`_ops` are proxies; `batch_tail` changes sequence/history representation and is a cost bound only.
- **Retain three flights as the current policy.** The two-flight witnesses qualify this experiment's mechanism; product use still requires the parent round-trip/store retry amendments. Any unresolved transport loss after co-dispatch remains unknown, with no automatic retry.
- **Evaluate bounded reader pipelining before commissioning G5/G6/D for delayed reads.** The per-connection ceilings below are optimistic pool multiplication, not loaded admission/SLO qualification. Fixed 30 readers, 32 total connections and 128 external clients remain the product constraints.
- **Use actual N/Q and the measured CPU/service ledger.** M3 model passes do not qualify a product collection policy. A fill miss is not evidence for a row migration.

## Method and custody

Worktree `/home/ccheever/projects/sb4-msuite`, branch `sb4-pg/msuite`, starts at `origin/sb4-pg/main-mirror` (`c3f90a337d`) and integrates the requested experiment commits `e26d1ebc95` and `8848186b2f` as `63ba136104` and `410272d23a`. Only a JOURNAL append and this results directory are added by the result commit. Transient harness source and build artifacts remain outside the committed paths. Builds are release, `-j 10`, in this worktree's own `target-msuite/build`, with `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`.

Private PG16.15 uses direct 127.0.0.1 TCP, trust authentication restricted to this private local cluster, fsync/synchronous_commit/full_page_writes on, fdatasync, 8 GiB shared buffers, 320 connections, JIT off, 4 GiB/1 GiB max/min WAL, IO and WAL timing enabled. PostgreSQL owns cores 0–2/6–8, the existing Rust delay proxy 3–4/9–10, and measured clients 5/11. SMT siblings stay together. This shares memory/storage and lacks a physical host boundary; it is not a substitute for a matched multi-host comparative campaign.

Link A adds 250 µs each direction; B adds 500 µs each direction. The proxy forwards delayed chunks in order and permits chunks to pipeline; both proxy socket ends use TCP_NODELAY. M1b independently toggles the client socket. The M0 idle guard is pre-registered at 5.5 ms for A / 6 ms for B p99, using three 200-query prepared captures after warm-up before each primary cell, with another after it. Captures, all per-run load averages/top processes and continuous PID identities are retained in the raw archive. Loaded or flush tails are retained capacity/cost observations, without environmental rejection.

450a was checked read-only: loadavg **11.55 / 8.63 / 6.75**, then **17.01 / 15.29 / 11.26** at the later gate. Its one-minute load exceeded 2 at both checks, so the optional SSH arm was **excluded**. No action was taken on `~/q24`. The historical S1b SSH marginal therefore remains unreconciled by a cross-host write run.

This lane matches S1-PG4's local topology, core split, PG version and durable settings, but uses its own component windows and environmental rule. The shared host was not reserved. A continuous 0.5-second watcher retained and excluded timed cells overlapping known foreign Cargo/Rustc/q24-check activity; idle RTT failures waited before timing. It did not reject every unrelated process above one core. Load averages and top-process samples are disclosed rather than treated as proof of machine isolation. Early top samples use lifetime ps CPU; later samples use a short /proc CPU delta, so their percentages are not directly comparable.

M0 runs three independent repetitions per setting, each with 250 ms warm-up and 1 s measured window, plus 12 EXPLAIN ANALYZE probes after timing. These short component windows are not the G9 10/20-second comparative campaign. One client is compared with `max(4,2N)` closed-loop producer threads and per-member completion notifications, a single committer, and fixed N. N=64 is attribution only; it is never treated as available with the product's C=32.

Current main has already removed the legacy `_log → _commits` FK. The `fresh`, `warm` and `generic` arms deliberately restore that legacy FK to attribute the published G3b cliff. `fresh` analyzes a one-row `_commits` then reuses the backend. `warm` pre-grows valid history to 8,193 commit rows before ANALYZE and a new backend; `generic` does the same with force_generic_plan. Packed-tail preparation uses 8,192 one-member logical records in one untimed physical transaction so its commit cardinality is genuinely mature. `r_only` has no tail growth/RI lookup. The `unanalyzed` full-tail comparator omits ledger ANALYZE; `current` keeps the current no-FK shape with tiny ANALYZE. These extra controls use one client on both links.

Both `_commits` and `_log` seq_scan/seq_tup_read and index deltas are captured independently across warm-up and measurement, with observer/setup counters flushed before baselines. Zero means zero hot-path scans, not an adjusted median. A scan in either interval labels the entire cell **plan-contaminated**. EXPLAIN probes, final counts/images and setup scans are outside these deltas. Every durable statement verifies all count outputs; final counter images and applicable head/history counts are checked. Producer acknowledgements are sampled only when completed in the measured window and after durable COMMIT; teardown wake-ups are excluded. Earlier all-phases notification attempts remain separately retained with their valid SQL timings and are not used as a window-acknowledgement claim.

WAL LSN deltas are the primary byte count. pg_stat_wal is cluster-wide, can lag, and includes checkpoints/maintenance; its write/sync counts and milliseconds are recorded separately. EXPLAIN excludes durable COMMIT and includes instrumentation; its marginal is not WAL-only time. Per-run slope spreads and all worst p99 values remain visible.

Setup interruptions are retained: initial background launches ended with their tool shell and were restarted in supervised foreground sessions; an observer-flush baseline correction; a producer shutdown wait correction; mature packed-tail preparation correction; an e_rust ingress call missing its required store-id binding; and an extra COMMIT-timeout control whose initial expected cancellation was contradicted by this server. None is silently promoted into a successful measurement. Completed primary measurements remain retained. Source/binary receipts distinguish the preparation/teardown revisions; the timed G3b statement texts remain unchanged.

M0 and full-tail M2 retain per-repetition host snapshots; M1b retains them per entry control and pipeline repetition. The e_rust arm has enclosing before/after host snapshots for its three repetitions, rather than individual repetition boundaries. Its timing scope is consequently narrower than a per-run environmental qualification. Continuous load/PID evidence remains in the archive. The 80 M3 cells are simulated repetitions, not 80 physical host capacity trials.

## M0 — every per-run fit

Slash-separated entries are repetitions 1/2/3. Fixed and marginal terms belong to the same measured fit; no S1b intercept is imported. `P` means producers, `S` one synchronous client. The scan verdict covers every N and both intervals.

| Link | Plan | Variant | Client | Window fixed µs, each run | e_total µs/member, each run | e_server µs/member, each run | e_txn µs/member, each run | Worst txn p99 ms | Verdict | Epochs |
|---|---|---|---|---|---|---|---|---|---|---|
| A | current | full | S | 4881.6/4843.6/4845.0 | 24.19/24.86/24.66 | 24.67/29.06/30.75 | 23.32/24.01/23.79 | 9.02 | clean | 2 |
| A | fresh | batch_tail | P | 5435.8/5162.2/6053.3 | 21.07/31.95/9.35 | 32.23/39.58/26.83 | 15.34/27.05/3.74 | 15.86 | plan-contaminated | 1 |
| A | fresh | batch_tail | S | 5113.2/4866.7/4593.7 | 25.58/28.27/58.73 | 35.42/39.09/40.50 | 24.93/27.68/58.12 | 80.57 | plan-contaminated | 1 |
| A | fresh | full | P | 3934.9/4619.3/3043.3 | 294.53/230.16/440.59 | 319.47/343.48/251.17 | 288.79/222.86/431.75 | 333.35 | plan-contaminated | 1 |
| A | fresh | full | S | 4603.1/4683.0/4701.7 | 203.71/221.17/206.86 | 311.80/304.61/300.05 | 202.77/220.29/205.88 | 58.73 | plan-contaminated | 1 |
| A | fresh | no_ops | P | 6082.7/5410.3/6049.1 | 217.80/224.56/213.66 | 300.14/302.71/318.60 | 206.69/214.20/207.70 | 177.68 | plan-contaminated | 1,2 |
| A | fresh | no_ops | S | 4531.7/4286.4/3310.3 | 206.82/224.92/312.97 | 337.14/344.89/252.45 | 206.26/224.12/312.31 | 290.78 | plan-contaminated | 1 |
| A | fresh | r_only | P | 4393.7/5251.1/4909.8 | 34.72/12.09/6.64 | 7.61/6.58/7.34 | 27.34/5.96/1.60 | 68.13 | clean | 1,2 |
| A | fresh | r_only | S | 4939.6/4824.3/4828.9 | 3.40/3.00/5.77 | 7.55/4.43/3.50 | 2.80/2.39/5.16 | 14.80 | clean | 1 |
| A | generic | batch_tail | P | 5015.9/4634.2/4837.6 | 22.79/31.13/22.58 | 22.05/15.58/20.58 | 16.65/25.59/17.53 | 31.35 | clean | 2 |
| A | generic | batch_tail | S | 5391.4/4726.4/4945.9 | 8.82/21.12/18.10 | 21.55/19.25/18.97 | 8.24/20.47/17.44 | 19.05 | clean | 2 |
| A | generic | full | P | 5296.9/5312.8/5322.3 | 30.83/31.50/35.24 | 22.42/40.26/37.32 | 24.91/25.97/29.62 | 58.72 | clean | 2 |
| A | generic | full | S | 5093.3/5378.2/5095.0 | 28.53/28.65/33.68 | 31.61/41.63/22.74 | 27.76/27.77/32.83 | 26.44 | clean | 2 |
| A | generic | no_ops | P | 4943.9/4907.3/4645.9 | 36.46/38.33/65.39 | 16.54/14.24/36.74 | 30.69/32.98/59.85 | 41.85 | clean | 2 |
| A | generic | no_ops | S | 5007.3/4853.1/4885.7 | 21.34/25.94/28.88 | 20.50/19.04/22.44 | 20.75/25.33/28.23 | 13.57 | clean | 2 |
| A | generic | r_only | P | 5282.8/4890.7/5016.0 | 1.32/19.09/1.83 | 5.67/5.06/4.36 | -5.28/13.29/-3.65 | 81.83 | clean | 2 |
| A | generic | r_only | S | 4775.1/5108.6/4907.1 | 3.83/-0.13/2.11 | 6.64/6.34/6.85 | 3.19/-0.76/1.47 | 18.03 | clean | 2 |
| A | unanalyzed | full | S | 5183.7/5174.4/5338.3 | 35.15/32.17/23.16 | 30.32/37.65/31.21 | 34.40/31.29/22.39 | 18.03 | clean | 2 |
| A | warm | batch_tail | P | 4977.9/4920.1/4857.7 | 18.52/23.58/27.52 | 21.11/9.07/21.74 | 11.82/17.06/20.44 | 9.91 | clean | 1 |
| A | warm | batch_tail | S | 5326.8/4918.6/4730.0 | 15.28/19.00/24.51 | 20.33/16.66/25.59 | 14.58/18.35/23.86 | 18.36 | clean | 1 |
| A | warm | full | P | 5027.3/4872.4/6058.3 | 37.91/44.48/29.01 | 38.31/31.55/25.62 | 31.63/37.86/22.85 | 125.02 | clean | 1 |
| A | warm | full | S | 5055.7/4926.5/5025.2 | 33.88/30.37/35.94 | 39.02/31.38/40.49 | 33.09/29.48/35.15 | 32.85 | clean | 1 |
| A | warm | no_ops | P | 4922.5/4911.7/4896.1 | 34.38/31.59/32.84 | 21.09/28.29/30.63 | 27.15/24.89/26.09 | 10.62 | clean | 1 |
| A | warm | no_ops | S | 4848.6/4996.0/4746.1 | 34.44/25.62/50.03 | 21.61/27.18/30.63 | 33.82/25.03/49.35 | 118.04 | clean | 1 |
| A | warm | r_only | P | 4773.7/4717.9/5164.2 | 15.98/12.03/4.96 | 5.22/6.20/6.73 | 9.38/6.10/-0.56 | 16.72 | clean | 1 |
| A | warm | r_only | S | 4770.1/4731.5/4971.3 | 5.09/5.54/-1.19 | 8.06/5.39/6.80 | 4.47/4.92/-1.83 | 36.15 | clean | 1 |
| B | current | full | S | 6275.6/6326.8/6346.3 | 28.96/28.54/26.66 | 28.41/15.75/28.40 | 28.10/27.66/25.82 | 16.68 | clean | 2 |
| B | fresh | batch_tail | P | 6778.2/9499.5/6489.1 | 31.94/146.03/29.76 | 33.87/31.87/43.11 | 25.22/139.14/23.64 | 512.93 | plan-contaminated | 2 |
| B | fresh | batch_tail | S | 6317.6/6365.7/6742.7 | 32.35/28.36/24.67 | 36.65/18.76/37.50 | 31.73/27.70/24.07 | 53.64 | plan-contaminated | 2 |
| B | fresh | full | P | 6123.2/5943.3/6211.0 | 222.91/216.73/211.48 | 277.00/260.33/255.91 | 215.39/209.11/204.34 | 22.41 | plan-contaminated | 2 |
| B | fresh | full | S | 6655.4/6189.9/6004.9 | 183.46/210.96/198.70 | 261.46/264.84/253.17 | 182.61/210.12/197.83 | 32.29 | plan-contaminated | 2 |
| B | fresh | no_ops | P | 5955.7/5936.9/5851.2 | 204.79/231.05/224.22 | 277.69/248.06/255.86 | 197.32/224.32/216.86 | 61.27 | plan-contaminated | 2 |
| B | fresh | no_ops | S | 6265.1/5835.8/5670.5 | 194.69/233.61/262.58 | 281.10/238.91/240.22 | 194.04/232.92/261.87 | 92.68 | plan-contaminated | 2 |
| B | fresh | r_only | P | 6289.3/6166.6/6098.8 | 9.65/14.52/15.17 | 4.65/6.79/6.87 | 4.58/7.94/7.98 | 9.81 | clean | 2 |
| B | fresh | r_only | S | 6854.5/6183.5/6738.6 | -2.36/6.86/-2.97 | 6.55/6.38/6.48 | -2.99/6.26/-3.56 | 61.65 | clean | 2 |
| B | generic | batch_tail | P | 7363.5/6308.9/6152.3 | 13.59/23.75/30.12 | 20.38/16.14/20.68 | 7.59/17.80/23.91 | 344.50 | clean | 2 |
| B | generic | batch_tail | S | 6213.9/6154.2/6272.7 | 22.13/22.07/21.46 | 14.15/19.47/20.71 | 21.49/21.44/20.80 | 13.84 | clean | 2 |
| B | generic | full | P | 6592.0/6458.1/6506.5 | 35.54/36.57/43.02 | 22.15/20.83/19.70 | 29.42/30.53/36.87 | 28.49 | clean | 2 |
| B | generic | full | S | 6417.5/6453.6/6603.3 | 32.03/30.83/29.37 | 18.12/19.18/36.69 | 31.16/29.98/28.51 | 14.33 | clean | 2 |
| B | generic | no_ops | P | 6402.1/6161.8/6400.8 | 32.80/58.82/38.50 | 27.14/22.03/25.03 | 27.15/52.42/32.65 | 150.55 | clean | 2 |
| B | generic | no_ops | S | 6273.3/6103.0/6370.5 | 29.58/56.89/25.55 | 32.56/14.74/32.72 | 28.94/56.25/24.91 | 22.36 | clean | 2 |
| B | generic | r_only | P | 6452.3/6408.8/6299.0 | 5.91/10.63/10.06 | 5.12/6.41/5.33 | -0.10/4.17/4.62 | 13.87 | clean | 2 |
| B | generic | r_only | S | 6155.8/6234.3/6136.4 | 6.44/3.96/5.83 | 6.41/6.96/6.74 | 5.79/3.35/5.24 | 14.45 | clean | 2 |
| B | unanalyzed | full | S | 6590.1/6455.3/6497.1 | 33.08/30.96/32.18 | 33.23/39.34/37.78 | 32.25/30.13/31.34 | 14.12 | clean | 2 |
| B | warm | batch_tail | P | 6428.5/6393.9/6390.6 | 26.43/26.97/26.69 | 20.17/16.31/12.83 | 19.91/20.67/20.22 | 12.28 | clean | 1 |
| B | warm | batch_tail | S | 6368.1/6469.5/6330.3 | 18.98/17.24/18.98 | 22.45/21.44/21.83 | 18.35/16.60/18.34 | 10.27 | clean | 2 |
| B | warm | full | P | 6410.9/6436.9/6390.6 | 39.33/38.49/41.28 | 36.68/38.92/38.82 | 32.35/31.37/35.02 | 14.24 | clean | 1 |
| B | warm | full | S | 6992.1/6584.3/6673.6 | 24.39/31.59/24.75 | 38.02/37.99/39.62 | 23.44/30.74/23.94 | 16.93 | clean | 1,2 |
| B | warm | no_ops | P | 6414.5/6554.0/6514.0 | 32.68/31.43/30.03 | 31.94/23.39/32.32 | 26.20/24.55/23.33 | 22.43 | clean | 1 |
| B | warm | no_ops | S | 6390.9/6479.0/6407.5 | 25.04/25.29/27.11 | 33.57/19.33/26.97 | 24.33/24.63/26.45 | 11.89 | clean | 2 |
| B | warm | r_only | P | 6225.3/6145.2/6185.6 | 8.80/17.12/18.62 | 6.29/7.82/5.38 | 2.96/11.77/13.03 | 15.04 | clean | 1 |
| B | warm | r_only | S | 6160.4/6218.2/6161.6 | 6.74/6.07/6.07 | 6.59/6.53/5.25 | 6.08/5.43/5.42 | 12.45 | clean | 2 |


Epochs identify the cluster incarnation supplying the N cells in each fit. Fits marked 1,2 span the restart and are descriptive cross-epoch regressions, not paired restart experiments. All eight decision-leading warm producer fits use epoch 1 only. Fresh schemas are independent at every N and repetition; a new epoch does not preserve earlier schema or cache state. Negative or unstable slopes remain observations, with per-run R² in m0.json.gz; no nonnegative fit is imposed.

## M0 coverage and unmeasured cells

Each completed N has all three repetitions. No slope is interpolated for an incomplete group; missing values remain unmeasured.

| Plan | Link | Variant | Client | Completed N | Unmeasured N |
|---|---|---|---|---|---|
| fresh | A | full | single | 1,4,16,32,64 | none |
| fresh | A | full | producers | 1,4,16,32,64 | none |
| fresh | A | no_ops | single | 1,4,16,32,64 | none |
| fresh | A | no_ops | producers | 1,4,16,32,64 | none |
| fresh | A | batch_tail | single | 1,4,16,32,64 | none |
| fresh | A | batch_tail | producers | 1,4,16,32,64 | none |
| fresh | A | r_only | single | 1,4,16,32,64 | none |
| fresh | A | r_only | producers | 1,4,16,32,64 | none |
| fresh | B | full | single | 1,4,16,32,64 | none |
| fresh | B | full | producers | 1,4,16,32,64 | none |
| fresh | B | no_ops | single | 1,4,16,32,64 | none |
| fresh | B | no_ops | producers | 1,4,16,32,64 | none |
| fresh | B | batch_tail | single | 1,4,16,32,64 | none |
| fresh | B | batch_tail | producers | 1,4,16,32,64 | none |
| fresh | B | r_only | single | 1,4,16,32,64 | none |
| fresh | B | r_only | producers | 1,4,16,32,64 | none |
| warm | A | full | single | 1,4,16,32,64 | none |
| warm | A | full | producers | 1,4,16,32,64 | none |
| warm | A | no_ops | single | 1,4,16,32,64 | none |
| warm | A | no_ops | producers | 1,4,16,32,64 | none |
| warm | A | batch_tail | single | 1,4,16,32,64 | none |
| warm | A | batch_tail | producers | 1,4,16,32,64 | none |
| warm | A | r_only | single | 1,4,16,32,64 | none |
| warm | A | r_only | producers | 1,4,16,32,64 | none |
| warm | B | full | single | 1,4,16,32,64 | none |
| warm | B | full | producers | 1,4,16,32,64 | none |
| warm | B | no_ops | single | 1,4,16,32,64 | none |
| warm | B | no_ops | producers | 1,4,16,32,64 | none |
| warm | B | batch_tail | single | 1,4,16,32,64 | none |
| warm | B | batch_tail | producers | 1,4,16,32,64 | none |
| warm | B | r_only | single | 1,4,16,32,64 | none |
| warm | B | r_only | producers | 1,4,16,32,64 | none |
| generic | A | full | single | 1,4,16,32,64 | none |
| generic | A | full | producers | 1,4,16,32,64 | none |
| generic | A | no_ops | single | 1,4,16,32,64 | none |
| generic | A | no_ops | producers | 1,4,16,32,64 | none |
| generic | A | batch_tail | single | 1,4,16,32,64 | none |
| generic | A | batch_tail | producers | 1,4,16,32,64 | none |
| generic | A | r_only | single | 1,4,16,32,64 | none |
| generic | A | r_only | producers | 1,4,16,32,64 | none |
| generic | B | full | single | 1,4,16,32,64 | none |
| generic | B | full | producers | 1,4,16,32,64 | none |
| generic | B | no_ops | single | 1,4,16,32,64 | none |
| generic | B | no_ops | producers | 1,4,16,32,64 | none |
| generic | B | batch_tail | single | 1,4,16,32,64 | none |
| generic | B | batch_tail | producers | 1,4,16,32,64 | none |
| generic | B | r_only | single | 1,4,16,32,64 | none |
| generic | B | r_only | producers | 1,4,16,32,64 | none |
| unanalyzed | A | full | single | 1,4,16,32,64 | none |
| unanalyzed | B | full | single | 1,4,16,32,64 | none |
| current | A | full | single | 1,4,16,32,64 | none |
| current | B | full | single | 1,4,16,32,64 | none |


## Retained earlier SQL timings

These completed observations have valid SQL/EXPLAIN/window timings, including the bad tails below. Their all-phases notification diagnostic includes teardown and is not a measured-window acknowledgement sample, so the producer cells were repeated with window-only durable acknowledgement instrumentation. Earlier observations are retained rather than erased. Binary/preparation/observer revisions differ; do not splice their slopes or hide their worst p99 values.

| Link | Plan | Variant | N | Server mean µs | Transaction mean µs | Window mean µs | Worst transaction p99 ms |
|---|---|---|---|---|---|---|---|
| A | fresh | batch_tail | 1 | 260.8 | 4895.0 | 4903.3 | 9.14 |
| A | fresh | batch_tail | 16 | 1179.8 | 5416.2 | 5517.1 | 16.43 |
| A | fresh | batch_tail | 32 | 1603.2 | 5827.1 | 6014.6 | 21.91 |
| A | fresh | batch_tail | 4 | 447.5 | 5815.8 | 5834.2 | 130.28 |
| A | fresh | batch_tail | 64 | 1812.7 | 6462.7 | 6820.7 | 19.90 |
| A | fresh | full | 1 | 375.8 | 5056.3 | 5067.0 | 14.55 |
| A | fresh | full | 16 | 4605.7 | 7396.6 | 7498.8 | 10.79 |
| A | fresh | full | 32 | 7793.2 | 11251.1 | 11475.2 | 58.30 |
| A | fresh | full | 4 | 877.2 | 5294.4 | 5318.5 | 22.40 |
| A | fresh | full | 64 | 18788.9 | 17213.2 | 17665.1 | 31.10 |
| A | fresh | no_ops | 1 | 365.2 | 4983.0 | 4991.2 | 6.77 |
| A | fresh | no_ops | 16 | 4477.1 | 7649.5 | 7768.1 | 10.58 |
| A | fresh | no_ops | 32 | 8069.5 | 11321.8 | 11520.0 | 59.96 |
| A | fresh | no_ops | 4 | 563.5 | 5326.1 | 5348.3 | 10.48 |
| A | fresh | no_ops | 64 | 19425.2 | 17581.1 | 17974.7 | 30.00 |
| A | fresh | r_only | 1 | 66.9 | 4635.8 | 4642.7 | 9.21 |
| A | fresh | r_only | 16 | 314.2 | 4795.9 | 4888.9 | 11.95 |
| A | fresh | r_only | 32 | 347.6 | 4980.9 | 5174.4 | 11.96 |
| A | fresh | r_only | 4 | 80.8 | 5124.2 | 5150.0 | 21.01 |
| A | fresh | r_only | 64 | 402.7 | 5022.7 | 5370.6 | 9.35 |
| A | warm | batch_tail | 1 | 233.4 | 5413.6 | 5422.9 | 34.21 |
| A | warm | batch_tail | 16 | 379.9 | 5173.4 | 5269.1 | 13.51 |
| A | warm | batch_tail | 4 | 324.7 | 5151.8 | 5172.0 | 13.08 |
| A | warm | full | 1 | 362.0 | 4924.3 | 4934.0 | 8.08 |
| A | warm | full | 16 | 1131.3 | 5710.5 | 5811.7 | 19.73 |
| A | warm | full | 32 | 1549.8 | 5924.4 | 6109.9 | 15.38 |
| A | warm | full | 4 | 504.8 | 4970.9 | 4988.4 | 11.89 |
| A | warm | full | 64 | 1749.9 | 8570.8 | 8926.7 | 297.30 |
| A | warm | no_ops | 1 | 259.4 | 5184.8 | 5193.4 | 95.74 |
| A | warm | no_ops | 16 | 683.3 | 5329.5 | 5434.5 | 7.82 |
| A | warm | no_ops | 32 | 1045.1 | 6196.3 | 6396.8 | 21.67 |
| A | warm | no_ops | 4 | 467.2 | 4997.7 | 5019.3 | 13.41 |
| A | warm | no_ops | 64 | 2104.5 | 6841.7 | 7287.1 | 404.42 |


## M0 — every N cell and WAL/flush attribution

Times are median run means; p99 is the worst of all three runs. Window is total measured wall divided by batches. WAL/member uses LSN bytes; `write/sync µs/batch` uses pg_stat_wal time deltas, retaining its scope/lag limits. Complete run means/p50/p99, planning times, scans, cardinalities and WAL counts are in [m0.json.gz](./m0.json.gz).

| Link | Plan | Variant | Client | N | EXPLAIN server µs | BEGIN→COMMIT µs | Window µs/batch | Worst p99 ms | WAL B/member | WAL write/sync µs/batch | Scan verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A | current | full | S | 1 | 401.1 | 4870.2 | 4873.2 | 8.57 | 1277.1 | 13.3/2577.6 | clean |
| A | current | full | S | 4 | 508.0 | 4952.5 | 4957.4 | 5.35 | 1094.1 | 14.4/2601.0 | clean |
| A | current | full | S | 16 | 1003.8 | 5246.4 | 5258.4 | 7.69 | 1065.4 | 20.3/2577.1 | clean |
| A | current | full | S | 32 | 1267.6 | 5601.8 | 5625.0 | 9.02 | 1049.0 | 28.3/2569.5 | clean |
| A | current | full | S | 64 | 2286.7 | 6381.5 | 6439.6 | 8.81 | 1047.1 | 44.5/2604.0 | clean |
| A | fresh | batch_tail | P | 1 | 267.0 | 4937.0 | 4946.3 | 15.86 | 1022.1 | 11.8/2672.4 | contaminated |
| A | fresh | batch_tail | P | 4 | 422.5 | 5259.2 | 5281.2 | 15.21 | 507.7 | 13.9/2837.6 | contaminated |
| A | fresh | batch_tail | P | 16 | 791.2 | 5584.1 | 5684.1 | 10.72 | 367.4 | 14.9/2821.3 | contaminated |
| A | fresh | batch_tail | P | 32 | 1171.2 | 6069.6 | 6251.6 | 11.42 | 344.9 | 16.8/2981.8 | contaminated |
| A | fresh | batch_tail | P | 64 | 2447.9 | 6382.9 | 6754.0 | 10.64 | 333.5 | 21.8/2604.8 | contaminated |
| A | fresh | batch_tail | S | 1 | 337.2 | 4858.5 | 4861.7 | 8.23 | 1021.4 | 12.7/2533.3 | contaminated |
| A | fresh | batch_tail | S | 4 | 348.1 | 5189.5 | 5193.6 | 9.41 | 506.9 | 14.3/2688.4 | contaminated |
| A | fresh | batch_tail | S | 16 | 1169.8 | 5481.3 | 5491.8 | 9.31 | 367.3 | 14.6/2771.6 | contaminated |
| A | fresh | batch_tail | S | 32 | 1681.8 | 5763.5 | 5779.2 | 8.10 | 345.0 | 18.1/2540.7 | contaminated |
| A | fresh | batch_tail | S | 64 | 2794.9 | 6740.5 | 6786.5 | 80.57 | 333.5 | 22.4/2764.0 | contaminated |
| A | fresh | full | P | 1 | 319.4 | 5435.4 | 5454.2 | 32.15 | 16084.1 | 18.8/3258.3 | contaminated |
| A | fresh | full | P | 4 | 892.0 | 5222.5 | 5255.9 | 8.66 | 5387.5 | 20.6/2617.2 | contaminated |
| A | fresh | full | P | 16 | 4125.3 | 7926.7 | 8039.8 | 15.68 | 2744.7 | 31.6/2843.1 | contaminated |
| A | fresh | full | P | 32 | 8520.2 | 11460.2 | 11688.0 | 216.72 | 2319.5 | 40.7/3226.7 | contaminated |
| A | fresh | full | P | 64 | 20363.6 | 23523.6 | 23896.9 | 333.35 | 2428.0 | 71.7/7357.8 | contaminated |
| A | fresh | full | S | 1 | 444.3 | 5013.4 | 5017.6 | 9.77 | 1333.6 | 13.4/2703.8 | contaminated |
| A | fresh | full | S | 4 | 794.7 | 5325.7 | 5331.2 | 9.37 | 1149.4 | 15.5/2691.3 | contaminated |
| A | fresh | full | S | 16 | 3687.2 | 7769.4 | 7785.8 | 11.48 | 1107.0 | 20.6/2588.5 | contaminated |
| A | fresh | full | S | 32 | 7427.4 | 11869.7 | 11893.8 | 23.74 | 1109.5 | 26.9/2766.2 | contaminated |
| A | fresh | full | S | 64 | 19617.8 | 17795.6 | 17858.9 | 58.73 | 1105.0 | 33.2/2878.3 | contaminated |
| A | fresh | no_ops | P | 1 | 298.2 | 6262.8 | 6275.4 | 86.70 | 18152.3 | 20.3/3868.2 | contaminated |
| A | fresh | no_ops | P | 4 | 510.2 | 5336.1 | 5361.7 | 39.17 | 832.2 | 12.9/2652.0 | contaminated |
| A | fresh | no_ops | P | 16 | 4009.4 | 8939.9 | 9057.9 | 121.02 | 772.5 | 20.7/3927.9 | contaminated |
| A | fresh | no_ops | P | 32 | 7925.3 | 13400.0 | 13686.7 | 177.68 | 760.5 | 23.9/4865.5 | contaminated |
| A | fresh | no_ops | P | 64 | 19108.3 | 18665.7 | 19352.7 | 33.15 | 754.9 | 26.4/2743.8 | contaminated |
| A | fresh | no_ops | S | 1 | 346.8 | 4846.1 | 4848.9 | 11.19 | 1021.0 | 13.9/2540.9 | contaminated |
| A | fresh | no_ops | S | 4 | 626.1 | 5408.3 | 5412.8 | 10.09 | 832.3 | 14.8/2789.3 | contaminated |
| A | fresh | no_ops | S | 16 | 4695.4 | 7815.1 | 7827.4 | 13.32 | 772.9 | 18.4/2607.8 | contaminated |
| A | fresh | no_ops | S | 32 | 8785.8 | 10566.4 | 10589.2 | 17.31 | 760.4 | 19.6/2640.7 | contaminated |
| A | fresh | no_ops | S | 64 | 21776.1 | 18969.3 | 19023.2 | 290.78 | 755.3 | 28.2/3283.6 | contaminated |
| A | fresh | r_only | P | 1 | 34.8 | 4572.1 | 4578.1 | 9.02 | 127.3 | 12.4/2516.2 | clean |
| A | fresh | r_only | P | 4 | 87.5 | 4689.2 | 4709.9 | 8.66 | 102.5 | 12.5/2537.3 | clean |
| A | fresh | r_only | P | 16 | 278.2 | 5350.7 | 5444.0 | 68.13 | 84.1 | 13.7/2794.3 | clean |
| A | fresh | r_only | P | 32 | 371.9 | 5047.2 | 5252.4 | 31.54 | 78.9 | 13.8/2798.3 | clean |
| A | fresh | r_only | P | 64 | 484.3 | 5016.1 | 5407.6 | 33.24 | 77.4 | 14.7/2673.4 | clean |
| A | fresh | r_only | S | 1 | 70.2 | 4920.6 | 4924.1 | 9.70 | 127.0 | 13.9/2749.7 | clean |
| A | fresh | r_only | S | 4 | 81.4 | 4851.5 | 4856.3 | 10.45 | 102.6 | 13.1/2704.6 | clean |
| A | fresh | r_only | S | 16 | 188.2 | 5054.4 | 5064.7 | 12.55 | 84.1 | 14.8/2806.4 | clean |
| A | fresh | r_only | S | 32 | 332.3 | 4953.5 | 4969.9 | 14.80 | 78.8 | 14.0/2659.3 | clean |
| A | fresh | r_only | S | 64 | 311.6 | 5073.0 | 5115.1 | 13.50 | 77.4 | 13.7/2691.0 | clean |
| A | generic | batch_tail | P | 1 | 296.7 | 4648.4 | 4655.4 | 6.07 | 1012.1 | 12.2/2546.9 | clean |
| A | generic | batch_tail | P | 4 | 312.5 | 4808.3 | 4830.2 | 10.33 | 498.0 | 13.1/2641.6 | clean |
| A | generic | batch_tail | P | 16 | 688.8 | 5110.4 | 5207.2 | 31.35 | 370.3 | 14.8/2683.7 | clean |
| A | generic | batch_tail | P | 32 | 905.2 | 5351.6 | 5546.4 | 10.15 | 350.0 | 17.6/2602.2 | clean |
| A | generic | batch_tail | P | 64 | 1559.8 | 5955.6 | 6341.8 | 12.53 | 339.4 | 22.0/2667.9 | clean |
| A | generic | batch_tail | S | 1 | 291.2 | 4609.2 | 4611.7 | 19.05 | 1015.3 | 12.6/2501.7 | clean |
| A | generic | batch_tail | S | 4 | 414.6 | 5106.0 | 5110.1 | 9.82 | 498.0 | 13.2/2916.5 | clean |
| A | generic | batch_tail | S | 16 | 686.9 | 5223.4 | 5233.2 | 14.11 | 370.4 | 15.1/2837.1 | clean |
| A | generic | batch_tail | S | 32 | 1015.4 | 5489.9 | 5505.9 | 8.78 | 350.0 | 17.9/2739.3 | clean |
| A | generic | batch_tail | S | 64 | 1540.4 | 6008.6 | 6053.2 | 10.11 | 339.4 | 22.3/2755.1 | clean |
| A | generic | full | P | 1 | 359.2 | 4929.4 | 4936.7 | 5.32 | 1364.6 | 13.3/2607.3 | clean |
| A | generic | full | P | 4 | 503.0 | 5428.7 | 5455.7 | 58.72 | 1150.1 | 14.3/2931.6 | clean |
| A | generic | full | P | 16 | 1104.4 | 6343.6 | 6454.4 | 16.39 | 1105.9 | 18.4/3342.8 | clean |
| A | generic | full | P | 32 | 1716.0 | 5960.2 | 6175.6 | 18.53 | 1103.2 | 27.5/2636.9 | clean |
| A | generic | full | P | 64 | 2724.5 | 6943.4 | 7301.3 | 13.28 | 1107.1 | 43.4/2862.2 | clean |
| A | generic | full | S | 1 | 348.8 | 5078.2 | 5083.3 | 10.49 | 1347.9 | 13.5/2728.5 | clean |
| A | generic | full | S | 4 | 363.2 | 5141.3 | 5148.7 | 14.86 | 1149.8 | 14.3/2679.8 | clean |
| A | generic | full | S | 16 | 1171.4 | 5663.9 | 5679.8 | 11.56 | 1107.0 | 19.1/2739.8 | clean |
| A | generic | full | S | 32 | 1386.2 | 6281.0 | 6304.8 | 26.44 | 1103.2 | 27.9/2893.0 | clean |
| A | generic | full | S | 64 | 2404.0 | 6862.1 | 6924.0 | 13.80 | 1106.0 | 44.5/2746.3 | clean |
| A | generic | no_ops | P | 1 | 302.2 | 4936.4 | 4943.5 | 10.70 | 1009.3 | 14.1/2661.3 | clean |
| A | generic | no_ops | P | 4 | 441.8 | 5037.2 | 5054.4 | 12.40 | 816.3 | 14.2/2658.3 | clean |
| A | generic | no_ops | P | 16 | 823.5 | 5296.5 | 5394.3 | 7.69 | 767.0 | 18.8/2581.7 | clean |
| A | generic | no_ops | P | 32 | 1257.8 | 5861.5 | 6061.4 | 26.04 | 758.8 | 22.5/2815.7 | clean |
| A | generic | no_ops | P | 64 | 1329.0 | 7097.0 | 7440.6 | 41.85 | 755.1 | 34.5/3015.0 | clean |
| A | generic | no_ops | S | 1 | 327.1 | 4952.7 | 4956.1 | 12.74 | 1009.4 | 14.0/2621.4 | clean |
| A | generic | no_ops | S | 4 | 436.7 | 5016.2 | 5021.5 | 8.47 | 817.5 | 14.3/2656.5 | clean |
| A | generic | no_ops | S | 16 | 626.5 | 5374.0 | 5385.3 | 13.15 | 766.9 | 18.3/2666.1 | clean |
| A | generic | no_ops | S | 32 | 1307.2 | 5523.6 | 5540.1 | 8.55 | 758.7 | 21.5/2542.1 | clean |
| A | generic | no_ops | S | 64 | 1583.2 | 6480.2 | 6522.6 | 13.57 | 755.1 | 32.5/2722.1 | clean |
| A | generic | r_only | P | 1 | 53.4 | 5220.1 | 5228.6 | 10.63 | 115.8 | 11.9/3091.6 | clean |
| A | generic | r_only | P | 4 | 71.9 | 4816.4 | 4839.2 | 13.02 | 85.8 | 12.5/2638.8 | clean |
| A | generic | r_only | P | 16 | 336.0 | 4932.5 | 5044.4 | 81.83 | 78.8 | 12.0/2717.1 | clean |
| A | generic | r_only | P | 32 | 375.9 | 4806.7 | 4997.6 | 7.53 | 77.3 | 13.9/2536.2 | clean |
| A | generic | r_only | P | 64 | 370.7 | 4953.2 | 5375.8 | 13.80 | 77.2 | 14.4/2599.8 | clean |
| A | generic | r_only | S | 1 | 54.4 | 4642.3 | 4644.8 | 7.30 | 116.3 | 12.0/2523.9 | clean |
| A | generic | r_only | S | 4 | 79.8 | 4682.1 | 4686.4 | 6.62 | 85.8 | 11.7/2576.4 | clean |
| A | generic | r_only | S | 16 | 312.7 | 5098.1 | 5109.1 | 18.03 | 78.9 | 13.5/2878.1 | clean |
| A | generic | r_only | S | 32 | 366.2 | 5030.1 | 5046.0 | 10.70 | 77.4 | 13.2/2814.4 | clean |
| A | generic | r_only | S | 64 | 472.6 | 4844.9 | 4888.6 | 6.79 | 77.2 | 14.8/2509.7 | clean |
| A | unanalyzed | full | S | 1 | 355.2 | 5081.6 | 5084.4 | 7.58 | 1334.1 | 13.4/2788.9 | clean |
| A | unanalyzed | full | S | 4 | 496.9 | 5324.4 | 5329.4 | 10.82 | 1149.0 | 15.1/2917.2 | clean |
| A | unanalyzed | full | S | 16 | 1130.1 | 5586.5 | 5599.5 | 9.27 | 1117.4 | 21.3/2831.9 | clean |
| A | unanalyzed | full | S | 32 | 1448.8 | 6724.0 | 6745.6 | 18.03 | 1105.3 | 25.8/2643.2 | clean |
| A | unanalyzed | full | S | 64 | 2310.2 | 6876.2 | 6934.6 | 15.55 | 1103.3 | 47.2/2569.1 | clean |
| A | warm | batch_tail | P | 1 | 232.1 | 5140.0 | 5146.3 | 9.89 | 1009.9 | 12.8/2650.6 | clean |
| A | warm | batch_tail | P | 4 | 390.2 | 4800.7 | 4820.6 | 7.03 | 498.0 | 14.5/2573.3 | clean |
| A | warm | batch_tail | P | 16 | 706.2 | 5036.8 | 5138.7 | 9.91 | 370.3 | 15.3/2588.7 | clean |
| A | warm | batch_tail | P | 32 | 999.4 | 5504.4 | 5721.8 | 7.60 | 351.8 | 18.1/2621.6 | clean |
| A | warm | batch_tail | P | 64 | 1564.3 | 5971.5 | 6382.4 | 9.74 | 339.5 | 22.5/2589.2 | clean |
| A | warm | batch_tail | S | 1 | 230.2 | 5071.1 | 5073.6 | 8.51 | 1009.7 | 13.9/2576.4 | clean |
| A | warm | batch_tail | S | 4 | 230.9 | 4704.7 | 4709.6 | 7.57 | 497.7 | 12.5/2530.3 | clean |
| A | warm | batch_tail | S | 16 | 740.2 | 5019.7 | 5029.5 | 18.36 | 370.2 | 14.1/2629.2 | clean |
| A | warm | batch_tail | S | 32 | 1055.5 | 5605.0 | 5622.2 | 12.78 | 351.7 | 17.3/2865.9 | clean |
| A | warm | batch_tail | S | 64 | 1605.2 | 6106.8 | 6151.5 | 11.29 | 339.6 | 22.8/2650.8 | clean |
| A | warm | full | P | 1 | 381.3 | 4979.6 | 4988.9 | 8.02 | 1365.1 | 13.2/2646.7 | clean |
| A | warm | full | P | 4 | 499.7 | 5017.4 | 5036.7 | 13.96 | 1150.3 | 14.4/2631.2 | clean |
| A | warm | full | P | 16 | 1219.7 | 5679.0 | 5788.3 | 125.02 | 1106.9 | 20.1/2828.6 | clean |
| A | warm | full | P | 32 | 1739.5 | 6072.5 | 6301.7 | 10.47 | 1103.0 | 31.3/2599.0 | clean |
| A | warm | full | P | 64 | 2380.7 | 7250.4 | 7642.5 | 16.02 | 1107.4 | 45.9/2851.3 | clean |
| A | warm | full | S | 1 | 231.4 | 4813.4 | 4816.7 | 9.43 | 1363.2 | 12.9/2502.0 | clean |
| A | warm | full | S | 4 | 453.9 | 5170.1 | 5175.8 | 32.85 | 1148.9 | 14.5/2720.5 | clean |
| A | warm | full | S | 16 | 1147.6 | 5482.3 | 5494.8 | 12.70 | 1107.5 | 19.8/2653.5 | clean |
| A | warm | full | S | 32 | 1349.8 | 6010.6 | 6037.5 | 12.36 | 1102.8 | 27.1/2746.2 | clean |
| A | warm | full | S | 64 | 2860.0 | 6991.6 | 7045.0 | 11.76 | 1106.5 | 43.5/2773.8 | clean |
| A | warm | no_ops | P | 1 | 330.0 | 4958.8 | 4964.9 | 7.98 | 1009.6 | 12.8/2652.7 | clean |
| A | warm | no_ops | P | 4 | 438.8 | 5000.4 | 5016.3 | 9.15 | 816.0 | 14.2/2622.2 | clean |
| A | warm | no_ops | P | 16 | 1004.6 | 5178.6 | 5279.1 | 10.62 | 767.0 | 18.0/2527.3 | clean |
| A | warm | no_ops | P | 32 | 1272.3 | 5687.0 | 5901.1 | 10.52 | 758.7 | 23.7/2621.3 | clean |
| A | warm | no_ops | P | 64 | 2072.4 | 6581.3 | 7007.1 | 9.14 | 755.2 | 36.3/2707.8 | clean |
| A | warm | no_ops | S | 1 | 273.1 | 4788.5 | 4791.1 | 21.42 | 1009.0 | 12.7/2528.7 | clean |
| A | warm | no_ops | S | 4 | 449.8 | 5146.7 | 5151.3 | 13.47 | 816.6 | 13.3/2686.7 | clean |
| A | warm | no_ops | S | 16 | 1055.2 | 5341.9 | 5352.5 | 8.64 | 766.9 | 17.5/2726.3 | clean |
| A | warm | no_ops | S | 32 | 1110.7 | 5888.6 | 5906.9 | 10.95 | 758.8 | 22.5/2533.8 | clean |
| A | warm | no_ops | S | 64 | 2025.4 | 7035.4 | 7078.1 | 118.04 | 755.1 | 31.1/2865.8 | clean |
| A | warm | r_only | P | 1 | 65.3 | 4644.9 | 4651.9 | 5.91 | 116.3 | 12.7/2569.7 | clean |
| A | warm | r_only | P | 4 | 84.7 | 4818.9 | 4840.4 | 16.65 | 85.7 | 12.9/2692.7 | clean |
| A | warm | r_only | P | 16 | 331.0 | 4792.0 | 4902.0 | 16.72 | 78.8 | 12.8/2601.1 | clean |
| A | warm | r_only | P | 32 | 370.2 | 5259.7 | 5456.9 | 9.61 | 77.4 | 13.5/2973.7 | clean |
| A | warm | r_only | P | 64 | 486.2 | 4989.5 | 5370.5 | 7.60 | 77.2 | 15.5/2572.1 | clean |
| A | warm | r_only | S | 1 | 53.3 | 4932.3 | 4935.9 | 36.15 | 115.9 | 13.0/2795.1 | clean |
| A | warm | r_only | S | 4 | 82.4 | 4732.1 | 4736.3 | 6.99 | 85.8 | 12.7/2612.3 | clean |
| A | warm | r_only | S | 16 | 248.0 | 4704.2 | 4713.7 | 7.86 | 78.9 | 12.5/2557.2 | clean |
| A | warm | r_only | S | 32 | 269.9 | 4875.3 | 4891.1 | 8.28 | 77.3 | 13.5/2581.5 | clean |
| A | warm | r_only | S | 64 | 492.8 | 5082.0 | 5124.5 | 8.70 | 77.2 | 14.9/2685.8 | clean |
| B | current | full | S | 1 | 436.2 | 6302.6 | 6305.7 | 7.67 | 1280.6 | 13.1/2521.4 | clean |
| B | current | full | S | 4 | 489.2 | 6399.0 | 6404.1 | 7.93 | 1096.8 | 14.6/2516.5 | clean |
| B | current | full | S | 16 | 1007.8 | 6798.1 | 6810.0 | 9.14 | 1048.5 | 20.7/2631.7 | clean |
| B | current | full | S | 32 | 1327.2 | 7325.1 | 7347.5 | 10.96 | 1050.3 | 28.4/2757.4 | clean |
| B | current | full | S | 64 | 2221.6 | 8027.1 | 8086.1 | 16.68 | 1046.2 | 45.1/2787.6 | clean |
| B | fresh | batch_tail | P | 1 | 346.2 | 6641.8 | 6649.1 | 13.81 | 1022.3 | 13.0/2761.5 | contaminated |
| B | fresh | batch_tail | P | 4 | 481.8 | 6515.6 | 6531.4 | 8.93 | 507.7 | 13.5/2623.7 | contaminated |
| B | fresh | batch_tail | P | 16 | 1093.9 | 6894.2 | 6996.3 | 15.56 | 367.3 | 15.0/2702.2 | contaminated |
| B | fresh | batch_tail | P | 32 | 1519.1 | 7962.7 | 8177.3 | 512.93 | 344.8 | 17.8/3453.9 | contaminated |
| B | fresh | batch_tail | P | 64 | 2553.2 | 8129.2 | 8552.8 | 222.48 | 333.5 | 22.6/2748.2 | contaminated |
| B | fresh | batch_tail | S | 1 | 230.5 | 6387.7 | 6390.1 | 7.94 | 1024.0 | 12.5/2595.4 | contaminated |
| B | fresh | batch_tail | S | 4 | 479.8 | 6491.0 | 6495.1 | 10.41 | 507.8 | 12.9/2587.3 | contaminated |
| B | fresh | batch_tail | S | 16 | 1052.8 | 6818.5 | 6827.8 | 53.64 | 367.2 | 15.1/2559.6 | contaminated |
| B | fresh | batch_tail | S | 32 | 1669.9 | 7179.0 | 7194.6 | 9.16 | 345.2 | 18.3/2556.8 | contaminated |
| B | fresh | batch_tail | S | 64 | 2583.4 | 8252.6 | 8294.1 | 11.92 | 333.7 | 23.6/2857.4 | contaminated |
| B | fresh | full | P | 1 | 434.2 | 6484.5 | 6493.4 | 9.29 | 1335.0 | 12.8/2684.7 | contaminated |
| B | fresh | full | P | 4 | 725.4 | 6746.5 | 6767.5 | 8.93 | 1149.5 | 14.9/2642.8 | contaminated |
| B | fresh | full | P | 16 | 4593.6 | 9080.9 | 9189.2 | 11.41 | 1105.7 | 21.4/2642.6 | contaminated |
| B | fresh | full | P | 32 | 9294.7 | 13565.8 | 13786.8 | 19.72 | 1095.7 | 29.0/2676.5 | contaminated |
| B | fresh | full | P | 64 | 16490.5 | 19236.3 | 19721.4 | 22.41 | 1105.9 | 34.4/2800.8 | contaminated |
| B | fresh | full | S | 1 | 417.8 | 6591.2 | 6594.9 | 32.29 | 1334.9 | 13.1/2774.5 | contaminated |
| B | fresh | full | S | 4 | 797.9 | 6685.6 | 6690.5 | 7.86 | 1149.3 | 14.4/2613.7 | contaminated |
| B | fresh | full | S | 16 | 4654.2 | 8964.0 | 8977.1 | 12.13 | 1106.7 | 20.5/2684.8 | contaminated |
| B | fresh | full | S | 32 | 7667.5 | 12506.4 | 12531.5 | 20.84 | 1106.1 | 27.6/2627.1 | contaminated |
| B | fresh | full | S | 64 | 16940.8 | 18902.7 | 18960.9 | 26.38 | 1106.3 | 34.6/2732.1 | contaminated |
| B | fresh | no_ops | P | 1 | 332.2 | 6377.5 | 6385.2 | 8.61 | 1023.8 | 12.9/2558.5 | contaminated |
| B | fresh | no_ops | P | 4 | 469.3 | 6587.3 | 6608.6 | 9.76 | 831.4 | 13.3/2484.6 | contaminated |
| B | fresh | no_ops | P | 16 | 3120.8 | 8765.6 | 8868.7 | 11.82 | 772.7 | 17.9/2565.3 | contaminated |
| B | fresh | no_ops | P | 32 | 9162.5 | 13315.1 | 13533.0 | 61.27 | 760.3 | 23.8/2778.0 | contaminated |
| B | fresh | no_ops | P | 64 | 15705.6 | 19625.7 | 20094.4 | 26.41 | 755.1 | 27.3/2906.0 | contaminated |
| B | fresh | no_ops | S | 1 | 311.8 | 6328.1 | 6330.5 | 7.65 | 1024.0 | 12.8/2502.0 | contaminated |
| B | fresh | no_ops | S | 4 | 729.0 | 6742.6 | 6746.7 | 14.18 | 831.6 | 14.0/2707.4 | contaminated |
| B | fresh | no_ops | S | 16 | 4640.2 | 9137.7 | 9146.8 | 13.10 | 772.8 | 18.7/2766.5 | contaminated |
| B | fresh | no_ops | S | 32 | 6446.8 | 13549.8 | 13567.1 | 35.34 | 760.4 | 23.8/3029.2 | contaminated |
| B | fresh | no_ops | S | 64 | 15744.2 | 20834.6 | 20880.9 | 92.68 | 754.7 | 26.7/4164.6 | contaminated |
| B | fresh | r_only | P | 1 | 64.8 | 6259.1 | 6265.3 | 8.70 | 127.2 | 12.1/2677.0 | clean |
| B | fresh | r_only | P | 4 | 89.4 | 6134.6 | 6152.5 | 8.68 | 102.6 | 12.9/2550.8 | clean |
| B | fresh | r_only | P | 16 | 319.3 | 6276.5 | 6377.3 | 9.81 | 84.2 | 12.8/2587.7 | clean |
| B | fresh | r_only | P | 32 | 337.5 | 6493.2 | 6697.6 | 7.97 | 78.9 | 13.6/2750.5 | clean |
| B | fresh | r_only | P | 64 | 502.1 | 6549.1 | 7002.8 | 8.97 | 77.5 | 14.6/2665.7 | clean |
| B | fresh | r_only | S | 1 | 66.3 | 6154.8 | 6157.1 | 8.16 | 127.0 | 12.7/2589.7 | clean |
| B | fresh | r_only | S | 4 | 90.2 | 7356.5 | 7361.0 | 61.65 | 102.7 | 13.1/3729.6 | clean |
| B | fresh | r_only | S | 16 | 314.2 | 6463.5 | 6472.9 | 14.65 | 84.2 | 12.9/2770.7 | clean |
| B | fresh | r_only | S | 32 | 382.2 | 6438.4 | 6454.9 | 12.85 | 78.9 | 13.6/2684.7 | clean |
| B | fresh | r_only | S | 64 | 480.4 | 6518.9 | 6559.2 | 8.58 | 77.5 | 14.9/2663.9 | clean |
| B | generic | batch_tail | P | 1 | 215.4 | 6165.5 | 6172.7 | 6.70 | 1009.5 | 13.0/2550.7 | clean |
| B | generic | batch_tail | P | 4 | 281.4 | 6279.3 | 6297.4 | 10.83 | 497.8 | 14.2/2574.6 | clean |
| B | generic | batch_tail | P | 16 | 476.2 | 6730.3 | 6824.6 | 344.50 | 370.1 | 17.0/2751.0 | clean |
| B | generic | batch_tail | P | 32 | 805.8 | 6841.8 | 7040.9 | 9.79 | 349.8 | 17.2/2643.5 | clean |
| B | generic | batch_tail | P | 64 | 1527.0 | 7456.9 | 7837.8 | 10.12 | 339.5 | 21.9/2556.9 | clean |
| B | generic | batch_tail | S | 1 | 316.8 | 6145.1 | 6147.7 | 13.78 | 1009.8 | 13.1/2541.7 | clean |
| B | generic | batch_tail | S | 4 | 386.8 | 6192.3 | 6196.1 | 6.59 | 497.6 | 13.3/2513.7 | clean |
| B | generic | batch_tail | S | 16 | 626.9 | 6674.9 | 6684.3 | 13.84 | 370.2 | 15.6/2743.4 | clean |
| B | generic | batch_tail | S | 32 | 940.4 | 6912.6 | 6929.6 | 9.05 | 349.7 | 18.0/2663.2 | clean |
| B | generic | batch_tail | S | 64 | 1546.8 | 7509.2 | 7554.1 | 10.05 | 339.3 | 22.6/2648.9 | clean |
| B | generic | full | P | 1 | 355.1 | 6771.3 | 6781.7 | 11.80 | 1354.5 | 15.0/2790.1 | clean |
| B | generic | full | P | 4 | 440.2 | 6677.7 | 6705.5 | 16.41 | 1150.8 | 14.9/2737.5 | clean |
| B | generic | full | P | 16 | 1120.5 | 6923.7 | 7018.7 | 12.10 | 1104.9 | 21.0/2622.9 | clean |
| B | generic | full | P | 32 | 1457.3 | 7399.2 | 7611.9 | 11.09 | 1103.5 | 27.4/2643.9 | clean |
| B | generic | full | P | 64 | 1611.4 | 8586.4 | 8976.6 | 28.49 | 1107.6 | 42.4/2954.5 | clean |
| B | generic | full | S | 1 | 358.2 | 6405.8 | 6408.8 | 11.07 | 1350.8 | 13.7/2566.4 | clean |
| B | generic | full | S | 4 | 422.9 | 6724.7 | 6730.5 | 9.53 | 1151.9 | 15.1/2773.6 | clean |
| B | generic | full | S | 16 | 838.7 | 6955.0 | 6968.0 | 9.28 | 1105.4 | 21.1/2657.2 | clean |
| B | generic | full | S | 32 | 976.8 | 7383.2 | 7404.3 | 9.35 | 1103.5 | 29.1/2668.3 | clean |
| B | generic | full | S | 64 | 1495.8 | 8395.7 | 8453.4 | 14.33 | 1107.4 | 46.1/2670.1 | clean |
| B | generic | no_ops | P | 1 | 220.8 | 6489.6 | 6496.4 | 14.16 | 1008.2 | 13.3/2665.5 | clean |
| B | generic | no_ops | P | 4 | 343.2 | 6441.8 | 6464.0 | 10.49 | 816.0 | 14.6/2536.8 | clean |
| B | generic | no_ops | P | 16 | 921.6 | 6790.3 | 6888.7 | 10.04 | 767.5 | 18.1/2585.5 | clean |
| B | generic | no_ops | P | 32 | 945.7 | 7456.8 | 7634.9 | 12.83 | 758.6 | 21.3/2926.2 | clean |
| B | generic | no_ops | P | 64 | 1750.0 | 8406.7 | 8781.1 | 150.55 | 755.1 | 35.4/3131.8 | clean |
| B | generic | no_ops | S | 1 | 335.8 | 6339.5 | 6341.8 | 7.87 | 1009.5 | 12.6/2555.6 | clean |
| B | generic | no_ops | S | 4 | 307.2 | 6391.8 | 6395.6 | 13.86 | 816.3 | 14.3/2549.0 | clean |
| B | generic | no_ops | S | 16 | 1017.2 | 6912.6 | 6921.7 | 9.35 | 767.5 | 18.9/2699.7 | clean |
| B | generic | no_ops | S | 32 | 1354.7 | 7138.0 | 7153.4 | 9.87 | 758.6 | 23.5/2632.6 | clean |
| B | generic | no_ops | S | 64 | 2348.2 | 8125.2 | 8168.5 | 22.36 | 755.1 | 34.7/2663.6 | clean |
| B | generic | r_only | P | 1 | 65.5 | 6215.1 | 6223.5 | 13.66 | 115.5 | 12.5/2553.0 | clean |
| B | generic | r_only | P | 4 | 77.8 | 6303.5 | 6324.7 | 9.05 | 85.7 | 13.1/2629.2 | clean |
| B | generic | r_only | P | 16 | 293.4 | 6707.1 | 6805.6 | 13.87 | 78.9 | 15.8/2899.1 | clean |
| B | generic | r_only | P | 32 | 379.0 | 6268.6 | 6461.6 | 9.71 | 77.4 | 14.3/2513.2 | clean |
| B | generic | r_only | P | 64 | 386.2 | 6616.8 | 6965.8 | 9.51 | 77.3 | 16.1/2702.2 | clean |
| B | generic | r_only | S | 1 | 58.6 | 6150.3 | 6152.5 | 14.45 | 115.5 | 12.0/2517.1 | clean |
| B | generic | r_only | S | 4 | 78.5 | 6139.5 | 6143.2 | 6.58 | 85.9 | 11.9/2489.1 | clean |
| B | generic | r_only | S | 16 | 267.3 | 6201.0 | 6210.6 | 7.26 | 79.0 | 12.5/2550.3 | clean |
| B | generic | r_only | S | 32 | 371.2 | 6429.9 | 6446.1 | 8.41 | 77.4 | 13.3/2703.8 | clean |
| B | generic | r_only | S | 64 | 481.2 | 6465.3 | 6506.9 | 10.22 | 77.2 | 14.8/2603.6 | clean |
| B | unanalyzed | full | S | 1 | 353.2 | 6405.3 | 6408.3 | 6.88 | 1336.7 | 13.2/2586.0 | clean |
| B | unanalyzed | full | S | 4 | 445.3 | 6606.8 | 6611.9 | 14.12 | 1149.1 | 14.9/2679.7 | clean |
| B | unanalyzed | full | S | 16 | 1134.3 | 6938.2 | 6951.1 | 10.01 | 1105.4 | 21.6/2618.3 | clean |
| B | unanalyzed | full | S | 32 | 1775.2 | 7690.5 | 7712.8 | 10.95 | 1108.5 | 30.1/2860.4 | clean |
| B | unanalyzed | full | S | 64 | 2754.9 | 8422.1 | 8478.8 | 12.26 | 1103.8 | 45.3/2641.2 | clean |
| B | warm | batch_tail | P | 1 | 234.5 | 6537.2 | 6544.4 | 12.28 | 1010.4 | 13.0/2520.6 | clean |
| B | warm | batch_tail | P | 4 | 385.0 | 6437.2 | 6458.5 | 9.21 | 497.9 | 14.5/2679.8 | clean |
| B | warm | batch_tail | P | 16 | 595.8 | 6592.7 | 6684.9 | 9.38 | 370.1 | 14.7/2630.1 | clean |
| B | warm | batch_tail | P | 32 | 1037.0 | 7048.1 | 7247.8 | 11.43 | 351.7 | 18.7/2585.7 | clean |
| B | warm | batch_tail | P | 64 | 1268.0 | 7731.9 | 8142.2 | 10.39 | 339.6 | 22.8/2721.3 | clean |
| B | warm | batch_tail | S | 1 | 180.9 | 6548.4 | 6551.6 | 10.27 | 1010.2 | 15.8/2517.2 | clean |
| B | warm | batch_tail | S | 4 | 414.9 | 6279.2 | 6283.0 | 8.62 | 497.7 | 13.9/2505.1 | clean |
| B | warm | batch_tail | S | 16 | 708.2 | 6530.2 | 6539.6 | 6.87 | 370.3 | 15.4/2599.6 | clean |
| B | warm | batch_tail | S | 32 | 1034.9 | 7022.6 | 7039.8 | 9.34 | 351.8 | 18.6/2652.8 | clean |
| B | warm | batch_tail | S | 64 | 1614.8 | 7557.0 | 7600.8 | 9.98 | 339.6 | 23.5/2561.0 | clean |
| B | warm | full | P | 1 | 367.1 | 6352.8 | 6360.7 | 8.61 | 1349.8 | 13.5/2484.5 | clean |
| B | warm | full | P | 4 | 504.7 | 6620.8 | 6642.6 | 9.07 | 1150.8 | 14.8/2683.0 | clean |
| B | warm | full | P | 16 | 1130.1 | 6958.5 | 7058.9 | 8.97 | 1104.4 | 20.6/2652.9 | clean |
| B | warm | full | P | 32 | 1714.5 | 7512.0 | 7726.6 | 9.06 | 1103.4 | 29.9/2641.5 | clean |
| B | warm | full | P | 64 | 2828.5 | 8438.8 | 8885.6 | 14.24 | 1107.6 | 47.2/2666.5 | clean |
| B | warm | full | S | 1 | 313.2 | 6649.2 | 6654.8 | 16.93 | 1351.2 | 15.0/2667.5 | clean |
| B | warm | full | S | 4 | 492.0 | 6911.6 | 6916.6 | 12.95 | 1157.2 | 15.1/2992.9 | clean |
| B | warm | full | S | 16 | 1120.3 | 7020.7 | 7037.2 | 13.65 | 1106.1 | 19.8/2726.2 | clean |
| B | warm | full | S | 32 | 1715.1 | 7590.4 | 7614.8 | 12.93 | 1103.4 | 29.0/2772.8 | clean |
| B | warm | full | S | 64 | 2743.9 | 8540.2 | 8604.9 | 11.26 | 1107.1 | 46.2/2648.2 | clean |
| B | warm | no_ops | P | 1 | 328.8 | 6420.9 | 6428.8 | 7.72 | 1008.1 | 13.1/2571.1 | clean |
| B | warm | no_ops | P | 4 | 443.3 | 6573.4 | 6596.3 | 8.86 | 816.3 | 14.2/2624.9 | clean |
| B | warm | no_ops | P | 16 | 1079.4 | 6880.1 | 6984.8 | 22.43 | 767.6 | 18.7/2700.5 | clean |
| B | warm | no_ops | P | 32 | 1431.2 | 7343.1 | 7555.2 | 11.85 | 758.8 | 24.3/2693.8 | clean |
| B | warm | no_ops | P | 64 | 2352.4 | 7973.4 | 8400.7 | 11.17 | 755.1 | 36.4/2607.7 | clean |
| B | warm | no_ops | S | 1 | 327.4 | 6280.7 | 6282.9 | 7.86 | 1009.8 | 13.2/2495.7 | clean |
| B | warm | no_ops | S | 4 | 340.6 | 6447.5 | 6452.0 | 9.89 | 816.0 | 14.7/2582.6 | clean |
| B | warm | no_ops | S | 16 | 1011.1 | 6924.0 | 6933.3 | 11.50 | 767.6 | 18.9/2723.5 | clean |
| B | warm | no_ops | S | 32 | 1443.4 | 7262.4 | 7279.4 | 9.17 | 758.7 | 24.2/2677.2 | clean |
| B | warm | no_ops | S | 64 | 2006.1 | 8065.5 | 8110.3 | 11.89 | 755.1 | 33.3/2671.6 | clean |
| B | warm | r_only | P | 1 | 89.8 | 6176.7 | 6185.7 | 7.62 | 115.5 | 13.2/2569.5 | clean |
| B | warm | r_only | P | 4 | 63.8 | 6284.9 | 6304.8 | 9.22 | 85.9 | 13.7/2670.6 | clean |
| B | warm | r_only | P | 16 | 289.3 | 6271.6 | 6374.5 | 10.69 | 78.9 | 13.9/2555.3 | clean |
| B | warm | r_only | P | 32 | 282.9 | 6351.1 | 6539.1 | 15.04 | 77.4 | 14.9/2573.0 | clean |
| B | warm | r_only | P | 64 | 488.3 | 6993.3 | 7336.4 | 14.18 | 77.2 | 15.2/3042.6 | clean |
| B | warm | r_only | S | 1 | 66.3 | 6103.5 | 6105.7 | 8.87 | 115.6 | 12.4/2530.3 | clean |
| B | warm | r_only | S | 4 | 87.1 | 6260.5 | 6264.3 | 8.79 | 85.9 | 12.5/2635.6 | clean |
| B | warm | r_only | S | 16 | 318.7 | 6187.9 | 6197.0 | 7.69 | 79.0 | 12.9/2504.9 | clean |
| B | warm | r_only | S | 32 | 369.8 | 6500.6 | 6517.8 | 12.45 | 77.3 | 13.7/2755.7 | clean |
| B | warm | r_only | S | 64 | 485.3 | 6445.9 | 6489.6 | 9.00 | 77.2 | 15.2/2565.5 | clean |


Warm N=32 component view. Payload construction is outside BEGIN→COMMIT. Apply includes the client/driver/network/SQL call; COMMIT includes its own network and durable completion. Notify is the committer’s send loop, while member acknowledgement includes queueing and scheduling through durable completion. The three components are not interchangeable CPU estimates. Entries are median run means except the worst member p99.

| Link | Variant | Client | Payload µs | Apply µs | COMMIT µs | Notify µs | Member ack mean ms | Worst member ack p99 ms |
|---|---|---|---|---|---|---|---|---|
| A | batch_tail | P | 21.2 | 1590.3 | 3276.9 | 185.3 | 11.47 | 16.56 |
| A | batch_tail | S | 13.1 | 1516.8 | 3416.6 | 0.1 | n/a | n/a |
| A | full | P | 28.7 | 2041.0 | 3301.9 | 188.4 | 12.63 | 18.91 |
| A | full | S | 18.8 | 1923.2 | 3434.5 | 0.1 | n/a | n/a |
| A | no_ops | P | 19.3 | 1775.2 | 3281.9 | 180.2 | 11.83 | 19.66 |
| A | no_ops | S | 13.2 | 1748.6 | 3448.3 | 0.1 | n/a | n/a |
| A | r_only | P | 18.5 | 977.8 | 3638.5 | 173.6 | 10.94 | 150.19 |
| A | r_only | S | 13.6 | 940.5 | 3237.4 | 0.1 | n/a | n/a |
| B | batch_tail | P | 18.4 | 2124.9 | 3748.5 | 169.3 | 14.58 | 36.73 |
| B | batch_tail | S | 13.8 | 2096.2 | 3798.5 | 0.1 | n/a | n/a |
| B | full | P | 27.1 | 2544.6 | 3827.6 | 184.1 | 15.49 | 20.86 |
| B | full | S | 18.9 | 2491.4 | 3939.7 | 0.1 | n/a | n/a |
| B | no_ops | P | 20.4 | 2318.4 | 3876.2 | 183.6 | 15.16 | 24.97 |
| B | no_ops | S | 13.7 | 2314.7 | 3842.6 | 0.1 | n/a | n/a |
| B | r_only | P | 17.2 | 1518.8 | 3719.7 | 181.0 | 13.12 | 29.01 |
| B | r_only | S | 13.9 | 1479.0 | 3904.1 | 0.1 | n/a | n/a |


## Existing engine e_rust

Native S1 schema, owned counter, unkeyed `increment`, native account session, 50 warm-up and 500 measured mutations per repetition. Every n+1 result is checked; 1,650 committed increments total. No engine instrumentation/product edit. [Host envelope](./e-rust-host-envelope.json) surrounds the three repetitions together.

| Run | Calling-thread CPU mean/p50/p99 µs | Mutate wall mean/p99 µs |
|---|---|---|
| 1 | 571.37/613.00/899.99 | 3856.24/4725.52 |
| 2 | 558.34/575.95/964.04 | 3896.51/8532.49 |
| 3 | 561.79/616.52/810.03 | 3977.24/7551.51 |


## M2 — ordered-flight safety and latency

The witness schema models raising fence/owner, head, generation/adoption, receipt, data and logical tail. It is a protocol/ordering witness, not an implementation of the product authority resolver, retry policy or receipt-retention contract. READ COMMITTED statements remain separate inside the ordered SimpleQuery message. An explicit statement error is only a known rollback after the original transaction ends; final idle status and independent unchanged data are checked.

| Witness | Observed result |
|---|---|
| raising-fence-first | {"ms":1.3846643269062042,"error":"P0001","rollback_status":"I"} |
| post-head-lock-adoption-and-receipt | {"rows":[["1"],["0"],["2"],["7"],["0"]],"fence_lock_held_before_head":true} |
| 3-flight-statement-failure-F1 | {"error":"22012","aborted_status":"E","ended_status":"I","atomic":true} |
| 3-flight-statement-failure-F2 | {"error":"22012","aborted_status":"E","ended_status":"I","atomic":true} |
| 2-flight-statement-failure-F1 | {"error":"22012","aborted_status":"E","ended_status":"I","atomic":true} |
| 2-flight-statement-failure-F2 | {"error":"22012","aborted_status":"E","ended_status":"I","atomic":true} |
| zero-row-tail-raises-and-skips-COMMIT | {"error":"P0001","atomic":true} |
| stale-generation-refuses-before-apply | {"error":"P0001"} |
| savepoint-frame-disposition | {"failed_member_restored":true} |
| per-statement-timeout | {"total_ms":46.60138301551342,"timeout_ms":25,"three_sleeps_ms":15} |
| bounded-apply-check-timeout | {"code":"57014","COMMIT_skipped":true} |
| timeout-disabled-before-slow-COMMIT | {"ms":64.17039968073368,"timeout_ms":20,"committed":true} |
| slow-COMMIT-without-reset-control | {"ms":64.05575573444366,"errors":[],"status":"I","observation":"COMMIT survived the configured timeout"} |
| deferred-COMMIT-error-known-rollback | {"status":"I"} |
| lost-folded-flight-results-commit | {"classification":"E_COMMIT_OUTCOME_UNKNOWN","actual_observer_delta":1,"automatic_retry":false} |
| lost-folded-flight-results-abort | {"classification":"E_COMMIT_OUTCOME_UNKNOWN","actual_observer_delta":0,"automatic_retry":false} |
| keyed-receipt-reconcile | {"same_receipt":true,"applied_once":true} |
| three-flight-loss-after-setup | {"classification":"known abort only after original backend ended","retry_before_abort_proof":false,"unchanged":true} |
| three-flight-loss-after-apply | {"classification":"known abort only after original backend ended","retry_before_abort_proof":false,"unchanged":true} |
| confirmed-COMMIT-followed-by-result-error | {"classification":"confirmed durable; result failure separate","automatic_retry":false,"sqlstate":"22012"} |
| single-statement-lock-plus-reads-negative-control | {"observed_generation":0,"adoption_generation":2,"receipt_visible":false,"meaning":"one statement is not a fresh post-lock cut"} |


The three 15 ms sleeps complete in a single simple-query message despite a 25 ms per-statement limit. A 60 ms apply/check sleep under 20 ms aborts before COMMIT. With the explicit local reset, a deliberately 60 ms deferred-trigger COMMIT succeeds. The additional **no-reset** control also survives on this PG16.15 build; this observation does not remove the required explicit reset or generalize to other versions/poolers.

The full G3b schedules use the actual eight count checks, qualified RT5 typed EXECUTE codec, current no-FK tables, and N known counter reads. The model authority/session/receipt lookups are not real account authorization. The extended-bind comparator uses the same tail SQL with typed bindings and client count verification; the simple EXECUTE controls retain equal encoding. Two flights move every count assertion into raising SQL before co-dispatched COMMIT. The original simple controls are epoch 1; later comparator cells carry their own epoch-2 host records, so protocol-only causality cannot be inferred from an unpaired cross-epoch difference. Three-flight simple EXECUTE controls isolate flight count at equal encoding. These differences must be counted before claiming that removing a flight wins.

| Link | Flights | N | Apply protocol | Cycle ms, each run | Median p50 ms | Worst p99 ms | Payload/codec µs | Setup/apply/COMMIT mean ms |
|---|---|---|---|---|---|---|---|---|
| A | 2 | 1 | RT5 simple EXECUTE | 5.005/4.705/4.907 | 4.815 | 9.425 | 47.9 | 0.957/3.901/0.000 |
| A | 2 | 32 | RT5 simple EXECUTE | 7.683/7.653/7.614 | 7.719 | 14.411 | 658.0 | 1.282/5.706/0.000 |
| A | 3 | 1 | RT5 simple EXECUTE | 5.369/5.644/5.209 | 5.344 | 9.641 | 46.9 | 0.983/1.125/3.188 |
| A | 3 | 32 | RT5 simple EXECUTE | 9.086/8.360/8.639 | 8.683 | 17.576 | 661.2 | 1.322/3.025/3.586 |
| B | 2 | 1 | RT5 simple EXECUTE | 5.871/5.777/6.075 | 5.843 | 9.397 | 46.6 | 1.501/4.325/0.000 |
| B | 2 | 32 | RT5 simple EXECUTE | 8.889/8.661/8.917 | 8.955 | 13.443 | 676.6 | 1.818/6.359/0.000 |
| B | 3 | 1 | RT5 simple EXECUTE | 6.896/6.832/7.001 | 6.868 | 9.056 | 47.2 | 1.511/1.641/3.705 |
| B | 3 | 32 | RT5 simple EXECUTE | 9.956/9.789/9.868 | 9.919 | 16.890 | 646.3 | 1.814/3.456/3.924 |
| A | 3 | 1 | extended bind | 5.407/5.352/5.303 | 5.355 | 12.656 | 1.8 | 0.974/1.022/3.374 |
| A | 3 | 32 | extended bind | 6.443/6.501/6.306 | 6.409 | 8.878 | 18.6 | 1.314/1.734/3.377 |
| B | 3 | 1 | extended bind | 6.947/6.962/6.963 | 6.775 | 9.801 | 1.8 | 1.481/1.512/3.958 |
| B | 3 | 32 | extended bind | 7.921/7.951/7.932 | 7.870 | 10.474 | 19.0 | 1.824/2.244/3.864 |


At N=32 the equal-encoding simple controls measure three→two flights at 8.639→7.653 ms on A and 9.868→8.889 ms on B (median run means). The later bound-apply three-flight comparator measures 6.443 ms / 7.932 ms. Thus the two-flight simple implementation is not the lowest observed schedule cost. The bind comparator is a separate epoch, so this is a reason to retain the codec/protocol control, not an estimate of a causal codec saving. Count checks remain mandatory in either protocol.

One-row witness-model cycles (a distinct, smaller SQL shape; never pooled into full-tail fits):

| Link | Flights | Cycle mean ms, each run | Worst p99 ms |
|---|---|---|---|
| A | 3 | 5.439/5.127/5.241 | 13.037 |
| A | 2 | 4.492/4.586/4.356 | 10.185 |
| B | 3 | 6.629/6.536/6.583 | 11.966 |
| B | 2 | 5.473/5.352/5.373 | 9.750 |


## M3 — effective fill under 32 closed-loop writers

This is a discrete-event group-commit simulator with 32 writers, one outstanding request each, the registered offered rungs, 10 s warm-up/20 s measurement, and 0–300 µs per-writer acknowledgement-return jitter. Both aligned-burst and staggered phases are retained. Due times remain visible when closed-loop backpressure prevents issuance, avoiding a false achieved-rate pass from coordinated omission. Every member increments its own counter once; counter equality is checked. No HTTP, actual permits, collisions, cancellation, solo fallback or product queue is qualified.

The main ledger replaces the model payload/codec component with measured solo calling-thread e_rust once per member. It uses the selected three-flight / two-flight full-tail N=1/32 fits (the three-flight input protocol is recorded in m3.json) and bootstrap-resamples measured N32 service residuals. This is a conservative solo-path CPU proxy with driver overhead, not proof of future incremental overlay CPU. The zero-incremental-CPU sensitivity is explicitly optimistic. Neither ledger imports the historical S1b fixed term.

A model pass requires ≥99.5% of the requested completed rate, intended-arrival p99≤100 ms and deadline misses≤0.1% in all three runs. It is not a product collection-policy acceptance under RFC §6. Policy collection waits never exceed 1 ms; a full queue at collection entry starts immediately. An already-running collection timer is retained until its cap. `adaptive1ms` waits min(1 ms, max(50 µs, fixed/16)). Effective N is members/batches; alternation counts adjacent N≤2/N≥29 pairs. Histograms aggregate the three repetitions, preserving per-run versions in [m3.json](./m3.json).

| Link/flights | Fixed µs | Marginal excluding model payload µs/member |
|---|---|---|
| A-3 | 5315.58 | 34.66 |
| A-2 | 4788.29 | 68.97 |
| B-3 | 6929.68 | 30.72 |
| B-2 | 5750.71 | 76.32 |


With the measured solo calling-thread CPU proxy, all 20 schedule/phase/policy cells at B 400/s pass all three simulated repetitions; none at A 2,262/s, A 3,200/s or B 1,600/s does. This selects the fill/CPU/service branch and withholds collection-policy acceptance at 3,200/s. Measuring incremental overlay CPU is the next discriminator; it is not evidence that warm server rows bind. Saturation effective N rises from about 16 with immediate dispatch to 27.44 with 250 µs collection and 32 with 1 ms collection, eliminating the nearly 100% small/large alternation.

| Link | Rung | Flights | Phase | Policy | Completed/s each run | Effective N each run | Worst queue p99 ms | Worst intended p99 ms | Max alternation | All-three model pass | N:batch-count histogram |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A | 2262 | 3 | burst | immediate | 1077/1077/1077 | 15.99/15.99/16.00 | 23.72 | 15640.29 | 100.0% | False | 1:2021 31:2019 |
| A | 2262 | 3 | burst | cap250us | 1253/1251/1248 | 27.44/27.44/27.33 | 23.24 | 13402.43 | 0.0% | False | 20:4 21:5 22:24 23:57 24:135 25:232 26:392 27:500 28:534 29:462 30:272 31:101 32:20 |
| A | 2262 | 3 | burst | cap500us | 1286/1285/1283 | 32.00/32.00/32.00 | 0.50 | 12908.18 | 0.0% | False | 32:2409 |
| A | 2262 | 3 | burst | cap1ms | 1259/1259/1258 | 32.00/32.00/32.00 | 1.00 | 13245.07 | 0.0% | False | 32:2360 |
| A | 2262 | 3 | burst | adaptive1ms | 1294/1294/1293 | 32.00/32.00/32.00 | 0.33 | 12792.22 | 0.0% | False | 32:2426 |
| A | 2262 | 3 | staggered | immediate | 1075/1078/1077 | 16.00/16.00/16.00 | 17.55 | 15634.98 | 0.0% | False | 13:1346 14:674 18:673 19:1345 |
| A | 2262 | 3 | staggered | cap250us | 1252/1252/1250 | 27.45/27.45/27.31 | 23.24 | 13377.62 | 0.0% | False | 20:4 21:6 22:25 23:54 24:129 25:238 26:392 27:507 28:533 29:459 30:277 31:95 32:20 |
| A | 2262 | 3 | staggered | cap500us | 1283/1285/1285 | 32.00/32.00/32.00 | 0.50 | 12894.63 | 0.0% | False | 32:2408 |
| A | 2262 | 3 | staggered | cap1ms | 1258/1259/1261 | 32.00/32.00/32.00 | 1.00 | 13216.31 | 0.0% | False | 32:2361 |
| A | 2262 | 3 | staggered | adaptive1ms | 1293/1293/1293 | 32.00/32.00/32.00 | 0.33 | 12787.13 | 0.0% | False | 32:2424 |
| A | 2262 | 2 | burst | immediate | 1080/1078/1077 | 16.00/15.99/16.00 | 24.53 | 15630.49 | 100.0% | False | 1:2023 31:2022 |
| A | 2262 | 2 | burst | cap250us | 1231/1226/1225 | 27.45/27.43/27.34 | 24.12 | 13743.32 | 0.0% | False | 20:4 21:5 22:24 23:55 24:132 25:227 26:385 27:496 28:520 29:451 30:269 31:99 32:20 |
| A | 2262 | 2 | burst | cap500us | 1254/1256/1256 | 32.00/32.00/32.00 | 0.50 | 13280.90 | 0.0% | False | 32:2354 |
| A | 2262 | 2 | burst | cap1ms | 1230/1232/1232 | 32.00/32.00/32.00 | 1.00 | 13600.99 | 0.0% | False | 32:2309 |
| A | 2262 | 2 | burst | adaptive1ms | 1266/1264/1267 | 32.00/32.00/32.00 | 0.30 | 13145.02 | 0.0% | False | 31:7 32:2366 |
| A | 2262 | 2 | staggered | immediate | 1077/1075/1070 | 16.00/16.00/16.00 | 20.84 | 15689.84 | 0.0% | False | 9:672 11:673 13:669 19:669 21:673 23:672 |
| A | 2262 | 2 | staggered | cap250us | 1231/1226/1228 | 27.45/27.43/27.31 | 24.12 | 13663.57 | 0.0% | False | 20:4 21:6 22:25 23:52 24:129 25:233 26:387 27:500 28:519 29:449 30:274 31:92 32:20 |
| A | 2262 | 2 | staggered | cap500us | 1254/1256/1253 | 32.00/32.00/32.00 | 0.50 | 13293.54 | 0.0% | False | 32:2352 |
| A | 2262 | 2 | staggered | cap1ms | 1230/1232/1232 | 32.00/32.00/32.00 | 1.00 | 13619.73 | 0.0% | False | 32:2309 |
| A | 2262 | 2 | staggered | adaptive1ms | 1264/1265/1264 | 32.00/32.00/32.00 | 0.30 | 13152.93 | 0.0% | False | 31:7 32:2364 |
| A | 3200 | 3 | burst | immediate | 1077/1077/1077 | 15.99/15.99/16.00 | 23.72 | 19795.35 | 100.0% | False | 1:2021 31:2019 |
| A | 3200 | 3 | burst | cap250us | 1253/1251/1248 | 27.44/27.44/27.33 | 23.24 | 18182.03 | 0.0% | False | 20:4 21:5 22:24 23:57 24:135 25:232 26:392 27:500 28:534 29:462 30:272 31:101 32:20 |
| A | 3200 | 3 | burst | cap500us | 1286/1285/1283 | 32.00/32.00/32.00 | 0.50 | 17859.43 | 0.0% | False | 32:2409 |
| A | 3200 | 3 | burst | cap1ms | 1259/1259/1258 | 32.00/32.00/32.00 | 1.00 | 18100.94 | 0.0% | False | 32:2360 |
| A | 3200 | 3 | burst | adaptive1ms | 1294/1294/1293 | 32.00/32.00/32.00 | 0.33 | 17776.64 | 0.0% | False | 32:2426 |
| A | 3200 | 3 | staggered | immediate | 1077/1078/1077 | 16.00/16.00/16.00 | 18.03 | 19776.19 | 0.0% | False | 12:673 13:1346 19:1346 20:674 |
| A | 3200 | 3 | staggered | cap250us | 1252/1252/1248 | 27.45/27.45/27.33 | 23.24 | 18181.89 | 0.0% | False | 20:4 21:5 22:24 23:57 24:134 25:232 26:392 27:500 28:534 29:461 30:273 31:101 32:20 |
| A | 3200 | 3 | staggered | cap500us | 1285/1285/1285 | 32.00/32.00/32.00 | 0.50 | 17848.78 | 0.0% | False | 32:2409 |
| A | 3200 | 3 | staggered | cap1ms | 1261/1259/1258 | 32.00/32.00/32.00 | 1.00 | 18092.22 | 0.0% | False | 32:2361 |
| A | 3200 | 3 | staggered | adaptive1ms | 1294/1293/1294 | 32.00/32.00/32.00 | 0.33 | 17771.12 | 0.0% | False | 32:2426 |
| A | 3200 | 2 | burst | immediate | 1080/1078/1077 | 16.00/15.99/16.00 | 24.53 | 19785.56 | 100.0% | False | 1:2023 31:2022 |
| A | 3200 | 2 | burst | cap250us | 1231/1226/1225 | 27.45/27.43/27.34 | 24.12 | 18421.80 | 0.0% | False | 20:4 21:5 22:24 23:55 24:132 25:227 26:385 27:496 28:520 29:451 30:269 31:99 32:20 |
| A | 3200 | 2 | burst | cap500us | 1254/1256/1256 | 32.00/32.00/32.00 | 0.50 | 18128.48 | 0.0% | False | 32:2354 |
| A | 3200 | 2 | burst | cap1ms | 1230/1232/1232 | 32.00/32.00/32.00 | 1.00 | 18353.19 | 0.0% | False | 32:2309 |
| A | 3200 | 2 | burst | adaptive1ms | 1266/1264/1267 | 32.00/32.00/32.00 | 0.30 | 18025.77 | 0.0% | False | 31:7 32:2366 |
| A | 3200 | 2 | staggered | immediate | 1080/1071/1076 | 16.00/16.00/16.00 | 20.77 | 19814.61 | 0.0% | False | 13:670 14:672 16:1350 18:673 19:669 |
| A | 3200 | 2 | staggered | cap250us | 1231/1225/1225 | 27.46/27.43/27.33 | 24.12 | 18437.84 | 0.0% | False | 20:4 21:5 22:24 23:54 24:132 25:228 26:385 27:495 28:519 29:451 30:269 31:100 32:20 |
| A | 3200 | 2 | staggered | cap500us | 1254/1256/1256 | 32.00/32.00/32.00 | 0.50 | 18148.33 | 0.0% | False | 32:2354 |
| A | 3200 | 2 | staggered | cap1ms | 1230/1229/1232 | 32.00/32.00/32.00 | 1.00 | 18360.61 | 0.0% | False | 32:2307 |
| A | 3200 | 2 | staggered | adaptive1ms | 1264/1261/1267 | 31.99/32.00/32.00 | 0.30 | 18044.03 | 0.0% | False | 31:7 32:2363 |
| B | 400 | 3 | burst | immediate | 400/400/400 | 32.00/32.00/32.00 | 0.00 | 30.53 | 0.0% | True | 32:750 |
| B | 400 | 3 | burst | cap250us | 400/400/400 | 32.00/32.00/32.00 | 0.25 | 30.78 | 0.0% | True | 32:750 |
| B | 400 | 3 | burst | cap500us | 400/400/400 | 32.00/32.00/32.00 | 0.50 | 31.03 | 0.0% | True | 32:750 |
| B | 400 | 3 | burst | cap1ms | 400/400/400 | 32.00/32.00/32.00 | 1.00 | 31.53 | 0.0% | True | 32:750 |
| B | 400 | 3 | burst | adaptive1ms | 400/400/400 | 32.00/32.00/32.00 | 0.43 | 30.96 | 0.0% | True | 32:750 |
| B | 400 | 3 | staggered | immediate | 400/400/400 | 3.63/3.63/3.64 | 8.94 | 19.09 | 0.0% | True | 3:2496 4:4036 5:54 6:16 |
| B | 400 | 3 | staggered | cap250us | 400/400/400 | 3.77/3.76/3.77 | 9.24 | 19.16 | 0.0% | True | 3:1595 4:4707 5:56 6:18 |
| B | 400 | 3 | staggered | cap500us | 400/400/400 | 3.89/3.89/3.90 | 9.40 | 19.72 | 0.0% | True | 3:764 4:5299 5:75 6:23 |
| B | 400 | 3 | staggered | cap1ms | 400/400/400 | 4.15/4.16/4.16 | 10.41 | 20.56 | 0.0% | True | 3:3 4:4885 5:861 6:20 7:3 |
| B | 400 | 3 | staggered | adaptive1ms | 400/400/400 | 3.86/3.85/3.86 | 9.30 | 19.14 | 0.0% | True | 3:979 4:5164 5:62 6:16 |
| B | 400 | 2 | burst | immediate | 400/400/400 | 32.00/32.00/32.00 | 0.00 | 35.51 | 0.0% | True | 32:750 |
| B | 400 | 2 | burst | cap250us | 400/400/400 | 32.00/32.00/32.00 | 0.25 | 35.76 | 0.0% | True | 32:750 |
| B | 400 | 2 | burst | cap500us | 400/400/400 | 32.00/32.00/32.00 | 0.50 | 36.01 | 0.0% | True | 32:750 |
| B | 400 | 2 | burst | cap1ms | 400/400/400 | 32.00/32.00/32.00 | 1.00 | 36.51 | 0.0% | True | 32:750 |
| B | 400 | 2 | burst | adaptive1ms | 400/400/400 | 32.00/32.00/32.00 | 0.36 | 35.87 | 0.0% | True | 32:750 |
| B | 400 | 2 | staggered | immediate | 400/400/400 | 3.08/3.09/3.10 | 9.46 | 19.46 | 0.0% | True | 2:703 3:5793 4:1173 5:84 6:2 7:1 8:3 9:7 |
| B | 400 | 2 | staggered | cap250us | 400/400/400 | 3.22/3.21/3.23 | 9.31 | 19.09 | 0.0% | True | 2:410 3:5117 4:1839 5:68 6:1 7:5 8:1 9:9 |
| B | 400 | 2 | staggered | cap500us | 400/400/400 | 3.34/3.36/3.36 | 9.72 | 19.40 | 0.0% | True | 2:175 3:4421 4:2453 5:92 6:1 7:4 9:8 10:1 |
| B | 400 | 2 | staggered | cap1ms | 400/400/400 | 3.61/3.60/3.63 | 10.31 | 20.14 | 0.0% | True | 2:9 3:2780 4:3659 5:170 6:7 7:4 9:8 10:1 |
| B | 400 | 2 | staggered | adaptive1ms | 400/400/400 | 3.29/3.30/3.27 | 9.51 | 19.19 | 0.0% | True | 2:262 3:4832 4:2091 5:94 6:1 7:6 8:1 9:10 |
| B | 1600 | 3 | burst | immediate | 976/976/976 | 16.00/16.00/16.01 | 25.17 | 11644.77 | 100.0% | False | 1:1829 31:1830 |
| B | 1600 | 3 | burst | cap250us | 1173/1171/1170 | 27.44/27.42/27.34 | 24.75 | 8182.63 | 0.0% | False | 20:4 21:6 22:22 23:51 24:125 25:223 26:368 27:470 28:502 29:430 30:254 31:91 32:19 |
| B | 1600 | 3 | burst | cap500us | 1213/1211/1211 | 32.00/32.00/32.00 | 0.50 | 7258.75 | 0.0% | False | 32:2272 |
| B | 1600 | 3 | burst | cap1ms | 1189/1189/1189 | 32.00/32.00/32.00 | 1.00 | 7675.85 | 0.0% | False | 32:2229 |
| B | 1600 | 3 | burst | adaptive1ms | 1214/1214/1214 | 32.00/32.00/32.00 | 0.43 | 7201.13 | 0.0% | False | 32:2277 |
| B | 1600 | 3 | staggered | immediate | 973/975/974 | 16.00/16.00/16.00 | 19.56 | 11678.68 | 0.0% | False | 12:1826 20:1827 |
| B | 1600 | 3 | staggered | cap250us | 1173/1171/1169 | 27.44/27.42/27.35 | 24.84 | 8142.17 | 0.0% | False | 20:4 21:7 22:23 23:46 24:121 25:226 26:368 27:472 28:504 29:429 30:261 31:84 32:19 |
| B | 1600 | 3 | staggered | cap500us | 1213/1211/1213 | 32.00/32.00/32.00 | 0.50 | 7256.23 | 0.0% | False | 32:2273 |
| B | 1600 | 3 | staggered | cap1ms | 1190/1189/1190 | 32.00/32.00/32.00 | 1.00 | 7669.66 | 0.0% | False | 32:2231 |
| B | 1600 | 3 | staggered | adaptive1ms | 1216/1214/1216 | 32.00/32.00/32.00 | 0.43 | 7199.35 | 0.0% | False | 32:2279 |
| B | 1600 | 2 | burst | immediate | 1002/1002/1006 | 15.99/16.01/16.00 | 25.67 | 11165.94 | 100.0% | False | 1:1881 31:1881 |
| B | 1600 | 2 | burst | cap250us | 1165/1165/1165 | 27.44/27.42/27.34 | 25.29 | 8275.72 | 0.0% | False | 20:4 21:6 22:22 23:49 24:125 25:222 26:367 27:468 28:498 29:426 30:254 31:91 32:19 |
| B | 1600 | 2 | burst | cap500us | 1200/1202/1200 | 32.00/32.00/32.00 | 0.50 | 7512.22 | 0.0% | False | 32:2251 |
| B | 1600 | 2 | burst | cap1ms | 1178/1179/1178 | 32.00/32.00/32.00 | 1.00 | 7908.81 | 0.0% | False | 32:2209 |
| B | 1600 | 2 | burst | adaptive1ms | 1206/1208/1206 | 32.00/32.00/32.00 | 0.36 | 7392.46 | 0.0% | False | 32:2263 |
| B | 1600 | 2 | staggered | immediate | 1002/1005/1002 | 16.00/16.00/16.00 | 21.22 | 11166.47 | 0.0% | False | 11:1254 13:627 19:626 21:1254 |
| B | 1600 | 2 | staggered | cap250us | 1166/1165/1165 | 27.43/27.42/27.35 | 25.29 | 8234.69 | 0.0% | False | 20:4 21:7 22:24 23:45 24:121 25:224 26:365 27:470 28:500 29:429 30:260 31:84 32:19 |
| B | 1600 | 2 | staggered | cap500us | 1200/1202/1202 | 32.00/32.00/32.00 | 0.50 | 7497.24 | 0.0% | False | 32:2252 |
| B | 1600 | 2 | staggered | cap1ms | 1178/1178/1179 | 32.00/32.00/32.00 | 1.00 | 7914.01 | 0.0% | False | 32:2209 |
| B | 1600 | 2 | staggered | adaptive1ms | 1205/1208/1206 | 32.00/32.00/32.00 | 0.36 | 7390.00 | 0.0% | False | 32:2262 |


Saturation witness (unreachable offered rate to expose closed-loop acknowledgement synchronization, not a target-rate trial):

| Link | Policy | Effective N | Alternation | Histogram |
|---|---|---|---|---|
| A | immediate | 15.99 | 100.0% | {"1":674,"31":673} |
| A | cap250us | 27.44 | 0.0% | {"20":1,"21":2,"22":10,"23":21,"24":34,"25":89,"26":131,"27":152,"28":179,"29":150,"30":98,"31":34,"32":12} |
| A | cap1ms | 32.00 | 0.0% | {"32":787} |
| B | immediate | 16.00 | 100.0% | {"1":610,"31":610} |
| B | cap250us | 27.44 | 0.0% | {"20":1,"21":3,"22":10,"23":18,"24":29,"25":87,"26":122,"27":142,"28":170,"29":141,"30":90,"31":30,"32":12} |
| B | cap1ms | 32.00 | 0.0% | {"32":743} |


Optimistic zero-incremental-CPU sensitivity, staggered source:

| Link | Rung | Flights | Policy | Completed/s each run | Effective N each run | All-three model pass |
|---|---|---|---|---|---|---|
| A | 3200 | 3 | immediate | 2730/2732/2722 | 16.00/16.00/16.00 | False |
| A | 3200 | 3 | cap250us | 3200/3200/3200 | 20.04/20.01/20.02 | True |
| A | 3200 | 3 | cap1ms | 3200/3199/3201 | 22.72/22.73/22.66 | True |
| A | 3200 | 2 | immediate | 2715/2714/2726 | 16.00/16.00/16.00 | False |
| A | 3200 | 2 | cap250us | 3199/3201/3200 | 20.58/20.61/20.71 | True |
| A | 3200 | 2 | cap1ms | 3201/3200/3201 | 23.80/23.73/23.65 | True |
| B | 1600 | 3 | immediate | 1600/1600/1600 | 11.65/11.64/11.67 | True |
| B | 1600 | 3 | cap250us | 1600/1600/1600 | 12.10/12.07/12.05 | True |
| B | 1600 | 3 | cap1ms | 1600/1600/1600 | 13.34/13.37/13.32 | True |
| B | 1600 | 2 | immediate | 1600/1600/1600 | 10.53/10.44/10.44 | True |
| B | 1600 | 2 | cap250us | 1600/1600/1599 | 10.95/10.94/10.87 | True |
| B | 1600 | 2 | cap1ms | 1600/1600/1600 | 12.34/12.31/12.24 | True |


## M1b — stall entry, independent W2 pipelines and fixed-pool ceilings

A raw PostgreSQL v3 client prepares the existing M1 W2 composed statement once, then sends one Bind+Execute+Sync per independent query. Results are associated with their ordered request queue and every complete result equals the depth-1 reference. The 20-row result also equals the current native engine W2 oracle. An error followed by a valid W2 read is isolated by Sync; independent implicit transaction/snapshot IDs and a concurrent update are witnessed.

The fixture is the prior M1 native 131,072-message/8,448-membership image, not S1's 1M capacity seed. It retains the full authority/fact prefix and generic data layout. Reads use analyzed force_generic_plan. The driver returns facts; shared Rust authorization/metering is not replaced or timed here.

Entry controls divide a small extended query into three writes versus one coalesced write. TCP_NODELAY on/off is the client socket setting; proxy ends remain NODELAY on. This reproduces or bounds the local Nagle/delayed-ACK mechanism, without claiming that it proves S1b's unrun SSH-path cause.

| Link | Client NODELAY | Split frames | p50 ms | p99 ms |
|---|---|---|---|---|
| A | False | True | 41.004 | 44.824 |
| A | False | False | 0.591 | 0.855 |
| A | True | True | 0.604 | 0.719 |
| A | True | False | 0.633 | 0.701 |
| B | False | True | 42.006 | 44.447 |
| B | False | False | 1.127 | 1.254 |
| B | True | True | 1.138 | 1.196 |
| B | True | False | 1.117 | 1.636 |


Pipeline runs are three 3-second measurement windows after connection warm-up, with a rolling in-flight bound 1/4/8/16 and one Sync/query. The last bounded in-flight queries drain before throughput is calculated. Latency is dispatch→ReadyForQuery. Thirty times the slowest run is an **optimistic isolated-connection ceiling**: no 30-connection CPU, 128-client admission, transfer or loaded SLO qualification is inferred. Depth 8/16 across all 30 readers would also exceed 128 external clients; that product bound must be respected.

| Link | NODELAY | Depth | Reads/s each run | Median p50 ms | Worst p99 ms | 30× slowest run /s | ≥19,027 / ≥22,627 |
|---|---|---|---|---|---|---|---|
| A | True | 1 | 1046/1045/1062 | 0.961 | 1.205 | 31340 | True / True |
| B | True | 1 | 682/682/670 | 1.462 | 2.893 | 20087 | True / False |
| A | False | 1 | 1076/1043/1041 | 0.954 | 1.205 | 31222 | True / True |
| B | False | 1 | 676/683/687 | 1.467 | 1.724 | 20288 | True / False |
| A | True | 4 | 5126/5111/4950 | 0.776 | 1.164 | 148487 | True / True |
| B | True | 4 | 3094/3029/3077 | 1.286 | 1.731 | 90869 | True / True |
| A | False | 4 | 4123/4231/4446 | 0.912 | 1.183 | 123698 | True / True |
| B | False | 4 | 2319/2276/2300 | 1.618 | 3.045 | 68275 | True / True |
| A | True | 8 | 5635/5377/5658 | 1.400 | 2.333 | 161317 | True / True |
| B | True | 8 | 5544/5608/5672 | 1.395 | 2.392 | 166329 | True / True |
| A | False | 8 | 5591/5503/5416 | 1.409 | 2.292 | 162470 | True / True |
| B | False | 8 | 5461/5355/5582 | 1.408 | 2.506 | 160663 | True / True |
| A | True | 16 | 5358/5687/5589 | 2.800 | 4.569 | 160752 | True / True |
| B | True | 16 | 5570/5631/5497 | 2.815 | 4.214 | 164913 | True / True |
| A | False | 16 | 5618/5371/5675 | 2.793 | 4.618 | 161130 | True / True |
| B | False | 16 | 5490/5536/5526 | 2.810 | 4.575 | 164691 | True / True |


## Limits, evidence and cleanup

No raw logs, account credentials, database files or transient harness modifications are committed. JSON files here are measurement summaries, per-run verdicts and sanitized host/provenance evidence. The source snapshots, raw plans, full samples, process receipts, early SQL-timing diagnostics and interrupted attempts are retained in the external archive identified in [PROVENANCE.md](./PROVENANCE.md). No push, stash or explicit Git configuration change is performed.

The private cluster and proxies are stopped before this result is committed. [cleanup.json](./cleanup.json) records two independent final identity checks, owned PID counts and retained archive hashes. No owned PID remains. The 30 GiB stop was triggered by shared-host space consumption; other host activity subsequently reduced free space further. The private cluster, credentials and unused owned build cache were removed after stopping; released binary hashes remain unchanged. Minimum observed free space and final free space are recorded there. The first stop is preserved as a closed epoch; continuation occurred only after observed space recovery, a quiet boundary and fresh matched provisioning.
