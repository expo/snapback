# RT3a — authority facts and fix round 1

Initial RT3a base: `bfdf05127889775a693960ad21cc6920147a3781`.
Fix round 1 base: `f9d714d4a2`; branch `sb4-pg/rt3a-fix1`.
Only RFC §3.2 is in scope. Authority policy and request boundaries retain their
shared Rust implementation. The lead approved one RT0 change on continuation: SQLite `unknown_token` 3→4; every other cell is unchanged.

## Fix round 1

- A false read-storage flag plus a session miss probes the catalog once in the
  same snapshot, then enables the read arm and repeats the facts statement if
  storage exists. Dedicated snapshots publish committed discovery to their
  handle; ordinary transactions publish at commit. SQLite backups initialize an
  independent flag from their copied catalog. Witnesses cover `fork_memory`,
  `Engine::fork_fixture`, independently opened SQLite read-only and prepared
  handles, old snapshots, and a real second Postgres connection. Subsequent
  read-session hits use one facts statement.
- The old/new matrix adds missing principal-generation rows, duplicate digests
  across both session tables (exact matching errors), legacy NULL families, a
  matching supervised revision with mismatched named-family revision, and live
  action claims with `_requests` rows. SQLite asserts schema, activation and
  device-generation markers. The Postgres baseline probes the catalog and uses
  independent multi-statement session/family access, never the fast-path flags.
- Postgres savepoint rollback re-probes pending read-storage installation.
  Witnesses cover an install rolled back with its savepoint and an install made
  before the savepoint that must survive rollback and commit.
- Raw NUL digests return no session without SQL in `resolve_session_tx` and both
  facts adapters. These are optional lookup keys; identity admission and stored
  principal/kind/family checks still fail closed. Both witnesses count zero SQL.

The fact projections remain in [STATEMENTS.md](STATEMENTS.md), followed by the
new catalog fallback. Ordinary hits remain one statement; absent-storage misses
now include the catalog probe as required.

## RT0 tables

Relative to `f9d714d4a2`, SQLite changes only `unknown_token` from 3 to 4.
Its eleven other cells and all twelve Postgres cells are unchanged.

| Table | SHA-256 |
| --- | --- |
| `crates/snapback4/tests/round_trips/sqlite.json` | `fd7cef5e61d5ac3be8cd9736b0544435a92be683c08b2630b63ea5c27aab918b` |
| `crates/snapback4/tests/round_trips/postgres.json` | `39090c802e74edc0311bc06f062c17df638c123afa69e1bc8b2a53b18eecb35b` |

The initial RT3a measurements remain in [counts.json](counts.json); the completed
continuation measurements are preserved from `resume/rt0-counts.json` in
[final-counts.json](final-counts.json). Those are historical measurement counts. Current fix-round warm and cold
measurements, approved delta and table digests are in [fix1-counts.json](fix1-counts.json).

## Fix-round validation

The initial run stopped at the original RT0 rule: SQLite `unknown_token`
measured 4 against 3. The lead approved that cell on continuation. The added
statement is:

```sql
SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = '_read_sessions')
```

It runs only when the availability flag is false **and** the no-read-arm facts
statement finds no session. Full-session hits return before it. Known read-session
hits use the read arm directly. A stale handle's first lookup of a read token
starts as a miss, discovers storage, then reruns the facts SELECT. A store that
has ever minted a committed read session already knows storage exists and never
pays this probe, even on an unknown digest. Postgres writable attach installs
storage, so its RT0 unknown-token path is unchanged. The four fact projections
remain byte-for-byte unchanged.

The first Postgres two-connection fixture used a unified handle against a live
evaluator and timed out on evaluator-owner isolation. The corrected source uses
two evaluator adapter connections. Initial Cargo witness invocations also placed
`-j 4` after the libtest separator; the wrapper now passes it to Cargo. These
setup failures are retained in the external logs.

Continuation checks already completed:

- All 11 focused witnesses pass, including both 4,545-state matrices, copied
  fixtures, independent SQLite handles, the corrected Postgres two-connection
  witness, both savepoint rollback placements and both zero-query NUL witnesses.
