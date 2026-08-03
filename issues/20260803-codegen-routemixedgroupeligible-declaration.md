# codegen: `routeMixedGroupEligible` runtime export lacks a declaration

**Status:** Open
**Opened:** 2026-08-03 (noticed by the 0166 stream-C verification pass;
pre-existing on main, unrelated to 0166)

`packages/snapback-codegen/index.mjs` exports `routeMixedGroupEligible`
(mixed-route successor work) but `index.d.mts` has no corresponding
declaration, so the repository export-type checker fails on the
mismatch. One-line fix for whichever session owns the mixed-route
gradient; if that work is still in flight, fold it there.
