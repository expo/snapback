# RT3a — one statement fetches a session's authority facts

Base: `bfdf05127889775a693960ad21cc6920147a3781`; branch `sb4-pg/rt3a`.
Continues the disk-stop checkpoint `9cffa36407`. No push, stash or git
configuration change. **Continuation qualification is complete.** All requested checks pass on the
final code and corrected attach-time fixture; the earlier interrupted logs are
historical evidence only.

## Scope and governing context

Orientation used `llp-orient`: LLP 3000, LLP 3000.009.001.000 §9.1,
LLP 3000.009.001.000.001 §3.1–3.2/§5–7, and LLP 3000.033 §1.3.
Only §3.2 is implemented. Generation comparisons, authority decisions, fences
and request-boundary placement remain Rust policy at their existing boundaries.
Ordinary application writers keep their separate generation command after the
head lock. No RT3b or RT5 change; the parent RFC remains Draft.

Both adapters fetch the bounded session union, principal generation,
expiry/cap, worker metadata and store generation/incarnation in one SELECT.
SQLite includes its four activation identity markers; Postgres includes actual
`_backend.generation`. Primary keys bound the result to two session rows, with
an anchor for absent-token metadata. Duplicate digests remain an error. No
SELECT *, LIMIT or authority judgment is in the SQL. Typed text digests refuse
NUL. Exact full/absent-storage statements: [STATEMENTS.md](STATEMENTS.md).

The shared live-session and supervisor policy consumes facts for guest/user/
member kinds. Action, service and unknown kinds retain the complete shared
resolver, including conditional claim/delegation reads. No authority cache is
retained between calls. SQLite shares only optional-storage availability with
readers, pins it to each snapshot, and publishes lazy installation after COMMIT;
savepoint/full rollback preserve absence. Postgres updates its attach flag after
its atomic upgrade commits. A typed member method exposes resolution without
SQL or a raw transaction escape.

## RT0 predictions and final measurements

The RFC retains the original pre-code prediction and the refined prediction
made before integrating the dedicated opener's generation reads. The refined
prediction matches every final measurement. Both committed tables pass unchanged
in this continuation; each class has three identical warm samples. No class
increases relative to RT2. See [resume/rt0.log](resume/rt0.log) and [final counts](resume/rt0-counts.json).

| Class | SQLite refined prediction / measured | Postgres refined prediction / measured |
| --- | ---: | ---: |
| action_session_w1 | 28 / 28 | 22 / 22 |
| keyed_first | 40 / 40 | 46 / 46 |
| narrowed_argument | 17 / 17 | 13 / 13 |
| one_membership | 33 / 33 | 27 / 27 |
| rate_limited | 0 / 0 | 0 / 0 |
| replay_hit | 19 / 19 | 21 / 21 |
| unauthenticated | 0 / 0 | 0 / 0 |
| unkeyed_increment | 32 / 32 | 26 / 26 |
| unknown_operation | 17 / 17 | 13 / 13 |
| unknown_token | 3 / 3 | 3 / 3 |
| w1_point | 16 / 16 | 12 / 12 |
| w2_newest20 | 16 / 16 | 12 / 12 |

Compared with RT2, four non-detached authority resolutions remove 28 SQLite
statements / 12 Postgres flights from each fresh mutation (including keyed and
membership classes). Replay and metadata refusals have three such resolutions,
saving 21/9. W1/W2 remove eight on each adapter across their two detached
resolutions. Action W1 retains its claim/worker walk, saving four on each store
through optional-table/identity or generation/identity reads. Unknown-token
refusal saves two on each; unauthenticated and rate-limited stay at zero. The
original predictions differ only by the later dedicated-opener generation fold:
four SQLite statements per non-detached resolution, one Postgres statement per
authority snapshot. The RFC records every original and refined value.

## Continuation witnesses and checks

- Normal `cargo build -p snapback4`: passes ([log](resume/build.log)).
- `cargo check -p snapback4-core --no-default-features`: passes
  ([log](resume/no-default.log)).
- Generation-integrated equivalence: **3,456 states per adapter**, identical
  old/new facts and shared resolver verdicts; one SELECT per fetch. Missing
  storage, NUL token/digest, expiry, revocation, caps, principal/worker
  generations/revisions, and store generation/incarnation are covered. SQLite
  existing-reader, old-snapshot and full/savepoint rollback witnesses pass.
  Five tests pass ([log](resume/facts.log)).
- Identity conformance on both adapters: **79 pass**, including shared identity
  contracts, races and Postgres attachment checks ([log](resume/identity.log)).
- Queued authority: **both SQLite and Postgres pass**, including expiry and
  revocation during observed waits for first attempts, replay and ephemeral
  admission. SQLite retains adoption coverage; Postgres uses its repaired
  queue-only fixture ([log](resume/queued.log)).
- Full binary suite (including serve, identity, authority, adoption and round
  trip): **537 pass, 11 ignored, no failures** ([log](resume/binary.log)).
  Private-Postgres ignored targets are run explicitly above and by the script.
- Both final RT0 ratchets: **pass** ([log](resume/rt0.log)).
- First full core run: **1,090 pass, five ignored, one fixture failure**
  ([log](resume/core.log)). The malformed-storage fixture injected DDL after
  attachment, bypassing the new attach-time presence flag. It now persists
  malformed storage and reopens before asserting resolution and rotation
  errors. Production authority code is unchanged in the continuation.
  The complete final repeat with that correction **passes: 1,091 tests,
  five ignored, no failures** ([log](resume/core-final.log)).
- `bash scripts/test-postgres.sh`: **passes**, 390 Rust cases and the public
  deploy/serve, restart, takeover and P1-MC witnesses ([log](resume/postgres.log)).
- `./ref-check`: **passes**, 565 LLP documents, 11,775 references, zero errors
  and zero unchecked ([initial log](resume/refs.log)); the final repeat after
  documentation updates is recorded in [refs-final.log](resume/refs-final.log).

## Cold rebuild, disk and process custody

The lead removed this lane's target before resumption. The continuation exports
`CARGO_PROFILE_DEV_DEBUG=line-tables-only` and
`CARGO_PROFILE_TEST_DEBUG=line-tables-only`, uses eight Cargo jobs, and owns only
`/home/ccheever/projects/sb4-s1sk/snapback4/target`. The Postgres script's ordinary
shared-manifest `cargo clean` runs against these newly created owned artifacts;
no preservation wrapper is needed. Commands and profile inputs are in
[resume/commands.jsonl](resume/commands.jsonl).

The continuation started with 84 GB free and uses the author's lowered 20 GB
floor, which was never crossed (minimum 67.14 GiB free). Disk samples,
PID/start-time records and private-cluster checks are under
`resume/`. The prior cluster `/tmp/sb4-rt3a-pg.owPlDk` was independently confirmed
stopped (status 3, no postmaster.pid), then removed along with obsolete owned
scratch helpers/logs. Both continuation clusters are also stopped and removed;
the Postgres qualification runner and final core runner each record no
remaining children. See [cluster cleanup](resume/public-serve-cleanup.json),
[Postgres custody](resume/custody.json), and [core custody](resume/custody-core-final.json).
Every recorded workload PID is checked again before commit. PIDs left: **none**.

The earlier checkpoint stopped below its then-30 GB floor. Its original logs,
`DISK-STOP` and `custody-final.json` remain historical evidence, not final
qualification. The generation-integrated measurements in those logs predate the
final green repeat now recorded under `resume/`.
