# S1: scale controls and native Snapback serve

## Closed-loop read CPU diagnostics

`load --closed-loop --target snapback --workload W2 --workers 128 --rows 1000000`
keeps one request outstanding per worker using the same pooled reqwest client,
fixture-key mix and response validation as open-loop S1. Choose 64, 128 or 256
workers for the RCPU comparison. Do not supply `--rate` with `--closed-loop`.
The output format is `sb4-scale-closed-loop-v1`; these capacity diagnostics do
not qualify an open-loop offered-rate rung or its SLO. The ordinary `--rate`
mode retains its intended-arrival scheduler and open-loop format.
`successful_latency` reports validated successful reads separately, so quick
admission refusals cannot improve the displayed read latency; the existing
all-arrival latency and SLO accounting are retained.

On Linux, `--cpu-pids SERVER_PID` samples whole-process user+system CPU ticks
at the common measured boundaries, including the load client itself.
`--cpu-tree-root PRIVATE_PG_MASTER_PID` additionally samples the private PG
process family, including CPU of reaped children. The JSON retains process
birth ticks, actual boundary times, one-minute loads and live family PIDs.
Divide the CPU delta by `completed_in_window_per_s * duration_ms / 1000`,
which counts warm-up completions in the window and excludes drain. Missing
counters, a changed process identity or incomplete process-family inspection
must be reported rather than treated as zero. Other platforms emit null CPU
samples; load generation and validation remain available.


## S1-PG2: admitted maintained columns, unchanged Postgres baseline

[Matched W1–W5 report, comparison and archive](./results-20261022-snapback-postgres-2/README.md)
measures the unchanged Quarry application at P1-MC `45416b150c`, before the
request-round-trip reductions. It retains every failed and interrupted segment,
role/database-scoped statement deltas, per-second cohorts and counter outcomes.
Read the transport-tail and single-SSH-forward limitations before comparing
historical controls. The old S1-PG refusal below remains a historical record.

Build product and load harness as under S1-SK, then the independent native seed
helper (all targets must belong to the current worktree):

```sh
export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"
CARGO_TARGET_DIR="$PWD/../../target/s1sk" \
  LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT \
  cargo build --release --locked --manifest-path postgres-seed/Cargo.toml -j 4
mkdir -p target/pg2-NEW
setsid nohup sh -c 'python3 scripts/postgres-2.py --out target/pg2-NEW/raw --run-name p4; status=$?; echo "$status" > target/pg2-NEW/run.exit' \
  > target/pg2-NEW/run.log 2>&1 </dev/null &
echo $! # record; poll run.exit and cleanup, stop only owned processes
setsid nohup python3 scripts/postgres-2-observe.py \
  target/pg2-NEW target/pg2-NEW/raw run.exit \
  > target/pg2-NEW/observer.log 2>&1 </dev/null &
echo $! # record and poll this companion to exit too
```

Use a fresh short socket/runtime name and output; the database/role must be
absent before provisioning. The runner uses only its fixed owned database
`sb4_snapback_s1pg2` and role `s1pg2_app`, waits for other database activity,
seeds through `Engine::seed_at` locally on 450a, and removes them on a completed
matrix. An interrupted run retains the fixture for diagnosis; never drop a
fixture whose ownership is uncertain. URLs/passwords remain private environment
or mode-600 files. Supplemental `postgres-2-observe-local.py` and `postgres-2-observe-wal.py`
companions take the raw directory and full exit-marker path (two arguments).
Launch them detached and record their PIDs too. WAL timing is cluster-wide,
not database-only.

For the archived run, `scripts/combine-postgres-2.py <extracted-s1pg2>` selects
its twelve complete cells and audits the separately recovered interrupted-write
offset. `scripts/report-postgres-2.py <campaign> <out>` audits and regenerates
summaries/plots offline. `scripts/finish-postgres-2.py` is the final custody check
for that run's recorded directories/exit marker, not a generic cleanup command.
[ARCHIVE.md](./results-20261022-snapback-postgres-2/ARCHIVE.md) gives the exact
portable regeneration command and digest.

## S1-PG: Postgres admission blocks the required application

