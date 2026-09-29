# Failure accounting

The logs contain twelve failed test executions: eleven baseline reproductions
across three fixture defects and one unsuccessful correction candidate of ours.
There are no environmental test exemptions. [failure-executions.json](./failure-executions.json)
lists every execution, exact duration, polling limit and test watchdog.

## Pre-existing remount fixture race (baseline)

The untouched full baseline passed, but the subsequent two-slot trial exposed
`wasm: keep remount lifetime, isolation, last subscriber and sign-out` in
`packages/snapback4/test/keep-device.test.mjs`. The unchanged test then failed
outside the suite scheduler on focused repetition 6. Classification: **baseline
test-fixture race**, repaired in this lane; not an environmental exemption.

| Observation | Whole-test duration | Failure | Existing limits |
|---|---:|---|---|
| Two-slot full-suite trial | 11.322896 s | `second key ready` | 1,000 polls separated by 10 ms; 30 s test watchdog |
| Unchanged focused repetition 6 | 11.698945 s | `second key ready` | Same |
| Instrumented device trace, repetition 1 | 11.720116 s | `second key ready` | Same |
| Instrumented wire trace, repetition 3 | 11.653564 s | `second key ready` | Same |

These are polling-assertion failures, not Node's 30-second test timeout. The
nominal polling allowance is ten seconds plus callback/scheduling time. Five
unchanged focused repetitions passed before the sixth failed. The traces
repeat the same defect; they are not four distinct failing test cases.

The key-isolation phase requested an unsupported `other` argument and an
undeclared `different` operation. It closed those `keep: true` handles while
holding reads, then released the shared gate before testing another key. The
live, lingering probes could subsequently complete with native `E_INPUT` and
HTTP 404 `E_OP`. The device trace records the argument refusal; the wire trace
records the repeated missing-operation refusals, an offline client and a
second watch still loading. Their ordering contaminated the later lifecycle
assertions. This test's purpose is key isolation, 30-second remount lifetime,
last-subscriber behavior and sign-out, not refusal injection.

The correction makes the distinct keys valid fixture reads: `secret` accepts
the optional `other` boolean and `different` is a declared query over the same
row. Every original assertion, the deterministic lifetime-clock advances and
both wait limits remain. Real refusal-withdrawal cases in the same file remain.
The argument-only, operation-only and combined candidate each passed 30
focused repetitions. The combined complete file passed 31/31. Product code
was unchanged throughout the diagnosis.

Focused diagnosis used CPUs 20–29 while the full trial remained confined to
0–9. Instrumented copies lived under the worktree's ignored `target/mt-tools/`;
the full trial used the original test. The raw logs and captured trace JSON
are retained beside this record. Final qualification results are in REPORT.md.

## Replacement notification sampling race (baseline)

The first complete checked-out file run after the remount correction passed
30/31 and exposed `process: keep=undefined across refusal withdraws changed
inputs and replaces the old answer`. This also reproduced against a copy of
the unchanged baseline test, so classification is **baseline test sampling
race**, repaired here, not an environmental exemption.

| Observation | Whole-test duration | Failure | Existing limits |
|---|---:|---|---|
| Complete file after the remount-only correction | 11.412844 s | `replacement answer` | 1,000 polls separated by 10 ms; 30 s test watchdog |
| Unchanged focused repetition 7 | 11.332733 s | `replacement answer` | Same |
| Instrumented baseline repetition 3 | 11.321598 s | `replacement answer` | Same |

The trace's existing notification log contains **two `HIDDEN` replacements**,
followed by loading as the other live watches invalidate again. The polling
sample missed those notifications. The fixture now records the identical
replacement predicate in its already-existing subscription, and waits for
that captured event under the same polling limit. It still records every
notification and applies the original withdrawal, lingering-watch, remount,
replacement-identity and old-answer assertions. No stable-refusal or latency
requirement was part of this case, and none is added or removed. The trace is
`keep-refusal-trace.json`; all before/final logs are retained.

