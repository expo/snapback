# S10d-3 — public Postgres deployment and serving

One worker in `/home/ccheever/projects/sb4-pg-s10d3`, branch `sb4-pg/s10d3`,
starting at `8f909dc734`. No sub-agents, clones, other-machine commands, stash or
push. The request-committer implementation remains the parallel K0 lane's work.

## Configuration and scope

`--store-url` overrides `SNAPBACK4_STORE_URL`. A URL carries explicit
`schema=NAME&ha=none`; deployment credentials stay in configuration/environment.
For example, `postgres://app@/db?host=%2Fvar%2Frun%2Fpostgresql&schema=my_app&ha=none`.
`--store <path>` retains SQLite selection; for deploy/serve it aliases an existing
SQLite file, while the default still creates `deployment/store.sqlite`.
Conflicting selectors return `E_STORE_CONFIG`. A bound deployment refuses a silent
fallback to SQLite. Immutable local `store-binding.json` records the logical store
id and non-secret host/port/database/role/schema/HA binding, never the URL/password.

The admitted transport is a Unix socket on PostgreSQL 16/17 with `ha=none`.
TCP refuses `E_STORE_UNSUPPORTED: connection-tls`; other HA modes refuse
`ha-continuity`. Session affinity/version checks run on every opened serving,
reader and lease connection. Direct or session-pooled connections are required;
transaction pooling remains unsupported. The two-transaction affinity observation
is a preflight check, not a qualification of an arbitrary pooler's configuration.

`serve` requires an absolute `--worker-state-dir` or
`SNAPBACK4_WORKER_STATE_DIR`. It validates the logical-store-bound completion
filename before listening. No worker is admitted by supplying that directory.

## Deployment, ownership and runners

The first deployment bootstraps the admitted initial generation, then acquires a
positive lease before release/history/activation. The existing common engine and
P1-RL adapters own the solo administrative activation. Subsequent same-schema
program updates reopen under a fresh positive token; identical content is a no-op.
Source and binding files, including their parent directory entries, are flushed
before selection. Unknown COMMIT checks persisted selection without replaying
activation; unresolved outcomes preserve exact source for recovery.

Serve acquires before binding a listener, re-reads persisted selection, validates
logical identity/non-secret binding and selected immutable source against the
stored schema/programs, then opens through `AnyStore::open_postgres_owned`.
Renewal runs on a dedicated connection every 500 ms. Any failed/uncertain renewal
exits the process; an independent monotonic watchdog also exits at the three-second
lease deadline. The first-lock token fence orders in-flight writes against takeover.
Serve leaves the lease to expire on exit, avoiding release ahead of outstanding
requests. Deploy releases after its scoped activation and handles have drained.

Startup gates child-session/replay work, schedules, native installation, time
publication, worker supervisors and durable/bulk maintenance. The ephemeral hub
and its sweep stay active. An immutable startup capability gates worker HTTP doors
without taking the engine mutex. This preserves SQLite's pre-mutex malformed-input
refusals. Ordinary query/mutation/identity execution remains shared with SQLite.

Doctor returns typed backend/identity/release/generation/holder/token/lease facts.
SQL/data/general release inspection, previews, rollback/prune, staging, saved
versions and hot activation remain named operator refusals. Schema evolution,
assets beyond placement, jobs/actions/routes/schedules/native, union sync, timed
publication, row-keyed recounts and the existing rejected maintained/private-column
shapes remain outside the profile. Worker execution/claims remain refused.
Missing change evidence is `preserved:null`; certified changes/sync are excluded.

## Public CLI evidence

`scripts/test-postgres-serve.py` builds an admitted app using `check`, deploys and
serves it through detached CLI children, and owns its socket-only private cluster.
It uses a non-superuser serving role with schema-creation rights. The witness checks:

- guest/session resolution, query, identified mutation, id-binding refusal and
  replay without a second public commit;
- `/changes` with unknown evidence encoded as `preserved:null`;
- a second serve refusing ownership before readiness;
- restart retaining data, session, logical id, generation and receipt;
- SIGKILL/reap of the recorded owner, followed by standby acquisition only after
  database-clock lease expiry;
- logout and its persistence across a later serving process;
- forced token loss causing process exit and listener closure;
- reopened deployment selecting release 2/generation 2 with changed program
  behavior and original data preserved;
- invalid selectors/HA/transport and SQL inspection refusing by name;
- an out-of-profile Quarry job refusing deploy without creating its schema.

The existing `scripts/test-postgres.sh` now builds the default public CLI and runs
this witness on a separate private cluster after the evaluator/family contracts.
It never points the public witness at another process's cluster.

## Verification

