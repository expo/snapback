# QS round 0 — one-shot reads settle

Date: 2026-09-30. Branch: `sb4-intent/qs-one-shot-settles`.
Baseline: `9d03e946232b4017564f3e7c6aa87bd424ce8d58`, the checked-out main
snapshot from which this lane started. No push or publication.

`await client.query(op, args)` now returns `SettledRead<R>`: ready data or a
coded refusal. It cannot resolve to loading, and its `existence()` overload
cannot return `"loading"`. This addresses Calibration 27's M8 Insights trap
(the run log at `~/sb4-intent/cal27-evidence/run-log.md`, line 99, records the
one-shot workaround; its final `src/src/Insights.tsx` uses `useQuery`).

## Orientation and boundaries

Read Snapback 4's command sheet, NOT-DOING, journal, adopted rules, LLP 3000,
the relevant LLP 2000.000 constraints, LLP 3000.023 and LLP 3000.031, and the
current client card before editing. Used the repository `llp-orient` skill.
The user explicitly authorized the scoped `contract.ts` change from this lane.
The ready classifier and its pending predicate are unchanged. No core, wasm,
observation, hook, queue scheduling or retention policy was changed.

## Baseline reproductions

The main SDK was built before product edits and preserved in `/tmp/qs-main-dist`.
The causal tests use actual HTTP, wasm/process devices and `createApp` facades.
A Node module loader inserts an await at the existing last evaluator
continuation; it changes scheduling, not evaluator answers or publication
predicates. The facade hook runs after its real authority check. Deadline
tests change the clock after fetch and exercise the real deadline latch.

`main-reproduction-complete.log` records 41 cases: 24 pass, 17 fail against the
new expectations. Thirteen failures returned loading; four returned the old
online-only aggregate despite an admitted source write. `main-unavailable.log`
adds four causal local/facade failures returning loading. The initial
`main-reproduction.log` remains as evidence, but its expiry setup mocked the
clock after construction and did not exercise that boundary; the complete
log corrects that setup.

| Main scenario and returned value | Online | Wasm local | Process local | App online | App wasm | App process |
|---|---|---|---|---|---|---|
| Online-only count, link up | ready 1 | ready 1 | ready 1 | ready 1 | ready 1 | ready 1 |
| Same count, link down after first answer | E_OFFLINE | ready 1, stale | ready 1, stale | E_OFFLINE | ready 1, stale | ready 1, stale |
| Unremembered server read, link down | E_OFFLINE | E_OFFLINE | E_OFFLINE | E_OFFLINE | E_OFFLINE | E_OFFLINE |
| Write retires final continuation | loading | updated row | updated row | loading | updated row | updated row |
| Deadline passes between fetch and return | loading | reread row | reread row | loading | reread row | reread row |
| Mounted deadline withdrawal latched, then clock rolls back | loading | loading | loading | loading | loading | loading |
| Write during final facade authority check | n/a | n/a | n/a | loading | loading | loading |
| 32 mounted observations, eight read slots occupied | ready 1 | ready 1 | ready 1 | ready 1 | ready 1 | ready 1 |
| Held online-only count, link up | E_QUERY_HELD | loading | loading | E_QUERY_HELD | loading | loading |
| Held online-only count, link down | E_OFFLINE | loading | loading | E_OFFLINE | loading | loading |

The same-query offline rows are recorded separately in `main-view-matrix.log`.
`main-held-matrix.log` records both link states before asserting, so neither
offline result is hidden by the expected online baseline failure. Its two
online assertions initially expected data from a held query; that harness
mistake is ours. The recorded existing `E_QUERY_HELD` refusal is correct.
`held-matrix-corrected.log` verifies all six final cases with that expectation.
`baseline-loader.mjs` permits replay with `QS_MAIN_DIST` without replacing the
active build. The normal test suite uses the current build.

## Contract and implementation

