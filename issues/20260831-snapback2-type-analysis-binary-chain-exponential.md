# snapback2 compiler: binary-chain type analysis is exponential — 24 int terms take 5 s, 64 terms never finish

**Status:** Resolved in lane (awaiting landing)
**Systems:** snapback2, compiler, type-analysis
**Severity:** P1
**Author:** Claude Fable 5, directed by Charlie Cheever
**Date:** 2026-08-31
**Related:** rules/RULES.md (`snapback2 check` ≤ 1 s budget), `snapback2/packages/compiler/src/type-analysis.ts:203`

Found by the round-4 blind review of the provenance lane; triaged INHERITED at
`ca7fa28d8` — main and the lane behave identically, so **main's `check` budget
is already breakable today** by an ordinary authored expression.

`analyzeBinary` recursively re-walks both operands, so an N-term integer
addition (`args.price + 1 + 1 + …`) is exponential. Measured (both commits):
24 terms → ~5.0 s compile (5× the 1 s check budget); 64 and 128 terms →
killed at the 10 s timeout. The `Decimal<2>` branch takes a different path and
stays fast at all sizes — the pathological case is the plain-int chain.

Fix: memoize per-node analysis (single walk), and add a perf regression test
with a bounded budget (e.g. 128-term chain compiles < 200 ms). Also worth a
depth/width guard that refuses pathological expressions with an envelope
rather than hanging — the compiler must be total in time as well as in
control flow.

Probe scripts: scratchpad of session snapback-8a, `probes/run-perf.mjs` /
`probes/results/s7-int.json` (rerun commands in the provenance-lane landing
report).

**Claimed:** 2026-08-31 by session snapback-8a [f8c2a2] — one combined lane `s2/t2-typeanalysis` (worktree `~/projects/snapback-s2v`) fixes both P1 type-analysis tickets (same file); other sessions should skip both.

## Resolution (2026-08-31)

Commit `b8d993697` memoized expression results by AST node and analysis context.
The round-1 review fix completes the totality boundary: the 8,192 ceiling now
counts contextual expression visits, not distinct authored nodes, and an
operation that reaches it is never passed to lowering. The 512-depth ceiling
remains. The guard reuses the guide-reachable `E_OPAQUE` family and its rewrite
is now an intentionally non-lowerable sentinel naming both bounds. Its message
states that both limits are per operation and that naming local values does not
reset them; the author must reduce the operation or split it into multiple
operations.

On the original local probe, 24/64/128-term integer chains changed from
2,330.7 ms / >10 s / >10 s to 7.4 ms / 9.7 ms / 12.3 ms. The regression
allowance is now 500 ms. Tests also cover a 128-term Decimal/int chain whose
127 literals all scale to 100, the non-lowerable guard rewrite, and a depth-12
helper DAG that must compile or refuse inside 500 ms. A depth-13 adversarial
probe refused at the contextual-visit guard in 22.84 ms instead of expanding
without bound.
