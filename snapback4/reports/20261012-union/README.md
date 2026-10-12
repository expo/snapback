# UNION quality evidence, 2026-10-12

The Lean campaign ran the refreshed 0.4.23 oracle (`lake build quarry-oracle`)
and the integrated difftest binary: seed 0, 100,000 cases, four workers.
`lean/report.json` and the four canonical shrunk cases are copied verbatim
from the campaign. 76,326 cases agreed, 22,656 were outside the named model
fragment, and 1,018 disagreed across the existing C2 and W4 signatures:
filled non-uniform pages may carry a cursor on the engine, and hidden
unique-key upsert collisions refuse E_RULE on the engine versus NOT_FOUND
in the model. These remain open in `lean/OPEN.md`; see the existing tickets
`issues/20261008-quarry-difftest-lean--next--next-no-next-489eda987fa0.md`,
`issues/20261008-quarry-difftest-lean--continuation-next--next-no-next-c33109436d8b.md`
and `issues/20261008-quarry-difftest-widened-shapes-under-open-r2-and-w4.md`.
The generated schemas here are online-only and exercise no union audience,
join metadata or partition scope. This is a red campaign, not a pass.

Revision 7's two new epoch regressions pass on both real stores at both page
sizes, and fail with revision-6 partition code restored. Full quality
results and commit pointers are in the worktree-root WORKSTREAM-REPORT.md.


The ordinary `run` campaign also completed: seed 0, 100,000 cases, four
workers, 5,070,908 executions. Repeat, declaration rewrites and all other
applicable rewrite/meter checks agree except seven commutation cases with
`rewrite-commute--metered--E_OVERFLOW`. Both sides return the same i53
overflow, but the meter differs by one step on the retained shrunk case.
`run/report.json` and the shrunk case are verbatim; the new filesystem ticket
`issues/closed/20261012-quarry-difftest-commuted-overflow-meters-differ.md` records
it. The reproducer has no writes and its only table is online-only, so no
UNION path executes. This campaign also exits red.


Final fast/affected quality results are in `quality-summary.json`. The full
five-crate run reported two fixture failures and no other failed targets:
the public-join fixture was updated for the current-group-only history
rule, and the sharing guide test pins all 12 retained examples. Both
corrected targets pass their reruns. Final affected checks also cover 142
Rust acquisition witnesses, 18 union simulator tests (2 deeper opt-in
ignored), 82 wasm boundary tests, and 124 client sync/budget tests (1 skipped).
The final fixes have not received another paired review: the user-specified
two-additional-round limit is exhausted. See RFC §10 and the bounded-review
follow-up ticket. Neither difftest campaign is counted as a pass.

The coordinator continuation supersedes the ordinary-run red with a clean
100,000-case campaign after integrating LANG2 `62d86c5a02`; see
[continuation evidence](continuation/README.md). The earlier Lean C2/W4
findings remain retained and are not claimed resolved. Latest UNION fixes
remain unreviewed after the bounded final GPT NOT READY verdict.
