# G5RF: fix round 1 and Postgres read default

2026-10-28, base `0769bf5239`, branch `sb4-pg/g5-readindex`.

The blind Sol and Grok reviews both returned READY WITH CHANGES, with no
stale-read counterexample under the complete-revision writer contract. The
author commissioned every required fix and default promotion. The disposition
and accepted default are in [the governing RI subsection](../../../llp/3000.009.001.000.002-beating-the-postgres-controls.rfc.md#g5-read-index-validation).

| Finding | Change | Witness |
| --- | --- | --- |
| G6 precedence | Configured G6 bypasses RI enrollment, including HTTP before the engine. Sol was right about the HTTP interception; Grok was right that the engine itself already tried G6 first. | `g5rf_http_both_flags_live_g6_has_zero_ri_rounds` (child process has both flags explicitly on; 20 live G6 hits, zero RI rounds/reads and no timer queue) |
| Fallible timer | Lazy initialization returns a cached failure and resumes ordinary G5 with the same admission/deadline. | `g5rf_http_timer_spawn_failure_resumes_g5_with_original_admission_and_deadline` (held injected failure expires the original deadline; next request returns the ordinary G5 hit) |
| Idle spin | Condvar waits until collection/expiry or work notification; separate schedule ownership allows idle owner-drop shutdown. | `g5rf_http_idle_timer_parks_on_condvar` |
| Blocking API | Removed synchronous coordinator and its one-second wait. Direct engine calls never enroll in RI; only detached HTTP continuations use it. | `g5rf_blocking_engine_api_uses_ordinary_g5_without_ri` (one fresh G5 statement, no RI rounds/reads/hits) |
| Stage R | One `Store::read_index_eligible` predicate gates enrollment, validation and saved-proof consumption. `ReadPublication::PublishedPrefix` and early-release modes refuse raw-H RI; mode propagates to readers/replacements. R must select this mode before admission and integrate W-bound V before enabling RI. | `g5rf_publication_prefix_disables_enrollment_validation_and_saved_proof`; RFC 003 §14 amendment |
| Session facts | LLP and guide explicitly distinguish fill-time SessionFacts certification from ordinary G5's per-digest projection reread. Authority writers must bump unified revision; revision-less raw `_sessions` SQL edits are outside the supported-writer boundary. No redundant aggregate-version protocol was added. | Existing RI session revocation / RYW witness and documented writer paths |
| Diagnostics / default | Unset or 1 enables RI for eligible Postgres HTTP reads; 0 disables; malformed/non-UTF-8 values refuse. Startup describes combined G6 mode; doctor distinguishes persisted evidence from unconfirmed owner-local RI status. SQLite/memory, personas/staging and early commit keep their paths. | `g5rf_read_index_default_off_and_invalid_configuration`; `doctor_event_inventory_and_owner_cache_tier`; sanity measurement below |

## Verification

All eight core RI witnesses and all seven HTTP RI witnesses pass on a private
Postgres 16 cluster, port 55771. HTTP witnesses run with RI **unset**, exercising
the new default; the G6 child explicitly sets both settings. The obsolete
blocking-coordinator tests were removed with that coordinator; later-invocation
snapshot rejection remains covered by detached enrollment receipts and foreign
commit / completed-proof witnesses.

## Local sanity (not qualification)

Reproducer: `python3 snapback4/reports/20261027-g5-readindex/round2.py
--sanity-default --fixture-rows 32768 --warmup-ms 2000 --duration-ms 5000
--out /tmp/sb4-g5rf-sanity --result /tmp/g5rf-sanity.json` (one command).

The current release binary, native S1 generator/seed, W2/A 8,000/s, 128 readers,
cap 32, 32,768-message fixture, two rotating repetitions. Each window measures
40,000 successful requests after two seconds of warm-up. Default means the RI
flag is **unset**; off explicitly sets `SNAPBACK4_G5_READ_INDEX=0`. G6 bounds are
unset in both arms. PostgreSQL is private on port 55772; every window stays at
32 connections. Startup identifies the active default/off mode. SQL/ACK and PG
CPU/ACK are cohort measures including warm-up/drain/observer framing. A native
CPU census returning null remains null. All errors are zero.

| Repeat | Mode | p50 ms | p99 ms | SQL/cohort ACK | PG CPU µs/cohort ACK | SLO |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 0 | RI default (unset) | 1.807 | 61.309 | 0.5151 | 208.7 | fail |
| 0 | G5 off (=0) | 1.431 | 42.828 | 1.0086 | 415.0 | pass |
| 1 | G5 off (=0) | 1.398 | 38.044 | 1.0085 | 425.9 | pass |
| 1 | RI default (unset) | 1.780 | 49.676 | 0.5143 | 213.4 | pass |

The roughly halved SQL/ACK establishes that default batching is engaged. This
short shared-host run does **not** establish a latency improvement: default
repeat 0 fails the SLO, and dispatch lag contributes substantially. The earlier
450a three-repetition campaign remains the qualification record. All four
windows and the native null census are preserved in
[the aggregate](./fixround1-sanity.json). Raw/private state stays under `/tmp`;
no token or credential is included here. Measurement cleanup confirms no live
owned processes and no postmaster PID file; data is retained.

The ordinary per-request RT0 witness now runs in a child with RI explicitly
off. Its former thread-local counts alternated between zero for an RI-proof hit
and one for ordinary fallback: the shared validator's SQL is outside that
request's scope. The ordinary G5 ratchet is retained; RI round/hit witnesses and
cohort SQL measurements cover batching. The first extra pipeline run correctly
refused two TCP-only witnesses on the socket-only cluster; both pass on a
separate owned TCP cluster, port 55773, which was stopped immediately afterward.

## Final checks and dispositions

- Core all-target suite and doctests pass (1,335 reported passes); private PG
  revision-cache suite passes 43/43. After moving the RI private corruption and
  simulated-prefix hooks behind `store/port/fixtures.rs`, all eight RI core
  witnesses pass again, and the port ratchet passes without an allowance raise.
- Seven HTTP RI witnesses pass. Other private PG checks: read closure 14/14,
  socket pipeline 7/7 plus TCP-only overlap/NODELAY 2/2 on the separate cluster,
  CLI configuration 3/3, authority-boundary RT3b 87/87, doctor 1/1. The seven
  other Postgres RT0/intake/G6/E tests pass; the corrected ordinary-G5 RT0 test
  passes in its isolated off-mode child.
- The broad CLI invocation completed every target. Its initial four reds were
  confined to three targets: `check` had two missing-workspace-dependency
  failures (root dependencies had been installed, the separate Snapback 4
  workspace had not); after its frozen install, the entire target passes
  107/107. `store_port_ratchet` passes 9/9 after the fixture move. `witness_web`
  passes 1/1 with `SNAPBACK4_WEB_HELPER` explicitly locating the source helper:
  the required root-level Cargo target directory is outside the normal helper
  ancestor path. All remaining CLI targets pass in the broad run. The initial
  command's nonzero exit remains recorded; successful targeted reruns resolve
  each red. No complete client/wasm or publication qualification is claimed.
- `./ref-check`: 575 LLP documents, 12,178 references, zero errors/unchecked.
  Frozen Bun installs pass at root and in the Snapback 4 workspace. The required
  diagnostics generator succeeds with **no generated diff**. `git diff --check`
  passes.
- **Pre-existing unrelated inventory failure:** `node scripts/check-inventories.mjs`
  fails only `guide-manifest`: missing generated competitive-checkpoint
  `startReply.args.schema.json`, todo-v2 Contract `setCompleted.mutation.ts` /
  `runtime-links.ts`, and root `@expo/snapback-contract` package import parity.
  Its expired guide-gap review warnings are also retained in the local log.
  These are unchanged Snapback 1 paths outside this lane. No registry update is
  needed. The ancillary client build is not qualified: ignored wasm inputs
  were absent; emitted helper JavaScript suffices for the CLI help/input test.

Builds use the lane's root `target` and `CARGO_PROFILE_DEV_DEBUG=line-tables-only`.
No push, stash, git-config change or credential copy is performed. The private
PG directories are retained, with their postmasters stopped and PID files
absent; measurement cleanup records zero surviving owned processes.
