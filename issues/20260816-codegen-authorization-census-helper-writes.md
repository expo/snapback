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
