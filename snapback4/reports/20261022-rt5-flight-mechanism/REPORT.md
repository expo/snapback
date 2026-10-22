# RT5: flight mechanism

Branch `sb4-pg/rt5`, base `22811380194f53ae9db9cde708ca70827a8fb6c2`.
This is test/experiment code. Serving and attach DDL use neither candidate.
The [context pack](./CONTEXT.md) names the governing constraints.

**RT5 adopts (a) under §3.6.** Review items 1–4 pass on both C and
`en_US.utf8`, and the lead's [qualifying Hetzner run](../../experiments/postgres-commit-path/results-rt5-hetzner/README.md)
shows (a) fastest on both shapes. These fixes preserve its flight structure;
the network figures still apply. Serving and attach remain unchanged; RT6
owns integration. No extended-protocol stall is explained here.

The encoder emits ASCII SQL with catalog-qualified casts, UTF-8 hex text
conversion, hex bytes and typed ARRAY constructors. Connection qualification
pins and verifies `client_encoding=UTF8`, `extra_float_digits=3`,
`bytea_output=hex`. Every emitted function/type name, including PREPARE types
and setting verification, uses `pg_catalog`. The decoder selects by prepared
OID and parses in Rust, with no SQL namespace lookup. This is encoder session
independence, separate from rule 9's locale-independent attach checks.

Admitted inputs are bool, i16/i32/i64, f32/f64, TEXT, BYTEA and unit-bound 1-D
arrays (optional values and elements included). Port strings bind as TEXT;
numeric and binary primitives retain codec qualification.
NAME, BPCHAR, VARCHAR (including typmods) and their arrays refuse; they are not
current port bindings. NUMERIC, dates, multidimensional/non-unit-bound arrays
and custom text-format ToSql parameters remain excluded.

Coverage retains NULLs, integer endpoints and shared-policy saturation,
f32/f64 bounds/subnormals/non-finite values, text quoting/control/Unicode/
combining characters, all 256 bytes, and exact tail $8–$25 array ordering.
Each of two hostile configurations now includes `search_path=app,pg_catalog`
with shadowed functions/types, plus SQL_ASCII, lossy float output, bytea escape,
SQL/DMY DateStyle and both standard_conforming_strings settings before
qualification. Each runs 256 seeded i64/f64/f32/text and float-array iterations.
All non-NaN floats compare bit-for-bit, including signed zero. NaNs use the
explicit exact canonical contract detailed below; arbitrary sign/payload
preservation is not claimed. Server errors compare SQLSTATE/message/detail and
aborted state. Scalar, optional and array NULs retain identical `E_INPUT`,
terminal poison, savepoint refusal and rollback of earlier writes.

## RT5 fix round 1

1. **Namespace independence:** qualify `pg_catalog.decode`,
   `pg_catalog.convert_from`, `pg_catalog.current_setting` and every cast/PREPARE
   type, using catalog names such as `pg_catalog.int8` and `pg_catalog.float8`.
   `rt5_literal_bind_difftest` installs shadow decode/convert_from/current_setting
   functions, an app.text domain over varchar(1), and domains shadowing every
   other emitted type. It proves the unqualified probes are corrupted, checks
   Bind parameter OIDs remain TEXT/BYTEA, and asserts both paths return the
   intended text. The full hostile matrix and tail arrays run with app-first
   search_path. Output decode uses OIDs and Rust parsers only.
2. **Length/coercion boundaries:** `rt5_length_boundaries_and_excluded_coercing_types`
   reproduces Bind's `42622` and transaction abort for NAME scalars/arrays at
   64-byte ASCII and 66-byte Unicode. The encoder and Prepared refuse NAME,
   BPCHAR and VARCHAR inputs/arrays, including varchar(n); the same boundary
   values round-trip intact through supported TEXT/TEXT[]. The no-server test
   also excludes null and empty arrays of these types.
3. **Exact float evidence:** `equal` compares bits with no NaN-equivalence
   escape. `rt5_nan_canonicalization_exact_bits` tests positive/negative,
   quiet/signaling, zero/nonzero-payload f32/f64 NaNs in scalars and arrays.
   Native Bind preserves every input bit (checked through Row::get and server
   float4send/float8send). The existing literal `'NaN'` input produces exactly
   positive quiet NaN: f32 **0x7fc00000**, f64 **0x7ff8000000000000**. PostgreSQL
   text output is exactly `NaN` / `{NaN,NULL,NaN}`; the decoder now constructs
   those specified bits explicitly. The oracle maps only native NaNs to this
   exact text-output contract before bit comparison. This records the loss of
   NaN sign/payload rather than accepting any NaN pair; current port facts do
   not expose them. Seeded coverage now includes f32 and nullable arrays of
   both float widths, in addition to the fixed table.
