# G3b/G8: composed statements and per-member durable tail cost

All four **median** loopback marginal fits are below the RFC’s 70–93.75 µs/member allowance. This is a server-cost measurement on expo-build-1000, not a throughput or full G3b qualification claim. Cold foreign-key plans exceed that allowance for the full and no-receipt tails; all first runs remain in the spreads below.

Measured **2026-10-23T18:52:50Z–2026-10-23T18:58:31Z**. The `20261024` directory label was requested; the measurements occurred on 2026-10-23 UTC. Source base: `a025d67cd3b1a4a2aebeba014a9ecf30e2e69a25`. Only the standalone experiment and journal change.

## Composed statements

Each cell is one typed prepared statement in its own explicit transaction. Read: `r.t=$1 AND r.id=ANY($2::text[])`, ordered by unique `id COLLATE "C"`. Write: one `UPDATE ... FROM unnest(ids,images) RETURNING id,data` CTE with an outer total order. Both return the complete JSON row images. No SQL evaluates an increment.

Values are the median of three **run means**, in µs. Server time is PostgreSQL EXPLAIN **Execution Time**, including instrumentation but excluding planning and COMMIT. Plain statement wall time includes loopback transfer and driver decoding, excludes BEGIN/COMMIT, and is measured independently of EXPLAIN.

| N | Read server / stmt | Read server / member | Read wall / member | Write server / stmt | Write server / member | Write wall / member | Image bytes returned |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 11.06 | 11.06 | 67.92 | 29.39 | 29.39 | 135.43 | 44 |
| 4 | 14.76 | 3.69 | 15.44 | 40.48 | 10.12 | 35.69 | 176 |
| 8 | 20.39 | 2.55 | 10.18 | 51.03 | 6.38 | 19.79 | 352 |
| 16 | 33.11 | 2.07 | 3.95 | 134.24 | 8.39 | 10.58 | 710 |
| 32 | 98.12 | 3.07 | 5.36 | 160.08 | 5.00 | 6.41 | 1430 |
| 64 | 64.30 | 1.00 | 3.39 | 219.18 | 3.42 | 4.66 | 2870 |

Image bytes count UTF-8 `data` only, excluding the separately returned ids and wire framing. At N=32 the plain read/write statements cost 171.58/205.23 µs per statement.

## Durable stage fits

Like the S1b planning fit, fit `T_batch = fixed + marginal × N` by unweighted ordinary least squares, using N=1,4,16,32,64. Here `T_batch` is the median of three measured window times divided by completed batches (equivalently N divided by members/s); no rate claim is made. Each window includes payload construction, driver work, count checks and BEGIN + one apply/tail CTE + **durable COMMIT**. There is one synchronous client, no queued writers or collection delay. A second fit isolates the timed BEGIN-through-COMMIT interval and excludes payload generation and post-COMMIT checks.

| Variant | Physical rows written | Fixed µs | Marginal µs/member | Timed SQL marginal µs/member | R² | Max residual µs | Fits 70 / 93.75? |
|---|---|---:|---:|---:|---:|---:|---|
| Full per-member tail | 5N + 3 | 375.81 | 15.22 | 14.47 | 0.9978 | 30.10 | yes / yes |
| No `_ops` (unkeyed) | 4N + 3 | 356.03 | 11.34 | 10.77 | 0.9993 | 12.16 | yes / yes |
| Batch metadata + no `_ops` | 2N + 5 | 350.02 | 8.32 | 7.76 | 0.9997 | 6.17 | yes / yes |
| `r` update only | N | 268.77 | 2.15 | 1.64 | 0.9979 | 3.57 | yes / yes |

The full variant reproduces S1b’s **0% non-head** row/index write set: one `r` update, `_commits`, `_log`, `_ops` and `_s1a_footprints` insertion per member; one head, revision and max-folded time-pin update per batch. It uses the Engine-created store and indexes, including the `_log → _commits` FK. Counter values do not change index keys. Revision/footprint tables retain S1a’s experimental shape. SQL is structurally equivalent, with additional count witnesses; this is not the exact historical SQL text or a recalibration of the current engine.

