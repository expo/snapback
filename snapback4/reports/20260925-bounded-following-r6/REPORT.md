# Lane U round 6: engine provenance and remembered authorization expiry

2026-09-25. Implements the round-6 refinements after reading both delta reviews:
`~/sb4-intent/reviews/u-r5.astra.md` (NOT READY) and
`~/sb4-intent/reviews/u-r5.grok.md` (READY WITH CHANGES).
This supersedes round 5's structural placeholder heuristic. The five numbered
rules, local-commit invalidation fence and authoritative refusal semantics remain.

Implementation commits: `e4a3ae5c9` (engine/device facts), `1049dd31e`
(client routing, expiry, reference and regressions), `6a7e3b04f` (complete-envelope
witnesses, both-store empty/scalar coverage and refusal preservation at expiry),
and `648abea48` (end expired watch retention before asynchronous recovery),
plus `f1168a33c` (native/browser expiry-observation witnesses). No push or publication.

## Procedure and tests

| Rule | Behavior and evidence |
|---|---|
| 1. Session/incarnation | Every routing await and publication retains the session, incarnation and local-commit authority checks. Existing `query-publication-session.test.mjs` runs sign-out/close at local execution, dispatch, transport, delivery and publication; direct routing and remembered-answer tests also interleave sign-out/close at recovery/publication. |
| 2. Known complete local wins | Run locally first regardless of `runs`. Only a known **and complete** result narrows static possible dependencies. Existing Quarry/native × held/ordinary branch controls, real conditional Following and untaken held branches, native reset/install cases, and both real 8,193-event scalar-cut witnesses remain. |
| 3. Engine withholding | Engine unavailable/unexecutable results stay exactly loading offline, fenced or held; otherwise use the original arguments/cursor and keep loading on transport failure. Existing five routing branches, original/native cursor tests and card/repost/inbox-floor tests remain. Native query-module coverage now explicitly checks both provenance facts on the withheld result. |
| 4. Available values | Unknown non-speculative values remain partial data, including empty/scalar results and projections without id. Speculative unfenced results recover unexpired memory or E_OFFLINE/watch loading. While fenced, speculative results publish locally only with held provenance. `prediction-routing` covers all four speculative held/fenced combinations, four non-speculative shapes, retained empty/scalar composition offline and on failed transport, and all caughtUp/identityChecked combinations. `residency` exercises both wrapped-presence forms and projected rows on actual wasm and process devices. `bounded-following` preserves the predicted feed beside a speculative profile on both tiers. |
| 5. External publication | All external data, refusals, loading and E_OFFLINE candidates still consult the final session/prediction gate. Memory stores the server nextExpiry, supplies it to watch scheduling, rejects expiry during recovery, and checks it again immediately before publication. The real process-device expiring-permit test proves both direct queries and watches stop publishing the private row after T; raw server data is then null. Direct tests advance time during final publication and assert the scheduled deadline, cache retirement and the original since timestamp. Existing late-prediction, memory race and authoritative composed-refusal cases remain. |

Publishing paths in `local-query.ts`:

| Path | Test showing its fence |
|---|---|
| Server data | `rule 5: prediction arriving at delivery/publication`; real original-cursor/native module tests. |
| Remembered data | `remembered answer rechecks prediction/sign-out/close during recovery/publication`; speculative held/fenced matrix; two expiry boundaries. |
| Local unknown | Engine provenance matrix, real wrapped presence/projected rows, retained empty/scalar composition, predicted withProfile. External replacement passes the same delivery/publication gate. |
| E_OFFLINE | Placeholder-without-memory cases and remembered-answer recovery/publication races; expired-memory query test. Fenced placeholders load instead. |
| Server refusal/loading | Composed E_BOUND/application-refusal/loading × fenced/unfenced tests and real authoritative-bound tests on wasm/process devices. |
| Local known | Complete-branch controls and known meter-prefix controls. Local freshness is recomputed at publication and tested against both sync-state predicates. |

## File-by-file

Paths are relative to `snapback4/`.

