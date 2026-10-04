# RH: retained-history publication order

The initial sections record round 0 (`0094fe7fd7`), which Astra rejected.
The **Round 1** section below supersedes its transport-cut shortcut and
adds the search publication rule. Round-0 verification remains historical.

Date: 2026-10-04. Host: eb1000 (`expose-builder-pixel`). Worktree:
`/home/ccheever/sb4-intent/lane-rh`, branch
`sb4-intent/rh-retained-history-order`, base
`b9624729aaa5c5d3ed380c247f415e7dc8d56f81`. No other host, worktree or lane
process was used. No push or publication.

## Defect and causal reproduction

An ordinary unknown-coverage read held 25 current messages at device watermark
4. After leave committed at sequence 5, its fallback returned the server's
correct authorized empty page. The SDK treated that page as a complete, fresh
replacement before applying the leave tombstone that made the 25 device rows
retained history. Initially composed/retained reads already reobserved; this
ordinary route did not.

`RH held leave` wraps the real wasm/process device and parks a scope page
**before** `core.call(apply)`. The server and mutation are unmodified. It checks
that the server's empty reply is complete and newer than the actual device
watermark, and waits for the observation attempt to finish through the SDK's
inspection counters. There is no sleep intended to win a race, no injected load in this
reproducer, no delayed leave mutation and no filtered subscription delivery.

On the unchanged product, ten repetitions failed on each host: **20/20 causal
failures**, always the asserted empty delivery. Both watches published
`[26,26,26,0]`. See [held-before.log](./held-before.log) and
`held-before-{1..10}.log` (the unnumbered initial run also failed both hosts).
The fixed held-order cases preserve the prior answer, then publish the device's
25 retained rows. The original R5 `assert.ok(!deliveries.includes(0))` remains.

The two additional real-host cases cover a device stalled past the existing
one-second revocation retention bound (loading is permitted; empty is not),
and catch-up that advances the watermark without touching any local rows.
A one-shot while leave is held returns 25 rows, incomplete and stale. An empty
catch-up re-evaluates a provisional 26-row server page and restores the complete 26-row
current page. Existing `serverRead` invalidation already provides this wakeup;
no new watch field or timer is needed. See [held-final.log](./held-final.log)
and [empty-catchup-final.log](./empty-catchup-final.log).

## Product change

`local.ts` exposes the applied watermark it already captured before a query
request for store-identity validation. This is an internal transport result;
the application contract and wire format do not change.

`local-query.ts::routeLocal` uses that cut for fallbacks whose possible read
dependencies include a synced `delivered-history` table. Unknown branches
retain static dependencies, and native programs conservatively cover every
table. Round 0 assumed that device commits between local evaluation and dispatch
invalidate the attempt through the authority fence. Astra disproved this for
other process owners of the same store; Round 1 replaces that assumption.

- A known complete local result, a query without a possible retained dependency,
  or a server reply at/below the captured applied cut adds no device call.
- Known retained compositions preserve their existing second observation and
  stale composition; they need the guard only if they become a whole-server read.
- For an ahead whole-server reply, read the actual device watermark once. If caught up,
  reobserve locally and apply the current/retained rule again, including newly
  retained independent components. New row-level retention without the requested
  server identity envelope keeps the permitted local subtree.
- If still behind, an empty page keeps the permitted local non-speculative
  value, `complete: false, fresh: false`, or loading. A positive server array
  remains useful with those same provisional flags and its server deadlines.
  Structured answers keep the local value, protecting empty nested history.
  No provisional result is remembered. Its accepted cut orders cache retirement,
  and it conveys no server delivery manifest.
- Explicit server refusals win immediately. Every added await crosses the same
  session, incarnation, authority, prediction, credential and expiry fences.

There is no additional catch-up wait or polling mechanism. Sync reroutes served
observations, including empty published pages. Existing notified-cut/scope
fences can prevent old partial data from replacing a watch, and the existing
revocation bound withdraws stale retained observations if sync stalls. One-shots
return permitted partial data promptly, or use their existing bounded
loading/retry/refusal procedure. History grants no new server authority.

The change is deliberately conservative for a retention-sensitive query whose
server cut is ahead because of an unrelated write. Without the applied cut,
the SDK does not claim that the device's current/retained route has stayed the
same. This cost is measured below.

## Verification

- Deterministic real-host held order: both hosts fail on the original product;
  both pass with the fix, including stall and empty-catch-up cases.
