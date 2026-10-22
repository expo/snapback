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

## S10d-3 fix round 1 — 2026-10-22

Rebased first with `git fetch -q origin main && git rebase origin/main`; the
branch was already current. The cold default CLI build passed. This round
addresses both blind reviews of `a0161a6426` without changing the admitted profile.

| Finding | Change and regression evidence |
|---|---|
| Socket-only transport bypass | Reject nonempty driver `hostaddrs` and every non-Unix host before probing. Bind each effective `.s.PGSQL.PORT` socket path, including default/per-host ports; reject paths that cannot be represented faithfully in the binding. The public witness holds a local TCP listener and proves the reviewer's socket-host/hostaddr URL, a TCP host and mixed hosts refuse without even a TCP connection. |
| Failed first binding write | Recover only an unselected generation-1 bootstrap with revision/token zero, adopting its observed logical store id. Existing bindings must match; selected/previously owned stores still require their binding. Publish records through a synced temporary file and atomic rename. The witness obstructs `store-binding.json` with a directory, observes the committed unselected bootstrap, removes the obstruction and deploys the same id successfully. Removing a selected store's binding still refuses. |
| Failed serve retains lease | Arm release-on-drop before acquisition/renewal/thread startup, and disarm immediately before HTTP admission after fallible startup. Serving retains expiry-based shutdown. The witness omits worker state, then occupies the HTTP port; both failures leave `lease_until = '-infinity'`, and the immediate corrected serve succeeds. A contender still leaves the first server answering. |
| Witness runs another binary | Resolve the public witness binary from `CARGO_TARGET_DIR`, relative to the Cargo workspace when necessary, and print its resolved path. The required lane target is used for the default build and public witness. |
| Contradictory guidance/help | `guide deploy` distinguishes SQLite's token/staging/release operations from Postgres refusals and supplies the worker-state requirement. `release-json` lists token/release-inspection refusals, recovery and startup cleanup. README and NOT-DOING now describe the admitted deployment profile. Deploy/serve `--store` help describes the existing SQLite alias. |
| Credential surfaces | Prefer environment configuration in guides/README and warn in help that passwords in `--store-url` appear in process arguments. Shared RuntimeError Display redacts Postgres and unknown-COMMIT driver details, so CLI formatting and HTTP refusals agree without changing codes/outcome classification. Unit assertions cover both formats and unknown-COMMIT retry policy. A real database trigger raises a synthetic secret and the public HTTP response omits it; doctor/binding/tree and Linux server argv checks also omit that secret. |

The public regression witness passed on private PostgreSQL 16.15 at
`/tmp/s10d3-serve-eg_s4tzu`. Its five recorded server PIDs were reaped and
independently checked absent; `pg_ctl status` returned 3 and `postmaster.pid`
was absent. The first witness attempt exposed an incorrectly written mixed-host
fixture (the URL driver treats a comma-containing socket query value as one
path); the corrected fixture uses repeated `host` query parameters. That first
attempt refused before any cluster was started.

The root guide prerequisites were restored with a frozen Bun install, the
normal generated-artifact bootstrap and a local ignored workspace link for
`@expo/snapback-contract`. No tracked root output changed. The final root guide
check passes all 22 checks, with no failure, skip or precondition. Detailed
transcripts and exit files for this round are in `/tmp/s10d3-fix1-checks/`.

### Final verification for fix round 1

| Check | Result |
|---|---|
| Default `cargo build -p snapback4` | Pass after the initial rebase/cold build and in the final Postgres script's default-binary build. |
| Core `--no-default-features` check | Pass. |
| Complete core tests | Exit 0; 1,068 unfiltered passes, 5 intentional ignores, plus one filtered subprocess witness. |
| Complete CLI tests | Final serial run exits 0; 1,405 unfiltered passes, 16 intentional ignores. All three supplied toolchain/web baseline cases pass. |
| Ratchets and handle census | 16 pass; no allowance increases. Default/Postgres compiled handle guards pass. |
| Release guards | Pass: raw fixtures refuse in release; `web-device-check` refuses in the wasm profile. |
| Language guide | 127 pass; deploy card retains its 150-line operational and 280-line complete limits. |
| Root guide | 22 pass, no failures/skips/preconditions; 121 inherited warnings. |
| Wasm codec census | 27 pass. |
| Complete Postgres script | Exit 0: 58 evaluator, 209 family/oracle, 21 ownership, 2 committer, 1 internal HTTP, 19 corpus, 1 compiled handle and 37 doctest cases; public CLI witness also passes. |
| Binding and redaction unit regressions | Each runs one test and passes. |
| Docs budget | Pass, 319/320 README physical lines. |
| Reference audit | Pass, 564 LLP documents / 12,328 refs / 0 errors / 0 unchecked. |

