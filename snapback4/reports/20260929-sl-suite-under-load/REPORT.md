# Lane SL — suite under host contention

**Required final verification passed: three whole heavy-load runs, one whole
slow-start run, the complete guide, and the final unconfined suite.** The exact
final footer is `== 0 failure(s) in 1216 s`; final-run failures are **ours 0,
baseline 0, environmental 0**. Earlier failures and the remaining product defects
are retained below; passing repetitions do not establish those defects are fixed.

Branch
`sb4-intent/sl-suite-under-load`, starting at
`38abb89b8e0b206644b9e2619c6f2d159a981d23`.

The scope is the complete publication suite on shared hosts. The initial
taskset-only runs are diagnostic evidence: child threads escaped their inherited
mask during slow startup, so that run was stopped. They do not qualify confinement.
Subsequent runs enforce CPUs **80–95** with taskset plus a local inherited guard;
see [the method correction](METHOD.md#containment-correction). Publication
concurrency is unchanged: confined runs use 16 Rust processes and five client-file
slots, followed by the existing serial full-count model stage. The final
unconfined run sees 96 CPUs and uses 24 Rust and 24 client-file slots. No assertions, seeds,
samples or cases are removed, and no new skip is introduced.

See the [complete changed-test table](TEST-CHANGES.md), [method](METHOD.md), [environment](environment.json),
[historical failures](HISTORICAL.md), the [classified failure ledger](FAILURES.md)
and [reproduction notes](CASE-NOTES.md).
The raw logs and extracts retain every failure, including cancellation cascades.

## Final verification

Every whole pass below has **4,342 Rust passes**, **5,197 client passes**,
**79 model passes** and **nine fixture-wrapper passes**, with the inherited
33 Rust ignores and ten client skips. Every one of its 13 stages passes, with
zero failed or cancelled tests and no asynchronous errors. Both 5,000-sequence
session models, the 3,000-interleaving online model and all four 300-seed/history
oracles run at full counts. The separate whole-guide target passes 99/99.

| Required run | Condition | Exact result |
|---|---|---|
| [Heavy pass 1](qualified-heavy-9.log) | 48 busy workers; CPUs 80–95 | `== 0 failure(s) in 3513 s` |
| [Heavy pass 2](qualified-heavy-11.log) | 48 busy workers; CPUs 80–95 | `== 0 failure(s) in 3738 s` |
| [Heavy pass 3](qualified-heavy-12.log) | 48 busy workers; CPUs 80–95 | `== 0 failure(s) in 3514 s` |
| [Slow startup](qualified-slow-3.log) | 300 ms child-exec delay; CPUs 80–95 | `== 0 failure(s) in 2494 s` |
| [Whole guide](guide-full.log) | Complete guide target; CPUs 80–95 | 99 passed; 0 failed; 0 ignored |
| [Final unconfined suite](final-unconfined.log) | No load generator, affinity guard or startup wrapper | `== 0 failure(s) in 1216 s` |

All 48 workers survive each successful heavy run and accumulate CPU time.
The [startup trace summary](qualified-slow-3-startup-summary.json) validates
14,776 resumed child execs, each delayed at least **300.000010 ms**; six child
exec events terminate before resume. The root's initial exec is not delayed.
The final unconfined suite runs once, last, after the guide. No subsequent
whole-suite retry occurs.

[Machine-checked qualification](qualification.json) binds the complete logs,
inventories, source hashes, load-worker survival and startup trace. All these
runs use unchanged tested-source diff SHA-256
`8a1ed4c2a7dd66718ef4fd72c1e2c135b3afa628d63eb1916b9deb53665838f5`.
The native console fix adds one Rust test; no existing test is removed.
[Reference validation](ref-check.log) passes: 524 LLP documents, 9,950 references,
zero errors and zero unchecked references. All 15 affected report/ticket Markdown
files have valid local links.

Final wasm is **2,040,531 B raw / 592,979 B gzip**, **740 B below** the unchanged
593,719 B cap, byte-identical to this checkout's baseline. SHA-256:
`76ffca354815401fdf2f29ed59d9a4a2b14d3abbbdf76cda9bc8c4f4efaefc95`.
Nothing is pushed or published.

## Initial diagnostic runs

| Original-source run | Load | Exact summary | Failures |
|---|---|---|---|
| [Idle](baseline-idle.log) | None; cold build | `== 1 failure(s) in 2144 s` | Clique reader wall-time ratio |
| [Moderate](baseline-moderate.log) | 16 busy workers | `== 2 failure(s) in 2180 s` | Doctor metrics snapshot race; online revocation and population-replay assertions |
| [Heavy](baseline-heavy.log) | 48 busy workers | `== 2 failure(s) in 3457 s` | Client fixture/progress failures, Node parser exception, web response and parent timeouts; local 5000-history timeout |
| [Original slow startup](baseline-slow.log) | 300 ms plus substantial strace overhead | Aborted; no whole-suite summary | SL harness: child threads escaped affinity; Rust had passed in 1744 s |

## Corrections

Focused cause controls and the 208-check affected-file run under 48 busy
workers pass; later fixture corrections have their own focused before/after
controls and whole-run coverage. Product invariant failures retain their
assertions and open tickets.

| Test | Failure mode | Correction and retained check |
|---|---|---|
| `clique_03::application_fixture` | Batched wall p95 ratios charge descheduling to different populations | Rotate/interleave controls; keep 3 warmups, 20 samples and the 3× bound on thread CPU; retain wall p95 diagnostics and functional/meter assertions |
| `release_token_owns_the_resolved_database_before_sqlite_open` | Four child startups consume the owner's SQLite busy budget | Require the real sidecar flock to refuse a probe while SQLite is blocked, then release SQLite and retain the owner at a full stdout socket; all four CLI contenders still refuse |
| `production_accept_loop_waits_for_complete_worker_readiness` and shared worker setup | Ten-second guard expires before worker readiness | Per-state startup guard; retain real readiness events and two-second response assertions |
| Mixed-evidence oracle, both hosts | 600-second aggregate guard counts one of three fresh schedules per seed | Two seconds per hosted schedule; keep all 300 seeds and three schedules, stop starting schedules after cancellation |
| Both 5,000-history session models | Fixed 240-second aggregate guard | Two seconds per history, unchanged seeds and coverage |
| 3,000-interleaving online model | Fixed 180-second aggregate guard | Same per-history guard, unchanged seeds and coverage |
| Both typing-expiry browser cases | Startup/cleanup and expiry share real time | Controlled browser/server clocks; retain actual React/HTTP/device behavior, pre-expiry visibility, no polling and original deadline assertions; historical cleanup stall remains unproven |
| Web admission review | Silent held poll triggers the real watchdog; aggregate budget covers 54 scenarios | Heartbeats preserve held evidence without a watchdog probe; original 5-second response wait retained; proportional parent and per-case guards; historical Mac close stall remains open |
| macOS witness driver cases | Five-second fake-executable startup budget preempts intended premise | Published per-step startup guard; timeout cases still withhold their named milestone and assert timeout phase and cleanup |
| Device cannot clear a running server’s rows | Correct early refusal closes stdin before the parent writes | Preload the same command before launch; preserve refusal and store-integrity assertions |
| HTTP ephemeral rate-limit refusal under dev and serve | Bucket refills during the gap between direct drain and real HTTP admission | Fixed per-host test clock; preserve all 40 burst admissions and whitespace variants, add a real HTTP admission after a 50 ms advance |
| Doctor latency cases | HTTP completion precedes recording the measured sample | Wait for the exact completed count before snapshot/count/reset assertions; preserve full before/after equality |
| Online answer-withdrawal cases | Initial change-feed catch-up may overlap the intended revocation interval | Hold that feed until the kick commits; baseline timeline confirms the unarmed second read |
| Population-growth prediction replay | Background observation can return an obsolete capture while the manual replay advances acquisition | Hold background probe/feed work during explicit replay; preserve all IDs and refusal assertions; trace confirms the obsolete background capture |
| Per-row read liveness | 2,000 parent turns finish before eight process replies arrive | State barrier with a hang guard; keep the semantic clock frozen until explicit expiry; all eight reads and later-owner assertions remain |
| Pre-reset publication | 60 parent turns finish before replacement transport entry | Await that held transport event, then retain exact count and publication assertions |
| Per-row retry | Bundled parser timer error; 60 parent turns can precede retry installation; frozen cleanup hides assertion failure | Pinned dispatcher, actual retry-installed barrier, exact 25 ms assertions, and clock release after closing begins; before/after delayed-continuation control fails/passes |
| Counted refusal output during shutdown | Raw lifecycle diagnostics interleave between formatted fragments | Format the complete refusal line before writing; deterministic interleaving regression added, all existing shutdown integration assertions retained |
| Browser admission helper, both wasm and Worker | Cleanup closes the browser while a route callback still owns live I/O | Remove routes and wait for active callbacks before browser close; all admission/custody assertions remain, and callback errors are not ignored |
| Both changed-default refusal checks | A queued host diagnostic follows the direct exit record, breaking a whole-stderr JSON parse | Require exactly one named exit line and compare its complete reason; original adoption/status/site checks remain, and exit metadata is checked |

## Verification notes

The corrected no-load run has one introduced guide-fact registry failure,
subsequently corrected without dropping its exact-text assertion. The corrected
moderate run exposes the baseline retained-history product race. Neither is
called a pass. The three final heavy passes are **not consecutive**: attempt 10
between them exposes the same retained-history defect on the process host.
Every unsuccessful whole attempt and diagnostic control remains in the
[classified ledger](FAILURES.md), with full blocks in its `.summary.json` and
unchanged raw log. The earlier passing candidates remain supplemental evidence;
they do not substitute for the final-source matrix above.

## Corrected-guard whole runs

| Run | Exact summary | Classification and disposition |
|---|---|---|
| [Moderate, 16 busy workers](qualified-moderate.log) | `== 1 failure(s) in 2227 s` | Baseline product defect: unchanged R5 retained-history assertion detects an empty flash; added reproduction to the existing open ticket. Rust and all 79 models pass; no other client failure. |
| [No artificial load](qualified-idle.log) | `== 1 failure(s) in 1728 s` | Ours: one stale guide fact entry; 5,197 client cases and 79 model checks pass; ten client cases retain their inherited skips. Registry corrected; affected assertion passes in `guide-fact-corrected.log`. |
| [First heavy attempt, 48 busy workers](qualified-heavy-1.log) | `== 2 failure(s) in 3771 s` | Baseline rate-limit and retry fixture premises. Retry cleanup required a recorded diagnostic clock release; this intervened attempt cannot qualify a pass. All 79 models pass, including local 5000 histories in 336 s. Both causes are corrected; affected loaded checks pass 14/14 and 15/15. |
| [First slow-start attempt](qualified-slow.log) | `== 1 failure(s) in 2489 s` | Baseline mixed-evidence aggregate guard: one cancelled process case; all Rust checks and all 79 models pass. Trace validates 14,776 resumed child exec delays of at least 300 ms. The corrected full repeat passes in the next row. |
| [Slow-start after oracle correction](qualified-slow-2.log) | `== 0 failure(s) in 2494 s` | Pass: Rust 4341, clients 5197 (ten inherited skips), models 79; both 300-seed mixed-evidence hosts have zero failed seeds. All 14,776 resumed child execs delayed at least 300 ms; source unchanged. |
| [Second heavy attempt, 48 busy workers](qualified-heavy-2.log) | `== 1 failure(s) in 3705 s` | Baseline fixture: correct early ownership refusal races the parent stdin write. All clients and all 79 models pass. Deterministic control reproduces `E_STORE_BUSY` followed by `Broken pipe`; input is now queued before launch. |
| [Third heavy attempt, 48 busy workers](qualified-heavy-3.log) | `== 1 failure(s) in 3757 s` | Unchanged ordinary-search process seed 130 repeats its first page after a reopen without reset. All Rust checks and all 79 models pass; 5,196 client checks pass with one failure and ten inherited skips. Baseline product defect: a prior reconnect leaves cursor link revision 2, while reopening resets it to 0. All ten deterministic process/wasm controls fail; the product ticket is open and the oracle is unchanged. |
| [Fourth heavy attempt, 48 busy workers](qualified-heavy-4.log) | `== 1 failure(s) in 3649 s` | Baseline product framing defect: a raw thread-exit diagnostic splits a counted refusal line. All clients and all 79 models pass. The original writer fails the new deterministic interleaving regression; the corrected writer passes all four console tests and all 20 refusal integration tests under 48 busy workers. |
| [Fifth heavy attempt, passing console candidate](qualified-heavy-5.log) | `== 0 failure(s) in 3503 s` | Rust 4342, clients 5197, models 79 and fixture wrappers 9 pass; 33 Rust ignores and ten client skips remain inherited. Zero failures, cancellations or asynchronous errors. All 48 workers survive; source digest unchanged. |
| [Sixth heavy attempt, same console candidate](qualified-heavy-6.log) | `== 1 failure(s) in 3515 s` | Baseline R5 retained-history product race recurs at the unchanged line-838 empty-delivery assertion. Rust 4342 and all 79 models pass; clients 5196 pass, one fails, ten inherited skips. No cancellation or asynchronous error. All 48 workers survive and source is unchanged. This attempt does not count as a pass; the product ticket remains open. |
| [Seventh heavy attempt, same console candidate](qualified-heavy-7.log) | `== 1 failure(s) in 3466 s` | Baseline fixture parses a valid diagnostic after the exit line as trailing JSON. Rust 4341 pass and one fails; all clients and all 79 models pass. Original/corrected deterministic controls fail twice/pass twice. All 48 workers survive; source unchanged. The parser is corrected before the next matrix. |
| [Eighth heavy attempt, named-exit candidate](qualified-heavy-8.log) | `== 1 failure(s) in 3950 s` | Baseline browser-fixture teardown: a replacement-store route callback calls `route.fetch` after the browser closes. Admission assertions complete; all Rust checks and all 79 models pass. Clients 5196 pass, one fails, ten inherited skips; zero cancellations/asynchronous errors. All 48 workers survive; source unchanged. Forced overlap fails with original cleanup and passes with callback draining. |
| [Ninth heavy attempt, first final-source pass](qualified-heavy-9.log) | `== 0 failure(s) in 3513 s` | Rust 4342, clients 5197, models 79 and wrappers 9 pass; 33 inherited Rust ignores and ten client skips. All 13 stages pass, with zero failures, cancellations or asynchronous errors. All 48 load workers survive; source remains `8a1ed4c2…`. This is final-source heavy pass 1 of 3. |
| [Tenth heavy attempt, same final source](qualified-heavy-10.log) | `== 1 failure(s) in 3512 s` | Baseline R5 empty flash now occurs on the process host at the unchanged line-838 assertion. Rust 4342 and all 79 models pass; clients 5196 pass and one fails, with ten inherited skips. All 48 workers survive; source unchanged. A subsequent 100-case native trace reproduces 18 failures and proves the same server-before-device publication order. The product ticket stays open; pass 9 remains counted. |
| [Eleventh heavy attempt, second final-source pass](qualified-heavy-11.log) | `== 0 failure(s) in 3738 s` | Rust 4342, clients 5197, models 79 and wrappers 9 pass; 33 inherited Rust ignores and ten client skips. All 13 stages pass, with zero failures, cancellations or asynchronous errors. All 48 workers survive; the final-source digest is unchanged. Both 5000-sequence session models, the 3000-interleaving online model and all four 300-seed oracles pass at full counts. This is final-source heavy pass 2 of 3. |
| [Twelfth heavy attempt, third final-source pass](qualified-heavy-12.log) | `== 0 failure(s) in 3514 s` | Rust 4342, clients 5197, models 79 and wrappers 9 pass; 33 inherited Rust ignores and ten client skips. All 13 stages and all full-count histories/oracles pass, with zero failures, cancellations or asynchronous errors. All 48 workers survive; final-source digest unchanged. This completes the three required final-source heavy passes. |
| [Final-source slow startup](qualified-slow-3.log) | `== 0 failure(s) in 2494 s` | Rust 4342, clients 5197, models 79 and wrappers 9 pass, with inherited 33/10 ignores/skips. All 13 stages and full-count histories/oracles pass. Trace validates all 14,776 resumed child execs at 300.000010 ms or longer; six terminate before resume. Source unchanged; no cancellation or asynchronous error. |
| [Whole guide](guide-full.log) | 99 passed; 0 failed; 0 ignored | Complete guide target passes on the same final source, confined to CPUs 80–95. |
| [Final unconfined suite](final-unconfined.log) | `== 0 failure(s) in 1216 s` | Ours 0, baseline 0, environmental 0. All 13 stages pass: Rust 4342, clients 5197, models 79, wrappers 9; inherited 33/10 ignores/skips, zero cancellations or asynchronous errors. All full-count histories/oracles pass. Source unchanged; actual inventory is 96 CPUs, 24 Rust processes and 24 client-file slots. This is the last whole-suite run. |

These experiments retain the whole script; a known failure does not stop later
stages within that run.


The final candidate includes the console framing correction, named-exit
fixture parser, direct pre-SQLite ownership probe and browser route draining.
Its tested-source digest is
`8a1ed4c2a7dd66718ef4fd72c1e2c135b3afa628d63eb1916b9deb53665838f5`.
`route-drain-source-change.json` binds the last fixture change and controls.
The [final matrix](route-drain-final-matrix.json) begins with `qualified-heavy-9`
and records all three passes on this candidate, its unsuccessful attempt,
slow startup, the whole guide and the final unconfined run. Earlier candidates'
passing and failing attempts remain in `console-final-matrix.json` and
`exit-record-final-matrix.json`. The console regression adds one Rust test;
no existing case or assertion is removed. Source stayed frozen throughout every recorded run.


## Remaining defects and qualification limits

Passing repetitions do not close the product failures found during this work:

- [Retained-history empty publication](../../../issues/20260929-snapback4-retained-history-transient-empty.md): server sequence 5 can publish empty before the device applies the leave, followed by 25 retained rows. The unchanged assertion fails in 15/100 instrumented wasm repetitions and 18/100 process repetitions. These are diagnostic frequencies, not estimates of production incidence. Whole final-source attempt 10 also fails; its failure is retained between the passing attempts.
- [Search continuation after reconnect and reopen](../../../issues/20260930-snapback4-search-cursor-reopen-restarts.md): an in-memory link revision changes from two to zero on reopen, causing an unchanged cursor to restart page one. All ten deterministic process/wasm controls fail. The oracle and query runtime remain unchanged.
- [Historical Mac cleanup stalls](../../../issues/20260929-snapback4-browser-close-stalls-under-publication-load.md): the recorded browser/app/session-close stalls are not established as fixed by Linux clock or route-fixture corrections. No tests or load were run on either source Mac.

The Darwin-only witness-driver module cannot execute on this Linux host. Its
fake-simctl Python syntax was checked; no native macOS or simulator pass is
claimed. Its two intentional timeout paths now each wait up to 120 seconds,
about 230 seconds more aggregate deliberate waiting than their previous guards;
the named timeout phases, failure text and backend-cleanup assertions remain.
This is not a measurement of macOS whole-suite critical-path growth.

The inherited nominal 60-second complete-suite budget remains exceeded. These
runs establish the recorded outcomes under CPU contention and delayed exec;
they do not establish that latency budget, Darwin behavior or memory-pressure
robustness. No publication concurrency, sample count, seed or case was reduced.