- 36 evaluator regressions (included in [routing-final.log](./routing-final.log)): routing changes, missing ordering
  evidence, static/native dependencies, refusals, cache custody, fast-path await
  counts, and each publication fence at the new state await.
- Initial affected run: **338/338**, [log](./affected-initial.log).
- Broader routing/query/publication run: **342/342**, [log](./routing-final.log).
  Includes prediction, Following, remembered answers, session transitions,
  existence and live propagation, alongside the new evaluator cases.
- Decorated search, ordinary history, and evaluator regressions: **107/107**,
  [log](./composition-final.log). The unchanged generated oracle covers both
  hosts and all 12 seeds, including blank-needle current/retained decoration.
- Reset/incarnation regression file: **60/60**, [log](./store-reset-final.log).
- Delivery await census: **1/1**, [log](./await-census-final.log). The new
  watermark and routing awaits read query state only; no admission, dispatch,
  persistence, settlement or delivery fault site changed.
- Full retention file under four CPUs plus one hog: **30/30**, all **2,220**
  cases pass, zero skipped/cancelled, in **1867.048 seconds**. Each run
  includes every original scenario and all six new real-host cases. The harness
  checks the owned hog's liveness and exact affinity before every repetition.
  [Driver](./stress.py), [results](./stress.json), logs `stress-{01..30}.log`.
  Command from `snapback4/`: `taskset -c 64-67 python3 reports/20261004-rh-retained-history-order/stress.py`.
  Repetitions run serially; each complete file has 74 cases.
- **Full suite passed**, `bash snapback4/scripts/test.sh`: **zero failures in
  2,251 seconds**, exit 0. Rust: 4,972 passes / 33 inherited ignores, plus 17
  passing doctests (941 seconds). All nine fixture wrappers pass. All **312
  client files pass: 6,246 tests passed, 11 inherited skips, zero
  failures/cancellations** (926 seconds). Both final model files pass,
  **79/79** (318 seconds). Builds, typechecks, release guard, docs and wasm
  budget checks all pass. [Final log](./full-suite-final.log).
- Initial diagnostic full run completed in 2,954 seconds, exit 1:
  Rust 4,972 passes / 33 existing ignores with green doctests; 312 client files,
  six failed; both final model files passed (403 seconds).
  [Initial log](./full-suite.log). Implementation changed while that diagnostic
  run was active; it is not claimed as qualification. The final run uses frozen
  runtime/test sources identified by `source-sha256.json`.
- `./ref-check --verbose`: exit 0; [log](./ref-check.log).

The [first full-suite attempt](./full-suite.log) caught regressions from applying the hold too
broadly: existing retained browse lost current rows/decorations, and a new DM
before acquisition returned the device's empty prefix. The final guard preserves
known stale compositions and offers positive server pages provisionally. The
existing assertions remain unchanged. This attempt also flagged the delivery
await census (now explicitly classified), two reset-fixture checks whose
mock query replies omitted `seq` (now set to the same cut as the mock snapshot;
assertions unchanged), and direct fixture `fetch failed`
errors in mixed-evidence and keep-app models; the final full run is reported
separately.

The first final-candidate stress batch hit a separate exact-count assertion in
`MQ local branch wasm` on run 4 (three device evaluations instead of two).
R5 and both hosts' held-leave cases passed. A 100-case trace identifies a
buffered `/changes` response calling `LocalReads.notified` during the held
expiry read. **The unchanged base also failed 3/100** with that same trace;
see [baseline control](./expiry-control-baseline.log) and
[control generator](./expiry-control-prepare.mjs). Only expiry branch/page
fixtures now park `/changes` from startup, retaining explicit sync and the
strict two-evaluation assertion. R5/RH continue using the live feed. The
isolated control passes **100/100**, recorded in [expiry-control-after.log](./expiry-control-after.log).
The interrupted four-run batch lives in `expiry-control-stress/` and does not
count toward the required final 30. Product bytes did not change for this
fixture repair.

Exploratory contention batches under `initial-stress/`,
`wakeup-control-stress/`, and `composition-control-stress/` were interrupted
while refining the candidate and are excluded from the final 30-run claim.

## Ordinary live latency

[latency.mjs](./latency.mjs) compares the actual base and fixed client routers
against one real server and paired real devices. It transpiles the two changed
base modules from the pinned base commit into temporary, private module names,
then removes them. Each mode has one mounted watch per client. Both see the same
mutation; the measurement starts at mutation invocation and ends at the first
matching complete, non-revalidating observation. Both devices sync before the
next trial. Ten warmups are discarded. The modes are a complete retained-table
point read, an online-only point read, and a current history page beyond the
device horizon. No UI/render or production-service latency claim is made.

