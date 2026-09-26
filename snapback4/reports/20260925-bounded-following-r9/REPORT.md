# Lane U round 9: recover watches after a local reply expires in flight

2026-09-25. Based on `fc0f2d782`, branch `sb4-intent/u-bounded-following`.
Read both requested U-r8 reviews (Astra and Grok, READY WITH CHANGES).
Implementation commits: `9e3b1cc76` (bounded reobservation) and `59e57c47f`
(withheld retry deadline). No push or publication.

## Implementation

The same numbered publication procedure now re-evaluates an expired local
candidate **once**, using the current clock and original arguments. The expired
snapshot is never published. The new observation goes through the existing
local-result policy, including speculative withholding and freshness checks.
Session/incarnation checks run after the additional await and before publication.

If the retry also expires in flight, the result is loading and its watch is
marked dirty. The existing `rerun` finally block in `local.ts` then schedules
another observation even though the expired timer is cleared. The retry's raw
expiry fact is preserved when its value is withheld, so a second speculative or
unavailable snapshot cannot silently lose this rerun. A withheld retry also
keeps a future deadline, so the existing watch timer can reobserve it when
that deadline is reached. No changes to timers or `local.ts` are necessary. There is at most **one additional local evaluation per
publication attempt**; no internal unbounded retry or additional server request.
The engine's `note_expiry` only records deadlines strictly after that evaluation's
`now`, so a normal retry observes the expired row's absence.

External server/composed and remembered deadlines keep their prior behavior.
The whole-page remembered row-expiry limitation is explicitly out of scope per
the round-9 brief and remains tracked on origin/main as
`issues/20260925-snapback4-remembered-answer-row-expiry.md`.

## Files

Paths are relative to snapback4/.

| File | Change |
|---|---|
| `packages/snapback4/src/local-query.ts` | Add the bounded local expiry retry, preserve the refreshed snapshot's expiry fact, dirty a watch after a second crossed deadline, and keep await/session checks within the numbered procedure. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | State one local retry and watch rerun after a second expired reply. |
| `packages/snapback4/test/prediction-routing.test.mjs` | Update delayed-local tests to require the re-evaluated live data, for complete/partial queries and watches. Test the one-retry limit and dirty flag for data/speculative/unavailable second replies. Add sign-out, close and incarnation changes during retry, and future-deadline preservation for withheld retries. |
| `packages/snapback4/test/retained-history.test.mjs` | Update one-shot row/permit expiry expectations; add both wasm/process watch cases. Assert the first engine clock is T-1, the retry clock is T, and the first post-deadline notification is the valid result. |
| `reports/20260925-bounded-following-r9/mutations.py` | Reproducible watch-expiry bypass, removed retry, missing dirty flag, unbounded retry and dropped future-deadline mutations; always restore the built module. |
| `reports/20260925-bounded-following-r9/*.log.gz` | Focused, mutation and full-suite evidence. |
| `JOURNAL.md` | One dated append-only entry. |

## Tests and the five rules

| Rule | Evidence |
|---|---|
| 1. Session/incarnation | New retry interleavings return E_AUTH/E_CLOSED/loading instead of private data; the existing real-client publication-session suite remains. |
| 2. Known complete local wins | Complete and partial delayed-local tests now return the post-deadline local value, without server traffic. |
| 3. Engine withholding | The retry uses the same local evaluator and unavailable-result policy. A second expired unavailable snapshot loads and dirties its watch; existing floor/meter/native tests remain. |
| 4. Unknown available results | Non-speculative retained rows recover. Speculative retry values remain withheld; their expiry still marks a watch dirty if crossed, or schedules its future wakeup. Existing composition/placeholder tests remain. |
| 5. Publication fence and expiry | Real wasm/native watches cross row/permit deadlines after evaluation. The expired first snapshot is never delivered. A valid retry is published; another expired reply returns loading and leaves the watch runnable. |