[Report, ledger and archive](./results-20261022-snapback-postgres/README.md):
all twelve required W1–W5 cells refuse deployment with
`E_STORE_UNSUPPORTED: maintained-columns`. No 1M fixture or matching load runs;
missing values stay missing. The report includes both Unix/SSH transport pings,
a minimal repro, and a separately labelled tiny-counter write-path diagnosis.

Build the product/harness in the same owned release targets as S1-SK below.
From this experiment directory, on a new owned database/runtime name, launch
`scripts/postgres.py`, then `scripts/postgres-probes.py`, each with
`setsid nohup python3 ... > <owned-log> 2>&1 </dev/null &`; record `$!` and poll
to exit. The first script provisions only `sb4_snapback_s1pg` / `s1pg_app`,
records the original refused deploy and stops its tunnel. The second resumes
that owned database, checks other cluster activity, records all repros/pings,
uses only native HTTP for the tiny counter, and drops its database/role.
An existing database/role refuses provisioning; preserve historical evidence
and choose a fresh owned runtime/output before a replay. Never reuse another
lane's database or change the shared cluster. Passwords stay in the existing
private file/environment. Rebuild this harness to obtain `ping-unix` and
`unix-proxy`; those verbs change the experiment only.

`scripts/report-postgres.py <raw-root> <result-dir>` regenerates the archived
run's aggregates, evidence-status records, reproduction sources and SVG in the
pinned plot environment. This blocked record does not qualify a throughput,
steady-state, write-outcome or RFC decision-rule measurement.

## S1-DX: SQLite write diagnosis

[Completed diagnosis and archive receipt](./results-20261022-snapback-sqlite-diagnosis/README.md).

`scripts/diagnose-sqlite.py` runs W4 at the eleven prescribed rates, with a
fresh `serve` process for each repetition, 10 s warm-up, 20 s measurement,
32 writers, pre-minted sessions and whole-cohort counter checks. Build the
unchanged product into `snapback4/target/s1dx` and this harness into its own
`target`, both with `--release --locked` and
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`. Build
`diagnosis-engine/Cargo.toml` with `--release --locked` into that owned
`snapback4/target/s1dx` **before** applying the timing patch.

From this experiment directory, with a private prepared S1-SK fixture:

```sh
setsid nohup python3 scripts/diagnose-sqlite.py \
  --out "$HOME/sb4scale/s1dx-NEW/bracket" --fixture /path/to/deployment \
  >"$HOME/sb4scale/s1dx-NEW-bracket.log" 2>&1 </dev/null &
echo $! # record and poll; no other benchmark/build should run concurrently
python3 scripts/instrument-sqlite.py apply --backup-dir ../../target/s1dx-local-patch-NEW
setsid nohup python3 scripts/diagnosis-layers.py \
  --out "$HOME/sb4scale/s1dx-NEW/layers" \
  --baseline "$HOME/sb4scale/s1dx-NEW/bracket" --fixture /path/to/deployment \
  >"$HOME/sb4scale/s1dx-NEW-layers.log" 2>&1 </dev/null &
echo $! # waits for bracket cleanup; then runs layers sequentially
# Poll both done and cleanup.json files, and check all owned PIDs exited.
python3 scripts/instrument-sqlite.py restore --backup-dir ../../target/s1dx-local-patch-NEW
python3 scripts/report-sqlite-diagnosis.py "$HOME/sb4scale/s1dx-NEW" /path/to/report
```

The timing patch is local and uncommitted. It extends the existing opt-in
trace to record exclusive session resolution, engine/program/COMMIT timing
and transaction counts. The diagnostic interposer times the real flush calls
without changing their behavior. `diagnosis-layers.py` runs the same deployed
fixture through the engine directly, a separately labelled SQLite primitive
at batch 1/16, and a release timing build. The primitive is a disk floor,
not a Snapback batch implementation or an RFC §8 batch qualification.
Runtime databases, tokens and applied product patches stay in ignored owned
targets; archive raw captures only after cleanup. Never stage product files.

## S1-SK: native Snapback serve on SQLite

[Completed matched-method report](./results-20261022-snapback-sqlite/README.md):
W1–W5 natural-link cells, 1M messages, latency/CPU/I/O, steady-state evidence,
control comparison, decision-rule status and raw archive SHA-256.

The [Quarry application](./snapback-app/README.md) implements the same W1–W5
fixture with maintained columns and membership/ownership rules. Build both
release binaries in this worktree:

```sh
cd snapback4
PATH="$HOME/.cargo/bin:$PATH" CARGO_TARGET_DIR="$PWD/target/s1sk" \
  LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT \
  cargo build --release --locked -p snapback4 -j 4
