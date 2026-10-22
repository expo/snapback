# Provenance and retained interruptions

Product base: `45416b150c` (P1-MC). The measured product and unchanged Quarry
app have no source edits in this lane. Builds are release, with
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`; product and operator
helper use this worktree's `snapback4/target/s1sk`, and the existing Rust load
harness uses `scale-controls/target`. Build commands/logs/PIDs are in the archive.
The helpers are experiment crates, not product changes.

The app host alias 450b identifies as `expose-builder-pixel-a`; 450a identifies
as `expose-builder-nothing`. The shared PG17.9 cluster remains on 55440 with
postmaster 2735539. Only database `sb4_snapback_s1pg2`, role `s1pg2_app`,
experiment-local socket directories and explicitly named remote seed directories
belong to this lane. No cluster restart, reconfiguration or statistics reset.

## Evidence segments

All paths below are under archived `target/s1pg2/`.

| Segment | Use in final campaign |
|---|---|
| `raw` | Initial deploy/setup; controller replaced before load to remove an inherited SQLite-only CLI drain. Transport children stopped; remote seed continued. |
| `raw-resumed` | First complete native 1M seed, 1,085.265 s total / 1,079.013 s messages; full image/recount checks pass. First W1 warm probes succeed, then an observer queries `pg_stat_statements` from `postgres`, where its extension is absent (SQLSTATE 42P01). No timed load trial. Cleanup dropped only this owned fixture. |
| `raw-v2`, `raw-v3`, `raw-v4` | Second seed with setup-only controller handoffs. Native seed continued across every handoff; no timed trials. Native service-authorized account mints replace guest mints, since the unchanged fixture disables guest login. The 1% probe and provenance receipts were completed before measurement. |
| `raw-final` | Second 1M seed: 916.504 s total / 909.957 s messages, all images and every room/user recount exact. Complete natural W1 and W2 cells retained. W3's first attempt is interrupted by the observer race described below; its partial trials do not qualify a cell. |
| `raw-tail` | Whole natural W3 rerun and six more complete cells. Its first delayed W4 attempt stops at a refused post-load drain request; that whole partial cell is excluded from qualification. |
| `raw-writes` | Fresh-process rerun of the three delayed write cells. The retained fixture and all nine complete earlier cells are reused. Only the outside-window drain handles explicit 429 / admission-503 refusals with a bounded retry; no timed operation is retried. |

The `raw-resumed` observer failure's minimal command was a read-only
`SELECT ... FROM pg_stat_statements` with `psql -d postgres`. The extension was
installed only in the owned database. The corrected observer selects from the
owned database; its transactions remain in database-wide deltas and are excluded
from application-role statement deltas. The failed cleanup and reseed are retained.

During W3 in `raw-final`, a thread exited between enumerating
`/proc/<server>/task` and reading its `wchan`. Linux returned `ESRCH` as
`ProcessLookupError`, a second spelling of the already handled vanished-thread
case (`FileNotFoundError`). The fix is confined to the experiment sampler in
`scripts/snapback.py`. No sampler assertion, workload, timing, SLO or product
path was weakened. The interrupted load/server were stopped, the fixture was
retained, and the complete W3 cell was restarted. Completed W1/W2 have no
vanished-thread error and are retained without an unnecessary rerun.

These are harness/setup interruptions, not Postgres product defects. Expected
HTTP 503 / `E_RATE_LIMIT` admissions at overload are measured errors, not setup
interruptions. Source, command, per-process output and exit status remain raw
rather than being replaced with a passing retry.

The first delayed W4 attempt completed three 3,200/s repetitions, then stopped
after the next load when the native drain request was refused. That first
harness version did not retain its HTTP status/code; it must not be assigned a
product error code retroactively. The corrected drain logs only sanitized
status/code/context, never a session-bearing reply, and retries explicit
pre-admission 429 or `E_RATE_LIMIT`/`E_STREAMS` 503 for at most 30 seconds.
Counter recovery after the stopped server witnesses 760 increments beyond the
last complete natural write image: 70 clean probes, 498 in completed but
unqualified cohorts, and 192 in the interrupted cohort; zero acknowledged
writes in those load cohorts. This offset is separately audited, never used as
a passing cell or silently assigned to the rerun. Two supplemental observers
also initially started before the new ownership receipt existed; their startup
errors are retained, and the guarded restarts precede timed load.

## Seed and source binding

Both seeds call the common `Engine::seed_at` through an acquired native store
lease, locally on 450a. The actual original seed executable has SHA-256
`4af24c6b286f8a67f0c7c7915df2ebd61865397d0b44e8baef947c91f7aa38a5`.
Its source is the original `postgres-seed/src/main.rs` at `26239ea231`.
A later helper adds only a separate drain-service-seat setup mode; its SHA-256 is
`c23e315a4c8a5c62bd2a6556288deb681b543b7707c08e8661af73cabdac0c0a`.
The running seed was never overwritten. An early resume receipt mistakenly
reported the newer local helper's digest for the already-running original seed;
independent `sha256sum` on 450a corrects that in `seed-binary-provenance.json`.
The original receipt is retained alongside the correction.

The native helper creates the privileged service seat through the same acquired
store. Two public `/auth/session` account mints cross the serving FIFO after a
load, outside its timed interval, without changing counters or rotating any of
the 256 measured member sessions. They replace SQLite's local token-mint drain,
which the PG operator CLI intentionally excludes. Clean per-operation probes
exclude these mints; full trial statement snapshots retain their overhead.

Product/harness digests and source-at-launch digests are in each `ownership.json`.
`runner-at-launch.py` preserves the controller bytes even for setup versions
whose code changed while their detached process was still polling the seed.
Head revisions can move as evidence is committed; content digests bind the
measured inputs, and no product delta is integrated during measurement.

The requested request-round-trip RFC was initially absent from this branch,
fetched `origin/main` and the Git origin server's default checkout. The origin
server identifies as `expose-builder-pixel`; its default checkout is `ts-audit`.
The document was subsequently found in its existing P0 worktree
`/home/ccheever/projects/sb4-pg-p0`, branch `sb4-pg/rt-rfc`, at source commit
`bd0da3c11188ce61d55bb7b8348e196f61ecc863`. Sections 1, 2 and 4 were read.
Its exact snapshot is archived as `request-round-trip-budget.reference.md`,
SHA-256 `754ac1a22b2d4e4e4c127ee7663843931e124f6dd5c08f8b9e6f97385e428190`.
No source from that branch was integrated into the measured product. B1/B2
predictions use its explicit schedules: W1 6/3/5, W2 6/2/(2 or 4), and the
three-program-flight unkeyed mutation 16/8/11 (B1/B2a/B2b). W3's dependent
program work is explicitly outside those constant schedules. The earlier
clarification request is resolved without requiring user input.

## End-of-campaign cross-trial audit

The first aggregation correctly stopped on a counter gap rather than silently
claiming zero. The completed audit finds eight late increments in four gaps,
including two in natural W5-same and six across the delayed writes. All adjacent
trials already fail; no qualification verdict changes. `whole-write-audit.json`
records the boundaries, reconciles the final 46072 image, and leaves spillover
unassigned. Two FIFO identity mints and stable snapshots are not a proof of
HTTP quiescence. This is an [open experiment-harness issue](../../../../issues/20261022-sb4-scale-drain-does-not-fence-late-http-writes.md),
not evidence of Postgres corruption. Snapshot delta/time remains diagnostic;
unkeyed aggregate counts are not operation-id receipt correspondence. The
failed first aggregation command/error is archived too.
