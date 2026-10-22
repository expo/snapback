# RT0 — the request round-trip ratchet

2026-10-22. Base `bd0da3c11188ce61d55bb7b8348e196f61ecc863`, branch
`sb4-pg/rt0`. Test instrumentation and fixtures only; no product behavior,
SQL, transaction policy, request outcome, budget or ceiling changes. No edits
to `serve_committer.rs` or `engine/command.rs`. No push.

## Measured warm counts

Postgres dependent flights and SQLite executed statements are different units.
Each class has a discarded first use followed by **three identical warm samples**.
The assertions reject both an increase and a decrease (the latter says “lower
the table”), naming the class, measured value and table value. There is no
runtime update flag. The exact checked-in tables are
[sqlite.json](../../crates/snapback4/tests/round_trips/sqlite.json) and
[postgres.json](../../crates/snapback4/tests/round_trips/postgres.json).

| Class | Postgres flights | SQLite statements | Asserted HTTP outcome |
| --- | ---: | ---: | --- |
| W1 authorized point | 23 | 31 | 200, message m24 |
| W2 authorized newest 20 | 23 | 31 | 200, m24 through m5 |
| Unkeyed tiny increment | 57 | 79 | 200, sent |
| Increment + one membership require | 58 | 80 | 200, sent |
| Keyed first attempt, id + store_id | 77 | 87 | 200, sent, fresh id each time |
| Replay hit, same id + store_id | 30 | 40 | 200, replayed, same committed seq |
| Action-session W1, one parent family | 29 | 39 | 200, message m24 |
| Unauthenticated, absent bearer | 0 | 0 | 401, E_AUTH |
| Unknown bearer | 5 | 5 | 401, E_AUTH |
| Identity rate limited | 0 | 0 | 429, E_RATE_LIMIT |
| Unknown mutation operation, metadata-bearing | 26 | 46 | 404, E_OP, current store_id |
| Narrowed/invalid argument, metadata-bearing | 26 | 46 | 200, failed E_INPUT, current store_id |

## Method and fixture limits

Postgres is 16.15 over a private Unix socket with ordinary durability settings.
The in-process test host runs the actual tiny_http TCP listener, `serve`
dispatcher, persistent request workers, ingress/route authentication, replay,
engine, adapters, publication and response code. Tests send ordinary HTTP with
native guest bearers, production mode (`personas=false`), `{args:...}`, and on
the keyed path the SDK-shaped `{id,store_id,args}`. No counting header,
environment switch or product endpoint is added. Counts are returned through
a per-host test-only channel **after the entire handler's cleanup**.

The wrapper extends `Store.calls`: in test builds its Cell-compatible wrapper
attributes each awaited prepare, execution, simple Query and transaction frame
to the current request. A two-SET simple Query is one flight; an awaited prepare
is another. A test-only drop guard includes implicit rollback on early errors.
Cold direct-client opening counts include startup, implicit prepares and the
single batched connection-settings Query. Asynchronous statement destructor
Close/Sync traffic is excluded from dependent waits, matching RT-A. This is a
synchronous-driver call counter, not a replacement protocol capture; RT-A's
wire-verified four warm baselines and first-reader surcharge reproduce exactly.

SQLite installs `SQLITE_TRACE_STMT` callbacks on ordinary, read-only and pooled
reader connections in test builds. These count executed statements, including
transaction frames, rather than prepares. The thread-local scope begins at
handler entry and ends after its cleanup; unrelated threads have no scope.
Maintenance and dedicated lease-renewal traffic are excluded. Instrumentation
is compiled only for `cfg(test)` / the existing debug-only `test-support`
feature. Normal production still uses the original `Cell<u64>` and installs no
trace callbacks, scope, sender or environment check. Unit witnesses cover scope
reset, unrelated-thread exclusion, batch statements and rollback counting.
A future cross-thread committer must transfer attribution explicitly; merely
losing those counts will fail the lower-table assertion, not silently pass.

At this lane's base P1-MC has not landed: `profile.rs` still refuses maintained
columns. Both stores therefore use RT-A's checked-in **admitted S1 fixture**,
with the two count fields and W3 absent, preserving the full S1 W1/W2 bodies
and membership rules. Seed: one user, room, membership and owner counter, plus
25 messages. The normal setup and message insert operations run over HTTP
before measuring. This is not a full maintained-column S1 deployment or scale
cell. No remote fetch was used to assume another lane's state.