- Both RT0 ratchets pass with three identical warm samples per class. The
  ratchet command passes four tests total; exactly one of 24 table cells changed.
- `cargo build -p snapback4` and
  `cargo check -p snapback4-core --no-default-features` pass.

- Complete core (`--no-fail-fast`): **1,094 pass, five ignored**. The
  physical-commit nested subprocess case is counted once through its parent.
- Affected binary filters (`serve identity authority round_trip`, normal ignore
  behavior): **304 pass, ten ignored**. The initial `--include-ignored` command
  passed 311 but wrongly launched three operator/child fixtures without required
  inputs: `crash_during_adoption_child` (`SNAPBACK4_ADOPTION_CRASH_DB`),
  `scale_changes_waits_for_durable_adoption_while_query_and_sync_read`
  (`SNAPBACK4_ADOPTION_HTTP_DB`) and `p1mc_seed_public_scale_fixture`
  (`SNAPBACK4_P1MC_SEED`). These are invocation errors, not dismissed inherited
  product reds. Their ignore annotations explicitly require their witness/fixture
  setup; the corrected command passes. The Postgres script invokes its public
  scale seed with its required input.
- Identity conformance on both adapters (`--features postgres --lib identity
  -- --include-ignored`): **82 pass, zero ignored**.
- `./ref-check` after the continuation RFC and journal edits: **pass**, 565 LLP
  documents, 11,775 references, zero errors or unchecked references.

The first full Postgres-script attempt completed its runtime stages and public
serving witness, but four binary-test compile invocations failed with a
cross-workspace artifact identity conflict (`Refusal: serde::Serialize`). The
initial wrapper had skipped the script's shared-target `cargo clean` to preserve
preexisting warm files. That skip was incorrect. The corrected wrapper enumerates
exactly the package outputs selected by `cargo clean --dry-run --verbose` and
moves them, without deletion, into `/tmp/sb4-rt3a-fix1/handoff-*/artifacts/`.
It preserves warm files while honoring both clean workspace handoffs. Production
source is unchanged. The complete script rerun passes with that correction: **393 Rust test
executions, zero failures or ignored**, plus public serving, restart/takeover,
release adoption and P1-MC. Both public-witness clusters confirm shutdown with
status 3 and no `postmaster.pid`. No failed product test is dismissed as
inherited; no baseline exception is used.

## Evidence and custody

Raw logs, PID records and disk traces are outside Git at
`/tmp/sb4-rt3a-fix1/` on expo-build-450a. The raw evidence originally committed
under this report directory (including `resume/`) was copied to
`/tmp/sb4-rt3a-fix1/rt3a-original/` before removal. Historical RT3a results:
3,456 generated states per adapter, 79 identity tests, 1,091 core passes/five
ignored, 537 binary passes/11 ignored, and 390 Postgres Rust cases plus public
serving witnesses. The earlier disk-stop checkpoint and corrected malformed
storage fixture remain documented in the RFC and journal; original transcripts
are in that external evidence directory. These historical counts are not this
fix round's qualification.

This round owns only `/home/ccheever/projects/sb4-rt12f2/snapback4/target`, uses
four Cargo jobs and `line-tables-only` for dev/test debug profiles. The corrected Postgres-script wrapper retains shared-manifest cleanup outputs
outside the target instead of deleting preexisting warm files; each handoff then
compiles its own workspace source under the lane-owned target. Only private PG16
clusters are used; PG17 on 55440 is untouched. The disk floor is 40 GB. No push,
stash or git configuration change.

The evaluator cluster `/tmp/sb4-rt3a-fix1/pg-data` was resumed as postmaster
PID 3524600 after the initial PID 3348117 had been stopped. It is now stopped.
Both public-witness clusters (`s10d3-serve-7rjgl_gl`, PID 3832682, and
`s10d3-serve-yda_tq4i`, PID 3961332) are also stopped. Independent inspection
of all three cluster directories returns status 3 with no `postmaster.pid`.
The final process-identity audit finds no living owned workload PID or zombie.
PIDs left: **none**. The minimum sampled free space was
148.0 GiB, above the 40 GiB floor. Raw final custody is
`/tmp/sb4-rt3a-fix1/final-resumed-audit.json`.
