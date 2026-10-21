# S1-H: scale harness and raw PostgreSQL control

Periphery for [LLP 3000.009.001.002](../../../llp/3000.009.001.002-scale-limits-against-postgres-controls.rfc.md),
§4–§7 and §9. Its own Cargo workspace; no engine or product changes. W6 live
delivery and the other controls belong to later lanes.

Build on **expo-build-450b**, in this worktree:

```sh
cd snapback4/experiments/scale-controls
export PATH="$HOME/.cargo/bin:$PATH"
export CARGO_TARGET_DIR="$PWD/target"
cargo build --release --locked -j 4
```

Provision only this cluster on **expo-build-450a**: copy `scripts/cluster.sh`
to `~/sb4scale/scripts/cluster.sh`, and `postgresql.conf.delta` to
`~/sb4scale/postgresql.conf.delta`; run `bash ~/sb4scale/scripts/cluster.sh init`
then `... start`. It uses the supplied relocated PG17 binaries, `initdb -L`,
and PG16's library directory. It generates `~/sb4scale/pw` with mode 600.
Copy that file securely to **450b** at the same path, preserving mode 600;
never put its contents in arguments, logs or Git. Copy `scripts/db-monitor.py`
to `~/sb4scale/db-monitor.py` on 450a for cluster-only CPU capture.

The cluster is durable (`fsync`, `synchronous_commit`, `full_page_writes` on),
with 8 GiB shared buffers and 320 connections. `pg_stat_statements` is installed.
`jit=off` is explicit because the relocated package lacks `libLLVM.so.19.1`.
All later controls must inherit these settings. `cluster.sh stop` checks the
postmaster PID against the record made at start; it never searches by name.
The runner leaves the cluster and two fixture databases running/retained.

```sh
python3 scripts/check.py results-NEW-checks
python3 scripts/run.py reads --out results-NEW-reads
python3 scripts/run.py writes --out results-NEW-writes
# One command reproduces one cell (including service, tunnels and capture):
python3 scripts/run.py cell --out results-NEW-w1 --workload W1 --rows 1000000 --delay-us 500 --writers 128
# Exact offered rates can be replayed instead of the adaptive bracket:
python3 scripts/run.py cell --out results-NEW-w4 --workload W4 --rows 1000000 --delay-us 0 --writers 32 --rates 1600 3200 4525 6400
```

Every cell records its complete rerun command. Default runs use 1 s warm-up,
3 s of measured fixed arrivals, three repetitions, serial cells. Rates double
or halve until a passing/failing bracket exists, then test one geometric
midpoint. Every repetition must meet p99 ≤ 50 ms (reads) / 100 ms (writes)
and error rate ≤ 0.1%. The reported ceiling is the highest **tested** passing
rate, not an interpolated exact maximum. No failing rate means a lower bound.
`--rates`, `--warmup-ms`, `--duration-ms` and `--repeats` permit longer follow-up.

The load generator schedules independently of completions. Each arrival is
assigned round-robin to a fixed client worker, and latency starts at its
**intended** arrival. Queued arrivals remain in the histogram. Arrivals more
than 1 s late become explicit errors, with their full queue latency; an HTTP
request also has a 1 s deadline. No arrival disappears. Both offered-cohort
throughput and completions inside the measurement window are recorded, along
with p50/p99/p99.9 and mergeable HDR histogram buckets (nanoseconds, 3 digits).
Write acknowledgements, including warm-up, are checked against counter deltas.
An HTTP timeout may have an unknown commit outcome; the database is drained,
the discrepancy retained, and the rate disqualified. No automatic write retry.

`src/db.rs` is the hand-written prepared SQL. Pool connections have independent
SSH local forwards to 450a's **loopback** port 55440, following S1b (the
firewalls allow only SSH). The password is read from a mode-600 file. Natural
RTT has no proxy; the 200/500/1000 µs **added RTT** settings reuse S0's actual
`src/proxy.rs`, with half the delay in each direction. They add to the natural
link; they are not absolute RTT targets. The proxy replaces `tc netem`, which
needs root. The app process owns its proxy threads, so proxy CPU is included
in app CPU. Every cell has before/after prepared-SELECT RTT controls.

The schema is Clique-shaped: users, rooms, memberships, messages, per-room
maintained totals, per-user sent totals and counters. It follows the room rule
and the existing `fixtures/clique.mjs` mapping (conversations → rooms,
conversationId/userId → room/principal), but scales a deterministic synthetic
fixture instead of replaying the full social/media log: 256 users, 1024 rooms,
32 ordinary memberships/user, 100k or 1m messages with an approximately 160-byte text payload,
and one shared counter room. W1 chooses visible message IDs across rooms; W2
returns the newest 20; W3 joins 32 memberships to totals and last-read offsets.
An authorized post updates room/sender totals in the same transaction through
a trigger, checked by `check.py`; posting/live delivery is not a measured W6.
W4 updates the caller's counter; W5 updates one shared counter or selects it
for exactly 1 in 100 arrivals per writer, staggered by writer. The service's
membership/ownership predicates enforce rules in SQL. Benchmark principal IDs
are supplied by the trusted load generator; identity-provider/authentication
cost is excluded from all these rows.

