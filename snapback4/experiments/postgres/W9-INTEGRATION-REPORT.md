# W9 A1/C1 integration and idle measurement — 2026-09-16

Code measured: `ba92d4f3249bb02b8c1d7bbb48878f64350cede4`.
Base: untouched main `e16baf3483cc840057128da8335aaa14880cf3f4`.
This is evaluation evidence, not production Postgres or publication qualification.

## Integration

A clean worktree cherry-picked A1 `1dd4c9d35` with `-x` as `49e5c2850`,
then C1 `92d9cbede` with `-x` as `1548af2c4`. Neither lane branch was merged.
Conflict resolutions retain W7/W8 adoption, read-only inspection, `--memory`,
presence/grace witnesses and all README behavior across A1's documentation
split. The Postgres tail adapts W7's four-field effect tuple while retaining
the evaluation adapter's explicit lack of presence deferral.

Integration follow-ups:

- `ce4404fbd`: read-only doctor accounts for legacy `_ops` columns without
  migrating and prints the actual release store path; the benchmark exposes
  `SNAPBACK4_EVAL_PREFETCH=on|off` on every measured Postgres connection.
- `2c725e7ec`: the W7 grace witness expects `E_ID_REUSED` for changed arguments
  and replays the original arguments for its successful duplicate.
- `46b0d0e7c`: the experiment lockfile's three local packages match W8's 0.2.24.
- `adb62150b`: the dual-store positive replay witness uses the original
  operation/arguments, separately asserting SQLite's mismatch refusal and
  characterizing the still-open Postgres C3 gap.
- `2c263573a`: a raced in-transaction `E_ID_REUSED` is HTTP 200, not 500;
  otherwise clients would turn the terminal refusal into a link failure.
- `ba92d4f32`: writer errors retain completed benchmark cells and still exit
  nonzero. Every non-panicking writer is joined before the next cell; counters
  verify the successful commits, failed cells have no throughput value.

No retry limit, timeout, durability setting, workload order, meter or target
was tuned. The original lane fix rounds remain in `C1-REPORT.md` and
[the implementation review](../../../llp/reviews/3000.009-implementation-round-1.claude.md).
Independent integration reviews:
[Codex](../../../llp/reviews/3000.009-w9-integration.codex.md),
[fresh Codex Sol](../../../llp/reviews/3000.009-w9-integration.sol.md),
[Grok](../../../llp/reviews/3000.009-w9-integration.grok.md).
The latter two reviewed mutually blind and both cleared `ba92d4f32`.

## Verification

All heavy suites ran serially on `450b`, not on `expo-build-1000`.

| Check | Actual result |
| --- | --- |
| `bash scripts/test.sh` at `ce4404fbd` | Exit 1 in 996 s. Rust: 1,072 passed, one stale grace-replay assertion failed, four ignored. Clients: 400/401, no cancelled/skipped. All other stages passed, including fixture wrappers 9/9, typechecks and builds. |
| Corrected grace-replay witness at `2c725e7ec` | Pass, including delayed delivery and no duplicate claim. |
| Clean-main client baseline at `e16baf3483` | 394/395; the same acquisition-readiness test and line fail with expected `E_OFFLINE` absent. Fresh worktree, workspace/wasm/package builds and chat `check`, then the unchanged full client command. |
| `bash scripts/test-postgres.sh` at `adb62150b` | Exit 0: 15 conformance, one device, two key-bound, five cache/adoption, 18 corpus harness tests. SQLite corpus: 211 passed / 83 named skips / zero failures. Postgres: 208 passed / 86 named skips. |
| Prefetch differential | 6,213 query/point-write plus 15,873 write-loop precharge positions; full outcomes/refusals equal. Largest physical-call excess four; warmed inbox eight calls on / 68 off. |
| HTTP race fix at `ba92d4f32` | Rust classifier/concurrent HTTP witness passes; `write-ids.test.mjs` passes 18/18. |
| Each `bash scripts/test-postgres.sh --bench` at `ba92d4f32` | All preceding conformance/device/key/cache/corpus tests pass again; benchmark exits 1 because a serializable cell fails. Completed target cells are retained below. |
| `./ref-check --verbose` | Pass after code and SQL-admission changes; rerun with the final evidence landing. |

The full suite is **not claimed green**. The remaining acquisition assertion
is baseline-proven, not attributed to A1/C1; its cause remains open in
[a separate ticket](../../../issues/20260916-snapback4-acquisition-readiness-client-test-baseline.md).
The original fixture shutdown ticket is
[closed](../../../issues/closed/20260915-snapback4-navigation-model-fixture-server-econnrefused-under-load.md):
all three named cases passed on this quiet host, with no `ECONNREFUSED`.
Postgres's unbound replay stays
[open for C3](../../../issues/20260915-snapback4-postgres-replay-skips-the-id-binding.md).

## Idle paired measurement