| Check | Final result |
|---|---|
| `cargo build -p snapback4` | Pass, including the final rebuild. |
| Core `--no-default-features` check | Pass. |
| Device `--no-default-features --features web --target wasm32-unknown-unknown` check | Pass. |
| `cargo test -p snapback4-core --no-fail-fast` | Pass: 1,068 passes / 0 failures / 5 ignored in unfiltered target summaries, including 26 doctests; one additional filtered subprocess witness passes. |
| `cargo test -p snapback4 --no-fail-fast` | Final complete repeat exits 0: 1,405 passes / 0 failures / 16 ignored in unfiltered target summaries. The supplied toolchain/web baseline cases also pass. |
| Committer/store-port ratchets and handle census | 16 / 0 failed; no raw-access/handle allowance increases. |
| Compiled handle guards | Pass in default and Postgres builds; 37 Postgres consumer doctests also pass. |
| Release guards | Pass: production host refuses raw test fixtures, wasm profile refuses `web-device-check`. |
| `cargo test -p snapback4-lang --test guide` | Final 127 / 0 failed. |
| Root `node scripts/check-guide.mjs` | 22 checks pass, 0 failed/skipped/preconditions; 121 inherited nonblocking warnings. |
| Wasm codec census | 27 / 0 failed. |
| `scripts/test-postgres.sh` | Exit 0: 58 evaluator, 209 family/oracle, 21 ownership, 2 member, 1 internal HTTP, 19 corpus, 1 compiled guard and 37 doctest cases pass, plus the public CLI witness. |
| Public CLI witness | Pass separately and inside the complete Postgres script, as a non-superuser. |
| Root `./ref-check` | 564 LLPs / 12,328 refs / 0 errors / 0 unchecked at the completed pipeline check. |

PostgreSQL is **16.15**. The evaluator retains 65 increments with no lost updates;
its serializable run reports 68 retries. Qualified modes, exclusions and C1
comparison assertions remain unchanged. These are scoped serving/store checks,
not a complete P1 or publication qualification.

The initial host worker-family guard took the engine mutex ahead of malformed
input validation, breaking one prompt-refusal case and three worker/adoption
cases. The final guard reads an immutable admitted capability instead. All four
cases pass individually, the complete corrected unit binary passes, and the final
complete host-suite repeat passes. No test
expectation or timing bound was relaxed.

Guide repairs retain the existing introduction and card-size bounds. Detailed
Postgres configuration lives on the existing release JSON card; deploy/serve
points there after its first example. The packed-path guard recognizes exactly
the new application-generated binding filename. Both original failing guide
cases and the opening-order case pass individually before the final full pass.

Fresh-tree setup used frozen root and Snapback 4 Bun installs and the root's
normal generated-artifact bootstrap, which passed without tracked root changes.
The first root guide pass had one missing workspace peer link; a local ignored
workspace link repaired it, and the final pass has no skipped check. TypeScript
emission supplied referenced ignored JS leaves; the separate full client build
still lacks ignored wasm source artifacts and is not claimed by this lane.

Transcripts and exit files are retained in `/tmp/s10d3-checks`.

## Cluster and resource custody

Every private cluster started by this lane was stopped, then independently
confirmed again with `pg_ctl status = 3` and no `postmaster.pid`:

- `/tmp/s10d3-serve-nz7yfvz7`
- `/tmp/s10d3-serve-qq1kyb6q`
- `/tmp/s10d3-serve-_gk8zbzp`
- `/tmp/s10d3-serve-j8s5zqlq`
- `/tmp/s10d3-serve-atv9re5r`
- `/tmp/s10d3-serve-x71mk_zb`
- `/tmp/s10d3-serve-4lo2j0ip`
- `/tmp/s10d3-serve-_czedj6p`
- `/tmp/s10d3-serve-l5e0td9x`
- `/tmp/sb4-pg-eval.p3r68g`

Data/logs are retained. Public servers are detached with recorded PIDs and are
reaped by their owning witness; no other server/cluster was signalled. The earlier
attempts exposed the evaluator-only namespace restriction, dormant-supervisor
assumption, binding-record idempotency and a malformed negative-test fixture;
the final public witness passes after those corrections.

Top-level Cargo invocations use only the lane target directory, incremental off,
both debug environments set to line tables and at most 16 build jobs. Existing
native-fixture builders retain their inherited private build subdirectories.
All observed disk readings remain above the 30 GiB stop threshold; the lowest
observed reading is 56 GiB.


## Remaining work

S10e retires the evaluator after moving its corpus, difftest preludes/replays and
call-count controls onto the common engine. TCP/TLS, full P1 family parity/schema
evolution, certified changes/sync, durable worker recovery/attempt reconciliation,
remote blob/release custody, and provider HA/continuity qualification remain later
work. No production-provider, full HA, publication or certified-sync claim is made.
