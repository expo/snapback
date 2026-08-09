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