`no_ops` also removes receipt keys from footprints and receipt payload transfer. It applies only to unkeyed work. `batch_tail` builds on that omission: one `_commits` row with writes=N, one footprint containing **all** keys, and all N log images ordered by ordinal under the final batch sequence. It changes sequence/history representation and requires new readers plus history/invalidation/retention qualification; it is an experimental cost bound, not an approved product representation. Keyed receipts cannot be dropped. `r_only` drops the entire tail/head/revision/pin and is the durable physical floor, not a candidate committer.

## Batch cost and WAL

Batch costs are µs, including flush, as median [minimum–maximum] across all three repetitions. WAL is the median `pg_current_wal_lsn()` delta divided by measured members, including transaction commit records. All databases in this private cluster belong to this run; background WAL/autovacuum/checkpoint effects remain included.

| Variant | N | Batch µs [range] | WAL bytes/member | 1-min load range |
|---|---:|---:|---:|---:|
| Full per-member tail | 1 | 377.05 [363.19–624.40] | 1374.09 | 14.20–14.60 |
| Full per-member tail | 4 | 424.31 [422.36–1954.52] | 1178.44 | 8.24–9.36 |
| Full per-member tail | 16 | 649.45 [623.59–7275.53] | 1134.78 | 11.08–11.35 |
| Full per-member tail | 32 | 868.50 [868.10–14707.01] | 1145.25 | 8.94–9.47 |
| Full per-member tail | 64 | 1340.63 [1324.73–29460.68] | 1132.98 | 7.98–8.35 |
| No `_ops` (unkeyed) | 1 | 359.59 [349.25–605.65] | 1025.22 | 15.11–16.56 |
| No `_ops` (unkeyed) | 4 | 403.49 [400.23–1888.59] | 832.83 | 11.03–13.00 |
| No `_ops` (unkeyed) | 16 | 537.01 [528.99–7367.80] | 775.37 | 10.72–11.30 |
| No `_ops` (unkeyed) | 32 | 731.16 [718.34–14601.89] | 765.59 | 8.50–8.95 |
| No `_ops` (unkeyed) | 64 | 1075.98 [1061.71–29394.12] | 764.06 | 7.60–7.99 |
| Batch metadata + no `_ops` | 1 | 358.61 [356.11–601.48] | 1013.82 | 15.75–16.83 |
| Batch metadata + no `_ops` | 4 | 378.79 [376.52–1011.82] | 508.56 | 10.48–11.03 |
| Batch metadata + no `_ops` | 16 | 489.39 [471.38–1888.60] | 370.38 | 8.24–14.15 |
| Batch metadata + no `_ops` | 32 | 615.14 [605.56–2636.34] | 350.41 | 7.98–8.50 |
| Batch metadata + no `_ops` | 64 | 882.16 [881.61–3819.42] | 340.15 | 7.48–8.04 |
| `r` update only | 1 | 268.14 [265.44–273.84] | 126.85 | 13.00–15.75 |
| `r` update only | 4 | 278.51 [270.13–281.29] | 85.28 | 9.36–10.24 |
| `r` update only | 16 | 306.67 [279.14–306.75] | 83.92 | 11.35–12.90 |
| `r` update only | 32 | 335.39 [329.95–336.31] | 78.66 | 9.47–10.10 |
| `r` update only | 64 | 406.19 [397.12–418.86] | 77.23 | 7.26–7.48 |

N=32 attribution (median of run means; COMMIT includes its loopback flight and flush):

| Variant | BEGIN→COMMIT µs | Apply wall µs | COMMIT wall µs | Worst run transaction p99 µs |
|---|---:|---:|---:|---:|
| Batch metadata + no `_ops` | 600.38 | 451.06 | 100.26 | 3638.09 |
| Full per-member tail | 848.48 | 669.70 | 134.86 | 20302.31 |
| No `_ops` (unkeyed) | 716.58 | 543.43 | 123.44 | 19940.19 |
| `r` update only | 320.97 | 186.83 | 85.00 | 633.71 |

## Cold plans, uncertainty and budget interpretation

