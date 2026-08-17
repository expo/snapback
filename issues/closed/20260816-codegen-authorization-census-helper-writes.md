# codegen: authorization-review writePolicyChecks miss helper-function writes

**Opened:** 2026-08-16
**Source:** Coterie M2 backend dual review (codex finding, adjudicated by
the orchestrating session; grok independently confirmed the projected rows
are "mostly M1 profile sites plus two M2 helper sites")

## Defect

`generated/authorization-review.json`'s `writePolicyChecks` projects only
write sites lexically inside the operation handler. Writes performed
through same-file helper functions (the paved idiom since the M1 handler
profile admitted them) are invisible: in `demos/coterie/snapback`,
`createPost`, `setFollow`, `setLike`, `setRepost`, and three fixture
mutations declare write sets but project **zero** authorization checks,
because their writes live in reachable helpers (e.g. `functions.mjs`
insert/update helpers). The LLP 0264 authorization census is therefore
materially incomplete for any backend using helper composition — which the
guide itself encourages.

## Ask

Make codegen traverse reachable same-module helpers when projecting
`writePolicyChecks` (the handler-splice machinery already resolves them
for execution), or conservatively classify operations with
helper-mediated writes as `opaque` so the census is honest about its
blind spot. Inlining application write sites to satisfy a census artifact
is the wrong fix and was explicitly rejected at review.

## Scope note

Repo-wide: any demo/app backend using helper writes has the same census
gap. The Coterie M2 landing records the affected operations in
`demos/coterie/snapback/LANE-NOTES-M2.md`.

## Resolution

Resolved 2026-08-17 in the codegen authorization census.

- `scanGenericWriteSites` now scans the inline operation module's complete
  splice-resolved closure, so execution and the census share the same
  same-module helper reachability decision rather than maintaining parallel
  call graphs.
- Dynamic `ctx.db[...]` dispatch and detached `ctx.db.insert|patch|delete`
  callees now make the operation census `opaque`; they no longer silently
  project zero write-policy checks.
- Codegen unit coverage pins direct writes, one same-file helper, a transitive
  helper chain, and the opaque unresolvable-callee case.
- Regeneration changed Coterie's requested counts as follows: `createPost`
  0 -> 5, `setFollow` 0 -> 3, `setLike` 0 -> 5, `setRepost` 0 -> 7,
  `ensureFixtureFollow` 0 -> 3, `ensureFixtureLike` 0 -> 5, and
  `ensureFixtureRepost` 0 -> 7. `ensureFixturePost`'s partial census expanded
  from 2 -> 9. Every one of these rows is `exact-static`; none required an
  opaque classification.

No application write site was inlined or restructured. The full ordered
codegen package chain ran all 76 commands; the two reds reproduced unchanged
at merge base `84e7bdab661c7f9852f20e2f96bdf867cd5547a3` and are unrelated to this
ticket (`client-lifecycle.test.mjs` diagnostic-corpus drift and
`familiar-phase-a.test.mjs`'s absent generated Todo runtime-profile fixture).
