# EM round 5 — retain sleep intent through maintenance handoff

2026-10-08 (Berlin date), eb1000 / `expose-builder-pixel`, lane-em, starting
at `9337691bee8350edbe938cdef1ef9b2dde345630`. No other host, worktree or lane's
processes were changed. Nothing pushed or published. The operator's round-4
macOS soak is separate and is not claimed as evidence for this revision.

## Cause and correction

Astra's round-4 review correctly identified two missing sleep checks. A wakeup
record contained both absolute expiry and `awake`, but lookup returned only
expiry. A paused producer could retry after sleep without checking its original
sample. A successor could start after sleep with a new baseline even though its
parent had validated the old notification. Both paths could resume pre-sleep
intent. This does not attribute any historical drain timeout to sleep.

`Observation` now holds expiry and sleep sample together. Fresh producers take
one sample and write that same pair into the wakeup. Every producer retry checks
the pair. Empty-lease rechecks and notification lookup transfer the entire pair,
never an expiry combined with a different baseline. Observer and scan launches
carry the sample in `SNAPBACK4_INTERNAL_RETENTION_AWAKE`, retaining the existing
deadline argument and exact argv. The receiver validates its inherited intent
before consuming a notification or claiming/starting work; scan work and backup
handoff keep the same intent. Only an explicit later export creates a fresh
budget and sleep baseline. Direct leased test/manual entries without inherited
environment still begin a new observation at entry.

This preserves the two original wakeup repairs, cancellation/expiry stops,
fresh-export backstop, original deadline, queue selection, native custody and
retention policy. The background test and its 90,000 ms drain predicate are
byte-identical to round 4. FL's signal/fixture helpers and diagnostics are also
unchanged. [Source hashes and preservation checks](evidence/source-sha256.json).

The llp-orient context is [LLP 3000's contention policy](../../../llp/3000-snapback4.explainer.md#publication-suite-under-contention)
and [LLP 3000.030 §15](../../../llp/3000.030-native-proof-in-minutes.rfc.md#15-export-proves-native-execution-nx-rounds-08-2026-10-02).
The scope is maintenance lifetime and its test evidence, not authoring or a
new scheduler. The round-3 report, both open ticket addenda and §15 now correct
the overstated sleep guarantee. The JOURNAL appends a correction to its claim
that handoffs already inherited the clock; no old entry was rewritten. Both
maintenance tickets remain open for the operator's macOS investigation.

## Deterministic regression and trace limit

The debug-only `SNAPBACK4_TEST_SLEEP_CLOCK` hook supplies Astra's 0 → 2000 ms
clock sequence to the existing Darwin sleep predicate. Reads accept only a
regular file, use nonblocking/no-follow open and at most 32 bytes, and fall back
to the real host clock on invalid input. Release compilation omits this hook.
No shared host was suspended; these are Linux simulations of Darwin clock
samples, not Darwin qualification.

Four new cases join the existing six wakeup regressions:

1. Kill the producer after it publishes a wakeup and cross sleep: the old
   holder rejects the stale wakeup and leaves the request durable.
2. Let that paused producer retry: it must fail with the sleep refusal, leave
   the notification intact and launch no successor.
3. Pause after the old observer accepts a wakeup but before successor launch,
   then cross sleep. A successor actually starts with the original pair and
   exits without consuming the notification or acknowledging the request.
4. With no fresh producer, sleep stops observation and releases the queue lease.
   A later explicit producer takes the post-sleep sample and drains the request.

The final truncation marker now respects the same 4 KiB line cap as ordinary
trace events. Previously, its reserve calculation could pad one line to 4,223
bytes. At most two bounded terminal markers can be written near the 256 KiB
file cap; a leftover too small for a marker stays unused. The existing unit test
now exercises a 4,160-byte remainder and validates every appended JSON line.
No trace I/O moved onto the custody thread and no capture bound was relaxed.

## Verification and controls

Native build and release check passed. The shared JavaScript runner, at
concurrency three, passed **87 tests, 32 Darwin skips**, with zero failures,
cancellations or runner leaks. Background passed **63/63 applicable cases** in
390.6 seconds; wakeup/sleep **10/10**; diagnostics **5/5** (including FIFO,
identity and capture-bound checks); FL signals **9/9**. The first focused
wakeup/sleep run also passed 10/10. [Full suite](evidence/suites.log).

Native retention tests passed **6/6**, including the expanded trace limit
test, and the original sleep-clock unit passed **1/1**. Release check confirms
the conditional code compiles without debug hooks. `./ref-check` passed.
Exact commands, statuses and timing are stored beside each check's log; Rust
logs are losslessly compressed. [Command recorder](check.py).

The controls are intentional failures, not passing product runs:

| Control | Result |
| --- | --- |
| Round-4 retention code with debug clock injection | No-retry case passes; producer-retry and successor-start cases fail their exact new assertions. |
| Both original wakeup exit fixes removed, clocks retained | Both requests remain pending without observers and fail the original 90-second drain assertion; 182.3 seconds combined. |
| Held lease and missing observer against fixed binary | Both fail the original drain assertion; 182.8 seconds combined. Missing-observer injection uses FL's identity-bound `signalFixture`. |
| Original oversized trace padding with the new assertion | Fails with `terminal line exceeded 4 KiB: 4160`. |

All JavaScript control fixtures complete their own cleanup/backstop. Scratch mutation diffs,
commands and logs are under `evidence/controls/`; the stall control is under
`evidence/stalls/`. [Reproduce mutations](controls.py),
[reproduce stalls](stalls.py). The first scratch unit-test setup lacked two
compile-time fixture paths; those compiler failures ran no tests and are retained
separately in `evidence/controls-setup-failure/`. Correcting the scratch layout
produced the actual assertion failures reported above.

## Separate recovery failures retained

The default parallel recovery run passed **23/25**, with two failures:
`ownerless_shell_waits_only_for_live_leases_without_becoming_finished_evidence`
reported `retention lock busy`, and
`discovery_of_an_unfinished_leased_export_keeps_maintenance_pending` failed
`all discoveries were covered`. Restoring retention.rs byte-for-byte from
round 4 reproduced **both failures, again 23/25**, in the first valid baseline
run. The serial fixed-source run passed **25/25**. Astra's earlier review also
retained the first signature with passing serial reruns.

Neither recovery source nor its tests changed in this round. Descriptor
inheritance during concurrent process creation is a hypothesis, not established
causation. The [new open ticket](../../../issues/20261008-snapback4-parallel-recovery-fixture-leases.md)
retains both signatures, baseline evidence and reproduction commands. No test
assertion or product lease check was weakened. This is not a zero-failure
qualification, and serial passes do not erase the parallel failures.

## Evidence custody

Positive JavaScript runs used an immutable native copy, digest
`b5b4fd9d2bb586f33d02a4ccdcbe0be488dc9cff8c728258a48b80cff91abd67`.
Mutation controls used separate immutable copies with their own receipts.
Scratch builds used this lane's Cargo target; no pinned running executable was
rebuilt. Their `finally` path restored the verified positive default binary.
Node v24.13.1; Rust/Cargo 1.97.0; native checks use
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT` and six build jobs.

The bounded snapshot rings retain queue and journal state, step timestamps,
leases and admitted processes, including the stopped sleep intents and every
90-second negative-control timeout. Snapshots are archived with private modes;
each archived file is checked against its original bytes before unpacked copies
are removed. [Snapshot archive](evidence/snapshots.tar.gz),
[archive manifest](evidence/snapshot-manifest.json). The source/binary receipts keep the setup
failures, actual controls, successful runs and baseline failures distinguishable.
