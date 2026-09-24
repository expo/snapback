# LLP 3000.013 — integration round 5

Branch `sb4-intent/integration`, worktree `~/sb4-intent/lane-i`.
No push, version bump or publication. Updated 2026-09-25 for the supervisor's
part-i main merge and release qualification. The two E/J contract conflicts
remain resolved under the part-h rulings; the latest qualification below
supersedes the historical results.

## Merge ledger

Every listed merge used `--no-ff`; `cargo build --workspace` passed after each
merge before the next began. External final reports and committed reports (or
K/J's committed journal reports) were read first. Earlier qualification and
file-by-file records are [part a](20260924-intent-integration-r5a.md),
[part b](20260924-intent-integration-r5b.md),
[part c](20260924-intent-integration-r5c.md),
[part d](20260924-intent-integration-r5d.md),
[part e](20260924-intent-integration-r5e.md), and
[part f](20260924-intent-integration-r5f.md).

| Source head | Integration merge | Conflicts / disposition |
|---|---|---|
| Fetched main `0ee488999` | `86de910d1` | Clean; includes the newer LLP 3000.014/backstop records. |
| E `199964910` | `ef7e3131a` | Clean. |
| F `27a2491fe` | `2ad6be2e8` | Journal only; preserve every entry verbatim. |
| H `63cb318c5` | `6877a67e5` | Journal only; preserve every entry. |
| F `11a4cb35a` | `b320e0f41` | Journal only; preserve H prose and Bob unrepost test. |
| L `e68d7a6e2` | `a8a36a911` | Journal and feeds card; F structure/examples with L time slicing, FULL durability and lifecycle limits. Runtime merged automatically. |
| F `ec04c2b0f` | `905299396` | Journal only. |
| N `c1ed4bdca` (fetched native smoke branch) | `8082c720f` | Journal, witness card, app.ts, app.test.mjs; preserve F lead/deeper runner, N smoke protocol and published-client hook, E options and session ownership, and both regression sets. |
| A `2f20aa92f` | `e792b65d5` | RFC/journal, binder, scale output, reads card and wasm history; preserve H source text/window wording, A variants/predicate context and F prose. |
| O `a54a52ce3` | `c85ee309f` | Journal, codes, language card and scale tests; preserve A variants and all O forms/codes. |
| K `a8a3b7595` | `0faed903f` | Binder constructors, conditional/reads binding, codes/reads/writes cards, printer and scale census; preserve A context, H source-aware printer and F prose. Full file map in part f. |
| P `39cdac19d` | `d087fa873` | RFC/journal, admission/read-only analysis, delete binding, prediction card, lowering inventory and wasm history; retain A shared effect checker and classify DeleteTarget as impure. |
| J `409b3ca50` | `a19f06604` | Nine files, detailed below; workspace build 21.83 s. |
| E `45253977b` | `3f67266b8` | Eight files, detailed below; workspace build passed. |
| K `320e89bda` | `f61b5b01a` | Four files plus DeleteTarget flow integration; workspace build 6.17 s. |
| P `4014149ca` | `3b8028057` | RFC, journal and prediction card; workspace build 11.43 s. Round-5 exit file did not yet exist. |
| P `38f3e21b1` | `b527dcfdd` | Round 5 finished before qualification ended; clean incremental merge, workspace build 11.13 s. |
| Fetched main `03fdedbe1` | `7611b1498` | Journal only; retain both complete sides in date order. Expired-birth runtime changes merged automatically with P. Workspace build passed. Main also carries its independent Snapback 5 fence/documents; no integration edits there. |

Part-g conflict resolutions, relative to `snapback4/`:

| File | Resolution |
|---|---|
| `JOURNAL.md` | Keep all parent entries byte-for-byte, including J, E, K and P reports; append integration's record. All new entries have the same date. |
| `../llp/3000.013-quarry-states-intent.rfc.md` | Union E client, A planner, L retirement and P reservation revision history; keep all substantive sections. |
| `crates/snapback4-lang/src/guide/bounds.rs` | Keep F's arrangement, applying J's loading/fallback wording where F moved it. |
| `guide/codes.rs` | Keep A/O entries, J store codes and K's stricter row-kind explanation. |
| `guide/reads.rs` | Keep F's refusal prose and J's bounded local fallback; update the moved meter caption. |
| `guide/sync.rs` | Keep F operations section, J online store-change and local restore instructions. |
| `packages/snapback4/src/app.ts` | Combine E atomic prepare/commit/start and permanent facade fencing with J replacement retirement/reopen and cancellation custody. Native onClient receives the published guarded local client; retain O/E local options and assets. Late discarded sign-in uses E's revocation custody. |
| `src/app-online.ts` | Keep J pinned retirement IDs/saturation and bulk retirement, E deferred activation and retained known outcomes after receipt-save failure. Part h resolves the outcome requirements under the supervisor rulings below. |
| `src/client.ts` | Keep J store/read floor and response consumption without transport abort, O upload session validation/copy/retry, E dispatched-outcome guards. Terminal store changes retain their explicit action refusal. Part h applies the supervisor's close cutoff. |
| `src/local.ts` | Keep J LocalReads/fallback and non-aborted effect transport, E deferred start/rotation and settlement tracking, O cleanup/refusal handling, N onClient hook. Exactly 1,500 lines after the merge. |
| `test/app.test.mjs` | Keep both regression sets. |
| `test/client-lifecycle.test.mjs` | Retain no-abort and late-body consumption checks; E's shared assertion expects pending for a cancelled unreceived result and sent for an already applying acknowledgment. Part h updates cancelled mutation/action expectations to pending under the ruling; upload cancellation remains E_CLOSED. |
| `bind/program/conditional.rs` | K refuses incompatible row kinds at the join; A still records presence variants, isolates setup and reuses logical read sites. |
| `src/print.rs` | Retain H's single precedence/source-aware renderer and shared quoting, with K spread support. Remove the now-unused shape_fields wrapper. |
| `guide/prediction.rs` | Keep F definition/example ordering and insert P's undelivered-sweep explanation at its new location. |

The first K build identified P's new `DeleteTarget` missing from K's exhaustive
flow match. `bind/program/flow.rs` now classifies it as fall-through, like other
writes. No lane feature, code, compiled example or test was removed.

## Integration follow-ups and cross-lane evidence

| File | Change / proof |
|---|---|
| `packages/snapback4/test/online-terminal-entrypoints.test.mjs` | Six rejected-refresh schedules: session and bare token, each through sign-out, replacement and same-store restore. Replacement/restore cannot revoke the held bearer; subsequent explicit sign-out does. |
| `test/helpers/online-client-model.mjs`, `test/online-client-model.test.mjs` | Parameterize the ordinary failed receipt and add E_CONFLICT displacement/reopen/retry alongside E_UNIQUE and sent; the oracle forbids reposting a retired ID. |
| `crates/snapback4-lang/tests/joined_shapes.rs` | Both continuing arms and both surviving row kinds now assign the opposite kind after return or unconditional refusal. Assert E_QUARRY_SHAPE_JOIN at that exact subsequent assignment. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md`, `src/contract.ts` | Complete-list and Read documentation agree: retention only while local unavailable-read fallback is pending, fresh:false/since, initial loading and denied message; online reads keep no old answer. |
| `crates/snapback4-lang/tests/guide/definitions.rs`, `refusal_actions.rs` | Pin J's new store-replacement definition/recovery and K's row-kind refusal. |
| `crates/snapback4-lang/src/guide/writes.rs` | Preserve P alternate-delete absence prose while placing F's NOT_FOUND definition first, keeping the tested why excerpt complete. |
| `crates/snapback4-lang/src/bind/program/joins.rs` | Locate rewrite operands using authored source text. H's precedence-correct printer adds parentheses, so its rendered text cannot locate the original substring for K's nullable, lazy join rewrite. The existing nullable-local regression now passes. |
| `packages/snapback4/src/app-client.ts`, `src/app.ts` | Initialize a fenced observation's stable denial at the actual fence, retaining J's store code through E's facade. A repeated mutation ID awaits store retirement; failed retirement stays pending. Recheck the store fence after E's asynchronous epoch lookup, before dispatch. |
| `packages/snapback4/test/online-client-model.test.mjs` | Seeds 774 and 2592 pin the integrated epoch-await dispatch fence; both pass. |
| `packages/snapback4/test/app.test.mjs`, `test/page-observation.test.mjs`, `test/react.test.mjs` | Port the failed-login fence fixture to E's atomic session/epoch record, retain E's E_AUTH facade refusal expectation, and await the new J loading transition before asserting Alice's ready data. Server revocation and account-isolation assertions remain. |
| `packages/snapback4/test/typing-expiry.test.mjs` | Capture the ready expiry answers and DOM together, avoiding a later loading-state sample while retaining the expiry deadline and no-polling assertions. |
| `metrics/wasm-budget.json` | Record both part-g measurements and the 492,000-byte ratchet, with runtime attribution and unchanged meters. |

The earlier round-5 follow-ups remain: discarded-login revocation after a failed
comparison read, Bob unreposting Alice's original, the sole continuous lock
holder's maintenance ticket, range-end purity negatives, upload deletion-refusal
handling, and a later cap 100 that defeats choosing the largest cap.

The complete Clique fixture compiles without diagnostics. `home` (Following),
`global`, two-bound `trending`, `userPosts`, `thread`, `people`, `socialProfile`,
`insights`, `history` and `searchAll` run. Empty search and spread have old-spelling
comparisons. The digest count has no `by`, seeks both endpoints, streams 5,000
inputs, chunks automatically and survives reopen/once retries. All three
simulator tests pass.

All four issue-tracker tests pass on the server and acquired/reopened memory and
SQLite devices. Every board presence variant is constant, including no filters;
overdue/counts are constant; withLabel grows with skipped issues; find grows for
search and browses constantly for empty text. Spread equals wildcard fields.
The exact supplied card remains **grows**, for the already reported independent
label-organization authority counterexample; declaring it constant would weaken
the certificate. The scoped control is constant. See part f for the executable
9,000-hidden-label reproduction and explicit sync-only companion adaptation.

## Supervisor rulings and implementation

1. **Close is bounded by local work, with a known-outcome cutoff.** Network
   requests are not aborted. Caller waits detach immediately; close finishes
   local cleanup without awaiting a held body. An unreceived mutation/action
   result returns pending with its original id. A parsed result already being
   applied, or arriving during local cleanup before close completes, remains
   known. Later bodies are consumed and discarded. Durable mutations recover
   with the same id; the server returns replayed:true instead of executing twice.
   Raw online callers keep their own id, and actions collect the existing server
   action record; no action is added to a device outbox.
2. **Known terminal results survive failed receipt saves.** mutate, write(id)
   and onWrite retain one consistent known outcome. Persisted terminal receipts
   are not reposted. If receipt persistence fails, the durable online intent
   may replay only to its original dispatch store, where idempotency dedupes it.
   Intent and its known store identity are saved together; a second atomic gate
   records dispatch ownership before transmission. Fresh staged offline intent
   is marked undispatched. Legacy intent without a recorded identity may replay
   only to the first store its journal has seen; mismatches retire with an
   unknown-outcome refusal. The server checks the requested store under its
   engine lock before execution and receipt lookup, covering replacement between
   probe and dispatch. Failed identity writes never permit dispatch. The client
   reference states the total-storage-failure admission limit.

Ruling 2's journal migration applies to J's online createApp journal. Existing
local-device reset/outbox transfer behavior is unchanged. Actions retain their
existing server-record recovery contract. These scope choices preserve the
existing surfaces outside the ruled E/J journal conflict.

Part-h file map (paths relative to `snapback4/`):

| File | Change and evidence |
|---|---|
| `packages/snapback4/src/request-wait.ts`, new `closing-responses.ts` | Separate stopped caller waits from response consumption; retain replies through completion of local close cleanup. |
| `src/client.ts`, `src/local.ts`, `src/actions.ts` | Preserve known outcomes; unknown close results become pending; action recovery adds no await to the ordinary delivered-result path. |
| new `src/local-types.ts` | Extract unchanged queue/store-capture interfaces to keep local.ts below 1,500 lines. |
| `src/writes.ts` | Retain failed-to-save receipt summaries and their notification identity independently of the 256-entry ordinary history. |
| `src/app-journal.ts`, `src/app-online.ts`, new `src/online-dispatch.ts` | Atomic dispatch store binding, first-store history, same-store recovery, safe mismatch retirement and retained receipt notification deduplication. |
| `crates/snapback4/src/serve.rs`, `src/actions.rs` | Optional wire store precondition before mutation/action replay and admission, without recording a refusal in the wrong store. |
| `crates/snapback4/tests/serve_store/mod.rs` | Wrong-store mutation and action requests cannot execute or reserve an id; correct-store retry still executes and mutation replay is deduped. |
| `packages/snapback4/test/app-local-outcomes.test.mjs`, `app-outcomes.test.mjs`, `effectful-cancellation.test.mjs` | Update ruled pending outcomes; wasm/native matrix proves held requests do not delay close and responses arriving during cleanup remain known. |
| new `test/app-local-receipts.test.mjs` | Eight real wasm/native cases fail keep_write for sent/failed outcomes, with/without close; known result survives and restart settles once. |
| new `test/online-intent-store.test.mjs`, `app-online.test.mjs` | Persisted receipt never reposts; failed save replays once on the original store and never executes on replacement; legacy first-store cases, admission failure, probe/dispatch replacement race, 257-notification regression. |
| `test/app-retirement.test.mjs`, `app-storage.test.mjs`, `react.test.mjs` | Teach unit transports the private dispatch boundary and HTTP mocks the authenticated store probe; preserve every retirement, owner-isolation, quarantine and hook assertion. |
| `test/helpers/app-session-model.mjs`, `app-session-model.test.mjs` | I12 tracks received bodies; I13 faults real wasm keep_write as well as online receipt storage. Preserve all other invariants and full counts. Pin local cleanup interleaving. |
| `test/helpers/online-client-model.mjs`, `online-client-model.test.mjs` | R3 independently counts executions per id/store and durable ownership before dispatch, allowing server-deduped repost after failed receipt save. Assert coverage of unpersisted terminal, safe replay and store fencing. |
| `CLIENT-AND-OPERATIONS.md`, `src/contract.ts`, `guide/writes.rs`, `../llp/3000.013-quarry-states-intent.rfc.md` | Document both rulings, recovery limits and unchanged read disclosure; no new Quarry form or refusal code. |
| `metrics/wasm-budget.json`, `JOURNAL.md`, this report | Record unchanged device bytes, measurements and qualification. |

## Release checks and failure accounting

### Part-i qualification: main's expired-birth retirement

Implementation and regression commit: `7850592aa`; main merge: `7611b1498`.

Read `03fdedbe1` in full, including its commit message, implementation,
regressions, and `llp/reviews/3000-retire-expired-births.astra.md`. No runtime
conflict required a behavioral repair. `Runner::remove` retains P's
`Rows::delete` counter transitions and index charges. Commit-end retirement
therefore withdraws born-row events, preserves the predecessor's owed scope,
and releases both table and cap-group occupancy atomically. Main's net aggregate
changes, per-audience-key scan memo and maintained-target expiry refusal remain.
P's keyed lookup, authorization-before-expiry-charge and device deferral remain.

Main's imported implementation spans `engine/mod.rs`, `job.rs`, `native.rs`
and `postgres/mod.rs` for commit boundaries; `runner.rs` and `write.rs` for
retirement state/removal; `maintains.rs` for net aggregate deltas;
`partition.rs` for memoized live-replacement scans; and `schema.rs` for the
maintained-target refusal. Its `engine/retire_tests.rs` and simulator
`tests/reviews.rs` retain all regression cases. Its LLP, review record, closed
tickets and journal entry are preserved unchanged.

| Integration file | Added evidence / documentation |
|---|---|
| `crates/snapback4-core/tests/fixtures/expired-birth-cap.q` | Shared compiled fixture with table cap 2, group cap 1, expiry and an insert accepting a deadline. No new language form. |
| `crates/snapback4-core/src/engine/mod.rs` | Express the unchanged test-and-SQLite condition as separate cfg guards, recognized by the existing web source census. |
| `crates/snapback4-core/src/engine/retire_tests.rs` | MemoryRows boundary: born-expired insertion physically counts before retirement, then has zero occupancy/no row/no events; the next live insert succeeds and counts once. |
| `crates/snapback4/tests/expiry_writes/stores.rs` | SQLite commit and disk reopen: expired birth leaves zero counts; next live insert succeeds; subsequent group/table overflow still refuses. Every write examines zero rows. |
| `crates/snapback4-core/src/engine/postgres/tests/caps.rs` | Same commit/reopen and next-insert proof through real Postgres, including both cap refusals and exact table/group counts. |
| `crates/snapback4-device/src/device/expired_births_tests.rs`, `device.rs` | Memory and SQLite device tests: admission stays unpredicted, queue survives reopen, server retires the birth, no born-row event reaches sync, settlement/reopen counts stay exact, and the next live insert fills its capacity once. |
| `crates/snapback4-lang/src/guide/types.rs`, `../llp/3000.013-quarry-states-intent.rfc.md` | Explain new program births versus existing/seed/load backlog and unchanged prediction deferral. |
| `metrics/wasm-budget.json`, `JOURNAL.md`, this report | Record merge, artifact and release evidence. |

Focused results: core retirement 2/2; device retirement 2/2; P expiry 31/31;
main disclosure reviews 30/30; real Postgres adapter 15/15 (all explicitly
ignored database tests enabled) in a private socket-only PostgreSQL 16.15
cluster. The existing review tests retain never-live grants, revived births,
predecessor revocation, net-sum overflow and the maintained-table schema refusal.

The auxiliary `scripts/test-postgres.sh` attempt stopped before adapter tests
because its separate `experiments/postgres/Cargo.lock` still records the local
crates as 0.2.28 instead of 0.4.0 and is stale under `--locked`.
This is an inherited experiment harness setup failure, not an adapter test
failure. The unchanged experiment lock was not rewritten. The actual adapter
suite above ran directly with `--features postgres --lib engine::postgres::tests
-- --include-ignored --nocapture` against the script's private cluster; it passed.

No design deviation or new open runtime defect was found. Main's documented
exemption remains: seeds, loads and activation can keep already-expired rows
for a later sweep, including their inherited deletion/scope disclosure. This
merge does not authorize eager secondary-collision cleanup of such existing
rows. Device prediction does not run retirement. Runtime ceilings are unchanged.

The first complete suite ended **`== 1 failure(s) in 376 s`**: client tests.
Every Rust test and all 13,000 E/J model sequences passed. The two deterministic
failures were `web-reachable typed JSON calls all use the codec funnel` and
`census kills parse, encoded, MQ components and container regressions`, in
`wasm-codec-census.test.mjs`. The source scanner recognized only separate
`cfg(feature = "sqlite")` guards, so it incorrectly included main's new
`retire_tests` module (and the added memory test's schema conversion). Splitting
`cfg(all(test, feature = "sqlite"))` into equivalent separate guards makes the
actual server-only boundary visible, without changing runtime behavior or
weakening the census. Its isolated rerun passes 26/26. These are integration
failures, not baseline waivers or intermittent product failures.

Final `scripts/test.sh` exits 0:

```text
== 0 failure(s) in 403 s
```

The main client process reports **1,478 tests, 1,468 pass, zero failures,
ten explicit skips**; separately sharded groups pass. Every Rust target and
doctest passes. No intermittent failure occurred in either part-i run, and no
baseline or environmental failure is waived in the final suite.

| Release check | Part-i result |
|---|---|
| E online / real-wasm local models | 5,000 / 5,000 sequences pass. |
| J online model | 3,000 seeded interleavings pass. |
| Guide blocks | 80/80 pass without diagnostic or note. |
| Complete Clique fixture | 3/3 pass, including Following and the 5,000-input digest sweep. All previously qualified forms above remain unchanged. |
| Issue tracker | 4/4 pass on server and memory/SQLite devices, including reopen and the supplied card's conservative grows classification. |
| Native smoke, witness driver and README JS | All 21 tests pass in the full client run; Rust witness tests 8/8. Linux still provides no simulator evidence. |
| Docs budget | README 300/300 physical lines; changed source files remain below 1,500. |
| References | `ref-check: ok — 507 LLP docs, 9269 refs in 25838 files, 0 errors, 0 unchecked`. |
| Wasm build/budget | 1,765,796 B raw / 491,640 B gzip; existing 492,000 B ratchet, 360 B headroom. No ratchet or runtime ceiling increase. |
| L latency witness | 4/4 pass, SNAPBACK4_BENCH_ASSERT=1 and SNAPBACK4_BENCH_MAX_RATIO=1.5. Ratio 1.404. |

Latency ran separately after the full suite, with one test thread. Five-follower
post p95 is **2.226 ms**; 900-follower p95 is **3.126 ms**, ratio **1.404**.
All twenty large-audience posts arrive in **5,599.853 ms** (**5,557.619 ms** after
the last acknowledgment). Eight continuous foreground streams complete
**5,967** home requests at p95 **1.967 ms**, while all 901 copies arrive in
**1,137.494 ms**. Production retains synchronous=FULL; the witness's explicit
NORMAL comparison profiles do not change deployment settings.

The wasm raw size is unchanged from part h and gzip is one byte smaller; this
is a measured whole-artifact comparison, not a claim of byte identity. The
retirement pass and its state remain server-only, with no device prediction
retirement added. Logs are `~/sb4-intent/integration-r5i-*.log`; the canonical
passing log is `integration-r5i-suite-final.log`, the first failed run is
`integration-r5i-suite.log`, and the database proof is
`integration-r5i-postgres-core.log`.


### Historical part-h qualification

Final implementation commit: **`8c3515d68`**. The final full suite exits 0:

```text
== 0 failure(s) in 345 s
```

Main client process: **1,478 tests, 1,468 pass, 0 fail, 10 explicit skips**;
its separately sharded groups also pass. Every Rust target and doctest passes;
no original-main baseline or environmental failure remains. No intermittent
failure occurred in the final run. The historical typing race's isolated reruns
and test-only repair remain documented below.

| Release check | Final result |
|---|---|
| E online / real wasm local | 5,000 / 5,000 sequences pass, with actual device receipt-save faults. |
| J online | 3,000 sequences pass, including safe deduplicated repost and different-store fencing. |
| Guide | 80/80; every Quarry block compiles without diagnostic or note. |
| Clique | 3/3, including Following and the digest sweep. |
| Issue tracker | 4/4, server and memory/SQLite devices including reopen; the supplied card remains honestly classified grows. |
| Native smoke / witness driver / README JS | 21/21; Rust witness unit tests also pass in the full suite. No Linux simulator claim. |
| Docs budget | README 300/300 physical lines; changed source files at most 1,500 lines (local.ts 1,483). |
| References | `ref-check: ok — 505 LLP docs, 9265 refs in 25823 files, 0 errors, 0 unchecked`. |
| Wasm | Unchanged, 491,641 B gzip under 492,000 B; no ratchet increase. |
| Lane L latency | 4/4 ignored witness tests pass with SNAPBACK4_BENCH_MAX_RATIO=1.5; measured ratio 1.133. |

Named regressions passed before the full run: 93 outcome/lifecycle/store tests; 18 close-cutoff
cases; 73 local-receipt/model-smoke tests; 41 retirement/storage/React tests;
and 21 native-smoke/driver/README JS tests. The two HTTP store-precondition Rust
regressions pass. The latency witness passes all four ignored tests with both
assertion flags enabled: 5-follower post p95 2.043 ms, 900-follower p95 2.314 ms,
**ratio 1.133**, under 1.5. All twenty large-audience posts arrive in 5,848.682 ms
(5,815.287 ms after the last acknowledgment). Eight continuous foreground
streams complete 6,875 home requests at p95 2.006 ms while all 901 copies arrive
in 1,247.817 ms. Production retains synchronous=FULL.

The unchanged artifact is **1,765,796 B raw / 491,641 B gzip**, with **359 B**
headroom under the existing 492,000 B ratchet. Part h changes JavaScript and
server HTTP dispatch, with no device Rust delta and no meter-ceiling change.
The existing complete-list example and Read contract from part g remain valid.

Part-h failure accounting:

- The initial focused run failed J named seeds 16 and 2592 and generated seed 8:
  the first draft incorrectly required a successful probe before durable offline
  admission. Undispatched intent now stages durably, then binds atomically before
  transmission. Its R6 saturation schedule also needed to release the newly
  required probe before asserting recovery of a held mutation. That assertion
  remains intact. All four were integration defects and pass in full runs.
- The first full-model run found local E seed 4054 and J seed 2140. The former
  was an integration bug: a body arriving during close cleanup was discarded.
  The latter was an oracle timing error: ownership had been persisted before
  dispatch, but a concurrent owner retired the pending entry before HTTP entry.
  The independent model now records committed bindings and still forbids a
  different-store execution or repost of a persisted terminal result.
- The next model run found J seed 1073: an added action wrapper introduced a
  delivery await across the terminal-store fence. The wrapper was removed from
  the normal action path; close-only recovery preserves the original ordering.
  A preliminary full suite was stopped when this code changed; it has no final
  summary and is not passing evidence.
- The first completed part-h full suite ended **`== 1 failure(s) in 355 s`**,
  solely client tests. All Rust targets and the full 13,000 model sequences
  passed. Its 22 client failures comprise 21 test cases plus the React parent:
  six receipt-retirement unit cases lacked the new private dispatch registration;
  twelve storage/SecureStore/quarantine cases and three React cases lacked the
  new probe response in their mock servers. These are integration fixture
  defects, not baseline or environmental waivers. All 41 affected tests passed
  after adding the actual protocol boundary without weakening assertions.
  No new intermittent failure occurred in that run. The complete log is
  `integration-r5h-suite-2.log`. The failed fixture cases were:
  `app-retirement`: settle/compact/reopen for E_STORE_REPLACED and E_STORE_RESTORE;
  bulk retirement beyond the window; saturation with displaced sent id false and
  true; admitted pending recovery while delivery is held.
  `app-storage`: SecureStore pairs a!b/a~b, a*b/a'b, a(b/a)b,
  user:01ABC/user_3A01ABC and ab/慢; foreign intent owner; foreign backend journal;
  damaged `{`, `null`, ownerless pending/receipts, and non-array pending records;
  unavailable quarantine preserving bytes while blocking writes.
  `react`: AppProvider switches real clients and routes existing hooks; failed
  receipt saves stay settled after remount; two online owners notify both hooks
  when their shared journal settles. Their parent React test also reported red.

The model evidence includes E online 5,000 and real-wasm local 5,000 sequences,
with 3,750 online and 7,084 device receipt-save failures respectively; I12 covers
79/74 unknown close outcomes and 1,691/1,659 known deliveries. J's 3,000 sequences
cover seven unpersisted terminal observations, one subsequent safe terminal
repost, 219 deduplicated sends and 147 store-precondition fences. These are
seeded regression results, not an exhaustive proof.

### Historical part-g qualification (superseded by part h)

Before the supervisor rulings, the last full suite completed with exit 1:

```text
== 1 failure(s) in 444 s
   client tests
```

All other stages passed: workspace build, wasm/budget, docs budget, release
configuration guard, package typecheck/build, chat check, every Rust target and
doctest, chat/Expo typechecks and fixture wrappers. The main client process
reported 1,450 tests: 1,413 pass, 27 fail, 10 explicit skips; the separately
sharded client groups also passed. This used eight Rust test processes, four
Rust threads and the normal parallel client harness, with debug information and
incremental compilation disabled. No original-main baseline failure recurred.

Of the 27 client failures, **26 expose the E/J contract conflict** above (ours
to integrate, not environmental or a waived baseline), and **one is an
intermittent test sampling race**, repaired afterward. The complete failure
inventory follows; paths are under `packages/snapback4/test/`:

- `app-local-outcomes.test.mjs` — local wasm: mutation-sent delivered across app.close keeps its outcome boundary. **close/outcome contract**.
- `app-local-outcomes.test.mjs` — local wasm: mutation-failed delivered across app.close keeps its outcome boundary. **close/outcome contract**.
- `app-local-outcomes.test.mjs` — local wasm: action-done delivered across app.close keeps its outcome boundary. **close/outcome contract**.
- `app-local-outcomes.test.mjs` — local wasm: action-failed delivered across app.close keeps its outcome boundary. **close/outcome contract**.
- `app-local-outcomes.test.mjs` — local wasm: query delivered across app.close keeps its outcome boundary. **close/outcome contract**.
- `app-local-outcomes.test.mjs` — local native: mutation-sent delivered across app.close keeps its outcome boundary. **close/outcome contract**.
- `app-local-outcomes.test.mjs` — local native: mutation-failed delivered across app.close keeps its outcome boundary. **close/outcome contract**.
- `app-local-outcomes.test.mjs` — local native: action-done delivered across app.close keeps its outcome boundary. **close/outcome contract**.
- `app-local-outcomes.test.mjs` — local native: action-failed delivered across app.close keeps its outcome boundary. **close/outcome contract**.
- `app-outcomes.test.mjs` — a real mutation committed before logout returns sent with its original id. **close/outcome contract**.
- `app-outcomes.test.mjs` — a dispatched online action preserves its done outcome across close. **close/outcome contract**.
- `app-outcomes.test.mjs` — a dispatched online action preserves its failed outcome across close. **close/outcome contract**.
- `app-session-model.test.mjs` — online session state machine preserves I1–I13 across 5,000 seeded three-runtime sequences. **close/outcome contract**.
- `app-session-model.test.mjs` — local session state machine preserves I1–I13 across 5,000 seeded three-runtime sequences. **close/outcome contract**.
- `app-session-model.test.mjs` — model regression: online delivered commit retains its id across close. **close/outcome contract**.
- `app-session-model.test.mjs` — model regression: online delivered commit retains its id across logout. **close/outcome contract**.
- `app-session-model.test.mjs` — model regression: online delivered refusal retains its id across close. **close/outcome contract**.
- `app-session-model.test.mjs` — model regression: online delivered refusal retains its id across logout. **close/outcome contract**.
- `app-session-model.test.mjs` — model regression: local delivered commit retains its id across close. **close/outcome contract**.
- `app-session-model.test.mjs` — model regression: local delivered commit retains its id across logout. **close/outcome contract**.
- `app-session-model.test.mjs` — model regression: local delivered refusal retains its id across close. **close/outcome contract**.
- `app-session-model.test.mjs` — model regression: local delivered refusal retains its id across logout. **close/outcome contract**.
- `app-session-model.test.mjs` — model regression: a dispatched write keeps its committed outcome across logout. **close/outcome contract**.
- `effectful-cancellation.test.mjs` — effectful mutation, action and upload finish after sign-out cancels their callers. **close/outcome contract**.
- `effectful-cancellation.test.mjs` — effectful mutation, action and upload finish after close cancels their callers. **close/outcome contract**.
- `online-client-model.test.mjs` — online clients preserve R1–R6 across 3,000 seeded interleavings. **durable retirement contract**.
- `typing-expiry.test.mjs` — useQuery expires 4.5 s typing rows aged 0 ms before mount on both clients. **sampling race; fixed and retested**.

The expiry case failed both full runs with `fresh` undefined, then passed each
isolated rerun (1/1). Its last sample could catch J's valid later `loading`
transition after the expiry render. The test now captures both ready reads and
the DOM together in one browser turn; it keeps the original first-render
expiry deadlines and no-early-polling assertions. Both ages then passed (2/2),
with online/local lateness 5/1 ms and 3/2 ms. This is a test-only repair after
the quoted full-suite run; part-h qualification above supplies the subsequent all-suite result.
See `integration-r5g-typing-alone-2.log` and `integration-r5g-typing-fixed.log`.

The first full suite ended `== 2 failure(s) in 409 s`: `cargo test` and
`client tests`. K's sole Rust failure,
`simple_nullable_locals_and_row_reads_keep_nullability_and_laziness`, was the
authored-source rewrite mismatch fixed above. Its targeted retest and the
entire second Rust suite pass. The following additional first-run client
failures are now fixed and pass both targeted and second-suite checks:

- `app-store-replacement.test.mjs` — online app reopens after replacement; replacement accepts session: true. **Integration repair**, described in the file map.
- `app-store-replacement.test.mjs` — online app reopens after replacement; replacement accepts session: false. **Integration repair**, described in the file map.
- `app-store-replacement.test.mjs` — replacement waits for durable retirement of admitted writes; persistence fails: false. **Integration repair**, described in the file map.
- `app-store-replacement.test.mjs` — replacement waits for durable retirement of admitted writes; persistence fails: true. **Integration repair**, described in the file map.
- `app-store-replacement.test.mjs` — replacement pins retired receipt ids at the history limit (0 older unknown failures). **Integration repair**, described in the file map.
- `app-store-replacement.test.mjs` — replacement pins retired receipt ids at the history limit (8 older unknown failures). **Integration repair**, described in the file map.
- `app.test.mjs` — logout retry revokes a discarded login after its token-comparison read throws. **Integration repair**, described in the file map.
- `app.test.mjs` — online app keeps an unrotated bearer when refresh rejects before replacement reopens. **Integration repair**, described in the file map.
- `app.test.mjs` — online app keeps an unrotated bearer when refresh rejects after replacement reopens. **Integration repair**, described in the file map.
- `online-terminal-entrypoints.test.mjs` — app replacement never persists a late successor before probing the kept session. **Integration repair**, described in the file map.
- `page-observation.test.mjs` — native process devices bridge an inbox fetch and clear it offline and on account switch. **Integration repair**, described in the file map.
- `page-observation.test.mjs` — web IndexedDB device bridges the two-device inbox fetch in useQuery and usePage. **Integration repair**, described in the file map.
- `react.test.mjs` — AppProvider switches real clients, resets account state and routes existing mutation/query hooks. **Integration repair**, described in the file map.

Other qualification evidence:

| Check | Result |
|---|---|
| Full-count E/J models | All 13,000 sequences attempted; failures counted above. Not passing evidence. |
| Guide | 80/80 pass, including every compiled block without diagnostics or notes. |
| Joined shapes | 17/17 pass, including the continuing-arm refusal matrix and nullable/lazy rewrite. |
| J reviewer follow-ups | 10/10 focused tests pass; both additional dispatch-fence seeds pass. |
| Store replacement, terminal entrypoints, observation, React and expiry group | 52/52 pass. |
| Complete Clique | 3/3 simulator tests pass, including Following and the 5,000-input digest. |
| Issue tracker | 4/4 pass on the server and memory/SQLite devices, including reopen and the stopped constant-card counterexample. |
| P expiry | 30/30 focused tests pass after round 5. |
| Native smoke, witness driver and compiled README JS examples | 21/21 pass. Rust witness unit tests also pass in the full suite. No Linux simulator claim. |
| Docs | README 300/300 physical lines; all changed source files remain at or below 1,500 lines. |
| References | `ref-check: ok — 505 LLP docs, 9262 refs in 25818 files, 0 errors, 0 unchecked`. |

L's final witness ran all four ignored tests serially with
`SNAPBACK4_BENCH_ASSERT=1 SNAPBACK4_BENCH_MAX_RATIO=1.5`: **4 pass** in 42.57 s.
Five-follower post p95 was **2.549 ms**, 900-follower p95 **2.702 ms**,
ratio **1.060**. All twenty posts reached every follower in **7,466.965 ms**,
**7,428.470 ms** after the last acknowledgment. Eight sustained foreground
streams completed 6,043 home requests (p95 **3.417 ms**) while all 901 copies
arrived in **1,420.577 ms**. Earlier part-c ratios were **1.256, 1.234, 1.406**;
all were under 1.5. Production disk transactions retain `synchronous=FULL`.

Final wasm rebuild: Rust 1.97.0 / wasm-bindgen 0.2.127, no wasm-opt,
**1,765,796 B raw / 491,641 B gzip**. Part f was 1,760,451 / 490,643, so the
whole-artifact change is **+5,345 raw / +998 gzip**. The device now combines
J read availability and P authorization reservations, expired-predecessor
prediction deferral and proven alternate-delete absence. K compiler and JS
client changes add no device runtime. These are whole-artifact deltas, not
independent component attribution. P round 5 accounts for the separately
measured incremental +224 raw / +195 gzip. The old 491,000-byte limit was
exceeded by 641 bytes; **492,000** leaves **359 bytes**. Runtime meter ceilings
are unchanged. The budget file and final commit record this reason.

A preliminary targeted Rust run exhausted disk space (`ENOSPC`): environmental,
not a product failure. Cleaning only this worktree's generated package artifacts
with `cargo clean -p ...` reclaimed 12.7 GiB; rebuilding and rerunning passed.
An early model smoke used stale package `dist`; the required package build
corrected that setup error before every qualification result reported here.
The preliminary wasm gate correctly refused the inherited limit; the measured
ratchet above resolves it, without hiding a size failure.

Re-run the formerly conflicting contracts from `snapback4/` after the package build:

```sh
node --test packages/snapback4/test/app-local-outcomes.test.mjs packages/snapback4/test/app-outcomes.test.mjs packages/snapback4/test/effectful-cancellation.test.mjs
node --test packages/snapback4/test/app-session-model.test.mjs packages/snapback4/test/online-client-model.test.mjs
node --test packages/snapback4/test/app-receipts.test.mjs
```

Part h updates the model contracts only where the supervisor ruled and adds
store-bound replay. These commands now qualify that implementation.


## Limits retained from the lanes and their reviews

These quotations identify remaining limits, not new capabilities:

- **A**, final round-14 report: "No deviations or remaining round-14 functional
  problems." Its inherited missing ref was fixed in integration; current audit
  has no errors. Part e records the existing three compiler-analysis precision
  ignores and the calibration-packet-dependent survey; they are not passes.
  Astra a-d7's range-end test gap is closed by part e's emit/update end matrix.
- **F**, final round-6 report: "No engine changes or new open problems." Review
  f-d5's cancellation paragraph and hidden named-constraint gaps are closed by
  round 6; Bob's unrepost gap is closed by part a and retained here.
- **H**, final round-2 report: "No full-suite failures, design deviations, or open
  review items." Later Astra h-d3 calls out a "remaining nonblocking test gap":
  comments without a space after `--` were not separately pinned. It says
  "Current production code handles both correctly." No behavioral workaround.
- **J**, Grok j-d10: "No authorization, meter, journal-format, or spelling change."
  Both j-d10 reviews' token/restore/E_CONFLICT coverage gaps are closed here.
  J's terminal store outcomes remain unknown; the branch must not retry those
  intents. Its bounded receipt set can saturate and refuse new admissions while
  retaining admitted pending recovery; it is not unbounded history.
- **E**, [round 17](20260924-lane-e-round17.md): "Previously documented
  process-loss/total-storage-failure limits and bounded durable receipt retention
  remain. The model is seeded regression evidence, not an exhaustive proof."
  A refresh successor whose server reply is permanently lost cannot be recovered
  by this client protocol. **Both e-d11 reviews are NOT READY at the requested
  head.** Astra: "Local receipt-storage failure still discards a delivered
  outcome" and "Unpersisted receipts outlive notification deduplication."
  Reproductions: fail local keep_write while closing after a held sent response;
  or complete 257 writes with failed receipt saves, then write(firstId), observing
  a duplicate notification. Grok reports a peer opening the consumed predecessor
  after rotation persistence failed can fence/revoke the live successor. These
  are addressed as follows: part h fixes both Astra findings with real device
  receipt-save failure and 257-receipt regressions. The Grok consumed-predecessor
  scenario remains an inherited recovery limitation: a peer's authoritative
  refusal can fence that account epoch after failed rotation persistence. No
  authorization fence is relaxed to retain the successor. The non-aborted
  transport and caller-wait policy now follow the explicit supervisor ruling.
- **K**, final round-12 report: "The conservative handling of conditions and loop
  emptiness is the engineering choice requested by the soundness-first brief."
  Grok k-d10 identifies the precision limit: "an assignment after a conditional
  transfer still widens the carried type." `x=1; for n in [1,2]: if ready:
  if stop: break; x=null; return 0; return x+1` with proper indentation is
  conservatively refused. It has no runtime type-error admission. Both reviews'
  continuing-arm test gap is closed here. Mixed row kinds remain deliberately
  refused, and complex joins offer explanation rather than unsafe source edits.
- **L**, final round-3 report: "The intentional limitation is historical
  reconstruction." Redefining a populated materialized predicate or adding
  materialization over populated event/edge tables refuses atomically. Original
  repost identities cannot be reconstructed. Use planned views for retained
  populated sources. Astra l-d2's sole-holder test gap is closed by part c.
- **O**, final round-3 report: "an actual iOS simulator witness was not run on this
  Linux host." Both requested later review follow-ups (receipt deletion refusal
  and largest-cap mutation) are closed by part e. Grok o-d4 notes coverage gaps
  for reopening after an upload-triggered auth refusal and even-length buffer
  copies; it reports no new production defect. Session-model reopening checks
  are additional evidence but not an exact replacement for every upload case.
- **N**, [round-1 report](20260924-native-smoke/round1/README.md): "Physical
  devices, Android and deeper application behavior remain outside this smoke
  evidence." Linux checks here do not claim another simulator run. Grok n-d2
  notes the crash-after-done negative control covers restart, not each segment;
  production requires the live PID for every successful segment.
- **P**, [round-5 report](20260924-intent-lane-p-round5.md): "expiring-cap growth
  queues when physical occupancy is unknown; secondary expired collisions await
  sweep." Cap 1 plus an expired row omitted from a fresh snapshot cannot prove
  capacity; a new ID sharing its secondary key can refuse until sweep. Round 5
  fixes Grok p-d3's duplicate reservation and denied-delete charge gap. Astra
  p-d3's nonblocking coverage suggestion for a probing delete rule remains.
  [Round 4](20260924-intent-lane-p-round4.md) also retains "the separate presence
  heap issue": a two-principal absence conjunction followed by emit needs 1,967
  server heap bytes versus the recorded 1,961 device allowance.

Review quotations refer to `~/sb4-intent/reviews/<lane>-<round>.<model>.md`.
All part-g logs are `~/sb4-intent/integration-r5g-*.log`; earlier part reports
retain their exact run names and failure dispositions. Part-h logs use
`~/sb4-intent/integration-r5h-*.log`; the final qualification supersedes the
historical blocked results without rewriting the journal.
