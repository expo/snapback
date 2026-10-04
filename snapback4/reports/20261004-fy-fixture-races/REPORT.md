# FY: client fixture crash and PID races — 2026-10-04

Base: `ce9bef594abeaa9d01b65dda0db218cbe3678f01`, branch
`sb4-intent/fy-fixture-races`. Test-only changes; nothing pushed or published.
Work stayed in this eb1000 worktree and the explicitly permitted Apartment
mini scratch directory. No other worktree, publication host or simulator was used.

## Findings and fixes

**Scheduled job.** Startup admits the schedule before constructing maintenance,
but bulk maintenance can execute immediately after the listener banner. The
old fixture's one-second-tick comment was stale. Neither `kill(SIGSTOP)` nor a
queued database snapshot acknowledged a stopped process. The final queued
assertion was already **after SIGKILL exit and before restart**; it was not a
restart-order mistake.

The existing `SNAPBACK_NODE` override now supplies a synchronous version probe
for an explicit, unused worker. That probe runs after real schedule admission
and before maintenance construction; it sends SIGSTOP to its parent before
returning its version. The fixture witnesses `ps` state `T`, reads one durable
queued job with zero chunks/writes, witnesses SIGKILL exit, and checks the
entire unchanged job record before ordinary restart. The worker never starts.
The same job then completes one chunk/write, increments `runs` once, remains
done after a second restart, and leaves exactly one queued outbox effect.
No production hook, synthetic job row or continuation edit was added.

**Watchdog.** `until` already delegates to `waitFor`/`withHangGuard`, whose
`TEST_HANG` rejects with fixture diagnostics. An injected timer proved this;
there was no silent timeout to repair. `alive(pid)` used `kill(pid, 0)`, ignored
Linux zombies, and swallowed every inspection error. A dead/zombie helper's
PID can subsequently name a live replacement; an inspection error can also
produce a false death. Zombies do not revive. Product cleanup sends group
SIGKILL before reaping its retained worker leader and does not restart helpers.
SU's original run lacks process birth records, so its exact cause cannot be
assigned retrospectively.

The three signal variants now capture both living identities before signaling
and use the existing `identity`/`live` helper: Linux start ticks or Darwin
`lstart`, with zombie handling and fail-closed inspection. A helper readiness
handshake replaces the 150 ms guess. Both descendant-death assertions remain.
Failure cleanup closes the owned watchdog's stdin and awaits its exit; this
fixture bypasses the generic stale-PID fallback. Other tests retain their
existing helpers to keep FX/DG integration small.

## Mechanism controls

- Unmodified baseline: the scheduled-job test passed in isolation, matching SU.
- Baseline copy, delayed SIGSTOP: maintenance reached `done` before the first
  queued assertion. A separate synthetic SIGCONT plus 2.5 s pause after the
  queued snapshot reproduced `done !== queued` at the post-exit, pre-restart
  assertion. These deliberately widen the unacknowledged-stop interval; they
  are mechanism demonstrations, not a claimed natural replay of SU's run.
- Fixed fixture: a 2.5 s pause after witnessed stop still passed all recovery
  and outbox assertions.
- Original `alive`/`until`, simulated original zombie then live reused PID:
  the wait returned and the immediate next liveness check returned true.
- Fixed identity: a live PID with a different recorded start stayed dead on
  repeated checks. A present PID with injected EACCES threw
  `TEST_PROCESS_INSPECTION`; an accelerated original wait rejected `TEST_HANG`.

No product defect was found in either investigation.

## Verification

| Host / check | Release activation | Worker regressions |
| --- | --- | --- |
| eb1000, CPUs 72–79, two confined CPU hogs | 30/30 files; 18 tests/run | 30/30 files; 61 tests/run |
| Apartment mini, `100.64.36.16`, Darwin 27 arm64 | 30/30 files; 18 tests/run | 30/30 files; 61 tests/run |

All 120 whole-file runs passed with zero skips/cancellations. Six files ran
concurrently per host, each with its own temporary directory; the two Linux
hogs stayed near 100% CPU apiece and inherited the same affinity. Each command
was `node --test --test-reporter=tap packages/snapback4/test/<file>.test.mjs`.
The archived driver records the exact commands, paths and results. Worker-file
runs take 445–459 seconds because three existing negative cases each consume
the unchanged timeout.

`taskset -c 0-47 bash snapback4/scripts/test.sh` passed in **1,957 seconds**:
all Rust targets and doctests; all 311 client files (6,187 passed, 11 skipped);
79/79 model tests; 9/9 fixture tests; builds, typechecks and budgets. The wasm
artifact remains 639,750 B gzip under 639,887 B. `./ref-check --verbose` passed
with zero errors, as did `git diff --check`.

[Control logs and injection sources](./controls.log.gz),
[all repetition logs and driver](./repetitions.log.gz),
[repetition summary](./repetitions-summary.json),
[full suite log](./full-suite.log.gz),
[full suite summary](./full-suite-summary.json), and
[base/fixed source hashes](./source-sha256.json) retain the evidence.
The mini's test-file hashes matched the local fixed files exactly.

Both hosts use Node 24.13.1 and Rust 1.97.0. The mini binary was built from
unchanged base sources inside `/tmp/sb4-fy-fixture-races.Z1v1cq`; only the two
permitted JavaScript test files were executed there. The Linux full suite uses
`CARGO_INCREMENTAL=0`, `CARGO_PROFILE_DEV_DEBUG=0`,
`CARGO_PROFILE_TEST_DEBUG=0`, and `CARGO_BUILD_JOBS=12`.

Both private scratch trees were removed after saving evidence; the Linux
repetition driver stopped and reaped its two hogs. Sampled worktree plus scratch
use stayed below 15 GB, within the 40 GB limit. Build caches remain in this
worktree. No office M1, publication M5, other lane worktree or simulator was used.

## Design context

Scope: the two fixtures and their local helpers. Governing context is
[LLP 3000 §7](../../../llp/3000-snapback4.explainer.md#publication-suite-under-contention)
(state-based waits, hang diagnostics and owned-process custody) and
[LLP 3000.011.005.000 §4](../../../llp/3000.011.005.000-qualify-the-built-application.rfc.md#4-deployment-restore-and-provider-boundaries)
(real deployment/restart boundaries; in `llp/current/`). These remain
process-crash tests on WAL `synchronous=NORMAL`, with no power-loss or external
provider claim. No new design decision or LLP is needed; the journal and the
two SU-origin tickets carry the correction. LLP hand-off: none.