4. **Decode-error parity:** `literal_query` no longer sets bind_refused when
   decoding a successful SimpleQuery result fails. The regression catches an
   actual Bind Row::get panic and a literal numeric decode error, then proves
   each can ROLLBACK TO SAVEPOINT, execute again and commit only rows [1,3].
   Pre-command refusal and server errors retain their existing poison behavior.
5. **Records:** the RFC/README now describe encoder session independence and
   identify rule 9 correctly. The correctness/adoption claim follows the
   successful items 1–4 checks and the existing network qualification.

All **8/8** RT5 tests pass independently on both locale databases. The first
local attempt caught one remaining unqualified TEXT cast in the test's generated
tail statement; it was corrected to a catalog-qualified cast and both locale
runs pass. That failed attempt is retained in `fix-round-1/rt5-c-initial.log`.
The review fixes change no expression or flight structure: qualification adds
catalog prefixes/uses internal catalog type names; excluded string types are
unused by the benchmark/port; explicit NaN decode returns the same canonical
bits as before; decode-error handling changes only client state. W1 remains
3/5/6 flights and mutation 8/11/16 for (a)/(b)/per-statement. The
[Hetzner evidence](../../experiments/postgres-commit-path/results-rt5-hetzner/README.md)
therefore still applies without a rerun.

The error-at-command-k witness tests every position in a three-command flight.
A sequence records how many commands actually ran even after rollback; later
commands never execute. Fence and generation refusals abort, as does the
prototype's zero-row tail. For visibility, A holds the head and changes the
generation/authority/receipt. B's prepared execution is observed in
`pg_blocking_pids` before A may commit. Ordered SimpleQuery and `sb4_open`
return generation 2, authority `after`, receipt `after`. The single-statement
VOLATILE SQL-language control returns generation 1, authority `before`, receipt
NULL: its internal SELECT has the snapshot from before waiting. This proves
that composed SQL control fails, not that every possible SQL-language function
fails. RT5 keeps the RFC's narrower, non-inlined PL/pgSQL candidate.

## Qualifying Hetzner path

The lead ran source `3e945e6146` on 450b→450a with one independent SSH stream
per connection (64 tunnels), PG16.15, C=32, 1 s warm-up / 4 s window, three
fresh processes per shape/form. Results were fast-forwarded in `8f6d9b0b0d`.
The [results README](../../experiments/postgres-commit-path/results-rt5-hetzner/README.md)
links the raw records and cleanup. Every transcript and durable counter passes.

| Shape | Form | Flights | Executions/s median | p50 ms | p99 ms median / worst |
| --- | --- | ---: | ---: | ---: | ---: |
| W1 | per-statement | 6 | 4,686 | 6.32 | 13.86 / 14.07 |
| W1 | (a) SimpleQuery | 3 | **8,535** | **3.36** | 8.24 / 9.17 |
| W1 | (b) PL/pgSQL | 5 | 5,589 | 5.30 | 11.22 / 11.42 |
| mutation | per-statement | 16 | 79 | 373.0 | 712.9 / 721.9 |
| mutation | (a) SimpleQuery | 8 | **141** | **226.1** | 324.5 / 460.2 |
| mutation | (b) PL/pgSQL | 11 | 110 | 293.0 | 372.2 / 399.3 |

Prepared-ping controls: p50 0.59–0.64 ms, p99 0.78–3.73 ms. The baseline
models B1, not today's full serving path. Under §3.6, the corrected codec and
holding latency choose **(a)**; these are statement-model results, not an engine
SLO or a serving capability claim. RT6 owns actual serving qualification.

## Non-qualifying loopback smoke

PG16 private cluster on 127.0.0.1:55491; unchanged durable settings, C=32,
1-second warm-up + 4-second measurement, 3 fresh processes per cell. Read
address dependencies, three increment program steps, client tail validation
and separate COMMIT are preserved. The baseline is B1's per-statement shape,
not RT0's duplicated authentication. Models fetch only test facts; they do
not run the interpreter or represent serving performance.

