# Snapback 4 follow fault-matrix case missed its injection in RV qualification

- **Status:** Closed — resolved 2026-10-02 (FIM round 0)
- **Date:** 2026-10-02
- **Area:** `snapback4/packages/snapback4/test/delivery-fault-matrix.test.mjs:264`
- **Attribution:** Baseline test-harness scheduling and async-context attribution hole, reproduced under load on `1687b58af2d4aa7483575e2421dff70e1d918925`; no product change required.

## Original qualification record

The RV round-2 `scripts/test.sh` client phase failed only
`47 persistent: local.ts:850 follow` with:

```
AssertionError [ERR_ASSERTION]: the classified await must actually experience an injected fault
```

The assertions about delivery, recovery and FIFO preceding that coverage
assertion passed. The armed fault counter was zero. No assertion was changed.
The exact cause of the missed injection is not established.

A complete unmodified fault-matrix follow-up on the lane passed 321/321. A
clean control rebuilt wasm and the package from current main
`0f516b3241200321d073861c75a3f1a9311ae04d`; its complete fault-matrix run also
passed 321/321. Three additional main runs with `--test-force-exit` passed
321/321 each. That flag only ended the process after tests completed; it was
not used in the canonical full run or either ordinary whole-file follow-up.
These passes do not establish a baseline failure or a causal environmental
explanation. The full run stays red.

Investigate how the fixture's `f.changed(11)`, background follow and concurrent
flush/sync ownership interact with the armed `local.ts:follow:syncOnce()#1`
fault context. If a deterministic barrier is needed, prove the actual target
await is reached; keep the injection assertion and all delivery assertions.

Evidence: `snapback4/reports/20261001-rv-bound-only-revocation/round2/test-sh.log.gz`,
`fault-matrix-lane.log`, `fault-matrix-main.log`, and
`fault-matrix-main-repeat-{1,2,3}.log`. See that report's round-2 section and
failure ledger for the complete qualification record.


## Resolution — FIM round 0, 2026-10-02

The injector requires real host/transport I/O in the classified await's async
context. `syncOnce()` can return a promise started elsewhere, so reaching the
await was insufficient. The test-only instrument now exposes the current
sync/native-install promise. A barrier drains any existing operation, rechecks
for a replacement, and invokes the classified call without yielding after the
idle check. The target therefore starts the real operation it waits for, and
its real I/O receives the fault. Product code, classifications, recipes and
`delivery-await-boundary.json` are unchanged; all existing assertions remain.

The audit applies this to follow, flush and settlement sync, plus both callers
of shared native installation. Twelve permanent adversarial cases start a
competing operation outside the target context. The follow driver additionally
waits for the live sync boundary before starting its eight retry epochs: a
write can invalidate the fixture's earlier poll before a change signal lands.

Proof: 200 whole-file runs per harness at concurrency 96 on the 96-CPU host.
The old harness fails 3/200 (two persistent follow sync cases, one transient
follow timer); the final harness passes 200/200, all 333 cases each (66,600).
Astra's old hook reproduces zero injected faults. Removing only the new
quiescence barrier makes both permanent competing-sync regressions fail the
unchanged injection assertion after target reachability, three writes and
three terminal notifications. Affected clients: 615 passed, zero failed, one
conditional legacy-binary skip; guide: 110 passed. The single full suite
reports exactly `== 0 failure(s) in 1661 s`: 5,780 client tests pass with ten
conditional skips, and all 79 models pass. All development/negative-control
failures are retained and classified in the report.

No work remains on this injection ticket. Full commands, source custody,
per-run logs, failure classifications and the exact single `scripts/test.sh`
summary are in [the FIM report](../../snapback4/reports/20261002-fim-follow-injection/REPORT.md).