| File | Change |
|---|---|
| `crates/snapback4-core/src/engine/components.rs` | Add speculative/held coverage and whole-query Provenance. Observe read facts even without a composition plan; retained components count as held. |
| `crates/snapback4-core/src/engine/local.rs` | Return provenance with Quarry/native observations, including refusals; preserve existing query/coverage/native-query wrapper signatures. |
| `crates/snapback4-core/src/engine/read.rs` | Mark horizon point misses, online-only reads and unknown point probes speculative. Mark authorized, actually held input rows as held. Horizon scans alone do not mark speculation. |
| `crates/snapback4-core/src/engine/read_auth.rs` | Mark an undecidable provisional-read authorization as speculative, preserving the existing authorization refusal/unknown behavior. |
| `crates/snapback4-core/src/engine/runner.rs` | Mark device presence's assumed connection value speculative. |
| `crates/snapback4-device/src/device.rs` | Carry provenance through the common observation path for Quarry and native modules. |
| `crates/snapback4-device/src/call.rs` | Include both facts in query replies, including refusals and every component. Construct unavailable replies without encoding then deleting discarded data; share flag encoding to fit the existing wasm budget. |
| `crates/snapback4-device/tests/components.rs` | Check provenance on memory/SQLite components and prove retained empty/scalar results on both stores with no row-shaped output. Existing coverage/meter differential comparisons remain. |
| `crates/snapback4-device/tests/search_merge/round2.rs` | Extend exact retained point/component expectations to include provenance. |
| `crates/snapback4-device/tests/uniform_word_expansion/mod.rs` | Verify that the control read held rows while the empty meter prefix did not, retaining the remaining full-envelope comparison. |
| `packages/snapback4/src/local-query.ts` | Delete containsRows. Use engine provenance in the numbered procedure, compute the fence even offline, preserve unknown unwrap recovery, reject expired remembered answers at recovery/publication, and return remembered expiry to watch scheduling. |
| `packages/snapback4/src/local.ts` | Withdraw the expired watch snapshot synchronously before waiting for the replacement; rearm a clamped long-deadline timer without expiring early. |
| `packages/snapback4/src/local-reads.ts` | Keep nextExpiry alongside the remembered answer, original observation timestamp and tables. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | Three reference lines explain provenance, stale recovery, expiry/watch scheduling, freshness and the unchanged external fences. |
| `packages/snapback4/test/prediction-routing.test.mjs` | Add provenance/retained scalar/projected-page cases, held/fenced matrix, exact since test, caughtUp/identityChecked freshness matrix and both expiry boundaries. Give existing mocks explicit provenance. |
| `packages/snapback4/test/residency.test.mjs` | Real wasm/process wrapped-presence and no-id projection tests; real process permit-expiry direct/watch test, including a blocked device read at the deadline. |
| `packages/snapback4/test/bounded-following.test.mjs` | Assert native module provenance and real speculative/held withProfile facts. An unfenced speculative profile with no memory now refuses offline; predicted held feed rows remain partial data. |
| `packages/snapback4/test/retained-history.test.mjs` | Include both provenance facts in exact real-device component assertions. |
| `packages/snapback4/test/client-seams.test.mjs` | Restore partial empty held horizon searches: executed scans are non-speculative. Keep raw coverage and zero-server-call assertions. |
| `packages/snapback4/test/client-lifecycle.test.mjs` | Supply explicit non-speculative held provenance to the existing W13b partial-data mock. |
| `packages/snapback4/test/following-routing.test.mjs` | Supply explicit provenance to the retained composition mock. |
| `packages/snapback4/test/page-authority.test.mjs` | Assert E_OFFLINE after authoritative loading retires memory for an unfenced speculative read; still verify its actual authorized local prefix and provenance. |
| `packages/snapback4/test/page-ready.test.mjs` | Restore partial empty scan data and explicitly verify unknown/non-speculative raw coverage. |
| `packages/snapback4/test/word-expansion.test.mjs` | Match the wasm empty-prefix provenance with the Rust meter-boundary oracle. |
| `packages/snapback4/test/fixtures/page-observation.mjs` | Treat injected nextExpiry as an actual deadline; assert no expired page bridges a blocked fetch, retaining pending-write/offline/account-switch checks. |
| `packages/snapback4/test/page-observation.test.mjs` | Require expiry withdrawal on process devices and real Chromium/IndexedDB with useQuery/usePage. |
| `reports/20260925-bounded-following-r6/mutations.py` | Reproducible mutations of built routing, restored in finally. |
| `reports/20260925-bounded-following-r6/*.log.gz` | Qualification, focused, development-failure and mutation evidence. |
| `JOURNAL.md` | One dated append-only qualification entry. |

