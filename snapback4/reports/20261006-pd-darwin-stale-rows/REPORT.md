# PD — Darwin stale-row cleanup regression

2026-10-06; Apartment mini (`MacMini-Apt101-M5-A`), macOS 27.0.1,
Darwin arm64; Node **24.18.0**, Bun **1.3.12**. Base
`9bcf6cfb630ea1947ccbfd2b397c5c1c884cd2bf`, branch
`sb4-intent/pd-darwin-stale-rows`.

The runner already discounts stale enumeration rows correctly on Darwin.
The regression injected the same stale table into Darwin's independent
identity reread and counted those extra calls as cleanup enumerations.
This is a fixture correction under the task's explicit exception.
**Production runner code, including the Linux path, is unchanged.**

## Governing context

Scope: `test-file-runner.test.mjs`, `run-client-tests.mjs`, and
`test-processes.mjs`. The governing current document is
[LLP 3000 §7, publication suite under contention](../../../llp/3000-snapback4.explainer.md#publication-suite-under-contention).
Its QF7/QF9 rules retain keeper-only group cleanup and fresh, scoped Darwin
identity classification; PS Round 2 requires two completed empty snapshots
50 ms apart and completed evidence after deadline expiry. Failed inspection
remains fail-closed. The [PS report](../20261005-ps-inspection-timeout/REPORT.md#round-2--asynchronous-inspection-and-completed-cleanup-evidence)
qualified Linux and injected Darwin cases, without a native Darwin run.

No new design decision or ownership boundary is needed. LLP 3000 now records
the fixture distinction, and JOURNAL records this lane. Remaining platform
verification is the reviewers' Linux run; no additional skill hand-off.

## Diagnosis, with code

At the base revision, the relevant paths are:

- [`test-processes.mjs`](../../scripts/test-processes.mjs), lines 202–209:
  `ownedProcesses` first calls `inspect({group})`, then rechecks each living
  candidate with `identity(row.pid, {group, inspect})`. Only a living current
  member of the owned group enters the returned list.
- The same file, line 180: Darwin identity calls **that same injected
  inspector**, now with `{pid, group}`, and selects the requested PID after
  the new table's scope classification. Linux instead reads `/proc/<pid>/stat`
  at lines 183–193; the injected inspector cannot replace that read.
- The original test, lines 431–440, counted **every** inspector call and
  returned `before` whenever the real table was empty after call two. Darwin's
  first identity reread was call two; `stop`'s diagnostic enumeration was
  therefore already call three. From then on, both enumeration and identity
  checks repeatedly received the pre-cleanup living keeper/helper rows.
- `cleanupProcesses`, lines 225–233, correctly treats those fabricated live
  identities as remaining members, resets `empty`, and eventually refuses
  with `TEST_FILE_LEAK: live group after cleanup deadline`. It cannot use the
  real table discarded inside the hook. `live(record)`'s start comparison at
  lines 196–198 is not on this call path; comparing starts of two identical
  replayed rows would not repair the fixture either.

The requested native reproduction failed with **47 !== 2** in **5.504 s**
([baseline](./baseline.log.gz)). A diagnostic replay reproduced 47 counted
empty hook calls while signal-zero checks showed both captured PIDs absent.
Its first stale diagnostic enumeration and every subsequent identity read
returned the old living records. This was an additional cleanup deadline
error, hidden by the already expected final `TEST_FILE_LEAK` verdict.

The same diagnostic driver, with **only enumeration calls made stale**, used
the unchanged runner and completed in **1.005 s**: four enumerations total
(discovery, stop diagnostics, two cleanup confirmations), two empty cleanup
enumerations, and no `inspectionFailure`. The earlier live leak still failed
the file. See the [driver](./trace.mjs.gz), [original-hook trace](./trace-replay-all.json.gz)
and [enumeration-only trace](./trace-enumeration-only.json.gz). Trace records
contain only this fixture's process rows.

## Correction and refusal checks

The test now returns the actual fresh table whenever `options.pid` is
present. Enumeration calls alone advance the phase counter and receive the
captured stale rows. This preserves the intended fault on both platforms:
enumeration is stale while independent per-PID evidence reflects exit.

Assertions require all of the following:

- An actually observed living non-keeper leak, `passed === false`, and final
  `TEST_FILE_LEAK`.
- No inspection/deadline error; hitting the cleanup deadline cannot pass.
- Exactly **two** consecutive empty enumerations and **two total** stale
  injections, so an intervening reset cannot be hidden by the final count.
- At most `2 * (1 + staleMemberCount)` inspector calls from the first empty
  enumeration through confirmation: two enumerations plus one identity
  reread per stale member in each. On this Mac the bound was exactly six.
- A final real group inspection with no living member.

The test also exercises Darwin's identity branch on Linux, following the
existing platform-injection pattern in `test-processes.test.mjs`. On Darwin
it runs once; on Linux it runs native Linux plus injected Darwin. Real `ps`
output retains its host platform's routing parser, even when the identity
branch is overridden. Linux `/proc` behavior is untouched.

Two isolated copies under the ignored target directory verified that this
is not a vacuous test. Replacing the identity recheck with `current = row`
fails on the unexpected deadline error
([mutation log](./mutation-trust-stale-row.log.gz)); accepting just one empty
snapshot fails **1 !== 2** ([mutation log](./mutation-one-empty-snapshot.log.gz)).
Neither mutation touched the production source or the concurrent client pool.

## Verification on the mini

All commands put `/Users/ccheever/.volta/tools/image/node/24.18.0/bin` first
on PATH. The ambient Homebrew Node is 26 and was not used for verification.

The requested reproduction passed **five times**, zero skips:

```sh
cd snapback4
node --test --test-reporter=tap \
  --test-name-pattern='stale exited members do not reset empty snapshots' \
  packages/snapback4/test/test-file-runner.test.mjs
```

Final-revision durations under the active client pool:
**1.212 / 1.131 / 1.161 / 1.186 / 1.179 s**. Every run recorded
two empty/stale enumerations, six reads from first empty through confirmation,
and two stale members. [Final runs 1–5](./reproductions-final.log.gz).
The [initial five repetitions](./reproductions.log.gz) also passed.

The complete runner/process test pair passed **93/93**, zero skips, in
**53.323 s** on the final revision under the active pool
([final log](./focused-final.log.gz)); the initial run also passed in
**50.949 s** ([initial log](./focused.log.gz)):

```sh
node --test --test-reporter=tap \
  packages/snapback4/test/test-file-runner.test.mjs \
  packages/snapback4/test/test-processes.test.mjs
```

This covers live persistent groups, late empty confirmation, timeout recovery,
failed and malformed inspection, unrelated PID reuse, owned-group cleanup,
keeper death and native Node test-result semantics.

This fresh worktree installed locked dependencies and built its own artifacts:
`bun install --frozen-lockfile`, `cargo build --workspace --quiet`,
`bash scripts/build-wasm.sh`, and the client package build. Builds used
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT` and three Cargo jobs
(inherited `CARGO_PROFILE_DEV_DEBUG=0`, `CARGO_PROFILE_TEST_DEBUG=0`).
Wasm was **2,117,610 B raw / 639,941 B gzip**, at the existing budget.

The pool initially exposed a missing fresh-tree prerequisite:
`event-slot-capability.test.mjs` and `event-slots.test.mjs` both refused the
absent `target/event-slots-traces.json` before executing their tests. Generated
the native fixtures with `cargo test -p snapback4-device --test event_slots_trace
--test unicode` (**3 passed**, [log](./device-oracles.log.gz)) and
`cargo test -p snapback4-core --test unicode_fold` (**2 passed**,
[log](./core-oracles.log.gz)). Rerunning both affected client files through
`node scripts/run-client-tests.mjs 1 files ...` passed **2/2 files, 48/48 tests**
([log](./event-slots-recheck.log.gz)). This prerequisite repair changes no source.

The whole canonical client pool completed **323/323 files** in **1,466 s** at **six slots**
(18 available CPUs), with **6,451 passes, two prerequisite failures and six
declared skips** ([complete log](./client-pool.log.gz)). Its exit was **1**
because of the two absent-trace module-load failures above; this is not
reported as a single green pool run. Together with their 48-test successful
recheck, all 323 client files have passing outcomes: **6,499 passing tests,
six declared skips, no unresolved failure**. No unrelated file was retried.
The runner/process files also passed inside this pool (55.416 / 34.154 s);
the stale-row case still recorded two empty confirmations and six Darwin
reads. Browser-navigation, replacement-fixture and the full worker-regressions
file passed, covering the other callers of the runner/identity helpers.

Both default-count serial models then passed **2/2 files, 79/79 tests**,
zero skips, exit **0** ([log](./models.log.gz)):

```sh
node scripts/run-client-tests.mjs 1 models \
  packages/snapback4/test/app-session-model.test.mjs \
  packages/snapback4/test/online-client-model.test.mjs
```

`./ref-check --verbose` reports **529 LLPs, zero errors and zero unchecked
references** ([log](./ref-check.log.gz)). `git diff --check` passes. No full native suite or publication
dry run is claimed; the reviewers retain native Linux verification.

All work stayed in this worktree on the mini. No fleet host was contacted,
no simulator or X27R worktree was used, and only this lane's launched processes
were stopped. Nothing is pushed or published.