Verification found two issues in the new tests/docs: the redaction fixture's
combined cfg was classified as production driver access, and the expanded deploy
paragraph exceeded its existing line budget. Both failures were reproduced alone;
the fixture now lives in the adapter tests, and the paragraph fits the unchanged
limits. The affected tests and final complete CLI run pass.

An intermediate full CLI repeat overlapped the Postgres script's Cargo cleanup:
seven binaries were absent before execution, and a SQLite ownership case exceeded
its existing five-second guard. Each affected target passed individually; the
ownership case passed alone. The final complete CLI run was performed without
other Cargo work and has no failure. No product code or timing ceiling was changed
for these verification retries.

All three clusters created this round are independently confirmed stopped
(`pg_ctl status = 3`, no `postmaster.pid`):
`/tmp/s10d3-serve-eg_s4tzu`, `/tmp/s10d3-serve-uyg9g3f9`, and
`/tmp/sb4-pg-eval.nCb7qZ`. All ten recorded public-server PIDs are absent, and
no dev/serve process remains for this lane's binary after the final suite.
Custody receipts are in `cluster-audit.log`. Only the specified top-level Cargo
target/profile settings and at most 16 build jobs were used; inherited native
fixture builders retain their private build subdirectories. The lowest observed
`df -h /` free-space display was 39G, above the stop threshold. No push or stash.

## S10d-3 fix round 2 — 2026-10-22

Continued in the same clean worktree/branch from `76424cf733`, without rebase,
push, stash or delegation. This round replaces the recovery mechanism introduced
in fix round 1, and completes the remaining review findings.

| Item | Structural change and regression |
|---|---|
| Bootstrap adoption has no identity | Before the bootstrap transaction, atomically write and fsync a credential-free `store-pending.json` containing the minted store id and namespace/effective socket binding, then sync its directory. Keep the proposed id separate from an active owner fence until the bootstrap installs the schema. Recovery requires the intent's exact id/target, every bootstrap relation, required markers and initial generation history, exact owner shape, and a successful normal `Engine::open`/admit with all family checks. Missing state refuses without repair. Only then atomically rename the intent to the binding, before claiming ownership. A pending intent also prevents SQLite fallback. |
| Startup renewal failure retains claim | Retain the attempted/committed claim token separately from `held`. Renewal loss still disables write authority; startup drop cleanup can nevertheless attempt its id/token-guarded release. Record the cleanup token before COMMIT so unknown claim outcomes and errors after a committed claim also reach that release attempt. The host regression injects Grok's renewal-only trigger after connect validation, proves token 1 committed and was released on the returned error, drops the trigger, then immediately reacquires token 2 without waiting for expiry. The ownership regression loses renewal to a successor token and proves cleanup does not expire its lease. |
| Help and guide distinction | Deploy/serve help qualifies previews, hot adoption and automatic workers as SQLite workflows. Real public invocations verify Postgres `deploy --check` and `serve --worker` refuse `E_STORE_UNSUPPORTED`. Token, migrations and rollback recipes have explicit SQLite headings. `release-json` quotes the actual operator and SQL refusal messages and states clean shutdown also leaves the lease to expire about three seconds after its last renewal. |

The public witness reproduces Sol's swap by independently bootstrapping another
store and renaming the two schemas behind the **same URL, socket and namespace**.
Retry refuses the changed store id with a recovery instruction. Grok's probe-only
schema has the original id and exact owner relation, but only `_owner`, `_backend`
and `_meta`; retry refuses its missing `_head`. Further cases remove core/family
relations, `_generations`, each required marker, or alter generation history and
owner shape. Every refusal preserves the original intent, writes no binding and
leaves the token zero. Missing intent and effective socket target mismatch also
refuse. The genuine failed-binding retry keeps its id and replaces the exact
intent bytes with the binding; it then passes the existing serving, HTTP,
redaction, restart and takeover witnesses.