cd experiments/scale-controls
PATH="$HOME/.cargo/bin:$PATH" CARGO_TARGET_DIR="$PWD/target" cargo build --release --locked -j 3
setsid nohup python3 scripts/snapback.py prepare --out target/s1sk-prepare-NEW >target/s1sk-prepare-NEW.log 2>&1 < /dev/null &
echo $! # record and poll to completion before continuing
setsid nohup python3 scripts/check-snapback.py --out target/s1sk-checks-NEW \
  --fixture target/s1sk/s1sk-prepare-NEW/deployment >target/s1sk-checks-NEW.log 2>&1 < /dev/null &
echo $! # record and poll; checks use a disposable fixture copy
setsid nohup python3 scripts/snapback.py matrix --out target/s1sk-campaign-NEW \
  --fixture target/s1sk/s1sk-prepare-NEW/deployment >target/s1sk-campaign-NEW.log 2>&1 < /dev/null &
echo $! # record and poll until every cell and cleanup.json completes
```

`matrix` runs six natural-link cells (W1–W4, exact W5 and nominal 1% W5),
1M messages, fresh serve per cell, 10 s warm-up / 20 s measurement, three
repetitions, 128 read clients / 32 writers. It inherits the exact S1 rate search,
arrival scheduler, one-second deadlines, HDR accounting and qualification.
The native HTTP target is `--target snapback`; it depends on serve, not SQLite.
Private application sessions are minted before load and checked by serve per
request. No token values enter captures. Release process/mutex, detached query
readers, default SQLite WAL/FULL durability and background work stay unchanged.
The local SQLite cell has no database network hop: the +0.5 ms sweep applies to
the future Postgres-backed cell, not to SQLite.

One cell can be replayed with `scripts/snapback.py cell --fixture <prepared-dir>
--out target/replay-NEW --workload W4 --writers 32 --keys disjoint`; wrap it in
the same detached launch. `cell.json` retains its full replay command. Resource
evidence includes process CPU/I/O, diskstats, thread wait channels and WAL file
sizes. OS write bytes include checkpoint/filesystem effects and are not logical
PG WAL bytes. Two native operator mint barriers and stable counter snapshots
drain the writer outside each trial; warm-up plus measured acknowledgements
must equal committed increments. Unknown outcomes are retained and disqualified.

`scripts/report-snapback.py <campaign> <result-dir>` uses the existing independent
audit and publishes the matched table, all rate summaries, latency spreads,
steady-state arrival cohorts and SVGs. Run it in the plot environment pinned by
`scripts/plot-requirements.txt`. Keep raw cells outside Git; archive them under
`~/sb4scale/archive/` with SHA-256 in the result's ARCHIVE.md.

Periphery for [LLP 3000.009.001.002](../../../llp/3000.009.001.002-scale-limits-against-postgres-controls.rfc.md),
§4–§7 and §9. Its own Cargo workspace; no engine or product changes. W6 live
delivery and the remaining controls belong to later lanes.

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

Raw PG now authenticates every `/op` request with HS256 using pinned
[`jsonwebtoken` 9.3.1](https://docs.rs/jsonwebtoken/9.3.1/jsonwebtoken/struct.Validation.html).
The service reads `SCALE_JWT_SECRET_FILE` (mode 600), checks signature,
algorithm, expiration, optional not-before, issuer `supabase`, audience and
role `authenticated`, then maps the signed fixture UUID `sub` to its user ID.
It ignores the body's principal. There is no verification cache. The runner
mints the same claims shape as Supabase and keeps tokens/keys under ignored
`target/private/`. `--target raw-pg-no-token` explicitly reproduces the
historical trusted-principal path (`serve --no-token`); label it separately.

The [completed S1-FR report](./results-20261022-fairness/README.md) compares token raw PG,
labelled no-token raw PG, Supabase advocate and Convex advocate with matched
10 s/20 s windows and three repetitions.

The S1-FR matched campaign (three controls run serially, 12 cells each) is:

```sh
setsid nohup python3 scripts/fairness.py --out target/fairness-20261022 >target/fairness.log 2>&1 < /dev/null &
echo $! # record this PID, then poll until completion
```

It uses private `s1fr_raw_1000000` / `s1fr_supabase_1000000` databases and
private login roles, without altering the cluster or existing Supabase roles.
Every cell starts a fresh service and uses 10 s warm-up, 20 s measurement,
three repetitions, query pool 32 / 128 read clients, and 32 write clients.
The rate search, deadlines, SQL, RLS, RPCs and SLO rules are inherited unchanged.

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
membership/ownership predicates enforce rules in SQL. Historical raw-PG
results predating S1-FR receive principal IDs from the trusted load generator
and exclude token verification; current default raw-PG runs include it.

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
The Supabase advocate review is the `advocate` measurement on this branch.
Convex's review, idle-host qualification, and a reviewed-control claim for
the other systems are still outstanding.

`python3 scripts/audit.py RESULTS_DIR --full` verifies the complete 132-cell
raw matrix after cleanup: every repetition, offered-arrival accounting,
error/SLO/counter decisions, histogram counts, original stdout versus archived
buckets, and the reported brackets. Omit `--full` for a partial control run.
Database CPU samples cover this cluster's recorded Postgres processes; SSH
server CPU and other lanes are outside that process attribution. SQL executor
time is not CPU and excludes transaction completion outside the executor.

## S1-SB: Supabase's native PostgREST path

This target measures **PostgREST alone with Supabase roles, JWTs and RLS**,
not the complete self-hosted stack. No Docker, GoTrue, Kong, Realtime, Studio,
Storage or Supavisor is installed. No external or paid service is used.
GoTrue is replaced by offline HS256 JWT minting before measurement; subjects
are deterministic UUIDs, and PostgREST performs its normal JWT verification
and role/claim transaction setup. Kong would add an HTTP gateway hop to a
full stack request; this experiment does not estimate its unmeasured latency.
Realtime is outside W1–W5. The shared cluster is never restarted or reconfigured.

The pin follows [Supabase's compose file at
5491fb60bc0f27b8909a83100d79499aa7667ee5](https://github.com/supabase/supabase/blob/5491fb60bc0f27b8909a83100d79499aa7667ee5/docker/docker-compose.yml):
**PostgREST 14.18**, [official release](https://github.com/PostgREST/postgrest/releases/tag/v14.18).
`scripts/install-postgrest.py` downloads the official static x86-64 release
into `~/sb4scale/bin`, verifies GitHub's release asset SHA-256
`98de1c0be7787aea5f5e11a25f303ea0077634d6fc1000b687bfa825fd27d299`,
then verifies the executable SHA-256
`e62299f98f67938f754291340b2fc07b69685546e6017b455ef3e776daef45ee`.
It neither builds a substitute binary nor uses a container.

```sh
python3 scripts/install-postgrest.py
# Build above, with CARGO_TARGET_DIR inside this worktree.
python3 scripts/check-supabase.py "$HOME/sb4scale/s1sb-checks-NEW"
python3 scripts/run.py all --target supabase \
  --out "$HOME/sb4scale/results-NEW-supabase-cells" \
  --warmup-ms 500 --duration-ms 2000 --repeats 3
