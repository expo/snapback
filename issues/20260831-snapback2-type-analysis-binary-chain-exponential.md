# snapback2 compiler: binary-chain type analysis is exponential — 24 int terms take 5 s, 64 terms never finish

**Status:** Open (claimed)
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
