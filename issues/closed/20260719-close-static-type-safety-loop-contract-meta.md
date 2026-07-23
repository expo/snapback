# Close the static type-safety loop: generate contract-meta sidecars and type helper results

**Status:** Resolved (2026-07-23 — all three Done-when criteria verified against main; pin proven by running the regression under @ccheever/exact-contract@0.1.4)
**Severity:** P2
**Systems:** Codegen, Contract Adapter, DX
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-19
**Related:** diaries 0008, 0009, 0010
**Linear:** ENG-25268; related completed Exact work ENG-22419, ENG-22500,
ENG-25129, and ENG-22416
**Marker:** dx, type-safety, codegen, contract-meta

The red-team comparisons (diaries 0009/0010) identified exactly one error
class where "React is categorically safer": static type coverage of the
data seam. Two compounding gaps:

1. **Hand-mirrored contract-meta sidecars with no drift checker.** Every
   helper signature change in `data.ts` must be manually mirrored in
   `data.contract-meta.ts`'s `params:` lists. Diary 0010 hit this twice in
   one session; silent drift is the failure mode, and diary 0009 lists it as
   punch-list item #4 ("a duplicate with no checker I could see").
2. **Opaque helper-result types let typos ship to runtime.** Because
   contract-meta result types are opaque strings, `board.hero.headsgn`
   compiles clean and ships (diary 0010 P2). The identical bug in the React
   arm is caught by `tsc --noEmit` with
   `TS2551 … Did you mean 'headsign'?`. Related: function-typed props are
   decorative — `{ kind: 'function' }` keeps the signature as raw text, so
   nothing checks arity or parameter types (diary 0008, ENG-22417).

Direction: derive the sidecar from the helper source (or at minimum add a
drift checker that fails codegen when `params:` disagree with the exported
signatures), and carry real result types through contract-meta so member
access on helper results is checked with did-you-mean quality errors.

**Done when:**

- Sidecar `params:` lists are generated from, or checked against, the helper
  module's actual exported signatures; drift fails codegen with a stable
  diagnostic.
- A misspelled member access on a helper result fails at compile/typecheck
  time rather than shipping to runtime, demonstrated by a regression test
  reproducing the diary 0010 `headsgn` case.
- The guide's Contract client page documents the checked seam (and the
  remaining unchecked residue, if any, as explicit caveats).

## Resolution (2026-07-23, audited against origin/main)

All three Done-when criteria are implemented and gated:

1. **Drift checker:** `scripts/check-contract-meta.mjs` diffs each sidecar's
   `pure({ params })` against the sibling module's exported signatures and
   fails with `SNAPBACK_CONTRACT_META_PARAMS_DRIFT` (plus
   `_EXPORT_MISSING`/`_PARAMS_UNCHECKABLE`); unit test seeds a drift and
   asserts the code; wired into `scripts/verify-local-proof` (lines 59-60).
   The generation alternative (`exact contract meta --write/--check`,
   ENG-22419) exists upstream.
2. **Misspelled member access fails typecheck:**
   `demos/all-aboard/surfaces/contract/headsign-typecheck.test.ts` compiles
   `board.hero.headsgn` and asserts `shape_unknown_member` with
   `did you mean "headsign"?` (the diary-0010 case). Verified executable this
   session: `bun test headsign-typecheck.test.ts` → 1 pass under the pinned
   published `@exact/contract` = `npm:@ccheever/exact-contract@0.1.4`, so the
   published pin demonstrably contains the seam. `check-contract-meta` also
   ran green.
3. **Guide documents the checked seam:** `guide/clients/contract-adapter.md`
   §"Checked helper metadata and result shapes" names the gate, the stable
   codes, the headsign example, and the residue caveats (opaque non-shape
   results; raw function-type spellings).

Residual (non-blocking, noted for completeness): the checker walks `demos/`
only (admin-ui sidecars unchecked) and compares param names, not types.
Linear twin ENG-25268 was already Done; this file now matches it.