The corrected refusal case passed 30 focused repetitions
(`keep-refusal-fixed.log`). The complete final fixture then passed 31/31
in 29.837 s (`keep-device-final-full.log`), before the three full-suite
qualification runs began. The full runs use that same source.

## Incomplete synthetic query evidence (baseline)

After one green full run with the first two corrections, its repetition failed
`process keep=true facade=false: adoption drops active and lingering answers
before a held read lands` in the otherwise unchanged `keep-reset.test.mjs`.
The unchanged whole file reproduced it on repetition 2. Classification:
**baseline query-response fixture race**.

| Observation | Whole-test duration | Failure | Existing limits |
|---|---:|---|---|
| `trial-10cpu-reset-race`, complete suite | 3.314849 s | Final new-answer wait, original line 78 | 600 polls separated by 5 ms; 20 s test watchdog |
| Unchanged whole-file repetition 2 | 3.285757 s | Same | Same |
| Failure-only snapshot probe, whole-file repetition 41 | 3.293720 s | Same | Same |
| Detailed trace retry, whole-file repetition 70 | 3.304219 s | Same | Same |

These are polling-assertion failures, not the 20-second test timeout. The
isolated case passed 100 repetitions. Initial detailed tracing passed 30
whole-file repetitions, and a one-CPU diagnostic passed 50. The first failure
snapshot (`keep-reset-state.json`) had the active watch at `"new"` and the
remount loading. The later full trace (`keep-reset-trace-retry.json`) captured
the reverse and repeated alternating `/q/marker` and `/q/idle` calls: the two
queries invalidated one another instead of settling together. Adoption had
committed, and the read gate was open.

The fixture returned `{ data, complete: true }` for both literal queries.
Unlike the real server's `QueryReply` in `serve.rs`, it omitted `tables` and
`seq`. LLP 3000.029 §8 distinguishes unknown dependencies from an explicit
empty footprint, and cutless evidence from a known replica cut. These replies
injected conservative cross-query authority invalidations whenever adoption
ordering sent the reads through HTTP fallback. This reset test did not intend
to inject unknown dependency evidence.

The final correction returns `tables: []` for these dependency-free literals
and `seq: 10`, matching the fixture's sync watermark. It changes no assertion,
test ordering, gate, clock or timeout. The corrected whole file passed **100
repetitions** (`keep-reset-evidence.log`); the actual checked-out file then
passed **36/36 in 1.893 s** (`keep-reset-final-full.log`).

### Rejected test-only candidate (ours)

An early hypothesis blamed the intermediate remount's lifetime. Moving the
remount after reset completion passed 100 whole-file repetitions, but was not
selected because it moved the original early withdrawal assertion. A second
candidate preserved that assertion and reacquired the remount after completion;
it failed on repetition 75 at the same final predicate in **3.291474 s**, with
the same 600 × 5 ms polling limit and 20 s watchdog. Classification: **ours,
unsuccessful correction of the baseline fixture**. It was never applied to the
checked-out test. See `keep-reset-remount.log`. Simple adoption-pause and
forced-server diagnostic probes each passed ten before/after repetitions and
did not reproduce the race; they do not support a fix claim. The later full
trace replaced the lifetime hypothesis with the missing-evidence diagnosis.

## Other command diagnostics (ours)

Read-only orientation commands initially tried absent helper/build-script
paths and guessed LLP names; file discovery corrected those lookups. The
fresh worktree's missing dependencies and uninitialized LLP submodule were
prepared locally before testing. Resource sampling can see an uncreated scope
on its first poll; later samples establish its limits. None of these is a
failed product test or an environmental test exemption.

The suite's expected release-guard compiler refusal and the models' injected
`E_AUTH` messages are passing negative checks, not unexpected failures. No
test timeout, assertion or model count was relaxed.