The canonical published contract is on `guide client` beside `query`. The
decision is preserved in LLP 3000.023 §11. LLP 3000.028 §3.3 clarifies that its
one-server-invocation bound applies per discarded publication attempt: a ready
partial page never triggers another attempt to fill it or erase its cut.
Four publication rounds share a
single 30,000 ms timer starting at invocation, including queues, transport,
retry pauses and both app authority checks. Pauses are 25/50/100 ms. The
earlier limit wins; exhaustion returns retryable `E_QUERY_RETRY`. A suspended
JavaScript host resumes settlement when runnable. Closed/session/store
refusals take precedence. Adapter exceptions become `E_CLIENT`.

The helper calls the existing raw evaluator and its final publication fence.
The app facade shares that attempt and budget through function identity,
then runs the final raw fence and delivery approval synchronously with no
extra await before returning. It does not start another evaluation path or
give each inner raw query a fresh deadline. An ignored adapter abort cannot
hold the caller open or admit a late answer past the existing signal fences.

Retired or expired answers reread. `online only` falls back to the server
online. Offline, an allowed local/remembered answer remains available;
otherwise the call refuses `E_OFFLINE` in that round. A held query retains
its no-server rule. Observation slots alone do not block direct reads;
shared device/transport waits consume the same 30 seconds.

Admitted writes precede ready one-shot data. Complete local predictions can
answer immediately. An unobserved nonpredictable write blocks any ready
one-shot, and any unobserved write blocks server/composed/remembered data.
The baseline aggregate exposed why: the query names a materialized view but
the pending insert names its source table, so the old table intersection
could return the old count. The conservative one-shot custody barrier uses
existing outbox fields. It does not classify existence. Its cost is that an
apparently disjoint server read may refuse while a write remains unobserved.
Observations still follow their existing scoped publication rules.

`CLIENT-AND-OPERATIONS.md` now shows the settled type and removes the loading
branch after `await` in `profileScreen`; partial data gets an explicit retry
state. README points to the card. The guide witness's awaited examples already
assert ready data; loading examples on observed reads remain valid. The client
card is 1,196 words / 113 lines, inside its 1,200-word / 130-line budgets.
`local.ts` remains 1,500 lines.

## Tests and evidence

The new causal suite covers all six client/facade tiers. The bounds suite
asserts exactly four retired publications, one shared 30-second timer,
ignored abort, occupied device queues, terminal close/sign-out, held authority
and permitted offline memory. It accelerates the actual production deadline
callback to 80 ms after asserting its configured 30,000 ms delay, and uses an
independent two-second watchdog. It does not replace settlement logic.

The local model runs seed `0x515330` on wasm and process devices: 12 sessions
per tier, 18 random event choices per session, plus initial writes and a final
close with an outstanding read. Its separate admitted-value oracle asserts
that ready item data contains every write admitted before that query started,
never an invented future value, and never loading. It interleaves real writes,
link changes, final-continuation writes, expiry and closes, and asserts event
coverage. Targeted tests additionally cover unobserved nonpredictable writes
and aggregate source writes. The type test rejects loading assignment and
comparison of one-shot existence with loading while preserving observed
loading.

Final targeted results: `affected-final-core.log` 123/123,
`following-final.log` 8/8, corrected acquisition cases 11/11 in
`custody-final.log` (its one remaining page test is corrected and passes in
`page-ready-final.log`), `view-matrix-final.log` 6/6,
`held-matrix-corrected.log` 6/6. The whole guide passes 105/105 in
`guide-final.log`. Earlier failed runs remain in this directory; the failure
ledger names and classifies every failed test, including harness mistakes.

The final integration evidence covers every full-run failure:

| Evidence | Result |
|---|---|
| `integration-final-1.log` | 283/285; the two failed results are the typing scenario and its parent, corrected below |
| `social-renewal-final.log` | 12/12, including the formerly failing typing renewal |
| `models-final-1.log` | 11/11; 300 search seeds and 300 mixed-evidence histories on **each** wasm/process tier, zero failed seeds, unchanged coverage requirements |
| `follow-window-corrected.log` | 24/24, including all eight original causal gate cases and four browser/Worker adoption cases |
| `react-offline-final.log` | 10/10 |
| `full-followups-final.log` | 7/7: both replay cases, await census, expired manifest and all three expiry recovery variants |
| `search-publication-final.log` | 4/4 after strengthening settled-page equality |

The six exact-deadline cases in the integration rerun exercise the real
30-second timer while their device recovery is held; each refuses without
restoring expired memory. The new fast bounds cases separately isolate that
same production callback under an independent watchdog. Three older report
tool files changed because the current `follow-window.test.mjs` imports them
as live fixtures; their historical report prose was not rewritten.

The full suite was invoked **once** with
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh`.
Exit 1; exact summary:

```text
== 1 failure(s) in 1513 s
   client tests
```

All other 12 stages passed, including Rust, the whole guide, builds, budgets,
fixture wrappers (9/9), app typechecks and serial client models (79/79, full
counts). The client stage reported 5,402 tests: 5,342 pass, 50 fail, ten existing
skips, zero cancellations. Those 50 results include 47 leaf/file failures and
three failed parent tests. **Ours: 50; baseline: 0; environmental: 0.** This
does not turn the failed full run into a passing qualification. The inherited
nominal 60-second suite budget also remains exceeded.

`full-suite-failures.json` lists every leaf/file failure; `FAILURES.md` includes
all failed runs. `full-suite-search-seeds.json` preserves the failed seed sets
and coverage from both search model hosts; the complete traces remain in
`full-suite.log`. Final affected reruns keep the original model counts and
coverage requirements.

One failure is an explicit worker intervention: the old Following window
fixture froze every positive timer and advanced only zero-delay turns. Query
retry pauses therefore could not run. The worker remained alive beyond its
30-second test guard and was sent SIGTERM at **615.70 seconds**; only that
worker was stopped, and the original suite continued through the serial
models. The intervention is recorded separately. No orphan process using this
checkout's binary remained. The corrected fixture keeps real query timers
runnable while the original transport gates control execution/application;
all 24 Following tests, including browser/Worker adoption, pass afterward.

Other migrations preserve the original semantic assertions: expired or retired
direct reads now reread or refuse; search tests allow up to four publication
rounds but still assert exact rows, cursor resets and authorization; the
generation oracle still forbids every retired observation and now requires
E_OFFLINE for its one-shot during the deliberately failed adoption. The
delivery await census classifies the new read-only waits; delivery fault
recipes are unchanged. Prediction tests require refusal ahead of unobserved
nonpredictable writes. The expired-response fixture renews its four-second
row before testing deletion. React and typing-browser setup now wait for the
existing reconnect probe before testing renewal/observation retries; a
diagnostic captured the formerly assumed-online arm still offline.

`suite-start.diff` and `suite-source-sha256.json` bind the initial source.
**Product implementation stayed unchanged throughout the full run and its
follow-ups.** Three test files (acquisition, page-ready, one-shot) and a reference
signature in CLIENT-AND-OPERATIONS changed during Rust execution, before client
tests started. Later failing test expectations, fixtures and the await census
were corrected during/after client execution. Final source hashes identify
those edits; this is a failed full run plus final affected evidence, not a
claim of an unchanged-source green full suite.

## Build and size

Linux, Node 24.13.1, Bun 1.3.14, 96 available CPUs. Dependencies installed with
the frozen lockfile. Cargo test artifacts warmed without executing the suite.
The local fleet document was absent, so this work used the available machine.

Wasm: **1,978,828 B raw; 593,225 B gzip**. The unchanged ratchet is **593,719 B**,
leaving **494 B**. No wasm code or budget increase. `wasm-build.log` and the
full-suite build record the measurement. SDK typecheck/build, docs budget and
reference validation are included in the evidence.