# Advocate headline cells: W1–W5 at 1m, natural and +0.5 ms, matrix writer counts.
python3 scripts/run.py advocate --target supabase \
  --out "$HOME/sb4scale/results-NEW-supabase-advocate-cells" \
  --warmup-ms 500 --duration-ms 2000 --repeats 3
# One cell, same fixture sizes/delays/writers and rate policy as S1-H:
python3 scripts/run.py cell --target supabase --out "$HOME/sb4scale/s1sb-NEW-cell" \
  --workload W4 --rows 1000000 --delay-us 500 --writers 32 \
  --warmup-ms 500 --duration-ms 2000 --repeats 3
```

The runner creates only `sb4scale_supabase_100000` and
`sb4scale_supabase_1000000`, with API schema `sb4scale` and helper schemas
`auth`/`private`. It creates standard `anon`, `authenticated`, `service_role`
and `authenticator` roles if absent, recording ownership outside Git. It
refuses existing roles not in its ownership receipt. `authenticator` is a
NOINHERIT login allowed to SET ROLE to the other three; `service_role` has
BYPASSRLS but is never used for measured requests. `anon` has no table grants.
Only these owned roles receive documented Supabase statement timeouts:
anon 3 s, authenticated/authenticator 8 s; service_role inherits authenticator's
8 s when unset ([timeout guidance](https://supabase.com/docs/guides/database/postgres/timeouts)).
The load generator retains S1-H's 1 s HTTP/dispatch deadline, no retries, and
unknown-outcome counter disqualification.

`supabase.conf` preserves the compose configuration and PostgREST v14.18
defaults except the pool. Prepared statements stay on. There is no pre-request
or pre-config hook. In-database configuration stays on, and the `pgrst`
notification listener stays on. The runner sets `PGRST_DB_POOL` to the raw-PG
budget for that cell: **32** for W1–W3 and **one connection per writer** for
W4–W5, plus the listener connection. PostgREST's pool guidance is to start
from the database's cores (`(cores * 2) + spindles`; this host has 12 threads)
and raise the pool while HTTP requests wait and Postgres is idle, without
exceeding `max_connections`. The first measured pool of 10 did that waiting.
The official binary is linked with `-N -I0 -qg`, so one process uses every
core in the app affinity mask. The pinned compose runs one PostgREST; a
second process on the same three cores is not the documented scale-out.
The file still sets a
1,000-row API maximum, `public` extra search path, commit transaction end,
10 s pool acquisition timeout, 1,800 s lifetime, 30 s idle timeout,
automatic recovery on, `.role` claim key, no required audience, JWT cache
1,000 entries, error logging and OpenAPI follow-privileges. All effective
settings are dumped per cell with URI and secret redacted. The example
configuration's commented cache-disabling example is **not** its default;
the pinned [Config.hs](https://github.com/PostgREST/postgrest/blob/v14.18/src/PostgREST/Config.hs)
sets the default to 1,000. The 256 repeated user tokens fit in that cache.
JWT expiry defaults in app settings remain 3,600 s; harness-issued tokens use
24-hour expiry to survive the complete matrix, recorded as a substitution.

Host/port bindings change to loopback 58080 (API), 58082 (health) and 58081
(DB dispatcher). `PGRST_DB_URI` selects the owned database and
`application_name=sb4scale_supabase`. `PGRST_DB_USE_LEGACY_GUCS=false` follows
compose (v14 uses `request.jwt.claims`). `PGOPTIONS` selects
`search_path=sb4scale,public` for seeding/observation. URI passwords come only
from `~/sb4scale/pw`. The generated secret and bearer-token files are mode
600 outside the repo; tokens, secrets, URI passwords and role verifiers are
never logged. The runner records every subprocess PID and its cleanup status.

The [RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security)
and [policy performance guidance](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv)
govern `supabase-schema.sql`: explicit authenticated policies, indexed
membership predicates, an uncorrelated room-membership set, and initplans
for claim/identity lookup. `auth.uid()` reads the UUID `sub` from
`request.jwt.claims`. A pinned-path SECURITY DEFINER helper in **unexposed**
`private` maps `(select auth.uid())` through an indexed `users.auth_id`.
Policies use `(select private.principal_id())` and `(select private.member_rooms())`
so identity and the membership set are each computed once per statement.
This retains S1-H's numeric keys and identical message bodies, memberships,
last-read offsets and maintained totals. The only added storage is one UUID
column/unique index on 256 users and an owner index on 257 counters; table
and index bytes are measured separately. The same `seed.sql` is reused.

| Workload | Native HTTP request | Database authority |
|---|---|---|
| W1 | GET messages filtered by id | messages SELECT RLS |
| W2 | GET messages filtered by room, ordered descending, limit 20 | messages SELECT RLS |
| W3 | POST rpc/inbox | SECURITY DEFINER SQL with the same principal filter |
| W4/W5 | POST rpc/increment | SECURITY DEFINER atomic UPDATE; same owner/member predicate; service_role still unrestricted |
| Post witness | POST messages | member/sender INSERT RLS; definer trigger maintains room/sender totals atomically |

No extra `/op` HTTP application wraps PostgREST. The load adapter supplies
Bearer tokens and normalizes response shapes for the existing validator;
all arrival times, worker assignments, key mixes, histograms and SLOs stay
in the existing scheduler. An app-core TCP dispatcher leases a distinct SSH
stream to each physical libpq socket (including the notification listener).
It adds a local TCP forwarding step that raw PG does not need; its CPU is
included in app CPU together with the unchanged S0 proxy and PostgREST.
The raw prepared-SELECT RTT controls remain independent measurements of
SSH plus nominal proxy delay; they do not include this dispatcher or HTTP.

The exact S1-H core split, 100k/1m read sizes, four delay settings, 128 read
clients and 1–256 write clients are preserved. The query pool now matches
raw PG's budget on each cell (32 reads, one connection per writer) instead
of the compose default of 10. `supabase-align.sql` applies the same policies
and definer functions to an existing fixture without reseeding. Shared
hosts, serial short windows and coarse brackets retain all S1-H caveats.
The advocate review is the `advocate` mode above; it is one worker and does
not retune the cluster. Convex's advocate review is still outstanding.

Resource queries filter the owned database, statement roles
`authenticated`/`authenticator`, and application name `sb4scale_supabase`.
Counter witnesses read the owned schema. App CPU aggregates PostgREST and
the dispatcher/proxy; generator, all owned SSH forwards, cluster CPU,
waits/statements/WAL/I/O and before/after RTT remain the S1-H collectors.
Statement rows with the same query ID across both roles are summed before
taking deltas. Nested RPC execution is included, so summed executor times can
overlap; SQL calls/executor sums are neither wire roundtrips nor request wall
time or CPU. The independent process CPU samples remain the CPU evidence.
Raw per-cell captures and check runs belong in compressed archives under
`~/sb4scale/archive/`; only summaries, configurations, code and plots are
committed. Each result directory's `ARCHIVE.md` records its SHA-256.

Orientation: [LLP 3000](../../../llp/3000-snapback4.explainer.md)#7 and
[LLP 3000.009.001.002](../../../llp/3000.009.001.002-scale-limits-against-postgres-controls.rfc.md)#4-controls,
#5-workloads and #6-method-and-metrics govern this periphery. The scale RFC
and Postgres parent are in `llp/current/`, not foundation. No product
authoring surface or engine changes are made. Expected document updates
are the result README, §9 progress note and append-only journal; hand-off:
none. Advocate review, idle-host qualification, matched-pool controls and
W6 remain open rather than being inferred from these results.

## S1-CX: native Convex with Postgres persistence

The Convex lane uses the official prebuilt release
`precompiled-2026-10-10-72ce13c` (source
`72ce13c379fe6dbdfc305bc8ad699c5663c68c2a`), rather than its Docker image.
[`install-convex.py`](./scripts/install-convex.py) verifies the official asset
SHA-256 before extraction into `~/sb4scale/bin`. The binary reports
`local_backend unknown`; the release/source and executable hashes identify it.
[`convex-app`](./convex-app) pins the CLI/SDK to 1.47.0. Install its dependencies
with `cd convex-app && bun install --frozen-lockfile`; build this harness as above.
No dashboard, action runner, hosted service or identity-provider server is needed.

[`scripts/convex.py`](./scripts/convex.py) owns only its recorded child PIDs and
`sb4scale_convex_100000` / `sb4scale_convex_1000000` databases. It connects to the
existing cluster through the same independent SSH-stream dispatcher and S0
per-direction proxy as Supabase. It creates no shared roles and changes no
cluster settings. The cluster owner's existing credential is read from the
mode-600 password file; the native Postgres driver requires the credential in
its URL argument, so process command lines and environments must not be dumped.
Only a redacted URL is saved. Instance secrets, admin keys and fixture signing
keys/tokens stay mode 600 under `~/sb4scale/s1cx/`, outside Git and raw archives.

The guide's `--db postgres-v5 SERVER_URL` selects Postgres persistence; the
instance name with hyphens replaced by underscores selects the database.
For example `sb4scale-convex-1000000` uses `sb4scale_convex_1000000`.
`--do-not-require-ssl` permits the existing plaintext loopback/SSH database path;
`--disable-beacon` suppresses telemetry. Ports are loopback 58080 (API),
58081 (dispatcher), 58083 (unused HTTP actions). Local file/module/snapshot
storage is retained under the instance directory outside Git; document and index
persistence is Postgres. The published compose setting
`DOCUMENT_RETENTION_DELAY=172800` is retained. Other native defaults stand;
each cell publishes its explicit configuration.

`POSTGRES_MAX_CONNECTIONS` is **32 for reads / C for writes**, matching the raw
and Supabase-advocate upper budgets. Convex shares that pool with persistence
background work; it does not have a one-connection-per-function execution model.
`APPLICATION_MAX_CONCURRENT_QUERIES` and
`APPLICATION_MAX_CONCURRENT_MUTATIONS` are also set to 32 / C. This raises the
compose default 16 on large cells and lowers it on small cells. Background work,
OCC retries and default function/index caches remain enabled. Observer sessions
are outside the budgets. Pool counts are dynamic; capture actual connections
and cache/retry metrics rather than claiming equivalent busy SQL connections.

Public requests call `/api/query` and `/api/mutation` directly using reqwest,
as documented by the [Convex HTTP API](https://docs.convex.dev/http-api/).
There is no extra HTTP app or client-side retry. Float64 fixture numbers in
Convex's JSON response are normalized to exact safe integers for the existing
validator. An offline RS256 issuer supplies bearer JWTs (24-hour expiry);
Convex verifies signatures, issuer, audience and expiry using its documented
[custom JWT/data-URI JWKS provider](https://docs.convex.dev/auth/advanced/custom-jwt).
Every measured function derives its principal from `ctx.auth`, then checks
membership/ownership. Admin credentials are used only for deployment and
before/after internal counter witnesses. Numeric fixture identities use indexed
application fields alongside Convex's generated `_id`; indexes bound point,
member, ordered-page and inbox reads. Posts atomically maintain room/sender
totals; W4/W5 use ordinary read-modify-write mutations with Convex's own OCC.

Run detached (record the returned supervisor PID), then poll its log and the
cell summaries. All cell manifests retain a complete replay command. Examples:

```sh
python3 scripts/install-convex.py
# Run each in its own setsid supervisor, with stdout/stderr redirected outside Git:
python3 scripts/check-convex.py --out "$HOME/sb4scale/s1cx/checks-NEW" --rows 1000000
python3 scripts/convex.py matrix --out "$HOME/sb4scale/s1cx/cells-NEW"
# matrix = 66 cells: both read sizes, natural/+0.5 ms, writers 1–256.
# all = all 132 S1-H cells, adding +0.2 and +1.0 ms.
python3 scripts/convex.py cell --out "$HOME/sb4scale/s1cx/replay-NEW" \
  --workload W4 --rows 1000000 --writers 32 --delay-us 500 --rates 400 800 1131 1600
