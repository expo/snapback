# Snapback 4 follow fault-matrix case missed its injection in RV qualification

- **Status:** Open
- **Date:** 2026-10-02
- **Area:** `snapback4/packages/snapback4/test/delivery-fault-matrix.test.mjs:264`
- **Attribution:** Unresolved; counted as lane-owned qualification failure, not established baseline or environmental behavior.

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