The action class is **an HTTP W1 request using a real action-kind session**.
A test-only helper installs a running claim tied to a live ordinary guest
admission family via typed `NewRequest`, `claim_request` and session APIs on
both stores. The ordinary shared resolver checks work state, lease, deadline,
principal generation and the parent family's live session on both authority
boundaries. Postgres still refuses action *declarations*, so this does not
claim public `/a` admission, a supervised worker or action deployment parity.
The fixture's lease and deadline are one hour, avoiding timing-dependent counts.
The limiter is reached through actual production `/auth/guest` attempts, bounded
at 31, then four 429 requests are measured.

## Cold reader and first-use costs (separate from the ratchet)

| First invocation | PG dependent waits | Warm | Surcharge | SQLite statements | Warm |
| --- | ---: | ---: | ---: | ---: | ---: |
| W1, first physical serving reader | 56 | 23 | 33 | 32 | 31 |
| W2, new descending plan on existing W1 reader | 24 | 23 | 1 | 31 | 31 |
| Increment, new UPDATE plan on warmed seed writer | 58 | 57 | 1 | 79 | 79 |
| One-membership mutation (same plans already warm) | 58 | 58 | 0 | 80 | 80 |
| Keyed first, new receipt/placement/write plans | 81 | 77 | 4 | 87 | 87 |
| First replay hit (plans warmed by first attempt) | 30 | 30 | 0 | 40 | 40 |
| Action W1, new claim/generation/family plans | 32 | 29 | 3 | 39 | 39 |

Refusal first-use and warm counts agree. “Cold” here means the fixture's first
invocation in the specified order, not a new database, new server for each
class, or cold OS cache. Reader costs are per physical connection, not per
bearer. Test output retains both warm and first-use maps.

## Comparison with the RFC

LLP 3000.009.001.000.001 §2 and RT-A measured 57/58 for the unkeyed mutations,
23 for each authorized read, and SQLite 79/80/31/31. RT0 reproduces all eight
numbers exactly. RT-A's first-reader W1 was 56 awaited operations on PG and
32 SQLite statements; RT0 also reproduces those.

The §2 estimate of roughly ten additional keyed exchanges understated the
SDK-shaped first attempt: **+20**, to 77. By current code inspection this is
two store-binding snapshots (+8), the two unfenced replay snapshots (+8),
the fenced receipt lookup (+1), placement check (+1), and receipt INSERT plus
binding UPDATE (+2). SQLite adds eight statements over its unkeyed 79.
Replay ends in preflight at 30 PG / 40 SQLite, without durable execution.
Action W1 adds 6 PG / 8 SQLite to ordinary W1 for the claim/parent authority
walk. Missing-bearer and rate refusals do no database work; a syntactically
valid unknown bearer still pays 5. Mutation metadata refusals pay 26/46 before
returning their current store metadata. These were all unmeasured in RT-A.

| Class | RT0 PG Today | §4 B1 prediction | Remaining reduction to B1 |
| --- | ---: | ---: | ---: |
| W1 | 23 | 6 | 17 (74%) |
| W2 | 23 | 6 | 17 (74%) |
| Unkeyed increment | 57 | 16 | 41 (72%) |
| Keyed first | 77 | 21 | 56 (73%) |
| Replay hit | 30 | 5 | 25 (83%) |

The extra explicit membership probe remains program work; §4's B1 mutation
schedule explicitly budgets three program flights, so this comparison does not
assert a separate B1 target for the four-flight checked mutation.

B1 and both B2 mechanisms remain **predictions**, with all original budgets
unchanged. There is no numeric B1 prediction for action/refusals in the RFC;
RT0 establishes their Today rows without inventing one. SQLite's structural
estimate (§3.7) is still roughly 79 → 40; RT0 implements none of those savings.
Ownership-loss refusals, deeper delegation chains and supervised-family cases
are not measured by these fixtures. No latency, throughput, inter-host RTT,
concurrency, flush or scale claim follows
from these debug-build counts.

## Governing context