Commands (CPUs 72–75, independently of the stress and suite CPU allocations):

```sh
RH_RUNS=300 taskset -c 72-75 node --test reports/20261004-rh-retained-history-order/latency.mjs
RH_RUNS=300 RH_REVERSE=1 taskset -c 72-75 node --test reports/20261004-rh-retained-history-order/latency.mjs
```

Each table cell is milliseconds. Each creation order has 300 measured pairs
per host/mode (600 pairs total per host/mode):

| Host / query | First order p50, base → fix | Reversed order p50 | First order p95 | Reversed order p95 |
| --- | ---: | ---: | ---: | ---: |
| wasm / known-local | 5.85 → 6.05 | 6.04 → 6.08 | 8.16 → 8.38 | 8.96 → 9.05 |
| wasm / server-only-source | 7.72 → 6.19 | 6.28 → 7.58 | 12.93 → 12.93 | 11.56 → 12.15 |
| wasm / current-history-fallback | 8.07 → 9.78 | 5.35 → 10.19 | 12.25 → 13.72 | 12.87 → 15.53 |
| process / known-local | 5.78 → 5.85 | 5.71 → 5.68 | 8.96 → 8.88 | 7.75 → 7.37 |
| process / server-only-source | 7.80 → 7.93 | 7.61 → 7.82 | 13.18 → 17.77 | 11.37 → 11.71 |
| process / current-history-fallback | 8.05 → 8.60 | 9.11 → 9.57 | 11.61 → 13.38 | 12.07 → 13.33 |

Pooled 600-pair p50, base → fix: wasm complete-local **5.97 → 6.08 ms**,
wasm server-only **7.15 → 7.14 ms**, process complete-local **5.74 → 5.75 ms**,
process server-only **7.72 → 7.86 ms**.

Complete-local p50 changes by creation order are −0.03 to +0.20 ms. The wasm server-only
p50 difference reverses with creation order (−1.53 / +1.30 ms); process moves
+0.13 / +0.21 ms. Tail shifts also vary with host load and order. The ordinary
paths add no asynchronous call, verified separately by evaluator regressions;
these shared-host measurements show no consistent ordinary-path slowdown,
not an exact zero-overhead guarantee.

The retention-sensitive current-history fallback is intentionally provisional
when it races sync. Its time to a **complete** answer grows by 1.71–4.84 ms
at wasm p50 and 0.46–0.54 ms at process p50. Positive partial pages can arrive
earlier; the measurement does not count those as complete. These queries can
change routing after a leave, so accepting a newer page as immediately complete
is the old ordering error. No fixed delay was added. This cost is limited to
an uncertain cut; a caught-up fallback retains its original device-call count.

[Raw paired samples](./latency.json),
[opposite creation order](./latency-reverse.json), and their `.log` files retain
all measurements. Earlier 100/300-pair controls are named `latency-initial`,
`latency-wakeup-control`, and `latency-composition-control` and are separate evidence.

## Wasm and resource use

Locked build: Rust 1.97.0, wasm-bindgen 0.2.127, Binaryen 132.0.0. No Rust or
schema/IR change. The wasm is **2,116,457 B raw / 639,750 B gzip**, against the
unchanged **639,887 B** ratchet. Headroom is 137 B, preserving the full recorded
130 B macOS allowance with 7 B beyond it. No macOS build is claimed.
[Measurement and SHA-256](./wasm.json), [build log](./wasm.log).

The initial full suite uses CPUs 32–47; the final run uses CPUs 32–63. Both use `CARGO_BUILD_JOBS=12`,
`CARGO_PROFILE_DEV_DEBUG=0`, `CARGO_PROFILE_TEST_DEBUG=0`, and
`CARGO_INCREMENTAL=0`. The product wasm profile/toolchain is unchanged.
Final sampled worktree disk peak: **15.229 GB**, below 40 GB.
The owned stress hog exited; temporary trace/baseline modules were removed.
Samples are retained in [disk-samples.jsonl](./disk-samples.jsonl).

## Governing context and documentation

Read `snapback4/AGENTS.md`, LLP 3000 and the LLP 2000.000 design brief,
`rules/RULES.md`, `NOT-DOING.md`, the journal, `guide sync`, `guide reads`, and
the original ticket. Applied `llp-orient` to the router's cited decisions.

