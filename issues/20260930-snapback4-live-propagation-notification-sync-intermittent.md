# Snapback 4: pending-cut notification intermittently does not start sync

Status: Open
Scope: Snapback 4 client test reliability / live propagation
Observed: 2026-09-30, BN round 1 single full-suite run

`packages/snapback4/test/live-propagation-fallback.test.mjs` failed one case:
`process: pending cut preserves presentTransition before sync publication`.
The assertion at line 96 is `notification starts sync`, via the five-second
`turns()` guard at line 34. The case took 9.091 s including setup. The full
client stage recorded 5,336 passes, one failure and ten existing skips, with
zero cancellations.

The fixture freezes `setTimeout`, supplies a committed `/changes` response,
then ticks zero-delay timers while waiting for its intercepted `/sync` request.
The notification did not reach that interception before the guard. The root
cause is unresolved; this record does not claim CPU scheduling or a particular
SDK race caused it.

The test, its helpers and SDK sources are byte-identical to BN round 0 and
the merged main base `28014164c6979995708e758c2090e53455101134`.
BN round 1 changes the separately loaded witness helper and witness CLI;
this test does not load that helper. The entire unchanged affected file
passes 10/10 on immediate focused rerun. The same focused case also passes
with the preserved pre-round-1 debug binary. Treat as an existing intermittent
test/SDK issue; a passing rerun does not erase the full-suite red.

Evidence:

- [Full run](../snapback4/reports/20260930-bn-envelope-proof/round1/full-suite.log)
- [Unchanged file rerun](../snapback4/reports/20260930-bn-envelope-proof/round1/live-propagation-rerun.log)
- [Preserved binary control](../snapback4/reports/20260930-bn-envelope-proof/round1/live-propagation-round0.log)
- [Failure ledger](../snapback4/reports/20260930-bn-envelope-proof/round1/FAILURES.md)

Next: capture poll delivery, pending network reservations and native sync-state
calls around the frozen-clock transition. Add a causal barrier or fix the
underlying lost notification after reproducing it; preserve all current
publication, fallback, existence and refusal assertions. Do not extend the
guard or call a focused rerun a repaired full suite.

## Lane LM investigation, 2026-10-03

Status remains **Open**. The [LM report](../snapback4/reports/20261003-lm-live-margin/REPORT.md)
records an instrumented repetition of this exact fixture and independent
React/IndexedDB propagation measurements. Instrumentation adds monotonic stamps
immediately before controlled `/changes` delivery and after the existing
`notification starts sync` barrier; assertions, clock ticks and guards are
unchanged. The current shared wait helper has a work-scaled hang guard, so actual
barrier durations, not just passes, must be compared with the historical five
seconds. Do not interpret these passes as a repair of BN's recorded failure.

With 120 competing React observations on each of two real wasm/IndexedDB clients,
20 cycles per condition (set, replace, clear, tombstone, edit, two offline sends)
had no ten-second miss. All processes inherited CPUs 80–83; the loaded condition
added 16 owned busy loops on those same CPUs. Pinned removal commit-to-React p95
was 81.21 ms without burners and 323.52 ms with burners. Set was 79.27/402.83 ms.
The frozen-clock fixture also passed all 400 instrumented cases (200 per
condition); the largest notification-to-sync barrier was 1,707.19 ms in a
loaded process case. The exact present-transition maxima were 32.85/129.15 ms
(process unloaded/loaded) and 9.45/24.77 ms (wasm).
No mandatory one-second revalidation delay was found: the timer withdraws a
still-unreplaced answer; sync/publication drive replacement independently.

A separate deterministic process/wasm control explains an empty presentation
that RV still permits. Two offline sends retain history when insertion is
certified. Adding an unused nullable `once` image column makes that history's
preservation unknown. Hold its settlement replacement beyond the existing
budget, and `ReadEpisode` publishes `loading`; `Pages` then exposes zero items.
Both messages appear exactly once after release. This is a loading withdrawal,
not an authoritative empty or partial-empty answer. It is consistent with
calibration #29's schema, but the bundle does not prove that its original
pre-workaround empty frame had this exact cause. No authorization bound is relaxed.

The original intermittent lost/delayed notification and calibration #29's
ten-second misses remain unresolved. The standalone fixture does not recreate
the frozen application's complete view tree, media decoder, Following backlog
or the historical shared-host schedule. No client latency fix is claimed.
