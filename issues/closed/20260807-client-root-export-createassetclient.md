# createAssetClient declared in root .d.mts but not exported by root .mjs

**Status:** Closed (2026-08-08)
**Impact:** 2
**Urgency:** 2
**Ease:** 5
**Confidence:** 5
**Systems:** Client packages, Types
**Date:** 2026-08-07
**Related:** Diary 0068 (four-lane measurement, 0.1.13)

`@expo/snapback-client`'s root type declarations declare
`createAssetClient`, but the root `.mjs` does not export it — consumers get
a runtime undefined that the types said exists (the exact "typecheck lies"
class LLP 0186 flags as maximally expensive for agents). The subpath
`@expo/snapback-client/assets` works. Export it from the root or remove the
root declaration; add the export-parity check to whatever test pins
type/runtime export agreement.

- **Claimed 2026-08-08:** session 86767887 (the diary-0068 orchestrator) is executing this ticket now; sibling sessions should not duplicate.

## Resolution (2026-08-08)

The premise was half-right: as verified against both the repo and the
published 0.1.13/0.1.14 tarballs, the root `index.d.mts` did **not**
declare `createAssetClient` — neither side of the root exported it (typed
consumers got TS2305; untyped Metro consumers got the runtime undefined
the diary hit). The `/assets` subpath was and remains the canonical home.

Fixed by paving the intuitive import instead of leaving the pothole:

- `packages/snapback-client/index.mjs` and `index.d.mts` now both re-export
  `createAssetClient` from `./assets.mjs` (no module-graph weight added —
  `commands.mjs` already pulled `assets.mjs` into the root graph).
- The "typecheck lies" class is killed generally by
  `packages/snapback-client/export-parity.test.mjs`: for **every**
  package-exports entry with a `types` + `import` pair, it parses the
  `.d.mts` with the TypeScript compiler API, collects every declared
  value-position symbol (functions, consts, classes, non-const enums,
  non-`type` export clauses), fails loudly on collector-unknown shapes
  (`export *`, defaults, `export =`, namespace re-exports), then imports
  the runtime `.mjs` and asserts each declared symbol is an own, defined
  namespace property. 249 declared symbols verified across 31 export
  entries; a deliberately injected phantom declaration fails the check.
- Registered in the package `test` script and in
  `scripts/check-package-test-inventory.mjs` (233 → 234).

No other declared-but-missing symbol was found by the general check.
