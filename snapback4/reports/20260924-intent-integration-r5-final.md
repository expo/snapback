# LLP 3000.013 — integration round 5

Branch `sb4-intent/integration`, worktree `~/sb4-intent/lane-i`.
No push, version bump or publication. **Not a release candidate yet:** E and J
specify incompatible close and receipt-persistence outcomes. This report records
the concrete boundary instead of weakening either model to obtain a green suite.

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
| `src/app-online.ts` | Keep J pinned retirement IDs/saturation and bulk retirement, E deferred activation and retained known outcomes after receipt-save failure. The incompatible outcome requirements remain explicitly blocked below. |
| `src/client.ts` | Keep J store/read floor and response consumption without transport abort, O upload session validation/copy/retry, E dispatched-outcome guards. Terminal store changes retain their explicit action refusal. Close semantics remain blocked. |
| `src/local.ts` | Keep J LocalReads/fallback and non-aborted effect transport, E deferred start/rotation and settlement tracking, O cleanup/refusal handling, N onClient hook. Exactly 1,500 lines after the merge. |
| `test/app.test.mjs` | Keep both regression sets. |
| `test/client-lifecycle.test.mjs` | Retain no-abort and late-body consumption checks; E's shared assertion expects pending for a cancelled unreceived result and sent for an already applying acknowledgment. J's separate effectful-cancellation tests retain E_CLOSED; they expose the unresolved conflict rather than being weakened. |
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

## Blocked client contracts

1. **Close versus held dispatched outcomes.** J's
   `client-lifecycle.test.mjs` test `close cancels online write callers without
   aborting committed delivery` awaits close before releasing the response and
   requires the caller to stop waiting. J's local-close tests similarly reopen
   while the body is held. E's `app-local-outcomes.test.mjs` requires close to
   remain unfinished until that same held response is released, and its
   `app-outcomes`/I12 tests require the original sent/failed result after close.
   E's raw online action test also requires the later held result. A network
   request has no observable "committed remotely" state before its response.
   Satisfying both for the same event schedule needs a supervisor contract ruling;
   waiting indefinitely or silently weakening either assertion is not integration.
2. **Known terminal result versus durable retirement.** E I13 retains and returns
   the server-confirmed terminal result when `.writes` receipt persistence fails,
   leaving the durable pending intent for same-ID recovery. J R3 asserts that any
   returned terminal result has already removed that durable pending intent and
   cannot be reposted, including after restart. Seed 48 (app tier) commits a
   write, fails retirement storage and observes its result. It cannot both
   return terminal now and have committed a store write which failed. This is
   independent of transport close. Reproduce the named E receipt-failure tests
   and J's full model or seed 48 with its existing generator/options.

An asynchronous question requested a ruling; none is assumed from elapsed time.
No invariant assertion is skipped, relaxed or changed to conceal these conflicts.
Full-count audit runs the existing execute/generate functions, catches each
sequence's assertion only to continue through all requested seeds, and reports
failures. It is additional failure evidence, not a passing model run.

The final full-count audit completed all 13,000 requested sequences:

| Model | Attempted sequences | Failed sequences | Invariant |
|---|---:|---:|---|
| E online | 5,000 | 84 | I12: a dispatched result became pending at close. |
| E real wasm local | 5,000 | 73 | I12: the same held-result conflict. |
| J alternating raw/app | 3,000 | 11 | R3: seven terminal results retain durable pending intent; four terminal IDs repost after restart. |

The audit uses the exact generators and journal options from the model tests;
its runner is `~/sb4-intent/integration-r5g-model-audit.mjs`, and its complete
output is `~/sb4-intent/integration-r5g-model-audit-final.log`. Each failing
sequence stops at its first assertion, then the audit proceeds to the next seed.
The ordinary test runner also remains red; neither the supplemental audit nor
passing individual schedules is a claim that either complete model passes.
The two R2 dispatch failures found in the first audit are fixed and named above;
none remain in the final 3,000-sequence audit.

## Release checks and failure accounting

The last full suite completed with exit 1 and this exact summary:

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
the quoted full-suite run; no subsequent all-suite green result is claimed.
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

Reproduce the contract failures from `snapback4/` after the package build:

```sh
node --test packages/snapback4/test/app-local-outcomes.test.mjs packages/snapback4/test/app-outcomes.test.mjs packages/snapback4/test/effectful-cancellation.test.mjs
node --test packages/snapback4/test/app-session-model.test.mjs packages/snapback4/test/online-client-model.test.mjs
node --test packages/snapback4/test/app-receipts.test.mjs
```

The last command currently passes E's intentional failed-persistence behavior;
J seed 48 rejects that same boundary. No timeout increase, assertion removal or
receipt loss is used to make the incompatible contracts appear compatible.


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
  remain review findings, not silently dismissed by the bounded model. Its
  transport-abort finding meets J's non-aborted transport here; the incompatible
  caller-wait policy still needs the ruling above.
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
retain their exact run names and failure dispositions. The design conflicts
above prevent the requested 0-failure release claim; the integration branch
must not be published on this evidence.