## Forms and implementation decisions

No new Quarry spelling or refusal code. These existing forms now use the new
provenance and recovery behavior (compiled/executed in the named tests):

```quarry
query wrappedPresence(p: principal):
  return [{ online: exists connected[p] }]
query identifiedPresence(p: principal):
  return { id: p, online: exists connected[p] }
query shapedNotes():
  return notes last 5 by byTime { text, at }
```

The first two recover the remembered false offline. The horizon-limited
projection remains partial data without requiring id in the returned records.

```quarry
query empty():
  return {left: messages['empty'] last 50 by byTime, held: messages['held'] last 50 by byTime}
query scalar():
  left = messages['left'] last 50 by byTime
  held = messages['held'] last 50 by byTime
  return {left: count(left), held: first(held)}
```

With an empty retained left group and an empty unknown horizon scan, the local
values are respectively `{left: [], held: []}` and `{left: 0, held: null}`.
Retained coverage supplies held provenance independently of value shape.

The expiring-permit fixture uses an online-only `secrets[id]` point read,
guarded by `exists permits[principal = viewer]`; permits expire at their
`expiresAt` value. The remembered answer keeps that server deadline.

No deviation from round 6. Engineering choices where unspecified:

- Provenance is additive query/component wire metadata, observed alongside
  existing execution coverage. It does not change read authorization, meters,
  stored row images, acquisition, history retention or the public Read union.
- Older device replies missing provenance are conservatively speculative when
  unknown; they cannot gain held status through the value's shape.
- Unknown authorization/unwrap outcomes remain recoverable rather than turning
  a placeholder absence into an authoritative NOT_FOUND.
- An expired external data candidate is rejected at publication without an await;
  authoritative refusal/loading remain real answers even if accompanied by a deadline.
  Direct expired memory gives E_OFFLINE; a watch loads and clears the expired
  timer deadline. A server/composed candidate that expires in flight loads too.
- Memory remains client-lifetime only and is still invalidated by local commits
  and incarnation changes. A retained composition never recovers whole-query
  server memory.
- No ceiling, timeout, test-count reduction, storage format, package version,
  push or publication change. All edited source files remain below 1,500 lines.

## Qualification

Final full suite: **`== 0 failure(s) in 576 s`**, exit 0, after all changes.
Command: `taskset -c 0-15 env SNAPBACK4_RUST_TEST_PROCESSES=8 bash scripts/test.sh`.
Rust passed in **180 seconds**. Main client tests: **1,605 passed, 0 failed,
10 existing skips**; all **34** acquisition/server shard tests and all **78**
model tests passed. Both 5,000-sequence session models preserved all thirteen
invariants. Builds, release/docs guards, package/app checks and fixture wrappers
passed. Evidence: `test-final.log.gz`. No final failures, baseline/environmental
waivers, ceiling/timeout increases, skipped new cases or reduced model counts.
CPU affinity limits concurrency on the shared host; it changes no test.

An earlier complete run before the final timer-race fix also passed
**`== 0 failure(s) in 747 s`**, with Rust in 338 seconds, 1,605 main client
passes, 34 shard passes and 78 model passes. It is preserved as
`test-pre-expiry-race.log.gz`; final qualification above includes the stronger
expiry-interleaving and browser/native view assertions.

