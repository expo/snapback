# guide-gap: snapshot-bundles page does not cover structured route-group arguments

**Opened:** 2026-08-08 · **Severity:** P3 (documentation)

`guide/realtime/snapshot-bundles.md` says "every argument must be a literal
or a declared route-parameter binding" and shows only the primitive
`args: { dashboardId: routeParam('dashboardId') }` form. LLP 0191's
2026-08-05 evidence entry records that this silence is what sent the
Zerobugs Lane 3 control into primitive wrapper arguments plus a hand-written
server-side merge.

`issues/20260808-route-group-argument-lowering.md` landed the capability
(LLP 0092 dated amendment 2026-08-08): a `routeParam()` may now sit at any
object-reachable position in an argument, and null / union-literal /
array-of-literal members validate against the declared argument validator.
The guide has not absorbed it.

Ask: add a "structured query contexts" subsection to
`guide/realtime/snapshot-bundles.md` covering

- a nested `routeParam()` inside an object argument, with a CI-verified
  `source=` snippet from a real demo (none exists yet — the demo route
  needs to be added first, which is why this is not folded into the
  landing commit);
- the null / union-literal / array-literal members;
- what still refuses: a bare root reference, a reference inside an array
  literal, and a reference whose leaf is not a string/number/boolean
  argument position;
- the register/mixed eligibility rule that every reference, at any depth,
  must target a string-typed position.

Fence note: the surface is newer than the newest published closure recorded
in `guide/published-closure.json`, so the page needs a `since:` bump (and
possibly the unreleased banner) when this lands — check
`guide/conventions.md` §"The published-closure fence" before editing.

Owner seam: D2 (LLP 0183 assigns the graph/argument surface to D2);
governing guide design is LLP 0061 §5.