Host: `450b`, Ryzen 5 3600 (12 logical CPUs), 128 GiB RAM, Ubuntu 24.04.
Rust 1.97.0; Node 24.13.1 for client checks; ordinary optimized harness
release build. PostgreSQL 16.15 was extracted into a user-local tools directory,
not installed as a system service. Each script owns a fresh socket-only private
cluster. SQLite 3.53.2 uses WAL/FULL. Postgres records `fsync=on`,
`synchronous_commit=on`, `full_page_writes=on`, and default shared buffers.

On then off, 200 timed iterations after 20 warmups; four writers × 100
mutations in each concurrency cell. `SNAPBACK4_EVAL_OUTPUT` was set to a new
file for each run. No other build/suite ran on the machine during measurement.
One-second `vmstat` samples before/after on were 98–100% idle; before/after
off were 100% idle; all sampled swap-in/out rates were zero. The first
cumulative-since-boot sample is excluded from those ranges. Runs completed
at 10:45:36 and 10:49:01 UTC.

Raw artifacts: [prefetch on](./results-20260916-w9-idle-prefetch-on.json),
[prefetch off](./results-20260916-w9-idle-prefetch-off.json).

| Median / target cell | Prefetch on | Prefetch off | C1 target |
| --- | ---: | ---: | --- |
| SQLite page | 58.430 µs | 110.107 µs | Same-run reference |
| Postgres page | 305.024 µs (5.22× SQLite; five calls) | 386.627 µs (3.51×; five calls) | ≤3× — **missed** |
| SQLite inbox | 322.748 µs | 329.400 µs | Same-run reference |
| Postgres inbox | 999.601 µs (3.10× SQLite; eight calls) | 2,515.301 µs (7.64×; 68 calls) | ≤3× — **missed** |
| Serialized, same counter | 446.48 commits/s | 448.66 commits/s | ≥5,000/s — **missed** |
| Serialized, disjoint counters | 461.33 commits/s | 458.07 commits/s | ≥5,000/s — **missed** |

All four serialized cells completed 400/400 mutations, zero transaction retries.
The SQLite four-writer cells completed 400/400 at 164.80–167.49 commits/s.
These are one same-host pair, not a cross-machine or before/after-C1 causal
claim. SQLite's page median itself varies between runs; do not conceal it by
using the faster reference from another run. Prefetch recovers the inbox's
call count and improves its observed median, but **all C1 targets are missed**.
The old loaded-host measurements are not used to calculate these results.

## Failed attempts and stress cells

The first Postgres-script attempt refused its stale local-package lockfile
before testing; the next exposed the stale replay assertion. Both were fixed
above, then the full script passed. The first idle prefetch-on benchmark at
`adb62150b` exhausted the existing serializable retry budget (`40001`) and
panicked before writing JSON. That attempt supplies no latency/throughput result.

After the reporting repair, the retained runs still fail:

| Mode | Serializable same counter | Serializable disjoint counters |
| --- | --- | --- |
| Prefetch on | Complete, 400/400, 436.10 commits/s, 446 retries | **Failed**, 300/400, completed per writer 90/100/100/10, 259 retries |
| Prefetch off | **Failed**, 200/400, 0/0/100/100, 94 retries | **Failed**, 208/400, 8/100/100/0, 110 retries |

The retained failures are recorded as `E_STORE: db error`; their JSON does not
retain a SQLSTATE, so the earlier `40001` is not silently attributed to every
later failure. No throughput is claimed for the failed cells. Final counter
assertions matched all successful commits. Follow-up:
[serializable stress failures](../../../issues/20260916-snapback4-postgres-serializable-benchmark-failures.md).
These failures and target misses remain visible; they were not tuned away.

## Retained log provenance

Logs remain under `/home/ccheever/sb4-w9-tools/` on `450b`, with a lead copy
under `/tmp/sb4-w9-evidence.nndUKm/`. The private clusters are stopped and
retained; the final on/off clusters are `/tmp/sb4-pg-eval.DKgwBA` and
`/tmp/sb4-pg-eval.IljslP`. Raw result JSON is committed above.

| Log | SHA-256 |
| --- | --- |
| `test-integrated.log` | `2e5f5adab5a67300cf11bce26bb4f986069668c94362c1dc486d96e95d732527` |
| `client-baseline.log` | `d0830ce19dceda6c82ed9ad5b8f803e743a1e99605539bea354e309453ef9544` |
| `test-postgres-integrated-final.log` | `00d043d4bde69e9f19cf311de8dfea0f580ac83f432cd2246b78839cfc6c3054` |
| `id-race-test.log` | `5e83292d2779b8cd02dd7eeaf3730da8f95a53d3006cf03f3045b9333ab604d2` |
| `bench-prefetch-on-retained.log` | `e2d44cf606d09d5d520f115b681a705fedf1f6a7673644c6be42f4b141522e37` |
| `bench-prefetch-off-retained.log` | `6bdb0f2214d1ef93ec58bb253918714be99696400bb368976d2dc774273fd2a2` |