The scoped constraints are LLP 3000.028 §2.1/§3.2 (server authority versus
retained device history), LLP 3000.001's retained composition section,
LLP 3000.007 §6.5/§20.22.1 (unknown coverage and recovery), LLP 3000.014 §5
(engine identity for row composition), LLP 3000.016 §2.2/Own edge publication
(publication and prediction), LLP 3000.018 §3.2 (ordered memory),
LLP 3000.019 §3.3 and LLP 3000.023 §10–11 (retention and one-shot bounds),
and LLP 3000.031 §1.1 (absence). The current working set links 3000, .007,
.013, .019, .023, .028 and .031; none of these is linked in `foundation/`.
The other cited decisions remain at their permanent corpus paths.

Updated LLP 3000.028 §3.2, with matching pointers in LLP 3000.013 §13.2 and
LLP 3000.001's composition procedure. No unresolved design hand-off; no new LLP,
contract vocabulary, delivery authority or runtime meter ceiling.

The ticket is closed under `issues/closed/`; its resolution and the journal entry
land with this change. Final runtime and
regression source hashes are recorded in [source-sha256.json](./source-sha256.json).

## Round 1 — evaluation cuts and ordinary search

This round starts at `0094fe7fd72cf35790cf9935bbc7047b2cfb5b07`, following the
operator's NOT READY Astra review. The received [review](./round1/astra-round0-review.md)
is preserved verbatim; its original location was
`/home/ccheever/sb4-intent/reviews/rh-r0.astra.evidence/REVIEW.md`.
All execution remains in this worktree on eb1000. No other lane's worktree or
process was modified. The baseline is a source export inside this worktree's
ignored `snapback4/target/`, not another lane or checkout.

### Changes and routing audit

The engine now reads `watermark` **inside the query's read transaction** and
returns it with the coverage decision. `routeLocal` compares the server cut
with that evaluation cut. The transport's later identity capture remains in
place but no longer supplies the routing shortcut. Other owners can commit
without changing this SDK owner's authority revision. A same-owner checkpoint
therefore cannot substitute for transaction evidence. Missing/invalid metadata
uses the conservative path. No extra device call was added to equal/older cuts,
complete local answers, or queries without possible retained dependencies.

The same distinction applies to the second observation of a known composition.
If it switches to a whole-server route, a state read after that observation
cannot validate an older evaluation. If another retained field remains, an
empty server field cannot erase the permitted device rows of a still-unknown
sibling whose retention route is pending. Those rows remain provisional;
speculative rows withhold the atomic answer. Positive current fields retain
normal composition, original refusals win, and no extra HTTP request is made.

For ordinary non-blank search, `search_state` now returns its watermark and
acquired current scope keys from the membership transaction. Stable closing
`delivery`/`epoch` values only prove stability during the attempt. For a newer
server cut, the complete authorized `searchScopes` opening can additionally
prove that every acquired current scope remains current. This preserves normal
search pagination after current edits and unrelated writes without another
host call. Both the proof and any fallback use the existing shared meter.

If that proof is unavailable, positive merged rows are provisional with no
continuation. With no server/retained hits, one ordinary device query includes
its still-current acquired matches at the consumed position. It resumes the
same ledger; its receipt is returned whenever `spent` was supplied. Permitted
matches remain visible, partial and stale. Missing usable values stay loading;
normal bounds and one-shot settlement limits remain in force. No second server
request, cache entry, delivery manifest, cursor advance or meter reset is added.
The final publication procedure still checks authority, session, incarnation,
credentials, predictions, expiry and cancellation.

| Route / caller | Ordering coverage |
| --- | --- |
| Ordinary query, blank search, plain cursor | `routeLocal`, with transaction evidence from the relevant evaluation. |
| Known components / retained row masks | Existing second observation and provenance merge; whole-server transitions use the second cut. Empty pending sibling arrays preserve permitted rows. |
| Non-blank ordinary/decorated search | Opening cut or complete membership proof; closing delivery/epoch and all existing identity/audience fences. |
| One-shot, mounted/new watch, page chain | The same evaluator; Pages obtains its constituent reads through `observe`. |
| Combined search cursor | Changed audience/identity withdraws the suffix and refreshes its root; a stalled one-shot uses the existing bounded refusal. |
| No executable current partition / unavailable guest | Existing Rule 3 plus store/adoption identity fences. This is not a locally certified current/retained decision. |
| Cold acquisition bypass | Only an already server-answered, unacquired watch. Provisional retained-sensitive answers are ineligible. |
| Ephemeral query | Explicit whole-server law of LLP 3000.017 §2.3; durable retained history is a separate query. Ephemeral incarnation/expiry gates are unchanged. |