```

The native backend stops after each cell and at runner exit. To restart it with
owned SSH streams and the recorded settings, run a new detached supervisor:

```sh
setsid python3 scripts/convex.py serve --out "$HOME/sb4scale/s1cx/serve-NEW" \
  --rows 1000000 --writers 32 --delay-us 0 >"$HOME/sb4scale/s1cx/serve-NEW.log" 2>&1 < /dev/null &
# Immediately record $! outside Git. SIGINT to that exact supervisor triggers cleanup.
```

The [pinned self-hosting guide](https://github.com/convex/convex-backend/tree/72ce13c379fe6dbdfc305bc8ad699c5663c68c2a/self-hosted)
explains native binaries, Postgres naming, admin keys and knobs.
This measures **Convex/PG self-hosted**, not Convex Cloud or Convex's production
storage path. Default query caching makes a hot read an application-cache test
as well as a persistence test; no uncached per-request SQL interpretation is valid.

The counter witness spans warm-up plus measurement. Whole-cohort failures are
derived from the scheduler's exact arrival count and total acknowledgements;
`warmup_error_count` is reported separately. A committed, timed-out warm-up
request is an unknown outcome even when the measured window has zero errors.
Counter inequality always disqualifies the trial; an excess with no failures
anywhere in the cohort, or fewer commits than acknowledgements, still aborts.

Convex's post-load drain uses its current outstanding-HTTP and unpublished-commit
gauges: two consecutive zero samples 100 ms apart, with a 30 s bound. The
committer gauge includes queued/prevalidation/persistence work. Persistence
maintenance can keep SQL active after every request settles, so SQL-wide idle
is not a Convex readiness condition. Raw PG/Supabase retain their existing
application-SQL drain. Native drain samples remain in each raw trial record.

## Shared one-host S1 runner

`scripts/s1-onehost.py --system {snapback,rawpg,supabase,convex}` applies the
same S1-PG4 Unix delay link to every target. PG16.15 uses physical cores
0–2 (both SMT siblings), service/proxy 3–4, generator 5. Each invocation owns
a private socket-only cluster with `postgresql.conf.delta`, an identical 1M
seed, fresh service per cell, 10 s warm-up, 20 s measured and three repetitions.
It waits for unrelated processes above one sampled CPU core at cell start,
records loadavg and live affinities, and stops below 30 GiB free on `/home`.
Links A/B add 250/500 µs per direction. Every boundary captures 1,000 prepared
SELECT 1 timings after 100 warm-ups through the exact selected link.

The inherited double/halve search and geometric midpoint also test read rates
19,027 and 22,627. Every repetition must meet intended-arrival p99 ≤ 50 ms
reads /100 ms writes, errors ≤ 0.1%, and whole-cohort counter equality. Reads
use 128 clients and pool/function cap 32; writes use 32 clients and cap 32.
Advocate SQL, JWT handling, native caches and Convex OCC/backoff remain unchanged.

From the repository root, with the user-local PG16.15 tools and
`pg_stat_statements` installed:

```sh
export PATH=$HOME/.cargo/bin:$HOME/.local/bin:$HOME/.local/sb4-postgresql-16.15/bin:$PATH
export CARGO_TARGET_DIR=$HOME/projects/sb4-s1sk/snapback4/target
cargo build --release --locked --manifest-path snapback4/experiments/scale-controls/Cargo.toml
python3 snapback4/experiments/scale-controls/scripts/s1-onehost.py \
  --system rawpg --mode smoke --out "$HOME/sb4scale/onehost-smoke-NEW"
python3 snapback4/experiments/scale-controls/scripts/s1-onehost.py \
  --system rawpg --out "$HOME/sb4scale/onehost-rawpg-NEW"
```

Replace `rawpg` with either advocate target; install the pinned Convex app
dependencies with `bun install --frozen-lockfile` from `convex-app/`. Run each
supervisor detached, redirect logs outside Git, and immediately record its PID.
`--mode cell --workload W5 --keys same --link B` reproduces one cell. All raw
evidence stays outside Git; the runner stops only recorded processes. It removes
the stopped cluster data and retains credentials privately for the known-secret
audit before final deletion.

For Snapback, build `snapback4` with `--release --locked -p snapback4 --features
postgres` from its workspace and build the isolated `postgres-seed/Cargo.toml`
helper with the same target directory. Then use `--system snapback` with the
same runner; `--snapback-bin` and `--seed-bin` select explicit release binaries.
The native app, account sessions, `Engine::seed_at` and drain witnesses are the
S1-PG4 forms. No separate scheduler or capacity rule is used for Snapback.
