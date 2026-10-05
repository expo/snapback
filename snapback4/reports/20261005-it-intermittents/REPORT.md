# Lane IT — intermittent client failures, 2026-10-05

IT fixes one product race and four fixture races. The 1,020-run baseline is
complete; all four changed files pass 60/60 final complete-file hog runs. Historical
transport/retained-order/overflow causes and NZ's Mac event remain open.
The first full suite passed; the later suite failed with storage exhaustion
and an incomplete collected log. **There is no green final-suite claim.**
Only eb1000 has been used. No other worktree, process or simulator is modified.
The source base, immutable baseline hashes and CPU measurements are in
`baseline/manifest.json`; the governing constraints are in [ORIENTATION.md](./ORIENTATION.md).
Inputs: [AP ticket](../../../issues/20261004-snapback4-intermittent-client-suite-failures.md),
[FX round-2 failures](../20261004-fx-test-races/round2-failures.json),
[RH's existing MQ investigation](../20261004-rh-retained-history-order/REPORT.md),
and [NZ's retained ticket/record](historical/manifest.json).

| Failure | Classification | Evidence | Fix | Result |
| --- | --- | --- | --- | --- |
| `server-e2e`: recovery attempt 3 / `[1,2,3]` | (a), a one-second fixture lease also expires a live recovery attempt | A 1,200 ms pause after the second attempt's mutation reproduces the exact third-attempt assertion and `E_ACTION_LEASE`. The uncertain provider callback still runs only once. | Both deliberate-crash fixtures use the normal 60-second lease. After observing the killed owner exit, the fixture expires only that invocation's first lease in its own SQLite store; ordinary server maintenance reclaims it. All exact attempt, replay, provider-key, callback, receipt and parked-work assertions remain. | Delay control passes both crash tests; 60/60 complete-file hog runs pass with the fixture change alone. **60/60 final-product complete files pass**, zero failures. |
| `ephemeral-e2e`: reported disappearance about 6 s | (a) for the reproduced measurement race; historical Mac event remains unclassified | Delaying the empty reply by 2,100 ms fails the original assertion at 6,124.973 ms, although the row was withdrawn at 3,825.713 ms. | Measure B's last visible row, including withdrawal to loading, as LLP 3000.017 §4.7 requires. Separately require a settled empty answer so a stranded watch cannot pass. | All five delayed-reply trials pass at 3,823–3,826 ms withdrawal and 6,121–6,128 ms empty settlement. A counterexample keeping the row visible for 5,929.840 ms still fails. 60/60 complete-file hog runs pass with the fixture change alone. **60/60 final-product complete files pass**, zero failures. |
| `read-through-provenance`: A,B,C instead of A,C,B | Transport fallback reproduces the signature; original transport cause still open | An injected `UND_ERR_CONNECT_TIMEOUT` on the SDK's `/q/outer` call produces A,B,C on both wasm and process, `link=offline`, `fresh=false`, `complete=false`, with old retained rows. The earlier direct server read can succeed independently. Historical failing duration was 11.197 s. | No ordering assertion weakened and no retry added. | 60/60 complete baseline files pass; the historical cause remains open. |
| `sync-overflow`: missing `E_BOUND` | Transport interruption reproduces the signature; original cause still open | Interrupting the final `limit=1` legacy sync request leaves watermark 1 but produces exactly `undefined` rather than `E_BOUND` in the existing assertion: the reply containing that refusal was never received. | No fabricated refusal or retry. | 60/60 complete baseline files pass; the historical cause remains open. |
| `retained-history`: MQ count 3 rather than 2 | (a), already repaired on main by RH, `0094fe7fd7` | RH retained an actual `LocalReads.notified` stack from a buffered `/changes` reply during the held expiry query, with 3/100 unchanged-base failures and 100/100 after the fixture barrier. [Existing evidence](../20261004-rh-retained-history-order/REPORT.md#verification). | Existing branch/page fixtures park the change feed from startup and retain explicit sync and the exact two-evaluation assertion. No new change needed. | IT: 60 focused watch controls pass with 50 ms held-response contention; 60/60 complete baseline files pass. |
| `read-existence-integration`: wasm same-key condition guard | (b), stale unknown pending-write cache after an unchanged sync | Delayed `/q/item`, `/sync` or `/changes` timing probe: 4/60 guard failures, each after deletion became absent then partial. A deterministic no-op sync regression fails on both process and wasm, with `data=null`, `complete=true`, `fresh=true`, but `existence=partial`. | After applying sync, refresh pending metadata through the existing fenced queue read even if no row changed. Keep every overtaken-queue/admission fence and avoid reevaluating unchanged queries. | 60/60 identical timing controls pass; 81 focused assertions and transient/persistent read-failure controls pass. **60/60 final-product complete files pass**, zero failures. |
| `worker-regressions`: cleanup `kill ESRCH` (new signature) | (a), owned descendant exits between the liveness check and cleanup signal | Baseline run 44: all descendant-stop assertions pass, then the after-hook fails at the cleanup `process.kill`; 76/77 cases pass, native exit 1. | Accept only `ESRCH` from that final owned-process cleanup signal; propagate other errors. No retry or descendant assertion changes. | **60/60 final complete worker files pass**, 4,620 assertions, zero failures. |
| `worker-regressions`: `DROP TRIGGER` reports database locked (new signature) | (a), fixture DDL races an active server SQLite writer | Cleanup-only phase run 3 fails after the original credentials are correctly refused. Holding a separate writer for 100 ms reproduces the same SQLite error on the baseline. | Acquire the fixture writer through the existing bounded lock helper before installing/removing its retirement-failure trigger; commit that DDL atomically. No product operation or assertion is retried. | The held-writer control passes 60/60 selected cases; **60/60 final complete worker files pass**, zero failures. |
| Late qualification: `ENOSPC` / `E_STORE: database or disk is full` | (c), observed storage exhaustion; not attributed to the historical transport failures | Six stressed worker files fail with explicit storage-exhaustion diagnostics. The later full-suite model runner cannot create its fixture directory (`mkdtemp`, `ENOSPC`); the filesystem reports 100% use, with ample free inodes. | Remove only this lane's completed private Cargo intermediates and completed scratch snapshots. Keep the refusal and native failures; no test retry or invented readiness success. | Baseline loses 2 files and the intermediate worker phase loses 4 to this event. Later full suite exits 1; collected log is incomplete. See the custody limitation below. |
| Raw `fetch failed`, `UND_ERR_CONNECT_TIMEOUT`, worker readiness | Unclassified | The stress probe logs underlying fetch/connect errors, loop delay, process FD limits/counts and kernel socket/TCP counters. It rethrows each error and never retries. | None guessed. | No historical transport signature reproduced in the 60-file controls or denser startup controls. The new storage-exhaustion event is classified separately below. |

The failed initial worker-fixture experiment using `/dev/clock/advance` is not
qualification: the documented dev clock intentionally shifts worker leases as
well, so it cannot expire a dead claim. The final fixture moves only the dead
first claim's lease deadline; it does not modify its state, attempt count,
provider step or originating authority.

The reproduced third attempt occurs when the healthy recovery attempt loses
its short lease, before terminal parking. It is not evidence that a terminal
parked invocation starts again without an operator disposition.

The stale retained fallback and missing-overflow-refusal probes demonstrate
specific permitted paths to those assertions. They do **not** prove the original
network cause, and they do not classify every similar failure as environmental.

All named complete files, including the seven FX transport-error consumers,
ran 60 times with their original case/seed counts. Each baseline runner and its two busy
Node processes inherited one four-CPU `taskset`. Later final-worker groups
share this lane's allocated masks and have one additional hog each; the
manifest records the overlap with the earlier phase. CPU samples precede allocation;
the existing file-owner runner retains custody and verifies cleanup. Baseline
sources/binary are copied privately so fixes cannot mutate running controls.
No failing test or operation is retried by the stress driver.

Initial Linux wasm: **2,117,335 B raw / 639,807 B gzip**, cap **639,941 B**.
The product change is JavaScript only; wasm remains unchanged. The full suite's
wasm rebuild also measures **2,117,335 / 639,807 B**. The cap retains at least
the required 130 B macOS allowance; no cap increase is needed.

The same-key failure is a liveness defect, not missing data. Every device apply
clears the cached pending predicate. An unchanged page has no affected table to
trigger another query, so a complete empty answer can remain partial until
some unrelated queue read refreshes that cache. One parked-feed control did
recover after 5.6 s; four timing controls exhausted the ordinary 122 s guard.
The deterministic regression checks absence after sync and verifies that the
device query count does not increase. New storage I/O uses the existing queue
fences and the delivery matrix's ordinary optional-custody recipe; injected
failure does not invent a successful write or clear a newer pending state.

Additional controls are retained even when they do not reproduce: 120 ordinary
and 120 delayed-device same-key cases, 12 detailed device traces, 30 HTTP-body
traces, 30 snapshot traces, 30 full-snapshot traces and one held stale poll.
These runs show why a passing instrumented run alone cannot dismiss the race.

Transport diagnostic validation: a private listener with backlog 1 and two
queued connections produced a real `UND_ERR_CONNECT_TIMEOUT` after 10.542 s.
The same socket's `ss` record showed `Recv-Q=2`, `Send-Q=1`; 27 descriptors were
open against a 1,048,576 limit. Releasing the listener restored HTTP 200. A
separate 11 s event-loop stall against a healthy listener completed successfully.
Those controls validate the probe and distinguish queue pressure from mere
client scheduling delay. They do not attribute AP/FX's historical errors to a
full queue: those runs did not retain per-listener evidence.

Dense transport control: all **26/26 complete files** passed (two runs of
each of thirteen consumers, twelve slots sharing four CPUs plus two hogs).
The largest process-lifetime event-loop delay recorded by that probe was
11.148 s, yet no natural
`UND_ERR_CONNECT_TIMEOUT` occurred. Native receipts and every log are retained
in `burst/`; this success does not erase either earlier lane's failures.

Final-product stress is complete: **180/180 complete files**, 60 each of
`server-e2e`, `ephemeral-e2e` and `read-existence-integration`, with zero
failures. The new process/wasm regression raises the last file from seven to
nine cases; all nine run on every iteration. `candidate/verification.json`
checks every native receipt against its retained log hash. The private
candidate predates the final comment/line-budget compaction;
`candidate/semantic-equivalence.json` verifies identical generated JavaScript
after removing comments. No executable code changed during repetitions.

The final worker snapshot also passed **60/60 complete files**, all 77 cases
each, after both late fixture corrections. Combined final qualification for
the four changed files is **240/240 invocations**, zero failures. Every log
hash matches its native receipt; end-of-run source and dist hashes match the
immutable inputs. All phase runners and hogs have exited, and their private
scratch snapshots have been removed. `worker-final/verification.json` and
the phase cleanup receipts retain those checks.

The 60 final-product ephemeral files contain **300 trials**: first visibility
6.835–50.720 ms, last-row withdrawal 3,768.457–3,820.755 ms, and settled empty
data 3,883.540–4,029.472 ms after the last call. Every trial sent two requests.
`candidate/ephemeral-timings.json` summarizes the per-trial records in the logs;
no Linux timing result is presented as a Mac qualification.

First complete suite (final product code, before the two late worker fixture
corrections): `bash snapback4/scripts/test.sh` exited **0**, with
**0 failures in 4,163 s**. Every build, Rust, documentation-budget, release-guard
and typecheck stage passed; fixture wrappers passed 9/9, the client pool passed
319/319 files (6,370 tests passed, 11 existing skips), and both serial model
files passed all 79 tests. `suite-result.json` binds the complete retained
`full-suite.log.gz`. The JavaScript fix was built and typechecked while the
suite was still in Rust tests, before the client pool began;
`suite-product-build.json` records that build. Rust and wasm inputs did not
change. That first complete invocation was green. The later baseline cleanup failure
led to a fixture correction and a second complete invocation, recorded under
`suite-final-*`; no failed stage is retried unchanged.

A sustained startup control also passed **120/120 complete files**: twenty
runs each of `read-through`, `read-through-upsert`, `readauth`,
`read-through-provenance`, `social-starter` and `admit-before-identity`, with
twelve concurrent file slots and two hogs sharing newly sampled idle CPUs
60–63. This extends the short initial burst without retrying any invocation.
Native receipts, verified logs and owner-exit records are in `pressure/`.
The sustained control recorded a process-lifetime event-loop maximum of
23.169 s and no `UND_ERR_CONNECT_TIMEOUT`. This shows substantial scheduling
contention occurred; the maximum is not a timestamped cause of any request
error and does not establish that arbitrary event-loop stalls are harmless.

The baseline completed **1,020/1,020 planned invocations**, 60 per file:
**1,017 passed, 3 failed**. Worker run 44 is the cleanup race; worker runs 59
and 60 contain storage-exhaustion failures. Every other baseline file passed
60/60. The intermediate cleanup-only worker phase completed 60 runs: 55
passed, one failed on SQLite contention, and four failed during storage
exhaustion. None of these native results is excluded or replaced. Every
retained stress log passed its receipt/hash check.

| Complete file | Baseline passes / runs | Baseline failures |
| --- | ---: | --- |
| `admit-before-identity.test.mjs` | 60/60 | 0 |
| `asset-lists.test.mjs` | 60/60 | 0 |
| `ephemeral-e2e.test.mjs` | 60/60 | 0 |
| `keep-app-model.test.mjs` | 60/60 | 0 |
| `ordinary-search-oracle.test.mjs` | 60/60 | 0 |
| `read-existence-integration.test.mjs` | 60/60 | 0 |
| `read-through-provenance.test.mjs` | 60/60 | 0 |
| `read-through-upsert.test.mjs` | 60/60 | 0 |
| `read-through.test.mjs` | 60/60 | 0 |
| `readauth.test.mjs` | 60/60 | 0 |
| `retained-history.test.mjs` | 60/60 | 0 |
| `server-e2e.test.mjs` | 60/60 | 0 |
| `social-starter.test.mjs` | 60/60 | 0 |
| `store-reset-reconnect.test.mjs` | 60/60 | 0 |
| `sync-overflow.test.mjs` | 60/60 | 0 |
| `witness-acquire.test.mjs` | 60/60 | 0 |
| `worker-regressions.test.mjs` | 57/60 | cleanup ESRCH: 1; storage exhaustion: 2 |

The later full-suite invocation exited **1**, reporting two failed stages
(client tests and client models) in **3,501 s**. Build, wasm, documentation,
release guard, typechecks, Rust and fixture-wrapper stages passed. Storage
exhaustion also interrupted the collection of its temporary client log: the
retained outer log ends mid-diagnostic before the explicit model-runner
`ENOSPC` errors. Therefore no complete final client-case tally can be
reconstructed, and this attempt supplies no green qualification.
`suite-final-result.json` marks the log incomplete; `full-suite-final.log.gz`
preserves exactly the bytes available.

At diagnosis the filesystem reported 100% use, about 12 GB available after
the failing interval, and ample inodes; `enospc.json` records that **post-event**
sample. IT's measured workspace and snapshot roots totaled 14.89 GiB. Only
completed private Cargo intermediates were removed (about 7 GiB), followed
by completed IT scratch snapshots; `enospc-cleanup.json` and phase cleanup
receipts record those actions. No other lane's files or processes were
inspected for attribution or changed. This establishes the observed
`ENOSPC`/SQLite-full condition, not which workload exhausted capacity, and
not a cause for AP/FX's earlier connection failures.

Final audit: `./ref-check --verbose` passes (527 LLP documents, 10,392
references, zero errors or unchecked references), and `git diff --check`
passes. The final workspace measures 7.76 GB and no IT scratch directory
remains. No Mac run, publication qualification or historical transport fix
is claimed; the AP and NZ tickets remain open for their unresolved causes.
