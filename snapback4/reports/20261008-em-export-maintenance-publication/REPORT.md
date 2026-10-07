# EM round 7 — monotonic wakeup publication

2026-10-08 (Berlin date), eb1000 / `expose-builder-pixel`, lane-em, starting
at `abf3f8fab113403d596213b4146333e67ff82315`. Both supplied round-6 reviews
were read. Only this worktree and this lane's processes were changed; nothing
pushed or published.

## Cause and fix

Astra demonstrated a producer-to-producer race left after the receipt repair.
A validated before sleep, paused at `kick-notifying`, and later unconditionally
replaced B's successfully published post-sleep intent. A rejected its own retry;
the expired holder rejected the stale replacement. B had succeeded, but its
valid intent was gone and pending work had no observer. Atomic rename supplied
complete bytes, not ordered intent. A reread alone would leave a compare/write
race between producers.

The busy-queue path now serializes producer validation, comparison and
publication under `maintenance-wakeup.lock`. `publish_wakeup` checks its own
expiry/sample under the lock and again before atomic rename. An equal or later
valid pair in either the wakeup or receipt is preserved. An invalid publisher
refuses without rewriting anything; a valid one may replace invalid or earlier
intent. The accepted expiry and original sleep sample stay together. All
product wakeup writers use this helper.

Consumers keep the round-6 receipt protocol and do not acquire this producer
lock. They can only move/remove the compared notification; they cannot install
a competing newer intent between comparison and write. Other producers are
excluded for that interval. A receipt already adopted by a consumer need not be
republished, and a replacement after receipt rename remains protected. No
request/claim selection, retention slot, custody lease or scan budget changes.

Producer lock acquisition checks intent and cancellation, retries every 20 ms,
and refuses explicitly after five seconds with the request preserved for a
later export. It never reports successful coalescing merely because this lock
was busy. The producer holds no pending-queue or active-scan lease while
waiting; observer deadline/release paths do not wait for it. The scope is a
short metadata update after a failed pending-lease attempt, not retention work.
Kernel release on publisher death supplies recovery from an abandoned writer.
The five-second acquisition bound does not bound synchronous filesystem I/O;
existing kernel-stall and next-export-backstop limits remain.

The governing llp-orient context is LLP 3000's contention policy and LLP
3000.030 §15. The latter, both maintenance ticket addenda and an appended
JOURNAL entry now state the producer ordering and bounded refusal. The
trusted-project-file threat model is unchanged: these checks do not authenticate
forged local intent records. Both maintenance tickets remain open; the new
reproduction does not attribute the historical macOS timeout.

## Regressions and controls

Six integration cases extend the existing fifteen wakeup/sleep/deadline cases:

1. Kill A at the pre-publication barrier after B coalesces post-sleep: B drains.
2. Resume A there: A refuses sleep, B's exact pair survives, and B drains.
3. Resume an older A without crossing sleep: it succeeds without lowering B's
   valid pair, and B drains.
4. Pause A after comparison under the publication lock; B reaches the busy-lock
   barrier, then publishes its later pair after A finishes.
5. Kill A while it holds that lock; B acquires the released lock and drains.
6. Hold the writer lock with a fixture process: the producer refuses at the
   five-second acquisition bound, while the stopped observer still releases
   pending custody. The ordinary fresh-export backstop later drains the request.

The new lock barriers use the existing debug-only, one-shot, 20-second mechanism;
release compilation omits the pause behavior. The first three cases use the
existing `kick-notifying` barrier and clock injection. A native unit test checks
equal/later preservation, replacement of earlier or expired intent, refusal of
an expired publisher, and an equal valid receipt. The existing receipt-race,
receipt-cancellation, sleep and later-deadline regressions remain unchanged.
No shared host was suspended. The 90-second predicate and diagnostics are
byte-identical to round 6, as are FL's helpers and the clock implementation.
[Source hashes and preservation checks](evidence/source-sha256.json).

