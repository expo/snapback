# Snapback 4: delivery fault matrix site 48 intermittently misses its injection

Status: Open
Scope: Snapback 4 client test reliability / delivery fault matrix
Observed: 2026-10-02, BG round 6 single final-source full-suite run

`packages/snapback4/test/delivery-fault-matrix.test.mjs` failed
`48 transient: local.ts:855 follow` at its final assertion (line 264):
`the classified await must actually experience an injected fault`.
The observed value was false, expected true. The case took 104.206 ms.
Earlier product invariants in that case passed; the intended injection did
not occur. The causal reason is unresolved.

The full suite reports `== 1 failure(s) in 1421 s`, exit 1. Its client stage
has 5,745 passes, one failure and ten skips; all 79 serial models pass.
This is the only final-suite failure. Classify it as inherited baseline
harness nondeterminism, with the following evidence:

- All 495 tracked client source/test files are byte-identical to round 5
  commit `c63b1f6b91`.
- This fixture uses the static chat schema and wasm, without invoking the
  native compiler. The wasm SHA-256 is identical to round 5:
  `233a8f5ca6c1dbbf7205513aea3b059fb35bf59814d99b24fcba1cef6451c164`.
- Ten isolated repeats of the exact site/mode all pass:
  `RG_MATRIX_SITE=48 RG_MATRIX_MODE=transient node --test packages/snapback4/test/delivery-fault-matrix.test.mjs`
  from `snapback4/` with Node 24.13.1.

Passing repeats do not erase the full-suite red. No assertion, matrix count,
timeout or client implementation was changed to obtain a pass. This record
does not claim host load caused the missed injection.

Evidence:

- [Round 6 report](../snapback4/reports/20261001-bg-busy-group-render/REPORT.md)
- [Full suite](../snapback4/reports/20261001-bg-busy-group-render/round6/full-suite.log.gz)
- [Frozen-source receipt](../snapback4/reports/20261001-bg-busy-group-render/round6/final-verification.json)
- [Baseline input comparison](../snapback4/reports/20261001-bg-busy-group-render/round6/fault-input-equivalence.json)
- [Ten repeat outcomes](../snapback4/reports/20261001-bg-busy-group-render/round6/fault-site48-repeats.json)

Next: instrument the follow scenario's preparation, change notification and
classified await to identify why the fault hook can be missed. Establish a
causal barrier for the intended injection, or fix the underlying scheduling
bug, while retaining every matrix case and all product/injection assertions.