Caveats required for interpreting this first matrix:

- App and load generator share 450b. `taskset` gives app + proxy physical cores
  0–2 (logical 0–2,6–8), load cores 3–5 (3–5,9–11), with SSH pinned to cores 4–5 (4–5,10–11).
  App and generator cores do not overlap; SSH shares the generator allocation.
  SMT siblings stay together. This is not the RFC's three-host topology.
- Both fleet hosts may have other lanes. Local `/proc`, `vmstat` before/after,
  owned SSH/app/load CPU, and this cluster's `/proc` CPU are retained. These
  are exploratory shared-host observations, not an idle-host qualification.
- Short repeated windows expose a rate bracket, not a long-duration production
  capacity. p99.9 at small writer counts has few tail samples.
- `perf_event_paranoid=4` prevents a CPU stack profile without privileges.
  `/proc` attribution and SQL wait/statement evidence are available instead.
- SSH, proxy scheduling/spin CPU, local HTTP, and a single Rust process are part
  of these measured paths. TLS, replication and direct database TCP are absent.

Result directories contain source/binary hashes, exact settings, seed/storage
records (including each index's size/entry estimate), PID ownership/cleanup,
RTT controls, per-rate JSONs, histograms, app/SSH CPU, database CPU, wait samples,
`pg_stat_statements`, `pg_stat_wal`, `pg_stat_io` and database before/after
snapshots. Statement deltas are immediate; some asynchronous cumulative PG
statistics can lag short windows. Never reset shared counters between controls.
The cluster-only monitor reads the recorded postmaster and its direct children
and exits on SSH stdin EOF; it never signals database processes.

Later Supabase/Convex/Snapback lanes should reuse the fixture, workloads,
principal/authorization semantics, rate/SLO policy and JSON format. Their HTTP
adapters should return the `/op` response shapes or supply an equivalent load
adapter. Use distinct databases, the same cluster settings and one SSH stream
per concurrent physical connection; serialize measurements on the pair.
Keep W6 subscriptions separate until each control has its live implementation.

The initial one-core generator partition is retained under
`results-20261021-generator-core1/` as a partial control. CPU evidence exposed
the generator limit. The main matrix gives it all three non-app cores, sharing
two with SSH; `--load-cores` reproduces either partition. The application cores
and SQL, durability, load timing and SLO rules are identical. The default
3-second windows can be shortened explicitly; the initial matrix uses 0.5 s
warm-up and 2 s measurement, three repetitions, as its manifests record.

After capture, `scripts/archive.py RESULTS_DIR` losslessly compresses verbose
resource/transport records and histogram buckets, leaving quantiles and a bucket
file reference in each plain result JSON (and removes empty tunnel diagnostic
files only). The original complete stdout is also retained losslessly.
`report.py` reads plain or gzip records; the per-rate result JSONs, cell
manifests and summaries remain plain. Run `report.py RESULTS_DIR` to regenerate
`ledger.json`, `ledger.md` and `curves.json`.

The runner raises its own file-descriptor soft limit to 8192 (within the
existing hard limit), inherited by its children: 256 S0 proxy connections plus
HTTP/DB sockets need more than the machine's default 1024 descriptors. This
requires no privileges and changes no machine-wide configuration.

For the other lanes, `load.rs` supplies the intended-arrival scheduler,
worker/key assignment, deadline handling, response validation and histogram
format. Add each system's native HTTP payload/response adapter there, or an
explicitly measured `/op` adapter; do not silently add an extra HTTP hop to
only one control. Translate the deterministic seed and its ordinary/shared
room rules into each backend. `run.py` currently starts the raw service and
its collector filters `application_name=sb4scale_raw`, statement userid
`scale_app`, and reads the raw `counters` table. Change those filters and the
counter witness for each backend; a Convex generic store will not have that
typed table. Keep the same rate/SLO/cohort policy and CPU allocation, and
compare p50 at matched offered rates, not only at each backend's own ceiling.

The independent SSH ports are exposed as `SCALE_TUNNEL_PORTS`. A backend whose
pool accepts one fixed database URI needs a connection dispatcher that assigns
one unused SSH stream per physical connection; pointing every pooled socket
at one forward would reintroduce S1b's multiplexing difference. The raw pool
already implements the independent allocation. Use separate databases/roles,
record the actual RTT, and serialize the controls' measurements on this pair.
Advocate review from another model family remains outstanding under this
lane's explicit one-worker/no-sub-agent instruction; no reviewed-control or
idle-host qualification is claimed here.

`python3 scripts/audit.py RESULTS_DIR --full` verifies the complete 132-cell
raw matrix after cleanup: every repetition, offered-arrival accounting,
error/SLO/counter decisions, histogram counts, original stdout versus archived
buckets, and the reported brackets. Omit `--full` for a partial control run.
Database CPU samples cover this cluster's recorded Postgres processes; SSH
server CPU and other lanes are outside that process attribution. SQL executor
time is not CPU and excludes transaction completion outside the executor.
