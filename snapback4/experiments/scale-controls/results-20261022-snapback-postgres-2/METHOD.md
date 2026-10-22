# Method and boundaries

The unchanged S1 app is `snapback-app/snapback/schema.q` (SHA-256
`d81afc50e1ead9ba3c8fd245fc2fd84f2ed1b179e03d3382fccf18b2bef9c65f`).
Product revision: `45416b150c`. No engine, committer, store, server, resource
ceiling, durability setting or app rule is changed by this lane.

Public `deploy` receives the Postgres URL through `SNAPBACK4_STORE_URL`.
The private URL/password never enters an argument or committed record. The
experiment creates only `sb4_snapback_s1pg2` and role `s1pg2_app`. Postgres
17.9 stays on 450a:55440, postmaster 2735539; no restart or configuration change.
Every cell checks other databases' client activity first and waits if busy.
This is a point-in-time check, not a distributed reservation or proof of host
exclusivity. CPU/load and database wait evidence retain contention visibility.

The fixture helper runs on 450a, using the release-built common engine and
`Engine::seed_at`, the same implementation behind development `/seed`.
It acquires the standard store lease and renews every 700 ms with its default
three-second lease. It imports parents/memberships/counters, then 1M messages
in 4,000-message transactions, with no supplied maintained fields. Initial
last-read offsets are the final deterministic values; S1-SK wrote the same
values after messages. This changes setup order, not the measured image.
The helper creates 256 native account sessions before measurement, privately
copies their tokens to 450b and releases its lease. Reported seed time belongs
to this local-to-database setup path, not cross-host HTTP ingest.

Read-only SQL verifies source images and room/user totals against source
recounts. VACUUM ANALYZE and storage capture occur before load. No SQL writes
managed rows. Native public HTTP is used for all measured operations.

App/Unix delay proxy: cores `0-2,6-8`; generator: `3-5,9-11`; SSH: `4-5,10-11`.
As in the controls, generator and SSH share some cores. A stable Unix socket
symlink selects the natural SSH forward or the experiment's unchanged delay
algorithm, adding 250 us in each direction. It leaves the deployment's textual
socket binding unchanged. Prepared SELECT 1 RTT is captured before and after
each cell. Added delay is confined to the database link.

Each workload/link cell gets a fresh serve process. Within it, the common S1
rate search halves/doubles to bracket, then tests a geometric midpoint. Each
rate gets three 10 s warm-ups / 20 s measurement repetitions. There are 128
read clients and C=32 write clients; the product's shipped admission/reader
budgets remain unchanged. This follows S1-SK cell freshness, not S1-DX's stronger
fresh-process-per-trial diagnostic. Reads require p99 <=50 ms, writes <=100 ms,
and errors <=0.1%; every repetition must pass. Intended-arrival scheduling,
expired-arrival accounting, errors, per-second cohorts and complete histograms
are inherited unchanged from the matched Rust harness.

After each load, two native guest-session writes cross the serving writer
before counter stability checks. These replace the inherited SQLite runner's
`token` CLI drain (explicitly outside the admitted PG CLI profile). They do
not change counters or the 256 measured sessions. They are outside timed load,
and their statements remain visible in full trial deltas. The standard
whole-cohort counter audit includes warm-up and drain: any counter increase
without an acknowledgement disqualifies the trial, including unknown outcomes.

Every cell also warms ten native operations, then observes sixty serial
operations of the same shape. Its `pg_stat_statements` deltas are filtered by
this database AND application role; lease-renewal statements are explicitly
accounted for. These clean probes avoid the trial's drain identity writes.
`pg_stat_database` deltas are database-only and include observers/maintenance;
Postgres's backend report lag limits exact transaction boundaries. Cumulative
statistics are not reset. Counts from START/COMMIT/ROLLBACK statements give the
independent role-filtered transaction accounting. Inferred driver exchanges
subtract paired commit SET statements that share one driver call. They are
source-based estimates, not wire captures; cold prepares can add exchanges.

The unchanged release has no enabled production engine/committer queue timing.
Serial probes, intended-arrival HTTP/service latency, thread wait channels,
role-filtered PG wait samples and SQL/COMMIT execution time diagnose the path.
Utility COMMIT execution time is not a separately instrumented flush latency.
Any B1/B2 estimate is a counterfactual at the measured RTT, not measured new
product behavior or a qualified ceiling.

Controls are historical S1-FR token/raw-no-token/Supabase advocate and
Convex advocate observations; SQLite is S1-SK natural-only. They share intended
arrivals, durations, SLO, fixture and core method, but not observation time,
storage layout, cache behavior, identity verification protocol or background
work. These shared-host short-window results are exploratory. No managed
service, production capacity, long-term stability or publication claim follows.

All benchmarks and observers launch with setsid/nohup, recording PIDs. Cleanup
signals only owned processes; only this lane's database and role may be dropped.
Private remote configuration/session files are removed after use; verbose raw
evidence is archived separately with SHA-256. No password or token is committed.