The real-device cases are `MQ expiry local left`, `MQ expiry local watch left`,
`MQ local permit`, and `MQ local permit watch`, each on wasm and the native
process device. The retained history has 25 rows at T-1 and **24 rows at T**.
The permit-backed secret is private at T-1 and **null at T**, while the remaining
composition stays available. Tests assert the **first** post-deadline notification
rather than waiting through incorrect intermediate publications. They assert
exactly two local calls and the new future/null deadline. The first engine
request is explicitly T-1, never a clock already beyond the deadline.

No new language form or refusal code. The existing composed reads continue to
compile and run, for example:

```quarry
query both():
  return {left: messages['left'] last 50 by byTime, held: messages['held'] last 50 by byTime}
query permitBoth():
  return {left: messages['left'] last 50 by byTime, right: messages['held'] last 50 by byTime, secret: secrets['secret']}
```

## Scope and qualification

No design deviation. No engine, authorization, schema, acquisition, storage,
public-contract, package-version or ceiling change. No new skip, reduced test
count, increased timeout, push or publication. The existing dirty-watch path is
reused. All round-9 findings are resolved; the separately tracked remembered
row-expiry issue is unchanged. No new acquisition/inventory measurement: the
historical 2.387x result and unmet 5x target remain in the earlier reports.

Frozen dependency install and package build passed. Initial focused run:
17 passed, zero failures. One development command error (ours): invoked the
broader test command from the repository root with snapback4-relative paths.
Node reported that it could not find the test files before running any test;
reran from snapback4. No product test failed in that attempt.

The first full-suite attempt was intentionally interrupted for a follow-up:
a withheld retry must also preserve a future deadline. No test failure had
been reported. The suite was rerun from the start after that correction. A
process-discovery assertion initially found shell subshells as well as the
suite root and stopped before sending any signal; the corrected cleanup
targeted only this lane's suite process tree.

Final affected client run: **186 passed, 0 failed, 0 skipped**, 76.630 s, across
prediction-routing, retained-history and query-publication-session. Reference
audit: `ref-check: ok — 509 LLP docs, 9296 refs in 26161 files, 0 errors, 0 unchecked`.

| Mutation | Result |
|---|---|
| Add `&& watch === undefined` to expiry rejection | All four wasm/process watch deadline tests fail. |
| Remove the local expiry retry | All eight real query/watch row/permit deadline tests fail. |
| Remove the dirty flag | The three second-expiry watch cases fail; the three query controls pass. |
| Allow unbounded expiry retries | All six second-expiry cases fail on an attempted third device call. |
| Drop the retry's next deadline | The speculative-retry deadline test fails; the unavailable-result control passes. |

Each failure was inspected as an assertion failure for its intended behavior.
Mutation failures are expected evidence, not failures of the unmodified product.
The built module is restored after each mutation; the full suite rebuilds it.

Full-suite command, from snapback4/ with the required toolchain on PATH:

```sh
taskset -c 0-15 env SNAPBACK4_RUST_TEST_PROCESSES=8 SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 bash scripts/test.sh
```

This uses the existing serial-client mode on the shared host. Every suite,
seeded sequence count, timeout and existing skip remains unchanged.

The baseline log ends `== 1 failure(s) in 276 s` (cargo test); it is not used as
a waiver. Final result, exit 0:

```text
== 0 failure(s) in 1549 s
```

Rust tests passed in 188 s. Client tests: **1,686 passed, 0 failed, 10 existing
skips**, 1,115 s. All **78 model tests passed**, 231 s, including online and
local 5,000-sequence I1–I13 sweeps. Full-suite failures: **none** (ours,
baseline or environmental); no waiver. The earlier interrupted attempt has
exit 143 and is not claimed as a completed suite.

Unchanged tracked issue reproduction: remember a page containing a permanent
message and a typing row expiring at T, then query offline at T. The earliest
nextExpiry withdraws the whole remembered answer, including the permanent
message. The round-9 brief explicitly leaves that issue; no expiry guard was
relaxed here.