Each repetition opens a fresh backend, like S1b’s committer thread. The namespace persists across three repetitions. Run 0 starts after the one-row `_commits` seed was analyzed; its FK trigger plan scans the growing table sequentially. Fresh backends in runs 1 and 2 use index lookups. Scan counters are recorded after each run, outside timing/WAL windows. This is observable cold-store work, not random noise and not a removed result. The median therefore usually picks the slower warm run.

For example, N=32 full-tail cumulative `(sequential scans, tuples read)` is [15170, 115056865], unchanged in subsequent repetitions; the index-scan totals rise instead. Refit the five points using each repetition separately:

| Variant | Run 0 marginal µs/member | Run 1 marginal | Run 2 marginal |
|---|---:|---:|---:|
| Full per-member tail | 458.29 | 15.05 | 15.35 |
| No `_ops` (unkeyed) | 457.31 | 11.19 | 11.36 |
| Batch metadata + no `_ops` | 49.21 | 8.31 | 8.38 |
| `r` update only | 2.09 | 2.32 | 2.16 |

All median slopes fit both the 70 µs margin-reserved and 93.75 µs pre-margin allowances in RFC §3.4. The cold full/no-receipt slopes do not, so this does not establish an every-run budget pass. Compare slopes **within this host and transport**: S1b’s ~150 µs/member and ~5.5 ms fixed came from 450a/450b over the network/SSH with a different client population. This 48-core host and direct loopback path cannot replace that fixed term or qualify a natural-link cycle. A large gap is evidence to measure the matched path, not proof that the real engine has already met a target.

No HTTP ingress, fencing/owner wait, rule/authority execution, dependent read levels, Rust interpretation, conflict reruns, permit pressure, natural arrival fill, sync readers or vacuum/read-cost campaign is modeled. No pipelined-command control was run. Thus this supplies the requested composed-statement/tail server-cost evidence; the RFC’s matched-path composition comparison, semantic oracle and whole-cycle qualification remain open. No throughput/SLO claim follows.

## Method, settings and custody

Host: commissioned as **expo-build-1000**, reporting hostname `expose-builder-pixel`; AMD EPYC 9454, 48 physical / 96 logical cores, 251 GiB RAM, Linux 6.8.0-142, ext4 `/dev/nvme0n1p4`. Rust 1.97.0; release profile with debug info, `-j 8`, lane-owned `CARGO_TARGET_DIR`. No CPU affinity or host-idleness assumption. All runs record `/proc/loadavg`’s three load averages before/after; observed ranges (1/5/15 minute): **7.26–16.83 / 11.10–15.94 / 11.92–13.28**. Plain statement run-mean spreads and per-cell load ranges are in `summary.json`. Non-monotonic timings are retained.

Private PostgreSQL 16.15 only; direct TCP to 127.0.0.1, no proxy/SSH. PG executables/libraries are from `~/tools/pg16`, with `TMPDIR=/tmp`. Durability/resource settings match the S1b `results-20261020-s1b-network/postgres.txt` record; statement/lock timeouts match its measured sessions (5 s).

| Setting | Value |
|---|---|
| `server_version` | `16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)` |
| `fsync` | `on` |
| `synchronous_commit` | `on` |
| `full_page_writes` | `on` |
| `wal_sync_method` | `fdatasync` |
| `commit_delay` | `0` |
| `shared_buffers` | `1048576` |
| `max_connections` | `300` |
| `checkpoint_timeout` | `300` |
| `max_wal_size` | `1024` |
| `autovacuum` | `on` |
| `track_io_timing` | `on` |
| `track_wal_io_timing` | `on` |
| `statement_timeout` | `5000` |
| `lock_timeout` | `5000` |
| `jit` | `on` |
| `plan_cache_mode` | `auto` |

`shared_buffers=1048576` is 8 GiB in 8 KiB blocks; `max_wal_size` is in MiB and timeouts are milliseconds. No durability, timeout or retry relaxation. Autovacuum/default checkpoint behavior is retained.

Each level repetition has 100 plain warm-ups, 1,000 measured plain statements and 200 separately timed EXPLAIN ANALYZE/BUFFERS/WAL statements, all explicitly committed. Every plain result must contain exactly the requested ids in total order and exact images. Commit repetitions use 1 s warm-up + 4 s measurement with exact counts checked after every apply; final witnesses check row totals, all counter images, head/revision/pin, final ordered log images and footprint keys, plus keyed outcomes for the full variant. Apply EXPLAIN plans are collected after measured windows in a rolled-back transaction; their WAL is excluded. All 32 cells × 3 repetitions completed, all correctness witnesses passed.

