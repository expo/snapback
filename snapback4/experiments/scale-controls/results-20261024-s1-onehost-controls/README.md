# S1-C — one-host S1 controls, 2026-10-24

**36/36 control cells completed; 35 have a passing rate.** One shared runner measures raw PG with per-request HS256, Supabase advocate (PostgREST only), and self-hosted Convex/PG on expo-build-450b. These are S1, one-host, short-window observations under the registered start-check rule, not production-capacity or causal engine limits.

Rates are the highest **tested offered operations/s** for which all three repetitions meet intended-arrival p99 ≤50 ms reads /100 ms writes, measured errors ≤0.1%, and whole-cohort write-counter equality including warm-up. “No pass” means no tested rate qualified, down to 1/s; it does not mean “not run.” No cell is unrun or silently replaced.

| Workload | Link | Raw PG token | Supabase advocate | Convex advocate |
|---|---|---:|---:|---:|
| W1 | A | 8,000 | 2,000 | 500 |
| W1 | B | 8,000 | 2,000 | 500 |
| W2 | A | 5,656 | 2,000 | 707 |
| W2 | B | 8,000 | 2,000 | 707 |
| W3 | A | 5,656 | 2,828 | 8,000 |
| W3 | B | 4,000 | 2,828 | 5,656 |
| W4 | A | 400 | 3,200 | no pass |
| W4 | B | 141 | 1,600 | 141 |
| W5 same | A | 282 | 8 | 25 |
| W5 same | B | 282 | 70 | 25 |
| W5 hot1 | A | 3,200 | 800 | 400 |
| W5 hot1 | B | 4,525 | 1,600 | 25 |


A adds 250 µs/direction; B adds 500 µs/direction. Both are local Unix links, not an absolute RTT or the old natural SSH link. All cells use 1M messages, fresh service per cell, 10 s warm-up, 20 s measured, three repetitions/rate, reads 128 clients/cap 32, writes 32 clients/cap 32. The inherited geometric search also tests 19,027/s and 22,627/s in **every read cell**. Vendor SQL, authorization, caches, pool settings, OCC/backoff and durability remain unchanged. Supabase’s schema listener is extra; Convex’s 32 connections also serve its background workers.

[Method](./METHOD.md), [latency ledger](./ledger.md) and [ranges/resources](./ledger.json), [all tested-rate curves](./curves.json), [historical two-host comparison and limitations](./historical-comparison.md).

## Qualification and audit

The unchanged `audit.py` passes **615 trials / 70,457,880 measured scheduled arrivals**, checking every repetition, arrival arithmetic, HDR counts/lossless compression, SLO decisions and selected rates. A separate [counter arithmetic audit](./counter-arithmetic-audit.json) verifies every one of **267 write trials** directly from before/after sums and whole-cohort acknowledgements. **54** counter-mismatch/unknown-outcome trials remain disqualified: raw PG 11, Supabase 7, Convex 36. Across all systems, **328 trials** fail at least one rule; reason counts overlap. [Audits](./audit.json), [disqualification summary](./disqualified-summary.json), [verification checks](./checks.json). The exhaustive per-trial list stays in the raw archive as `disqualified-trials.json`; no raw trials are committed.

A zero-error measured window is insufficient when a timed-out warm-up write committed. Those trials fail equality even if their measured p99 passes. Native settlement mechanisms are described in the method; raw PG/Supabase retain the inherited application-SQL drain, which does not prove HTTP quiescence. No failed repetition is replaced or rescued by a faster one.

All **36 released start checks** contain zero unrelated processes above one sampled CPU; **23 busy observations caused waits/rechecks**. Released 1/5/15-minute loadavg ranges are **0.81–32.84 /1.21–29.63 /2.28–22.08**. These are boundary checks, not an idle-host reservation. [RTT/load ledger](./RTT-LOAD.md), [full aggregate observations](./rtt-load.json). All **72** RTT captures complete; A p50 ranges **0.561–0.622 ms**, B **1.065–1.170 ms**; maximum capture p99 is **4.471 ms**.

The [live affinity witness](./affinity.json) confirms PG cores 0–2 (0–2,6–8), app/proxy 3–4 (3–4,9–10), and generator 5 (5,11), with SMT siblings paired. Every fixture passes its full image/recount or exported fingerprint check. [Seed equality](./seed-equality.json). Before the matrix, all three controls and native Snapback pass one W2/A smoke at 100/s, with 10 s/20 s and all three repetitions; their independent audits account for 6,000 arrivals each. [Smoke evidence](./smoke-evidence.json).

