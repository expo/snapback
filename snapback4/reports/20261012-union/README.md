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
