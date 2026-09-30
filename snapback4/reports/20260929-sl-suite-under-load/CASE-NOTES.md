# Reproduction notes

The initial whole-run observations precede Lane SL source changes. They are
diagnostic evidence, not confinement-qualified runs: see the taskset correction
in [METHOD.md](METHOD.md#containment-correction). The focused controls below use
the inherited kernel affinity guard.

## Idle

`== 1 failure(s) in 2144 s`; `snapback4-lang::clique_03::application_fixture`.
The celebrity reader wall p95 was 3.434898 ms versus ordinary 0.837044 ms,
ratio 4.1036050674 > 3. Engine meters were nearly equal (118 versus 117
examined rows; 1407 versus 1392 steps). Same run: dense ratio 1.0339205585.
This is a wall-time sample imbalance; the candidate pairs/rotates samples,
keeps wall diagnostics and applies the same bound to single-thread engine CPU.

## Moderate

`snapback4::latency::doctor_checks_the_servers_project_before_read_or_reset_for_both_address_sources`
failed the complete JSON equality at latency.rs:239. The initial `/q/fast`
sample count and CPU count were zero; the later snapshot had one. The HTTP
body arrives before `Sample::drop` records the completed request. This race
exists independently of doctor. The fix waits for that one completed sample
before freezing the initial snapshot, preserving every equality/refusal check.
Equivalent count assertions in that file use the same state barrier.

Rust stage: 846 seconds, one failing target.

Client stage completed in 972 seconds: 5207 tests, 5195 pass, two failures,
10 inherited skips, no cancellations. Both failures match existing tickets:

- [Online revocation](../../../issues/closed/20260929-snapback4-answer-withdrawal-revoked-held-intermittent.md):
  line 215 expected `private answer`, got `undefined`, in 197.879423 ms.
- [Prediction replay](../../../issues/closed/20260927-snapback4-population-growth-replay-generation-flaky.md):
  line 1130 expected no device refusals; saw `observe_store / E_GENERATION:
  another owner advanced acquisition during sync; retry sync`, in 216.241382 ms.

Neither is a wall timeout. The real browser admission (141.085 s), session
identity (14.539 s), startup (11.336 s), and both typing cases (8.796/7.099 s)
passed. This does not resolve the historical Mac cleanup stalls.

Moderate completion: `== 2 failure(s) in 2180 s`, failing groups `cargo test`
and `client tests`. All 79 model checks passed, including both 5000-history
models and the 3000-interleaving online model. Model stage 344 seconds.
There are three underlying assertion failures, not two tests: the script's
summary counts failing groups. All are baseline observations.

## Heavy

Rust passed in 1581 seconds. Clients completed in 1230 seconds with 17
reported failure records (including a failed file, the web parent and its
cancellation cascade). The exact cases/stacks are in `baseline-heavy.summary.json`.

- Online revocation: `keep=undefined` in both held and throw modes, at the
  same line-215 old-answer precondition as moderate (169/240 ms).
- Process read liveness, `keep=undefined` and `false`: 2,000 parent
  `setImmediate` turns ended before all eight child replies arrived. Failure
  at `await pump(() => held.length === 8)`, in 437/356 ms. This did not reach
  the cancellation/expiry regression premise. Candidate: wait for the state
  under a real hang guard, keeping semantic time frozen until explicit expiry.
- Process publication, `keep=undefined`: 60 parent turns ended before the
  replacement reached transport; count was 1 instead of 2 (357 ms).
  Candidate: await the held replacement's actual transport entry, then retain
  the exact count, snapshot and subscriber assertions.
- `per-row-retry.test.mjs`: all named checks passed, but five callbacks from
  ended tests threw `Cannot destructure property 'socket' of 'parser.deref(...)'
  as it is undefined`. Node 24.13.1's bundled undici parser dereferences without
  a guard (local source extract `node-bundled-parser.txt`). The already-pinned
  SDK dispatcher has that guard. The fixture currently bypasses it with its
  custom global-fetch transport; candidate uses the SDK transport underneath.
- Web admission: both “replacement after validation refuses the original
  orphan binding” transports hit their 5 s response wait (12.590/12.221 s
  total). This reproduces the existing orphan-binding response ticket. Later
  the parent reached its 180 s aggregate limit; the active fresh-orphan case
  and seven later cases lost their page, followed by the parent failure.
  Response wait diagnosis remains separate from the aggregate-budget fix.

Affinity audit during clients covered 159 live threads; all were on CPUs 80–95.

Heavy completion: `== 2 failure(s) in 3457 s`. Rust: 4341 passed, zero
failed, 33 inherited ignored. Node client summary: 5208 tests (the extra
file-level failure accounts for the increase from 5207), 5181 pass, 16 fail,
one cancelled parent, 10 inherited skips. Models: 79 checks, 78 pass, one
cancelled at 240001.128 ms: the local 5000-history session model. The online
5000-history model passed in 187.429 s and the 3000-interleaving model passed.
Model stage: 609 seconds. All 48 owned busy workers were reaped before slow
startup began at 19:57:58 UTC, still on pristine sources.


## Focused cause controls and candidate checks

`control-baseline-heavy` ran baseline-sourced timeline copies under the corrected
CPU guard and 48 busy workers. Eight online-withdrawal and both population-replay
checks passed; the two orphan-response cases failed, plus their parent.

The withdrawal timeline shows a second `/q/secret` entering while `armed=false`
after the first private answer was published. That in-flight request can observe
the later kick without entering the test's held replacement gate. The fixture
now holds initial change-feed catch-up until the kick commits. This removes the
uncontrolled initial read while preserving the held/failed replacement checks.

The replay trace records `observe_store / E_GENERATION` from `waitForChange`
after the explicit stream advanced the captured watermark. The device must
reject that obsolete capture; the store-reset regression requires it. This
fixture now holds independent background probe/feed work during its explicit
sync/replay transaction. The complete refusal and generated-ID assertions remain.

The orphan timeline proves an unsolicited `/probe` discovered replacement B
before peer close returned (ordinary: probe 7147 ms, close return 7329 ms;
exit transport: probe 7392 ms, close return 7609 ms). No mutation arrived even
in an additional 60-second observation window. The fake held poll sent no bytes,
so the real 4-second silence watchdog restarted identity discovery. The fixture
now sends whitespace heartbeats while withholding its JSON evidence, matching
the real long-poll protocol. The original 5-second response wait remains intact.
All 54 scenarios pass in `focused-clients` after this change.

The archived original ownership test fails under 1500 ms child-exec delays:
`rollback: E_STORE: database is locked` (`control-token-before`, 18.664 s).
The initial corrected ownership barrier passes with the same injection
(`control-token-after`, 13.639 s). It observes the address-record transition
while SQLite is held, then releases SQLite and keeps the owner alive on a full
stdout socket while all four competitors attempt ownership. Review identified
that the address hint alone is not a direct exclusion assertion. The final fixture adds a nonblocking probe of the actual ownership sidecar before
releasing SQLite and requires `WouldBlock`; all four CLI refusals remain.
All 27 ownership checks pass under 48 busy workers in 28.771 s. The final
ownership case passes in 16.793 s with eleven child execs delayed at least
1500.074846 ms (`control-token-lock-after`); the exec-only wrapper trace
validates every delay. These elapsed times include Cargo setup.

Clique's corrected tests pass. A temporary 10 ms celebrity CPU burn inside the
charged read span fails the original 3× guard at **12.1146×**. Source bytes were
restored exactly (hashes in `clique-negative-control.json`), and all three tests
pass again. This verifies sensitivity to added engine CPU, not wall latency.

The first new typing-clock candidate passed its semantic expiry assertions but
froze cleanup's one-second retry. `control-typing-clock` reached `closeClients`
and then hit its diagnostic 70-second guard. The original focused file family
was stopped once this cause was known, allowing the other six files to finish:
206 passes and one aborted file failure. These two failures are **ours**.
Resuming the browser clock after all expiry assertions fixes cleanup; both
unchanged age cases pass in `focused-typing-fixed` (3.837 s total). This does
not prove the distinct historical real-clock Mac cleanup stalls are fixed.

The affected Rust checks pass: 27 ownership cases, 12 doctor cases and the
worker readiness case. The fake simctl parses as Python; Darwin-only driver
cases cannot execute on this Linux host. Full matrix qualification follows
these focused checks and will be recorded separately.

`focused-clients-heavy`: all **208 checks pass** under 48 busy workers in
196.436 s (Node duration), including both typing ages and all 54 web admission
scenarios. Thread audits retain the required mask. No seed/sample override or
new skip was used. This is an affected-file check, not a whole-suite pass.


## Corrected-guard no-load whole run

`qualified-idle` completed all stages: `== 1 failure(s) in 1728 s`.
Rust: 4,340 passed, one failed, 33 inherited ignored. The failure is SL's guide
fact-registry drift (`reads-11`), not a timing failure. Client stage: 5,207
cases, 5,197 passed, 10 inherited skips, zero failed/cancelled. Model stage:
all 79 passed in 300 seconds; the two 5,000-history sweeps took 89.423 and
147.799 seconds. The 3,000-interleaving sweep also completed in full.

After the whole run ended, the existing fact registry was corrected to match
the revised guide paragraph. Its 133-entry inventory and exact normalized-text
assertions remain intact. The affected guide assertion passed in 1.6 seconds
including compilation. The remaining whole matrix starts from that correction.


## Corrected-guard moderate run: genuine product failure

The Rust stage passed all 4,341 checks (33 inherited ignores) in 886 seconds.
The client stage finished in 953 seconds with exactly one failed case:
`R5 history wasm: retained history and independent held coverage`, 278.897513 ms.
It failed the unchanged `assert.ok(!deliveries.includes(0))` at line 838.
There were no asynchronous parser errors or other client failures. This is the
existing baseline transient-empty product issue, now reproduced on Linux under
16 busy workers; it is not a test timeout or a fixture guard to relax. The
[open ticket](../../../issues/20260929-snapback4-retained-history-transient-empty.md)
now contains this run and a clearly labeled code-reading lead. All 16 load
workers remained active during the client stage. All 79 models passed in 371 seconds (online 5000: 114.096 s; local 5000: 179.749 s).
Exact whole footer: `== 1 failure(s) in 2227 s`.


The retained-history focused control then ran 100 unchanged wasm R5 cases
under 48 busy workers: **85 passed, 15 failed**, 40.571 seconds. Instrumented
ordering confirms the server's sequence-5 empty result is published while the
device still has watermark 4; leave application follows, then a local query
returns 25 retained rows. `retained-failure-windows.json` keeps all 15 captured
windows. Instrumentation adds scheduling points, so this ratio is not a
production failure-rate estimate. The runtime and original test are unchanged;
the product issue remains open. Three required heavy whole runs now follow.

## First corrected heavy run: HTTP rate-limit fixture

The Rust unit target fails at `serve_ephemeral/mod.rs:235`, spacing 7: a
`sent` reply has no `why.code`, while the test expects `E_RATE_LIMIT`. Its
direct drain uses a fixed `Instant`, but the actual HTTP route samples the
real clock later. At 20 tokens/second, a 50 ms scheduling gap invalidates the
fixture premise. A per-host test-only fixed clock is prepared, preserving all
40 successful drains, both hosts, all whitespace spellings and wire refusal
assertions. The existing pure limiter 49/50 ms boundary test remains; the
HTTP case will additionally advance 50 ms and assert a successful refill.
No source changes are applied until the running whole suite completes.

## First corrected heavy run: retry installation and frozen cleanup

The `per-row-retry` process stopped making progress for more than ten minutes.
The server had exited; only the test process and its device child remained.
Inspector records (`retry-stall-inspection.json`, `retry-stall-clock.json`) show
no active network request, mocked time 25 ms and a promise-resolving timer at
1025 ms. Advancing that one clock by 1000 ms (`retry-stall-release.json`)
immediately allowed cleanup and the rest of the file to finish. The diagnostic
set the child exit code to one and wrote an explicit stderr marker. This
intervened whole attempt cannot qualify a pass. Every remaining case ran.

The now-visible failure is the original `paced retry publishes the current
answer` assertion in `process keep=undefined: a due completion preserves a
newer answer and retries`. The fixture advances 25 ms after only 60 parent
turns, which do not establish that the device-side continuation has installed
the retry. A candidate observes the real `ReadWork.retry` event before advancing
the clock, preserving the result and exact 25 ms pacing assertions and adding
exact installation counts. Its cleanup closes first, releases the already-sleeping
background loop, then restores real timers for device teardown. Source is still
frozen until the current model stage finishes; negative/positive cause controls
are next. The real retained-history case passes in this attempt; its ticket
remains open.

Heavy attempt completion: `== 2 failure(s) in 3771 s`. Rust 4340 pass,
one fail, 33 ignored; clients 5196 pass, one fail, ten skipped; models 79/79.
Online/local 5000-history durations are 197.186/335.966 seconds. All 48 busy
workers survived until cleanup and were reaped. The source diff matched its
start hash at completion (`qualified-heavy-1-end-source.json`). This is a
diagnostic whole attempt because of the explicitly recorded inspector release.

`control-retry-before` fails the original paced-retry assertion with a 750 ms
real continuation delay. Its trace says clock advances to 25, then retry is
installed at 25 with a 25 ms delay. `control-retry-after` passes the same
injection, recording retry installation at 0 before advancing to 25. Both
controls preserve semantic assertions and use corrected cleanup; only the
sixty-turn premise versus actual event barrier differs. The failure belongs
to a timing premise already in the starting fixture, exposed by this candidate.

After the whole attempt and controls, both clock corrections were applied.
`focused-ephemeral-heavy`: 14/14 pass; `focused-retry-heavy`: 15/15 pass, both
under 48 workers. Source change receipt: `rate-and-retry-source-change.json`.
New tested-source diff SHA-256:
`ff4dbe810f3f5f09284969ba22a81066429a0303fffbdf23539549659840db77`.
The whole slow-start run began at 23:05:28 UTC, before the remaining three
heavy passes, so startup-specific corrections are found before final proofs.


## First corrected slow-start whole run: mixed-evidence work budget

All Rust targets pass. The client stage has one cancellation at 600331 ms:
`mixed evidence schedule process: 300 independent histories`. The default
300 seeds contain **900 fresh hosted client schedules**: mixed/membership,
generation, and notification. Each opens its own native device process;
notification cleanup also joins the actual one-second failed-follow sleep.
At 300 ms per successful child exec, these device starts alone add at least
270 seconds, on top of actual work and recovery. The inherited 600-second
budget accounts for only one schedule per seed. The process was still making
progress (device `notification-277` observed while it continued after timeout).
The wasm counterpart passes all 300 seeds in 165.602 seconds.

The expired process body continued into the following wasm test after Node
reset its `Date.now` mock. It eventually printed 60 failed-seed records with
deadline/metadata assertions. These post-timeout records are retained in the
raw log; they are not independent product evidence because the test's clock
is already torn down. The revised fixture will stop starting hosted schedules
when its test signal aborts. A successful final full-count slow run must still
show zero failed seeds for both hosts; a larger guard alone cannot excuse an
oracle assertion.

The ordinary-search oracle passes unchanged: all 300 seeds and their extra
scenarios, process 545.660 seconds and wasm 287.968 seconds. No search guard is
changed. The remaining model stage is allowed to finish before source changes.

Slow attempt completion: `== 1 failure(s) in 2489 s`. Rust 4341/4341
pass (33 inherited ignored); clients 5196 pass, zero fail, one cancelled,
ten skipped; models 79/79 pass in 298 seconds. The wrapper released 14,776
execs after at least 300.000028 ms; six execs ended before their release.
Source remained unchanged during the attempt. `oracle-source-change.json`
records the subsequent correction and final-source diff hash. The repeated
whole slow run starts at 23:47:00 UTC, with no seed overrides.

In `qualified-slow-2`, the corrected process oracle completes **all 300 seeds
with zero failed seeds in 748.802 seconds**. This exceeds the old 600-second
guard while satisfying every original assertion, supporting the timeout and
clock-teardown diagnosis. The full run is still in progress at this observation.

The full repeat passes: `== 0 failure(s) in 2494 s`. Rust 4341 pass,
33 inherited ignored; clients 5197 pass, ten inherited skips, no failures or
cancellations; all 79 models pass. Mixed evidence process/wasm: 748.802/162.401
seconds, 300 seeds and zero failed seeds each. Ordinary search is unchanged and
passes at 545.590/288.923 seconds. Web admission and both typing ages pass.
The trace validates 14,776 resumed child execs at >=300.000043 ms (six children
ended before release). Both tested-source hashes equal
`8411a94e1483de908fdc370692cd42e9c064e45b4bec4aa75c0b0a2448dddfb9`.
No intervention was needed. Heavy run 2 begins at 00:28:36 UTC with 48 workers.


## Heavy run 2: ownership refusal closes stdin before the parent writes

`identity::device_cannot_clear_a_running_servers_rows` panics at
`identity.rs:280` with `Broken pipe`, before reaching its refusal assertions.
This unchanged fixture spawns the device, then writes `clear_rows` to its pipe.
The device is supposed to refuse opening the running server's owned store;
correct early exit races the parent's write when the parent is descheduled.
The token-ownership fix passes in the same target (26 pass, one failure).

The prepared correction preloads the same JSON line into a fixture file before
launch and supplies that open file as stdin. All four outcome checks remain:
non-success exit, `E_STORE_BUSY`, one original row, and no device side tables.
A diagnostic control will force the original child-before-parent ordering and
capture its exact refusal before surfacing the failed write. Source stays frozen
until this whole attempt finishes. This is a baseline fixture race, not a
reason to delay the device's correct refusal or relax a product timeout.

Heavy run 2 completes: `== 1 failure(s) in 3705 s`. Rust 4340 pass,
one failure, 33 ignored; all 5197 client cases pass (ten inherited skips), and
all 79 models pass in 682 seconds. All 48 workers survive to cleanup; the source
diff stays unchanged throughout the whole attempt.

`control-identity-before` forces child exit before the old parent write. The
child returns status 2 with `E_STORE_BUSY`; the original write then fails with
`Broken pipe`, exactly reproducing the scheduling premise. No delay is guessed.
After this control, the preloaded-input correction is applied; receipt
`identity-source-change.json`, tested-source diff SHA-256
`5896f4daa5c4269df80b931a5629337992865d691ec4711f5e6561521b48ee58`.
The full 27-case affected target under heavy load and the individual case under
slow startup run before another full matrix on this final source.

The corrected affected target passes **27/27 under 48 workers** in 19.0 s
including compilation. The specific case also passes with delayed startup
(1.7 s total; all five child execs delayed >=300.79434 ms). The next whole
heavy run starts at 01:30:48 UTC. All final whole runs will use the source
hash above; the earlier full slow pass is retained as pre-stdin-correction
evidence and will be repeated on the final source.


## Heavy attempt 3: ordinary-search seed 130 repeats page one

The unchanged process oracle failed below its 600-second guard: 300 seeds
completed in 285.689 s; only seed 130 failed. Its normal schedule is descending,
limit five, immutable scope, no cut. Page zero contains `m00025`, `m00024`,
`𐀀00022`, `m00023`, `00021`. Action eight with `shouldSync:false` closes and
reopens the same device, without clearing its rows. Page one supplies the
continuation but returns those same five rows, rather than the independent
model's next five (`m00020` through `m00016`). The exact page equality assertion
fails; no allowance change can resolve this result. Both mixed-evidence hosts
pass all 300 seeds in the same run.

`prepare-search-control.py` preserves the oracle assertions in a diagnostic
copy, tracing existing `search_state` replies and decoded incoming/outgoing
cursors. It schedules 100 repetitions on each host, including both the normal
and current-only seed-130 schedules. The whole suite and its seed counts remain
unchanged. Investigation and final classification are pending.

The full third-heavy attempt completed: `== 1 failure(s) in 3757 s`.
Rust 4,341 passed / 33 inherited ignores; clients 5,196 passed / one failed /
ten inherited skips / zero cancellations; all 79 models passed. The online
5,000-sequence model took 193.257 s; local took 358.543 s. All 48 busy workers
were alive at completion, and tested source digest `5896f4daa5c4269df80b931a5629337992865d691ec4711f5e6561521b48ee58`
was unchanged. No asynchronous post-test errors were reported.

The first focused search control completed in 239.691 s: 199/200 cases passed,
one process repetition (49) reproduced the identical next-page failure, and all
100 wasm repetitions passed. Each case runs the normal and current-only seed-130
schedules. Node's default AssertionError formatter omitted the appended custom
trace; this is a diagnostic-output omission, not a new test failure. The first
generator and source hashes remain in `prepare-search-control-first.py` and
`search-control-first-source.json`. A second control explicitly logs the trace
on failure and repeats both seed-130 schedules 200 times on the process host.
All assertions are unchanged; whole-suite source and counts remain unchanged.


The second search replay passed 200 process cases (each normal plus current-only)
in 282.326 s. A bounded normal-schedule diagnostic then stopped at its first
failure, repetition 154, after 153 passes (125.376 s total). Explicit trace
logging captured a prior offline/online transition and the cursor binding's
link revision changing **2 → 0** across reopen. Every other binding field,
device epoch, store/generation identity and audience remains equal. Pagination
starts over because `local-search.ts` compares that process-local counter with
the fresh client's zero. The trigger for the earlier unsolicited link transition
is not established; a valid deliberate reconnect is enough to reproduce the
cursor defect independently.

`prepare-search-reconnect-control.py` injects an offline/online sync cycle before
minting the cursor, then preserves the normal seed-130 assertions. All ten
repetitions fail (five process, five wasm), in 7.919 s total. The cursor-field
comparison passes for every trace: only link revision changes, and page one
repeats page zero. Raw traces and source hashes accompany the control;
`search-reconnect-analysis.json` records each comparison. This is a **baseline
product defect**, filed as `issues/20260930-snapback4-search-cursor-reopen-restarts.md`.
The ordinary oracle source is unchanged. No increased wait or modeled restart
was used to turn the assertion green. Passing whole-suite repetitions do not
resolve this defect or the independent retained-history empty flash.


## Heavy attempt 4: real stderr message interleaving

`dev_refusals::shutdown::sigterm_without_worker_flushes_refusals_while_a_poll_is_held`
fails its counted-line assertion. Shutdown succeeds and the refusal count is
present, but a raw `SNAPBACK4_THREAD_EXIT` line is spliced between `dev refusal:
add` and `: rows`. The exact block is in `refusal-interleaving.txt`.
`Console::emit_first` formats directly into `Stderr` through `writeln!`, which
can issue multiple writes; lifecycle diagnostics deliberately bypass Rust's
stderr mutex with raw writes. This is a product framing defect, not a timeout.
The compiled refusals guide and LLP 3000.015 §2.1 require a counted console line.

`prepare-console-candidate.py` prepares, without applying during the whole run,
a regression writer that inserts the same lifecycle diagnostic after the first
write. Its outcome assertions require two intact lines and all eight refusals
in the first. The candidate first formats the complete refusal line, then
writes those bytes together. It leaves signal safety, aggregation windows,
counts, queue bounds and the real shutdown integration assertions unchanged.
The controller will run the negative control and corrected affected checks
only after this whole attempt finishes. This correction is not yet qualified.


The fourth heavy attempt completed unchanged: `== 1 failure(s) in 3649 s`.
Rust 4,340 passed / one failed / 33 inherited ignores; clients 5,197 passed /
ten inherited skips / zero failures or cancellations; all 79 models passed.
All 48 workers were alive at completion. The tested-source digest stayed
`5896f4daa5c4269df80b931a5629337992865d691ec4711f5e6561521b48ee58`.

After completion, `control-console-before` adds the new deterministic regression
to the original product writer: it fails as expected (Cargo exit 101), with
`dev refusal: SNAPBACK4_THREAD_EXIT...` on the first line. The corrected writer
passes all four console tests (`focused-console-heavy`) and all 20 real refusal
integration tests (`focused-refusals-heavy`) under 48 busy workers. Elapsed times,
including any compilation, are 12.535 s / 11.774 s / 9.066 s respectively.
The real shutdown assertions, eight-request burst, five-second shutdown guard,
record count and stopped-evidence checks are unchanged. The new test is additive.
Source receipts are `console-control-source.json` and `console-source-change.json`.
The correction changes native dev console formatting; it does not alter the
signal handler or introduce locking there. LLP 3000.015 §2.1 records the reason.
Final-source qualification begins with heavy attempt five, source digest
`db2b0c384593d0253670408199a1f22244019f5911456ce8c9b27fa195b99f1f`.


## Seventh heavy attempt: named exit records survive diagnostic reordering

`qualified-heavy-7` ends with `== 1 failure(s) in 3466 s`; its only failure
is `changed_default_rechecks_unchanged_cap` at `check.rs:687`. All 5,197 client
checks and all 79 models pass. The unchanged helper parses all stderr after
`reason=` as JSON. The complete, correct `E_ADOPT` exit record is followed by
a host-capacity line, so serde reports trailing characters at line 2, column 1.
The observed block is retained in `exit-record-order-failure.txt`.

This order is legal: `serve.rs` queues host output through core's bounded
asynchronous writer, whereas `lifecycle::finish` writes its complete exit line
directly. The compiled refusals guide describes individual process-event lines;
it makes no promise that the exit event is the final stderr output.

The control appends the same observed harmless host line after real child
stderr. Both original changed-default cases fail (`control-exit-record-before`,
exit 101, 10.105 s); the same injection with the corrected parser passes both
(`control-exit-record-after`, 8.780 s). The final helper requires exactly one
exit record with verb dev, generation 0 and status 1, and compares the complete
JSON-decoded reason with the original expected E_ADOPT message and rewrite.
All original check status, problem-count and source-site assertions remain.
All 82 check tests pass under 48 busy workers (31.806 s); both changed-default
cases pass with 300 ms startup delays (2.024 s, six validated delayed execs).
Times include Cargo setup. No test or product timeout changes here.

At the same boundary, the ownership fixture gains the direct sidecar lock
assertion detailed above, preserving exclusion before SQLite opens without
holding SQLite across four child startups. These changes are applied only
after the whole failed attempt completes. Source digest
`70f35d6168988322c8d9b16dd2e052468e09513978d448daff20d8dc01e6bf97`
starts the next full matrix at `qualified-heavy-8`. Earlier whole passes are
retained as evidence for their own candidate, not counted as final-source passes.


## Eighth heavy attempt: browser route teardown

The client stage passes 5,196 cases and fails only `identity incarnation
refuses publicly without custody (Worker)` after 2094.680633 ms. Its public
refusal and custody assertions finish; the error instead comes from
`route.fetch` in the replacement-store callback after the browser is closed.
The fixture registers `f.close()` directly as teardown while the running client
can issue another sync request. This is a baseline fixture race, not an
admission timeout or evidence of a product refusal failure.

The pinned Playwright implementation distinguishes `unrouteAll`'s `wait` and
`ignoreErrors`: the former removes handlers and joins active invocations,
while only the latter suppresses their errors. The candidate waits before
closing, with final browser cleanup retained in a `finally` block. All fourteen
browser cases share that helper; every original assertion and guard remains.
The original whole attempt finishes before the source change or controls run.

`prepare-route-drain-control.py` prepares an event-controlled overlap outside
the test inventory. It retains the real Worker incarnation assertions, then
starts a separate browser request whose route callback is held at cleanup.
The gate releases when route draining begins or the page closes. Thus the old
cleanup calls `route.fetch` on a closed page, while the candidate must complete
that same callback while the browser lives. No sleep or ignored route error
makes the positive case pass. The original control fails with the same closed-page callback error (exit 1,
3.540 s); the corrected control passes (exit 0, 3.721 s), both under 48 busy
workers. The full attempt completes with `== 1 failure(s) in 3950 s`, including
all 79 models passing, before the fixture change is applied. All 59 tests in the complete admission file pass under 48 busy workers
(98.967 s) and with slow startup (115.308 s). All 197 descendant execs in the
latter run resume after at least 300.000151 ms; none ends before resume. No
assertion, guard or case count changes. These checks precede the new whole
matrix, beginning with heavy attempt 9 at the source digest
`8a1ed4c2a7dd66718ef4fd72c1e2c135b3afa628d63eb1916b9deb53665838f5`.


## Tenth heavy attempt: retained-history race on the process host

The unchanged R5 process case fails the same line-838 empty-delivery assertion
in 548.741058 ms. The whole script still completes: `== 1 failure(s) in 3512 s`,
with all Rust checks and all 79 models passing; 5196 client checks pass and one
fails, with ten inherited skips. All 48 workers survive and source remains fixed.

The existing trace generator now accepts `process` (default remains `wasm`).
Its 100 fresh process repetitions keep every original R5 assertion and reproduce
18 failures, with 82 passes, in 52.616 seconds. No skip, cancellation or
asynchronous error occurs. In the first failure, leave commits at 385.003 ms;
the device still reports watermark 4 at 394.047 ms. The server returns zero rows
at sequence 5 at 398.091 ms, and the watch publishes empty at 398.756 ms. Device
apply finishes at 410.882 ms, then its watermark becomes 5; it returns retained
25 rows at 412.945 ms and publishes them at 413.022 ms. The
[18 failure windows](retained-process-failure-windows.json) include the case name
and return to retained data; the raw control log preserves full timelines.
`summarize-retained-control.py control-retained-process-heavy retained-process-failure-windows.json`
regenerates the windows from the existing log.

This is the same product publication-order defect already proven on wasm,
now witnessed on the process host. The issue stays open. No SDK query source,
R5 assertion or timeout changes, and the whole heavy pass at attempt 9 remains
valid for its source. The matrix resumes at attempt 11, retaining both the pass
and the failed attempt; it still requires two additional heavy passes.