Orientation: Snapback 4 fence and root LLP 3000 (including §7), design brief
LLP 2000.000, NOT-DOING and JOURNAL; the deploy, reads and rules guide cards;
LLP 3000.009.001.000 §3.4/§5/§9.1 (neutral handles, ownership and adapter
parity), and LLP 3000.009.001.000.001 in full, especially §2/§4/§5/§6. The
request-budget RFC is Draft; its ratchet is explicitly commissioned by this
lane. Existing non-obvious references still govern their unmodified behavior.
Hand-off: none; the covering RFC receives measured Today values and the
implementation record, with its budgets and proposal status retained.

## Verification and custody

All Cargo commands used only the authorized `snapback4/target`,
`CARGO_INCREMENTAL=0`, both debug profiles set to `line-tables-only`, and
`CARGO_BUILD_JOBS=16`. PostgreSQL tools/libraries came from `$HOME/tools/pg16`,
with `TMPDIR=/tmp`. Every observed disk reading remained above the 30 GB stop threshold.

| Check | Result |
| --- | --- |
| `cargo build -p snapback4` | Pass |
| `cargo check -p snapback4-core --no-default-features` | Pass |
| `cargo test -p snapback4-core --no-fail-fast` | 1,070 unfiltered passes, 5 ignores; one passing subprocess witness |
| `RUST_TEST_THREADS=4 cargo test -p snapback4 --no-fail-fast` | 1,405 unfiltered passes, 1 census failure, 18 ignores; 13 passing subprocess witnesses; census corrected as below |
| Affected committer/store-port ratchets and handle census | 16/16 pass after correction |
| Focused core `round_trip` tests | Pass, including both new counter witnesses |
| Final SQLite HTTP ratchet | Pass, all twelve rows unchanged |
| `cargo test -p snapback4-lang --test guide` | 127/127 pass |
| `scripts/check-test-support-guard.sh`, `scripts/check-release-guard.sh` | Both pass |
| `node scripts/check-inventories.mjs` | Pass; existing expired GAP-review advisories only |
| `./ref-check` | Pass: 565 LLP documents, 12,334 references, zero errors and zero unchecked |
| `bash scripts/test-postgres.sh` | Pass: 354 Rust passes, no failures, plus the complete public-serving witness and both cluster shutdowns |

The full CLI sweep found three SQLite driver references in the test-only
counter module that its lexical source census classified as production (the
scanner does not follow that module's feature gate). The same failure reproduced
alone. The tracing hook and its raw-driver unit witness moved into the SQLite
adapter; **no allowance, matcher, ceiling or product behavior changed**. All
16 affected census/ratchet cases pass afterward, as do the relocated counter
witnesses and all SQLite HTTP counts. Subsequent qualification uses those
affected checks and the complete Postgres script. The three supplied baseline
cases all passed in this run: `w11r1c_toolchain_why_explains_node_start_failure_too`,
`farm2_typescript_7_is_refused_by_version_not_crashed_on`, and
`web_witness_help_and_invalid_input`.

Setup corrections were confined to the harness: initial file paths used the
wrong working-directory prefix and were moved before compiling; expected HTTP
statuses were corrected to the existing 404 unknown-operation and 200 failed
mutation-argument contracts. Empty initial tables intentionally refused the
first measurement, then were populated from the observed counts and rechecked.
No measured reduction, API fix or protocol optimization is hidden in RT0.

The final default CLI build (also run by the Postgres script) has **zero**
`round_trips` / `trace_round_trips` symbols in `nm --defined-only`; the counter
and SQLite callbacks are absent from the ordinary binary. The no-default core
check was repeated after the tracing relocation and passed.

Two owned private runtime directories remain for inspection, with no running
clusters: `/tmp/sb4-rt0.11mHKq/data` (four starts: three focused measurement
runs and the full script's explicit evaluation connection) and
`/tmp/s10d3-serve-6y8__6wt/data` (the public-serving witness). Each stop waited
for its own data directory; final independent `pg_ctl status` returns **3**
for both and neither has `postmaster.pid`. Postmaster PIDs **1708132, 1710262,
1713435, 1987099, 2008711** and serve PIDs **2022604, 2022695, 2023015,
2023439, 2023536** were independently checked absent. The witness retains its
own `pids.jsonl` and server logs in its runtime directory. A `/proc/*/exe`
census found no live executable under this lane's target directory. All Cargo,
CLI, initdb, pg_ctl and verifier invocations completed and were waited for.
**PIDs left: none.** No clone, remote command, sub-agent, push or stash was used.