An initial witness caught an implementation error: assigning the proposed id to
an active fence before the schema existed made opening try to install the owner
relation too early. The corrected handle stores the pending bootstrap id
separately and promotes it to a fence only after successful bootstrap. Its private
cluster was stopped and independently confirmed. Subsequent public witnesses
pass without relaxing any expectation or timing bound.

Full transcripts, exit files and final custody receipts are retained under
`/tmp/s10d3-fix2-checks/`. The following results are filled from those receipts.

The state audit also covers a stale intent left beside a selected store's binding:
if the bound namespace disappears, deploy must refuse rather than recreate it
with the old id. The guard checks for a binding before reusing any pending intent;
the witness temporarily renames the selected schema and proves no replacement
schema, binding change or owner claim occurs.

Verification initially found three guide failures because SQLite prefixes
renamed established section-routing prefixes and the operational-card split
marker. Qualifying the existing headings with SQLite preserves routing and the
unchanged 150/280-line limits. The first complete Postgres attempt passed all 350
Rust cases, including both new renewal regressions, but its added stale-intent
case exposed a binary compiled while that guard was being edited. Source was
then frozen, the host source timestamp advanced to force compilation, and the
public witness plus complete Postgres script repeated. The initial transcripts
remain intact; final results use the `*-final` receipts.

### Final verification for fix round 2

| Check | Result |
|---|---|
| Default CLI build | Pass, including the forced final build and the complete Postgres script's final build. |
| Core without default features | Pass. |
| Web device without default features, wasm target | Pass. |
| Complete core tests | Exit 0: 1,068 unfiltered passes / 0 failures / 5 intentional ignores, plus the filtered subprocess witness. |
| Complete CLI tests | Exit 0: 1,405 unfiltered passes / 0 failures / 17 intentional ignores; 13 filtered subprocess cases also pass. The new ignored startup test runs explicitly in the Postgres script. |
| Ratchets and handle census | Final 16 pass; no allowance increases. |
| Compiled handle guards | Default and Postgres guards each pass. |
| Release guards | Both raw-fixture and wasm-profile refusals pass. |
| Language guide | Final 127 pass, preserving alias routing and the 150/280-line deploy-card limits. |
| Root guide | 22 pass / 0 failures / 0 skips / 0 preconditions; 121 inherited warnings. |
| Wasm codec census | 27 pass. |
| README budget | Pass, 319/320 physical lines and its self-containment case. |
| Complete Postgres script | Final exit 0: 58 evaluator + 209 family/oracle + 22 ownership + 2 committer + 1 internal HTTP + 1 startup-renewal + 19 corpus + 1 compiled guard + 37 doctest cases, totaling 350 Rust passes; public CLI witness also passes. |
| Public witness | Final standalone pass and pass inside the repeated complete Postgres script; the added bound-store guard is verified by the rebuilt CLI. |
| Binding/redaction regressions | Both final unit invocations pass. |
| Reference audit | Final pass: 564 LLP documents / 12,329 references / 0 errors / 0 unchecked. |

The full native core/CLI checks passed before the final bound-store guard was
moved ahead of intent reuse. That Postgres-only branch is covered by the rebuilt
public witness, repeated complete Postgres script and final ratchet checks;
no native behavior or timing limit changed. PostgreSQL is 16.15. Both evaluator
modes retain 65 increments without losses. The admitted profile and earlier
qualification exclusions remain unchanged.

### Fix-round-2 cluster and resource custody

Independent audit in `cluster-audit.log` confirms all eight clusters stopped:
`pg_ctl status = 3`, no `postmaster.pid`, and all 20 recorded public-server PIDs
absent. No process remains for this lane's CLI binary. Data and logs are retained:

- `/tmp/s10d3-serve-hy9ro9ma`
- `/tmp/s10d3-serve-y8td1k80`
- `/tmp/s10d3-serve-2zzg46b7`
- `/tmp/s10d3-serve-8gkmryia`
- `/tmp/sb4-pg-eval.z6FKb0`
- `/tmp/s10d3-serve-022nr4wp`
- `/tmp/sb4-pg-eval.qV9D02`
- `/tmp/s10d3-serve-z6yiqkiv`

Only the specified top-level Cargo target, incremental/debug profile settings and
at most 16 build jobs were used; existing native-fixture builders retain their
inherited private subdirectories. Minimum recorded stage free space was 42.49
GiB; the lowest observed `df -h /` display was 43G, above the 30 GB stop threshold.
No push or stash, sub-agents, unrelated cluster operations or other-machine work.
