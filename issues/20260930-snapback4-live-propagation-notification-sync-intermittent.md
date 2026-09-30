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
