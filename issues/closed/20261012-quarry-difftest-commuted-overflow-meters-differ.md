# Quarry difftest: commuted overflowing multiplication meters differ

**Status:** Resolved
**Date:** 2026-10-12
**Systems:** Snapback 4 difftest rewrite-commute oracle; expression pricing
**Related:** LLP 3000.035 §5.1; UNION quality bar (LLP 3000.036.000.000)

The integrated UNION/0.4.23 campaign (`run --seed 0 --cases 100000 --workers 4`)
found seven `rewrite-commute--metered--E_OVERFLOW` cases. All 100,000 sources
compiled, with no generator errors or unexpected binder/runtime refusals.
The repeat and other rewrite/meter checks have no disagreement.

The canonical shrunk case (seed 47997) returns `((b * a) = b)` from a
mutation, with a = -9007199254740991 and b = 9007199254740990. Both original
and commuted programs refuse the same i53 multiplication overflow. Original
steps = 5; commuted steps = 6; all other reported meter dimensions agree.
It contains no writes and one online-only table: it cannot execute UNION's
sync, partition, epoch or commit-retirement changes. This is an unrelated
expression/oracle question discovered by the requested quality bar, and
is not claimed fixed or waived as a pass.

Evidence: [shrunk source](../../snapback4/reports/20261012-union/run/rewrite-commute--metered--E_OVERFLOW/case.q),
[verbatim finding](../../snapback4/reports/20261012-union/run/rewrite-commute--metered--E_OVERFLOW/case.json),
[campaign report](../../snapback4/reports/20261012-union/run/report.json).
Replay from snapback4/: `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo run --release -p snapback4-difftest -- replay reports/20261012-union/run/rewrite-commute--metered--E_OVERFLOW`.

Resolve whether commutation promises identical failure metering here. Fix
expression pricing if it does, or narrow the oracle's documented comparison
if ordering/refusal legitimately differs. Preserve the reproducer either way.

## Resolution — 2026-10-12

Merged LANG2 fix `62d86c5a02` via current sb4-loop `9e345842af` in UNION
merge `5c6e7b39e1`. Refused commutations compare their semantic outcome while
allowing executed cost to differ; successful commutations retain equal-cost
comparison. The fixed-seed regression passes.

A new `run --seed 0 --cases 100000 --workers 8` campaign compiled all 100,000
cases, executed 5,028,923 operations, and recorded zero disagreements, zero
generator errors and zero unexpected refusals. Refused commutations omitted
meter fields in 8,743 applicable cases, explicitly recorded by the oracle.
[New report](../../snapback4/reports/20261012-union/continuation/run/report.json).
The earlier red report and shrunk reproducer remain retained.
