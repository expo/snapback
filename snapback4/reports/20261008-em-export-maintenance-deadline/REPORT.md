# EM round 6 — preserve a coalesced producer's later deadline

2026-10-08 (Berlin date), eb1000 / `expose-builder-pixel`, lane-em, starting
at `7a6d74fea2`. All work stayed in this worktree. Nothing pushed or published;
the operator's macOS soak is separate from this Linux evidence.

## Finding and change

Grok's round-4 review identified two real ordering defects beyond round 5's
sleep fix. An idle successful observer released the pending lease and spawned
with its own intent before rereading a coalesced producer's later intent. A live
observer could also consume that later notification while keeping its original
deadline. In either case, work blocked beyond the old deadline became pending
without an observer even though the producer had authorized a longer window.

`kick_with` now considers valid later intent before checking expiry and again
under the acquired lease before launch. The empty recheck uses the same strict
comparison. Observer entry gates and notification consumption adopt only a
strictly later, unexpired expiry together with its original sleep-clock sample.
A sample that crossed sleep is rejected. The accepted pair is mutable in the
caller, so successful handoff and later scan launches retain an adoption made
by a live observer. Only adoption of a strictly later valid intent resets the
monotonic observation ceiling; no code computes a replacement absolute expiry.
An active scan retains its original pair and 30-second work limit.

Consumption also needs to avoid reading one producer's notification and then
unlinking a newer replacement. The pending-lease owner atomically renames the
notification to `maintenance-wakeup-reading.json`, considers/validates intent
again, and removes only that receipt. A concurrent replacement remains at the
original name. A guard refusal after rename leaves the receipt available for
post-release lookup, which selects the later valid pair across both names.
Only the pending-lease owner mutates the receipt. These records do not change
request/claim selection, retries, native custody or evidence-retention slots.

The llp-orient context is LLP 3000's contention policy and LLP 3000.030 §15.
The LLP and both ticket addenda now explain these paths and their limits. The
JOURNAL appends a correction to round 3's broad inheritance claim and round 5's
statement that the deadline survived. No historical journal entry was rewritten.
A prior fresh export does not guarantee a successor after every later failure:
a consumed/expired notification, launch/I/O failure, exhausted retries or
simultaneous peer death can still leave durable work for the next export.
Cancellation, sleep and expiry remain stops for the current accepted intent.

This reproduces the new orderings; it does not identify the cause of any
historical macOS timeout. Both commissioned maintenance tickets remain open.
The background test, its 90-second predicate, diagnostics, round-5 clock hook
and trace bounds, and FL's identity helpers are byte-identical to round 5.
[Source hashes and preservation checks](evidence/source-sha256.json).

## Deterministic cases

The existing debug-only, one-shot, 20-second barrier mechanism now exposes idle
success before release/spawn, the live observer's pre-consumption guard, and
receipt acquisition/consumption. Release builds do not execute these pauses.
The two primary regressions use a five-second old deadline, hold retention,
force a real fresh producer to coalesce at the exact barrier, and consume the
notification before the old deadline. The producer's sample is 500 versus the
holder's 0, below the sleep threshold, so pair adoption is observable without
inducing sleep. The fixture waits for an actual post-old-deadline guard or
retention-wait event before releasing retention, then uses the unchanged
90-second drain predicate. A passing run requires acknowledgement, successful
observer exit and the producer's exact accepted pair; the idle case also
requires that pair in the successor launch journal.

Three further integration cases cover a producer replacement after receipt
rename, a later notification whose sample crossed sleep, and cancellation
between rename and consumption. The last case drains through a successor that
inherits the receipt's pair. A native unit test covers equal/earlier deadlines,
recovered receipts and the monotonic ceiling: only a strictly later accepted
intent resets it. The existing ten wakeup/sleep cases are unchanged.

## Verification and negative controls

Results and exact command receipts are retained under `evidence/`, produced by
[check.py](check.py). All JavaScript runs use immutable native copies; the fixed
binary's SHA-256 is
`34e8d5349e16ee7f552cadb2a67ccc73bf263c2bbf4b1f168c58b0412c20523c`.
Scratch controls have separate binary/source digests and mutation diffs. Their
`finally` path restores the fixed default CLI after builds, without rebuilding
an executable in use. Node v24.13.1; Rust/Cargo 1.97.0; native checks use six build
jobs and `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`.

The first focused run passed 14/14 before the final receipt-cancellation test
was added. The final shared runner passes **92 tests, 32 Darwin skips**, with no failures,
cancellations or runner leaks. Background passes **63/63 applicable cases** in
378 seconds; wakeup/sleep/deadline **15/15**, diagnostics **5/5** (including FIFO,
identity and bounds), and FL signals **9/9**. [Complete run](evidence/suites.log).
Native retention passes
7/7, recovery passes 25/25 with normal parallelism, the sleep-clock unit passes
1/1, release check passes, and `./ref-check --verbose` passes with zero errors. The separate parallel-recovery ticket from
round 5 remains open: this pass does not resolve its intermittent failures.

The controls intentionally fail assertions, then recover and clean their own
fixtures:

| Control | Observation |
| --- | --- |
| Later-intent adoption removed, round-5 clocks and all barriers retained | Both new cases fail `coalesced maintenance queue drained`; 191.33 seconds combined. Both snapshots retain a pending request, consumed wakeup, expired old observer and no admitted live process. |
| Original two wakeup exit fixes removed | Both original ordering regressions fail the same 90-second assertion; 182.22 seconds combined. |
| Round-4 retention with debug clock injection retained | Producer retry and successor start fail their exact sleep assertions; the no-retry case passes (4.45 seconds combined). |
| Held lease / missing observer against fixed binary | Both fail the original 90-second assertion (182.29 seconds combined). Missing-observer dispatch uses FL's `signalFixture`; no unrelated process is signalled. |

[Mutation runner](controls.py), [stall runner](stalls.py). The deadline control
changes only `adopt_later` to return false, so it keeps the receipt mechanism,
round-5 clock checks and exact new barriers. It demonstrates the need to adopt
the producer's later intent rather than merely retaining or consuming its
notification. Retained traces show guard refusal 72 ms (idle success) and 70 ms (live guard)
after the old expiry, with no native work started; see the
[extracted event timelines](evidence/deadline-timelines.json).
The original wakeup and sleep controls exercise their separate prior fixes.

## Evidence custody

Snapshots use the unchanged bounded/private collector and retention rings.
Timeout evidence is captured before cleanup; successful cleanup evidence stays
separate. The archive preserves private modes and exact bytes, verified against
its SHA-256 manifest before unpacked snapshots are removed. Logs and receipts
remain alongside the archive; Rust logs are losslessly compressed.
[Snapshot archive](evidence/snapshots.tar.gz),
[archive manifest](evidence/snapshot-manifest.json), [archive verifier](archive.py).
