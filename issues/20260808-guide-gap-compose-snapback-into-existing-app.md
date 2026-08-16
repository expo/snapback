# guide-gap: compose Snapback into an existing app

**Status:** Open
**Opened:** 2026-08-08 · **Severity:** P2 · **Area:** CLI / templates / React and Expo integration
**Related:** LLP 0181, LLP 0196, Diary 0063 G4

## Problem

`snapback new` creates a complete project, but there is no backend-only
initializer or package-composition command for an existing React or
`create-expo-app` root. The current published workaround is documented in
`guide/clients/react-expo.md`: install the coherent package set, scaffold a
temporary React project, copy its conventional `snapback/` child, narrow the
Expo typecheck boundary, and generate. That is a truthful paved workaround,
not a first-class composition capability.

## Desired resolution

- Assign an owner and decide whether the product surface is `snapback init`, a
  backend-only template mode, or another non-interactive command.
- Install one coherent package closure without overwriting unrelated app
  configuration or dependencies.
- Create or adopt only the conventional backend files and required client
  integration seams; refuse collisions with actionable diagnostics.
- Prove the path from clean existing React and Expo scaffolds, including
  codegen, typecheck, supervised development, and registered acceptance.
- Replace the capability GAP and sibling-scaffold workaround only after the
  published package path is qualified.

## Author ruling — 2026-08-15 (product surface decided; ticket stays open for implementation)

The product surface is **`snapback init`** — a new top-level command run at
the root of an existing React or Expo app, non-interactive first, adopting
rather than scaffolding: install the published twelve-package closure without
clobbering unrelated configuration, create only the conventional `snapback/`
child and required client seams, refuse collisions with typed
`SNAPBACK_INIT_*` diagnostics, narrow the typecheck boundary, and exit into
the ordinary `generate`/supervised-dev lifecycle. The backend-only template
mode was considered and rejected (overloads `snapback new`'s meaning and
leaves the adoption half as guide prose).

Design home: `llp/0261-snapback-init-existing-app-composition.rfc.md` (Draft).
Its OQ4 carries this ticket's still-open "assign an owner" half. The
qualification bar above is unchanged and restated in the RFC; the GAP row and
the workaround page stay until that bar is met.

## Implementation landed — 2026-08-16 (ticket stays open for the published-path bar)

`snapback init` v1 is implemented in `packages/snapback-cli` per LLP 0261:
create-expo-app (classic and expo-router default layouts, `package.json.main`
disambiguation), the guide's React scaffold shape, transactional
preflight-then-commit adoption with rollback, typed `SNAPBACK_INIT_*`
refusals, JSONC-aware config handling, package-manager
detection/conflict refusal, realpath containment, and idempotent
resume-or-refuse reruns. 64 offline regression tests; three-round
dual-family adversarial review (grok-4.6 + gpt-5.6-sol) converged READY.
Control-catalog row `cli.packaged.init` added.

Still open before this ticket closes (LLP 0261 qualification bar): prove the
path from clean React and Expo scaffolds against the **published** packages
(codegen, typecheck, supervised dev, registered acceptance) after the next
publication picks this up, then flip the capability GAP row and replace the
sibling-scaffold workaround page.