Targeted Rust: **36 passed, 0 failed** across components (8), query_unavailable
(2), and timeline (26), then **9 passed** after extending the empty/scalar
provenance case to both memory and SQLite, plus **7 passed** in the envelope
correction rerun. Final routing: **81 passed, 0 failed**.
Corrected real-device/compatibility subsets: **24 passed** and **33 passed**, zero failures.
Reference audit: `ref-check: ok — 509 LLP docs, 9296 refs in 26155 files, 0 errors, 0 unchecked`.

Wasm: **1,772,196 bytes raw / 495,698 gzip**, below the unchanged **496,000**
budget. Compared with round 5, raw is 4,129 bytes smaller and gzip is 399 bytes
larger. No bound was raised.

Both specifically requested mutations are rejected:
- `since: last.at` → `since: Date.now()`: exact original-timestamp test fails.
- Freshness based on link alone: the three incomplete catch-up/identity cases fail.

Additional mutations ignoring final expiry, ignoring engine speculation, and
discarding retained scalar/empty values are rejected. An exploratory mutation
removing only the early recovery expiry check survives because the final
publication check still rejects the same expired memory; it does not bypass
the authorization deadline. That redundant-check observation is retained as
evidence, not treated as a required-test failure.

Reproduce from `snapback4/`:

```sh
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
bun install --frozen-lockfile
cargo test -p snapback4-device --test components --test timeline --test query_unavailable
bash scripts/build-wasm.sh
bun run --cwd packages/snapback4 build
node --test packages/snapback4/test/prediction-routing.test.mjs packages/snapback4/test/residency.test.mjs
python3 reports/20260925-bounded-following-r6/mutations.py
taskset -c 0-15 env SNAPBACK4_RUST_TEST_PROCESSES=8 bash scripts/test.sh
```

## Development failures

All were ours; no baseline or environmental waiver:

| Run | Failures and correction |
|---|---|
| First focused four-file run, 170 passed / 2 failed | Both new no-id projection cases seeded the third row after acquisition, which correctly retained all three live rows. Seed before opening the device to establish the two-row floor. |
| Compatibility run, 122 passed / 3 failed | Two existing wasm/native unknown unwrap tests exposed a regression: filtering only data-bearing placeholders returned NOT_FOUND offline. Preserve speculative refusal recovery too. The new wasm fixture used `persistence` instead of the actual `persist` option; correct it to avoid default IndexedDB in Node. |
| Intermediate wasm builds | New metadata initially exceeded the budget by 167, 131, 221, 214, 211 and 265 bytes during encoding experiments. The final direct construction of unavailable replies fits without increasing the budget. The unsuccessful manual coverage-serializer experiment was removed. |

The first full run ended **`== 2 failure(s) in 815 s`**: cargo test (four
failed targets) and client tests (three failed cases). Main client results:
1,600 passed, three failed, ten existing skips. All 34 acquisition/server shard
tests and all 78 models passed. Every full-run failure was ours:

| Failed test | Correction |
|---|---|
| `search_merge::round2::r2_n3_mixed_returned_history_exposes_independent_components` | Include the new speculative/held fields in the exact component envelope, preserving all old fields. |
| `search_merge::round2::retained_point_hits_and_misses_on_both_stores` | Explicitly require speculative/not-held for the miss, held/not-speculative for the hit. |
| `uniform_word_expansion::search_expired_meter_boundary_memory` | Assert the complete control held rows and the empty cut did not; retain the remainder of the full-envelope comparison. |
| `uniform_word_expansion::search_expired_meter_boundary_sqlite` | Same correction on SQLite. |
| `a loading server reply cannot replace the local prefix on a later transport failure` | This read executes an online-only input and is speculative but unfenced. After authoritative loading retires memory, require E_OFFLINE and separately assert its still-authorized raw local prefix plus both provenance facts. |
| `ready list reads survive account restoration, new chat acquisition and pending unread counts` | The empty horizon scan is non-speculative: require partial empty data and raw unknown/non-speculative coverage, rather than the round-5 E_OFFLINE expectation. |
| `wasm expired sub-pair (ii), meter boundary retains the existing time-hidden work bit` | Match the Rust complete-control/empty-cut held-provenance assertions while retaining every other envelope field. |

