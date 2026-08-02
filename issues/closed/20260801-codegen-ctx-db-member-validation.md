# Codegen validates ctx.db.query chains but not unknown ctx.db members

**Status:** CLOSED — carried from round-1 clip-locker friction F3;
round 2 did not exercise it (builder never reached for `update`), so
the gap is unverified-fixed and remains real by inspection

`ctx.db.update(...)` (the Convex spelling; Snapback's is
`ctx.db.patch`) fails at runtime with `undefined is not a function`
instead of at generation with a named diagnostic. The fix-wave chain
validation (`queryChainProblem`) covers verbs chained from
`ctx.db.query(...)` only; unknown members of `ctx.db` itself are not
validated. Fix shape: validate handler member access against the
runtime's actual `ctx.db` surface (query/get/insert/patch/delete/…)
the same way the query-chain verbs are validated, refusing at
generation with the correct spelling named.

Evidence: round-1 baseline F3
(demos/upload-bakeoff/reports/round2/round1-baseline.md §App C).

## Resolution

Fixed 2026-08-01. Inline-handler admission now mirrors the runtime's finite
`ctx.db` surface (`get`, `query`, `insert`, `patch`, and `delete`) and refuses
an unknown direct member before artifact replacement. The diagnostic for the
reported `ctx.db.update(...)` spelling explicitly names `patch` as the repair.

`packages/snapback-codegen/authoring-validation.test.mjs` pins both halves:
`update` refuses at generation with the named remediation, while the equivalent
`patch` mutation still generates. The focused test and the complete
`@expo/snapback-codegen` package suite pass.