## Reading the comparison

The earlier controls used two hosts, PG17.9, a different app/generator core budget and natural SSH. This run uses PG16.15, a private database on three physical cores, only two app/proxy cores and one generator core. Every current database path pays the common delay proxy’s CPU. The [historical table](./historical-comparison.md) retains every old/new value and explains these changes without attributing them to one cause.

**Convex W2’s 707/s row is search-dependent.** The first 1,000/s repetition failed, later repetitions were fast, and the inherited all-three search moved downward. Its registered 19,027/s and 22,627/s trials failed too; intermediate 2,000–16,000/s rates were not tested. The row is not a demonstrated warmed-cache ceiling. Shared-host activity and warming are confounded; no cache, warm-up or retry setting was changed to improve it. The fixed high rungs remove a 16k ladder ceiling but do not resolve every untested interval.

Writes and some reads are also non-monotonic across serial windows. A later mix beating an earlier disjoint bracket, or B beating A, does not establish a contention or delay benefit. Large changes in `/home` usage and recorded waits confirm other contemporaneous host activity; affinity is not exclusive CPU/device reservation. CPU samples at failed high read rates show heavy app/generator utilization and dispatch backlog. The table is valid for its stated qualification rule and observations; it does not establish physical steady-state capacity or a Snapback victory. Snapback’s post-cache capacity run remains to be made.

## Run Snapback through the identical runner

From the repository root on this host:

```sh
export PATH=$HOME/.cargo/bin:$HOME/.local/bin:$HOME/.local/sb4-postgresql-16.15/bin:$PATH
export CARGO_TARGET_DIR=$HOME/projects/sb4-s1sk/snapback4/target
(cd snapback4 && LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo build --release --locked -p snapback4 --features postgres)
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo build --release --locked --manifest-path snapback4/experiments/scale-controls/postgres-seed/Cargo.toml
python3 snapback4/experiments/scale-controls/scripts/s1-onehost.py \
  --system snapback --mode smoke --out "$HOME/sb4scale/snapback-onehost-smoke-NEW"
python3 snapback4/experiments/scale-controls/scripts/s1-onehost.py \
  --system snapback --out "$HOME/sb4scale/snapback-onehost-matrix-NEW"
```

Launch detached with redirected logs and immediately record the supervisor PID, as for these campaigns. `--snapback-bin` and `--seed-bin` select explicit release artifacts. The native adapter uses the unchanged Quarry fixture, native `Engine::seed_at`, account sessions and its existing drain witnesses. It uses the same rate search, high read rungs, pinning, links, load gate and SLO/counter qualification. No native capacity number is substituted for a control cell. [One command per control cell](./replay-cells.json); use these corrected one-host commands rather than the inherited legacy rerun fields in the archived launch manifests.

## Custody and cleanup

The measured matrix runs from local commit `b5e34d8912`; runner commits are `d688d6f485`, `4cd389a4c1`, `b5e34d8912`. The requested origin/main was an August tree with no Snapback 4; the lane therefore uses preserved S1-PG4 base `ac624fef08`, with the mismatch disclosed in [provenance](./PROVENANCE.md). [Measured source/binary hashes](./provenance.json), [extra input hashes/versions](./input-provenance.json). Report/replay/cleanup-tooling corrections made after all timed load do not change the measured Rust scheduler, SQL, settings or qualification; frozen launch source remains archived.

Every campaign exits zero and stops its service, proxy, observers and private PG cluster; socket and pidfile absence are checked. **PIDs left: none.** [Process audit](./process-audit.json), [private cleanup](./private-cleanup.json), [known-secret scan](./secret-audit.json), [final commit-delta scan](./staged-secret-audit.json). Minimum recorded `/home` free space is **36.62 GiB**; the 30 GiB guard never fires. [Disk evidence](./disk.json). Raw per-trial/HDR/CPU/wait/PID data stays outside Git. [Archive location and SHA-256](./ARCHIVE.md).

No paid cloud, managed service, publication, push, stash, Git configuration change, durability relaxation or unowned signal is used. Only benchmark tooling, documentation and aggregate evidence are committed; product/Quarry/advocate workload sources are unchanged.