A further deadline interleaving was found during qualification: if device
evaluation blocks at T, merely rerunning the watch leaves its already-published
private snapshot visible. The stronger real-process probe failed against the
old built client, observing private stale data after T. The timer now resets the
watch to loading (or the session refusal) synchronously before asynchronous
recovery; a long clamped timer rearms without clearing early. The fixed
residency/authority/routing run passed **104 tests**, zero failures. Evidence:
`expiry-race-before.log.gz` and `expiry-race-after.log.gz`.

The first full run with immediate expiry withdrawal ended
**`== 1 failure(s) in 620 s`**: client tests only. Rust passed in 224 seconds,
all 78 models passed in 240 seconds, and all 34 shard tests passed. Main client
results were 1,603 passed, two failed, ten existing skips. Both failures were ours:

- `native process devices bridge an inbox fetch and clear it offline and on account switch`.
- `web IndexedDB device bridges the two-device inbox fetch in useQuery and usePage`.

Their shared fixture injected nextExpiry as a refresh-only trigger and then
required the expired answer to stay visible during a stalled fetch. Round 6
deliberately forbids that retention. The corrected journey explicitly requires
loading and empty first-page hook items at expiry, keeps the remaining
pending-prediction, offline and account-switch assertions, and passes on both
process devices and real Chromium/IndexedDB (two tests, zero failures).
No timeout or case count changed. Evidence: `test-expiry-views.log.gz` and
`expiry-views-corrected.log.gz`.

Their targeted reruns passed seven Rust cases and 33 client cases. The earlier
corrected 24-case subset and final 81 routing tests also pass. Intentional rejected
mutations are test-strength witnesses, not product failures.
The baseline tail was read before qualification: `== 1 failure(s) in 276 s`
(cargo test). No failure is excused by that baseline.

## Existing scale limitation

No new inventory or browser measurement is claimed by this routing round.
Stored rows and acquisition policy are unchanged. Historical round-1 inventory,
with owned events fully synced (not a round-6 measurement):

| Table | Before rows | After rows | Before row bytes | After row bytes |
|---|---:|---:|---:|---:|
| posts | 50,228 | 1,000 | 13,496,683 | 299,000 |
| reposts | 1,004 | 1,000 | 161,640 | 161,000 |
| owned events | 49,228 | 49,228 | 7,796,444 | 7,796,444 |
| tombstones | 0 | 0 | 0 | 0 |
| follows | 5,921 | 5,921 | 852,624 | 852,624 |
| inbox | 24,555 | 1,000 | 7,938,537 | 327,458 |
| profiles | 1,008 | 1,008 | 357,825 | 357,825 |
| work | 63 | 63 | 22,132 | 22,132 |
| Whole partition, including other tables | 171,330 | 98,543 | 35,901,571 | 15,092,169 |

The previous whole-partition
measurement with fully synced owned events remains **171,330 → 98,543 rows**,
**35,901,571 → 15,092,169 row bytes**, and cold Chromium acquisition
**281,263.9 → 117,812.5 ms (2.387×)**. Owned events dominate after bounding
(49,228 rows / 7,796,444 bytes).

The program's **5× target remains unmet**, and packed-format measurement remains
unclaimed. For these raw inventory units, the fixture is a concrete lower-bound
counterexample: the required fully synced events alone exceed one fifth of both
the original whole-partition row count (34,266) and raw row bytes (7,180,314.2).
Reducing those units by 5× would require changing more than source/inbox floors;
this lane preserves the accepted fully synced event policy. This does not
establish a bound on packed storage bytes or acquisition time. Reproduce with `node reports/20260925-bounded-following-r1/measure.mjs`
after its production build; the complete per-table inventory and measurement
context are in the [round-1 report](../20260925-bounded-following-r1/REPORT.md).
