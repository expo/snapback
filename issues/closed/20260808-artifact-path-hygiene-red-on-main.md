# Checked-in production artifacts embed absolute checkout paths; artifact hygiene is red

**Opened:** 2026-08-08 · **Severity:** P1 (publication integrity / privacy) · **Area:** generated demo distributions

## What

The pinned-toolchain canonical check fails on five committed surface trees:

```text
$ node scripts/check-artifact-path-hygiene.mjs
[artifact-path-hygiene] FAIL: 5 surface dist tree(s) embed absolute checkout paths
```

Affected surfaces include:

- `demos/partiful-matrix/surfaces/contract/dist/` — embedded
  `/private/tmp/snapback-attribution-repro-20260726...` source paths in HTML
  and attribution JSON;
- `demos/partiful-matrix/surfaces/react/dist/` and
  `demos/partiful-matrix/surfaces/vanilla/dist/` — the same retained temporary
  checkout identity;
- `demos/todo/surfaces/contract/dist/web/` and
  `demos/todo-v2/surfaces/contract/dist/web/` — embedded
  `/Users/ccheever/projects/snapback/...` source/provenance paths.

These are present in committed `HEAD`, not introduced by the review's working
tree. The paired fixture `node tests/artifact_path_hygiene_v0.mjs` fails too.
The canonical complete proof therefore has a real root failure independent of
the local Node-version mismatch seen in the first proof attempt.

Absolute source paths disclose builder-local identities and make production
artifacts location-dependent. More importantly, this is a frozen publication
gate that has gone red again after its previous closure.

## Fix

Rebuild the affected distributions with the portable-artifact toolchain and
verify that provenance is repository-relative or deliberately redacted. Do not
hand-edit minified artifacts. Trace which landing regenerated these surfaces
without running the hygiene gate, and add/repair the affected-scope selection
so any committed `dist/` leaf selects both the checker and its fixture.

## Acceptance

- `node scripts/check-artifact-path-hygiene.mjs` passes across every inventoried
  production distribution.
- `node tests/artifact_path_hygiene_v0.mjs` passes.
- The affected selector has a regression proving a changed generated
  distribution cannot land without the hygiene gate.

## Confidence

High. Both the production checker and its fixture reproduce under pinned Node
24, and the offending bytes are in clean committed files.

## Blocked (2026-08-08 review-fixes)
Not fixable as a mechanical proof-green step: the five committed dist trees (partiful-matrix contract/react/vanilla, todo + todo-v2 contract dist/web) embed absolute checkout paths and must be REBUILT with the portable-artifact toolchain, but those demos pin Exact 0.1.6/0.1.2 while portable generation needs Exact 0.1.7+. Rebuilding requires authorizing the Exact dependency-pin upgrade + frozen installs first, then rebuilding all five surfaces. Sequence that dep upgrade before this ticket can close.

## Resolution (2026-08-15)

The five ignored distribution trees were regenerated from their build inputs.
Partiful's shared Vite attribution now emits repository-relative module IDs (and
deliberately redacts absolute external IDs), and its Contract prerender makes the
Exact hydration manifest portable before embedding it. The Partiful Contract,
Todo Contract, and todo-v2 Contract surfaces now use the published Exact 0.1.7
portable-artifact suite, with refreshed frozen Bun lockfiles. All five full
surface builds and both artifact-path hygiene checks pass.

The existing `demo-and-harness` selection rule already selects both
`artifact-path-hygiene` and `artifact-path-hygiene-fixtures` for every path under
`demos/`; the selector fixture now proves that behavior for a representative
committed leaf from each of these five distribution shapes.

Originating landing: none — Git history contains no committed leaf in any of
the five named `dist/` trees; the 2026-08-08 report observed ignored local build
output rather than committed `HEAD`.

The affected-scope LLP audit found no design drift, and `./ref-check --verbose`
passed with zero errors. The ignored distributions remain local build products;
no generated or minified artifact was hand-edited or added to Git.

The only committed acceptance runner that directly executes one of these trees
is Partitime's production-web browser matrix. It was not runnable here because
`target/debug/snapback` is absent and this task forbids Cargo; the retained
Step 4 report generators were not used as a substitute because they rewrite
frozen claim records without re-executing the rebuilt browser artifact.
