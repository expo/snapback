# codegen: `routeMixedGroupEligible` runtime export lacks a declaration

**Status:** Resolved (2026-08-03)
**Opened:** 2026-08-03 (noticed by the 0166 stream-C verification pass;
pre-existing on main, unrelated to 0166)

`packages/snapback-codegen/index.mjs` exports `routeMixedGroupEligible`
(mixed-route successor work) but `index.d.mts` has no corresponding
declaration, so the repository export-type checker fails on the
mismatch. One-line fix for whichever session owns the mixed-route
gradient; if that work is still in flight, fold it there.

## Resolution (2026-08-03)

The declaration now exists on main: `routeMixedGroupEligible` is declared
in `packages/snapback-codegen/index.d.mts` (line 86 on origin/main,
"Closed mixed-route v2 predicate shared with the route authoring
fixture"), landed with the mixed-route work in 46b614efd. Verified
present at close time; the runtime export and declaration match.