| Shape | Form | Flights | Executions/s median | p50 ms median | p99 ms median | Worst p99 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| W1 | per statement | 6 | 26,636 | 1.229 | 2.726 | 2.780 |
| W1 | (a) SimpleQuery | 3 | 34,920 | 0.917 | 2.057 | 2.225 |
| W1 | (b) PL/pgSQL | 5 | 29,573 | 1.069 | 2.512 | 2.843 |
| mutation | per statement | 16 | 226.0 | 145.983 | 444.301 | 698.207 |
| mutation | (a) SimpleQuery | 8 | 227.5 | 143.413 | 372.215 | 401.179 |
| mutation | (b) PL/pgSQL | 11 | 230.0 | 32.954 | 705.055 | 1,050.449 |

All 18 measured repetitions pass transcripts and counters, including warm-up
and drain. Mutations share one head: backend samples are predominantly tuple
lock waits with WALSync visible. Nearly equal throughput and very different
latency distributions do not establish a network-flight win. In particular,
(b)'s lower p50 is accompanied by its much worse tail. The smoke does not meet
an engine SLO or measure an open-loop workload.

[Raw smoke records](../../experiments/postgres-commit-path/results-20261022-rt5-loopback/summary.json)
include per-run percentiles, rates, WAL, waits, load, correctness, source and
binary hashes, 33 recorded child lifetimes, and a successful cleanup receipt.
The [experiment README](../../experiments/postgres-commit-path/README.md#rt5-flight-mechanism-qualification-2026-10-22)
gives the exact target/password-file commands for the lead's 450b→450a run,
with separate S1b-style SSH streams or explicitly labelled direct TCP.

## Fix-round-1 checks and cleanup — 2026-10-23

[Command records](./fix-round-1/checks.json) retain argv, PID, elapsed time and
exit status; full logs are alongside them. All Cargo commands used this lane's
target and `-j 6` (the script inherits CARGO_BUILD_JOBS=6).

- Ordinary `cargo build -p snapback4`: **pass**.
- `cargo check -p snapback4-core --no-default-features`: **pass**.
- `cargo test -p snapback4-core --no-fail-fast`: **pass**, 1,075 unfiltered
  passes, five named ignores and one passing subprocess case; 1,359.34 s.
- Final RT5 C and en_US.utf8 runs: **8/8 each**, no ignores/failures. The
  database collations are recorded in [the locale log](./fix-round-1/locale-and-cluster-stop.log).
  These final runs include supplemental assertions that native Bind NaNs cast
  to text produce exactly `NaN` / `{NaN,NULL,NaN}`, independently of literal
  construction. This test-only addition followed the script's RT5 stage;
  the affected eight tests were rebuilt and rerun on both locales.
- `bash scripts/test-postgres.sh`: **exit 1**, 371 Rust passes / one failure /
  zero ignores, 1,559.00 s. All 218 core PG cases, eight RT5 cases, 25 ownership
  cases, trait/doctests, committer/CLI cases and 19 corpus cases pass. The
  complete public Postgres serving milestone **passes**, including P1-MC and
  the bootstrap case that timed out in the original round. Both script-owned
  clusters stop and confirm status 3 with no postmaster.pid.
- The one red is the existing experimental
  `concurrent_read_modify_write_and_duplicate_ops_are_atomic_in_both_modes`
  stress case: SQLSTATE **40001** from the increment mutation at
  `experiments/postgres/tests/conformance.rs:244`, joined at line 257.
  **Rerun alone also fails** with the same error (3.62 s): Serialized completes
  all 65 increments with zero retries; the Serializable half exhausts its
  existing retry policy. The rerun executes the exact conformance binary
  named by the full script, on this lane's isolated en_US.utf8 database;
  [artifact SHA-256](./fix-round-1/isolated-conformance-binary.json) and
  [full standalone output](./fix-round-1/concurrency-alone.log) are retained.
  The evaluator source and mutation/retry paths are unchanged, with no literal
  calls. The [existing stress ticket](../../../issues/20260916-snapback4-postgres-serializable-benchmark-failures.md)
  records this occurrence. No retry limit, timeout, backoff, concurrency or
  durability policy was changed; the full PG script is not claimed green.
- `./ref-check`: **pass**; final documentation result in
  [ref-check-final.log](./fix-round-1/ref-check-final.log).
- Fresh ordinary `cargo build --release -p snapback4`: **pass**, 217.17 s.
  The [symbol audit](./fix-round-1/symbol-check.json) finds 96,284 defined
  symbols, including 477 production Postgres symbols, **zero encoder or
  literal_query symbols**, and zero RT5 encoder string markers. Binary SHA-256:
  `27e6ff18ab691d8c41fdf135e498d801a91ae676e0a6c31e7ce83c4ad035ced3`.

Local failed attempts are retained rather than hidden: the first difftest
caught an unqualified cast in the generated tail *test statement*; that fixture
was corrected before the passing locale runs. A retry-cluster restart omitted
its explicit socket/port options, failed because the default socket directory
was missing, and shut down immediately (PID 1234561 absent). It was restarted
with the original explicit private socket, port 55492 and no TCP listener;
the final locale tests and isolated stress rerun used that corrected lifetime.
Neither setup correction changes product code, settings policy or measurements.

[Cleanup receipt](./fix-round-1/cleanup.json): the four successful private PG16
postmaster lifetimes (1064149, 1160424, 1215830, 1235472) and failed startup
1234561 are absent. Both uses of the locale-cluster directory have independent
stop confirmation; all six public serve children and recorded check/runner
PIDs are absent. The executable census of this lane's target is empty.
**PIDs left: none.** PG17/55440 and the K0-Q lane/worktree were untouched.

The minimum observed `df -h /home` availability was 24 G, above the 20 G stop
rule. Only completed, inactive incremental sessions in this lane's target were
removed (5.34 GB recorded allocation; nonblocking session locks held, working
sessions excluded): [cleanup scope](./fix-round-1/inactive-cache-cleanup.json).
The PG script also performed its ordinary package-scoped shared-target clean.
No push, stash or Git configuration change was performed.

## Original-round checks and cleanup

The check runner records commands, exit status, duration and owned PID in
[checks.json](./checks.json); complete output is alongside it.

- `cargo build -p snapback4`: pass. The final ordinary CLI has no candidate
  literal-codec symbols.
- `cargo check -p snapback4-core --no-default-features`: pass.
- `cargo test -p snapback4-core --no-fail-fast`: 1,075 unfiltered passes,
  five named ignores, plus one passing subprocess check.
- Corrected standalone RT5 qualification: 5/5 pass, including the native Bind
  decoder oracle; the locale script independently repeats all five successfully.
- Full `scripts/test-postgres.sh` retry: **369 Rust passes, no Rust failures**;
  overall exit 1 because its separate public bootstrap/deploy witness exceeded
  its existing 45-second subprocess guard at the failed-binding case (line 139).
  This also happened in the first run. **Rerun alone passes:**
  `python3 scripts/test-postgres-serve.py`, same en_US.utf8/PG16 environment,
  completes the full public-serving and P1-MC milestone (272.72 s overall).
  The cause of the full-script timeout is unisolated; no limit was raised.
  [Follow-up ticket](../../../issues/20261022-postgres-public-bootstrap-witness-timeout.md).
- `./ref-check`: pass, 565 LLPs / 11,759 refs / zero errors or unchecked refs.
  The final documentation pass is retained separately.
- RT5 release harness build and all 18 smoke repetitions: pass. The historical
  default harness build fails with nine SQLite raw-handle errors, independently
  rerun alone; use the documented `--features rt5` scope for these PG cells.

[Cleanup receipt](./cleanup.json): all six owned PG16 postmaster lifetimes
(319073, 501389, 576252, 590474, 864864, 894705) have status 3, no postmaster.pid,
and absent PIDs. All six recorded public serve PIDs and 33 benchmark child
processes are stopped; 59 recorded PID checks are empty, and no executable
from this lane's target is running. **PIDs left: none.** PG17/55440 was untouched.
Private cluster data remain in their recorded /tmp directories for inspection.

Disk stayed above the stop threshold (minimum observed: 29 G on `df -h`).
Only this lane's old, closed, prior-day B3 generated database cache was removed
(8.19 GB, 8,180 files); the cache-cleanup receipt records the scope. No compiled
or active artifacts were removed by that cache cleanup. The existing PG script
also performs its own documented shared-target package clean at each handoff.

The historical harness default build independently reproduces nine pre-existing
SQLite raw-handle compile errors after the store-port extraction. The `rt5`
feature builds the same harness without those historical SQLite modules; it
adds no raw handle to the core. The experiment lockfile is refreshed for the
already-current core/lang/device path versions, without dependency upgrades.
Initial local validation corrected a witness setup error: its sequence must
be created in a completed command before BEGIN so rollback cannot remove it.
The final test-file split also needed explicit driver imports and a corrected
connect call. The corrected standalone run passes all five tests with the
independent native Bind decoder oracle. Failed attempts remain in the logs.
The smoke precedes a whitespace-only codec EOF cleanup, a fixture reference
comment and those test-only edits; encoded SQL and executed statements are unchanged.

Initializing the missing LLP skill briefly registered its submodule in Git's
shared config. Only that exact new registration was removed immediately;
prior Git configuration was restored. No push, stash, other worktree access,
remote execution or PG17/55440 access was performed.