Reproduction (from this experiment; start **only** a private PG16 cluster with the settings above, and source its PG_UNIX_URL / PG_TCP_HOSTPORT):

```sh
export PATH="$HOME/tools/pg16/usr/lib/postgresql/16/bin:$PATH"
export LD_LIBRARY_PATH="$HOME/tools/pg16/usr/lib/x86_64-linux-gnu"
export TMPDIR=/tmp
export CARGO_TARGET_DIR=/home/ccheever/projects/sb4-g3b/snapback4/experiments/postgres-commit-path/target
cargo build --release --locked --features rt5 -j 8
B="$CARGO_TARGET_DIR/release/snapback4-postgres-commit-path"
# Repeat each kind for N=1,4,8,16,32,64:
"$B" g3b --net tcp --mode level --kind read --batch 32 --runs 3
"$B" g3b --net tcp --mode level --kind write --batch 32 --runs 3
# Repeat each variant for N=1,4,16,32,64:
CP_WARMUP_MS=1000 CP_MEASURE_MS=4000 "$B" g3b --net tcp --mode commit --variant full --batch 32 --runs 3
# Variants: full, no_ops, batch_tail, r_only. Stop and confirm the owned cluster.
```

The `rt5` feature selects the existing standalone build configuration; G3b uses none of the flight codec. Namespace creation/seed/analyze, prepare, final witnesses and namespace deletion are outside measurement windows. Variant order rotates by N. No product source, publication, push, stash or Git configuration change.

Governing context: LLP 3000.009.001.000.002 §§3.3–3.5, G3b/G8, read from `/home/ccheever/projects/sb4-land2` on `sb4-pg/perf-rfc`. The source advanced during orientation; the retained revision-3 snapshot `rfc-read.md` has SHA-256 `d9f4c3e4ea416c4fae10fb903ff4ca36269c05070e410b3e9baddf68b643f0ab`. This lane does not edit that worktree or select a product representation.

All raw JSON/EXPLAIN, runner, fit script, settings, build logs and PID records remain outside Git under `/tmp/claude-1000/-home-ccheever-projects-snapback/3d04fc0c-0698-42a7-917c-2880afdea35c/scratchpad/g3b/`. `full02/` is the complete final matrix. `smoke01/` is the successful short validation. `full01/` is an intentionally interrupted diagnostic with the earlier connection lifecycle; it is excluded because it differed from S1b’s per-repetition connection lifecycle, not as a load/rate rejection. The full02 first-run effect remains included.

Measured release binary SHA-256: `5ffe983d2257c4222fa036f551bdd57d3dad5cc8f7657f8e25bbb32678e91cf7`. `src/g3b.rs` SHA-256: `8360dd49ae83e46ca60ab8fb8b394608542db063d4b01e4ea5a9cc31ca771c88`. Raw manifest: `/tmp/claude-1000/-home-ccheever-projects-snapback/3d04fc0c-0698-42a7-917c-2880afdea35c/scratchpad/g3b/full02-measurement-sha256.txt`, SHA-256 `8f68fabd42e6b7f3f26c652b653da6ea217f478a2bf80da6c4e5225761cae7ee`. `summary.json` contains derived aggregates only; no raw logs are committed.

Cleanup: private postmasters **1047869** (smoke), **1055138** (diagnostic), and **1086874** (final matrix) all stopped. Independent `pg_ctl status` returned 3 for each; all three `postmaster.pid` files are absent. All **226** recorded cluster, harness, runner and build PIDs are absent. No PIDs remain. The `/home` free-space guard stayed above 25 GiB; final independent check: 26.24 GiB. Only lane-created dependency build caches were reclaimed; release binary and all evidence remain. Receipt: `/tmp/claude-1000/-home-ccheever-projects-snapback/3d04fc0c-0698-42a7-917c-2880afdea35c/scratchpad/g3b/final-cleanup.json`.