LLP 3000.028 §§3.2–3.3 now record both paths and remove the incorrect
unconditional same-owner fence assumption. LLP 3000.013 §13.2 points to both publication
rules. The root R5 no-empty assertion remains unchanged.

### Deterministic evidence

`retained-history-cut.test.mjs` uses real device calls and real server mutations.
Another SDK owner commits between evaluation and dispatch; process uses two
actual processes over one SQLite directory. Wasm's persistence is exclusive,
so two SDK callers share its actual core rather than pretending that two tabs
own one IndexedDB store. The read reply is held outside the core's transaction;
no query rows, cuts or server responses are fabricated. Same-owner controls,
plain cursor reads, and both whole-server and still-composed second-observation
races are included.

`retained-search-order.test.mjs` holds the real scope page before apply, proves
that the server's empty reply is ahead of the device, then exercises one-shots,
new watches and a new Pages root. Retained matches remain nonempty and carry
`complete: false, fresh: false`. Existing combined cursors exercise the separate
binding withdrawal. Releasing the page restores ordinary retained routing.

The [baseline builder](./round1/build-baseline.sh) reconstructs the full
round-0 SDK, native binary and wasm. All six original gap cases fail in each of
five runs: **30/30 expected failures**, with no load dependency
(`round0-devices-negative-{1..5}.log`). Both additional shared-composition variants also fail five times on each
host: **20/20 expected failures**, in `round0-composition-negative-{1..5}.log`
and `round0-sibling-negative-{1..5}.log`. Together these are **50/50 causal
negative controls**.
The initial source-only loader controls are diagnostic; the rebuilt-device
controls are the stronger evidence. The [artifact hashes](./round1/artifact-sha256.json)
and [source hashes](./round1/source-sha256.json) identify the measured inputs.

### Round 1 verification

The four-CPU contention batch passed **30/30**, **129 cases per run / 3,870
passes**, with zero failures, cancellations or skips. Each run included
`retained-history.test.mjs`, both new host regression files, and the evaluator
ordering tests, under `taskset -c 64-67` with one owned CPU hog on the same mask.
The driver verifies the hog's affinity and liveness for each run and reaps it
in `finally`. Elapsed time: **1,804.896 seconds**. See the
[run summary](./round1/stress-summary.json), [driver](./round1/stress.py),
and `stress-{01..30}.log`.

Focused client routing/query verification passes **395/395**
([log](./round1/routing-query-verified.log)); the evaluator/shared-cut batch
passes [**51/51**](./round1/evaluator-shared-final.log); search ledger
[**45/45**](./round1/search-ledger-only-final.log); the added await-site census
and transient/persistent faults [**3/3**](./round1/await-new-site-final.log).
The updated continuation review probes pass
[**14/14**](./round1/review-probes-final.log). The reference check reports **527 LLP documents, 10,362
references, zero errors and zero unchecked references**.

The final **`bash snapback4/scripts/test.sh` passed**, exit 0, **2085 seconds**
([full log](./round1/full-suite.log), [qualification summary](./round1/qualification.json)):

- Rust: **4,972 tests + 17 doctests passed**, 33 ignored, zero failures.
- Client pool: **314/314 files**, **6,269 passes**, 11 skips, zero failures or
  cancellations. The original R5 assertion and all new regressions pass here.
- Fixture wrappers: **9/9**. Final model files: **79/79**.
- Build, wasm budget, release guard, package/app typechecks and docs budget pass.

The command used `taskset -c 32-63`, `CARGO_BUILD_JOBS=12`,
`CARGO_PROFILE_DEV_DEBUG=0`, `CARGO_PROFILE_TEST_DEBUG=0`, and
`CARGO_INCREMENTAL=0`. Focused routing/query tests used CPUs 68–71 and
`--test-concurrency=3`; contention used its separate four-CPU mask. No counts,
iteration bounds or timeouts were reduced. Source and artifact hashes still
match the measured inputs after the final suite. The owned CPU hog was reaped,
and the suite cleaned up its process groups and scratch directory.