The actual round-6 retention source is the new negative control, with no test
bound changed. Its killed-A case passes. The stale-write case fails the unchanged
90-second drain assertion, retaining B's original pair alongside A's replacement
in `maintenance-test-producer-order.json`. In this run, B published
`{expiresAt: 1791420052454, awake: 2000}` and A replaced it with
`{expiresAt: 1791420052432, awake: 0}`. The fixed run preserves B
exactly; [paired observations](evidence/producer-orderings.json). The older-valid case drains but fails
exact-record preservation because its older expiry replaced B's. Both failures
and cleanup are retained; combined duration 94.13 seconds.

The other controls also completed with the expected failures:

| Control | Result |
| --- | --- |
| Original wakeup exit fixes removed | Two 90-second drain failures; 182.14 seconds combined. |
| Round-4 retention with clock injection | Two sleep-assertion failures, one no-retry pass; 4.41 seconds. |
| Later-deadline adoption disabled | Two 90-second drain failures; 191.31 seconds combined. |
| Held lease / missing observer against fixed binary | Two 90-second drain failures; 182.31 seconds combined. |

Each uses
immutable binary copies and restores its own fixtures through the ordinary
backstop. [Mutation runner](controls.py), [stall runner](stalls.py). The original
source/binary hashes, mutation diffs, command receipts and logs distinguish
intentional control failures from product-suite results.

## Verification

The initial focused run passes 21/21. The final shared runner passes **98 tests with 32 Darwin skips**, no failures,
cancellations or runner leaks: background **63/63 applicable cases** in 383
seconds, wakeup/sleep/deadline/publication **21/21**, maintenance diagnostics
**5/5** (including FIFO, identity and capture bounds), and FL signals **9/9**.
[Full run](evidence/suites.log). Native retention passes **8/8**, the sleep-clock
unit passes **1/1**, release check passes, and `./ref-check --verbose` reports
zero errors. Exact commands, exit codes and timings are stored under
`evidence/`, recorded by [check.py](check.py).

The default parallel recovery run retains **23 passes and two failures**:
`ownerless_shell_waits_only_for_live_leases_without_becoming_finished_evidence`
reports `retention lock busy`, and
`discovery_of_an_unfinished_leased_export_keeps_maintenance_pending` reports
`all discoveries were covered`. These are exactly the two signatures already
recorded against round-4 source in round 5, and reported again by Astra's
round-6 review. The serial run passes **25/25**. Recovery code and assertions
are unchanged. This is not a zero-failure qualification; the serial pass does
not resolve the [open recovery ticket](../../../issues/20261008-snapback4-parallel-recovery-fixture-leases.md).

All JavaScript product tests use the immutable debug binary with SHA-256
`da8d88838c98b49f1a417415587b07c8c52938fbc68955e19ef729af1ee551b3`.
After the original parallel recovery run, the fixed unit harness and its sibling
CLI were pinned together for serial recovery and clock checks, so scratch Cargo
builds could not change their child executable. Controls use this lane's one
Cargo target and restore the positive default CLI in `finally`. Node v24.13.1;
Rust/Cargo 1.97.0; six build jobs and
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`.

## macOS evidence and custody

The operator reports that **round 4** passed its macOS soak: 6/6 wakeup cases
and six export-background runs at 95/95, with no drain timeouts. This is recorded
as supplied, not rerun or independently inspected here. It does not qualify the
round-5/6/7 revisions on Darwin or establish the historical cause. This lane did
not use the mini, office M1 or M5.

The unchanged bounded collector retains queue/journal state, admitted processes
and step timestamps before fixture cleanup. Named producer-order checkpoints
retain successful pair preservation too; their diagnostic bucket is not a test
failure verdict. The archive verifier checked private modes and exact bytes for **38 snapshots,
877 files**, before removing only this report's unpacked snapshots. Logs and command
receipts remain separate, with Rust/control logs compressed losslessly.
[Snapshot archive](evidence/snapshots.tar.gz),
[manifest](evidence/snapshot-manifest.json), [verifier](archive.py).
