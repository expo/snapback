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