Final worktree usage: **21,879,369,286 bytes**; largest recorded sample:
**21,879,369,286 bytes (21.88 GB)**, below the 40 GB limit.
[Disk samples](./round1/disk-samples.jsonl) include both qualification runs.
No other host or lane was used for execution; nothing is pushed.

Diagnostic runs are retained rather than counted as final qualification.
Captured logs normalize only trailing whitespace and blank lines at EOF;
all subtest results and diagnostic output are preserved.
The first search guard discarded valid cursors on unrelated edits; the
membership proof corrected it. An overbroad no-executor guard broke store
replacement reads and was removed; the replacement controls pass unchanged.
One early stress overlapped the full suite's temporary wasm-output replacement
and saw ENOENT. Subsequent stress starts only after the build phase. The
pre-second-cut and pre-codec batches were interrupted when the audit found
more work. Their logs live in their explicitly named subdirectories.

The first full-suite run also exposed two old continuation assertions that
expected a fresh root cursor while the leave remained unapplied. The review
probe now requires partial/stale/no-cursor before apply, then checks identical
current first-page rows and the changed audience cursor after apply. Windowed
retained coverage remains partial. Its original stale-suffix refusal assertions
are unchanged. The updated file passes 14/14 independently; the initial suite
log is preserved separately from final qualification.

### Round 1 latency and wasm

The [latency driver](./round1/latency.mjs) compares separate complete old/new
SDK and device runtimes against the same real server, including different wasm
module instances and native device binaries. It measures mutation invocation
to the first matching complete, non-revalidating live answer, with ten warmups,
300 paired mutations per creation order, and both orders. Controls cover a
complete retained-table point, an online-only point, an ordinary history
fallback, and ordinary non-blank search. This is local host evidence, not a
production/UI latency claim.

The [final samples](./round1/latency-summary.json) contain 600 paired mutations
per host/mode (4,800 pairs total). Values below are milliseconds, round 0 →
round 1. Commands use CPUs 72–75, `RH_RUNS=300`,
`RH_MODES=known-local,server-only-source,current-history-fallback,current-search`,
then the same command with `RH_REVERSE=1`.

| Host / query | Pooled p50 | Pooled p95 |
| --- | ---: | ---: |
| wasm / complete local | 8.112 → 8.229 | 12.751 → 12.781 |
| wasm / online-only source | 7.613 → 7.621 | 15.950 → 18.964 |
| wasm / current history fallback | 11.364 → 11.552 | 28.646 → 18.371 |
| wasm / ordinary search | 11.186 → 10.881 | 23.936 → 20.784 |
| process / complete local | 12.268 → 11.289 | 21.459 → 18.589 |
| process / online-only source | 10.979 → 8.959 | 19.526 → 19.033 |
| process / current history fallback | 14.378 → 13.338 | 35.104 → 26.080 |
| process / ordinary search | 14.267 → 13.068 | 33.776 → 23.652 |

There is no new round trip or awaited host call on the ordinary safe paths;
the evaluator tests pin those call counts, and the search ledger tests pin one
HTTP invocation and no fallback device query when membership is proved current.
The ordinary point controls' largest pooled median increase is **0.117 ms**.
The whole artifacts include the new transaction metadata work. These shared-host
samples do not establish zero overhead or a speedup: tails vary, including a
**3.014 ms** higher wasm online-only p95, and individual paired delivery order
also varies. Raw creation-order results and paired differences are retained;
no outliers were removed. Pre-codec measurements are historical and excluded.

Final measured wasm: **2,117,335 B raw / 639,810 B gzip**, versus rebuilt round
0's **2,116,457 / 639,750**: **+878 raw / +60 gzip**. The budget rises **53 B**
to **639,940 B**, retaining exactly the recorded **130 B macOS allowance**.
No macOS machine was used. The runtime ceilings are unchanged.

The first search scope encoding introduced an extra borrowed-string serializer;
it now reuses the existing owned-string envelope serializer. The attribution
check also exposed an **inherited** `i64` dynamic-envelope serializer omission,
reproduced on the unmodified round-0 artifact (`baseline-attribution.log`).
The exact scalar is now admitted alongside the existing string scalars;
regressions still reject owned typed containers, borrowed-string duplication
and non-text decoders. This tooling correction changes no runtime bytes.
Eb1000 lacks the standalone Brotli executable, so the final measurement uses
the checked-in [local CLI equivalent](./round1/brotli.mjs), Node's built-in
Brotli at quality 11. The earlier missing-command log is not a Brotli result.
