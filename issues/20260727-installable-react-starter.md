# Installable React starter and first-hour witness

**Status:** Open  
**Impact:** 5  
**Urgency:** 4  
**Ease:** 3  
**Confidence:** 5  
**Severity:** P1  
**Systems:** Packaging, Developer experience, React, Vite, Code generation, Testing  
**Author:** Codex, directed by Charlie Cheever  
**Date:** 2026-07-27  
**Related:** LLP 0030, LLP 0041, LLP 0064, LLP 0074; `packages/snapback-cli`, `packages/snapback-react`, `packages/snapback-vite`

The public package closure and `snapback new|generate|dev|doctor` loop are
shipped, but `snapback new` offers only `todo-contract`. There is no
public-package React/Vite scaffold that proves the shortest path from install
to a rendered generated live query. The bakeoff therefore used monorepo-relative
imports and custom glue even though most required primitives exist.

## Desired resolution

- Add a `todo-react` scaffold using React, Vite, `@snapback/vite`, generated
  operation refs, and the first-party React surface.
- Make one `snapback dev --client ...` command own generate, server
  start/attach, stable relative proxy, seed-on-new-database, Vite, watch/reload,
  diagnostics, and teardown.
- Use installable/public Snapback package aliases only; no sibling-checkout or
  repository-relative product imports.
- Update the first-backend/authoring-loop guide and capability index so a cold
  author finds this path.
- Make the public-registry cold-install proof create, run, and exercise this
  scaffold on macOS/arm64 and Linux/x64.

## Acceptance

- A clean temporary directory can install the published package set, scaffold,
  generate, start, render the seeded todo, and observe a native live mutation.
- Reload/HMR preserves post-seed user data; only a newly created managed
  database receives the bootstrap seed.
- Browser code sees only the relative Vite seam, never private loopback URLs,
  admin tokens, runtime paths, or repository paths.
- The generated query and mutation require no string names, casts, or
  caller-written subscription cleanup.
- Packed-package tests, public-registry receipts, TypeScript, Vite production
  build, and a browser smoke pass are retained.

This ticket consumes the first-class React and result-contract tickets; it
must not recreate their missing provider or typing logic inside the template.

## Implementation checkpoint — 2026-07-28

The `todo-react` scaffold, generated refs, first-party provider/query/mutation
surface, managed `snapback dev` loop, web typecheck/build/live witness, and
Expo iOS export witness are implemented. A disposable loopback registry
installed the exact packed tarballs into a fresh directory with no sibling
source checkout; the retained receipt is
`demos/signal-desk/acceptance/cold-install-react.v1.json`.

That cold proof found and corrected a stale-native-runtime packaging hazard:
the previously staged runtime binary predated the result-contract projection,
so the new client correctly refused it. Rebuilding the release binary at the
current source revision made the exact generated/deployed contract comparison
pass. Two consecutive clean staged runs then passed the complete web/Expo/live
matrix.

The ticket remains open until the Linux x64 cold run passes and the complete
versioned closure is published and read back from the decided
`@ccheever/snapback-*` public aliases. The retained local receipt deliberately
marks public-registry and separately provisioned clean-machine claims false.

## First-rerun developer-loop correction — 2026-07-28

The first bakeoff rerun found two package-loop defects before browser
acceptance:

- ordinary `snapback dev` did not infer that a generated sessions-mode app
  must establish its complete schema/functions pair through startup artifacts;
  the comparator happened to pass a private option while the author-facing
  command fell into the dev-only raw host-load path; and
- a selected runtime built before the current route artifact shape reduced an
  unknown `registerGroupEligible` field to the server's generic invalid-JSON
  diagnostic, hiding the actual runtime/codegen identity mismatch.

The CLI now infers sessions mode from the generated schema, supplies the
closed startup carrier on initial start and restart, and sends subsequent
sessions changes through the complete admin-authorized provisioning pair.
`packages/snapback-cli/sessions-dev-loop.test.mjs` proves that one-command path
without the comparator option. Artifact decoder refusals now become
`SNAPBACK_RUNTIME_ARTIFACT_IDENTITY_MISMATCH`, naming the selected binary and
independent build stamp plus safe same-revision rebuild and explicit override
guidance. The Guide now makes the current React command, one-command
Vite/backend ownership, versioned-seed behavior, installed package closure,
and public-versus-staged nonclaims discoverable.

This correction adds no browser claim. The ticket remains open on the same
public expanded-closure and browser acceptance gates above.
