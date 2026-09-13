# The row-attack runner does not set the Hermes library path, and a clean tree reads as 25 regressions

- Status: open
- Created: 2026-08-25
- Area: `scripts/run-row-attacks.mjs`
- Severity: low as a defect, high as a false-alarm generator

## What happens

`node scripts/run-row-attacks.mjs` compiles a compile-fail witness per row, and for rows expected
**OPEN** it also *executes* the produced binary — that is how an open row is proven still reachable
rather than merely assumed. Those binaries link the vendored Hermes runtime. The runner does not put
`vendor/ibex/linux/lib` on `LD_LIBRARY_PATH`, so on any shell that has not exported it the executions
fail with:

```
.../target/row-attacks/debug/f053: error while loading shared libraries: libhermesvm.so:
cannot open shared object file: No such file or directory
```

and the run ends:

```
[row-attacks] MISMATCH: 24 row(s), 2 feature cell(s), 25 ledger mismatch(es), 0 corpus error(s)
```

**Twenty-five mismatches on a clean tree, from a missing environment variable.** It reports
`0 corpus errors`, so the failure presents as *rows changing state* rather than as infrastructure.

## Why it has not bitten before

Lanes run under a codex environment that exports `LD_LIBRARY_PATH` for the Ibex runtime, so the corpus
has always been run with it set by accident rather than by design. It surfaced the first time the
corpus was run from a plain shell on a different host.

## Why it matters more than its size

This corpus is the programme's instrument of record: it is the only thing that converts "a lane says
this row is closed" into "an executed attack refuses at current `main`". An instrument that reports
twenty-five state changes when nothing changed will either cause a false alarm or, worse, train its
readers to discount its output. The whole value of the row-attack corpus is that its verdict is
trusted without re-derivation.

## Fix

Have the runner derive the path itself rather than inheriting it — it already knows the repository
root — and set `LD_LIBRARY_PATH` (and the macOS equivalent) for the child executions. Additionally,
distinguish **"the attack binary could not start"** from **"the attack ran and succeeded"**: the first
is a corpus error, the second is an OPEN row. Conflating them is what produced the misleading count.

Verified: re-running the same tree with `LD_LIBRARY_PATH=<repo>/vendor/ibex/linux/lib` set removes the
failures.

Related: `issues/20260825-f182-schema-cache-and-a-corpus-blind-spot.md` (the corpus's other known
limitation).
